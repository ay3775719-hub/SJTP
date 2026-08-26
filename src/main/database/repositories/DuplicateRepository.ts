import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { Asset, DuplicateGroup, DuplicateGroupKind, DuplicateGroupMember, DuplicateScanStatus } from '@shared/types/domain'
import type { AssetRepository } from './AssetRepository'
import type { EmbeddingModelIdentity } from './EmbeddingRepository'
import { runTransaction } from '../transaction'

export interface DuplicateCandidateRow {
  id: string; path: string; hash: string; width: number; height: number; size: number; favorite: number
  importedAt: string; pHash: string | null; pHashStatus: string | null; sourceFingerprint: string | null
  manualTagCount: number; folderCount: number
}

export interface PersistedDuplicateGroup {
  kind: DuplicateGroupKind
  signature: string
  representativeId: string
  recommendedKeepId: string
  score: number
  members: Array<{ assetId: string; visualSimilarity: number | null; duplicateScore: number; pHashDistance: number | null; rank: number; reasons: string[] }>
}

export class DuplicateRepository {
  constructor(private readonly db: DatabaseSync, private readonly assets: AssetRepository, private readonly model: EmbeddingModelIdentity) {}

  candidates(): DuplicateCandidateRow[] {
    return this.db.prepare(`
      SELECT a.id,a.path,a.hash,a.width,a.height,a.size,a.favorite,a.imported_at AS importedAt,
        aph.hash_hex AS pHash,aph.status AS pHashStatus,aph.source_fingerprint AS sourceFingerprint,
        (SELECT COUNT(*) FROM asset_tags at WHERE at.asset_id=a.id AND at.source='manual') AS manualTagCount,
        (SELECT COUNT(*) FROM asset_folders af WHERE af.asset_id=a.id) AS folderCount
      FROM assets a LEFT JOIN asset_perceptual_hashes aph ON aph.asset_id=a.id
      WHERE a.deleted_at IS NULL ORDER BY a.id
    `).all() as unknown as DuplicateCandidateRow[]
  }

  savePerceptualHash(assetId: string, fingerprint: string, hashHex: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO asset_perceptual_hashes(asset_id,algorithm,version,hash_hex,status,source_fingerprint,created_at,updated_at)
      VALUES (?, 'dct-phash-64','1',?,'completed',?,?,?)
      ON CONFLICT(asset_id) DO UPDATE SET algorithm=excluded.algorithm,version=excluded.version,hash_hex=excluded.hash_hex,status='completed',source_fingerprint=excluded.source_fingerprint,error_code=NULL,error_message=NULL,updated_at=excluded.updated_at`)
      .run(assetId, hashHex, fingerprint, now, now)
  }

  failPerceptualHash(assetId: string, fingerprint: string, code: string, message: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO asset_perceptual_hashes(asset_id,algorithm,version,hash_hex,status,source_fingerprint,error_code,error_message,created_at,updated_at)
      VALUES (?,'dct-phash-64','1',NULL,'failed',?,?,?,?,?)
      ON CONFLICT(asset_id) DO UPDATE SET status='failed',source_fingerprint=excluded.source_fingerprint,error_code=excluded.error_code,error_message=excluded.error_message,updated_at=excluded.updated_at`)
      .run(assetId, fingerprint, code, message.slice(0, 1000), now, now)
  }

  replaceGroups(groups: PersistedDuplicateGroup[]): void {
    const now = new Date().toISOString()
    runTransaction(this.db, () => {
      this.db.exec('DELETE FROM duplicate_groups')
      const insertGroup = this.db.prepare(`INSERT INTO duplicate_groups(id,kind,member_signature,representative_asset_id,recommended_keep_asset_id,score,scan_version,embedding_model_id,embedding_model_version,threshold_version,generated_at) VALUES (?,?,?,?,? ,?,'1',?,?, 'conservative-v1',?)`)
      const insertMember = this.db.prepare(`INSERT INTO duplicate_group_members(group_id,asset_id,visual_similarity,duplicate_score,perceptual_hash_distance,recommendation_rank,recommendation_reasons_json) VALUES (?,?,?,?,?,?,?)`)
      for (const group of groups) {
        const id = nanoid(16)
        insertGroup.run(id, group.kind, group.signature, group.representativeId, group.recommendedKeepId, group.score, this.model.modelId, this.model.modelVersion, now)
        group.members.forEach((member) => insertMember.run(id, member.assetId, member.visualSimilarity, member.duplicateScore, member.pHashDistance, member.rank, JSON.stringify(member.reasons)))
      }
    })
  }

  list(kind?: DuplicateGroupKind): DuplicateGroup[] {
    const rows = this.db.prepare(`SELECT dg.id,dg.kind,dg.member_signature AS signature,dg.score,dg.recommended_keep_asset_id AS keepId,dg.generated_at AS generatedAt
      FROM duplicate_groups dg LEFT JOIN duplicate_ignores di ON di.member_signature=dg.member_signature AND di.restored_at IS NULL
      WHERE di.member_signature IS NULL ${kind ? 'AND dg.kind=?' : ''} ORDER BY CASE dg.kind WHEN 'exact' THEN 0 ELSE 1 END,dg.score DESC,dg.generated_at DESC`)
      .all(...(kind ? [kind] : [])) as unknown as Array<{ id: string; kind: DuplicateGroupKind; signature: string; score: number; keepId: string; generatedAt: string }>
    return rows.map((row) => this.hydrateGroup(row)).filter((group): group is DuplicateGroup => Boolean(group))
  }

  get(id: string): DuplicateGroup | null {
    const row = this.db.prepare(`SELECT id,kind,member_signature AS signature,score,recommended_keep_asset_id AS keepId,generated_at AS generatedAt FROM duplicate_groups WHERE id=?`)
      .get(id) as unknown as { id: string; kind: DuplicateGroupKind; signature: string; score: number; keepId: string; generatedAt: string } | undefined
    return row ? this.hydrateGroup(row) : null
  }

  ignore(id: string): void {
    const group = this.get(id)
    if (!group) throw new Error('Duplicate group not found')
    this.db.prepare(`INSERT INTO duplicate_ignores(member_signature,kind,ignored_at,restored_at) VALUES (?,?,?,NULL)
      ON CONFLICT(member_signature) DO UPDATE SET kind=excluded.kind,ignored_at=excluded.ignored_at,restored_at=NULL`)
      .run(group.memberSignature, group.kind, new Date().toISOString())
  }

  status(): DuplicateScanStatus {
    const row = this.db.prepare('SELECT * FROM duplicate_scan_runs ORDER BY started_at DESC LIMIT 1').get() as unknown as Record<string, unknown> | undefined
    const groupCounts = this.db.prepare(`SELECT COUNT(*) AS groups,COALESCE(SUM(CASE WHEN kind='exact' THEN 1 ELSE 0 END),0) AS exactGroups,COALESCE(SUM(CASE WHEN kind='near' THEN 1 ELSE 0 END),0) AS nearGroups FROM duplicate_groups dg WHERE NOT EXISTS(SELECT 1 FROM duplicate_ignores di WHERE di.member_signature=dg.member_signature AND di.restored_at IS NULL)`).get() as unknown as { groups: number; exactGroups: number; nearGroups: number }
    const missing = (this.db.prepare(`SELECT COUNT(*) AS count FROM assets a LEFT JOIN asset_embeddings e ON e.asset_id=a.id AND e.provider_id=? AND e.model_id=? AND e.model_version=? AND e.status='completed' WHERE a.deleted_at IS NULL AND e.asset_id IS NULL`).get(this.model.providerId, this.model.modelId, this.model.modelVersion) as unknown as { count: number }).count
    return { state: (row?.status as DuplicateScanStatus['state']) ?? 'idle', processed: Number(row?.processed ?? 0), total: Number(row?.total ?? 0), groupCount: groupCounts.groups, exactGroupCount: groupCounts.exactGroups, nearGroupCount: groupCounts.nearGroups, embeddingMissingCount: missing, lastScanAt: (row?.finished_at as string | null) ?? null, errorMessage: (row?.error_message as string | null) ?? null }
  }

  startRun(total: number): string {
    const id = nanoid(16), now = new Date().toISOString()
    this.db.prepare(`INSERT INTO duplicate_scan_runs(id,status,scan_version,embedding_model_id,embedding_model_version,threshold_version,processed,total,started_at) VALUES (?,'scanning','1',?,?,'conservative-v1',0,?,?)`).run(id, this.model.modelId, this.model.modelVersion, total, now)
    return id
  }
  progress(runId: string, processed: number): void { this.db.prepare('UPDATE duplicate_scan_runs SET processed=? WHERE id=?').run(processed, runId) }
  finishRun(runId: string, state: 'completed' | 'cancelled' | 'failed', exact: number, near: number, error?: string): void {
    this.db.prepare('UPDATE duplicate_scan_runs SET status=?,exact_groups=?,near_groups=?,error_message=?,finished_at=? WHERE id=?').run(state, exact, near, error ?? null, new Date().toISOString(), runId)
  }

  private hydrateGroup(row: { id: string; kind: DuplicateGroupKind; signature: string; score: number; keepId: string; generatedAt: string }): DuplicateGroup | null {
    const members = this.db.prepare(`SELECT asset_id AS assetId,visual_similarity AS visualSimilarity,duplicate_score AS duplicateScore,perceptual_hash_distance AS perceptualHashDistance,recommendation_rank AS rank,recommendation_reasons_json AS reasons FROM duplicate_group_members WHERE group_id=? ORDER BY recommendation_rank`).all(row.id) as unknown as Array<{ assetId: string; visualSimilarity: number | null; duplicateScore: number; perceptualHashDistance: number | null; rank: number; reasons: string }>
    const assetById = new Map(this.assets.getMany(members.map((member) => member.assetId)).map((asset) => [asset.id, asset]))
    const hydrated: DuplicateGroupMember[] = members.flatMap((member) => { const asset = assetById.get(member.assetId); return asset ? [{ asset, visualSimilarity: member.visualSimilarity, duplicateScore: member.duplicateScore, perceptualHashDistance: member.perceptualHashDistance, recommendationRank: member.rank, recommendationReasons: JSON.parse(member.reasons) as string[] }] : [] })
    if (hydrated.length < 2) return null
    return { id: row.id, kind: row.kind, memberSignature: row.signature, score: row.score, recommendedKeepAssetId: row.keepId, generatedAt: row.generatedAt, members: hydrated }
  }
}
