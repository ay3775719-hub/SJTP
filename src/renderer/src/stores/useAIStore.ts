import { create } from 'zustand'
import type { AIModelInfo, AIProviderId, AIProviderInfo, AIQueueStatus, AISettings, CodexAccountState, CodexLoginStartResult, CodexUsageState, ProviderConnectionResult } from '@shared/types/domain'
import { museApi } from '../api/client'

interface AIState {
  settings: AISettings | null
  providers: AIProviderInfo[]
  models: Partial<Record<AIProviderId, AIModelInfo[]>>
  health: Partial<Record<AIProviderId, ProviderConnectionResult>>
  queue: AIQueueStatus
  settingsOpen: boolean
  loadingProvider: boolean
  error: string | null
  codexAccount: CodexAccountState | null
  codexUsage: CodexUsageState | null
  codexLogin: CodexLoginStartResult | null
  initialize(): Promise<void>
  openSettings(): void
  closeSettings(): void
  updateSettings(patch: Partial<Omit<AISettings, 'configured' | 'secretConfigured'>>): Promise<void>
  setProviderSecret(providerId: AIProviderId, key: string): Promise<void>
  clearProviderSecret(providerId: AIProviderId): Promise<void>
  detectLocal(): Promise<void>
  refreshModels(providerId: AIProviderId): Promise<void>
  testConnection(providerId: AIProviderId): Promise<void>
  analyze(assetIds: string[], force?: boolean): Promise<void>
  refreshCodex(): Promise<void>
  loginCodex(deviceCode?: boolean): Promise<void>
  logoutCodex(): Promise<void>
  pauseQueue(): Promise<void>
  resumeQueue(): Promise<void>
}

const emptyQueue: AIQueueStatus = { queued: 0, analyzing: 0, completed: 0, failed: 0, paused: false }
const messageFor = (error: unknown): string => error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : String(error)
let queueSubscription: (() => void) | null = null
let codexSubscription: (() => void) | null = null

export const useAIStore = create<AIState>((set, get) => ({
  settings: null, providers: [], models: {}, health: {}, queue: emptyQueue, settingsOpen: false, loadingProvider: false, error: null, codexAccount: null, codexUsage: null, codexLogin: null,
  initialize: async () => {
    const [settings, queue, providers] = await Promise.all([museApi.ai.getSettings(), museApi.ai.getQueueStatus(), museApi.ai.listProviders()])
    set({ settings, queue, providers })
    queueSubscription ??= museApi.ai.onQueueChanged((next) => set({ queue: next }))
    codexSubscription ??= museApi.ai.onCodexChanged(() => { void get().refreshCodex() })
    if (settings.providerId === 'codex-chatgpt') void get().refreshCodex()
  },
  openSettings: () => { set({ settingsOpen: true, error: null }); void get().detectLocal(); const id = get().settings?.providerId; if (id && id !== 'ollama' && id !== 'lmstudio') void get().refreshModels(id); if (id === 'codex-chatgpt') void get().refreshCodex() },
  closeSettings: () => set({ settingsOpen: false, error: null }),
  updateSettings: async (patch) => { try { set({ settings: await museApi.ai.updateSettings(patch), error: null }) } catch (error) { set({ error: messageFor(error) }) } },
  setProviderSecret: async (providerId, key) => { try { set({ settings: await museApi.ai.setProviderSecret(providerId, key), error: null }) } catch (error) { set({ error: messageFor(error) }) } },
  clearProviderSecret: async (providerId) => { try { set({ settings: await museApi.ai.clearProviderSecret(providerId), error: null }) } catch (error) { set({ error: messageFor(error) }) } },
  detectLocal: async () => {
    try { const results = await museApi.ai.detectLocalProviders(); set((state) => ({ health: { ...state.health, ...Object.fromEntries(results.map((item) => [item.providerId, item])) }, models: { ...state.models, ...Object.fromEntries(results.map((item) => [item.providerId, item.models])) } })) } catch { /* silent detection */ }
  },
  refreshModels: async (providerId) => {
    set({ loadingProvider: true, error: null })
    try { const models = await museApi.ai.listModels(providerId); set((state) => ({ models: { ...state.models, [providerId]: models }, loadingProvider: false })) }
    catch (error) { set({ loadingProvider: false, error: messageFor(error) }) }
  },
  testConnection: async (providerId) => {
    set({ loadingProvider: true, error: null })
    try { const result = await museApi.ai.testConnection(providerId); set((state) => ({ health: { ...state.health, [providerId]: result }, models: { ...state.models, [providerId]: result.models }, loadingProvider: false })) }
    catch (error) { set({ loadingProvider: false, error: messageFor(error) }) }
  },
  analyze: async (assetIds, force = false) => {
    try { set({ queue: await museApi.ai.analyzeAssets(assetIds, force), error: null }) }
    catch (error) { set({ error: messageFor(error), settingsOpen: true }); void get().detectLocal() }
  },
  refreshCodex: async () => {
    try {
      const [codexAccount, codexUsage] = await Promise.all([museApi.ai.codexAccount(), museApi.ai.codexUsage().catch(() => null)])
      set({ codexAccount, codexUsage, error: null })
    } catch (error) { set({ codexAccount: null, codexUsage: null, error: messageFor(error) }) }
  },
  loginCodex: async (deviceCode = false) => {
    try { set({ codexLogin: await museApi.ai.codexLogin(deviceCode), error: null }); void get().refreshCodex() }
    catch (error) { set({ error: messageFor(error) }) }
  },
  logoutCodex: async () => { try { await museApi.ai.codexLogout(); set({ codexAccount: null, codexUsage: null, codexLogin: null }) } catch (error) { set({ error: messageFor(error) }) } },
  pauseQueue: async () => { set({ queue: await museApi.ai.pause() }) },
  resumeQueue: async () => { set({ queue: await museApi.ai.resume() }) }
}))
