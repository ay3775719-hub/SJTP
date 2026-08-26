import { stat } from 'node:fs/promises'
import type { EmbeddingCandidate, EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import type { EmbeddingWorkerClient } from './EmbeddingWorkerClient'
import { MuseError } from '../../errors'
import { logger, serializeError } from '../../logger'

interface Waiter { resolve(): void; reject(error: unknown): void }

export class EmbeddingQueue {
  private readonly pending: string[] = []
  private readonly pendingSet = new Set<string>()
  private readonly waiters = new Map<string, Waiter[]>()
  private running = false
  private activeId: string | null = null
  private paused = false

  constructor(
    private readonly repository: EmbeddingRepository,
    private readonly worker: EmbeddingWorkerClient,
    private readonly onChanged: () => void
  ) {}

  isPaused(): boolean { return this.paused }

  async start(): Promise<void> {
    await this.scan()
    this.kick()
  }

  async enqueueImported(assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) await this.enqueue(assetId, false, false)
    this.kick()
  }

  async ensure(assetId: string): Promise<void> {
    const candidate = this.repository.getCandidate(assetId)
    if (!candidate || candidate.deletedAt) throw new MuseError('ASSET_NOT_FOUND', '素材不存在或已在回收站')
    const fingerprint = await fingerprintFor(candidate)
    if (candidate.status === 'completed' && candidate.sourceFingerprint === fingerprint) return
    const promise = new Promise<void>((resolve, reject) => {
      const current = this.waiters.get(assetId) ?? []
      current.push({ resolve, reject })
      this.waiters.set(assetId, current)
    })
    await this.enqueue(assetId, true, false)
    this.kick()
    return promise
  }

  async force(assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) await this.enqueue(assetId, true, true)
    this.kick()
  }

  pause(): void { this.paused = true; this.onChanged() }
  resume(): void { this.paused = false; this.onChanged(); this.kick() }

  private async scan(): Promise<void> {
    const candidates = this.repository.listCandidates()
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      if (!candidate) continue
      try {
        const fingerprint = await fingerprintFor(candidate)
        const changed = candidate.sourceFingerprint !== null && candidate.sourceFingerprint !== fingerprint
        if (changed && candidate.status === 'completed') this.repository.markStale(candidate.id)
        if (!candidate.status || candidate.status === 'not_generated' || candidate.status === 'queued' || candidate.status === 'generating' || candidate.status === 'stale' || changed) {
          await this.enqueue(candidate.id, false, false, fingerprint)
        }
      } catch (error) { logger.warn('Visual index fingerprint failed', { assetId: candidate.id, error: serializeError(error) }) }
      if (index > 0 && index % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    this.onChanged()
  }

  private async enqueue(assetId: string, priority: boolean, force: boolean, knownFingerprint?: string): Promise<void> {
    const candidate = this.repository.getCandidate(assetId)
    if (!candidate || candidate.deletedAt) return
    const fingerprint = knownFingerprint ?? await fingerprintFor(candidate)
    if (!force && candidate.status === 'completed' && candidate.sourceFingerprint === fingerprint) return
    this.repository.queue(assetId, fingerprint)
    if (!this.pendingSet.has(assetId) && this.activeId !== assetId) {
      priority ? this.pending.unshift(assetId) : this.pending.push(assetId)
      this.pendingSet.add(assetId)
    } else if (priority && this.pendingSet.has(assetId)) {
      const index = this.pending.indexOf(assetId)
      if (index > 0) { this.pending.splice(index, 1); this.pending.unshift(assetId) }
    }
    this.onChanged()
  }

  private kick(): void {
    if (this.running || this.paused) return
    this.running = true
    void this.run().finally(() => { this.running = false; if (!this.paused && this.pending.length) this.kick() })
  }

  private async run(): Promise<void> {
    while (!this.paused) {
      const assetId = this.pending.shift()
      if (!assetId) break
      this.pendingSet.delete(assetId)
      const candidate = this.repository.getCandidate(assetId)
      if (!candidate || candidate.deletedAt) { this.resolve(assetId); continue }
      this.activeId = assetId
      try {
        const fingerprint = await fingerprintFor(candidate)
        if (candidate.sourceFingerprint !== fingerprint) this.repository.queue(assetId, fingerprint)
        this.repository.markGenerating(assetId)
        this.onChanged()
        const { vector, inferenceMs } = await this.worker.embed(candidate.path)
        this.repository.save(assetId, fingerprint, vector)
        logger.info('Visual embedding generated', { assetId, inferenceMs: Math.round(inferenceMs) })
        this.resolve(assetId)
      } catch (error) {
        const normalized = normalizeError(error)
        this.repository.markFailed(assetId, normalized.code, normalized.message)
        logger.warn('Visual embedding failed', { assetId, error: serializeError(error) })
        this.reject(assetId, error)
      } finally {
        this.activeId = null
        this.onChanged()
      }
    }
  }

  private resolve(assetId: string): void { this.waiters.get(assetId)?.forEach((waiter) => waiter.resolve()); this.waiters.delete(assetId) }
  private reject(assetId: string, error: unknown): void { this.waiters.get(assetId)?.forEach((waiter) => waiter.reject(error)); this.waiters.delete(assetId) }
}

async function fingerprintFor(candidate: Pick<EmbeddingCandidate, 'hash' | 'path' | 'size'>): Promise<string> {
  const file = await stat(candidate.path)
  return `${candidate.hash}:${candidate.size}:${Math.trunc(file.mtimeMs)}`
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof MuseError) return { code: error.code.toLowerCase(), message: error.message }
  return { code: 'embedding_failed', message: error instanceof Error ? error.message : String(error) }
}
