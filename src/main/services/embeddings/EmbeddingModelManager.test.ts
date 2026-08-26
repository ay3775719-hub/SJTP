import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EmbeddingModelManager } from './EmbeddingModelManager'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('EmbeddingModelManager integrity', () => {
  it('rejects cached model files that have the expected sizes but invalid SHA-256 values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-model-integrity-'))
    roots.push(root)
    const model = join(root, 'dinov2-small')
    await mkdir(join(model, 'onnx'), { recursive: true })
    await writeFile(join(model, 'config.json'), Buffer.alloc(899))
    await writeFile(join(model, 'preprocessor_config.json'), Buffer.alloc(436))
    const onnx = join(model, 'onnx', 'model_quantized.onnx')
    await writeFile(onnx, '')
    await truncate(onnx, 24_446_700)

    await expect(new EmbeddingModelManager(root).initialize()).resolves.toBe(false)
  })
})
