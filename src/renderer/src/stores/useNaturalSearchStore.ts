import { create } from 'zustand'
import type { NaturalSearchChip, NaturalSearchHistoryItem, NaturalSearchIntent } from '@shared/types/domain'
import { museApi } from '../api/client'
import { useAssetStore } from './useAssetStore'

interface NaturalSearchState {
  input: string
  queryText: string
  intent: NaturalSearchIntent | null
  chips: NaturalSearchChip[]
  parsing: boolean
  warning: string | null
  parsedBy: 'local' | 'codex' | 'cache' | 'fallback' | null
  canSave: boolean
  unAnalyzedCount: number
  history: NaturalSearchHistoryItem[]
  setInput(value: string): void
  resetPresentation(): void
  submit(value?: string, forceNatural?: boolean): Promise<void>
  clear(): Promise<void>
  removeChip(signature: string): Promise<void>
  loadHistory(): Promise<void>
  runHistory(item: NaturalSearchHistoryItem): Promise<void>
  saveAsSmartCollection(): Promise<string | null>
}

const baseQuery = () => {
  const current = useAssetStore.getState().query
  return { sort: current.sort, limit: current.limit, formats: current.formats, minRating: current.minRating }
}

export const useNaturalSearchStore = create<NaturalSearchState>((set, get) => ({
  input: '', queryText: '', intent: null, chips: [], parsing: false, warning: null, parsedBy: null,
  canSave: false, unAnalyzedCount: 0, history: [],
  setInput: (input) => set({ input }),
  resetPresentation: () => set({ input: '', queryText: '', intent: null, chips: [], warning: null, parsedBy: null, canSave: false, unAnalyzedCount: 0 }),
  submit: async (value, forceNatural = false) => {
    const queryText = (value ?? get().input).trim()
    if (!queryText) { await get().clear(); return }
    set({ input: queryText, parsing: true, warning: null })
    try {
      const result = await museApi.search.parse(queryText, forceNatural)
      if (result.mode === 'natural' && result.intent) {
        await useAssetStore.getState().loadAssets({ ...baseQuery(), naturalSearch: result.intent.expression })
      } else {
        await useAssetStore.getState().loadAssets({ ...baseQuery(), search: queryText })
      }
      set({ queryText, intent: result.intent, chips: result.chips, parsedBy: result.parsedBy, canSave: result.canSaveAsSmartCollection,
        unAnalyzedCount: result.unAnalyzedCount, warning: result.warning, parsing: false })
      void get().loadHistory()
    } catch (error) {
      await useAssetStore.getState().loadAssets({ ...baseQuery(), search: queryText })
      set({ queryText, intent: null, chips: [], parsedBy: 'fallback', canSave: false, parsing: false,
        warning: error instanceof Error ? error.message : 'Muse AI 暂时不可用，已使用普通搜索。' })
    }
  },
  clear: async () => {
    set({ input: '', queryText: '', intent: null, chips: [], warning: null, parsedBy: null, canSave: false, unAnalyzedCount: 0 })
    await useAssetStore.getState().loadAssets({ ...baseQuery() })
  },
  removeChip: async (signature) => {
    const intent = get().intent
    if (!intent) return
    const result = await museApi.search.removeCondition(intent, signature)
    if (!result.intent) { await get().clear(); return }
    await useAssetStore.getState().loadAssets({ ...baseQuery(), naturalSearch: result.intent.expression })
    set({ intent: result.intent, chips: result.chips, canSave: result.canSaveAsSmartCollection })
  },
  loadHistory: async () => { try { set({ history: await museApi.search.history(10) }) } catch { /* search remains usable */ } },
  runHistory: async (item) => {
    set({ input: item.queryText, queryText: item.queryText, warning: null })
    if (item.intent) {
      await useAssetStore.getState().loadAssets({ ...baseQuery(), naturalSearch: item.intent.expression })
      set({ intent: item.intent, chips: [], canSave: true, parsedBy: 'cache' })
      await get().submit(item.queryText)
    } else await get().submit(item.queryText)
  },
  saveAsSmartCollection: async () => {
    const { intent, queryText } = get()
    if (!intent) return null
    const collection = await museApi.search.saveAsSmartCollection(queryText, intent)
    await useAssetStore.getState().refreshFromDatabase()
    return collection.name
  }
}))
