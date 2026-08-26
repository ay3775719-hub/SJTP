import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow, Rectangle } from 'electron'

interface WindowState extends Rectangle { maximized?: boolean }

const FALLBACK: WindowState = { x: 80, y: 60, width: 1536, height: 1024 }

export class WindowStateService {
  constructor(private readonly statePath: string) {}

  load(): WindowState {
    if (!existsSync(this.statePath)) return FALLBACK
    try {
      const state = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<WindowState>
      if (!state.width || !state.height) return FALLBACK
      return { x: state.x ?? FALLBACK.x, y: state.y ?? FALLBACK.y, width: state.width, height: state.height, maximized: state.maximized }
    } catch {
      return FALLBACK
    }
  }

  track(window: BrowserWindow): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const persist = (): void => {
      const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
      writeFileSync(this.statePath, JSON.stringify({ ...bounds, maximized: window.isMaximized() }, null, 2), 'utf8')
    }
    const schedule = (): void => {
      clearTimeout(timer)
      timer = setTimeout(persist, 200)
    }
    window.on('resize', schedule)
    window.on('move', schedule)
    window.on('maximize', schedule)
    window.on('unmaximize', schedule)
    window.on('close', persist)
  }
}
