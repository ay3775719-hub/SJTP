import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../database/DatabaseService'
import { AssetRepository } from '../../database/repositories/AssetRepository'
import { EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import { FolderRepository } from '../../database/repositories/FolderRepository'
import { TagRepository } from '../../database/repositories/TagRepository'
import { SEMANTIC_SEARCH_MODEL, SemanticSearchModelManager } from './SemanticSearchModelManager'
import { SemanticSearchWorkerClient } from './SemanticSearchWorkerClient'
import { LocalSemanticSearchService } from './LocalSemanticSearchService'
import { SearchEntityResolver } from './SearchEntityResolver'
import { HybridSearchService } from './HybridSearchService'
import { join } from 'node:path'

const databasePath = process.env.MUSE_SEARCH_RECALL_DB, modelRoot = process.env.MUSE_SEMANTIC_MODEL_ROOT
describe.skipIf(!databasePath || !modelRoot)('Hybrid search real-library recall', () => {
  let database: DatabaseService, semantic: LocalSemanticSearchService, hybrid: HybridSearchService
  beforeAll(async () => {
    database = new DatabaseService(databasePath!)
    const assets = new AssetRepository(database.db, (path) => path), folders = new FolderRepository(database.db), tags = new TagRepository(database.db)
    const repository = new EmbeddingRepository(database.db, { providerId: SEMANTIC_SEARCH_MODEL.providerId, modelId: SEMANTIC_SEARCH_MODEL.modelId, modelVersion: SEMANTIC_SEARCH_MODEL.modelVersion, dimension: SEMANTIC_SEARCH_MODEL.dimension })
    semantic = new LocalSemanticSearchService(repository, new SemanticSearchModelManager(modelRoot!), new SemanticSearchWorkerClient({ modelsRoot: modelRoot!, localModelId: SEMANTIC_SEARCH_MODEL.localModelId, dimension: SEMANTIC_SEARCH_MODEL.dimension, workerPath: join(process.cwd(), 'out/main/workers/semanticSearchWorker.js') }))
    hybrid = new HybridSearchService(assets, new SearchEntityResolver(() => folders.list(), () => tags.list()), semantic)
    await semantic.initialize()
  }, 120_000)
  afterAll(async () => { await semantic?.dispose(); database?.close() }, 30_000)

  it('separates previews from complete result sets and recalls unanalyzed people', async () => {
    const backpack = await hybrid.create({ naturalSearch: { field: 'object', operator: 'equals', value: 'backpack' } }, 3)
    const backpackFreeText = await hybrid.create({ naturalSearch: { field: 'freeText', operator: 'contains', value: '背包' } }, 3)
    const backpackTopSearch = await hybrid.create({ search: '背包' }, 3)
    expect(backpack.previewCount).toBe(3); expect(backpack.totalCount).toBe(12)
    expect(backpackFreeText.totalCount).toBe(12); expect(backpackTopSearch.totalCount).toBe(12)
    expect(hybrid.page(backpack.id, '0', 3).total).toBe(backpack.totalCount)
    const people = await hybrid.create({ naturalSearch: { field: 'freeText', operator: 'contains', value: '人物' } }, 3)
    // The user's live Library grows over time; the original nine person
    // positives must remain present, while newly imported people may increase
    // the count.
    expect(people.totalCount).toBeGreaterThanOrEqual(9)
    const page = hybrid.page(people.id, '0', 50)
    expect(page.items.filter((asset) => asset.ai?.status !== 'completed').length).toBeGreaterThanOrEqual(5)
    const motorcycle = await hybrid.create({ naturalSearch: { field: 'freeText', operator: 'contains', value: '摩托车' } }, 3)
    expect(motorcycle.totalCount).toBe(0)
    const woman = await hybrid.create({ naturalSearch: { field: 'freeText', operator: 'contains', value: '女人' } }, 3)
    const greenBackpack = await hybrid.create({ naturalSearch: { operator: 'and', children: [{ field: 'object', operator: 'equals', value: 'backpack' }, { field: 'color', operator: 'near', value: 'green' }] } }, 3)
    expect(greenBackpack.totalCount).toBeGreaterThan(0)
    const outdoorBackpack = await hybrid.create({ naturalSearch: { operator: 'and', children: [{ field: 'object', operator: 'equals', value: 'backpack' }, { field: 'scene', operator: 'equals', value: 'outdoor' }] } }, 3)
    console.log('SEARCH_RECALL_REAL', JSON.stringify({ backpack: { total: backpack.totalCount, freeText: backpackFreeText.totalCount, topSearch: backpackTopSearch.totalCount, coverage: backpack.coverage }, people: { total: people.totalCount, coverage: people.coverage, unanalyzed: page.items.filter((asset) => asset.ai?.status !== 'completed').length }, woman: woman.totalCount, greenBackpack: greenBackpack.totalCount, outdoorBackpack: outdoorBackpack.totalCount, motorcycle: motorcycle.totalCount }))
  }, 120_000)
})
