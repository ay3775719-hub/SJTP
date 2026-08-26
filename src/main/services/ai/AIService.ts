import type { AIModelInfo, AIProviderId, AIProviderInfo, AIQueueStatus, AISettings, AISmartCollectionSuggestion, AITermType, CodexAccountState, CodexLoginStartResult, CodexUsageState, ProviderConnectionResult } from '@shared/types/domain'
import type { AIAnalysisRepository } from '../../database/repositories/AIAnalysisRepository'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { SettingsRepository } from '../../database/repositories/SettingsRepository'
import { MuseError } from '../../errors'
import { AICredentialStore } from './AICredentialStore'
import { AIAnalysisQueue } from './AIAnalysisQueue'
import { AIProviderRegistry } from './AIProviderRegistry'
import type { CodexAppServerManager } from './codex/CodexAppServerManager'

export class AIAnalysisService {
  readonly queue: AIAnalysisQueue
  private readonly providers: AIProviderRegistry

  constructor(
    private readonly repository: AIAnalysisRepository,
    private readonly assets: AssetRepository,
    private readonly settings: SettingsRepository,
    private readonly credentials: AICredentialStore,
    private readonly codex: CodexAppServerManager,
    codexWorkspaceRoot: string,
    onAssetChanged: (assetId: string) => void
  ) {
    this.providers = new AIProviderRegistry(credentials, codex, codexWorkspaceRoot)
    this.repository.recoverInterruptedJobs()
    this.queue = new AIAnalysisQueue(repository, assets, (snapshot) => this.providers.create(snapshot), onAssetChanged)
    this.applyConcurrency(this.getSettings())
  }

  getSettings(): AISettings {
    const provisional = this.settings.getAISettings(false)
    return this.settings.getAISettings(this.credentials.hasSecret(provisional.providerId))
  }
  updateSettings(patch: Partial<Omit<AISettings, 'configured' | 'secretConfigured'>>): AISettings {
    const selectedId = patch.providerId ?? this.getSettings().providerId
    this.settings.updateAISettings(patch, this.credentials.hasSecret(selectedId))
    const next = this.getSettings(); this.applyConcurrency(next); return next
  }
  listProviders(): AIProviderInfo[] { return this.providers.list() }
  async detectLocalProviders(): Promise<ProviderConnectionResult[]> { return Promise.all((['ollama','lmstudio'] as const).map((id) => this.testConnection(id))) }
  async testConnection(providerId: AIProviderId): Promise<ProviderConnectionResult> { return this.providerFor(providerId).testConnection() }
  async listModels(providerId: AIProviderId): Promise<AIModelInfo[]> { return this.providerFor(providerId).listModels() }
  setProviderSecret(providerId: AIProviderId, value: string): AISettings { this.credentials.setSecret(providerId, value); return this.getSettings() }
  clearProviderSecret(providerId: AIProviderId): AISettings { this.credentials.clearSecret(providerId); return this.getSettings() }
  codexAccount(): Promise<CodexAccountState> { return this.codex.account() }
  codexLogin(deviceCode = false): Promise<CodexLoginStartResult> { return this.codex.startLogin(deviceCode) }
  codexLogout(): Promise<void> { return this.codex.logout() }
  codexUsage(): Promise<CodexUsageState> { return this.codex.usage() }
  onCodexChanged(listener: () => void): () => void { return this.codex.onChanged(listener) }

  analyze(assetIds: string[], force = false): AIQueueStatus {
    const settings = this.getSettings()
    this.assertReady(settings)
    const existing = assetIds.filter((id) => Boolean(this.assets.getFilePath(id)))
    if (!existing.length) throw new MuseError('ASSET_NOT_FOUND', '没有可分析的素材')
    this.queue.enqueue(existing, this.providers.snapshot(settings), force)
    return this.queue.status()
  }
  autoAnalyze(assetIds: string[]): void {
    const settings = this.getSettings()
    try {
      if (!settings.enabled || !settings.autoAnalyzeOnImport || !assetIds.length) return
      this.assertReady(settings)
      this.queue.enqueue(assetIds, this.providers.snapshot(settings))
    } catch { /* import must never be blocked by AI configuration or health */ }
  }
  addManualTerm(assetId: string, type: AITermType, value: string): void { this.repository.addManualTerm(assetId, type, value) }
  removeTerm(assetId: string, type: AITermType, value: string): void { this.repository.removeTerm(assetId, type, value) }
  suggestions(): AISmartCollectionSuggestion[] { return this.repository.suggestions() }

  private providerFor(providerId: AIProviderId) {
    const config = this.getSettings().providerConfigs[providerId]
    if (!config) throw new MuseError('AI_PROVIDER_UNAVAILABLE', 'AI Provider 配置不存在')
    return this.providers.create({ providerId, modelId: config.modelId, baseUrl: config.baseUrl, displayName: config.displayName })
  }
  private assertReady(settings: AISettings): void {
    if (!settings.enabled) throw new MuseError('AI_DISABLED', 'AI 分析当前已关闭')
    const info = this.providers.list().find((item) => item.id === settings.providerId)
    if (!info?.available) throw new MuseError('AI_PROVIDER_UNAVAILABLE', '所选 AI Provider 尚未实现')
    if (settings.runMode === 'local-only' && info.kind !== 'local') throw new MuseError('AI_LOCAL_ONLY', '本地模式不会把图片发送到云端，请选择 Ollama 或 LM Studio')
    if (settings.runMode === 'cloud-only' && info.kind !== 'cloud') throw new MuseError('AI_MODE_MISMATCH', '云端模式需要选择云端 Provider')
    if (settings.runMode === 'manual' && info.kind !== 'custom') throw new MuseError('AI_MODE_MISMATCH', '自定义模式需要选择 OpenAI-compatible Provider')
    if (info.kind === 'cloud' && !settings.cloudPrivacyAccepted) throw new MuseError('AI_PRIVACY_REQUIRED', '请先确认云端 AI 隐私说明')
    if (!settings.configured) throw new MuseError('AI_NOT_CONFIGURED', '尚未选择模型或配置所需凭据')
  }
  private applyConcurrency(settings: AISettings): void {
    const recommended = this.providers.list().find((item) => item.id === settings.providerId)?.recommendedConcurrency ?? 1
    this.queue.setConcurrency(Math.min(settings.concurrency, recommended))
  }
}
