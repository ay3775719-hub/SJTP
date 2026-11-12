// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetPage, AssetQuery } from '@shared/types/domain'

const api = vi.hoisted(() => ({ list: vi.fn(), getBootstrap: vi.fn() }))
vi.mock('../api/client', () => ({ museApi: { assets: { list: api.list }, app: { getBootstrap: api.getBootstrap } } }))
import { useAssetStore } from './useAssetStore'

const assets = Array.from({ length: 1120 }, (_, index) => ({ id: `asset-${index}`, filename: `${index}.jpg` } as Asset))
const pageFor = (query: AssetQuery, rows = assets): AssetPage => {
  const offset = Number(query.cursor ?? 0)
  const items = rows.slice(offset, offset + Math.min(query.limit ?? 160, 500))
  return { items, total: rows.length, nextCursor: offset + items.length < rows.length ? String(offset + items.length) : null }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.getBootstrap.mockResolvedValue({ smartCollections: [] })
  api.list.mockImplementation(async (query: AssetQuery) => pageFor(query))
  useAssetStore.setState({ ...useAssetStore.getInitialState(), loading: false, assets: assets.slice(0, 640), total: assets.length, nextCursor: '640', focusedId: 'asset-530', selectedIds: new Set(['asset-530']), anchorId: 'asset-530', previewOpen: true, galleryScrollTop: 19000 })
})

describe('Gallery refresh while previewing paginated results', () => {
  it('keeps all loaded pages, preview, selection and scroll when opening a later image updates metadata', async () => {
    await useAssetStore.getState().refreshFromDatabase()
    const state = useAssetStore.getState()
    expect(api.list.mock.calls.map(([query]) => query.cursor)).toEqual([undefined, '160', '320', '480'])
    expect(state.assets).toHaveLength(640)
    expect(state.nextCursor).toBe('640')
    expect(state.focusedId).toBe('asset-530')
    expect([...state.selectedIds]).toEqual(['asset-530'])
    expect(state.previewOpen).toBe(true)
    expect(state.galleryScrollTop).toBe(19000)
    await state.loadMore()
    expect(useAssetStore.getState().assets).toHaveLength(800)
    expect(new Set(useAssetStore.getState().assets.map(asset => asset.id)).size).toBe(800)
  })

  it('keeps a newer selection made while the refresh is pending', async () => {
    let resume!: () => void
    api.getBootstrap.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({ smartCollections: [] }) }))
    const refresh = useAssetStore.getState().refreshFromDatabase()
    useAssetStore.getState().select('asset-540', 'replace')
    resume()
    await refresh
    expect(useAssetStore.getState().focusedId).toBe('asset-540')
    expect([...useAssetStore.getState().selectedIds]).toEqual(['asset-540'])
  })

  it('does not restore an old folder after navigation during a refresh', async () => {
    let resume!: () => void
    api.getBootstrap.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({ smartCollections: [] }) }))
    const refresh = useAssetStore.getState().refreshFromDatabase()
    const newAssets = assets.slice(0, 3)
    useAssetStore.setState({ query: { folderId: 'another-folder', limit: 160 }, assets: newAssets })
    resume()
    await refresh
    expect(useAssetStore.getState().query.folderId).toBe('another-folder')
    expect(useAssetStore.getState().assets).toEqual(newAssets)
  })

  it('closes preview if the focused image really was removed from the query', async () => {
    api.list.mockImplementation(async (query: AssetQuery) => pageFor(query, assets.filter(asset => asset.id !== 'asset-530')))
    await useAssetStore.getState().refreshFromDatabase()
    expect(useAssetStore.getState().previewOpen).toBe(false)
    expect(useAssetStore.getState().focusedId).toBeNull()
  })

  it('ignores an obsolete load-more response after a refresh already advanced its cursor', async () => {
    let resume!: () => void
    api.list.mockImplementationOnce((query: AssetQuery) => new Promise(resolve => { resume = () => resolve(pageFor(query)) }))
    const more = useAssetStore.getState().loadMore()
    useAssetStore.setState({ assets: assets.slice(0, 800), nextCursor: '800' })
    resume()
    await more
    expect(useAssetStore.getState().assets).toHaveLength(800)
    expect(useAssetStore.getState().nextCursor).toBe('800')
  })
})

describe('Remembering folder browsing positions', () => {
  it('restores independent scroll positions, loaded ranges and selection when returning to folders', async () => {
    useAssetStore.setState({ query: { folderId: 'autumn', limit: 160, sort: 'imported-desc' } })
    await useAssetStore.getState().setQuery({ folderId: 'poses' })
    expect(useAssetStore.getState().galleryScrollTop).toBe(0)
    expect(useAssetStore.getState().focusedId).toBeNull()
    useAssetStore.getState().setGalleryScrollTop(1200)
    useAssetStore.getState().select('asset-12', 'replace')
    await useAssetStore.getState().setQuery({ folderId: 'autumn' })
    let state = useAssetStore.getState()
    expect(state.assets).toHaveLength(640)
    expect(state.galleryScrollTop).toBe(19000)
    expect(state.focusedId).toBe('asset-530')
    expect([...state.selectedIds]).toEqual(['asset-530'])
    expect(state.anchorId).toBe('asset-530')
    expect(state.previewOpen).toBe(false)
    await state.setQuery({ folderId: 'poses' })
    state = useAssetStore.getState()
    expect(state.assets).toHaveLength(160)
    expect(state.galleryScrollTop).toBe(1200)
    expect(state.focusedId).toBe('asset-12')
  })

  it('starts new folders at the top without inheriting another folder selection', async () => {
    await useAssetStore.getState().setQuery({ folderId: 'new-folder' })
    expect(useAssetStore.getState().galleryScrollTop).toBe(0)
    expect(useAssetStore.getState().selectedIds.size).toBe(0)
    expect(useAssetStore.getState().assets).toHaveLength(160)
  })

  it('ignores a slower folder response after the user switches again', async () => {
    let resume!: () => void
    api.list.mockImplementationOnce((query: AssetQuery) => new Promise(resolve => { resume = () => resolve(pageFor(query)) }))
    const slow = useAssetStore.getState().setQuery({ folderId: 'slow-folder' })
    await useAssetStore.getState().setQuery({ folderId: 'latest-folder' })
    useAssetStore.getState().setGalleryScrollTop(800)
    resume()
    await slow
    expect(useAssetStore.getState().query.folderId).toBe('latest-folder')
    expect(useAssetStore.getState().galleryScrollTop).toBe(800)
  })

  it('re-queries saved folders and drops selected assets that have since been removed', async () => {
    useAssetStore.setState({ query: { folderId: 'autumn', limit: 160 } })
    await useAssetStore.getState().setQuery({ folderId: 'poses' })
    api.list.mockImplementation(async (query: AssetQuery) => pageFor(query, assets.filter(asset => asset.id !== 'asset-530')))
    await useAssetStore.getState().setQuery({ folderId: 'autumn' })
    expect(useAssetStore.getState().focusedId).toBeNull()
    expect(useAssetStore.getState().selectedIds.size).toBe(0)
    expect(useAssetStore.getState().assets.some(asset => asset.id === 'asset-530')).toBe(false)
  })
})
