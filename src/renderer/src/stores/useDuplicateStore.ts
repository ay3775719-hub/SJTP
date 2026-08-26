import { create } from 'zustand'
import type { DuplicateGroup, DuplicateGroupKind, DuplicateScanStatus } from '@shared/types/domain'
import { museApi } from '../api/client'

interface DuplicateStore {
  open: boolean
  loading: boolean
  filter: DuplicateGroupKind | 'all'
  groups: DuplicateGroup[]
  status: DuplicateScanStatus | null
  comparison: DuplicateGroup | null
  keepAssetId: string | null
  confirmCleanup: boolean
  error: string | null
  initialize(): Promise<void>
  openPage(): Promise<void>
  closePage(): void
  setFilter(filter: DuplicateGroupKind | 'all'): Promise<void>
  scan(): Promise<void>
  cancel(): Promise<void>
  compare(group: DuplicateGroup): void
  closeComparison(): void
  setKeepAssetId(id: string): void
  requestCleanup(): void
  cancelCleanup(): void
  ignore(groupId: string): Promise<void>
  cleanup(): Promise<void>
  refresh(): Promise<void>
}

export const useDuplicateStore = create<DuplicateStore>((set, get) => ({
  open: false, loading: false, filter: 'all', groups: [], status: null, comparison: null, keepAssetId: null, confirmCleanup: false, error: null,
  async initialize() {
    set({ status: await museApi.duplicates.status() })
    museApi.duplicates.onStatusChanged((status) => { set({ status }); if (status.state === 'completed') void get().refresh() })
  },
  async openPage() { set({ open: true }); await get().refresh() },
  closePage() { set({ open: false, comparison: null }) },
  async setFilter(filter) { set({ filter }); await get().refresh() },
  async scan() { set({ loading: true, error: null }); try { await museApi.duplicates.scan(); await get().refresh() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) } finally { set({ loading: false }) } },
  async cancel() { set({ status: await museApi.duplicates.cancel() }) },
  compare(group) { set({ comparison: group, keepAssetId: group.recommendedKeepAssetId, confirmCleanup: false }) },
  closeComparison() { set({ comparison: null, keepAssetId: null, confirmCleanup: false }) },
  setKeepAssetId(id) { set({ keepAssetId: id }) },
  requestCleanup() { set({ confirmCleanup: true }) },
  cancelCleanup() { set({ confirmCleanup: false }) },
  async ignore(groupId) { await museApi.duplicates.ignore(groupId); set((state) => ({ groups: state.groups.filter((group) => group.id !== groupId), comparison: null })) },
  async cleanup() {
    const group = get().comparison, keepAssetId = get().keepAssetId
    if (!group || !keepAssetId) return
    await museApi.duplicates.moveOthersToTrash(group.id, keepAssetId)
    set({ comparison: null, keepAssetId: null, confirmCleanup: false })
    await get().refresh()
  },
  async refresh() {
    set({ loading: true, error: null })
    try {
      const filter = get().filter
      const [groups, status] = await Promise.all([museApi.duplicates.list(filter === 'all' ? undefined : filter), museApi.duplicates.status()])
      set({ groups, status })
    } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
    finally { set({ loading: false }) }
  }
}))
