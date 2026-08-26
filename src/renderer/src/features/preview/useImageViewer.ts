import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { calculateFitScale, clampScale, clampTranslation, type Point, type Size, wheelZoomFactor, zoomTranslationAtPoint } from './viewerMath'

export type ZoomMode = 'fit' | 'manual' | 'actual-size'

interface ViewerTransform { scale: number; translation: Point; mode: ZoomMode }

export function useImageViewer(assetId: string): {
  viewportRef: React.RefObject<HTMLDivElement | null>
  transform: ViewerTransform
  fitScale: number
  viewport: Size
  image: Size
  canPan: boolean
  dragging: boolean
  spacePressed: boolean
  setImageSize(size: Size): void
  zoomIn(): void
  zoomOut(): void
  fitToWindow(): void
  actualSize(): void
  toggleActualFit(point?: Point): void
  startPan(event: React.PointerEvent<HTMLDivElement>): void
} {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [image, setImage] = useState<Size>({ width: 0, height: 0 })
  const [transform, setTransformState] = useState<ViewerTransform>({ scale: 1, translation: { x: 0, y: 0 }, mode: 'fit' })
  const transformRef = useRef(transform)
  const viewportSizeRef = useRef(viewport)
  const imageSizeRef = useRef(image)
  const [dragging, setDragging] = useState(false)
  const [spacePressed, setSpacePressed] = useState(false)
  const panRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null)

  const commit = useCallback((next: ViewerTransform): void => {
    transformRef.current = next
    setTransformState(next)
  }, [])

  const fitScale = calculateFitScale(viewport, image)
  const fitToWindow = useCallback((): void => {
    const scale = calculateFitScale(viewportSizeRef.current, imageSizeRef.current)
    commit({ scale, translation: { x: 0, y: 0 }, mode: 'fit' })
  }, [commit])
  const actualSize = useCallback((): void => commit({ scale: 1, translation: { x: 0, y: 0 }, mode: 'actual-size' }), [commit])

  const zoomAtPoint = useCallback((requestedScale: number, cursorFromCenter: Point): void => {
    const current = transformRef.current
    const currentFit = calculateFitScale(viewportSizeRef.current, imageSizeRef.current)
    const scale = clampScale(requestedScale, currentFit)
    const translated = zoomTranslationAtPoint(current.translation, current.scale, scale, cursorFromCenter)
    commit({ scale, translation: clampTranslation(translated, scale, viewportSizeRef.current, imageSizeRef.current), mode: 'manual' })
  }, [commit])

  const zoomFromCenter = useCallback((factor: number): void => zoomAtPoint(transformRef.current.scale * factor, { x: 0, y: 0 }), [zoomAtPoint])
  const zoomIn = useCallback((): void => zoomFromCenter(1.2), [zoomFromCenter])
  const zoomOut = useCallback((): void => zoomFromCenter(1 / 1.2), [zoomFromCenter])
  const toggleActualFit = useCallback((point = { x: 0, y: 0 }): void => {
    if (transformRef.current.mode !== 'fit') { fitToWindow(); return }
    const current = transformRef.current
    const translated = zoomTranslationAtPoint(current.translation, current.scale, 1, point)
    commit({ scale: 1, translation: clampTranslation(translated, 1, viewportSizeRef.current, imageSizeRef.current), mode: 'actual-size' })
  }, [commit, fitToWindow])

  const setImageSize = useCallback((size: Size): void => {
    imageSizeRef.current = size
    setImage(size)
    const scale = calculateFitScale(viewportSizeRef.current, size)
    commit({ scale, translation: { x: 0, y: 0 }, mode: 'fit' })
  }, [commit])

  useEffect(() => {
    imageSizeRef.current = { width: 0, height: 0 }
    setImage({ width: 0, height: 0 })
    commit({ scale: 1, translation: { x: 0, y: 0 }, mode: 'fit' })
  }, [assetId, commit])

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = (): void => {
      const rect = element.getBoundingClientRect()
      const next = { width: rect.width, height: rect.height }
      viewportSizeRef.current = next
      setViewport(next)
      const current = transformRef.current
      if (current.mode === 'fit' && imageSizeRef.current.width > 0) {
        const scale = calculateFitScale(next, imageSizeRef.current)
        commit({ scale, translation: { x: 0, y: 0 }, mode: 'fit' })
      } else if (imageSizeRef.current.width > 0) {
        commit({ ...current, translation: clampTranslation(current.translation, current.scale, next, imageSizeRef.current) })
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [commit])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const point = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
      zoomAtPoint(transformRef.current.scale * wheelZoomFactor(event.deltaY, event.ctrlKey), point)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomAtPoint])

  useEffect(() => {
    const down = (event: KeyboardEvent): void => { if (event.code === 'Space') { event.preventDefault(); setSpacePressed(true) } }
    const up = (event: KeyboardEvent): void => { if (event.code === 'Space') setSpacePressed(false) }
    const blur = (): void => setSpacePressed(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || imageSizeRef.current.width <= 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* synthetic QA events have no active native pointer */ }
    panRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: transformRef.current.translation }
    setDragging(true)
    const move = (moveEvent: PointerEvent): void => {
      const pan = panRef.current
      if (!pan || moveEvent.pointerId !== pan.pointerId) return
      const next = { x: pan.origin.x + moveEvent.clientX - pan.start.x, y: pan.origin.y + moveEvent.clientY - pan.start.y }
      const current = transformRef.current
      commit({ ...current, translation: clampTranslation(next, current.scale, viewportSizeRef.current, imageSizeRef.current), mode: current.mode === 'fit' ? 'manual' : current.mode })
    }
    const end = (endEvent: PointerEvent): void => {
      if (panRef.current?.pointerId !== endEvent.pointerId) return
      panRef.current = null
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [commit])

  const canPan = image.width * transform.scale > viewport.width || image.height * transform.scale > viewport.height
  return { viewportRef, transform, fitScale, viewport, image, canPan, dragging, spacePressed, setImageSize, zoomIn, zoomOut, fitToWindow, actualSize, toggleActualFit, startPan }
}
