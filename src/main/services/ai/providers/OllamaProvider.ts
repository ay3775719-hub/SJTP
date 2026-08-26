import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIModelInfo, AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'
import type { AIProvider, AnalyzeImageInput, AnalyzeOptions } from '../AIProvider'
import { MUSE_ANALYSIS_JSON_SCHEMA, MUSE_ANALYSIS_SYSTEM_PROMPT, MUSE_ANALYSIS_USER_PROMPT, parseMuseAnalysis } from '../MuseAnalysisContract'
import { MuseError } from '../../../errors'
import { normalizeBaseUrl, readJson, requestSignal, VISION_MODEL_PATTERN } from './providerHttp'

interface OllamaModel { name?: string; model?: string; size?: number }
interface OllamaShow { capabilities?: string[] }

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const
  private readonly baseUrl: string
  constructor(baseUrl = 'http://localhost:11434') { this.baseUrl = normalizeBaseUrl(baseUrl) }
  getInfo(): AIProviderInfo { return { id: this.id, name: 'Ollama', kind: 'local', defaultBaseUrl: 'http://localhost:11434', requiresApiKey: false, recommendedConcurrency: 1, available: true } }

  async testConnection(signal?: AbortSignal): Promise<ProviderConnectionResult> {
    try {
      const models = await this.listModels(signal)
      return result(this.id, models.length ? 'connected' : 'model_missing', models.length ? `已连接，检测到 ${models.length} 个视觉模型` : '已连接，但没有可用的视觉模型', models)
    } catch { return result(this.id, 'disconnected', '未检测到 Ollama，请先启动本地服务', []) }
  }

  async listModels(signal?: AbortSignal): Promise<AIModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: requestSignal(signal, 3_000) })
    const body = await readJson<{ models?: OllamaModel[] }>(response, 'Ollama')
    const installed = body.models ?? []
    const detailed = await Promise.all(installed.map(async (model): Promise<AIModelInfo> => {
      const id = model.name ?? model.model ?? ''
      let capabilities: string[] | undefined
      try {
        const detailResponse = await fetch(`${this.baseUrl}/api/show`, { method: 'POST', signal: requestSignal(signal, 3_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id }) })
        capabilities = (await readJson<OllamaShow>(detailResponse, 'Ollama')).capabilities
      } catch { capabilities = undefined }
      const reported = Array.isArray(capabilities)
      const vision = reported ? capabilities!.includes('vision') : VISION_MODEL_PATTERN.test(id)
      return { id, name: id, providerId: this.id, size: model.size, capabilities: { vision, text: true, structuredOutput: true, local: true }, capabilitySource: reported ? 'reported' : vision ? 'inferred' : 'unknown' }
    }))
    return detailed.filter((model) => model.capabilities.vision)
  }

  async analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    const models = await this.listModels(input.signal)
    if (!models.some((model) => model.id === options.modelId && model.capabilities.vision)) throw new MuseError('AI_MODEL_INCOMPATIBLE', '该 Ollama 模型不支持图片分析，请选择视觉模型')
    const base64 = input.dataUrl.replace(/^data:[^;]+;base64,/, '')
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', signal: requestSignal(input.signal, 180_000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.modelId, stream: false, format: MUSE_ANALYSIS_JSON_SCHEMA, options: { temperature: 0 }, messages: [
        { role: 'system', content: MUSE_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: `${MUSE_ANALYSIS_USER_PROMPT}\nJSON Schema:\n${JSON.stringify(MUSE_ANALYSIS_JSON_SCHEMA)}`, images: [base64] }
      ] })
    })
    const body = await readJson<{ message?: { content?: string } }>(response, 'Ollama')
    if (!body.message?.content) throw new MuseError('AI_INVALID_RESPONSE', 'Ollama 没有返回可解析的结果')
    return parseMuseAnalysis(body.message.content)
  }
}

function result(providerId: 'ollama', status: ProviderConnectionResult['status'], message: string, models: AIModelInfo[]): ProviderConnectionResult { return { providerId, status, message, models, checkedAt: new Date().toISOString() } }
