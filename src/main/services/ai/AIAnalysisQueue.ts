import { EventEmitter } from 'node:events'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AIJobProviderSnapshot, AIQueueStatus } from '@shared/types/domain'
import type { AIAnalysisRepository, QueuedAIJob } from '../../database/repositories/AIAnalysisRepository'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { AIProvider } from './AIProvider'
import { supportsBatchImages } from './AIProvider'
import { AIAnalysisPreviewService } from './AIAnalysisPreviewService'
import { normalizeAIAnalysis } from './normalizeAIAnalysis'
import { logger, serializeError } from '../../logger'
import { MuseError } from '../../errors'

export class AIAnalysisQueue {
  private readonly events = new EventEmitter()
  private readonly preview = new AIAnalysisPreviewService()
  private readonly active = new Map<string, AbortController>()
  private paused = false
  private pauseReason: AIQueueStatus['pauseReason'] = null
  private concurrency = 1

  constructor(
    private readonly repository: AIAnalysisRepository,
    private readonly assets: AssetRepository,
    private readonly providerFactory: (snapshot: AIJobProviderSnapshot) => AIProvider,
    private readonly onAssetChanged: (assetId: string) => void
  ) {
    const saved = this.repository.getQueuePause()
    this.paused = saved.paused
    this.pauseReason = saved.reason
  }

  setConcurrency(value: number): void { this.concurrency = Math.min(5, Math.max(1, Math.round(value))); this.kick() }
  onStatus(listener: (status: AIQueueStatus) => void): () => void { this.events.on('status', listener); return () => this.events.off('status', listener) }
  status(): AIQueueStatus { return this.repository.queueStatus(this.paused, this.pauseReason) }
  enqueue(assetIds: string[], snapshot: AIJobProviderSnapshot, force = false): void {
    this.repository.enqueue(assetIds, snapshot, force)
    assetIds.forEach(this.onAssetChanged); this.emitStatus(); this.kick()
  }
  pause(): void { this.paused = true; this.pauseReason = 'manual'; this.repository.saveQueuePause(true, this.pauseReason, this.status().providerId); this.emitStatus() }
  resume(): void { this.paused = false; this.pauseReason = null; this.repository.saveQueuePause(false, null); this.emitStatus(); this.kick() }
  cancel(assetIds: string[]): void { assetIds.forEach((id) => this.active.get(id)?.abort()); this.repository.cancel(assetIds); assetIds.forEach(this.onAssetChanged); this.emitStatus() }
  start(): void { this.kick() }

  private kick(): void {
    if (this.paused) return
    const available = Math.max(0, this.concurrency - this.active.size)
    if (!available) return
    const queued = this.repository.queuedJobs().filter((job) => !this.active.has(job.assetId))
    if (!queued.length) return
    const first = queued[0]!
    const provider = this.providerFactory(first.snapshot)
    if (supportsBatchImages(provider)) {
      const sameSnapshot = queued.filter((job) => sameProvider(job.snapshot, first.snapshot)).slice(0, 4)
      void this.runBatch(sameSnapshot, provider)
      return
    }
    queued.slice(0, available).forEach((job) => void this.run(job))
  }

  private async runBatch(jobs: QueuedAIJob[], provider: AIProvider & Required<Pick<AIProvider, 'analyzeImageBatch'>>): Promise<void> {
    const controller = new AbortController()
    const assetIds = jobs.map((job) => job.assetId)
    const snapshot = jobs[0]!.snapshot
    assetIds.forEach((id) => this.active.set(id, controller))
    const attempts = new Map(assetIds.map((id) => [id, this.repository.markAnalyzing(id)]))
    assetIds.forEach(this.onAssetChanged); this.emitStatus()
    const previewDirectory = join(tmpdir(), 'muse-ai-analysis', `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      const inputs = await Promise.all(assetIds.map(async (assetId) => {
        const path = this.assets.getFilePath(assetId)
        if (!path) throw new MuseError('ASSET_NOT_FOUND', `找不到待分析素材 ${assetId}`)
        return { assetId, localImagePath: await this.preview.createFile(path, previewDirectory, assetId) }
      }))
      const batch = await provider.analyzeImageBatch(inputs, { modelId: snapshot.modelId, signal: controller.signal })
      const completed = new Set<string>()
      batch.results.forEach(({ assetId, result }) => {
        if (!assetIds.includes(assetId) || completed.has(assetId) || controller.signal.aborted) return
        this.repository.complete(assetId, snapshot.providerId, batch.actualModelId, normalizeAIAnalysis(result), batch.promptVersion)
        completed.add(assetId)
      })
      const missing = assetIds.filter((id) => !completed.has(id))
      missing.forEach((id) => this.repository.fail(id, 'Codex batch missing or invalid result for this asset', (attempts.get(id) ?? 1) < 3))
      if (missing.length) logger.warn('Codex batch partial result', { completed: [...completed], missing, threadId: batch.threadId })
    } catch (error) {
      if (controller.signal.aborted) this.repository.cancel(assetIds)
      else if (error instanceof MuseError && (error.code === 'CODEX_USAGE_LIMIT' || error.code === 'CODEX_AUTH_REQUIRED' || error.code === 'CODEX_APP_SERVER_CRASH')) {
        this.repository.defer(assetIds, error.message)
        this.paused = true
        this.pauseReason = error.code === 'CODEX_USAGE_LIMIT' ? 'usage_limit' : error.code === 'CODEX_AUTH_REQUIRED' ? 'auth_required' : 'service_unavailable'
        this.repository.saveQueuePause(true, this.pauseReason, snapshot.providerId)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        assetIds.forEach((id) => this.repository.fail(id, message, (attempts.get(id) ?? 1) < 3))
        logger.warn('AI batch analysis failed', { assetIds, providerId: snapshot.providerId, modelId: snapshot.modelId, error: serializeError(error) })
      }
    } finally {
      await rm(previewDirectory, { recursive: true, force: true }).catch(() => undefined)
      assetIds.forEach((id) => { this.active.delete(id); this.onAssetChanged(id) })
      this.emitStatus(); this.kick()
    }
  }

  private async run(job: QueuedAIJob): Promise<void> {
    const { assetId, snapshot } = job
    const controller = new AbortController()
    this.active.set(assetId, controller)
    const attempts = this.repository.markAnalyzing(assetId)
    this.onAssetChanged(assetId); this.emitStatus()
    try {
      const path = this.assets.getFilePath(assetId)
      if (!path) throw new MuseError('ASSET_NOT_FOUND', '找不到待分析的素材文件')
      const provider = this.providerFactory(snapshot)
      const preview = await this.preview.createDataUrl(path)
      const raw = await provider.analyzeImage({ assetId, dataUrl: preview.dataUrl, mimeType: preview.mimeType, signal: controller.signal }, { modelId: snapshot.modelId })
      this.repository.complete(assetId, snapshot.providerId, snapshot.modelId, normalizeAIAnalysis(raw))
    } catch (error) {
      if (controller.signal.aborted) this.repository.cancel([assetId])
      else {
        const message = error instanceof Error ? error.message : String(error)
        const retryable = !(error instanceof MuseError) || error.code === 'AI_RETRYABLE'
        this.repository.fail(assetId, message, false)
        logger.warn('AI analysis failed', { assetId, providerId: snapshot.providerId, modelId: snapshot.modelId, attempts, error: serializeError(error) })
        if (retryable && attempts < 3) {
          const delay = 800 * (2 ** (attempts - 1))
          setTimeout(() => { this.repository.enqueue([assetId], snapshot); this.onAssetChanged(assetId); this.emitStatus(); this.kick() }, delay)
        }
      }
    } finally {
      this.active.delete(assetId); this.onAssetChanged(assetId); this.emitStatus(); this.kick()
    }
  }
  private emitStatus(): void { this.events.emit('status', this.status()) }
}

function sameProvider(left: AIJobProviderSnapshot, right: AIJobProviderSnapshot): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId && left.baseUrl === right.baseUrl
}
