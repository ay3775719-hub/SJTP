import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { AssetSourceRepository } from './repositories/AssetSourceRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'
import { WebCollectorService } from '../services/webCollector/WebCollectorService'
import { WebImageDownloader } from '../services/webCollector/WebImageDownloader'
import type { WebCollectPayload } from '@shared/types/domain'
import { SmartCollectionQueryBuilder } from '../services/smartCollections/SmartCollectionQueryBuilder'

describe('Web Collector ingestion and provenance', () => {
  const databases: DatabaseService[] = []
  afterEach(() => databases.splice(0).forEach((database) => database.close()))

  it('uses ImportService, merges exact content, keeps multiple sources, filters them, and cascades cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-web-collector-')), library = ensureLibrary(root)
    const database = new DatabaseService(library.database); databases.push(database)
    const assets = new AssetRepository(database.db, (path) => path), sources = new AssetSourceRepository(database.db)
    const sourceImage = join(root, 'fixture.png')
    await sharp({ create: { width: 96, height: 72, channels: 3, background: '#58c891' } }).png().toFile(sourceImage)
    const bytes = await readFile(sourceImage), hash = createHash('sha256').update(bytes).digest('hex')
    let downloadNumber = 0, importedIds: string[] = []
    const downloader = { download: async () => {
      const path = join(library.cache, `download-${++downloadNumber}.png`); await writeFile(path, bytes)
      return { path, hash, filename: 'same-name.png', size: bytes.length, mimeType: 'image/png' }
    } } as unknown as WebImageDownloader
    const importer = new AssetImporter(library, assets, (ids) => { importedIds = [...importedIds, ...ids] })
    const collector = new WebCollectorService(downloader, importer, assets, sources, () => undefined)
    const first = payload('https://example.com/project/a', 'https://cdn.example.com/a.png')

    const saved = await collector.collect('00000000-0000-4000-8000-000000000001', first)
    expect(saved.status).toBe('saved')
    expect(assets.stats().total).toBe(1)
    expect(sources.list(saved.assetId!)).toHaveLength(1)
    expect(importedIds).toEqual([saved.assetId])

    const repeated = await collector.collect('00000000-0000-4000-8000-000000000002', first)
    expect(repeated.status).toBe('already_collected')
    expect(assets.stats().total).toBe(1)
    expect(sources.list(saved.assetId!)).toHaveLength(1)

    const secondPage = await collector.collect('00000000-0000-4000-8000-000000000003', payload('https://portfolio.test/work/2', 'https://images.portfolio.test/x.png'))
    expect(secondPage.status).toBe('existing_asset_source_added')
    expect(assets.stats().total).toBe(1)
    expect(sources.list(saved.assetId!)).toHaveLength(2)
    expect(assets.list({ sourceTypes: ['web'] }).total).toBe(1)
    expect(assets.list({ sourceDomains: ['portfolio.test'] }).total).toBe(1)
    const sourceRule = new SmartCollectionQueryBuilder().build({
      name: 'Portfolio', matchMode: 'all',
      rules: [{ id: 'source-domain', field: 'sourceDomain', operator: 'equals', value: 'www.portfolio.test' }]
    })
    const sourceRuleCount = database.db.prepare(`SELECT COUNT(1) count FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id WHERE a.deleted_at IS NULL AND ${sourceRule.sql}`).get(sourceRule.params) as unknown as { count: number }
    expect(sourceRuleCount.count).toBe(1)

    assets.softDelete([saved.assetId!]); expect(sources.list(saved.assetId!)).toHaveLength(2)
    assets.restore([saved.assetId!]); expect(sources.list(saved.assetId!)).toHaveLength(2)
    database.db.prepare('DELETE FROM assets WHERE id=?').run(saved.assetId!)
    expect(sources.list(saved.assetId!)).toHaveLength(0)
  })

  it('accepts browser-fetched binary fallback and validates it through the same import pipeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-web-upload-')), library = ensureLibrary(root)
    const database = new DatabaseService(library.database); databases.push(database)
    const assets = new AssetRepository(database.db, (path) => path), sources = new AssetSourceRepository(database.db)
    const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#d9b49b' } }).jpeg({ quality: 82 }).toBuffer()
    const collector = new WebCollectorService(
      new WebImageDownloader(library.cache),
      new AssetImporter(library, assets, () => undefined),
      assets,
      sources,
      () => undefined
    )
    const result = await collector.collectBrowserUpload(
      '00000000-0000-4000-8000-000000000010',
      payload('https://example.com/pin/1', 'https://1.1.1.1/image.jpg'),
      bytes,
      'image/jpeg'
    )
    expect(result.status).toBe('saved')
    expect(assets.stats().total).toBe(1)
    expect(sources.list(result.assetId!)).toHaveLength(1)
  })
})

function payload(pageUrl: string, imageUrl: string): WebCollectPayload {
  return { pageUrl, imageUrl, pageTitle: 'Web project', siteName: 'Example', altText: 'green sample', collectedAt: new Date().toISOString(), extensionVersion: '0.1.0' }
}
