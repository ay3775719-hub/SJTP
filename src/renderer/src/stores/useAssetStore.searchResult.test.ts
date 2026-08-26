// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'

const list = vi.fn(async () => ({ items: [], total: 12, nextCursor: null, resultSetId: 'result-set-12' }))
const updatePreferences = vi.fn(async () => ({ galleryZoom: 0.48, galleryView: 'masonry', sidebarWidth: 243, inspectorWidth: 402 }))

describe('Gallery agent search result sets', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'muse', { configurable: true, value: { assets: { list }, app: { updatePreferences } } })
  })

  it('loads the Muse-owned result set total instead of treating tool previews as Gallery results', async () => {
    const { useAssetStore } = await import('./useAssetStore')
    await useAssetStore.getState().enterAgentSearch('Muse AI 搜索结果', 'result-set-12')
    const state = useAssetStore.getState()
    expect(list).toHaveBeenCalledWith({ searchResultSetId: 'result-set-12', sort: 'imported-desc', limit: 160 })
    expect(state.total).toBe(12)
    expect(state.query.searchResultSetId).toBe('result-set-12')
    expect(state.agentResultTitle).toBe('Muse AI 搜索结果')
  })

  it('clamps and persists Gallery zoom instead of allowing the slider state to drift', async () => {
    const { useAssetStore } = await import('./useAssetStore')
    useAssetStore.getState().setZoom(2)
    expect(useAssetStore.getState().zoom).toBe(1)
    expect(updatePreferences).toHaveBeenLastCalledWith({ galleryZoom: 1 })
    useAssetStore.getState().setZoom(-1)
    expect(useAssetStore.getState().zoom).toBe(0)
    expect(updatePreferences).toHaveBeenLastCalledWith({ galleryZoom: 0 })
  })
})
