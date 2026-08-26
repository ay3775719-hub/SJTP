export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 16
export const VIEWER_PADDING = 32

export function calculateFitScale(viewport: Size, image: Size, padding = VIEWER_PADDING): number {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) return 1
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  return Math.min(availableWidth / image.width, availableHeight / image.height)
}

export function clampScale(scale: number, fitScale: number): number {
  return Math.min(MAX_ZOOM, Math.max(Math.min(MIN_ZOOM, fitScale), scale))
}

export function clampTranslation(translation: Point, scale: number, viewport: Size, image: Size): Point {
  const overflowX = Math.max(0, (image.width * scale - viewport.width) / 2)
  const overflowY = Math.max(0, (image.height * scale - viewport.height) / 2)
  return {
    x: overflowX === 0 ? 0 : Math.max(-overflowX, Math.min(overflowX, translation.x)),
    y: overflowY === 0 ? 0 : Math.max(-overflowY, Math.min(overflowY, translation.y))
  }
}

/** Keeps the image point currently under `cursorFromCenter` under the cursor. */
export function zoomTranslationAtPoint(translation: Point, currentScale: number, nextScale: number, cursorFromCenter: Point): Point {
  const ratio = nextScale / currentScale
  return {
    x: cursorFromCenter.x - (cursorFromCenter.x - translation.x) * ratio,
    y: cursorFromCenter.y - (cursorFromCenter.y - translation.y) * ratio
  }
}

export function wheelZoomFactor(deltaY: number, pinchGesture: boolean): number {
  const sensitivity = pinchGesture ? 0.012 : 0.002
  return Math.max(0.5, Math.min(2, Math.exp(-deltaY * sensitivity)))
}
