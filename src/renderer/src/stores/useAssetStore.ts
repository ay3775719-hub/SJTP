import { create } from 'zustand'
import type { Asset, AssetQuery, BootstrapPayload, TrashPurgeResult, VisualSimilarityResult } from '@shared/types/domain'

interface SimilarityView {
  source: Asset
  scores: Record<string, number>
  tiers: Record<string, 'very_similar' | 'similar' | 'related'>
  indexedCount: number
  pendingCount: number
  searchMs: number
}

interface PreviousGalleryView { assets: Asset[]; total: number; nextCursor: string | null; query: AssetQuery; selectedIds: Set<string>; focusedId: string | null; anchorId: string | null; scrollTop: number }
import { museApi } from '../api/client'
import { showNotice, useNoticeStore } from './useNoticeStore'

interface AssetState {
  bootstrap: BootstrapPayload | null
  assets: Asset[]
  total: number
  nextCursor: string | null
  query: AssetQuery
  selectedIds: Set<string>
  focusedId: string | null
  anchorId: string | null
  loading: boolean
  importing: boolean
  loadingMore: boolean
  error: string | null
  zoom: number
  viewMode: 'masonry' | 'grid'
  previewOpen: boolean
  previewContext: { assets: Asset[]; focusedId: string } | null
  undoDeletedIds: string[]
  similarity: SimilarityView | null
  agentResultTitle: string | null
  previousGalleryView: PreviousGalleryView | null
  galleryScrollTop: number
  initialize(): Promise<void>
  refreshFromDatabase(): Promise<void>
  loadAssets(nextQuery?: AssetQuery): Promise<void>
  loadMore(): Promise<void>
  setQuery(patch: Partial<AssetQuery>): Promise<void>
  select(id: string, mode: 'replace' | 'toggle' | 'range'): void
  selectAll(): void
  clearSelection(): void
  moveFocus(delta: number): void
  setZoom(value: number): void
  setViewMode(value: 'masonry' | 'grid'): void
  setPreviewOpen(open: boolean): void
  openPreviewContext(assets: Asset[], focusedId: string): void
  movePreviewFocus(delta: number): void
  toggleFavorite(id: string): Promise<void>
  setSelectedFavorite(favorite: boolean): Promise<void>
  importFromDialog(): Promise<void>
  importPaths(paths: string[]): Promise<void>
  removeSelected(): Promise<void>
  restoreSelected(): Promise<void>
  emptyTrash(): Promise<TrashPurgeResult | null>
  undo(): Promise<void>
  enterSimilarity(result: VisualSimilarityResult): void
  exitSimilarity(): void
  enterAgentSearch(title: string, resultSetId: string): Promise<void>
  exitAgentResult(): void
  setGalleryScrollTop(value: number): void
}

const messageFor = (error: unknown): string => error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : String(error)

export const useAssetStore = create<AssetState>((set, get) => ({
  bootstrap: null,
  assets: [], total: 0, nextCursor: null,
  query: { sort: 'imported-desc', limit: 160 },
  selectedIds: new Set(),
  focusedId: null,
  anchorId: null,
  loading: true,
  importing: false, loadingMore: false,
  error: null,
  zoom: 0.48,
  viewMode: 'masonry',
  previewOpen: false,
  previewContext: null,
  undoDeletedIds: [],
  similarity: null, agentResultTitle: null, previousGalleryView: null, galleryScrollTop: 0,

  initialize: async () => {
    set({ loading: true, error: null })
    try {
      const bootstrap = await museApi.app.getBootstrap()
      const query = get().query
      const page = await museApi.assets.list(query)
      set({
        bootstrap, assets: page.items, total: page.total, nextCursor: page.nextCursor, loading: false,
        zoom: bootstrap.preferences.galleryZoom, viewMode: bootstrap.preferences.galleryView,
        focusedId: null, selectedIds: new Set(), anchorId: null
      })
    } catch (error) { set({ error: messageFor(error), loading: false }) }
  },

  refreshFromDatabase: async () => {
    try {
      const state = get()
      const bootstrap = await museApi.app.getBootstrap()
      if (state.similarity) {
        const result = await museApi.visualSimilarity.findSimilar(state.similarity.source.id)
        const scores = Object.fromEntries(result.results.map((item) => [item.asset.id, item.score]))
        const tiers = Object.fromEntries(result.results.map((item) => [item.asset.id, item.tier])) as SimilarityView['tiers']
        set({ bootstrap, assets: result.results.map((item) => item.asset), total: result.results.length, nextCursor: null, similarity: { source: result.source, scores, tiers, indexedCount: result.indexedCount, pendingCount: result.pendingCount, searchMs: result.searchMs } })
        return
      }
      const activeCollectionExists = !state.query.smartCollectionId || bootstrap.smartCollections.some((collection) => collection.id === state.query.smartCollectionId)
      const query = activeCollectionExists ? state.query : { ...state.query, smartCollectionId: undefined }
      const page = await museApi.assets.list(query)
      const focusedStillExists = page.items.some((asset) => asset.id === state.focusedId)
      const selected = new Set([...state.selectedIds].filter((id) => page.items.some((asset) => asset.id === id)))
      set({ bootstrap, query, assets: page.items, total: page.total, nextCursor: page.nextCursor, ...(focusedStillExists ? { selectedIds: selected } : { focusedId: null, selectedIds: new Set<string>(), anchorId: null, previewOpen: false }) })
    } catch (error) { set({ error: messageFor(error) }) }
  },

  loadAssets: async (nextQuery) => {
    const query = nextQuery ?? get().query
    set({ loading: true, error: null })
    try {
      const page = await museApi.assets.list(query)
      const focusedStillExists = page.items.some((asset) => asset.id === get().focusedId)
      const effectiveQuery = page.resultSetId ? { ...query, searchResultSetId: page.resultSetId } : query
      set({ assets: page.items, total: page.total, nextCursor: page.nextCursor, loading: false, query: effectiveQuery, similarity: null, agentResultTitle: null, previousGalleryView: null, ...(focusedStillExists ? {} : { focusedId: null, selectedIds: new Set<string>(), anchorId: null }) })
    } catch (error) { set({ error: messageFor(error), loading: false }) }
  },

  loadMore: async () => {
    const { nextCursor, loadingMore, query, similarity } = get()
    if (similarity) return
    if (!nextCursor || loadingMore) return
    set({ loadingMore: true })
    try {
      const page = await museApi.assets.list({ ...query, cursor: nextCursor })
      set((state) => ({ assets: [...state.assets, ...page.items], total: page.total, nextCursor: page.nextCursor }))
    } catch (error) { set({ error: messageFor(error) }) }
    finally { set({ loadingMore: false }) }
  },

  setQuery: async (patch) => {
    const query = { ...get().query, ...patch, cursor: undefined }
    await get().loadAssets(query)
  },

  select: (id, mode) => set((state) => {
    const selected = new Set(state.selectedIds)
    if (mode === 'replace') { selected.clear(); selected.add(id) }
    if (mode === 'toggle') selected.has(id) ? selected.delete(id) : selected.add(id)
    if (mode === 'range') {
      const start = state.assets.findIndex((asset) => asset.id === (state.anchorId ?? id))
      const end = state.assets.findIndex((asset) => asset.id === id)
      selected.clear()
      state.assets.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((asset) => selected.add(asset.id))
    }
    return { selectedIds: selected, focusedId: id, anchorId: mode === 'range' ? state.anchorId : id }
  }),

  selectAll: () => set((state) => ({ selectedIds: new Set(state.assets.map((asset) => asset.id)), focusedId: state.focusedId ?? state.assets[0]?.id ?? null })),
  clearSelection: () => set({ selectedIds: new Set(), focusedId: null, anchorId: null }),
  moveFocus: (delta) => set((state) => {
    if (!state.assets.length) return state
    const current = Math.max(0, state.assets.findIndex((asset) => asset.id === state.focusedId))
    const next = state.assets[Math.min(state.assets.length - 1, Math.max(0, current + delta))]
    return next ? { focusedId: next.id, selectedIds: new Set([next.id]), anchorId: next.id } : state
  }),

  setZoom: (zoom) => {
    const clampedZoom = Math.min(1, Math.max(0, zoom))
    set({ zoom: clampedZoom })
    void museApi.app.updatePreferences({ galleryZoom: clampedZoom })
  },
  setViewMode: (viewMode) => {
    set({ viewMode })
    void museApi.app.updatePreferences({ galleryView: viewMode })
  },
  setPreviewOpen: (previewOpen) => {
    set({ previewOpen, ...(previewOpen ? {} : { previewContext: null }) })
  },
  openPreviewContext: (assets, focusedId) => {
    if (!assets.some((asset) => asset.id === focusedId)) return
    set({ previewOpen: true, previewContext: { assets, focusedId } })
  },
  movePreviewFocus: (delta) => set((state) => {
    const assets = state.previewContext?.assets ?? state.assets
    const focusedId = state.previewContext?.focusedId ?? state.focusedId
    const current = Math.max(0, assets.findIndex((asset) => asset.id === focusedId))
    const next = assets[Math.min(assets.length - 1, Math.max(0, current + delta))]
    if (!next) return state
    return state.previewContext
      ? { previewContext: { ...state.previewContext, focusedId: next.id } }
      : { focusedId: next.id, selectedIds: new Set([next.id]), anchorId: next.id }
  }),
  toggleFavorite: async (id) => {
    try { await museApi.assets.toggleFavorite(id) }
    catch (error) { set({ error: messageFor(error) }) }
  },
  setSelectedFavorite: async (favorite) => {
    const ids = [...get().selectedIds]
    if (!ids.length) return
    try {
      const affectedCount = await museApi.assets.setFavorite(ids, favorite)
      showNotice(favorite ? `已收藏 ${affectedCount} 项素材` : `已取消收藏 ${affectedCount} 项素材`, 'success')
    } catch (error) { showNotice('收藏操作失败', 'error', messageFor(error)) }
  },
  importFromDialog: async () => {
    set({ importing: true, error: null })
    try {
      const result = await museApi.desktop.openFileDialog(get().query.folderId)
      showImportResult(result)
    }
    catch (error) { showNotice('导入失败', 'error', messageFor(error)) }
    finally { set({ importing: false }) }
  },
  importPaths: async (paths) => {
    if (!paths.length) return
    set({ importing: true, error: null })
    try {
      const result = await museApi.assets.importPaths(paths, get().query.folderId)
      showImportResult(result)
    }
    catch (error) { showNotice('导入失败', 'error', messageFor(error)) }
    finally { set({ importing: false }) }
  },
  removeSelected: async () => {
    const ids = [...get().selectedIds]
    if (!ids.length) return
    try {
      await museApi.assets.remove(ids); set({ undoDeletedIds: ids })
      useNoticeStore.getState().show({
        message: `已将 ${ids.length} 项素材移到回收站`, tone: 'success', actionLabel: '撤销',
        action: async () => {
          await museApi.assets.restore(ids)
          set({ undoDeletedIds: [] })
          showNotice('素材已恢复', 'success')
        }
      })
    }
    catch (error) { showNotice('无法移到回收站', 'error', messageFor(error)) }
  },
  restoreSelected: async () => {
    const ids = [...get().selectedIds]
    if (!ids.length) return
    try {
      await museApi.assets.restore(ids)
      set({ selectedIds: new Set(), focusedId: null, anchorId: null, previewOpen: false })
      await get().refreshFromDatabase()
      showNotice(`已恢复 ${ids.length} 项素材`, 'success')
    } catch (error) { showNotice('恢复失败', 'error', messageFor(error)) }
  },
  emptyTrash: async () => {
    try {
      const result = await museApi.assets.emptyTrash()
      set({ selectedIds: new Set(), focusedId: null, anchorId: null, previewOpen: false, undoDeletedIds: [], error: null })
      await get().refreshFromDatabase()
      showNotice(`已永久清理 ${result.deletedCount} 项素材`, 'success', result.fileCleanupPending ? '部分缓存文件将在稍后清理' : undefined)
      return result
    } catch (error) { showNotice('清空回收站失败', 'error', messageFor(error)); return null }
  },
  undo: async () => {
    const ids = get().undoDeletedIds
    if (!ids.length) return
    try { await museApi.assets.restore(ids); set({ undoDeletedIds: [] }) }
    catch (error) { set({ error: messageFor(error) }) }
  },
  enterSimilarity: (result) => set((state) => {
    const previousGalleryView = state.previousGalleryView ?? { assets: state.assets, total: state.total, nextCursor: state.nextCursor, query: state.query, selectedIds: state.selectedIds, focusedId: state.focusedId, anchorId: state.anchorId, scrollTop: state.galleryScrollTop }
    const scores = Object.fromEntries(result.results.map((item) => [item.asset.id, item.score]))
    const tiers = Object.fromEntries(result.results.map((item) => [item.asset.id, item.tier])) as SimilarityView['tiers']
    const assets = result.results.map((item) => item.asset), focusedId = assets[0]?.id ?? null
    return { previousGalleryView, agentResultTitle: null, similarity: { source: result.source, scores, tiers, indexedCount: result.indexedCount, pendingCount: result.pendingCount, searchMs: result.searchMs }, assets, total: assets.length, nextCursor: null, focusedId, selectedIds: focusedId ? new Set([focusedId]) : new Set<string>(), anchorId: focusedId, loading: false, galleryScrollTop: 0 }
  }),
  exitSimilarity: () => set((state) => {
    if (!state.previousGalleryView) return { similarity: null, previousGalleryView: null }
    const { scrollTop, ...view } = state.previousGalleryView
    return { ...view, galleryScrollTop: scrollTop, similarity: null, previousGalleryView: null }
  }),
  enterAgentSearch: async (title, resultSetId) => {
    const state = get()
    const previousGalleryView = state.previousGalleryView ?? { assets: state.assets, total: state.total, nextCursor: state.nextCursor, query: state.query, selectedIds: state.selectedIds, focusedId: state.focusedId, anchorId: state.anchorId, scrollTop: state.galleryScrollTop }
    set({ loading: true, error: null })
    try {
      const query: AssetQuery = { searchResultSetId: resultSetId, sort: 'imported-desc', limit: 160 }
      const page = await museApi.assets.list(query)
      const focusedId = page.items[0]?.id ?? null
      set({ previousGalleryView, agentResultTitle: title, similarity: null, query, assets: page.items, total: page.total, nextCursor: page.nextCursor, focusedId, selectedIds: focusedId ? new Set([focusedId]) : new Set<string>(), anchorId: focusedId, loading: false, galleryScrollTop: 0 })
    } catch (error) { set({ error: messageFor(error), loading: false }) }
  },
  exitAgentResult: () => set((state) => {
    if (!state.previousGalleryView) return { agentResultTitle: null, previousGalleryView: null }
    const { scrollTop, ...view } = state.previousGalleryView
    return { ...view, galleryScrollTop: scrollTop, agentResultTitle: null, similarity: null, previousGalleryView: null }
  }),
  setGalleryScrollTop: (galleryScrollTop) => set({ galleryScrollTop })
}))

function showImportResult(result: { imported: Asset[]; duplicateIds: string[]; failures: Array<{ path: string; message: string }> }): void {
  if (!result.imported.length && !result.duplicateIds.length && !result.failures.length) return
  const parts: string[] = []
  if (result.duplicateIds.length) parts.push(`${result.duplicateIds.length} 项已存在`)
  if (result.failures.length) parts.push(`${result.failures.length} 项失败`)
  if (result.imported.length) showNotice(`已导入 ${result.imported.length} 项素材`, result.failures.length ? 'info' : 'success', parts.join(' · ') || undefined)
  else if (result.duplicateIds.length && !result.failures.length) showNotice('所选素材已经在 Muse 中', 'info')
  else showNotice('没有导入素材', 'error', parts.join(' · '))
}
