import { create } from 'zustand'
import type { CollectionSuggestionResult } from '@shared/types/domain'
import { museApi } from '../../api/client'

interface CollectionSuggestionState {
  result: CollectionSuggestionResult | null
  open: boolean
  loading: boolean
  error: string | null
  notice: string | null
  refresh(): Promise<void>
  openPanel(): Promise<void>
  closePanel(): void
  createCollection(signature: string): Promise<void>
  ignore(signature: string): Promise<void>
}

export const useCollectionSuggestionStore = create<CollectionSuggestionState>((set, get) => ({
  result: null, open: false, loading: false, error: null, notice: null,
  refresh: async () => {
    try { set({ loading: true, error: null }); set({ result: await museApi.collectionSuggestions.list(), loading: false }) }
    catch (error) { set({ loading: false, error: messageFor(error) }) }
  },
  openPanel: async () => { set({ open: true, notice: null }); await get().refresh() },
  closePanel: () => set({ open: false, notice: null }),
  createCollection: async (signature) => {
    try {
      const collection = await museApi.collectionSuggestions.create(signature)
      set({ notice: `已创建“${collection.name}”`, error: null })
      await get().refresh()
    } catch (error) { set({ error: messageFor(error) }) }
  },
  ignore: async (signature) => {
    try { await museApi.collectionSuggestions.ignore(signature); await get().refresh() }
    catch (error) { set({ error: messageFor(error) }) }
  }
}))

function messageFor(error: unknown): string { return error instanceof Error ? error.message : '整理建议操作失败' }
