import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { SmartCollectionRepository } from './repositories/SmartCollectionRepository'
import { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import { FolderRepository } from './repositories/FolderRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Smart Collection saved-query engine', () => {
  it('filters, updates dynamically, validates relations and persists rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-smart-library-')), input = await mkdtemp(join(tmpdir(), 'muse-smart-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root)
    let database = new DatabaseService(library.database)
    let assets = new AssetRepository(database.db, (path) => path)
    let repository = new SmartCollectionRepository(database.db)
    let service = new SmartCollectionService(repository, assets)
    const importer = new AssetImporter(library, assets)
    const paths = await Promise.all(Array.from({ length: 13 }, async (_, index) => { const path = join(input, `${index}.png`); await sharp({ create: { width: index < 8 ? 600 : 900, height: index < 8 ? 900 : 600, channels: 3, background: { r: 80 + index, g: 100, b: 130 } } }).png().toFile(path); return path }))
    const imported = await importer.import(paths)
    expect(imported.imported).toHaveLength(13)

    const png = service.create({ name: '全部 PNG', matchMode: 'all', rules: [{ id: nanoid(8), field: 'extension', operator: 'equals', value: 'png' }] })
    expect(png.assetCount).toBe(13)
    expect(service.listAssets(png.id, { limit: 5 }).total).toBe(13)
    expect(service.listAssets(png.id, { limit: 5 }).items).toHaveLength(5)
    const injection = service.create({ name: '安全查询', matchMode: 'all', rules: [{ id: nanoid(8), field: 'filename', operator: 'equals', value: "' OR 1=1 --" }] })
    expect(injection.assetCount).toBe(0)

    const portrait = service.create({ name: '竖版图片', matchMode: 'all', rules: [{ id: nanoid(8), field: 'orientation', operator: 'is', value: 'portrait' }] })
    expect(portrait.assetCount).toBe(8)

    const favoritePng = service.create({ name: '收藏 PNG', matchMode: 'all', rules: [{ id: nanoid(8), field: 'extension', operator: 'equals', value: 'png' }, { id: nanoid(8), field: 'favorite', operator: 'is', value: true }] })
    expect(favoritePng.assetCount).toBe(0)
    assets.toggleFavorite(imported.imported[0]!.id); assets.toggleFavorite(imported.imported[1]!.id)
    expect(service.list().find((item) => item.id === favoritePng.id)?.assetCount).toBe(2)

    const folders = new FolderRepository(database.db), backpack = folders.create('背包')
    assets.attachToFolder(imported.imported.map((asset) => asset.id), backpack.id)
    const backpackCollection = service.create({ name: '背包素材', matchMode: 'all', rules: [{ id: nanoid(8), field: 'folder', operator: 'is', value: backpack.id }] })
    expect(backpackCollection.assetCount).toBe(13)
    assets.detachFromFolder([imported.imported[0]!.id], backpack.id)
    expect(service.list().find((item) => item.id === backpackCollection.id)?.assetCount).toBe(12)

    const duplicate = service.duplicate(png.id)
    expect(duplicate).toMatchObject({ name: '全部 PNG 副本', matchMode: 'all', assetCount: 13 })
    expect(duplicate.rules.map(({ field, operator, value }) => ({ field, operator, value }))).toEqual(
      png.rules.map(({ field, operator, value }) => ({ field, operator, value }))
    )
    const editedDuplicate = service.update(duplicate.id, { name: '横版 PNG', matchMode: 'all', rules: [
      { id: nanoid(8), field: 'extension', operator: 'equals', value: 'png' },
      { id: nanoid(8), field: 'orientation', operator: 'is', value: 'landscape' }
    ] })
    expect(editedDuplicate.assetCount).toBe(5)
    service.remove(duplicate.id)
    expect(assets.stats().total).toBe(13)

    database.close(); database = new DatabaseService(library.database); assets = new AssetRepository(database.db, (path) => path); repository = new SmartCollectionRepository(database.db); service = new SmartCollectionService(repository, assets)
    const restored = service.list().find((item) => item.id === favoritePng.id)
    expect(restored).toMatchObject({ name: '收藏 PNG', matchMode: 'all', assetCount: 2 })
    expect(restored?.rules).toHaveLength(2)
    expect(service.list().map((item) => item.id).slice(0, 4)).toEqual([png.id, injection.id, portrait.id, favoritePng.id])
    new FolderRepository(database.db).remove(backpack.id)
    expect(service.list().find((item) => item.id === backpackCollection.id)?.invalidRuleIds).toHaveLength(1)
    expect(service.listAssets(backpackCollection.id, {}).total).toBe(0)
    service.remove(png.id)
    expect(assets.stats().total).toBe(13)
    database.close()
  }, 30_000)
})
