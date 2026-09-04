import { ArrowLeft, ArrowsOutSimple, Check, Funnel, GridFour, SlidersHorizontal, SquaresFour, Trash, WarningCircle } from '@phosphor-icons/react'
import { useState } from 'react'
import { useAssetStore } from '../../stores/useAssetStore'
import { museApi } from '../../api/client'
import { useNaturalSearchStore } from '../../stores/useNaturalSearchStore'
import { GalleryZoomControl } from './GalleryZoomControl'
import { GallerySelectionBar } from './GallerySelectionBar'

export function GalleryToolbar(): React.JSX.Element {
  const total = useAssetStore((state) => state.total)
  const query = useAssetStore((state) => state.query)
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const setQuery = useAssetStore((state) => state.setQuery)
  const setZoom = useAssetStore((state) => state.setZoom)
  const viewMode = useAssetStore((state) => state.viewMode)
  const setViewMode = useAssetStore((state) => state.setViewMode)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const naturalQuery = useNaturalSearchStore((state) => state.queryText)
  const similarity = useAssetStore((state) => state.similarity)
  const agentResultTitle = useAssetStore((state) => state.agentResultTitle)
  const exitSimilarity = useAssetStore((state) => state.exitSimilarity)
  const exitAgentResult = useAssetStore((state) => state.exitAgentResult)
  const selectedCount = useAssetStore((state) => state.selectedIds.size)
  const emptyTrash = useAssetStore((state) => state.emptyTrash)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [emptyingTrash, setEmptyingTrash] = useState(false)

  let title = '全部素材'
  if (similarity) title = '相似图片'
  else if (agentResultTitle) title = agentResultTitle
  else if (query.naturalSearch) title = `搜索：${naturalQuery || '自然语言'}`
  else if (query.search) title = `搜索：${query.search}`
  else if (query.smartCollectionId) title = bootstrap?.smartCollections.find((collection) => collection.id === query.smartCollectionId)?.name ?? '智能集合'
  else if (query.folderId) title = bootstrap?.folders.find((folder) => folder.id === query.folderId)?.name ?? '文件夹'
  else if (query.tagIds?.length) title = bootstrap?.tags.find((tag) => tag.id === query.tagIds?.[0])?.name ?? '标签'
  else if (query.favorite) title = '收藏'
  else if (query.deleted) title = '回收站'
  else if (query.recent === 'added') title = '最近添加'
  else if (query.recent === 'opened') title = '最近使用'

  const confirmEmpty = async (): Promise<void> => {
    setEmptyingTrash(true)
    const result = await emptyTrash()
    setEmptyingTrash(false)
    if (result) setConfirmEmptyTrash(false)
  }

  return <>
    <header className="gallery-toolbar app-drag-region" onDoubleClick={museApi.window.toggleMaximize}>
      <div className="gallery-title no-drag">
        {(similarity || agentResultTitle) && <button className="similarity-back" onClick={similarity ? exitSimilarity : exitAgentResult} title="返回之前的素材视图"><ArrowLeft size={16} /></button>}
        {similarity && <img className="similarity-source-thumb" src={similarity.source.thumbnailUrl} alt="" />}
        <div><strong>{title}</strong><span>{similarity ? `基于 ${similarity.source.filename} · ${total.toLocaleString('zh-CN')} 项` : `${total.toLocaleString('zh-CN')} 项素材`}</span></div>
      </div>
      <div className="toolbar-actions no-drag">
        {selectedCount > 0 ? <GallerySelectionBar /> : <>
        {query.deleted && <div className="trash-actions">
          <button className="danger" disabled={!total} onClick={() => setConfirmEmptyTrash(true)}><Trash size={15} />清空回收站</button>
        </div>}
        <GalleryZoomControl placement="toolbar" />
        <div className="segmented-control" aria-label="布局模式">
          <button className={viewMode === 'masonry' ? 'active' : ''} onClick={() => setViewMode('masonry')} title="瀑布流（保留原始比例）"><GridFour size={17} /></button>
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="整齐网格（按顺序对齐）"><SquaresFour size={17} /></button>
        </div>
        {!similarity && <div className="segmented-control">
          <button title="适合窗口" onClick={() => setZoom(0.48)}><ArrowsOutSimple size={17} /></button>
          <button className={filterOpen ? 'active' : ''} title="筛选" onClick={() => { setSortOpen(false); setFilterOpen((open) => !open) }}><Funnel size={17} /></button>
          <button className={sortOpen ? 'active' : ''} title="排序方式" onClick={() => { setFilterOpen(false); setSortOpen((open) => !open) }}><SlidersHorizontal size={17} /></button>
        </div>}
        {!similarity && filterOpen && <div className="filter-popover"><div className="filter-title">筛选</div><label><input type="checkbox" checked={query.favorite === true} onChange={(event) => void setQuery({ favorite: event.target.checked || undefined })} /> 仅收藏</label><div className="filter-title">格式</div><div className="filter-chips">{['jpg', 'png', 'webp', 'gif'].map((format) => { const active = query.formats?.includes(format) ?? false; return <button key={format} className={active ? 'active' : ''} onClick={() => void setQuery({ formats: active ? query.formats?.filter((item) => item !== format) : [...(query.formats ?? []), format] })}>{format.toUpperCase()}</button> })}</div></div>}
        {!similarity && sortOpen && <div className="sort-popover"><div className="filter-title">排列方式</div>{[
          ['imported-desc', '最新采集在前'], ['imported-asc', '最早采集在前'], ['name-asc', '文件名 A–Z'], ['name-desc', '文件名 Z–A']
        ].map(([value, label]) => <button key={value} className={(query.sort ?? 'imported-desc') === value ? 'active' : ''} onClick={() => { setSortOpen(false); void setQuery({ sort: value as NonNullable<typeof query.sort> }) }}><span>{label}</span>{(query.sort ?? 'imported-desc') === value && <Check size={14} />}</button>)}</div>}
        </>}
      </div>
    </header>
    {confirmEmptyTrash && <div className="input-dialog-backdrop"><div className="input-dialog delete-confirm trash-empty-confirm">
      <strong><WarningCircle size={18} />清空回收站？</strong>
      <p>将永久删除回收站中的 <b>{total.toLocaleString('zh-CN')}</b> 项素材、原图和缩略图。</p>
      <p>此操作无法撤销。</p>
      <div><button disabled={emptyingTrash} onClick={() => setConfirmEmptyTrash(false)}>取消</button><button className="danger-button" disabled={emptyingTrash} onClick={() => void confirmEmpty()}>{emptyingTrash ? '正在清理…' : '永久删除'}</button></div>
    </div></div>}
  </>
}
