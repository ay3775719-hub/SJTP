import { describe, expect, it } from 'vitest'
import { calculateFitScale, clampScale, clampTranslation, MAX_ZOOM, MIN_ZOOM, wheelZoomFactor, zoomTranslationAtPoint } from './viewerMath'

describe('professional image viewer math', () => {
  it('fits portrait and large landscape images inside the fixed viewport', () => {
    expect(calculateFitScale({ width: 1200, height: 800 }, { width: 1024, height: 1536 })).toBeCloseTo(736 / 1536)
    expect(calculateFitScale({ width: 1200, height: 800 }, { width: 6000, height: 4000 })).toBeCloseTo(736 / 4000)
  })

  it('preserves the image point underneath the cursor while zooming', () => {
    const cursor = { x: 280, y: 160 }
    const current = { x: -30, y: 20 }
    const next = zoomTranslationAtPoint(current, 0.5, 1, cursor)
    const before = { x: (cursor.x - current.x) / 0.5, y: (cursor.y - current.y) / 0.5 }
    const after = { x: (cursor.x - next.x) / 1, y: (cursor.y - next.y) / 1 }
    expect(after).toEqual(before)
  })

  it('centers an image on axes smaller than the viewport and clamps overflow axes', () => {
    expect(clampTranslation({ x: 200, y: -500 }, 1, { width: 1200, height: 800 }, { width: 600, height: 1400 })).toEqual({ x: 0, y: -300 })
    expect(clampTranslation({ x: -999, y: 999 }, 2, { width: 1000, height: 700 }, { width: 900, height: 600 })).toEqual({ x: -400, y: 250 })
  })

  it('limits zoom and handles mouse wheel and trackpad pinch directions', () => {
    expect(clampScale(100, 0.2)).toBe(MAX_ZOOM)
    expect(clampScale(0.001, 0.2)).toBe(MIN_ZOOM)
    expect(wheelZoomFactor(-120, false)).toBeGreaterThan(1)
    expect(wheelZoomFactor(120, false)).toBeLessThan(1)
    expect(wheelZoomFactor(-5, true)).toBeGreaterThan(1)
  })
})
