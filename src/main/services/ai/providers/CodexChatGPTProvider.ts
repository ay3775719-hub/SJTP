import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { aiAnalysisResultSchema, type RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'
import { MuseError } from '../../../errors'
import type { AIProvider, AnalyzeImageBatchInput, AnalyzeImageBatchResult, AnalyzeImageInput, AnalyzeOptions } from '../AIProvider'
import type { CodexAppServerManager } from '../codex/CodexAppServerManager'
import { CODEX_BATCH_BASE_INSTRUCTIONS, CODEX_BATCH_PROMPT_VERSION, createCodexBatchOutputSchema, createCodexBatchPrompt } from '../codexBatchImageAnalysisPrompt'

export class CodexChatGPTProvider implements AIProvider {
  readonly id = 'codex-chatgpt' as const

  constructor(
    private readonly manager: CodexAppServerManager,
    private readonly workspaceRoot: string
  ) {}

  getInfo(): AIProviderInfo {
    return {
      id: this.id,
      name: 'Codex / ChatGPT',
      kind: 'cloud',
      defaultBaseUrl: null,
      requiresApiKey: false,
      recommendedConcurrency: 1,
      available: true,
      authMode: 'chatgpt',
      supportsBatchImages: true,
      supportsChatGPTAuth: true
    }
  }

  async testConnection(): Promise<ProviderConnectionResult> {
    const checkedAt = new Date().toISOString()
    try {
      const account = await this.manager.account()
      if (!account.connected) return { providerId: this.id, status: 'auth_failed', message: '尚未使用 ChatGPT 登录', checkedAt, models: [] }
      const models = await this.listModels()
      if (!models.length) return { providerId: this.id, status: 'model_missing', message: '当前账号没有可用于图片识别的模型', checkedAt, models }
      const usage = await this.manager.usage()
      if (usage.limitReached) return { providerId: this.id, status: 'rate_limited', message: 'Codex 当前使用额度已达到限制', checkedAt, models }
      return { providerId: this.id, status: 'connected', message: `已连接 · ${account.email ?? 'ChatGPT'}${account.planType ? ` · ${account.planType}` : ''}`, checkedAt, models }
    } catch (error) {
      return { providerId: this.id, status: 'disconnected', message: error instanceof Error ? error.message : String(error), checkedAt, models: [] }
    }
  }

  listModels() { return this.manager.listModels() }

  async analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    const workspace = join(this.workspaceRoot, `single-${nanoid(10)}`)
    await mkdir(workspace, { recursive: true })
    const imagePath = join(workspace, `image.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`)
    try {
      const base64 = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1)
      await writeFile(imagePath, Buffer.from(base64, 'base64'))
      const batch = await this.analyzeImageBatch([{ assetId: input.assetId, localImagePath: imagePath }], { ...options, signal: input.signal })
      const result = batch.results.find((item) => item.assetId === input.assetId)?.result
      if (!result) throw new MuseError('AI_INVALID_RESPONSE', 'Codex 未返回当前素材的识别结果')
      return result
    } finally { await rm(workspace, { recursive: true, force: true }).catch(() => undefined) }
  }

  async analyzeImageBatch(inputs: AnalyzeImageBatchInput[], options: AnalyzeOptions & { signal?: AbortSignal }): Promise<AnalyzeImageBatchResult> {
    if (!inputs.length || inputs.length > 8) throw new MuseError('AI_BATCH_SIZE', 'Codex 单批图片数量必须为 1–8 张')
    const models = options.modelId === 'auto' ? await this.listModels() : []
    const modelId = options.modelId === 'auto'
      ? models.find((model) => model.isDefault)?.id ?? models[0]?.id
      : options.modelId
    if (!modelId) throw new MuseError('AI_MODEL_MISSING', '当前 Codex 账号没有可用于图片识别的模型')
    const assetIds = inputs.map((item) => item.assetId)
    if (new Set(assetIds).size !== assetIds.length) throw new MuseError('AI_BATCH_DUPLICATE', 'Codex 批次包含重复素材 ID')
    const workspacePath = join(this.workspaceRoot, `batch-${Date.now()}-${nanoid(8)}`)
    await mkdir(workspacePath, { recursive: true })
    try {
      const localImages = await Promise.all(inputs.map(async (item, index) => {
        const path = join(workspacePath, `${String(index + 1).padStart(2, '0')}-${item.assetId}.jpg`)
        await copyFile(item.localImagePath, path)
        return { assetId: item.assetId, path }
      }))
      const turn = await this.manager.runBatchTurn({
        modelId,
        effort: 'low',
        workspacePath,
        baseInstructions: CODEX_BATCH_BASE_INSTRUCTIONS,
        prompt: createCodexBatchPrompt(assetIds),
        images: localImages,
        outputSchema: createCodexBatchOutputSchema(assetIds),
        signal: options.signal
      })
      const parsed = parseBatchResult(turn.text, assetIds)
      return { results: parsed, actualModelId: turn.modelId, promptVersion: CODEX_BATCH_PROMPT_VERSION, threadId: turn.threadId, durationMs: turn.durationMs }
    } finally { await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined) }
  }
}

function parseBatchResult(text: string, expectedIds: string[]): Array<{ assetId: string; result: RawAIAnalysisResult }> {
  const json = extractJson(text)
  let root: unknown
  try { root = JSON.parse(json) } catch { throw new MuseError('AI_INVALID_RESPONSE', 'Codex 返回了无效 JSON') }
  if (!root || typeof root !== 'object' || !Array.isArray((root as { results?: unknown }).results)) {
    throw new MuseError('AI_INVALID_RESPONSE', 'Codex 批量结果缺少 results')
  }
  const expected = new Set(expectedIds), seen = new Set<string>()
  const valid: Array<{ assetId: string; result: RawAIAnalysisResult }> = []
  for (const row of (root as { results: unknown[] }).results) {
    if (!row || typeof row !== 'object') continue
    const assetId = String((row as Record<string, unknown>).assetId ?? '')
    if (!expected.has(assetId) || seen.has(assetId)) continue
    const analysis = aiAnalysisResultSchema.safeParse((row as Record<string, unknown>).analysis)
    if (!analysis.success) continue
    seen.add(assetId); valid.push({ assetId, result: analysis.data })
  }
  if (!valid.length) throw new MuseError('AI_INVALID_RESPONSE', 'Codex 批量结果没有任何通过 Muse Schema 的素材')
  return valid
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return fenced.trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim()
}
