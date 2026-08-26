import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileImage, Star } from '@phosphor-icons/react'
import type { Asset } from '@shared/types/domain'
import { useAssetStore } from '../../stores/useAssetStore'
import { museApi } from '../../api/client'
import { useSmartCollectionEditorStore } from '../smartCollections/useSmartCollectionEditorStore'

interface Position { left: number; top: number; width: number; height: number }

function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => setSize({ width: element.clientWidth, height: element.clientHeight })
    update(); const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function AssetCard({ asset, position, selected }: { asset: Asset; position: Position; selected: boolean }): React.JSX.Element {
  const select = useAssetStore((state) => state.select)
  const setPreviewOpen = useAssetStore((state) => state.setPreviewOpen)
  const selectedIds = useAssetStore((state) => state.selectedIds)
  const similarity = useAssetStore((state) => state.similarity)
  const tier = similarity?.tiers[asset.id]
  return (
    <button className={`asset-card ${selected ? 'selected' : ''}`} style={{ transform: `translate3d(${position.left}px, ${position.top}px, 0)`, width: position.width, height: position.height }}
      onClick={(event) => select(asset.id, event.shiftKey ? 'range' : (event.metaKey || event.ctrlKey) ? 'toggle' : 'replace')}
      onDoubleClick={() => setPreviewOpen(true)}
      onContextMenu={(event) => { event.preventDefault(); if (!selectedIds.has(asset.id)) select(asset.id, 'replace'); void museApi.assets.showContextMenu(asset.id, selectedIds.has(asset.id) ? [...selectedIds] : [asset.id]) }}
      draggable onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData('application/x-muse-asset-id', asset.id)
        // Chromium keeps text/plain more consistently while crossing nested button/image elements.
        event.dataTransfer.setData('text/plain', asset.id)
      }} aria-label={asset.filename}>
      <img src={asset.thumbnailUrl} alt="" loading="lazy" draggable={false} />
      <span className="asset-format">{asset.extension.toUpperCase()}</span>
      {tier && <span className={`similarity-badge ${tier}`} title={`视觉相似度 ${((similarity?.scores[asset.id] ?? 0) * 100).toFixed(1)}`}>{tier === 'very_similar' ? '非常相似' : tier === 'similar' ? '相似' : '相关'}</span>}
      {asset.favorite && <Star className="asset-favorite" size={19} weight="fill" />}
    </button>
  )
}

export function VirtualizedMasonry(): React.JSX.Element {
  const assets = useAssetStore((state) => state.assets)
  const selectedIds = useAssetStore((state) => state.selectedIds)
  const loading = useAssetStore((state) => state.loading)
  const importing = useAssetStore((state) => state.importing)
  const zoom = useAssetStore((state) => state.zoom)
  const viewMode = useAssetStore((state) => state.viewMode)
  const importFromDialog = useAssetStore((state) => state.importFromDialog)
  const importPaths = useAssetStore((state) => state.importPaths)
  const query = useAssetStore((state) => state.query)
  const similarity = useAssetStore((state) => state.similarity)
  const galleryScrollTop = useAssetStore((state) => state.galleryScrollTop)
  const setGalleryScrollTop = useAssetStore((state) => state.setGalleryScrollTop)
  const loadMore = useAssetStore((state) => state.loadMore)
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(containerRef)
  const [scrollTop, setScrollTop] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    element.scrollTop = galleryScrollTop
    setScrollTop(galleryScrollTop)
  }, [similarity?.source.id])

  const layout = useMemo(() => {
    const gap = 8, contentWidth = Math.max(1, width - 40), desiredWidth = 155 + zoom * 80
    const columnCount = Math.max(1, Math.floor((contentWidth + gap) / (desiredWidth + gap)))
    const cardWidth = (contentWidth - gap * (columnCount - 1)) / columnCount
    const columns = new Array<number>(columnCount).fill(0)
    const positions = assets.map((asset) => { const column = columns.indexOf(Math.min(...columns)); const cardHeight = viewMode === 'grid' ? cardWidth * .78 : cardWidth * (asset.height / Math.max(asset.width, 1)); const position = { left: column * (cardWidth + gap), top: columns[column] ?? 0, width: cardWidth, height: cardHeight }; columns[column] = position.top + position.height + gap; return position })
    return { positions, totalHeight: Math.max(0, ...columns) - gap }
  }, [assets, viewMode, width, zoom])
  const visible = layout.positions.map((position, index) => ({ position, index })).filter(({ position }) => position.top + position.height >= scrollTop - 700 && position.top <= scrollTop + height + 700)
  const getDroppedPaths = (files: FileList): string[] => Array.from(files).map((file) => museApi.files.getPath(file)).filter(Boolean)

  return (
    <div ref={containerRef} className="gallery-scroll" onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setGalleryScrollTop(event.currentTarget.scrollTop); if (event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 900) void loadMore() }}
      onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void importPaths(getDroppedPaths(event.dataTransfer.files)) }}>
      {loading && assets.length === 0 && <div className="gallery-state">正在读取 Library…</div>}
      {!loading && assets.length === 0 && (similarity ? <div className="empty-library"><div className="empty-icon"><FileImage size={28} /></div><h2>暂时没有可比较的图片</h2><p>视觉索引会在本机后台建立；完成更多素材后结果会自动变得更完整。</p></div> : query.naturalSearch ? <div className="empty-library"><div className="empty-icon"><FileImage size={28} /></div><h2>没有找到符合这些条件的素材</h2><p>可以移除上方某个条件后重新查看；Muse 不会擅自把 AND 改成 OR。</p></div> : query.smartCollectionId ? <div className="empty-library"><div className="empty-icon"><FileImage size={28} /></div><h2>没有符合当前规则的素材</h2><p>智能集合会随着 Library 数据变化自动更新。</p><button onClick={() => { const id = query.smartCollectionId; if (id) useSmartCollectionEditorStore.getState().openEdit(id) }}>编辑规则</button></div> : query.search ? <div className="empty-library"><div className="empty-icon"><FileImage size={28} /></div><h2>没有找到相关素材</h2><p>普通搜索会匹配文件名、标签、文件夹和已有 AI 索引。</p></div> : <div className="empty-library"><div className="empty-icon"><FileImage size={28} /></div><h2>你的素材库还是空的</h2><p>拖入图片开始建立你的视觉素材库</p><button onClick={() => void importFromDialog()}>导入图片</button></div>)}
      {similarity && similarity.pendingCount > 0 && <div className="similarity-index-notice">另有 {similarity.pendingCount} 张素材正在建立本地视觉索引</div>}
      <div className="masonry-stage" style={{ height: layout.totalHeight }}>{visible.map(({ index, position }) => { const asset = assets[index]; return asset ? <AssetCard key={asset.id} asset={asset} position={position} selected={selectedIds.has(asset.id)} /> : null })}</div>
      {(dragging || importing) && <div className="drop-overlay"><div><FileImage size={32} /><strong>{importing ? '正在导入并生成缩略图…' : '释放以导入到 Muse'}</strong><span>{importing ? '请保持 Muse 打开' : '支持 JPG、PNG、WEBP、GIF'}</span></div></div>}
    </div>
  )
}
