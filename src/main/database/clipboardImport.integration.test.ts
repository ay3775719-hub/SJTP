import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { FolderRepository } from './repositories/FolderRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'
import { ClipboardImportService, type ClipboardImageReader } from '../services/clipboard/ClipboardImportService'

describe('clipboard import through the real Library pipeline', () => {
  let root: string
  let database: DatabaseService
  beforeEach(async () => {
    sharp.cache(false)
    root = await mkdtemp(join(tmpdir(), 'muse-clipboard-test-'))
    database = new DatabaseService(ensureLibrary(root).database)
  })
  afterEach(async () => {
    database.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  afterAll(() => { sharp.cache(true) })
  const setup = (reader: ClipboardImageReader) => {
    const library = ensureLibrary(root)
    const assets = new AssetRepository(database.db, (path) => path)
    const service = new ClipboardImportService(reader, new AssetImporter(library, assets), library)
    return { library, assets, service }
  }

  it('persists pasted pixels, metadata, thumbnails, and the selected folder after restart', async () => {
    const png = await sharp({ create: { width: 320, height: 180, channels: 4, background: '#89abef80' } }).png().toBuffer()
    const { service, assets, library } = setup({ readImagePng: () => png, readImageFiles: async () => [] })
    const folder = new FolderRepository(database.db).create('粘贴测试')
    const result = await service.import(folder.id)
    expect(result.failures).toEqual([])
    expect(result.imported).toHaveLength(1)
    const asset = result.imported[0]!
    expect(asset).toMatchObject({ width: 320, height: 180, mimeType: 'image/png', importSource: 'clipboard' })
    expect(asset.filename).toMatch(/^粘贴图片_.*\.png$/)
    expect(await readFile(assets.getFilePath(asset.id)!)).toEqual(png)
    expect((await sharp(asset.thumbnailUrl).metadata()).width).toBeGreaterThan(0)
    expect(assets.list({ folderId: folder.id }).items[0]?.id).toBe(asset.id)
    expect(await readdir(library.cache)).toEqual([])
    database.close()
    database = new DatabaseService(library.database)
    expect(new AssetRepository(database.db, (path) => path).get(asset.id)?.importSource).toBe('clipboard')
  })

  it('imports copied files with original names and format instead of the clipboard bitmap', async () => {
    const paths = [join(root, '原始图片.png'), join(root, '第二张.webp')]
    await sharp({ create: { width: 120, height: 100, channels: 3, background: '#abcdef' } }).png().toFile(paths[0]!)
    await sharp({ create: { width: 140, height: 160, channels: 3, background: '#123456' } }).webp().toFile(paths[1]!)
    const { service, assets } = setup({ readImagePng: () => Buffer.from('unused bitmap'), readImageFiles: async () => paths })
    const result = await service.import()
    expect(result.imported.map((asset) => [asset.filename, asset.importSource])).toEqual([
      ['原始图片.png', 'clipboard'], ['第二张.webp', 'clipboard']
    ])
    expect(await readFile(assets.getFilePath(result.imported[1]!.id)!)).toEqual(await readFile(paths[1]!))
    expect(result.failures).toEqual([])
  })

  it('reports an empty clipboard and remains available for subsequent pastes', async () => {
    const { service, assets, library } = setup({ readImagePng: () => null, readImageFiles: async () => [] })
    await expect(service.import()).rejects.toThrow('剪贴板中没有图片')
    await expect(service.import()).rejects.toThrow('剪贴板中没有图片')
    expect(assets.stats().total).toBe(0)
    expect(await readdir(library.cache)).toEqual([])
  })

  it('cleans temporary images when decoding fails and allows a later valid paste', async () => {
    let png: Buffer = Buffer.from('invalid png')
    const { service, assets, library } = setup({ readImagePng: () => png, readImageFiles: async () => [] })
    expect((await service.import()).failures).toHaveLength(1)
    expect(await readdir(library.cache)).toEqual([])
    expect(await readdir(library.originals)).toEqual([])
    png = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#444444' } }).png().toBuffer()
    expect((await service.import()).imported).toHaveLength(1)
    expect(assets.stats().total).toBe(1)
    expect(await readdir(library.cache)).toEqual([])
  })
})
