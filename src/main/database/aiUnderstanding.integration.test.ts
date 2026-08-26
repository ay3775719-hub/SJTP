import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { AIAnalysisRepository } from './repositories/AIAnalysisRepository'
import { SmartCollectionRepository } from './repositories/SmartCollectionRepository'
import { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'
import { aiAnalysisResultSchema } from '@shared/schemas/ai'
import { normalizeAIAnalysis } from '../services/ai/normalizeAIAnalysis'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('AI Asset Understanding persistence and querying', () => {
  it('persists validated analysis, preserves manual removals, and powers search + Smart Collections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-ai-library-')), input = await mkdtemp(join(tmpdir(), 'muse-ai-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root), image = join(input, 'green-backpack.png')
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 100, g: 145, b: 104 } } }).png().toFile(image)
    let database = new DatabaseService(library.database)
    let assets = new AssetRepository(database.db, (path) => path)
    const imported = await new AssetImporter(library, assets).import([image])
    const assetId = imported.imported[0]!.id
    const ai = new AIAnalysisRepository(database.db)
    ai.enqueue([assetId]); expect(ai.markAnalyzing(assetId)).toBe(1)
    const result = aiAnalysisResultSchema.parse({
      primaryObject: { value: '户外背包', normalizedValue: 'backpack', confidence: .98 },
      primaryScene: { value: '户外', normalizedValue: 'outdoor', confidence: .95 },
      primaryStyle: { value: '产品摄影', normalizedValue: 'product_photography', confidence: .93 },
      description: '绿色背包在户外环境中的产品展示图。'
    })
    ai.complete(assetId, 'test-provider', 'test-model', normalizeAIAnalysis(result))
    expect(assets.get(assetId)?.ai).toMatchObject({ status: 'completed', provider: 'test-provider', objects: ['背包'], scene: ['户外'], resultVersion: 2 })
    expect(assets.list({ search: '背包' }).total).toBe(1)

    const smart = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
    const outdoorBackpack = smart.create({ name: '户外背包', matchMode: 'all', rules: [
      { id: nanoid(8), field: 'aiObject', operator: 'contains', value: '背包' },
      { id: nanoid(8), field: 'aiScene', operator: 'contains', value: '户外' }
    ] })
    expect(outdoorBackpack.assetCount).toBe(1)

    ai.removeTerm(assetId, 'object', '背包')
    expect(smart.listAssets(outdoorBackpack.id, {}).total).toBe(0)
    ai.complete(assetId, 'test-provider', 'test-model', normalizeAIAnalysis(result))
    expect(assets.get(assetId)?.ai?.objects).toEqual([])
    expect(smart.listAssets(outdoorBackpack.id, {}).total).toBe(0)
    ai.addManualTerm(assetId, 'object', '背包')
    expect(smart.listAssets(outdoorBackpack.id, {}).total).toBe(1)
    expect(assets.get(assetId)?.colorAnalysis).toMatchObject({ temperature: expect.any(String), brightness: expect.any(Number) })
    expect(assets.get(assetId)?.colors.length).toBeGreaterThanOrEqual(1)

    database.close(); database = new DatabaseService(library.database); assets = new AssetRepository(database.db, (path) => path)
    expect(assets.get(assetId)?.ai).toMatchObject({ status: 'completed', description: result.description })
    expect(new SmartCollectionService(new SmartCollectionRepository(database.db), assets).listAssets(outdoorBackpack.id, {}).total).toBe(1)
    database.close()
  }, 30_000)
})
