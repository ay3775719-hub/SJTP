import sharp from 'sharp'
import type { ColorAnalysis, ColorSwatch } from '@shared/types/domain'

interface Bucket { count: number; r: number; g: number; b: number }
export interface PaletteResult { swatches: ColorSwatch[]; analysis: ColorAnalysis }

export class PaletteService {
  async extract(imagePath: string, maxColors = 6): Promise<ColorSwatch[]> { return (await this.analyze(imagePath, maxColors)).swatches }

  async analyze(imagePath: string, maxColors = 6): Promise<PaletteResult> {
    const { data, info } = await sharp(imagePath, { animated: false, pages: 1 })
      .rotate().resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const buckets = new Map<string, Bucket>()
    let total = 0, totalR = 0, totalG = 0, totalB = 0, saturationSum = 0
    for (let index = 0; index < data.length; index += info.channels * 2) {
      const r = data[index] ?? 0, g = data[index + 1] ?? 0, b = data[index + 2] ?? 0, alpha = data[index + 3] ?? 255
      if (alpha < 80) continue
      const pixel = Math.floor(index / info.channels), x = pixel % info.width, y = Math.floor(pixel / info.width)
      const edge = x < info.width * .04 || x > info.width * .96 || y < info.height * .04 || y > info.height * .96
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      if (edge && max - min < 8 && (max < 12 || min > 243)) continue
      total += 1; totalR += r; totalG += g; totalB += b; saturationSum += rgbToHsl(r, g, b).s
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
      bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b; buckets.set(key, bucket)
    }
    const safeTotal = total || 1
    const ranked: Array<Bucket & { rr: number; gg: number; bb: number }> = []
    for (const bucket of [...buckets.values()].sort((left, right) => right.count - left.count)) {
      const candidate = { ...bucket, rr: bucket.r / bucket.count, gg: bucket.g / bucket.count, bb: bucket.b / bucket.count }
      if (ranked.every((previous) => colorDistance(candidate, previous) > 34)) ranked.push(candidate)
      if (ranked.length >= Math.min(8, Math.max(5, maxColors))) break
    }
    const swatches = ranked.map((bucket) => {
      const hsl = rgbToHsl(bucket.rr, bucket.gg, bucket.bb)
      return { hex: rgbToHex(bucket.rr, bucket.gg, bucket.bb), population: bucket.count / safeTotal, ratio: bucket.count / safeTotal, hue: hsl.h, saturation: hsl.s, lightness: hsl.l }
    })
    const average = { r: totalR / safeTotal, g: totalG / safeTotal, b: totalB / safeTotal }
    const lab = rgbToLab(average.r, average.g, average.b)
    return {
      swatches,
      analysis: {
        averageHex: rgbToHex(average.r, average.g, average.b),
        brightness: clamp01((.2126 * average.r + .7152 * average.g + .0722 * average.b) / 255),
        saturation: clamp01(saturationSum / safeTotal),
        temperature: lab.b > 8 ? 'warm' : lab.b < -6 ? 'cool' : 'neutral'
      }
    }
  }
}

export function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const linear = (value: number): number => { const n = value / 255; return n > .04045 ? ((n + .055) / 1.055) ** 2.4 : n / 12.92 }
  const rr = linear(r), gg = linear(g), bb = linear(b)
  let x = (rr * .4124 + gg * .3576 + bb * .1805) / .95047
  let y = (rr * .2126 + gg * .7152 + bb * .0722)
  let z = (rr * .0193 + gg * .1192 + bb * .9505) / 1.08883
  const pivot = (value: number): number => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116
  x = pivot(x); y = pivot(y); z = pivot(z)
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
}

export function hexToLab(hex: string): { l: number; a: number; b: number } {
  const value = hex.replace('#', '')
  return rgbToLab(Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16))
}

const colorDistance = (left: { rr: number; gg: number; bb: number }, right: { rr: number; gg: number; bb: number }): number => Math.hypot(left.rr - right.rr, left.gg - right.gg, left.bb - right.bb)
const rgbToHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rr = r / 255, gg = g / 255, bb = b / 255, max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), delta = max - min
  let h = 0
  if (delta) h = max === rr ? 60 * (((gg - bb) / delta) % 6) : max === gg ? 60 * ((bb - rr) / delta + 2) : 60 * ((rr - gg) / delta + 4)
  if (h < 0) h += 360
  const l = (max + min) / 2
  return { h, s: delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, l }
}
