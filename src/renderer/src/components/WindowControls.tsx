import { Minus, Square, X } from '@phosphor-icons/react'
import { museApi } from '../api/client'
import { useAssetStore } from '../stores/useAssetStore'

export function WindowControls(): React.JSX.Element | null {
  const platform = useAssetStore((state) => state.bootstrap?.platform)
  if (platform === 'darwin') return null
  return (
    <div className="window-controls no-drag" aria-label="窗口控制">
      <button aria-label="最小化" onClick={museApi.window.minimize}><Minus size={15} /></button>
      <button aria-label="最大化或还原" onClick={museApi.window.toggleMaximize}><Square size={12} /></button>
      <button className="window-close" aria-label="关闭" onClick={museApi.window.close}><X size={15} /></button>
    </div>
  )
}
