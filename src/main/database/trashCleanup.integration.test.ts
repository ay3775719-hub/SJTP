import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'
import { TrashService } from '../services/assets/TrashService'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Trash cleanup', () => {
  it('permanently removes only trashed assets and their managed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-trash-library-'))
    const input = await mkdtemp(join(tmpdir(), 'muse-trash-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root)
    const database = new DatabaseService(library.database)
    const assets = new AssetRepository(database.db, (path) => path)
    const importer = new AssetImporter(library, assets)

    try {
      const paths = await Promise.all([0, 1].map(async (index) => {
        const path = join(input, `asset-${index}.png`)
        await sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 50 + index * 100, g: 80, b: 120 } } }).png().toFile(path)
        return path
      }))
      const imported = await importer.import(paths)
      expect(imported.failures).toEqual([])
      const trashed = imported.imported[0], retained = imported.imported[1]
      if (!trashed || !retained) throw new Error('Expected two imported assets')
      const trashedPath = assets.getFilePath(trashed.id)!
      const retainedPath = assets.getFilePath(retained.id)!
      const thumbnails = database.db.prepare('SELECT path FROM thumbnails WHERE asset_id=?').all(trashed.id) as unknown as Array<{ path: string }>
      assets.softDelete([trashed.id])

      const result = await new TrashService(database.db, library).empty()

      expect(result.deletedCount).toBe(1)
      expect(result.reclaimedBytes).toBeGreaterThan(0)
      expect(result.fileCleanupPending).toBe(false)
      expect(assets.stats()).toMatchObject({ total: 1, trash: 0 })
      expect(assets.get(trashed.id)).toBeNull()
      expect(existsSync(trashedPath)).toBe(false)
      expect(thumbnails.every((item) => !existsSync(item.path))).toBe(true)
      expect(assets.get(retained.id)?.id).toBe(retained.id)
      expect(existsSync(retainedPath)).toBe(true)
      expect((database.db.prepare('SELECT COUNT(*) count FROM assets_fts WHERE asset_id=?').get(trashed.id) as unknown as { count: number }).count).toBe(0)
    } finally { database.close() }
  }, 30_000)
})
