import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EmbeddingModelIdentity } from '../../database/repositories/EmbeddingRepository'
import { MuseError } from '../../errors'
import { logger } from '../../logger'

interface WorkerResponse { id: number; ok: boolean; value?: unknown; error?: { code: string; message: string } }
interface PendingRequest { resolve(value: unknown): void; reject(error: unknown): void }
interface EmbedResult { vector: ArrayBuffer; inferenceMs: number }
interface SearchResult { results: Array<{ assetId: string; score: number }>; indexedCount: number; searchMs: number }

export class EmbeddingWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly configuration: { modelsRoot: string; localModelId: string; databasePath: string; model: EmbeddingModelIdentity }) {}

  async initialize(): Promise<{ loadMs: number }> { return this.request('initialize') as Promise<{ loadMs: number }> }

  async embed(path: string): Promise<{ vector: Float32Array; inferenceMs: number }> {
    const result = await this.request('embed', { path }) as EmbedResult
    return { vector: new Float32Array(result.vector), inferenceMs: result.inferenceMs }
  }

  async search(sourceAssetId: string, limit: number, minimumScore?: number): Promise<SearchResult> {
    return this.request('search', { sourceAssetId, limit, minimumScore }) as Promise<SearchResult>
  }

  async dispose(): Promise<void> {
    if (!this.worker) return
    try { await this.request('dispose') } catch { /* worker may already be gone */ }
    await this.worker.terminate()
    this.worker = null
  }

  private request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const worker = this.ensureWorker(), id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, type, ...payload })
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const directPath = join(__dirname, 'workers', 'embeddingWorker.js')
    const path = existsSync(directPath) ? directPath : join(__dirname, '..', 'workers', 'embeddingWorker.js')
    const worker = new Worker(path, { workerData: this.configuration })
    worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.ok) pending.resolve(response.value)
      else pending.reject(new MuseError(response.error?.code ?? 'EMBEDDING_FAILED', response.error?.message ?? '视觉索引后台任务失败'))
    })
    worker.on('error', (error) => this.rejectAll(new MuseError('RUNTIME_INIT_FAILED', error.message)))
    worker.on('exit', (code) => {
      if (code !== 0) logger.warn('Visual embedding worker exited', { code })
      this.rejectAll(new MuseError('RUNTIME_INIT_FAILED', '视觉索引后台进程已退出'))
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
