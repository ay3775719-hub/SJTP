import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIModelInfo, AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'
import type { AnalyzeImageInput, AnalyzeOptions } from '../AIProvider'
import { MuseError } from '../../../errors'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider'
import { normalizeBaseUrl, readJson, requestSignal, VISION_MODEL_PATTERN } from './providerHttp'

export class LMStudioProvider extends OpenAICompatibleProvider {
  private readonly serverRoot: string
  constructor(baseUrl = 'http://localhost:1234', getApiKey: () => string | null = () => null) {
    const root = normalizeBaseUrl(baseUrl, '/v1')
    super(`${root}/v1`, getApiKey, 'LM Studio', 'lmstudio')
    this.serverRoot = root
  }
  override getInfo(): AIProviderInfo { return { id: this.id, name: 'LM Studio', kind: 'local', defaultBaseUrl: 'http://localhost:1234', requiresApiKey: false, recommendedConcurrency: 1, available: true } }
  override async testConnection(signal?: AbortSignal): Promise<ProviderConnectionResult> {
    try {
      const models = await this.listModels(signal)
      return { providerId: this.id, status: models.length ? 'connected' : 'model_missing', message: models.length ? `已连接，检测到 ${models.length} 个视觉模型` : '已连接，但没有可用的视觉模型', models, checkedAt: new Date().toISOString() }
    } catch { return { providerId: this.id, status: 'disconnected', message: '未检测到 LM Studio，请先启动本地服务器', models: [], checkedAt: new Date().toISOString() } }
  }
  override async listModels(signal?: AbortSignal): Promise<AIModelInfo[]> {
    const endpoints = ['/api/v1/models', '/api/v0/models']
    let lastError: unknown
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${this.serverRoot}${endpoint}`, { signal: requestSignal(signal, 4_000), headers: this.headers() })
        const body = await readJson<{ models?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }>(response, 'LM Studio')
        const rows = body.models ?? body.data ?? []
        const mapped = rows.flatMap((row): AIModelInfo[] => {
          const id = String(row.id ?? row.key ?? row.model ?? '')
          if (!id) return []
          const type = String(row.type ?? row.model_type ?? '').toLowerCase()
          const reportedVision = type === 'vlm' || type.includes('vision')
          const inferredVision = reportedVision || VISION_MODEL_PATTERN.test(id)
          return inferredVision ? [{ id, name: String(row.display_name ?? row.name ?? id), providerId: this.id, capabilities: { vision: true, structuredOutput: true, text: true, local: true }, capabilitySource: reportedVision ? 'reported' : 'inferred' }] : []
        })
        return mapped
      } catch (error) { lastError = error }
    }
    throw lastError
  }
  override async analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult> {
    const models = await this.listModels(input.signal)
    if (!models.some((model) => model.id === options.modelId && model.capabilities.vision)) throw new MuseError('AI_MODEL_INCOMPATIBLE', '该 LM Studio 模型不支持图片分析，请加载视觉模型')
    return super.analyzeImage(input, options)
  }
}
