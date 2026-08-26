import { Minus, Plus } from '@phosphor-icons/react'
import type { ZoomMode } from './useImageViewer'

export function ZoomControls({ scale, mode, onZoomOut, onZoomIn, onFit, onActual }: { scale: number; mode: ZoomMode; onZoomOut(): void; onZoomIn(): void; onFit(): void; onActual(): void }): React.JSX.Element {
  return <div className="preview-zoom" role="toolbar" aria-label="图片缩放">
    <button onClick={onZoomOut} title="缩小 (-)" aria-label="缩小"><Minus size={15} /></button>
    <span className="preview-zoom-value" aria-live="polite">{Math.round(scale * 100)}%</span>
    <button onClick={onZoomIn} title="放大 (+)" aria-label="放大"><Plus size={15} /></button>
    <span className="preview-zoom-divider" />
    <button className={mode === 'fit' ? 'active' : ''} onClick={onFit} title="适应窗口 (0)">Fit</button>
    <button className={mode === 'actual-size' ? 'active' : ''} onClick={onActual} title="原始尺寸 (1)">100%</button>
  </div>
}
