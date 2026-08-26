import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MuseError } from '../../errors'
import { logger, serializeError } from '../../logger'

const REVISION = '8b1f705a3a7f6f062f6bdd21986c1583d3ef105d'

const FILES = [
  { relative: 'config.json', bytes: 899, sha256: '50965b6c1dc4a9e38af8b5e8736cf059e56aa60d9047c2aef05f7e134371d02a' },
  { relative: 'preprocessor_config.json', bytes: 436, sha256: '14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828' },
  { relative: 'onnx/model_quantized.onnx', bytes: 24_446_700, sha256: 'c179f8f7f592449c4c1bca4cd124a7538021428c5ffb89afde9503935b197efb' }
] as const

export const BUILTIN_EMBEDDING_MODEL = {
  providerId: 'builtin-local',
  modelId: 'dinov2-small-q8',
  localModelId: 'dinov2-small',
  modelVersion: REVISION,
  name: 'Muse Visual Index · DINOv2 Small',
  dimension: 384,
  bytes: FILES.reduce((sum, file) => sum + file.bytes, 0),
  license: 'Apache-2.0',
  source: 'https://huggingface.co/onnx-community/dinov2-small'
} as const

export type ModelProgressListener = (progress: number) => void

export class EmbeddingModelManager {
  private ready = false
  private preparing: Promise<void> | null = null

  constructor(readonly modelsRoot: string) {}

  get localModelPath(): string { return join(this.modelsRoot, BUILTIN_EMBEDDING_MODEL.localModelId) }

  async initialize(): Promise<boolean> {
    // Model files are executable inference inputs. Verify the pinned checksum on
    // every activation, not only immediately after download, so a same-size
    // replacement can never be trusted silently.
    this.ready = await this.verify(true)
    return this.ready
  }

  isReady(): boolean { return this.ready }

  async prepare(onProgress?: ModelProgressListener): Promise<void> {
    if (this.ready) { onProgress?.(1); return }
    if (this.preparing) return this.preparing
    this.preparing = this.prepareInternal(onProgress).finally(() => { this.preparing = null })
    return this.preparing
  }

  private async prepareInternal(onProgress?: ModelProgressListener): Promise<void> {
    await mkdir(this.localModelPath, { recursive: true })
    let completedBytes = 0
    try {
      for (const file of FILES) {
        const destination = join(this.localModelPath, ...file.relative.split('/'))
        if (await fileMatches(destination, file.bytes, file.sha256)) {
          completedBytes += file.bytes
          onProgress?.(completedBytes / BUILTIN_EMBEDDING_MODEL.bytes)
          continue
        }
        await mkdir(dirname(destination), { recursive: true })
        const temporary = `${destination}.download`
        await unlink(temporary).catch(() => undefined)
        const url = `https://huggingface.co/onnx-community/dinov2-small/resolve/${REVISION}/${file.relative}`
        await download(url, temporary, (received) => onProgress?.((completedBytes + Math.min(received, file.bytes)) / BUILTIN_EMBEDDING_MODEL.bytes))
        if (!await fileMatches(temporary, file.bytes, file.sha256)) {
          await unlink(temporary).catch(() => undefined)
          throw new MuseError('MODEL_HASH_INVALID', `视觉模型文件校验失败：${file.relative}`)
        }
        await unlink(destination).catch(() => undefined)
        await rename(temporary, destination)
        completedBytes += file.bytes
      }
      this.ready = await this.verify(true)
      if (!this.ready) throw new MuseError('MODEL_HASH_INVALID', '视觉模型校验失败')
      onProgress?.(1)
      logger.info('Visual embedding model ready', { model: BUILTIN_EMBEDDING_MODEL.modelId, root: this.localModelPath })
    } catch (error) {
      this.ready = false
      logger.error('Visual embedding model preparation failed', serializeError(error))
      if (error instanceof MuseError) throw error
      throw new MuseError('MODEL_DOWNLOAD_FAILED', '本地视觉模型准备失败，请检查网络后重试')
    }
  }

  private async verify(fullHash: boolean): Promise<boolean> {
    for (const file of FILES) {
      const destination = join(this.localModelPath, ...file.relative.split('/'))
      if (!await fileMatches(destination, file.bytes, fullHash ? file.sha256 : undefined)) return false
    }
    return true
  }
}

async function download(url: string, destination: string, onProgress: (received: number) => void): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`)
  const handle = await open(destination, 'w')
  const reader = response.body.getReader()
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await handle.write(value)
      received += value.byteLength
      onProgress(received)
    }
  } finally {
    reader.releaseLock()
    await handle.close()
  }
}

async function fileMatches(path: string, expectedBytes: number, sha256?: string): Promise<boolean> {
  try {
    if ((await stat(path)).size !== expectedBytes) return false
    return sha256 ? await hashFile(path) === sha256 : true
  } catch { return false }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256'), stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
