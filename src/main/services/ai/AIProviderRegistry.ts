import type { AIJobProviderSnapshot, AIProviderId, AIProviderInfo, AISettings } from '@shared/types/domain'
import type { AICredentialStore } from './AICredentialStore'
import type { AIProvider } from './AIProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'
import { OllamaProvider } from './providers/OllamaProvider'
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider'
import { OpenAIProvider } from './providers/OpenAIProvider'
import { CodexChatGPTProvider } from './providers/CodexChatGPTProvider'
import type { CodexAppServerManager } from './codex/CodexAppServerManager'
import { MuseError } from '../../errors'

export class AIProviderRegistry {
  constructor(private readonly credentials: AICredentialStore, private readonly codex: CodexAppServerManager, private readonly codexWorkspaceRoot: string) {}

  list(): AIProviderInfo[] {
    return [
      new CodexChatGPTProvider(this.codex, this.codexWorkspaceRoot).getInfo(),
      new OllamaProvider().getInfo(), new LMStudioProvider().getInfo(),
      new OpenAIProvider(() => this.credentials.getSecret('openai')).getInfo(),
      new OpenAICompatibleProvider('http://localhost:8000/v1', () => this.credentials.getSecret('openai-compatible')).getInfo()
    ]
  }

  snapshot(settings: AISettings): AIJobProviderSnapshot {
    const config = settings.providerConfigs[settings.providerId]
    if (!config?.modelId) throw new MuseError('AI_MODEL_MISSING', '请先选择支持图片分析的模型')
    return { providerId: settings.providerId, modelId: config.modelId, baseUrl: config.baseUrl, displayName: config.displayName }
  }

  create(snapshot: AIJobProviderSnapshot): AIProvider {
    const factories: Partial<Record<AIProviderId, () => AIProvider>> = {
      'codex-chatgpt': () => new CodexChatGPTProvider(this.codex, this.codexWorkspaceRoot),
      ollama: () => new OllamaProvider(snapshot.baseUrl),
      lmstudio: () => new LMStudioProvider(snapshot.baseUrl, () => this.credentials.getSecret('lmstudio')),
      openai: () => new OpenAIProvider(() => this.credentials.getSecret('openai')),
      'openai-compatible': () => new OpenAICompatibleProvider(snapshot.baseUrl, () => this.credentials.getSecret('openai-compatible'), snapshot.displayName || 'OpenAI-compatible')
    }
    const factory = factories[snapshot.providerId]
    if (!factory) throw new MuseError('AI_PROVIDER_UNAVAILABLE', '所选 AI Provider 尚未实现')
    return factory()
  }
}
