import type { CSSProperties } from 'react'
import { Minus, Plus } from '@phosphor-icons/react'
import { useAssetStore } from '../../stores/useAssetStore'

const ZOOM_STEP = 0.1

export function GalleryZoomControl({ placement }: { placement: 'toolbar' | 'bottom' }): React.JSX.Element {
  const zoom = useAssetStore((state) => state.zoom)
  const setZoom = useAssetStore((state) => state.setZoom)
  const percentage = Math.round(zoom * 100)
  const style = { '--range-progress': `${percentage}%` } as CSSProperties
  const changeBy = (delta: number): void => setZoom(Math.min(1, Math.max(0, zoom + delta)))

  return (
    <div className={placement === 'toolbar' ? 'zoom-control' : 'bottom-zoom'} role="group" aria-label="图片缩放">
      <button type="button" className="zoom-step" aria-label="缩小图片" title="缩小图片" disabled={zoom <= 0} onClick={() => changeBy(-ZOOM_STEP)}>
        <Minus size={placement === 'toolbar' ? 14 : 13} />
      </button>
      <input
        className="gallery-zoom-slider"
        aria-label={placement === 'toolbar' ? '图片尺寸' : '底部图片缩放'}
        aria-valuetext={`${percentage}%`}
        title={`图片尺寸 ${percentage}%`}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={zoom}
        style={style}
        onChange={(event) => setZoom(Number(event.currentTarget.value))}
      />
      <button type="button" className="zoom-step" aria-label="放大图片" title="放大图片" disabled={zoom >= 1} onClick={() => changeBy(ZOOM_STEP)}>
        <Plus size={placement === 'toolbar' ? 14 : 13} />
      </button>
    </div>
  )
}
