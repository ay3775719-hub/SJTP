import { useEffect, useState } from 'react'
import { Sidebar } from './features/sidebar/Sidebar'
import { Gallery } from './features/gallery/Gallery'
import { Inspector } from './features/inspector/Inspector'
import { PreviewOverlay } from './features/preview/PreviewOverlay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAssetStore } from './stores/useAssetStore'
import { museApi } from './api/client'
import { SmartCollectionEditor } from './features/smartCollections/SmartCollectionEditor'
import { useSmartCollectionEditorStore } from './features/smartCollections/useSmartCollectionEditorStore'
import { AIQueueStatusBar, AISettingsDialog, VisualIndexStatusBar } from './features/settings/AISettingsDialog'
import { useAIStore } from './stores/useAIStore'
import { CollectionSuggestionPanel } from './features/smartCollections/CollectionSuggestionPanel'
import { useCollectionSuggestionStore } from './features/smartCollections/useCollectionSuggestionStore'
import { useVisualSimilarityStore } from './stores/useVisualSimilarityStore'
import { VisualIndexSetupDialog } from './features/similarity/VisualIndexSetupDialog'
import { useDuplicateStore } from './stores/useDuplicateStore'
import { useMuseAgentStore } from './stores/useMuseAgentStore'
import { MuseAssistantPanel } from './features/agent/MuseAssistantPanel'
import type { WebCollectorPairingRequest } from '@shared/types/domain'
import { NoticeToast } from './components/NoticeToast'
import { showNotice } from './stores/useNoticeStore'

type Pane = 'sidebar' | 'inspector'

export function App(): React.JSX.Element {
  const initialize = useAssetStore((state) => state.initialize)
  const error = useAssetStore((state) => state.error)
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const [sidebarWidth, setSidebarWidth] = useState(243)
  const [inspectorWidth, setInspectorWidth] = useState(402)
  const [pairing, setPairing] = useState<WebCollectorPairingRequest | null>(null)

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => { void useAIStore.getState().initialize() }, [])
  useEffect(() => { void useCollectionSuggestionStore.getState().refresh() }, [])
  useEffect(() => { void useVisualSimilarityStore.getState().initialize() }, [])
  useEffect(() => { void useDuplicateStore.getState().initialize() }, [])
  useEffect(() => { void useMuseAgentStore.getState().initialize() }, [])
  useEffect(() => museApi.webCollector.onPairingRequested(setPairing), [])
  useEffect(() => {
    if (!bootstrap) return
    setSidebarWidth(bootstrap.preferences.sidebarWidth)
    setInspectorWidth(bootstrap.preferences.inspectorWidth)
  }, [bootstrap?.preferences.sidebarWidth, bootstrap?.preferences.inspectorWidth])
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = museApi.app.onLibraryChanged(() => {
      void useAssetStore.getState().refreshFromDatabase()
      if (useDuplicateStore.getState().open) void useDuplicateStore.getState().refresh()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void useCollectionSuggestionStore.getState().refresh() }, 280)
    })
    return () => { window.clearTimeout(timer); unsubscribe() }
  }, [])
  useEffect(() => museApi.app.onDesktopAction((action) => {
    const store = useAssetStore.getState()
    if (action.type === 'copy-selection') {
      const target = document.activeElement
      const editing = target instanceof HTMLElement && target.matches('input, textarea, [contenteditable="true"]')
      if (editing) document.execCommand('copy')
      else {
        const ids = [...store.selectedIds]
        if (ids.length) void museApi.desktop.copyAssets(ids)
          .then((result) => showNotice(`已复制 ${result.count} 张图片`, 'success'))
          .catch((error) => showNotice('复制失败', 'error', error instanceof Error ? error.message : '请重试'))
      }
    }
    if (action.type === 'import') void store.importFromDialog()
    if (action.type === 'preview') { store.select(action.assetId, 'replace'); store.setPreviewOpen(true) }
    if (action.type === 'edit-smart-collection') useSmartCollectionEditorStore.getState().openEdit(action.smartCollectionId)
    if (action.type === 'delete-smart-collection') useSmartCollectionEditorStore.getState().requestDelete(action.smartCollectionId)
    if (action.type === 'analyze-assets') void useAIStore.getState().analyze(action.assetIds)
    if (action.type === 'find-similar') void useVisualSimilarityStore.getState().findSimilar(action.assetId)
    if (action.type === 'open-duplicates') void useDuplicateStore.getState().openPage()
    if (action.type === 'open-ai-settings') useAIStore.getState().openSettings()
    if (action.type === 'open-muse-ai') void useMuseAgentStore.getState().openPanel()
    if (action.type === 'agent-search-results') void store.enterAgentSearch(action.title, action.resultSetId)
    if (action.type === 'agent-similar-results') store.enterSimilarity(action.result)
    if (action.type === 'web-asset-collected') showNotice(action.status === 'saved' ? `已从 ${action.domain} 保存到 Muse` : action.status === 'already_collected' ? '图片已存在，来源信息无需更新' : '图片已存在，已添加新的网页来源', 'success')
  }), [])
  useEffect(() => {
    const update = (): void => {
      const assets = useAssetStore.getState(), duplicate = useDuplicateStore.getState()
      let currentViewType: 'library' | 'folder' | 'smart-collection' | 'search' | 'similar' | 'duplicates' = 'library'
      let currentViewId: string | null = null
      if (duplicate.open) currentViewType = 'duplicates'
      else if (assets.similarity) { currentViewType = 'similar'; currentViewId = assets.similarity.source.id }
      else if (assets.agentResultTitle || assets.query.search || assets.query.naturalSearch) currentViewType = 'search'
      else if (assets.query.smartCollectionId) { currentViewType = 'smart-collection'; currentViewId = assets.query.smartCollectionId }
      else if (assets.query.folderId) { currentViewType = 'folder'; currentViewId = assets.query.folderId }
      void museApi.agent.updateContext({ currentViewType, currentViewId, selectionCount: assets.selectedIds.size, selectedAssetIds: [...assets.selectedIds], focusedAssetId: assets.focusedId })
    }
    update()
    const unsubscribeAssets = useAssetStore.subscribe(update)
    const unsubscribeDuplicates = useDuplicateStore.subscribe(update)
    return () => { unsubscribeAssets(); unsubscribeDuplicates() }
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editing = target instanceof HTMLElement ? target.matches('input, textarea, [contenteditable="true"]') : false
      const store = useAssetStore.getState()
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !editing) {
        const ids = [...store.selectedIds]
        if (!ids.length) return
        event.preventDefault()
        void museApi.desktop.copyAssets(ids)
          .then((result) => showNotice(`已复制 ${result.count} 张图片`, 'success'))
          .catch((error) => showNotice('复制失败', 'error', error instanceof Error ? error.message : '请重试'))
        return
      }
      if (store.previewOpen) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.getElementById('asset-search')?.focus(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); void store.importFromDialog(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !editing) { event.preventDefault(); store.selectAll(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); void store.undo(); return }
      if (editing) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (!store.query.deleted) void store.removeSelected()
      }
      if (event.key === ' ') { event.preventDefault(); store.setPreviewOpen(!store.previewOpen) }
      if (event.key === 'Escape') store.setPreviewOpen(false)
      if (event.key === 'ArrowLeft') store.moveFocus(-1)
      if (event.key === 'ArrowRight') store.moveFocus(1)
      if (event.key === 'ArrowUp') store.moveFocus(-4)
      if (event.key === 'ArrowDown') store.moveFocus(4)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const startResize = (pane: Pane, event: React.PointerEvent): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = pane === 'sidebar' ? sidebarWidth : inspectorWidth
    let currentWidth = startWidth
    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX
      currentWidth = pane === 'sidebar' ? Math.min(360, Math.max(190, startWidth + delta)) : Math.min(520, Math.max(300, startWidth - delta))
      if (pane === 'sidebar') setSidebarWidth(currentWidth)
      else setInspectorWidth(currentWidth)
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      const patch = pane === 'sidebar' ? { sidebarWidth: currentWidth } : { inspectorWidth: currentWidth }
      void museApi.app.updatePreferences(patch)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <ErrorBoundary>
      <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}px`, '--inspector-width': `${inspectorWidth}px` } as React.CSSProperties}>
        <Sidebar />
        <div className="pane-resizer sidebar-resizer" onPointerDown={(event) => startResize('sidebar', event)} />
        <Gallery />
        <div className="pane-resizer inspector-resizer" onPointerDown={(event) => startResize('inspector', event)} />
        <Inspector />
      </div>
      <PreviewOverlay />
      <SmartCollectionEditor />
      <CollectionSuggestionPanel />
      <SmartCollectionDeleteConfirmation />
      <AISettingsDialog />
      <VisualIndexSetupDialog />
      <AIQueueStatusBar />
      <VisualIndexStatusBar />
      <MuseAssistantPanel />
      {pairing && <div className="input-dialog-backdrop"><div className="input-dialog web-pairing-dialog"><strong>浏览器扩展请求连接到 Muse</strong><p>{pairing.browserName}<br /><span>Extension ID: {pairing.extensionId}</span></p><small>允许后，扩展只能提交网页图片采集请求，不能访问文件、命令或 SQLite。</small><div><button onClick={() => { void museApi.webCollector.resolvePairing(pairing.id, false); setPairing(null) }}>拒绝</button><button className="primary" onClick={() => { void museApi.webCollector.resolvePairing(pairing.id, true); setPairing(null) }}>允许</button></div></div></div>}
      <NoticeToast />
      {error && <div className="error-toast" role="alert">{error}</div>}
    </ErrorBoundary>
  )
}

function SmartCollectionDeleteConfirmation(): React.JSX.Element | null {
  const pendingId = useSmartCollectionEditorStore((state) => state.pendingDeleteId)
  const cancel = useSmartCollectionEditorStore((state) => state.cancelDelete)
  const confirm = useSmartCollectionEditorStore((state) => state.confirmDelete)
  const collection = useAssetStore((state) => state.bootstrap?.smartCollections.find((item) => item.id === pendingId))
  if (!pendingId) return null
  return <div className="input-dialog-backdrop"><div className="input-dialog delete-confirm"><strong>删除智能集合“{collection?.name ?? ''}”？</strong><p>其中的素材不会被删除。</p><div><button onClick={cancel}>取消</button><button className="danger-button" onClick={() => void confirm()}>删除</button></div></div></div>
}
