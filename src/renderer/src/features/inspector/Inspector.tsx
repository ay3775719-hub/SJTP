import { ArrowLeft, ArrowRight, ClockCounterClockwise, DotsThree, Export, Info, MagnifyingGlass, Sparkle, Star, Trash, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import type { AIMetadata, AITermType, AIValue, AssetWebSource, ColorSwatch } from '@shared/types/domain'
import { useAssetStore } from '../../stores/useAssetStore'
import { museApi } from '../../api/client'
import { WindowControls } from '../../components/WindowControls'
import { useAIStore } from '../../stores/useAIStore'
import { useNaturalSearchStore } from '../../stores/useNaturalSearchStore'

const formatBytes = (bytes: number): string => bytes < 1_000_000 ? `${(bytes / 1000).toFixed(0)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
const formatDate = (value: string | null): string => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'

function TagChips({ items, onClick }: { items: string[]; onClick?: (value: string) => void }): React.JSX.Element {
  return <div className="tag-chips">{items.map((item) => <button key={item} onClick={() => onClick?.(item)}>{item}<span>›</span></button>)}</div>
}

function PrimaryRow({ label, item, assetId, type }: { label: string; item: AIValue | null; assetId: string; type: Extract<AITermType, 'object' | 'scene' | 'style'> }): React.JSX.Element {
  return <div className="analysis-row minimal-analysis-row"><span className="analysis-label">{label}</span>{item ? <button className="minimal-primary-value" title={`${item.source === 'manual' ? '手动' : 'AI'} · confidence ${item.confidence.toFixed(2)}`}>{item.value}<X size={10} onClick={(event) => { event.stopPropagation(); void museApi.ai.removeTerm(assetId, type, item.value) }} /></button> : <span className="muted-copy">—</span>}</div>
}

const providerLabel = (provider: string | null): string => ({
  'codex-chatgpt': 'Codex',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  openai: 'OpenAI',
  'openai-compatible': '自定义 API'
})[provider ?? ''] ?? provider ?? '未知'

function AIAnalysis({ assetId, metadata, colors }: { assetId: string; metadata: AIMetadata | null; colors: ColorSwatch[] }): React.JSX.Element {
  const settings = useAIStore((state) => state.settings)
  const analyze = useAIStore((state) => state.analyze)
  const openSettings = useAIStore((state) => state.openSettings)
  const status = metadata?.status ?? 'not_analyzed'
  if (!settings?.configured) return <section className="inspector-section ai-section"><div className="section-heading"><h3>AI 分析</h3><span className="phase-badge">未配置</span></div><p className="muted-copy">尚未配置 AI 服务。Muse 不会生成模拟分析结果。</p><button className="ai-action-button" onClick={openSettings}><Sparkle size={14} />配置 AI 服务</button></section>
  if (status === 'queued' || status === 'analyzing') return <section className="inspector-section ai-section"><div className="section-heading"><h3>AI 分析</h3><span className="phase-badge active"><span className="ai-mini-spinner" />{status === 'queued' ? '排队中' : '分析中'}</span></div><p className="muted-copy">图片已经可以继续浏览，分析结果完成后会自动出现。</p></section>
  if (status === 'failed') return <section className="inspector-section ai-section"><div className="section-heading"><h3>AI 分析</h3><span className="phase-badge failed">分析失败</span></div><p className="muted-copy">{metadata?.errorMessage ?? 'AI 服务返回错误'}</p><button className="ai-action-button" onClick={() => void analyze([assetId], true)}>重新分析</button></section>
  if (!metadata || status === 'not_analyzed') return <section className="inspector-section ai-section"><div className="section-heading"><h3>AI 分析</h3><span className="phase-badge">尚未分析</span></div><p className="muted-copy">分析结果将来自已配置的真实 AI Provider。</p><button className="ai-action-button" onClick={() => void analyze([assetId])}><Sparkle size={14} />AI 分析</button></section>
  return <section className="inspector-section ai-section"><div className="section-heading"><h3>AI 分析</h3><button onClick={() => void analyze([assetId], true)}>重新分析</button></div>
    <div className="ai-analysis-source"><span>来源</span><strong title={metadata.model ?? undefined}>{providerLabel(metadata.provider)}</strong></div>
    <PrimaryRow label="对象" item={metadata.primaryObject} assetId={assetId} type="object" />
    <PrimaryRow label="场景" item={metadata.primaryScene} assetId={assetId} type="scene" />
    <PrimaryRow label="风格" item={metadata.primaryStyle} assetId={assetId} type="style" />
    <div className="analysis-row minimal-analysis-row"><span className="analysis-label">颜色</span><div className="minimal-color-row">{colors.slice(0, 6).map((color) => <span key={color.hex} style={{ backgroundColor: color.hex }} title={color.hex} />)}</div></div>
    <div className="minimal-description"><span>描述</span><p>{metadata.description ?? '—'}</p></div>
  </section>
}

export function Inspector(): React.JSX.Element {
  const assets = useAssetStore((state) => state.assets)
  const total = useAssetStore((state) => state.total)
  const focusedId = useAssetStore((state) => state.focusedId)
  const moveFocus = useAssetStore((state) => state.moveFocus)
  const setQuery = useAssetStore((state) => state.setQuery)
  const toggleFavorite = useAssetStore((state) => state.toggleFavorite)
  const removeSelected = useAssetStore((state) => state.removeSelected)
  const restoreSelected = useAssetStore((state) => state.restoreSelected)
  const inTrash = useAssetStore((state) => state.query.deleted === true)
  const setPreviewOpen = useAssetStore((state) => state.setPreviewOpen)
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const search = useNaturalSearchStore((state) => state.input)
  const setSearch = useNaturalSearchStore((state) => state.setInput)
  const submitSearch = useNaturalSearchStore((state) => state.submit)
  const clearSearch = useNaturalSearchStore((state) => state.clear)
  const parsing = useNaturalSearchStore((state) => state.parsing)
  const history = useNaturalSearchStore((state) => state.history)
  const loadHistory = useNaturalSearchStore((state) => state.loadHistory)
  const runHistory = useNaturalSearchStore((state) => state.runHistory)
  const [searchFocused, setSearchFocused] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const asset = assets.find((item) => item.id === focusedId) ?? null
  const [sources, setSources] = useState<AssetWebSource[]>([])
  const [showAllSources, setShowAllSources] = useState(false)
  useEffect(() => {
    if (!asset) { setSources([]); return }
    const load = (): void => { void museApi.assets.sources(asset.id).then(setSources) }
    load()
    return museApi.app.onLibraryChanged((event) => { if (!event.assetIds || event.assetIds.includes(asset.id)) load() })
  }, [asset?.id])
  const index = Math.max(0, assets.findIndex((item) => item.id === focusedId))
  const folderPath = useMemo(() => asset?.folderIds.map((id) => bootstrap?.folders.find((folder) => folder.id === id)?.name).filter(Boolean).join(' > ') ?? '', [asset, bootstrap])

  return (
    <aside className="inspector">
      <div className="inspector-search app-drag-region" onDoubleClick={museApi.window.toggleMaximize}>
        <div className="search-shell no-drag">
          <label className="search-field"><MagnifyingGlass size={16} />
            <input id="asset-search" value={search} onChange={(event) => setSearch(event.target.value)}
              onFocus={() => { setSearchFocused(true); void loadHistory() }} onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); setSearchFocused(false); void submitSearch() }
                if (event.key === 'Escape') { event.preventDefault(); search ? void clearSearch() : event.currentTarget.blur() }
              }}
              placeholder="搜索素材，或试试“绿色的户外背包”" />
            {parsing ? <span className="search-spinner" /> : search && <button type="button" aria-label="清空搜索" onMouseDown={(event) => event.preventDefault()} onClick={() => void clearSearch()}><X size={11} /></button>}
          </label>
          {searchFocused && history.length > 0 && !search && <div className="search-history-popover">
            <div><ClockCounterClockwise size={12} />最近搜索</div>
            {history.map((item) => <button key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearchFocused(false); void runHistory(item) }}><span>{item.queryText}</span><small>{item.intent ? '结构化' : '关键词'}</small></button>)}
          </div>}
        </div>
        <WindowControls />
      </div>
      {!asset ? <div className="inspector-empty"><Info size={28} /><strong>未选择素材</strong><span>选择一张图片以查看详细信息</span></div> : (
        <div className="inspector-scroll">
          <div className="inspector-nav"><div><button onClick={() => moveFocus(-1)} aria-label="上一张"><ArrowLeft size={16} /></button><span>{index + 1} / {total.toLocaleString('zh-CN')}</span><button onClick={() => moveFocus(1)} aria-label="下一张"><ArrowRight size={16} /></button></div><div className="inspector-action-buttons"><button title="查看信息" onClick={() => document.getElementById('asset-metadata')?.scrollIntoView({ behavior: 'smooth' })}><Info size={17} /></button><button title="复制图片 (Ctrl+C)" onClick={() => void museApi.desktop.copyAssets([asset.id])}><Export size={17} /></button><button title="更多" onClick={() => setMoreOpen((open) => !open)}><DotsThree size={19} /></button>{moreOpen && <div className="inspector-more-menu"><button onClick={() => { setPreviewOpen(true); setMoreOpen(false) }}>打开预览</button><button onClick={() => { void museApi.desktop.showItemInFolder(asset.id); setMoreOpen(false) }}>在文件夹中显示</button>{inTrash ? <button onClick={() => { void restoreSelected(); setMoreOpen(false) }}><ClockCounterClockwise size={14} />恢复所选</button> : <button className="danger" onClick={() => { void removeSelected(); setMoreOpen(false) }}><Trash size={14} />移到回收站</button>}</div>}</div></div>
          <button className="inspector-preview" onClick={() => setPreviewOpen(true)} aria-label="打开大图预览"><img src={asset.previewUrl} alt={asset.filename} /></button>
          <div className="file-title-row"><h2>{asset.filename}</h2><button className={asset.favorite ? 'favorite active' : 'favorite'} onClick={() => void toggleFavorite(asset.id)} aria-label="收藏"><Star size={19} weight={asset.favorite ? 'fill' : 'regular'} /></button></div>
          <div id="asset-metadata" className="metadata-line"><span>{asset.extension.toUpperCase()}</span><span>{asset.width} × {asset.height}</span><span>{formatBytes(asset.size)}</span></div>
          <section className="inspector-section"><h3>文件信息</h3><p>创建：{formatDate(asset.createdAt)}<br />导入：{formatDate(asset.importedAt)}{asset.lastOpenedAt ? <><br />最近使用：{formatDate(asset.lastOpenedAt)}</> : null}</p></section>
          <AIAnalysis assetId={asset.id} metadata={asset.ai} colors={asset.colors} />
          <section className="inspector-section source-section"><div className="source-heading"><h3>来源</h3>{sources.length > 1 && <span>{sources.length}</span>}</div>
            {sources.length ? (showAllSources ? sources : sources.slice(0, 1)).map((source) => <div className="web-source" key={source.id}>
              <strong>{source.siteName || source.domain}</strong>
              {source.pageTitle && <p>{source.pageTitle}</p>}
              <div><span>{source.domain}</span><span>{formatDate(source.collectedAt)}</span></div>
              <div className="source-actions"><button onClick={() => void museApi.desktop.openExternal(source.pageUrl)}>打开原网页</button><button onClick={() => void navigator.clipboard.writeText(source.pageUrl)}>复制链接</button></div>
            </div>) : asset.sourceUrl ? <button className="source-link" onClick={() => void museApi.desktop.openExternal(asset.sourceUrl!)}>{asset.sourceUrl}</button> : <p>本地导入</p>}
            {sources.length > 1 && <button className="source-toggle" onClick={() => setShowAllSources((value) => !value)}>{showAllSources ? '收起' : '查看全部来源'}</button>}
            {!sources.length && <div><span>{asset.sourceDomain ?? (asset.importSource === 'local' ? '本地文件' : asset.importSource)}</span><span>{formatDate(asset.sourceSavedAt)}</span></div>}
          </section>
          <section className="inspector-section organization-section"><div className="organization-row"><h3>文件夹</h3><span>{folderPath || '未分类'}</span></div><div className="organization-row tags-row"><h3>标签</h3>{asset.tags.length ? <TagChips items={asset.tags.map((tag) => tag.name)} onClick={(name) => { const tag = bootstrap?.tags.find((item) => item.name === name); if (tag) void setQuery({ tagIds: [tag.id], folderId: undefined, smartCollectionId: undefined, favorite: undefined, recent: undefined, deleted: false }) }} /> : <span className="muted-copy">未添加标签</span>}</div></section>
        </div>
      )}
    </aside>
  )
}
