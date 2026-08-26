import { Check, Images, Sparkle, X } from '@phosphor-icons/react'
import type { CollectionSuggestion } from '@shared/types/domain'
import { useCollectionSuggestionStore } from './useCollectionSuggestionStore'

export function CollectionSuggestionPanel(): React.JSX.Element | null {
  const store = useCollectionSuggestionStore()
  if (!store.open) return null
  const items = store.result?.items ?? []
  return (
    <div className="suggestion-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) store.closePanel() }}>
      <section className="suggestion-panel" aria-label="整理建议面板">
        <header>
          <div><span className="suggestion-title-icon"><Sparkle size={18} weight="fill" /></span><div><h2>整理建议</h2><p>Muse 根据现有素材元数据发现这些分组。创建后不会复制或移动素材。</p></div></div>
          <button className="icon-button" onClick={store.closePanel} aria-label="关闭整理建议"><X size={18} /></button>
        </header>
        {store.notice && <div className="suggestion-notice"><Check size={15} />{store.notice}</div>}
        {store.result && store.result.unAnalyzedCount > 0 && <div className="suggestion-analysis-hint">还有 {store.result.unAnalyzedCount} 张素材尚未完成 AI 分析，分析后可能出现更多建议。</div>}
        <div className="suggestion-content">
          {store.loading && !store.result && <div className="suggestion-empty"><span className="loading-spinner" /><p>正在分析 Library 中的现有元数据…</p></div>}
          {!store.loading && items.length === 0 && <div className="suggestion-empty"><Images size={30} /><h3>暂时没有新的整理建议</h3><p>随着素材增加或 AI 分析完成，Muse 会在这里发现新的分组。</p></div>}
          {items.map((suggestion) => <SuggestionCard key={suggestion.ruleSignature} suggestion={suggestion} />)}
        </div>
        {store.error && <div className="suggestion-error">{store.error}</div>}
      </section>
    </div>
  )
}

function SuggestionCard({ suggestion }: { suggestion: CollectionSuggestion }): React.JSX.Element {
  const create = useCollectionSuggestionStore((state) => state.createCollection)
  const ignore = useCollectionSuggestionStore((state) => state.ignore)
  return (
    <article className="suggestion-card">
      <div className="suggestion-card-heading"><div><h3>{suggestion.name}</h3><span>{suggestion.assetCount.toLocaleString('zh-CN')} 项素材</span></div><small>{suggestion.conditions.map((item) => item.label).join(' · ')}</small></div>
      <div className="suggestion-previews">
        {suggestion.previews.map((asset) => <div key={asset.id} title={asset.filename}><img src={asset.thumbnailUrl} alt="" loading="lazy" /></div>)}
        {suggestion.assetCount > suggestion.previews.length && <span>+{suggestion.assetCount - suggestion.previews.length}</span>}
      </div>
      <p>创建为动态智能集合，以后符合条件的新素材会自动加入。</p>
      <footer><button onClick={() => void ignore(suggestion.ruleSignature)}>忽略</button><button className="primary" onClick={() => void create(suggestion.ruleSignature)}>创建智能集合</button></footer>
    </article>
  )
}
