import { ArrowsClockwise, Check, Copy, Images, ShieldCheck, Trash, WarningCircle, X } from '@phosphor-icons/react'
import type { DuplicateGroup } from '@shared/types/domain'
import { useDuplicateStore } from '../../stores/useDuplicateStore'
import { useAssetStore } from '../../stores/useAssetStore'

export function DuplicatePage(): React.JSX.Element {
  const store = useDuplicateStore()
  return (
    <main className="duplicate-page">
      <header>
        <div><span className="duplicate-page-icon"><Copy size={19} /></span><div><h1>重复素材</h1><p>完全重复由文件内容确认；可能重复仅供你检查。检测完全在本机进行。</p></div></div>
        <button className="duplicate-scan-button" onClick={() => void store.scan()} disabled={store.status?.state === 'scanning'}><ArrowsClockwise size={14} className={store.status?.state === 'scanning' ? 'spinning' : ''} />重新扫描</button>
      </header>
      <div className="duplicate-summary">
        <strong>发现 {store.status?.groupCount ?? 0} 组可能重复素材</strong>
        <span>完全重复 {store.status?.exactGroupCount ?? 0} 组</span><span>可能重复 {store.status?.nearGroupCount ?? 0} 组</span>
        {store.status?.embeddingMissingCount ? <em><WarningCircle size={13} />还有 {store.status.embeddingMissingCount} 张图片的视觉索引未完成，近似结果可能不完整。</em> : null}
      </div>
      {store.status?.state === 'scanning' && <div className="duplicate-progress"><div><i style={{ width: `${store.status.total ? (store.status.processed / store.status.total) * 100 : 0}%` }} /></div><span>正在检查 {store.status.processed} / {store.status.total}</span><button onClick={() => void store.cancel()}>取消</button></div>}
      <nav className="duplicate-filters">{(['all', 'exact', 'near'] as const).map((filter) => <button key={filter} className={store.filter === filter ? 'active' : ''} onClick={() => void store.setFilter(filter)}>{filter === 'all' ? '全部' : filter === 'exact' ? '完全重复' : '可能重复'}</button>)}</nav>
      <section className="duplicate-groups">
        {store.loading && !store.groups.length ? <div className="duplicate-empty"><span className="loading-spinner" /><p>正在读取检测结果…</p></div> : null}
        {!store.loading && !store.groups.length ? <div className="duplicate-empty"><ShieldCheck size={30} /><h2>没有发现需要清理的重复素材</h2><p>新素材导入或视觉索引完成后，Muse 会在本机重新检查。</p></div> : null}
        {store.groups.map((group) => <DuplicateGroupCard key={group.id} group={group} />)}
      </section>
      {store.error && <div className="duplicate-error">{store.error}</div>}
      <DuplicateComparison />
    </main>
  )
}

function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB` }

function DuplicateGroupCard({ group }: { group: DuplicateGroup }): React.JSX.Element {
  const recommended = group.members.find((member) => member.asset.id === group.recommendedKeepAssetId) ?? group.members[0]!
  const previewAssets = group.members.map((member) => member.asset)
  return <article className="duplicate-group-card">
    <header><span className={group.kind}>{group.kind === 'exact' ? '完全重复' : '可能重复'}</span><strong>{group.members.length} 项</strong></header>
    <div className="duplicate-thumbnails">{group.members.slice(0, 6).map((member) => <img key={member.asset.id} src={member.asset.thumbnailUrl} alt={member.asset.filename} loading="lazy" title="双击查看原图" onDoubleClick={() => useAssetStore.getState().openPreviewContext(previewAssets, member.asset.id)} />)}{group.members.length > 6 && <b>+{group.members.length - 6}</b>}</div>
    <div className="duplicate-recommendation"><Check size={14} /><span><small>推荐保留</small><strong>{recommended.asset.filename}</strong><em>{recommended.asset.width} × {recommended.asset.height} · {formatBytes(recommended.asset.size)} · {recommended.asset.extension.toUpperCase()}</em></span></div>
    <p>{group.kind === 'exact' ? '文件内容 SHA-256 完全一致。' : '这些图片看起来非常接近，请确认是否为重复版本。'}</p>
    <footer><button onClick={() => void useDuplicateStore.getState().ignore(group.id)}>忽略此组</button><button className="primary" onClick={() => useDuplicateStore.getState().compare(group)}>查看比较</button></footer>
  </article>
}

function DuplicateComparison(): React.JSX.Element | null {
  const group = useDuplicateStore((state) => state.comparison), keepId = useDuplicateStore((state) => state.keepAssetId)
  const confirmCleanup = useDuplicateStore((state) => state.confirmCleanup)
  if (!group) return null
  const removeCount = group.members.length - 1
  const previewAssets = group.members.map((member) => member.asset)
  const keep = group.members.find((member) => member.asset.id === keepId)?.asset
  const removed = group.members.filter((member) => member.asset.id !== keepId)
  const protectedMetadata = removed.some(({ asset }) => asset.favorite || asset.tags.length > 0 || asset.folderIds.length > 0 || Boolean(asset.ai) || Boolean(asset.sourceUrl))
  return <div className="duplicate-comparison-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) useDuplicateStore.getState().closeComparison() }}>
    <section className="duplicate-comparison">
      <header><div><h2>{group.kind === 'exact' ? '完全重复' : '可能重复'} · {group.members.length} 项</h2><p>选择一项保留，其他版本只会移入 Muse 回收站。</p></div><button onClick={() => useDuplicateStore.getState().closeComparison()}><X size={16} /></button></header>
      <div className="duplicate-comparison-grid">{group.members.map((member) => <button key={member.asset.id} className={keepId === member.asset.id ? 'keep' : ''} title="单击选择保留版本，双击查看原图" onClick={() => useDuplicateStore.getState().setKeepAssetId(member.asset.id)} onDoubleClick={() => useAssetStore.getState().openPreviewContext(previewAssets, member.asset.id)}>
        <div><img src={member.asset.thumbnailUrl} alt={member.asset.filename} loading="lazy" />{keepId === member.asset.id && <span><Check size={12} />保留</span>}</div>
        <strong>{member.asset.filename}</strong><small>{member.asset.width} × {member.asset.height}</small><small>{formatBytes(member.asset.size)} · {member.asset.extension.toUpperCase()}</small><small>{new Date(member.asset.importedAt).toLocaleDateString()}</small>
        <small>{member.asset.favorite ? '★ 已收藏' : '未收藏'} · {member.asset.folderIds.length} 个文件夹</small>
        <small>{member.asset.tags.length ? `标签：${member.asset.tags.map((tag) => tag.name).join('、')}` : '无标签'}</small>
        {member.recommendationReasons.length ? <ul>{member.recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      </button>)}</div>
      <footer><button onClick={() => void useDuplicateStore.getState().ignore(group.id)}>这不是重复，忽略</button><button className="danger" disabled={!keepId} onClick={() => useDuplicateStore.getState().requestCleanup()}><Trash size={14} />将其他 {removeCount} 项移到回收站</button></footer>
      {confirmCleanup && <div className="duplicate-cleanup-confirm"><div><Trash size={22} /><h3>清理重复素材</h3><p>保留 <strong>{keep?.filename}</strong></p><p>将移动到回收站：{removed.slice(0, 4).map((member) => member.asset.filename).join('、')}{removed.length > 4 ? ` 等 ${removed.length} 项` : ''}</p><p>不会永久删除文件。</p>{protectedMetadata && <p className="metadata-warning"><WarningCircle size={14} />被移入回收站的版本包含收藏、标签、文件夹、来源或 AI 信息；Muse v1 不会自动合并这些信息。</p>}<footer><button onClick={() => useDuplicateStore.getState().cancelCleanup()}>取消</button><button className="danger" onClick={() => void useDuplicateStore.getState().cleanup()}>移动到回收站</button></footer></div></div>}
    </section>
  </div>
}
