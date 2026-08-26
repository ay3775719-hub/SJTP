import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIModelInfo, AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'
import type { AIProvider, AnalyzeImageInput, AnalyzeOptions } from '../AIProvider'
import { MUSE_ANALYSIS_JSON_SCHEMA, MUSE_ANALYSIS_SYSTEM_PROMPT, MUSE_ANALYSIS_USER_PROMPT, parseMuseAnalysis } from '../MuseAnalysisContract'
import { MuseError } from '../../../errors'
import { normalizeBaseUrl, readJson, requestSignal, VISION_MODEL_PATTERN } from './providerHttp'

export class OpenAICompatibleProvider implements AIProvider {
  readonly id
  protected readonly baseUrl: string
  constructor(baseUrl: string, protected readonly getApiKey: () => string | null, private readonly displayName = 'OpenAI-compatible', id: 'openai-compatible' | 'lmstudio' = 'openai-compatible') { this.baseUrl = normalizeBaseUrl(baseUrl); this.id = id }
  getInfo(): AIProviderInfo { return { id: this.id, name: this.displayName, kind: 'custom', defaultBaseUrl: null, requiresApiKey: false, recommendedConcurrency: 1, available: true } }

  async testConnection(signal?: AbortSignal): Promise<ProviderConnectionResult> {
    try {
      const models = await this.listModels(signal)
      const vision = models.filter((model) => model.capabilities.vision)
      return { providerId: this.id, status: vision.length ? 'connected' : models.length ? 'model_incompatible' : 'model_missing', message: vision.length ? `已连接，检测到 ${vision.length} 个视觉模型` : '服务可用，但无法确认可用的视觉模型', models, checkedAt: new Date().toISOString() }
    } catch (error) { return { providerId: this.id, status: error instanceof MuseError && error.code === 'AI_AUTH_FAILED' ? 'auth_failed' : 'disconnected', message: error instanceof Error ? error.message : '连接失败', models: [], checkedAt: new Date().toISOString() } }
  }

  async listModels(signal?: AbortSignal): Promise<AIModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`, { signal: requestSignal(signal), headers: this.headers() })
    const body = await readJson<{ data?: Array<{ id?: string }> }>(response, this.displayName)
    return (body.data ?? []).flatMap((item) => item.id ? [{ id: item.id, name: item.id, providerId: this.id, capabilities: { vision: VISION_MODEL_PATTERN.test(item.id), structuredOutput: true, text: true, local: isLocalUrl(this.baseUrl) }, capabilitySource: VISION_MODEL_PATTERN.test(item.id) ? 'inferred' as const : 'unknown' as const }] : [])
  }

  async analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    if (!options.modelId) throw new MuseError('AI_MODEL_MISSING', '请先选择模型')
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', signal: requestSignal(input.signal, 180_000), headers: this.headers(),
      body: JSON.stringify({ model: options.modelId, stream: false, temperature: 0, messages: [
        { role: 'system', content: MUSE_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: MUSE_ANALYSIS_USER_PROMPT }, { type: 'image_url', image_url: { url: input.dataUrl } }] }
      ], response_format: { type: 'json_schema', json_schema: { name: 'muse_asset_analysis', strict: true, schema: MUSE_ANALYSIS_JSON_SCHEMA } } })
    })
    const body = await readJson<{ choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> }>(response, this.displayName)
    const content = body.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : content?.find((item) => item.type === 'text')?.text
    if (!text) throw new MuseError('AI_INVALID_RESPONSE', `${this.displayName} 没有返回可解析的结果`)
    return parseMuseAnalysis(text)
  }

  protected headers(): Record<string, string> { const key = this.getApiKey(); return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } }
}

function isLocalUrl(value: string): boolean { try { const host = new URL(value).hostname; return host === 'localhost' || host === '127.0.0.1' || host === '::1' } catch { return false } }
