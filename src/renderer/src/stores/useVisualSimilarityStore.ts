import { create } from 'zustand'
import type { VisualIndexStatus } from '@shared/types/domain'
import { museApi } from '../api/client'
import { useAssetStore } from './useAssetStore'

interface VisualSimilarityState {
  status: VisualIndexStatus | null
  setupOpen: boolean
  pendingAssetId: string | null
  loading: boolean
  error: string | null
  initialize(): Promise<void>
  findSimilar(assetId: string): Promise<void>
  prepare(): Promise<void>
  closeSetup(): void
  pause(): Promise<void>
  resume(): Promise<void>
  rebuild(): Promise<void>
  updateAutoIndex(value: boolean): Promise<void>
}

let statusSubscription: (() => void) | null = null
const messageFor = (error: unknown): string => error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : String(error)

export const useVisualSimilarityStore = create<VisualSimilarityState>((set, get) => ({
  status: null, setupOpen: false, pendingAssetId: null, loading: false, error: null,
  initialize: async () => {
    try {
      set({ status: await museApi.visualSimilarity.getStatus() })
      statusSubscription ??= museApi.visualSimilarity.onStatusChanged((status) => set({ status }))
    } catch (error) { set({ error: messageFor(error) }) }
  },
  findSimilar: async (assetId) => {
    if (get().status?.modelState !== 'ready') { set({ setupOpen: true, pendingAssetId: assetId, error: null }); return }
    set({ loading: true, error: null })
    try { useAssetStore.getState().enterSimilarity(await museApi.visualSimilarity.findSimilar(assetId)) }
    catch (error) { set({ error: messageFor(error) }) }
    finally { set({ loading: false }) }
  },
  prepare: async () => {
    set({ loading: true, error: null })
    try {
      set({ status: await museApi.visualSimilarity.prepare() })
      const assetId = get().pendingAssetId
      set({ setupOpen: false, pendingAssetId: null })
      if (assetId) await get().findSimilar(assetId)
    } catch (error) { set({ error: messageFor(error) }) }
    finally { set({ loading: false }) }
  },
  closeSetup: () => set({ setupOpen: false, pendingAssetId: null, error: null }),
  pause: async () => set({ status: await museApi.visualSimilarity.pause() }),
  resume: async () => set({ status: await museApi.visualSimilarity.resume() }),
  rebuild: async () => { set({ loading: true, error: null }); try { set({ status: await museApi.visualSimilarity.rebuild() }) } catch (error) { set({ error: messageFor(error) }) } finally { set({ loading: false }) } },
  updateAutoIndex: async (value) => set({ status: await museApi.visualSimilarity.updatePreferences(value) })
}))
