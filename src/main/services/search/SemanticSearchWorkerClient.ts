import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MuseError } from '../../errors'

interface Response { id: number; ok: boolean; value?: { vector: ArrayBuffer; inferenceMs: number; loadMs?: number }; error?: { code: string; message: string } }
interface PendingRequest { resolve(value: any): void; reject(error: unknown): void }

/**
 * CLIP runs in a real child process rather than another worker_thread.
 * onnxruntime-node is not safe when two independent model sessions execute in
 * separate V8 worker isolates in the same Electron process (DINO + CLIP can
 * terminate the whole app with a native HandleScope failure). Process
 * isolation keeps local semantic indexing independent from visual indexing.
 */
export class SemanticSearchWorkerClient {
  private worker: ChildProcess | null = null
  private id = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly config: { modelsRoot: string; localModelId: string; dimension: number; workerPath?: string }) {}

  initialize(): Promise<{ loadMs: number }> { return this.request('initialize') }
  async embedImage(path: string): Promise<{ vector: Float32Array; inferenceMs: number }> {
    const value = await this.request('embed-image', { path })
    return { vector: new Float32Array(value.vector), inferenceMs: value.inferenceMs }
  }
  async embedText(text: string): Promise<{ vector: Float32Array; inferenceMs: number }> {
    const value = await this.request('embed-text', { text })
    return { vector: new Float32Array(value.vector), inferenceMs: value.inferenceMs }
  }
  async dispose(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    await this.request('dispose').catch(() => undefined)
    if (worker.connected) worker.disconnect()
    if (!worker.killed) worker.kill()
    this.worker = null
  }

  private request(type: string, payload: Record<string, unknown> = {}): Promise<any> {
    const id = this.id++, worker = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.send({ id, type, ...payload }, (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  private ensure(): ChildProcess {
    if (this.worker) return this.worker
    const directPath = join(__dirname, 'workers', 'semanticSearchWorker.js')
    const workerPath = this.config.workerPath ?? (existsSync(directPath) ? directPath : join(__dirname, '..', 'workers', 'semanticSearchWorker.js'))
    const worker = fork(workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MUSE_SEMANTIC_WORKER_CONFIG: JSON.stringify({
          modelsRoot: this.config.modelsRoot,
          localModelId: this.config.localModelId,
          dimension: this.config.dimension
        })
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced'
    })
    worker.on('message', (message) => {
      const response = message as Response
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      response.ok
        ? pending.resolve(response.value)
        : pending.reject(new MuseError(response.error?.code ?? 'SEMANTIC_EMBEDDING_FAILED', response.error?.message ?? '本地语义检索失败'))
    })
    worker.on('error', (error) => this.rejectAll(error))
    worker.on('exit', (code, signal) => {
      this.rejectAll(new MuseError('SEMANTIC_RUNTIME_EXITED', `本地语义检索进程已退出 (${signal ?? code ?? 'unknown'})`))
      if (this.worker === worker) this.worker = null
    })
    this.worker = worker
    return worker
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
