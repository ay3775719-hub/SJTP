import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import type { EmbeddingModelIdentity } from '../database/repositories/EmbeddingRepository'
import { embeddingFromBlob, normalizeEmbedding, rankEmbeddings } from '../services/embeddings/vectorMath'

interface WorkerConfiguration {
  modelsRoot: string
  localModelId: string
  databasePath: string
  model: EmbeddingModelIdentity
}

interface WorkerRequest {
  id: number
  type: 'initialize' | 'embed' | 'search' | 'dispose'
  path?: string
  sourceAssetId?: string
  limit?: number
  minimumScore?: number
}

interface TensorResult { data: Float32Array; dims: number[] }
interface ImageEmbeddingPipeline {
  (path: string): Promise<TensorResult>
  dispose(): Promise<void>
}

const configuration = workerData as WorkerConfiguration
let embedder: ImageEmbeddingPipeline | null = null
let database: DatabaseSync | null = null
let chain = Promise.resolve()

parentPort?.on('message', (request: WorkerRequest) => {
  chain = chain.then(() => execute(request)).catch((error: unknown) => reply(request.id, false, undefined, error))
})

async function execute(request: WorkerRequest): Promise<void> {
  if (request.type === 'initialize') {
    const started = performance.now()
    await getEmbedder()
    reply(request.id, true, { loadMs: performance.now() - started })
    return
  }
  if (request.type === 'embed') {
    if (!request.path) throw new Error('Missing image path')
    const started = performance.now(), pipeline = await getEmbedder()
    const output = await pipeline(request.path)
    const dimension = output.dims.at(-1) ?? 0
    if (dimension !== configuration.model.dimension || output.data.length < dimension) {
      const error = new Error(`Expected ${configuration.model.dimension} dimensions, received ${JSON.stringify(output.dims)}`)
      error.name = 'DIMENSION_MISMATCH'
      throw error
    }
    const vector = Float32Array.from(output.data.subarray(0, dimension))
    normalizeEmbedding(vector)
    const buffer = vector.buffer
    parentPort?.postMessage({ id: request.id, ok: true, value: { vector: buffer, inferenceMs: performance.now() - started } }, [buffer])
    return
  }
  if (request.type === 'search') {
    if (!request.sourceAssetId) throw new Error('Missing source asset id')
    const started = performance.now(), db = getDatabase()
    const params = { assetId: request.sourceAssetId, providerId: configuration.model.providerId, modelId: configuration.model.modelId, modelVersion: configuration.model.modelVersion }
    const source = db.prepare(`SELECT vector_blob AS vector,dimension FROM asset_embeddings WHERE asset_id=@assetId AND provider_id=@providerId AND model_id=@modelId AND model_version=@modelVersion AND status='completed'`).get(params) as unknown as { vector: Uint8Array; dimension: number } | undefined
    if (!source?.vector) { const error = new Error('Source embedding is unavailable'); error.name = 'INDEX_UNAVAILABLE'; throw error }
    const query = embeddingFromBlob(source.vector, source.dimension)
    const rows = db.prepare(`
      SELECT e.asset_id AS assetId,e.vector_blob AS vector,e.dimension
      FROM asset_embeddings e JOIN assets a ON a.id=e.asset_id
      WHERE a.deleted_at IS NULL AND e.asset_id<>@assetId AND e.provider_id=@providerId AND e.model_id=@modelId
        AND e.model_version=@modelVersion AND e.status='completed' AND e.vector_blob IS NOT NULL
    `).all(params) as unknown as Array<{ assetId: string; vector: Uint8Array; dimension: number }>
    const scores = rankEmbeddings(query, rows, request.limit ?? 100, request.minimumScore)
    reply(request.id, true, { results: scores, indexedCount: rows.length + 1, searchMs: performance.now() - started })
    return
  }
  if (request.type === 'dispose') {
    await embedder?.dispose()
    embedder = null
    database?.close()
    database = null
    reply(request.id, true, null)
  }
}

async function getEmbedder(): Promise<ImageEmbeddingPipeline> {
  if (embedder) return embedder
  const transformers = await import('@huggingface/transformers')
  transformers.env.localModelPath = configuration.modelsRoot
  transformers.env.allowLocalModels = true
  transformers.env.allowRemoteModels = false
  embedder = await transformers.pipeline('image-feature-extraction', configuration.localModelId, {
    dtype: 'q8', local_files_only: true, session_options: { executionProviders: ['cpu'], intraOpNumThreads: Math.max(1, Math.min(4, navigatorHardwareConcurrency() - 1)) }
  }) as unknown as ImageEmbeddingPipeline
  return embedder
}

function getDatabase(): DatabaseSync {
  database ??= new DatabaseSync(configuration.databasePath, { readOnly: true })
  return database
}

function navigatorHardwareConcurrency(): number {
  return typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2
}

function reply(id: number, ok: boolean, value?: unknown, error?: unknown): void {
  const normalized = error instanceof Error ? { code: error.name, message: error.message, stack: error.stack } : { code: 'EMBEDDING_FAILED', message: String(error) }
  parentPort?.postMessage(ok ? { id, ok, value } : { id, ok, error: normalized })
}
