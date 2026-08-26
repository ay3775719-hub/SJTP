import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'

const databasePath = process.env.MUSE_REAL_LIBRARY_DB ?? process.argv[2]
if (!databasePath) throw new Error('Set MUSE_REAL_LIBRARY_DB or pass the muse.db path')
const outputPath = process.env.MUSE_VISUAL_REPORT_PATH ?? process.argv[3]
const queryLimit = Number(process.env.MUSE_VISUAL_QUERY_LIMIT ?? 10)
const resultLimit = Number(process.env.MUSE_VISUAL_RESULT_LIMIT ?? 10)
const requestedIds = (process.env.MUSE_VISUAL_QUERY_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
const database = new DatabaseSync(databasePath, { readOnly: true })

try {
  const rows = database.prepare(`
    SELECT a.id,a.filename,e.vector_blob AS vector,e.dimension
    FROM asset_embeddings e JOIN assets a ON a.id=e.asset_id
    WHERE a.deleted_at IS NULL AND e.status='completed'
      AND e.provider_id='builtin-local' AND e.model_id='dinov2-small-q8'
    ORDER BY a.imported_at,a.id
  `).all()
  const vectors = rows.map((row) => ({ ...row, vector: toFloat32(row.vector, row.dimension) }))
  const queries = requestedIds.length
    ? requestedIds.map((id) => vectors.find((item) => item.id === id)).filter(Boolean)
    : vectors.slice(0, queryLimit)
  const report = queries.slice(0, queryLimit).map((query) => ({
    assetId: query.id,
    filename: query.filename,
    top: vectors.filter((candidate) => candidate.id !== query.id)
      .map((candidate) => ({ assetId: candidate.id, filename: candidate.filename, score: round(dot(query.vector, candidate.vector)) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, resultLimit)
  }))
  const payload = { generatedAt: new Date().toISOString(), indexedAssets: vectors.length, model: 'dinov2-small-q8', dimension: vectors[0]?.dimension ?? null, queries: report }
  const json = JSON.stringify(payload, null, 2)
  if (outputPath) writeFileSync(outputPath, json, 'utf8')
  console.log(json)
} finally {
  database.close()
}

function toFloat32(blob, dimension) {
  const bytes = new Uint8Array(blob.byteLength)
  bytes.set(blob)
  const vector = new Float32Array(bytes.buffer)
  if (vector.length !== dimension) throw new Error(`Invalid vector: ${vector.length} != ${dimension}`)
  return vector
}

function dot(left, right) {
  let result = 0
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index]
  return Math.max(-1, Math.min(1, result))
}

function round(value) { return Math.round(value * 10_000) / 10_000 }
