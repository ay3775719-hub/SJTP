import { ArrowLeft, ArrowRight, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef } from 'react'
import { useAssetStore } from '../../stores/useAssetStore'
import { museApi } from '../../api/client'
import { ImageViewer, type ImageViewerActions } from './ImageViewer'

export function PreviewOverlay(): React.JSX.Element | null {
  const open = useAssetStore((state) => state.previewOpen)
  const setOpen = useAssetStore((state) => state.setPreviewOpen)
  const galleryAssets = useAssetStore((state) => state.assets)
  const galleryFocusedId = useAssetStore((state) => state.focusedId)
  const previewContext = useAssetStore((state) => state.previewContext)
  const moveFocus = useAssetStore((state) => state.movePreviewFocus)
  const actionsRef = useRef<ImageViewerActions | null>(null)
  const receiveActions = useCallback((actions: ImageViewerActions) => { actionsRef.current = actions }, [])
  const assets = previewContext?.assets ?? galleryAssets
  const focusedId = previewContext?.focusedId ?? galleryFocusedId
  const asset = assets.find((item) => item.id === focusedId)
  useEffect(() => { if (open && focusedId) void museApi.assets.markOpened(focusedId) }, [open, focusedId])
  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent): void => {
      if (event.repeat && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(-1); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(1); return }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); actionsRef.current?.zoomIn(); return }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); actionsRef.current?.zoomOut(); return }
      if (event.key === '0') { event.preventDefault(); actionsRef.current?.fit(); return }
      if (event.key === '1') { event.preventDefault(); actionsRef.current?.actual() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [open, moveFocus, setOpen])
  if (!open || !asset) return null
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={`预览 ${asset.filename}`}>
      <div className="preview-top"><span>{asset.filename}</span><span className="preview-dimensions">{asset.width} × {asset.height}</span><button onClick={() => setOpen(false)} aria-label="关闭预览"><X size={20} /></button></div>
      <button className="preview-arrow left" onClick={() => moveFocus(-1)} aria-label="上一张"><ArrowLeft size={25} /></button>
      <ImageViewer key={asset.id} asset={asset} onActions={receiveActions} />
      <button className="preview-arrow right" onClick={() => moveFocus(1)} aria-label="下一张"><ArrowRight size={25} /></button>
    </div>
  )
}
