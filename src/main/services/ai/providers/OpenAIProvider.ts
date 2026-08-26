import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIModelInfo, AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'
import type { AIProvider, AnalyzeImageInput, AnalyzeOptions } from '../AIProvider'
import { MUSE_ANALYSIS_JSON_SCHEMA, MUSE_ANALYSIS_SYSTEM_PROMPT, MUSE_ANALYSIS_USER_PROMPT, parseMuseAnalysis } from '../MuseAnalysisContract'
import { MuseError } from '../../../errors'
import { readJson, requestSignal } from './providerHttp'

const OPENAI_VISION_MODEL = /^(gpt-4(?:\.1|o)?|gpt-5|o[134])(?:[-_.:]|$)/i

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const
  constructor(private readonly getApiKey: () => string | null) {}
  getInfo(): AIProviderInfo { return { id: this.id, name: 'OpenAI', kind: 'cloud', defaultBaseUrl: 'https://api.openai.com/v1', requiresApiKey: true, recommendedConcurrency: 2, available: true } }
  async testConnection(signal?: AbortSignal): Promise<ProviderConnectionResult> {
    if (!this.getApiKey()) return { providerId: this.id, status: 'auth_failed', message: '尚未配置 OpenAI API Key', models: [], checkedAt: new Date().toISOString() }
    try {
      const models = await this.listModels(signal)
      return { providerId: this.id, status: 'connected', message: `已连接，检测到 ${models.length} 个视觉模型`, models, checkedAt: new Date().toISOString() }
    } catch (error) { return { providerId: this.id, status: error instanceof MuseError && error.code === 'AI_AUTH_FAILED' ? 'auth_failed' : 'disconnected', message: error instanceof Error ? error.message : 'OpenAI 连接失败', models: [], checkedAt: new Date().toISOString() } }
  }
  async listModels(signal?: AbortSignal): Promise<AIModelInfo[]> {
    const key = this.getApiKey()
    if (!key) return []
    const response = await fetch('https://api.openai.com/v1/models', { signal: requestSignal(signal), headers: { Authorization: `Bearer ${key}` } })
    const body = await readJson<{ data?: Array<{ id?: string }> }>(response, 'OpenAI')
    return (body.data ?? []).flatMap((row) => row.id && OPENAI_VISION_MODEL.test(row.id) ? [{ id: row.id, name: row.id, providerId: this.id, capabilities: { vision: true, structuredOutput: true, text: true, local: false }, capabilitySource: 'inferred' as const }] : [])
  }
  async analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    const apiKey = this.getApiKey()
    if (!apiKey) throw new MuseError('AI_NOT_CONFIGURED', '尚未配置 OpenAI API Key')
    if (!OPENAI_VISION_MODEL.test(options.modelId)) throw new MuseError('AI_MODEL_INCOMPATIBLE', '该 OpenAI 模型未被识别为视觉模型')
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: requestSignal(input.signal, 90_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.modelId, input: [
        { role: 'system', content: [{ type: 'input_text', text: MUSE_ANALYSIS_SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: MUSE_ANALYSIS_USER_PROMPT }, { type: 'input_image', image_url: input.dataUrl, detail: 'high' }] }
      ], text: { format: { type: 'json_schema', name: 'muse_asset_analysis', strict: true, schema: MUSE_ANALYSIS_JSON_SCHEMA } } })
    })
    const body = await readJson<{ output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }>(response, 'OpenAI')
    const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text
    if (!text) throw new MuseError('AI_INVALID_RESPONSE', 'OpenAI 没有返回可解析的结果')
    return parseMuseAnalysis(text)
  }
}
