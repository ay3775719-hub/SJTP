import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import type { AIModelInfo, AIProviderId, AIProviderInfo, ProviderConnectionResult } from '@shared/types/domain'

export interface AnalyzeImageInput {
  assetId: string
  dataUrl: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  signal?: AbortSignal
}

export interface AnalyzeOptions {
  modelId: string
}

export interface AnalyzeImageBatchInput {
  assetId: string
  localImagePath: string
}

export interface AnalyzeImageBatchResult {
  results: Array<{ assetId: string; result: RawAIAnalysisResult }>
  actualModelId: string
  promptVersion: string
  threadId: string
  durationMs: number
}

export interface AIProvider {
  readonly id: AIProviderId
  getInfo(): AIProviderInfo
  testConnection(signal?: AbortSignal): Promise<ProviderConnectionResult>
  listModels(signal?: AbortSignal): Promise<AIModelInfo[]>
  analyzeImage(input: AnalyzeImageInput, options: AnalyzeOptions): Promise<RawAIAnalysisResult>
  analyzeImageBatch?(inputs: AnalyzeImageBatchInput[], options: AnalyzeOptions & { signal?: AbortSignal }): Promise<AnalyzeImageBatchResult>
}

export function supportsBatchImages(provider: AIProvider): provider is AIProvider & Required<Pick<AIProvider, 'analyzeImageBatch'>> {
  return typeof provider.analyzeImageBatch === 'function'
}
