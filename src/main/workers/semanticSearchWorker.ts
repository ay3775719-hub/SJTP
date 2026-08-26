import { parentPort, workerData } from 'node:worker_threads'
import { normalizeEmbedding } from '../services/embeddings/vectorMath'

interface Config { modelsRoot: string; localModelId: string; dimension: number }
interface Request { id: number; type: 'initialize' | 'embed-image' | 'embed-text' | 'dispose'; path?: string; text?: string }
interface Tensor { data: Float32Array; dims: number[] }
const config = parentPort
  ? workerData as Config
  : JSON.parse(process.env.MUSE_SEMANTIC_WORKER_CONFIG ?? '{}') as Config
let tokenizer: any, processor: any, textModel: any, visionModel: any
let chain = Promise.resolve()

const receive = (request: Request): void => { chain = chain.then(() => execute(request)).catch((error) => reply(request.id, false, undefined, error)) }
if (parentPort) parentPort.on('message', receive)
else process.on('message', (message) => receive(message as Request))

async function initialize(): Promise<void> {
  if (textModel && visionModel) return
  const t = await import('@huggingface/transformers')
  t.env.localModelPath = config.modelsRoot; t.env.allowLocalModels = true; t.env.allowRemoteModels = false
  ;[tokenizer, processor, textModel, visionModel] = await Promise.all([
    t.AutoTokenizer.from_pretrained(config.localModelId, { local_files_only: true }),
    t.AutoProcessor.from_pretrained(config.localModelId, { local_files_only: true }),
    t.CLIPTextModelWithProjection.from_pretrained(config.localModelId, { dtype: 'q8', local_files_only: true }),
    t.CLIPVisionModelWithProjection.from_pretrained(config.localModelId, { dtype: 'q8', local_files_only: true })
  ])
}
async function execute(request: Request): Promise<void> {
  const started = performance.now()
  if (request.type === 'initialize') { await initialize(); reply(request.id, true, { loadMs: performance.now() - started }); return }
  if (request.type === 'dispose') { await textModel?.dispose(); await visionModel?.dispose(); textModel = visionModel = null; reply(request.id, true, null); return }
  await initialize()
  let tensor: Tensor
  if (request.type === 'embed-text') tensor = (await textModel(tokenizer([request.text ?? ''], { padding: true, truncation: true }))).text_embeds
  else {
    const t = await import('@huggingface/transformers')
    const image = await t.RawImage.read(request.path!)
    tensor = (await visionModel(await processor(image))).image_embeds
  }
  if ((tensor.dims.at(-1) ?? 0) !== config.dimension) throw new Error(`Expected ${config.dimension} dimensions, got ${JSON.stringify(tensor.dims)}`)
  const vector = normalizeEmbedding(Float32Array.from(tensor.data.subarray(0, config.dimension))), buffer = vector.buffer as ArrayBuffer
  send({ id: request.id, ok: true, value: { vector: buffer, inferenceMs: performance.now() - started } }, [buffer])
}
function reply(id: number, ok: boolean, value?: unknown, error?: unknown): void {
  const e = error instanceof Error ? { code: error.name, message: error.message } : { code: 'SEMANTIC_EMBEDDING_FAILED', message: String(error) }
  send(ok ? { id, ok, value } : { id, ok, error: e })
}
function send(message: unknown, transfer: ArrayBuffer[] = []): void {
  if (parentPort) parentPort.postMessage(message, transfer)
  else if (process.send) process.send(message)
}
