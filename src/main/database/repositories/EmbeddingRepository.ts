import type { DatabaseSync } from 'node:sqlite'
import type { VisualEmbeddingStatus } from '@shared/types/domain'

export interface EmbeddingModelIdentity {
  providerId: string
  modelId: string
  modelVersion: string
  dimension: number
}

export interface EmbeddingCandidate {
  id: string
  path: string
  hash: string
  size: number
  deletedAt: string | null
  status: VisualEmbeddingStatus | null
  sourceFingerprint: string | null
}

export interface EmbeddingIndexCounts {
  totalEligible: number
  completed: number
  queued: number
  generating: number
  failed: number
  stale: number
}

export class EmbeddingRepository {
  constructor(private readonly db: DatabaseSync, readonly model: EmbeddingModelIdentity) {}

  listCandidates(includeDeleted = false): EmbeddingCandidate[] {
    return this.db.prepare(`
      SELECT a.id,a.path,a.hash,a.size,a.deleted_at AS deletedAt,e.status,e.source_fingerprint AS sourceFingerprint
      FROM assets a
      LEFT JOIN asset_embeddings e ON e.asset_id=a.id AND e.provider_id=@providerId AND e.model_id=@modelId AND e.model_version=@modelVersion
      ${includeDeleted ? '' : 'WHERE a.deleted_at IS NULL'}
      ORDER BY a.imported_at ASC,a.id ASC
    `).all(this.modelParams()) as unknown as EmbeddingCandidate[]
  }

  getCandidate(assetId: string): EmbeddingCandidate | null {
    const row = this.db.prepare(`
      SELECT a.id,a.path,a.hash,a.size,a.deleted_at AS deletedAt,e.status,e.source_fingerprint AS sourceFingerprint
      FROM assets a
      LEFT JOIN asset_embeddings e ON e.asset_id=a.id AND e.provider_id=@providerId AND e.model_id=@modelId AND e.model_version=@modelVersion
      WHERE a.id=@assetId
    `).get({ ...this.modelParams(), assetId }) as unknown as EmbeddingCandidate | undefined
    return row ?? null
  }

  queue(assetId: string, fingerprint: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO asset_embeddings(asset_id,provider_id,model_id,model_version,dimension,vector_blob,normalized,status,source_fingerprint,error_code,error_message,created_at,updated_at)
      VALUES (@assetId,@providerId,@modelId,@modelVersion,@dimension,NULL,1,'queued',@fingerprint,NULL,NULL,@now,@now)
      ON CONFLICT(asset_id,provider_id,model_id,model_version) DO UPDATE SET
        dimension=excluded.dimension,vector_blob=NULL,normalized=1,status='queued',source_fingerprint=excluded.source_fingerprint,
        error_code=NULL,error_message=NULL,updated_at=excluded.updated_at
    `).run({ ...this.model, assetId, fingerprint, now })
  }

  markGenerating(assetId: string): void {
    this.updateStatus(assetId, 'generating')
  }

  save(assetId: string, fingerprint: string, vector: Float32Array): void {
    if (vector.length !== this.model.dimension) throw new Error(`Embedding dimension mismatch: expected ${this.model.dimension}, got ${vector.length}`)
    const blob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO asset_embeddings(asset_id,provider_id,model_id,model_version,dimension,vector_blob,normalized,status,source_fingerprint,error_code,error_message,created_at,updated_at)
      VALUES (@assetId,@providerId,@modelId,@modelVersion,@dimension,@blob,1,'completed',@fingerprint,NULL,NULL,@now,@now)
      ON CONFLICT(asset_id,provider_id,model_id,model_version) DO UPDATE SET
        dimension=excluded.dimension,vector_blob=excluded.vector_blob,normalized=1,status='completed',source_fingerprint=excluded.source_fingerprint,
        error_code=NULL,error_message=NULL,updated_at=excluded.updated_at
    `).run({ ...this.model, assetId, fingerprint, blob, now })
  }

  markFailed(assetId: string, errorCode: string, errorMessage: string): void {
    this.db.prepare(`UPDATE asset_embeddings SET status='failed',error_code=?,error_message=?,updated_at=? WHERE asset_id=? AND provider_id=? AND model_id=? AND model_version=?`)
      .run(errorCode, errorMessage.slice(0, 1000), new Date().toISOString(), assetId, this.model.providerId, this.model.modelId, this.model.modelVersion)
  }

  markStale(assetId: string): void {
    this.updateStatus(assetId, 'stale')
  }

  resetAll(): void {
    this.db.prepare(`UPDATE asset_embeddings SET status='stale',vector_blob=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE provider_id=? AND model_id=? AND model_version=?`)
      .run(new Date().toISOString(), this.model.providerId, this.model.modelId, this.model.modelVersion)
  }

  counts(): EmbeddingIndexCounts {
    return this.db.prepare(`
      SELECT COUNT(*) AS totalEligible,
        COALESCE(SUM(CASE WHEN e.status='completed' THEN 1 ELSE 0 END),0) AS completed,
        COALESCE(SUM(CASE WHEN e.status='queued' THEN 1 ELSE 0 END),0) AS queued,
        COALESCE(SUM(CASE WHEN e.status='generating' THEN 1 ELSE 0 END),0) AS generating,
        COALESCE(SUM(CASE WHEN e.status='failed' THEN 1 ELSE 0 END),0) AS failed,
        COALESCE(SUM(CASE WHEN e.status='stale' THEN 1 ELSE 0 END),0) AS stale
      FROM assets a
      LEFT JOIN asset_embeddings e ON e.asset_id=a.id AND e.provider_id=@providerId AND e.model_id=@modelId AND e.model_version=@modelVersion
      WHERE a.deleted_at IS NULL
    `).get(this.modelParams()) as unknown as EmbeddingIndexCounts
  }

  getCompletedVectors(assetIds: string[]): Map<string, Float32Array> {
    const result = new Map<string, Float32Array>()
    for (let offset = 0; offset < assetIds.length; offset += 500) {
      const ids = assetIds.slice(offset, offset + 500)
      if (!ids.length) continue
      const placeholders = ids.map(() => '?').join(',')
      const rows = this.db.prepare(`SELECT asset_id AS assetId,vector_blob AS vector FROM asset_embeddings
        WHERE provider_id=? AND model_id=? AND model_version=? AND status='completed' AND asset_id IN (${placeholders})`)
        .all(this.model.providerId, this.model.modelId, this.model.modelVersion, ...ids) as unknown as Array<{ assetId: string; vector: Uint8Array }>
      for (const row of rows) {
        const bytes = Buffer.from(row.vector)
        result.set(row.assetId, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      }
    }
    return result
  }

  private updateStatus(assetId: string, status: VisualEmbeddingStatus): void {
    this.db.prepare(`UPDATE asset_embeddings SET status=?,updated_at=? WHERE asset_id=? AND provider_id=? AND model_id=? AND model_version=?`)
      .run(status, new Date().toISOString(), assetId, this.model.providerId, this.model.modelId, this.model.modelVersion)
  }

  private modelParams(): Pick<EmbeddingModelIdentity, 'providerId' | 'modelId' | 'modelVersion'> {
    return { providerId: this.model.providerId, modelId: this.model.modelId, modelVersion: this.model.modelVersion }
  }
}
