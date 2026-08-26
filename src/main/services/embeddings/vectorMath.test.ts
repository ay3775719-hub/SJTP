import { describe, expect, it } from 'vitest'
import { cosineForNormalized, embeddingFromBlob, normalizeEmbedding, rankEmbeddings } from './vectorMath'

function blob(values: number[]): Uint8Array {
  const vector = Float32Array.from(values)
  return new Uint8Array(vector.buffer)
}

describe('visual embedding math', () => {
  it('normalizes vectors and ranks by normalized dot product', () => {
    const query = normalizeEmbedding(Float32Array.from([3, 4, 0]))
    expect(Math.hypot(...query)).toBeCloseTo(1, 6)
    const rows = [
      { assetId: 'opposite', vector: blob([-0.6, -0.8, 0]), dimension: 3 },
      { assetId: 'related', vector: blob([0.8, 0.6, 0]), dimension: 3 },
      { assetId: 'same', vector: blob([0.6, 0.8, 0]), dimension: 3 }
    ]
    expect(rankEmbeddings(query, rows, 2).map((row) => row.assetId)).toEqual(['same', 'related'])
    expect(cosineForNormalized(query, embeddingFromBlob(rows[2]!.vector, 3))).toBeCloseTo(1, 6)
  })

  it('rejects corrupt and zero-length vectors', () => {
    expect(() => normalizeEmbedding(new Float32Array(3))).toThrow(/zero or invalid norm/)
    expect(() => embeddingFromBlob(new Uint8Array(3), 3)).toThrow(/invalid byte length/)
  })
})
