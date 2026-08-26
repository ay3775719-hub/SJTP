import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dimension = 384
const sizes = (process.env.MUSE_VISUAL_BENCH_SIZES ?? '10000,100000').split(',').map(Number)
const topK = 100

for (const count of sizes) {
  const allocatedAt = performance.now()
  const vectors = new Float32Array(count * dimension)
  let state = 0x6d2b79f5
  for (let row = 0; row < count; row += 1) {
    let norm = 0
    const offset = row * dimension
    for (let column = 0; column < dimension; column += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const value = state / 0xffffffff - 0.5
      vectors[offset + column] = value
      norm += value * value
    }
    norm = Math.sqrt(norm)
    for (let column = 0; column < dimension; column += 1) vectors[offset + column] /= norm
  }
  const query = vectors.subarray(0, dimension)
  const scores = new Float32Array(count)
  const searchAt = performance.now()
  for (let row = 0; row < count; row += 1) {
    const offset = row * dimension
    let score = 0
    for (let column = 0; column < dimension; column += 1) score += query[column] * vectors[offset + column]
    scores[row] = score
  }
  const top = Array.from(scores, (score, index) => ({ index, score })).sort((left, right) => right.score - left.score).slice(0, topK)
  const finishedAt = performance.now()
  const result = {
    vectors: count,
    dimension,
    topK,
    vectorBytes: vectors.byteLength,
    preparationMs: Math.round((searchAt - allocatedAt) * 10) / 10,
    searchAndTopKMs: Math.round((finishedAt - searchAt) * 10) / 10,
    bestScore: top[0]?.score
  }
  if (process.env.MUSE_VISUAL_BENCH_SQLITE === 'true') Object.assign(result, benchmarkSqlite(count, query))
  console.log(JSON.stringify(result))
}

function benchmarkSqlite(count, query) {
  const root = mkdtempSync(join(tmpdir(), 'muse-vector-bench-'))
  const database = new DatabaseSync(join(root, 'vectors.db'))
  try {
    database.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE vectors(id INTEGER PRIMARY KEY, vector BLOB NOT NULL); BEGIN')
    const insert = database.prepare('INSERT INTO vectors(id,vector) VALUES (?,?)')
    const bytes = Buffer.from(query.buffer, query.byteOffset, query.byteLength)
    for (let index = 0; index < count; index += 1) insert.run(index, bytes)
    database.exec('COMMIT')
    const started = performance.now()
    const rows = database.prepare('SELECT id,vector FROM vectors').all()
    const scores = rows.map((row) => {
      const copy = new Uint8Array(row.vector.byteLength); copy.set(row.vector)
      const candidate = new Float32Array(copy.buffer)
      let score = 0
      for (let column = 0; column < dimension; column += 1) score += query[column] * candidate[column]
      return { index: row.id, score }
    })
    scores.sort((left, right) => right.score - left.score)
    return { sqliteReadSearchTopKMs: Math.round((performance.now() - started) * 10) / 10, sqliteDatabaseBytes: count * dimension * 4 }
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
}
