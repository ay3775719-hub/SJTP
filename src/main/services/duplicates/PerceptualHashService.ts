import sharp from 'sharp'

export const PHASH_ALGORITHM = 'dct-phash-64'
export const PHASH_VERSION = '1'

const SIZE = 32
const LOW = 8
const cosines = Array.from({ length: LOW }, (_, u) =>
  Float64Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)))
)

export async function computePerceptualHash(path: string): Promise<string> {
  const { data } = await sharp(path, { animated: false, pages: 1 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(SIZE, SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const coefficients: number[] = []
  for (let v = 0; v < LOW; v += 1) {
    for (let u = 0; u < LOW; u += 1) {
      let sum = 0
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) sum += data[y * SIZE + x]! * cosines[u]![x]! * cosines[v]![y]!
      }
      coefficients.push(sum)
    }
  }
  const sorted = coefficients.slice(1).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  let bits = 0n
  coefficients.forEach((value, index) => { if (value >= median) bits |= 1n << BigInt(63 - index) })
  return bits.toString(16).padStart(16, '0')
}

export function perceptualHashDistance(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  let distance = 0
  while (value) { distance += Number(value & 1n); value >>= 1n }
  return distance
}

export function perceptualHashBands(hash: string): string[] {
  return [hash.slice(0, 4), hash.slice(4, 8), hash.slice(8, 12), hash.slice(12, 16)].map((part, index) => `${index}:${part}`)
}

export function perceptualHashLshKeys(hash: string): string[] {
  const value = BigInt(`0x${hash}`), multipliers = [1, 5, 13, 29]
  const keys: string[] = []
  multipliers.forEach((multiplier, layout) => {
    for (let band = 0; band < 4; band += 1) {
      let bucket = 0
      for (let bit = 0; bit < 16; bit += 1) {
        const sourceBit = ((band * 16 + bit) * multiplier) % 64
        if (value & (1n << BigInt(sourceBit))) bucket |= 1 << bit
      }
      keys.push(`${layout}:${band}:${bucket.toString(16).padStart(4, '0')}`)
    }
  })
  return keys
}
