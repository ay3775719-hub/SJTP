import { ArrowClockwise, ImageBroken } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { Asset } from '@shared/types/domain'
import { museApi } from '../../api/client'
import { useImageViewer } from './useImageViewer'
import { ZoomControls } from './ZoomControls'

export interface ImageViewerActions { zoomIn(): void; zoomOut(): void; fit(): void; actual(): void }

export function ImageViewer({ asset, onActions }: { asset: Asset; onActions(actions: ImageViewerActions): void }): React.JSX.Element {
  const viewer = useImageViewer(asset.id)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => { setStatus('loading'); setRetry(0) }, [asset.id])
  useEffect(() => onActions({ zoomIn: viewer.zoomIn, zoomOut: viewer.zoomOut, fit: viewer.fitToWindow, actual: viewer.actualSize }), [onActions, viewer.zoomIn, viewer.zoomOut, viewer.fitToWindow, viewer.actualSize])
  const source = retry ? `${asset.previewUrl}${asset.previewUrl.includes('?') ? '&' : '?'}retry=${retry}` : asset.previewUrl
  const cursor = viewer.dragging ? 'grabbing' : viewer.canPan || viewer.spacePressed ? 'grab' : 'default'
  return <>
    <div
      ref={viewer.viewportRef}
      className="preview-image-stage"
      data-zoom-mode={viewer.transform.mode}
      data-zoom={viewer.transform.scale.toFixed(4)}
      data-space-pressed={viewer.spacePressed}
      style={{ cursor }}
      onPointerDown={viewer.startPan}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        viewer.toggleActualFit({ x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 })
      }}
    >
      {status !== 'error' && <div className="preview-image-transform" style={{ transform: `translate3d(${viewer.transform.translation.x}px, ${viewer.transform.translation.y}px, 0)` }}>
        <img
          key={`${asset.id}:${retry}`}
          src={source}
          alt={asset.filename}
          draggable={false}
          className={status === 'ready' ? 'ready' : ''}
          style={{ width: `${viewer.image.width || asset.width}px`, height: `${viewer.image.height || asset.height}px`, transform: `translate(-50%, -50%) scale(${viewer.transform.scale})` }}
          onLoad={(event) => { viewer.setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setStatus('ready') }}
          onError={() => setStatus('error')}
        />
      </div>}
      {status === 'loading' && <div className="preview-loading" role="status"><span /><p>正在加载原图…</p></div>}
      {status === 'error' && <div className="preview-load-error" role="alert"><ImageBroken size={30} /><strong>无法加载图片</strong><p>{asset.filename}</p><div><button onClick={() => { setStatus('loading'); setRetry((value) => value + 1) }}><ArrowClockwise size={14} />重试</button><button onClick={() => void museApi.desktop.showItemInFolder(asset.id)}>在文件资源管理器中显示</button></div></div>}
    </div>
    <ZoomControls scale={viewer.transform.scale} mode={viewer.transform.mode} onZoomOut={viewer.zoomOut} onZoomIn={viewer.zoomIn} onFit={viewer.fitToWindow} onActual={viewer.actualSize} />
  </>
}
