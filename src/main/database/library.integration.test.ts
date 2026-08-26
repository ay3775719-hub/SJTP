import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { FolderRepository } from './repositories/FolderRepository'
import { TagRepository } from './repositories/TagRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('real Library statistics and persistence', () => {
  it('passes acceptance A-G against SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-library-'))
    const input = await mkdtemp(join(tmpdir(), 'muse-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root)
    let database = new DatabaseService(library.database)
    let assets = new AssetRepository(database.db, (path) => path)
    const folders = new FolderRepository(database.db)
    const tags = new TagRepository(database.db)
    const importer = new AssetImporter(library, assets)

    try {
      expect(assets.stats()).toEqual({ total: 0, recentlyAdded: 0, recentlyOpened: 0, favorites: 0, trash: 0 })
      expect(assets.list().total).toBe(0)

    const paths = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const path = join(input, `asset-${index}.png`)
      await sharp({ create: { width: 320 + index, height: 220 + index * 2, channels: 3, background: { r: 70 + index * 8, g: 90 + index * 5, b: 110 + index * 3 } } }).png().toFile(path)
      return path
    }))
    const imported = await importer.import(paths)
    expect(imported.failures).toEqual([])
    expect(imported.imported).toHaveLength(10)
    expect(assets.stats().total).toBe(10)
    expect(assets.list().total).toBe(10)

    imported.imported.slice(0, 3).forEach((asset) => assets.toggleFavorite(asset.id))
    expect(assets.stats().favorites).toBe(3)
    expect(assets.list({ favorite: true }).total).toBe(3)

    const folder = folders.create('建筑')
    assets.attachToFolder(imported.imported.slice(0, 4).map((asset) => asset.id), folder.id)
    expect(folders.list().find((item) => item.id === folder.id)?.assetCount).toBe(4)
    expect(assets.list({ folderId: folder.id }).total).toBe(4)

    const targetFolder = folders.create('建筑精选')
    const retainedFolder = folders.create('多文件夹归属')
    const firstAsset = imported.imported[0]!
    const thirdAsset = imported.imported[2]!
    const movedAssetIds = imported.imported.slice(0, 2).map((asset) => asset.id)
    assets.attachToFolder([firstAsset.id], retainedFolder.id)
    assets.moveBetweenFolders(movedAssetIds, folder.id, targetFolder.id)
    expect(assets.list({ folderId: folder.id }).total).toBe(2)
    expect(assets.list({ folderId: targetFolder.id }).total).toBe(2)
    expect(assets.list({ folderId: retainedFolder.id }).total).toBe(1)

    expect(() => assets.moveBetweenFolders([thirdAsset.id], folder.id, 'missing-folder')).toThrow()
    expect(assets.list({ folderId: folder.id }).items.map((asset) => asset.id)).toContain(thirdAsset.id)

    const tag = tags.create('自然光')
    tags.attach(imported.imported.slice(0, 6).map((asset) => asset.id), tag.id)
    expect(tags.list().find((item) => item.id === tag.id)?.assetCount).toBe(6)
    expect(assets.list({ tagIds: [tag.id] }).total).toBe(6)

    assets.softDelete(imported.imported.slice(0, 2).map((asset) => asset.id))
    expect(assets.stats()).toMatchObject({ total: 8, trash: 2, favorites: 1 })
    expect(assets.list().total).toBe(8)
    expect(assets.list({ deleted: true }).total).toBe(2)

      database.close()
      database = new DatabaseService(library.database)
      assets = new AssetRepository(database.db, (path) => path)
      expect(assets.stats()).toMatchObject({ total: 8, trash: 2, favorites: 1 })
      expect(new FolderRepository(database.db).list().find((item) => item.name === '建筑')?.assetCount).toBe(2)
      expect(new TagRepository(database.db).list().find((item) => item.name === '自然光')?.assetCount).toBe(4)
      const reopenedFolders = new FolderRepository(database.db)
      const reopenedFolder = reopenedFolders.list().find((item) => item.name === '建筑')!
      reopenedFolders.rename(reopenedFolder.id, '建筑参考')
      expect(reopenedFolders.list().find((item) => item.id === reopenedFolder.id)?.name).toBe('建筑参考')
      reopenedFolders.remove(reopenedFolder.id)
      expect(reopenedFolders.list().find((item) => item.id === reopenedFolder.id)).toBeUndefined()
      expect(assets.stats()).toMatchObject({ total: 8, trash: 2 })
      expect(assets.list({ folderId: reopenedFolder.id }).total).toBe(0)
    } finally {
      try { database.close() } catch { /* already closed while reopening */ }
    }
  }, 30_000)
})
