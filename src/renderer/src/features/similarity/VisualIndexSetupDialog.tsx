import { Cpu, DownloadSimple, LockKey, X } from '@phosphor-icons/react'
import { useVisualSimilarityStore } from '../../stores/useVisualSimilarityStore'

export function VisualIndexSetupDialog(): React.JSX.Element | null {
  const store = useVisualSimilarityStore()
  if (!store.setupOpen) return null
  const progress = store.status?.preparingProgress
  const preparing = store.status?.modelState === 'preparing' || store.loading
  return <div className="smart-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !preparing) store.closeSetup() }}>
    <section className="visual-index-setup" role="dialog" aria-modal="true" aria-labelledby="visual-index-setup-title">
      <header><div className="visual-index-icon"><Cpu size={22} /></div><div><h2 id="visual-index-setup-title">准备视觉相似搜索</h2><p>首次使用需要准备 Muse 的本地视觉模型。</p></div><button disabled={preparing} onClick={store.closeSetup} aria-label="关闭"><X size={18} /></button></header>
      <div className="visual-index-setup-body">
        <div className="visual-index-facts"><span><DownloadSimple size={15} />模型约 23.3 MB</span><span><LockKey size={15} />图片只在本机处理</span></div>
        <p>模型由 Muse 自动管理。完成后会在后台为当前 Library 建立视觉索引，不使用 Codex、API Key 或云端图片分析。</p>
        {preparing && <div className="visual-model-progress"><div><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div><span>正在准备视觉模型… {Math.round((progress ?? 0) * 100)}%</span></div>}
        {store.error && <p className="settings-error">{store.error}</p>}
      </div>
      <footer><button disabled={preparing} onClick={store.closeSetup}>取消</button><button className="primary" disabled={preparing} onClick={() => void store.prepare()}>{preparing ? '正在准备…' : '开始准备'}</button></footer>
    </section>
  </div>
}
