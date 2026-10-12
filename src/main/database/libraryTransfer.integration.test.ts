import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { FolderRepository } from './repositories/FolderRepository'
import { TagRepository } from './repositories/TagRepository'
import { AssetSourceRepository } from './repositories/AssetSourceRepository'
import { AssetImporter } from '../services/assets/AssetImporter'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { findExistingLibraries, LibraryTransferService, relocateManagedPaths, validateExistingLibrary } from '../services/filesystem/LibraryTransferService'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Library backup and computer migration', () => {
  it('finds a complete Library inside a selected outer folder and distinguishes multiple Libraries', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'muse-discovery-'))
    cleanup.push(workspace)
    const nested = ensureLibrary(join(workspace, 'whole-backup', 'older-backup', 'Muse Library'))
    new DatabaseService(nested.database).close()

    expect(await findExistingLibraries(workspace)).toEqual({ paths: [nested.root], truncated: false })
    expect(await findExistingLibraries(nested.root)).toEqual({ paths: [nested.root], truncated: false })

    const second = ensureLibrary(join(workspace, 'another-library'))
    new DatabaseService(second.database).close()
    const found = await findExistingLibraries(workspace)
    expect(found.truncated).toBe(false)
    expect(found.paths).toHaveLength(2)
    expect(found.paths).toEqual(expect.arrayContaining([nested.root, second.root]))
  })

  it('preserves originals, folders, tags and favorites after the root path changes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'muse-transfer-'))
    cleanup.push(workspace)
    const sourceLibrary = ensureLibrary(join(workspace, 'old-computer', 'Muse Library'))
    const inputRoot = join(workspace, 'inputs')
    await mkdir(inputRoot, { recursive: true })
    const inputs = await Promise.all(Array.from({ length: 3 }, async (_, index) => {
      const path = join(inputRoot, `photo-${index}.jpg`)
      await sharp({ create: { width: 360 + index, height: 480, channels: 3, background: { r: 80 + index * 30, g: 100, b: 140 } } }).jpeg().toFile(path)
      return path
    }))

    const sourceDatabase = new DatabaseService(sourceLibrary.database)
    const sourceAssets = new AssetRepository(sourceDatabase.db, (path) => path)
    const folders = new FolderRepository(sourceDatabase.db)
    const tags = new TagRepository(sourceDatabase.db)
    try {
      const imported = await new AssetImporter(sourceLibrary, sourceAssets).import(inputs)
      expect(imported.imported).toHaveLength(3)
      const autumn = folders.create('秋冬')
      const backpack = folders.create('背包')
      sourceAssets.attachToFolder(imported.imported.map((asset) => asset.id), autumn.id)
      sourceAssets.attachToFolder(imported.imported.slice(0, 2).map((asset) => asset.id), backpack.id)
      const reference = tags.create('参考')
      tags.attach([imported.imported[0]!.id], reference.id)
      sourceAssets.toggleFavorite(imported.imported[0]!.id)

      const backupParent = join(workspace, 'external-drive')
      const result = await new LibraryTransferService(sourceDatabase.db, sourceLibrary, 'test').backupTo(backupParent)
      expect(result.assetCount).toBe(3)
      expect(result.folderCount).toBe(2)
      expect(validateExistingLibrary(result.path).valid).toBe(true)

      const newComputerParent = join(workspace, 'new-computer')
      const movedRoot = join(newComputerParent, 'My Muse Library')
      await mkdir(newComputerParent, { recursive: true })
      await rename(result.path, movedRoot)
      const movedLibrary = ensureLibrary(movedRoot)
      const movedDatabase = new DatabaseService(movedLibrary.database)
      try {
        expect(relocateManagedPaths(movedDatabase.db, movedRoot)).toBe(3)
        const movedAssets = new AssetRepository(movedDatabase.db, (path) => path)
        expect(movedAssets.stats()).toMatchObject({ total: 3, favorites: 1 })
        expect(new FolderRepository(movedDatabase.db).list().find((folder) => folder.name === '秋冬')?.assetCount).toBe(3)
        expect(new FolderRepository(movedDatabase.db).list().find((folder) => folder.name === '背包')?.assetCount).toBe(2)
        expect(new TagRepository(movedDatabase.db).list().find((tag) => tag.name === '参考')?.assetCount).toBe(1)
        for (const asset of movedAssets.list({ limit: 20 }).items) {
          expect(movedAssets.getFilePath(asset.id)?.startsWith(movedLibrary.originals)).toBe(true)
          expect(existsSync(movedAssets.getFilePath(asset.id)!)).toBe(true)
          expect(existsSync(asset.thumbnailUrl)).toBe(true)
        }
      } finally { movedDatabase.close() }
    } finally { sourceDatabase.close() }
  }, 30_000)

  it('repeatedly merges two evolving Libraries without duplicating the same image', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'muse-merge-'))
    cleanup.push(workspace)
    const inputRoot = join(workspace, 'inputs')
    await mkdir(inputRoot, { recursive: true })
    const shared = join(inputRoot, 'shared.jpg')
    const sharedCopy = join(inputRoot, 'shared-copy.jpg')
    const homeOnly = join(inputRoot, 'home-only.jpg')
    const officeOnly = join(inputRoot, 'office-only.jpg')
    await sharp({ create: { width: 420, height: 520, channels: 3, background: '#764ba2' } }).jpeg().toFile(shared)
    await copyFile(shared, sharedCopy)
    await sharp({ create: { width: 430, height: 530, channels: 3, background: '#2c7a7b' } }).jpeg().toFile(homeOnly)
    await sharp({ create: { width: 440, height: 540, channels: 3, background: '#b7791f' } }).jpeg().toFile(officeOnly)

    const homeLibrary = ensureLibrary(join(workspace, 'home', 'Muse Library'))
    const officeLibrary = ensureLibrary(join(workspace, 'office', 'Muse Library'))
    const homeDatabase = new DatabaseService(homeLibrary.database)
    const officeDatabase = new DatabaseService(officeLibrary.database)
    try {
      const homeAssets = new AssetRepository(homeDatabase.db, (path) => path)
      const officeAssets = new AssetRepository(officeDatabase.db, (path) => path)
      const homeImported = await new AssetImporter(homeLibrary, homeAssets).import([shared, homeOnly])
      const officeImported = await new AssetImporter(officeLibrary, officeAssets).import([sharedCopy, officeOnly])
      expect(homeImported.imported).toHaveLength(2)
      expect(officeImported.imported).toHaveLength(2)

      const sharedHome = homeImported.imported[0]!
      const homeFolder = new FolderRepository(homeDatabase.db).create('家里精选')
      homeAssets.attachToFolder([sharedHome.id], homeFolder.id)
      const homeTag = new TagRepository(homeDatabase.db).create('待整理')
      new TagRepository(homeDatabase.db).attach([sharedHome.id], homeTag.id)
      homeAssets.toggleFavorite(sharedHome.id)
      const analyzedAt = new Date().toISOString()
      homeDatabase.db.prepare(`INSERT INTO asset_ai_analysis (asset_id,status,schema_version,description,analyzed_at,updated_at,retry_count,result_version)
        VALUES (?,'completed',1,?,?,?,0,2)`).run(sharedHome.id, '家里电脑已完成的图片分析', analyzedAt, analyzedAt)
      new AssetSourceRepository(homeDatabase.db).add(sharedHome.id, {
        pageUrl: 'https://example.com/post/1', imageUrl: 'https://cdn.example.com/photo.jpg',
        pageTitle: '来源页面', collectedAt: analyzedAt, extensionVersion: 'test'
      })

      const transfer = new LibraryTransferService(officeDatabase.db, officeLibrary, 'test')
      const first = await transfer.mergeFrom(homeLibrary.root)
      expect(first).toMatchObject({ addedAssetCount: 1, duplicateAssetCount: 1, addedFolderCount: 1, addedTagCount: 1, failureCount: 0 })
      expect(existsSync(first.safetyBackupPath)).toBe(true)
      expect(officeAssets.stats()).toMatchObject({ total: 3, favorites: 1 })
      expect(new FolderRepository(officeDatabase.db).list().find((folder) => folder.name === '家里精选')?.assetCount).toBe(1)
      expect(new TagRepository(officeDatabase.db).list().find((tag) => tag.name === '待整理')?.assetCount).toBe(1)
      const sharedOfficeId = officeImported.imported[0]!.id
      expect(officeAssets.get(sharedOfficeId)?.ai?.description).toBe('家里电脑已完成的图片分析')
      expect(new AssetSourceRepository(officeDatabase.db).list(sharedOfficeId)).toHaveLength(1)

      const second = await transfer.mergeFrom(homeLibrary.root)
      expect(second).toMatchObject({ addedAssetCount: 0, duplicateAssetCount: 2, addedFolderCount: 0, addedTagCount: 0, failureCount: 0 })
      expect(officeAssets.stats().total).toBe(3)
      expect(new FolderRepository(officeDatabase.db).list().filter((folder) => folder.name === '家里精选')).toHaveLength(1)
      expect(new TagRepository(officeDatabase.db).list().filter((tag) => tag.name === '待整理')).toHaveLength(1)
      for (const asset of officeAssets.list({ limit: 20 }).items) {
        expect(officeAssets.getFilePath(asset.id)?.startsWith(officeLibrary.originals)).toBe(true)
        expect(existsSync(officeAssets.getFilePath(asset.id)!)).toBe(true)
      }
    } finally {
      homeDatabase.close()
      officeDatabase.close()
    }
  }, 30_000)
})
