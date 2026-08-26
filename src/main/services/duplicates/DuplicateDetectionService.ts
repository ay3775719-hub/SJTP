import type { DuplicateGroup, DuplicateGroupKind, DuplicateScanStatus } from '@shared/types/domain'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { DuplicateCandidateRow, DuplicateRepository, PersistedDuplicateGroup } from '../../database/repositories/DuplicateRepository'
import type { EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import { computePerceptualHash, perceptualHashDistance, perceptualHashLshKeys } from './PerceptualHashService'
import { NEAR_DUPLICATE_TOP_K, scorePair } from './NearDuplicateScorer'
import { logger, serializeError } from '../../logger'

interface NearEdge { left: string; right: string; score: number; visual: number; pHashDistance: number }

export class DuplicateDetectionService {
  private running: Promise<DuplicateScanStatus> | null = null
  private cancelled = false
  private invalidateTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(status: DuplicateScanStatus) => void>()

  constructor(
    private readonly repository: DuplicateRepository,
    private readonly assets: AssetRepository,
    private readonly embeddings: EmbeddingRepository
  ) {}

  onStatus(listener: (status: DuplicateScanStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  status(): DuplicateScanStatus { return this.repository.status() }
  list(kind?: DuplicateGroupKind): DuplicateGroup[] { return this.repository.list(kind) }
  get(id: string): DuplicateGroup | null { return this.repository.get(id) }

  scan(): Promise<DuplicateScanStatus> {
    if (this.running) return this.running
    this.cancelled = false
    this.running = this.runScan().finally(() => { this.running = null })
    return this.running
  }

  cancel(): DuplicateScanStatus { this.cancelled = true; return this.status() }

  invalidate(): void {
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer)
    this.invalidateTimer = setTimeout(() => { this.invalidateTimer = null; void this.scan().catch((error) => logger.warn('Incremental duplicate scan failed', serializeError(error))) }, 900)
  }

  ignore(groupId: string): DuplicateScanStatus { this.repository.ignore(groupId); this.emit(); return this.status() }

  async moveOthersToTrash(groupId: string, keepAssetId: string): Promise<void> {
    const group = this.repository.get(groupId)
    if (!group) throw new Error('Duplicate group not found')
    if (!group.members.some((member) => member.asset.id === keepAssetId)) throw new Error('Keep candidate is not a group member')
    this.assets.softDelete(group.members.map((member) => member.asset.id).filter((id) => id !== keepAssetId))
    await this.scan()
  }

  private async runScan(): Promise<DuplicateScanStatus> {
    let candidates = this.repository.candidates()
    const runId = this.repository.startRun(candidates.length)
    this.emit()
    try {
      let processed = 0
      for (const candidate of candidates) {
        if (this.cancelled) { this.repository.finishRun(runId, 'cancelled', 0, 0); this.emit(); return this.status() }
        const fingerprint = `${candidate.hash}:${candidate.size}`
        if (candidate.pHashStatus !== 'completed' || candidate.sourceFingerprint !== fingerprint || !candidate.pHash) {
          try { this.repository.savePerceptualHash(candidate.id, fingerprint, await computePerceptualHash(candidate.path)) }
          catch (error) { this.repository.failPerceptualHash(candidate.id, fingerprint, 'hash_failed', error instanceof Error ? error.message : String(error)) }
        }
        processed += 1
        if (processed % 4 === 0 || processed === candidates.length) { this.repository.progress(runId, processed); this.emit() }
      }
      candidates = this.repository.candidates()
      const exact = buildExactGroups(candidates)
      const near = await buildNearGroups(candidates, this.embeddings, new Set(exact.flatMap((group) => group.members.map((member) => member.assetId))), () => this.cancelled)
      if (!near) { this.repository.finishRun(runId, 'cancelled', 0, 0); this.emit(); return this.status() }
      const all = [...exact, ...near].filter((group) => group.members.length >= 2)
      this.repository.replaceGroups(all)
      this.repository.finishRun(runId, 'completed', exact.length, near.length)
      this.emit()
      return this.status()
    } catch (error) {
      this.repository.finishRun(runId, 'failed', 0, 0, error instanceof Error ? error.message : String(error))
      this.emit()
      throw error
    }
  }

  private emit(): void { const status = this.status(); this.listeners.forEach((listener) => listener(status)) }
}

function buildExactGroups(rows: DuplicateCandidateRow[]): PersistedDuplicateGroup[] {
  const byHash = groupBy(rows, (row) => row.hash)
  return [...byHash.values()].filter((members) => members.length > 1).map((members) => createGroup('exact', members, 1, new Map()))
}

async function buildNearGroups(
  rows: DuplicateCandidateRow[],
  embeddings: EmbeddingRepository,
  exactMemberIds: Set<string>,
  shouldCancel: () => boolean
): Promise<PersistedDuplicateGroup[] | null> {
  const eligible = rows.filter((row): row is DuplicateCandidateRow & { pHash: string } => Boolean(row.pHash) && !exactMemberIds.has(row.id))
  const buckets = new Map<string, string[]>(), neighbors = new Map<string, Set<string>>(), pairKeys = new Set<string>()
  for (let index = 0; index < eligible.length; index += 1) {
    const row = eligible[index]!
    for (const key of perceptualHashLshKeys(row.pHash)) (buckets.get(key) ?? (buckets.set(key, []), buckets.get(key)!)).push(row.id)
    if (index % 512 === 0) { await yieldToMain(); if (shouldCancel()) return null }
  }
  let bucketIndex = 0
  for (const ids of buckets.values()) {
    for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) {
      const leftId = ids[left]!, rightId = ids[right]!
      ;(neighbors.get(leftId) ?? (neighbors.set(leftId, new Set()), neighbors.get(leftId)!)).add(rightId)
      ;(neighbors.get(rightId) ?? (neighbors.set(rightId, new Set()), neighbors.get(rightId)!)).add(leftId)
    }
    bucketIndex += 1
    if (bucketIndex % 128 === 0) { await yieldToMain(); if (shouldCancel()) return null }
  }
  const rowById = new Map(eligible.map((row) => [row.id, row]))
  for (let index = 0; index < eligible.length; index += 1) {
    const row = eligible[index]!
    const top = [...(neighbors.get(row.id) ?? [])].map((id) => ({ id, distance: perceptualHashDistance(row.pHash, rowById.get(id)!.pHash) })).sort((a, b) => a.distance - b.distance).slice(0, NEAR_DUPLICATE_TOP_K)
    top.forEach((neighbor) => pairKeys.add(pairSignature(row.id, neighbor.id)))
    if (index % 512 === 0) { await yieldToMain(); if (shouldCancel()) return null }
  }
  const neededIds = [...new Set([...pairKeys].flatMap((pair) => pair.split('|')))]
  const vectors = embeddings.getCompletedVectors(neededIds)
  const byId = rowById
  const edges: NearEdge[] = []
  let pairIndex = 0
  for (const key of pairKeys) {
    const [leftId, rightId] = key.split('|'), left = byId.get(leftId!), right = byId.get(rightId!), leftVector = vectors.get(leftId!), rightVector = vectors.get(rightId!)
    if (!left || !right || !leftVector || !rightVector || left.hash === right.hash) continue
    const visual = dot(leftVector, rightVector), result = scorePair(left, right, visual)
    if (result.qualifies) edges.push({ left: left.id, right: right.id, score: result.score, visual, pHashDistance: result.perceptualHashDistance })
    pairIndex += 1
    if (pairIndex % 512 === 0) { await yieldToMain(); if (shouldCancel()) return null }
  }
  if (shouldCancel()) return null
  const clusters = strictClusters(edges)
  return clusters.map((ids) => {
    const members = ids.map((id) => byId.get(id)!).filter(Boolean)
    const edgeMap = new Map<string, NearEdge>(edges.map((edge) => [pairSignature(edge.left, edge.right), edge]))
    const minScore = Math.min(...pairCombinations(ids).map(([left, right]) => edgeMap.get(pairSignature(left, right))?.score ?? 0))
    return createGroup('near', members, minScore, edgeMap)
  }).filter((group) => group.score > 0)
}

function yieldToMain(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)) }

function strictClusters(edges: NearEdge[]): string[][] {
  const clusters: string[][] = []
  for (const edge of [...edges].sort((a, b) => b.score - a.score)) {
    const matching = clusters.find((cluster) => cluster.includes(edge.left) || cluster.includes(edge.right))
    if (!matching) { clusters.push([edge.left, edge.right]); continue }
    const candidate = matching.includes(edge.left) ? edge.right : edge.left
    if (matching.includes(candidate)) continue
    const isClique = matching.every((member) => edges.some((item) => pairSignature(item.left, item.right) === pairSignature(member, candidate)))
    if (isClique) matching.push(candidate)
  }
  return clusters
}

function createGroup(kind: DuplicateGroupKind, rows: DuplicateCandidateRow[], score: number, edges: Map<string, NearEdge>): PersistedDuplicateGroup {
  const ranked = [...rows].sort((left, right) => recommendationValue(right) - recommendationValue(left) || right.width * right.height - left.width * left.height || left.importedAt.localeCompare(right.importedAt))
  const representative = ranked[0]!
  return {
    kind, signature: DuplicateRepositorySignature(kind, rows.map((row) => row.id)), representativeId: representative.id,
    recommendedKeepId: representative.id, score,
    members: ranked.map((row, rank) => {
      const edge = row.id === representative.id ? null : edges.get(pairSignature(row.id, representative.id))
      return { assetId: row.id, visualSimilarity: kind === 'exact' ? 1 : edge?.visual ?? null, duplicateScore: kind === 'exact' ? 1 : edge?.score ?? score, pHashDistance: edge?.pHashDistance ?? (kind === 'exact' ? 0 : null), rank, reasons: recommendationReasons(row, rows) }
    })
  }
}

function recommendationValue(row: DuplicateCandidateRow): number { return row.favorite * 1_000_000_000_000 + row.manualTagCount * 100_000_000_000 + row.folderCount * 10_000_000_000 + row.width * row.height }
function recommendationReasons(row: DuplicateCandidateRow, group: DuplicateCandidateRow[]): string[] {
  const reasons: string[] = []
  if (row.favorite) reasons.push('已收藏')
  if (row.manualTagCount) reasons.push(`包含 ${row.manualTagCount} 个用户标签`)
  if (row.width * row.height === Math.max(...group.map((item) => item.width * item.height))) reasons.push('分辨率最高')
  if (row.folderCount) reasons.push('已加入文件夹')
  return reasons
}
function dot(left: Float32Array, right: Float32Array): number { let sum = 0; for (let index = 0; index < Math.min(left.length, right.length); index += 1) sum += left[index]! * right[index]!; return sum }
function pairSignature(left: string, right: string): string { return left < right ? `${left}|${right}` : `${right}|${left}` }
function pairCombinations(ids: string[]): Array<[string, string]> { const result: Array<[string, string]> = []; for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) result.push([ids[i]!, ids[j]!]); return result }
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); items.forEach((item) => { const value = key(item); (result.get(value) ?? (result.set(value, []), result.get(value)!)).push(item) }); return result }
function DuplicateRepositorySignature(kind: DuplicateGroupKind, ids: string[]): string { return `${kind}:${[...ids].sort().join('|')}` }
