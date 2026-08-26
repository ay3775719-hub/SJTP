import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../database/DatabaseService'
import { AIAnalysisRepository } from '../../../database/repositories/AIAnalysisRepository'
import { AssetRepository } from '../../../database/repositories/AssetRepository'
import { AIAnalysisQueue } from '../AIAnalysisQueue'
import { CodexChatGPTProvider } from '../providers/CodexChatGPTProvider'
import { CodexAppServerManager } from './CodexAppServerManager'

const enabled = process.env.MUSE_REAL_CODEX_BATCH20 === '1'
const libraryPath = process.env.MUSE_REAL_LIBRARY || 'D:\\桌面\\图片\\Muse Library'
const qaRoot = join(process.cwd(), '.qa-codex-batch20')

describe.skipIf(!enabled)('Codex real 20-image production verification', () => {
  const manager = new CodexAppServerManager({ userDataPath: qaRoot, resourcesPath: process.cwd(), projectRoot: process.cwd() })
  let database: DatabaseService | null = null
  afterAll(async () => { database?.close(); await manager.shutdown(); await rm(qaRoot, { recursive: true, force: true }).catch(() => undefined) })

  it('recognizes and persists all 20 real Library assets in batches of four', async () => {
    database = new DatabaseService(join(libraryPath, 'muse.db'))
    await mkdir(qaRoot, { recursive: true })
    const rows = database.db.prepare('SELECT id,filename,deleted_at FROM assets ORDER BY imported_at,id LIMIT 20').all() as unknown as Array<{ id: string; filename: string; deleted_at: string | null }>
    expect(rows).toHaveLength(20)
    const repository = new AIAnalysisRepository(database.db)
    const assets = new AssetRepository(database.db, (path) => path)
    repository.saveQueuePause(false, null)
    const provider = new CodexChatGPTProvider(manager, join(qaRoot, 'workspaces'))
    const queue = new AIAnalysisQueue(repository, assets, () => provider, () => undefined)
    queue.setConcurrency(1)
    const usageBefore = await manager.usage()
    const startedAt = Date.now()
    queue.enqueue(rows.map((row) => row.id), { providerId: 'codex-chatgpt', modelId: 'auto', baseUrl: '', displayName: 'Codex / ChatGPT' }, true)
    await waitForQueue(queue, 20 * 60_000)
    const durationMs = Date.now() - startedAt
    const usageAfter = await manager.usage()
    const status = queue.status()
    expect(status.failed).toBe(0)
    expect(status.paused).toBe(false)

    const report = rows.map((row) => {
      const analysis = repository.get(row.id)
      expect(analysis?.status).toBe('completed')
      expect(analysis?.provider).toBe('codex-chatgpt')
      return {
        assetId: row.id,
        filename: row.filename,
        deleted: Boolean(row.deleted_at),
        provider: analysis!.provider,
        model: analysis!.model,
        primaryObject: analysis!.primaryObject,
        primaryScene: analysis!.primaryScene,
        primaryStyle: analysis!.primaryStyle,
        description: analysis!.description,
        overallConfidence: analysis!.overallConfidence,
        analyzedAt: analysis!.analyzedAt
      }
    })
    const output = { batchSize: 4, durationMs, averageMsPerAsset: Math.round(durationMs / rows.length), serializedResultChars: JSON.stringify(report).length, status, usageBefore, usageAfter, results: report }
    await mkdir(join(process.cwd(), 'design-qa-artifacts'), { recursive: true })
    await writeFile(join(process.cwd(), 'design-qa-artifacts', 'codex-minimal-batch20-results.json'), JSON.stringify(output, null, 2), 'utf8')
    process.stdout.write(`\nREAL_CODEX_MINIMAL_BATCH20 ${JSON.stringify(output, null, 2)}\n`)
  }, 1_300_000)
})

async function waitForQueue(queue: AIAnalysisQueue, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = queue.status()
    if (status.paused) throw new Error(`Queue paused: ${status.pauseReason}`)
    if (status.queued === 0 && status.analyzing === 0) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for Codex queue: ${JSON.stringify(queue.status())}`)
}
