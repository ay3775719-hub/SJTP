import { performance } from 'node:perf_hooks'

function lshKeys(value) { const keys = []; [1, 5, 13, 29].forEach((multiplier, layout) => { for (let band = 0; band < 4; band += 1) { let bucket = 0; for (let bit = 0; bit < 16; bit += 1) { const source = ((band * 16 + bit) * multiplier) % 64; if (value & (1n << BigInt(source))) bucket |= 1 << bit } keys.push(`${layout}:${band}:${bucket}`) } }); return keys }

const sizes = (process.env.MUSE_DUPLICATE_BENCH_SIZES ?? '10000,100000').split(',').map(Number)
for (const count of sizes) {
  let state = 0x9e3779b97f4a7c15n
  const records = []
  for (let index = 0; index < count; index += 1) {
    state ^= state << 13n; state ^= state >> 7n; state ^= state << 17n; state &= 0xffffffffffffffffn
    const base = index > 0 && index % 200 === 0 ? records[index - 1].pHash ^ 0x21n : state
    records.push({ id: index, contentHash: index > 0 && index % 1000 === 0 ? records[index - 1].contentHash : state.toString(16).padStart(16, '0'), pHash: base })
  }
  const exactAt = performance.now(), contentGroups = new Map()
  for (const record of records) { const group = contentGroups.get(record.contentHash) ?? []; group.push(record.id); contentGroups.set(record.contentHash, group) }
  const exactGroups = [...contentGroups.values()].filter((group) => group.length > 1), exactMs = performance.now() - exactAt
  const candidateAt = performance.now(), buckets = new Map(), pairs = new Set()
  for (const record of records) for (const key of lshKeys(record.pHash)) { const ids = buckets.get(key) ?? []; ids.push(record.id); buckets.set(key, ids) }
  for (const ids of buckets.values()) for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) pairs.add(ids[left] < ids[right] ? `${ids[left]}|${ids[right]}` : `${ids[right]}|${ids[left]}`)
  const candidateMs = performance.now() - candidateAt
  const groupAt = performance.now(), parent = new Int32Array(count); for (let i = 0; i < count; i += 1) parent[i] = i
  for (const pair of pairs) { const [a, b] = pair.split('|').map(Number); union(parent, a, b) }
  const components = new Map(); for (const pair of pairs) for (const id of pair.split('|').map(Number)) { const root = find(parent, id), group = components.get(root) ?? new Set(); group.add(id); components.set(root, group) }
  const groupMs = performance.now() - groupAt
  console.log(JSON.stringify({ assets: count, exactGroups: exactGroups.length, exactDetectionMs: round(exactMs), pHashCandidatePairs: pairs.size, candidateGenerationMs: round(candidateMs), groupBuildingMs: round(groupMs), estimatedRecordBytes: count * (16 + 8 + 16) }))
}
function find(parent, value) { let current = value; while (parent[current] !== current) { parent[current] = parent[parent[current]]; current = parent[current] } return current }
function union(parent, a, b) { const x = find(parent, a), y = find(parent, b); if (x !== y) parent[y] = x }
function round(value) { return Math.round(value * 10) / 10 }
