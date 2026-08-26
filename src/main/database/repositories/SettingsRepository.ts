import type { DatabaseSync } from 'node:sqlite'
import type { AIProviderConfig, AIProviderId, AISettings, AppPreferences, VisualIndexPreferences } from '@shared/types/domain'

const DEFAULTS: AppPreferences = { sidebarWidth: 243, inspectorWidth: 402, galleryZoom: 0.48, galleryView: 'masonry' }
const DEFAULT_PROVIDER_CONFIGS: Record<AIProviderId, AIProviderConfig> = {
  'codex-chatgpt': { baseUrl: '', modelId: 'auto', displayName: 'Codex / ChatGPT' },
  ollama: { baseUrl: 'http://localhost:11434', modelId: '' },
  lmstudio: { baseUrl: 'http://localhost:1234', modelId: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', modelId: process.env.MUSE_OPENAI_MODEL?.trim() || 'gpt-4.1-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com', modelId: '' },
  anthropic: { baseUrl: 'https://api.anthropic.com', modelId: '' },
  'openai-compatible': { baseUrl: 'http://localhost:8000/v1', modelId: '', displayName: '自定义 API' }
}
const AI_DEFAULTS: Omit<AISettings, 'configured' | 'secretConfigured'> = {
  enabled: true, autoAnalyzeOnImport: false, runMode: 'cloud-only', providerId: 'codex-chatgpt',
  providerConfigs: DEFAULT_PROVIDER_CONFIGS, concurrency: 1, cloudPrivacyAccepted: false
}

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}
  getPreferences(): AppPreferences {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ui.preferences'").get() as unknown as { value: string } | undefined
    if (!row) return DEFAULTS
    try {
      const value = JSON.parse(row.value) as Partial<AppPreferences>
      return { sidebarWidth: clamp(value.sidebarWidth,190,360,DEFAULTS.sidebarWidth), inspectorWidth: clamp(value.inspectorWidth,300,520,DEFAULTS.inspectorWidth), galleryZoom: clamp(value.galleryZoom,0,1,DEFAULTS.galleryZoom), galleryView: value.galleryView === 'grid' ? 'grid' : 'masonry' }
    } catch { return DEFAULTS }
  }
  updatePreferences(patch: Partial<AppPreferences>): AppPreferences {
    const current = this.getPreferences(), next: AppPreferences = { sidebarWidth: clamp(patch.sidebarWidth,190,360,current.sidebarWidth), inspectorWidth: clamp(patch.inspectorWidth,300,520,current.inspectorWidth), galleryZoom: clamp(patch.galleryZoom,0,1,current.galleryZoom), galleryView: patch.galleryView ?? current.galleryView }
    this.save('ui.preferences', next); return next
  }

  getVisualIndexPreferences(): VisualIndexPreferences {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'visual-index.preferences'").get() as unknown as { value: string } | undefined
    if (!row) return { autoIndexOnImport: true }
    try { const value = JSON.parse(row.value) as Partial<VisualIndexPreferences>; return { autoIndexOnImport: value.autoIndexOnImport !== false } }
    catch { return { autoIndexOnImport: true } }
  }

  updateVisualIndexPreferences(patch: Partial<VisualIndexPreferences>): VisualIndexPreferences {
    const next = { ...this.getVisualIndexPreferences(), ...patch }
    this.save('visual-index.preferences', next)
    return next
  }

  getAISettings(secretConfigured = false): AISettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'ai.settings'").get() as unknown as { value: string } | undefined
    let value: Record<string, unknown> = {}
    try { value = row ? JSON.parse(row.value) as Record<string, unknown> : {} } catch { value = {} }
    const storedConfigs = typeof value.providerConfigs === 'object' && value.providerConfigs ? value.providerConfigs as Partial<Record<AIProviderId, Partial<AIProviderConfig>>> : {}
    const storedProviderId = isProviderId(value.providerId) ? value.providerId : null
    const legacyUnusedLocalDefault = storedProviderId === 'ollama' && !storedConfigs.ollama?.modelId?.trim() && value.runMode === 'local-only'
    const providerId = legacyUnusedLocalDefault ? 'codex-chatgpt' : (storedProviderId ?? AI_DEFAULTS.providerId)
    if (typeof value.model === 'string' && value.model.trim()) storedConfigs.openai = { ...(storedConfigs.openai ?? {}), modelId: value.model.trim() }
    const providerConfigs = Object.fromEntries(Object.entries(DEFAULT_PROVIDER_CONFIGS).map(([id, defaults]) => {
      const stored = storedConfigs[id as AIProviderId]
      return [id, { ...defaults, ...stored, baseUrl: cleanUrl(stored?.baseUrl ?? defaults.baseUrl), modelId: stored?.modelId?.trim() ?? defaults.modelId }]
    })) as Record<AIProviderId, AIProviderConfig>
    const selected = providerConfigs[providerId]
    const requiresSecret = providerId === 'openai' || providerId === 'gemini' || providerId === 'anthropic'
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : AI_DEFAULTS.enabled,
      autoAnalyzeOnImport: typeof value.autoAnalyzeOnImport === 'boolean' ? value.autoAnalyzeOnImport : AI_DEFAULTS.autoAnalyzeOnImport,
      runMode: legacyUnusedLocalDefault ? 'cloud-only' : (value.runMode === 'cloud-only' || value.runMode === 'manual' || value.runMode === 'local-only' ? value.runMode : AI_DEFAULTS.runMode),
      providerId, providerConfigs, concurrency: clamp(typeof value.concurrency === 'number' ? value.concurrency : undefined,1,5,providerId === 'ollama' || providerId === 'lmstudio' ? 1 : 2),
      cloudPrivacyAccepted: typeof value.cloudPrivacyAccepted === 'boolean' ? value.cloudPrivacyAccepted : false,
      secretConfigured,
      configured: Boolean(selected.modelId && (!requiresSecret || secretConfigured))
    }
  }

  updateAISettings(patch: Partial<Omit<AISettings, 'configured' | 'secretConfigured'>>, secretConfigured = false): AISettings {
    const current = this.getAISettings(secretConfigured)
    const providerConfigs = { ...current.providerConfigs }
    for (const [id, config] of Object.entries(patch.providerConfigs ?? {}) as Array<[AIProviderId, AIProviderConfig]>) {
      providerConfigs[id] = { ...(providerConfigs[id] ?? DEFAULT_PROVIDER_CONFIGS[id]), ...config, baseUrl: cleanUrl(config.baseUrl), modelId: config.modelId.trim() }
    }
    const next = { ...current, ...patch, providerConfigs, configured: undefined, secretConfigured: undefined }
    this.save('ai.settings', next)
    return this.getAISettings(secretConfigured)
  }

  private save(key: string, value: unknown): void {
    this.db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, JSON.stringify(value))
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback }
function cleanUrl(value: string): string { return value.trim().replace(/\/+$/, '') }
function isProviderId(value: unknown): value is AIProviderId { return ['codex-chatgpt','ollama','lmstudio','openai','gemini','anthropic','openai-compatible'].includes(String(value)) }
