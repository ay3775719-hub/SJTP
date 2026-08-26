import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { SmartCollectionRepository } from './repositories/SmartCollectionRepository'
import { CollectionSuggestionRepository } from './repositories/CollectionSuggestionRepository'
import { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import { CollectionSuggestionService } from '../services/smartCollections/CollectionSuggestionService'

const sourcePath = process.env.MUSE_REAL_LIBRARY_DB
const enabled = Boolean(sourcePath)

describe.skipIf(!enabled)('real Library collection suggestions', () => {
  let root = '', database: DatabaseService, suggestions: CollectionSuggestionService, collections: SmartCollectionService
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-real-suggestions-'))
    const target = join(root, 'muse.db')
    const source = new DatabaseSync(sourcePath!)
    source.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); source.close()
    database = new DatabaseService(target)
    const assets = new AssetRepository(database.db, (path) => `muse://local/${encodeURIComponent(path)}`)
    collections = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
    suggestions = new CollectionSuggestionService(new CollectionSuggestionRepository(database.db), assets, collections)
  })
  afterAll(async () => { database?.close(); if (root) await rm(root, { recursive: true, force: true }) })

  it('generates, creates, ignores and restores suggestions against a WAL-consistent copy', async () => {
    const result = suggestions.list()
    expect(result.items.length).toBeGreaterThan(0)
    await mkdir(join(process.cwd(), 'design-qa-artifacts'), { recursive: true })
    await writeFile(join(process.cwd(), 'design-qa-artifacts', 'collection-suggestions-real.json'), JSON.stringify({
      generatedAt: result.generatedAt, unAnalyzedCount: result.unAnalyzedCount,
      suggestions: result.items.map(({ previews, ...item }) => ({ ...item, previewFilenames: previews.map((asset) => asset.filename) }))
    }, null, 2), 'utf8')
    console.log(result.items.map((item) => `${item.name}: ${item.assetCount} (${item.ruleSignature})`).join('\n'))

    const first = result.items[0]!
    const created = suggestions.create(first.ruleSignature)
    expect(collections.list().find((item) => item.id === created.id)?.assetCount).toBe(first.assetCount)
    expect(suggestions.list().items.some((item) => item.ruleSignature === first.ruleSignature)).toBe(false)

    const second = suggestions.list().items[0]!
    suggestions.ignore(second.ruleSignature)
    database.close(); database = new DatabaseService(join(root, 'muse.db'))
    const assets = new AssetRepository(database.db, (path) => path)
    collections = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
    suggestions = new CollectionSuggestionService(new CollectionSuggestionRepository(database.db), assets, collections)
    expect(suggestions.list().items.some((item) => item.ruleSignature === second.ruleSignature)).toBe(false)
    suggestions.restore(second.ruleSignature)
    expect(suggestions.list().items.some((item) => item.ruleSignature === second.ruleSignature)).toBe(true)
  })
})
