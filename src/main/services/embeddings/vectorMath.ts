export interface EmbeddingRow {
  assetId: string
  vector: Uint8Array
  dimension: number
}

export interface RankedEmbedding {
  assetId: string
  score: number
}

export function normalizeEmbedding(vector: Float32Array): Float32Array {
  let squared = 0
  for (const value of vector) squared += value * value
  const length = Math.sqrt(squared)
  if (!Number.isFinite(length) || length < 1e-12) throw new Error('Embedding has zero or invalid norm')
  for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / length
  return vector
}

export function embeddingFromBlob(blob: Uint8Array, dimension: number): Float32Array {
  if (blob.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) throw new Error('Stored embedding has invalid byte length')
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}

export function cosineForNormalized(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('Embedding dimensions do not match')
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += (left[index] ?? 0) * (right[index] ?? 0)
  return Math.max(-1, Math.min(1, score))
}

export function rankEmbeddings(query: Float32Array, rows: EmbeddingRow[], limit: number, minimumScore = -1): RankedEmbedding[] {
  const scores: RankedEmbedding[] = []
  for (const row of rows) {
    if (row.dimension !== query.length) continue
    const score = cosineForNormalized(query, embeddingFromBlob(row.vector, row.dimension))
    if (score >= minimumScore) scores.push({ assetId: row.assetId, score })
  }
  scores.sort((left, right) => right.score - left.score)
  return scores.slice(0, Math.max(0, limit))
}
