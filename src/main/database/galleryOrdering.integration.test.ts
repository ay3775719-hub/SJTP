import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { SettingsRepository } from './repositories/SettingsRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Gallery capture ordering and alignment preference', () => {
  it('uses insertion order as the stable tie-breaker and defaults to aligned grid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-gallery-order-'))
    const input = await mkdtemp(join(tmpdir(), 'muse-gallery-order-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root)
    const database = new DatabaseService(library.database)
    try {
      const assets = new AssetRepository(database.db, (path) => path)
      const importer = new AssetImporter(library, assets)
      const paths = await Promise.all(['first', 'second', 'third'].map(async (name, index) => {
        const path = join(input, `${name}.png`)
        await sharp({ create: { width: 120, height: 160, channels: 3, background: { r: 50 + index * 30, g: 70, b: 90 } } }).png().toFile(path)
        return path
      }))
      const result = await importer.import(paths)
      expect(result.failures).toEqual([])
      const importedIds = result.imported.map((asset) => asset.id)
      database.db.prepare("UPDATE assets SET imported_at='2026-09-02T10:00:00.000Z'").run()

      expect(assets.list({ sort: 'imported-asc' }).items.map((asset) => asset.id)).toEqual(importedIds)
      expect(assets.list({ sort: 'imported-desc' }).items.map((asset) => asset.id)).toEqual([...importedIds].reverse())
      expect(new SettingsRepository(database.db).getPreferences().galleryView).toBe('grid')
    } finally {
      database.close()
    }
  }, 20_000)
})
