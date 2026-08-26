import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import type { SettingsRepository } from '../../database/repositories/SettingsRepository'
import type { VisualIndexStatus, VisualSimilarityResult } from '@shared/types/domain'
import { MuseError } from '../../errors'
import { EmbeddingModelManager, BUILTIN_EMBEDDING_MODEL } from './EmbeddingModelManager'
import { EmbeddingWorkerClient } from './EmbeddingWorkerClient'
import { EmbeddingQueue } from './EmbeddingQueue'

export class VisualEmbeddingService {
  readonly queue: EmbeddingQueue
  private modelState: VisualIndexStatus['modelState'] = 'not_installed'
  private preparingProgress: number | null = null
  private lastError: string | null = null
  private initialized = false
  private readonly listeners = new Set<(status: VisualIndexStatus) => void>()

  constructor(
    private readonly repository: EmbeddingRepository,
    private readonly assets: AssetRepository,
    private readonly settings: SettingsRepository,
    private readonly modelManager: EmbeddingModelManager,
    private readonly worker: EmbeddingWorkerClient
  ) {
    this.queue = new EmbeddingQueue(repository, worker, () => this.emit())
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    this.modelState = await this.modelManager.initialize() ? 'ready' : 'not_installed'
    if (this.modelState === 'ready') { await this.worker.initialize(); await this.queue.start() }
    this.emit()
  }

  status(): VisualIndexStatus {
    const counts = this.repository.counts(), preferences = this.settings.getVisualIndexPreferences()
    return {
      modelState: this.modelState, modelId: BUILTIN_EMBEDDING_MODEL.modelId, modelVersion: BUILTIN_EMBEDDING_MODEL.modelVersion,
      modelName: BUILTIN_EMBEDDING_MODEL.name, modelBytes: BUILTIN_EMBEDDING_MODEL.bytes, embeddingDimension: BUILTIN_EMBEDDING_MODEL.dimension,
      autoIndexOnImport: preferences.autoIndexOnImport, paused: this.queue.isPaused(), ...counts,
      preparingProgress: this.preparingProgress, lastError: this.lastError
    }
  }

  onStatus(listener: (status: VisualIndexStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async prepare(): Promise<VisualIndexStatus> {
    if (this.modelState === 'ready') return this.status()
    this.modelState = 'preparing'; this.preparingProgress = 0; this.lastError = null; this.emit()
    try {
      await this.modelManager.prepare((progress) => { this.preparingProgress = progress; this.emit() })
      await this.worker.initialize()
      this.modelState = 'ready'; this.preparingProgress = null
      await this.queue.start()
      this.emit()
      return this.status()
    } catch (error) {
      this.modelState = 'failed'; this.preparingProgress = null; this.lastError = error instanceof Error ? error.message : String(error); this.emit(); throw error
    }
  }

  async findSimilar(sourceAssetId: string, limit = 100, minimumScore?: number): Promise<VisualSimilarityResult> {
    if (this.modelState !== 'ready') throw new MuseError('MODEL_NOT_INSTALLED', '首次使用需要准备本地视觉模型')
    const source = this.assets.get(sourceAssetId)
    if (!source) throw new MuseError('ASSET_NOT_FOUND', '找不到要查询的素材')
    await this.queue.ensure(sourceAssetId)
    const result = await this.worker.search(sourceAssetId, limit, minimumScore)
    const orderedAssets = this.assets.getMany(result.results.map((item) => item.assetId))
    const scores = new Map(result.results.map((item) => [item.assetId, item.score]))
    const counts = this.repository.counts()
    return {
      source,
      results: orderedAssets.map((asset) => { const score = scores.get(asset.id) ?? -1; return { asset, score, tier: tierFor(score) } }),
      indexedCount: result.indexedCount, totalEligible: counts.totalEligible,
      pendingCount: Math.max(0, counts.totalEligible - counts.completed), searchMs: result.searchMs
    }
  }

  async onAssetsImported(assetIds: string[]): Promise<void> {
    if (this.modelState !== 'ready' || !this.settings.getVisualIndexPreferences().autoIndexOnImport) return
    await this.queue.enqueueImported(assetIds)
  }

  setAutoIndexOnImport(value: boolean): VisualIndexStatus { this.settings.updateVisualIndexPreferences({ autoIndexOnImport: value }); this.emit(); return this.status() }
  pause(): VisualIndexStatus { this.queue.pause(); return this.status() }
  resume(): VisualIndexStatus { this.queue.resume(); return this.status() }
  async rebuild(): Promise<VisualIndexStatus> { this.repository.resetAll(); await this.queue.force(this.repository.listCandidates().map((asset) => asset.id)); return this.status() }
  async regenerate(assetIds: string[]): Promise<VisualIndexStatus> { await this.queue.force(assetIds); return this.status() }
  async dispose(): Promise<void> { await this.worker.dispose() }

  private emit(): void { const status = this.status(); this.listeners.forEach((listener) => listener(status)) }
}

function tierFor(score: number): 'very_similar' | 'similar' | 'related' {
  if (score >= 0.82) return 'very_similar'
  if (score >= 0.65) return 'similar'
  return 'related'
}
