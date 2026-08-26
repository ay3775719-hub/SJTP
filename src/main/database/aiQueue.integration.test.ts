import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { AIAnalysisRepository } from './repositories/AIAnalysisRepository'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { AssetImporter } from '../services/assets/AssetImporter'
import { AIAnalysisQueue } from '../services/ai/AIAnalysisQueue'
import type { AIProvider, AnalyzeImageInput, AnalyzeOptions } from '../services/ai/AIProvider'
import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIJobProviderSnapshot } from '@shared/types/domain'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('persistent AI analysis queue', () => {
  it('bounds concurrency and persists completed provider results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-ai-queue-')), input = await mkdtemp(join(tmpdir(), 'muse-ai-queue-input-'))
    cleanup.push(root, input)
    const library = ensureLibrary(root), database = new DatabaseService(library.database), assets = new AssetRepository(database.db, (path) => path)
    const paths = await Promise.all(Array.from({ length: 5 }, async (_, index) => { const path = join(input, `${index}.png`); await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 50 + index * 10, g: 120, b: 80 } } }).png().toFile(path); return path }))
    const ids = (await new AssetImporter(library, assets).import(paths)).imported.map((asset) => asset.id)
    const provider = new TestProvider(), repository = new AIAnalysisRepository(database.db)
    const queue = new AIAnalysisQueue(repository, assets, () => provider, () => undefined)
    const snapshot: AIJobProviderSnapshot = { providerId: 'ollama', modelId: 'test-model', baseUrl: 'http://localhost:11434' }
    queue.setConcurrency(2); queue.enqueue(ids, snapshot)
    await waitFor(() => queue.status().completed === ids.length, 8_000)
    expect(provider.maximumActive).toBe(2)
    expect(queue.status()).toMatchObject({ queued: 0, analyzing: 0, completed: 5, failed: 0 })
    const persisted = database.db.prepare('SELECT provider_id,model_id,provider_config_json FROM ai_analysis_jobs LIMIT 1').get() as unknown as { provider_id: string; model_id: string; provider_config_json: string }
    expect(persisted).toMatchObject({ provider_id: 'ollama', model_id: 'test-model' })
    expect(JSON.parse(persisted.provider_config_json)).toEqual(snapshot)
    expect(ids.every((id) => assets.get(id)?.ai?.status === 'completed')).toBe(true)
    expect(repository.suggestions()).toContainEqual({ type: 'object', field: 'aiObject', value: '背包', normalizedValue: 'backpack', assetCount: 5 })
    database.close()
  }, 20_000)
})

class TestProvider implements AIProvider {
  readonly id = 'ollama' as const; active = 0; maximumActive = 0
  getInfo() { return { id: this.id, name: 'Test', kind: 'local' as const, defaultBaseUrl: null, requiresApiKey: false, recommendedConcurrency: 1, available: true } }
  async testConnection() { return { providerId: this.id, status: 'connected' as const, message: 'ok', checkedAt: new Date().toISOString(), models: await this.listModels() } }
  async listModels() { return [{ id: 'test-model', name: 'test-model', providerId: this.id, capabilities: { vision: true, structuredOutput: true, text: true, local: true }, capabilitySource: 'verified' as const }] }
  async analyzeImage(_input: AnalyzeImageInput, _options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    this.active += 1; this.maximumActive = Math.max(this.maximumActive, this.active)
    await new Promise((resolve) => setTimeout(resolve, 35)); this.active -= 1
    return { primaryObject: { value: '背包', normalizedValue: 'backpack', confidence: .9 }, primaryScene: { value: '户外', normalizedValue: 'outdoor', confidence: .9 }, primaryStyle: { value: '产品摄影', normalizedValue: 'product_photography', confidence: .9 }, description: '户外背包产品图片。' }
  }
}

async function waitFor(predicate: () => boolean, timeout: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for AI queue')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
