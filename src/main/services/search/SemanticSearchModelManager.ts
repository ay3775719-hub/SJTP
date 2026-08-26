import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MuseError } from '../../errors'

const REVISION = 'd15189d7028b43f1d3e65039190477f6af591c2a'
const FILES = [
  { relative: 'config.json', bytes: 4_524, sha256: '493ef57ff783e42d1530c91b53469b7fdf8db8a9c1408e86998fcb7899a4f495' },
  { relative: 'merges.txt', bytes: 524_619, sha256: '9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a' },
  { relative: 'preprocessor_config.json', bytes: 520, sha256: '6f638fb9401a6d6296feff533ee7efe657b787c49f954f82f5906b36ef2a1b1f' },
  { relative: 'special_tokens_map.json', bytes: 472, sha256: 'c4864a9376a8401918425bed71fc14fc0e81f9b59ec45c1cf96cccb2df508eac' },
  { relative: 'tokenizer.json', bytes: 2_224_119, sha256: 'f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd' },
  { relative: 'tokenizer_config.json', bytes: 775, sha256: '60ba2912bc6344c94bc16bbdec27fa1209409167b6f2fdf3cfe9e65462ea3967' },
  { relative: 'vocab.json', bytes: 862_328, sha256: '5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363' },
  { relative: 'onnx/text_model_quantized.onnx', bytes: 64_504_507, sha256: '73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a' },
  { relative: 'onnx/vision_model_quantized.onnx', bytes: 89_117_001, sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299' }
] as const

export const SEMANTIC_SEARCH_MODEL = {
  providerId: 'builtin-local', modelId: 'clip-vit-base-patch32-q8', localModelId: 'clip-vit-base-patch32',
  modelVersion: REVISION, name: 'Muse Local Semantic Search · CLIP ViT-B/32', dimension: 512,
  bytes: FILES.reduce((total, file) => total + file.bytes, 0), license: 'MIT',
  source: 'https://huggingface.co/Xenova/clip-vit-base-patch32'
} as const

export class SemanticSearchModelManager {
  constructor(readonly modelsRoot: string) {}
  get localModelPath(): string { return join(this.modelsRoot, SEMANTIC_SEARCH_MODEL.localModelId) }

  async ensureReady(onProgress?: (progress: number) => void): Promise<void> {
    await mkdir(this.localModelPath, { recursive: true })
    let complete = 0
    for (const file of FILES) {
      const destination = join(this.localModelPath, ...file.relative.split('/'))
      if (!await matches(destination, file.bytes, file.sha256)) {
        await mkdir(dirname(destination), { recursive: true })
        const temporary = `${destination}.download`
        await unlink(temporary).catch(() => undefined)
        const url = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${REVISION}/${file.relative}`
        await download(url, temporary, (bytes) => onProgress?.((complete + Math.min(bytes, file.bytes)) / SEMANTIC_SEARCH_MODEL.bytes))
        if (!await matches(temporary, file.bytes, file.sha256)) {
          await unlink(temporary).catch(() => undefined)
          throw new MuseError('MODEL_HASH_INVALID', `本地语义模型校验失败：${file.relative}`)
        }
        await unlink(destination).catch(() => undefined)
        await rename(temporary, destination)
      }
      complete += file.bytes
      onProgress?.(complete / SEMANTIC_SEARCH_MODEL.bytes)
    }
  }
}

async function download(url: string, destination: string, onProgress: (bytes: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new MuseError('MODEL_DOWNLOAD_FAILED', `本地语义模型下载失败：HTTP ${response.status}`)
  const handle = await open(destination, 'w'), reader = response.body.getReader()
  let received = 0
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; await handle.write(chunk.value); received += chunk.value.byteLength; onProgress(received) } }
  finally { reader.releaseLock(); await handle.close() }
}

async function matches(path: string, bytes: number, sha256: string): Promise<boolean> {
  try { return (await stat(path)).size === bytes && await hash(path) === sha256 } catch { return false }
}
function hash(path: string): Promise<string> { return new Promise((resolve, reject) => { const sum = createHash('sha256'), stream = createReadStream(path); stream.on('data', (data) => sum.update(data)); stream.on('error', reject); stream.on('end', () => resolve(sum.digest('hex'))) }) }
