import { ArrowCounterClockwise, Copy, FolderSimplePlus, Star, Tag, Trash, UploadSimple, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { museApi } from '../../api/client'
import { useAssetStore } from '../../stores/useAssetStore'
import { showNotice, useNoticeStore } from '../../stores/useNoticeStore'

type SelectionMenu = 'folder' | 'tag' | null

export function GallerySelectionBar(): React.JSX.Element {
  const assets = useAssetStore((state) => state.assets)
  const bootstrap = useAssetStore((state) => state.bootstrap)
  const query = useAssetStore((state) => state.query)
  const selectedIds = useAssetStore((state) => state.selectedIds)
  const clearSelection = useAssetStore((state) => state.clearSelection)
  const removeSelected = useAssetStore((state) => state.removeSelected)
  const restoreSelected = useAssetStore((state) => state.restoreSelected)
  const setSelectedFavorite = useAssetStore((state) => state.setSelectedFavorite)
  const [menu, setMenu] = useState<SelectionMenu>(null)
  const [tagName, setTagName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const ids = [...selectedIds]
  const selectedAssets = assets.filter((asset) => selectedIds.has(asset.id))
  const allFavorite = selectedAssets.length > 0 && selectedAssets.every((asset) => asset.favorite)

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const copy = async (): Promise<void> => {
    try {
      const result = await museApi.desktop.copyAssets(ids)
      showNotice(`已复制 ${result.count} 张图片`, 'success')
    } catch (error) {
      showNotice('复制失败', 'error', error instanceof Error ? error.message : '请重试')
    }
  }

  const placeInFolder = async (folderId: string, folderName: string): Promise<void> => {
    const sourceFolderId = query.folderId
    if (sourceFolderId === folderId) {
      showNotice(`素材已经在“${folderName}”中`)
      setMenu(null)
      return
    }
    try {
      if (sourceFolderId) await museApi.folders.moveAssets(ids, sourceFolderId, folderId)
      else await museApi.folders.attachAssets(ids, folderId)
      setMenu(null)
      useNoticeStore.getState().show({
        message: sourceFolderId ? `已移动 ${ids.length} 项素材到“${folderName}”` : `已添加 ${ids.length} 项素材到“${folderName}”`,
        tone: 'success',
        actionLabel: '撤销',
        action: async () => {
          if (sourceFolderId) await museApi.folders.moveAssets(ids, folderId, sourceFolderId)
          else await museApi.folders.detachAssets(ids, folderId)
          showNotice('已撤销文件夹操作', 'success')
        }
      })
    } catch (error) {
      showNotice('文件夹操作失败', 'error', error instanceof Error ? error.message : String(error))
    }
  }

  const attachTag = async (tagId: string, name: string): Promise<void> => {
    try {
      await museApi.tags.attach(ids, tagId)
      setMenu(null)
      setTagName('')
      useNoticeStore.getState().show({
        message: `已为 ${ids.length} 项素材添加“${name}”标签`,
        tone: 'success',
        actionLabel: '撤销',
        action: async () => {
          await museApi.tags.detach(ids, tagId)
          showNotice('已撤销标签操作', 'success')
        }
      })
    } catch (error) {
      showNotice('添加标签失败', 'error', error instanceof Error ? error.message : String(error))
    }
  }

  const createOrAttachTag = async (): Promise<void> => {
    const name = tagName.trim()
    if (!name) return
    const existing = bootstrap?.tags.find((tagItem) => tagItem.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
    if (existing) return attachTag(existing.id, existing.name)
    try {
      const created = await museApi.tags.create(name)
      await attachTag(created.id, created.name)
    } catch (error) {
      showNotice('创建标签失败', 'error', error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div ref={rootRef} className="selection-action-bar" role="toolbar" aria-label="所选素材操作">
      <strong>已选择 {ids.length} 项</strong>
      <span className="selection-action-divider" />
      <button type="button" onClick={() => void copy()} title="复制所选 (Ctrl+C)"><Copy size={16} />复制</button>
      {ids.length > 1 && <button
        type="button"
        className="selection-chat-drag"
        onClick={() => {
          museApi.desktop.startAssetDrag(ids)
          showNotice('原生文件拖放已准备', 'success', '请从弹出的“拖到聊天”窗口按住并拖入聊天框')
        }}
        title="打开原生文件托盘，再拖入 ChatGPT 等网页聊天框"
      ><UploadSimple size={16} />拖到聊天</button>}
      {query.deleted ? (
        <button type="button" onClick={() => void restoreSelected()}><ArrowCounterClockwise size={16} />恢复</button>
      ) : <>
        <button type="button" className={allFavorite ? 'active' : ''} onClick={() => void setSelectedFavorite(!allFavorite)} title={allFavorite ? '取消收藏' : '收藏'}><Star size={16} weight={allFavorite ? 'fill' : 'regular'} />{allFavorite ? '取消收藏' : '收藏'}</button>
        <div className="selection-menu-anchor">
          <button type="button" className={menu === 'folder' ? 'active' : ''} onClick={() => setMenu((value) => value === 'folder' ? null : 'folder')}><FolderSimplePlus size={16} />文件夹</button>
          {menu === 'folder' && <div className="selection-popover folder-picker" role="menu">
            <div className="selection-popover-title">移动或添加到文件夹</div>
            {bootstrap?.folders.map((folder) => <button type="button" role="menuitem" key={folder.id} disabled={query.folderId === folder.id} onClick={() => void placeInFolder(folder.id, folder.name)}><span>{folder.name}</span><small>{folder.assetCount}</small></button>)}
            {!bootstrap?.folders.length && <p>还没有文件夹</p>}
          </div>}
        </div>
        <div className="selection-menu-anchor">
          <button type="button" className={menu === 'tag' ? 'active' : ''} onClick={() => setMenu((value) => value === 'tag' ? null : 'tag')}><Tag size={16} />标签</button>
          {menu === 'tag' && <div className="selection-popover tag-picker">
            <form onSubmit={(event) => { event.preventDefault(); void createOrAttachTag() }}>
              <input autoFocus value={tagName} onChange={(event) => setTagName(event.currentTarget.value)} placeholder="输入或新建标签" maxLength={80} />
              <button type="submit" disabled={!tagName.trim()}>添加</button>
            </form>
            {!!bootstrap?.tags.length && <div className="tag-picker-list">{bootstrap.tags.map((tagItem) => <button type="button" key={tagItem.id} onClick={() => void attachTag(tagItem.id, tagItem.name)}><span>{tagItem.name}</span><small>{tagItem.assetCount ?? 0}</small></button>)}</div>}
          </div>}
        </div>
        <button type="button" className="danger" onClick={() => void removeSelected()} title="移到回收站 (Delete)"><Trash size={16} />回收站</button>
      </>}
      <button type="button" className="selection-clear" onClick={clearSelection} aria-label="取消选择" title="取消选择 (Esc)"><X size={17} /></button>
    </div>
  )
}
