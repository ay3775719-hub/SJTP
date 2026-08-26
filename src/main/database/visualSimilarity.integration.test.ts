import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseService } from './DatabaseService'
import { EmbeddingRepository } from './repositories/EmbeddingRepository'
import { EmbeddingQueue } from '../services/embeddings/EmbeddingQueue'
import type { EmbeddingWorkerClient } from '../services/embeddings/EmbeddingWorkerClient'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

const model = { providerId: 'test-local', modelId: 'test-vision', modelVersion: '1', dimension: 3 }

describe('local visual index persistence', () => {
  it('stores Float32 BLOBs by model version and keeps trash out of eligible counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-visual-index-'))
    cleanup.push(root)
    const databasePath = join(root, 'muse.db')
    let database = new DatabaseService(databasePath)
    const now = new Date().toISOString()
    const insert = database.db.prepare(`INSERT INTO assets(
      id,filename,original_filename,path,mime_type,extension,width,height,size,hash,created_at,updated_at,imported_at,deleted_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    insert.run('active', 'active.png', 'active.png', join(root, 'active.png'), 'image/png', 'png', 10, 10, 10, 'hash-active', now, now, now, null)
    insert.run('trash', 'trash.png', 'trash.png', join(root, 'trash.png'), 'image/png', 'png', 10, 10, 10, 'hash-trash', now, now, now, now)

    let repository = new EmbeddingRepository(database.db, model)
    repository.queue('active', 'fingerprint-a')
    repository.save('active', 'fingerprint-a', Float32Array.from([1, 0, 0]))
    repository.queue('trash', 'fingerprint-b')
    repository.save('trash', 'fingerprint-b', Float32Array.from([0, 1, 0]))
    expect(repository.counts()).toMatchObject({ totalEligible: 1, completed: 1, failed: 0 })

    const stored = database.db.prepare(`SELECT typeof(vector_blob) AS storage, length(vector_blob) AS bytes, status, normalized FROM asset_embeddings WHERE asset_id='active'`).get() as unknown as { storage: string; bytes: number; status: string; normalized: number }
    expect(stored).toEqual({ storage: 'blob', bytes: 12, status: 'completed', normalized: 1 })

    database.close()
    database = new DatabaseService(databasePath)
    repository = new EmbeddingRepository(database.db, model)
    expect(repository.getCandidate('active')).toMatchObject({ status: 'completed', sourceFingerprint: 'fingerprint-a' })
    expect(repository.counts().completed).toBe(1)
    database.close()
  })

  it('rejects vectors whose dimension does not match the model identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-visual-index-'))
    cleanup.push(root)
    const database = new DatabaseService(join(root, 'muse.db'))
    const repository = new EmbeddingRepository(database.db, model)
    expect(() => repository.save('missing', 'fingerprint', Float32Array.from([1, 0]))).toThrow(/dimension mismatch/i)
    database.close()
  })

  it('regenerates a stale file and can recover from a failed embedding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-visual-index-'))
    cleanup.push(root)
    const imagePath = join(root, 'asset.png')
    await writeFile(imagePath, 'first')
    const database = new DatabaseService(join(root, 'muse.db'))
    const now = new Date().toISOString()
    database.db.prepare(`INSERT INTO assets(
      id,filename,original_filename,path,mime_type,extension,width,height,size,hash,created_at,updated_at,imported_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('asset', 'asset.png', 'asset.png', imagePath, 'image/png', 'png', 10, 10, 5, 'hash-asset', now, now, now)
    const repository = new EmbeddingRepository(database.db, model)
    let calls = 0
    const worker = {
      async embed(): Promise<{ vector: Float32Array; inferenceMs: number }> {
        calls += 1
        if (calls === 1) throw new Error('transient inference failure')
        return { vector: Float32Array.from([1, 0, 0]), inferenceMs: 1 }
      }
    } as unknown as EmbeddingWorkerClient
    const queue = new EmbeddingQueue(repository, worker, () => undefined)

    await expect(queue.ensure('asset')).rejects.toThrow(/transient inference failure/)
    expect(repository.getCandidate('asset')?.status).toBe('failed')
    await queue.ensure('asset')
    expect(repository.getCandidate('asset')?.status).toBe('completed')
    const firstFingerprint = repository.getCandidate('asset')?.sourceFingerprint

    await new Promise((resolve) => setTimeout(resolve, 8))
    await writeFile(imagePath, 'second')
    await queue.start()
    await waitFor(() => repository.getCandidate('asset')?.status === 'completed' && calls === 3)
    expect(repository.getCandidate('asset')?.sourceFingerprint).not.toBe(firstFingerprint)
    database.close()
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for visual index queue')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
