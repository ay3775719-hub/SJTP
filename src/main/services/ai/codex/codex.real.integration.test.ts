import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../database/DatabaseService'
import { AIAnalysisRepository } from '../../../database/repositories/AIAnalysisRepository'
import { normalizeAIAnalysis } from '../normalizeAIAnalysis'
import { AIAnalysisPreviewService } from '../AIAnalysisPreviewService'
import { CodexChatGPTProvider } from '../providers/CodexChatGPTProvider'
import { CodexAppServerManager } from './CodexAppServerManager'

const enabled = process.env.MUSE_REAL_CODEX === '1'
const libraryPath = process.env.MUSE_REAL_LIBRARY || 'D:\\桌面\\图片\\Muse Library'
const qaRoot = join(process.cwd(), '.qa-codex-real')

describe.skipIf(!enabled)('Codex ChatGPT real vision', () => {
  const manager = new CodexAppServerManager({ userDataPath: qaRoot, resourcesPath: process.cwd(), projectRoot: process.cwd() })
  let database: DatabaseService | null = null
  afterAll(async () => { database?.close(); await manager.shutdown(); await rm(qaRoot, { recursive: true, force: true }).catch(() => undefined) })

  it('analyzes one real Library image and persists standard Muse metadata', async () => {
    database = new DatabaseService(join(libraryPath, 'muse.db'))
    const asset = database.db.prepare("SELECT id,path,filename FROM assets WHERE deleted_at IS NULL ORDER BY imported_at LIMIT 1").get() as unknown as { id: string; path: string; filename: string }
    expect(asset).toBeTruthy()
    const previewRoot = join(qaRoot, 'preview')
    await mkdir(previewRoot, { recursive: true })
    const previewPath = await new AIAnalysisPreviewService().createFile(asset.path, previewRoot, asset.id)
    const provider = new CodexChatGPTProvider(manager, join(qaRoot, 'workspaces'))
    const result = await provider.analyzeImageBatch([{ assetId: asset.id, localImagePath: previewPath }], { modelId: 'auto' })
    expect(result.results).toHaveLength(1)
    const raw = result.results[0]!.result
    new AIAnalysisRepository(database.db).complete(asset.id, 'codex-chatgpt', result.actualModelId, normalizeAIAnalysis(raw), result.promptVersion)
    const saved = new AIAnalysisRepository(database.db).get(asset.id)
    expect(saved?.status).toBe('completed')
    expect(saved?.provider).toBe('codex-chatgpt')
    expect(saved?.description).toBeTruthy()
    process.stdout.write(`\nREAL_CODEX_RESULT ${JSON.stringify({ assetId: asset.id, filename: asset.filename, model: result.actualModelId, durationMs: result.durationMs, result: raw }, null, 2)}\n`)
  }, 240_000)
})
