import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { FolderRepository } from './repositories/FolderRepository'
import { TagRepository } from './repositories/TagRepository'
import { AssetImporter } from '../services/assets/AssetImporter'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { LibraryTransferService, relocateManagedPaths, validateExistingLibrary } from '../services/filesystem/LibraryTransferService'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Library backup and computer migration', () => {
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
})
