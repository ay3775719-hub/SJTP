import { useEffect, useRef, useState, type ComponentType } from 'react'
import type { IconProps } from '@phosphor-icons/react'
import { ChatCircleDots, ClockCounterClockwise, Copy, DotsThree, Folder, FunnelSimple, Gear, Heart, ImageSquare, PencilSimple, Plus, Sparkle, Tag as TagIcon, Trash, Tray, WarningCircle } from '@phosphor-icons/react'
import type { Folder as MuseFolder } from '@shared/types/domain'
import { useAssetStore } from '../../stores/useAssetStore'
import { museApi } from '../../api/client'
import { useSmartCollectionEditorStore } from '../smartCollections/useSmartCollectionEditorStore'
import { useAIStore } from '../../stores/useAIStore'
import { useCollectionSuggestionStore } from '../smartCollections/useCollectionSuggestionStore'
import { useNaturalSearchStore } from '../../stores/useNaturalSearchStore'
import { useDuplicateStore } from '../../stores/useDuplicateStore'
import { useMuseAgentStore } from '../../stores/useMuseAgentStore'
import { showNotice, useNoticeStore } from '../../stores/useNoticeStore'

interface NavItemProps {
  icon: ComponentType<IconProps>
  label: string
  count?: number
  active: boolean
  onClick(): void
}

const formatCount = (value: number): string => value.toLocaleString('zh-CN')

function SidebarRow({ icon: Icon, label, count, active, onClick }: NavItemProps): React.JSX.Element {
  return (
    <button className={`sidebar-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon className="sidebar-icon" size={16} weight="regular" />
      <span className="sidebar-item-label">{label}</span>
      <span className="sidebar-spacer" />
      {count !== undefined && <span className="sidebar-count">{formatCount(count)}</span>}
    </button>
  )
}

function SidebarSectionHeader({ title, badge, actionLabel, disabled, onAction }: { title: string; badge?: string; actionLabel: string; disabled?: boolean; onAction?(): void }): React.JSX.Element {
  return (
    <div className="sidebar-heading">
      <span>{title}{badge && <b>{badge}</b>}</span>
      <button disabled={disabled} onClick={onAction} title={disabled ? '此功能尚未启用' : actionLabel} aria-label={actionLabel}><Plus size={15} /></button>
    </div>
  )
}

function FolderItem({ folder, onRename, onRemove }: { folder: MuseFolder; onRename(folder: MuseFolder): void; onRemove(folder: MuseFolder): void }): React.JSX.Element {
  const query = useAssetStore((state) => state.query)
  const setQuery = useAssetStore((state) => state.setQuery)
  const selectedIds = useAssetStore((state) => state.selectedIds)
  const [over, setOver] = useState(false)
  const [overCount, setOverCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const hasAssetDrag = (types: readonly string[]): boolean => types.includes('application/x-muse-asset-id')
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent): void => { if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  return (
    <div
      ref={rowRef}
      className={`folder-sidebar-row ${over ? 'folder-drop-target' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true) }}
      onDragOver={(event) => {
        if (!hasAssetDrag(event.dataTransfer.types)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = query.folderId && query.folderId !== folder.id ? 'move' : 'copy'
        setOver(true)
        const transferredCount = Number(event.dataTransfer.getData('application/x-muse-asset-count'))
        setOverCount(Number.isFinite(transferredCount) && transferredCount > 0 ? transferredCount : Math.max(1, selectedIds.size))
      }}
      onDragLeave={() => { setOver(false); setOverCount(0) }}
      onDrop={(event) => {
        event.preventDefault(); setOver(false); setOverCount(0)
        const assetId = event.dataTransfer.getData('application/x-muse-asset-id') || event.dataTransfer.getData('text/plain')
        if (!assetId) return
        const ids = selectedIds.has(assetId) ? [...selectedIds] : [assetId]
        if (query.folderId === folder.id) { showNotice(`素材已经在“${folder.name}”中`); return }
        const sourceFolderId = query.folderId
        void (async () => {
          try {
            if (sourceFolderId) await museApi.folders.moveAssets(ids, sourceFolderId, folder.id)
            else await museApi.folders.attachAssets(ids, folder.id)
            useNoticeStore.getState().show({
              message: sourceFolderId ? `已移动 ${ids.length} 项素材到“${folder.name}”` : `已添加 ${ids.length} 项素材到“${folder.name}”`,
              tone: 'success', actionLabel: '撤销',
              action: async () => {
                if (sourceFolderId) await museApi.folders.moveAssets(ids, folder.id, sourceFolderId)
                else await museApi.folders.detachAssets(ids, folder.id)
                showNotice('已撤销文件夹操作', 'success')
              }
            })
          } catch (error) { showNotice('文件夹操作失败', 'error', error instanceof Error ? error.message : String(error)) }
        })()
      }}
    >
      <SidebarRow icon={Folder} label={folder.name} count={folder.assetCount} active={query.folderId === folder.id} onClick={() => { useDuplicateStore.getState().closePage(); useNaturalSearchStore.getState().resetPresentation(); void setQuery({ search: undefined, naturalSearch: undefined, folderId: folder.id, tagIds: undefined, favorite: undefined, deleted: false, recent: undefined, smartCollectionId: undefined }) }} />
      {over && <span className="folder-drop-cue">{query.folderId ? '移动' : '添加'} {overCount} 项</span>}
      <button type="button" className="folder-actions-button" aria-label={`${folder.name}的更多操作`} aria-haspopup="menu" aria-expanded={menuOpen} title="文件夹操作" onClick={() => setMenuOpen((open) => !open)}><DotsThree size={17} weight="bold" /></button>
      {menuOpen && <div className="folder-actions-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(folder) }}><PencilSimple size={15} />重命名</button>
        <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onRemove(folder) }}><Trash size={15} />删除文件夹…</button>
      </div>}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const query = useAssetStore((state) => state.query)
  const setQuery = useAssetStore((state) => state.setQuery)
  const [dialog, setDialog] = useState<'folder' | 'tag' | null>(null)
  const [name, setName] = useState('')
  const [renameFolder, setRenameFolder] = useState<MuseFolder | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<MuseFolder | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const suggestionCount = useCollectionSuggestionStore((state) => state.result?.items.length ?? 0)
  const suggestionsOpen = useCollectionSuggestionStore((state) => state.open)
  const duplicatesOpen = useDuplicateStore((state) => state.open)
  const duplicateCount = useDuplicateStore((state) => state.status?.groupCount ?? 0)

  const submit = async (): Promise<void> => {
    const value = name.trim()
    if (!value || !dialog) return
    try {
      if (dialog === 'folder') await museApi.folders.create(value)
      else await museApi.tags.create(value)
      setDialog(null); setName(''); setActionError(null)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }

  if (!bootstrap) return <aside className="sidebar sidebar-loading" />
  const { stats } = bootstrap
  const cleanView = { search: undefined, naturalSearch: undefined, favorite: undefined, deleted: false, folderId: undefined, tagIds: undefined, recent: undefined, smartCollectionId: undefined }
  const navigate = (patch: Partial<typeof query>): void => { useDuplicateStore.getState().closePage(); useNaturalSearchStore.getState().resetPresentation(); void setQuery(patch) }
  const submitRename = async (): Promise<void> => {
    const value = name.trim()
    if (!renameFolder || !value) return
    try {
      await museApi.folders.rename(renameFolder.id, value)
      setRenameFolder(null); setName(''); setActionError(null)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }
  const confirmRemoveFolder = async (): Promise<void> => {
    if (!deleteFolder) return
    try {
      const removedId = deleteFolder.id
      await museApi.folders.remove(removedId)
      setDeleteFolder(null); setActionError(null)
      if (query.folderId === removedId) await setQuery(cleanView)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar app-drag-region" onDoubleClick={museApi.window.toggleMaximize}>
        <div className="brand">Muse</div>
      </div>
      <div className="sidebar-scroll">
        <nav className="primary-nav" aria-label="素材导航">
          <SidebarRow icon={ImageSquare} label="全部素材" count={stats.total} active={!query.search && !query.naturalSearch && !query.favorite && !query.deleted && !query.folderId && !query.tagIds?.length && !query.recent && !query.smartCollectionId} onClick={() => navigate(cleanView)} />
          <SidebarRow icon={Tray} label="最近添加" count={stats.recentlyAdded} active={query.recent === 'added'} onClick={() => navigate({ ...cleanView, recent: 'added', sort: 'imported-desc' })} />
          <SidebarRow icon={ClockCounterClockwise} label="最近使用" count={stats.recentlyOpened} active={query.recent === 'opened'} onClick={() => navigate({ ...cleanView, recent: 'opened' })} />
          <SidebarRow icon={Heart} label="收藏" count={stats.favorites} active={query.favorite === true} onClick={() => navigate({ ...cleanView, favorite: true })} />
          <SidebarRow icon={Copy} label="重复素材" count={duplicateCount} active={duplicatesOpen} onClick={() => void useDuplicateStore.getState().openPage()} />
          <SidebarRow icon={Trash} label="回收站" count={stats.trash} active={query.deleted === true} onClick={() => navigate({ ...cleanView, deleted: true })} />
        </nav>

        <section className="sidebar-section">
          <SidebarSectionHeader title="智能集合" badge="规则" actionLabel="创建智能集合" onAction={() => useSmartCollectionEditorStore.getState().openCreate()} />
          <div aria-label="整理建议入口"><SidebarRow icon={Sparkle} label="整理建议" count={suggestionCount} active={suggestionsOpen} onClick={() => void useCollectionSuggestionStore.getState().openPanel()} /></div>
          {bootstrap.smartCollections.map((collection) => <div key={collection.id} className="smart-sidebar-row" onContextMenu={(event) => { event.preventDefault(); void museApi.smartCollections.showContextMenu(collection.id) }}><SidebarRow icon={collection.invalidRuleIds.length ? WarningCircle : FunnelSimple} label={collection.name} count={collection.assetCount} active={query.smartCollectionId === collection.id} onClick={() => navigate({ ...cleanView, smartCollectionId: collection.id })} /></div>)}
          {bootstrap.smartCollections.length === 0 && <p className="sidebar-empty">尚未创建智能集合</p>}
        </section>

        <section className="sidebar-section">
          <SidebarSectionHeader title="文件夹" actionLabel="新建文件夹" onAction={() => { setActionError(null); setName(''); setDialog('folder') }} />
          {bootstrap.folders.map((folder) => <FolderItem key={folder.id} folder={folder} onRename={(item) => { setActionError(null); setName(item.name); setRenameFolder(item) }} onRemove={(item) => { setActionError(null); setDeleteFolder(item) }} />)}
          {bootstrap.folders.length === 0 && <p className="sidebar-empty">还没有文件夹</p>}
        </section>

        <section className="sidebar-section">
          <SidebarSectionHeader title="标签" actionLabel="新建标签" onAction={() => { setActionError(null); setName(''); setDialog('tag') }} />
          {bootstrap.tags.map((tag) => <SidebarRow key={tag.id} icon={TagIcon} label={tag.name} count={tag.assetCount ?? 0} active={query.tagIds?.includes(tag.id) ?? false} onClick={() => navigate({ ...cleanView, tagIds: [tag.id] })} />)}
          {bootstrap.tags.length === 0 && <p className="sidebar-empty">还没有标签</p>}
        </section>
      </div>
      <div className="sidebar-bottom-actions">
        <button className="sidebar-agent" onClick={() => void useMuseAgentStore.getState().openPanel()}><ChatCircleDots size={17} weight="duotone" />Muse AI</button>
        <button className="sidebar-settings" onClick={() => useAIStore.getState().openSettings()}><Gear size={16} />设置 <small>v{bootstrap.appVersion}</small></button>
      </div>

      {dialog && (
        <div className="input-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialog(null) }}>
          <form className="input-dialog" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <strong>{dialog === 'folder' ? '新建文件夹' : '新建标签'}</strong>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={dialog === 'folder' ? 120 : 80} />
            {actionError && <p className="dialog-error">{actionError}</p>}
            <div><button type="button" onClick={() => setDialog(null)}>取消</button><button type="submit" className="primary" disabled={!name.trim()}>创建</button></div>
          </form>
        </div>
      )}
      {renameFolder && (
        <div className="input-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setRenameFolder(null) }}>
          <form className="input-dialog" onSubmit={(event) => { event.preventDefault(); void submitRename() }}>
            <strong>重命名文件夹</strong>
            <input autoFocus value={name} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} maxLength={120} />
            {actionError && <p className="dialog-error">{actionError}</p>}
            <div><button type="button" onClick={() => setRenameFolder(null)}>取消</button><button type="submit" className="primary" disabled={!name.trim() || name.trim() === renameFolder.name}>保存</button></div>
          </form>
        </div>
      )}
      {deleteFolder && (
        <div className="input-dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDeleteFolder(null) }}>
          <div className="input-dialog delete-confirm folder-delete-confirm">
            <strong><WarningCircle size={18} />删除“{deleteFolder.name}”？</strong>
            <p>只会删除这个文件夹，不会删除其中的 <b>{formatCount(deleteFolder.assetCount)}</b> 项素材。</p>
            <p>素材仍会保留在“全部素材”中。</p>
            {actionError && <p className="dialog-error">{actionError}</p>}
            <div><button type="button" onClick={() => setDeleteFolder(null)}>取消</button><button type="button" className="danger-button" onClick={() => void confirmRemoveFolder()}>删除文件夹</button></div>
          </div>
        </div>
      )}
    </aside>
  )
}
