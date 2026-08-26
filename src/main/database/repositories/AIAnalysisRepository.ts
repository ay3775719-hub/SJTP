import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { AIAnalysisStatus, AIJobProviderSnapshot, AIQueueStatus, AISmartCollectionSuggestion, AITermType, AIMetadata, AIValue } from '@shared/types/domain'
import { normalizeOpenTerm, normalizePrimaryObject } from '@shared/constants/aiVocabulary'
import type { NormalizedAIAnalysis } from '../../services/ai/normalizeAIAnalysis'
import { runTransaction } from '../transaction'

interface AnalysisRow {
  asset_id: string; status: AIAnalysisStatus; provider: string | null; model: string | null; schema_version: number
  prompt_version: string | null
  result_version: number; primary_object: string | null; primary_object_label: string | null; primary_object_confidence: number | null
  primary_scene: string | null; primary_scene_label: string | null; primary_scene_confidence: number | null
  primary_style: string | null; primary_style_label: string | null; primary_style_confidence: number | null
  primary_category: string | null; primary_category_label: string | null; primary_category_confidence: number | null
  secondary_category: string | null; secondary_category_label: string | null; secondary_category_confidence: number | null
  tertiary_category: string | null; tertiary_category_label: string | null; tertiary_category_confidence: number | null
  description: string | null; overall_confidence: number | null; started_at: string | null; analyzed_at: string | null
  updated_at: string; error_message: string | null; retry_count: number
}

interface TermRow { type: AITermType; value: string; normalized_value: string; confidence: number; source: AIValue['source'] }

const TERM_TYPES: AITermType[] = ['object','scene','style','mood','lighting','composition','material','usage','semantic_color','open_tag']
export interface QueuedAIJob { assetId: string; snapshot: AIJobProviderSnapshot }
const LEGACY_SNAPSHOT: AIJobProviderSnapshot = { providerId: 'openai', modelId: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' }

export class AIAnalysisRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(assetId: string): AIMetadata | null {
    const row = this.db.prepare('SELECT * FROM asset_ai_analysis WHERE asset_id = ?').get(assetId) as unknown as AnalysisRow | undefined
    if (!row) return null
    const termRows = this.db.prepare('SELECT type, value, normalized_value, confidence, source FROM asset_ai_terms WHERE asset_id = ? ORDER BY type, confidence DESC, value').all(assetId) as unknown as TermRow[]
    const terms = termRows.map(toValue)
    const termGroups = Object.fromEntries(TERM_TYPES.map((type) => [type, termRows.filter((item) => item.type === type).map(toValue)])) as AIMetadata['termGroups']
    const primaryObject = preferredPrimary(termGroups.object, categoryValue(row.primary_object_label, row.primary_object, row.primary_object_confidence), row.result_version)
    const primaryScene = preferredPrimary(termGroups.scene, categoryValue(row.primary_scene_label, row.primary_scene, row.primary_scene_confidence), row.result_version)
    const primaryStyle = preferredPrimary(termGroups.style, categoryValue(row.primary_style_label, row.primary_style, row.primary_style_confidence), row.result_version)
    return {
      status: row.status, provider: row.provider, model: row.model, schemaVersion: row.schema_version, promptVersion: row.prompt_version,
      resultVersion: row.result_version ?? 1, primaryObject, primaryScene, primaryStyle,
      category: {
        primary: categoryValue(row.primary_category_label, row.primary_category, row.primary_category_confidence),
        secondary: categoryValue(row.secondary_category_label, row.secondary_category, row.secondary_category_confidence),
        tertiary: categoryValue(row.tertiary_category_label, row.tertiary_category, row.tertiary_category_confidence)
      },
      terms, termGroups, description: row.description,
      styles: termGroups.style.map((item) => item.value), moods: termGroups.mood.map((item) => item.value),
      colors: termGroups.semantic_color.map((item) => item.value), objects: termGroups.object.map((item) => item.value),
      materials: termGroups.material.map((item) => item.value), lighting: termGroups.lighting.map((item) => item.value),
      composition: termGroups.composition.map((item) => item.value), scene: termGroups.scene.map((item) => item.value),
      usage: termGroups.usage.map((item) => item.value), ocrText: null,
      semanticEmbeddingStatus: 'disabled', visualEmbeddingStatus: 'disabled', aiModel: row.model,
      analyzedAt: row.analyzed_at, startedAt: row.started_at, updatedAt: row.updated_at,
      overallConfidence: row.overall_confidence, errorMessage: row.error_message, retryCount: row.retry_count
    }
  }

  enqueue(assetIds: string[], snapshot: AIJobProviderSnapshot = LEGACY_SNAPSHOT, force = false): void {
    const now = new Date().toISOString()
    const batchId = nanoid(18)
    runTransaction(this.db, () => {
      const analysis = this.db.prepare(`
        INSERT INTO asset_ai_analysis (asset_id, status, schema_version, updated_at)
        VALUES (?, 'queued', 1, ?)
        ON CONFLICT(asset_id) DO UPDATE SET status='queued', updated_at=excluded.updated_at,
          error_message=NULL, retry_count=CASE WHEN ? THEN 0 ELSE asset_ai_analysis.retry_count END
      `)
      const job = this.db.prepare(`
        INSERT INTO ai_analysis_jobs (id, asset_id, state, attempts, priority, requested_at, provider_id, model_id, provider_config_json, batch_id)
        VALUES (?, ?, 'queued', 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET state='queued', attempts=CASE WHEN ? THEN 0 ELSE ai_analysis_jobs.attempts END,
          requested_at=excluded.requested_at, started_at=NULL, finished_at=NULL, error_message=NULL,
          provider_id=excluded.provider_id, model_id=excluded.model_id, provider_config_json=excluded.provider_config_json,
          batch_id=excluded.batch_id
      `)
      assetIds.forEach((id) => {
        const current = this.db.prepare('SELECT status FROM asset_ai_analysis WHERE asset_id=?').get(id) as unknown as { status: AIAnalysisStatus } | undefined
        if (!force && current?.status === 'completed') return
        analysis.run(id, now, force ? 1 : 0); job.run(nanoid(18), id, now, snapshot.providerId, snapshot.modelId, JSON.stringify(snapshot), batchId, force ? 1 : 0)
      })
    })
  }

  queuedJobs(): QueuedAIJob[] {
    const rows = this.db.prepare("SELECT asset_id,provider_id,model_id,provider_config_json FROM ai_analysis_jobs WHERE state='queued' ORDER BY priority DESC,requested_at").all() as unknown as Array<{ asset_id: string; provider_id: string | null; model_id: string | null; provider_config_json: string | null }>
    return rows.map((row) => ({ assetId: row.asset_id, snapshot: parseSnapshot(row) }))
  }

  recoverInterruptedJobs(): void {
    const now = new Date().toISOString()
    runTransaction(this.db, () => {
      this.db.prepare("UPDATE ai_analysis_jobs SET state='queued',started_at=NULL,error_message='Muse closed before analysis completed' WHERE state='analyzing'").run()
      this.db.prepare("UPDATE asset_ai_analysis SET status='queued',updated_at=?,error_message=NULL WHERE status='analyzing'").run(now)
      const codexPending = this.db.prepare("SELECT 1 found FROM ai_analysis_jobs WHERE provider_id='codex-chatgpt' AND state='queued' LIMIT 1").get() as unknown as { found: number } | undefined
      if (codexPending) this.db.prepare("UPDATE ai_queue_runtime_state SET paused=1,pause_reason='restart_checkpoint',provider_id='codex-chatgpt',updated_at=? WHERE id=1").run(now)
    })
  }

  markAnalyzing(assetId: string): number {
    const now = new Date().toISOString()
    this.db.prepare("UPDATE ai_analysis_jobs SET state='analyzing', attempts=attempts+1, started_at=?, error_message=NULL WHERE asset_id=?").run(now, assetId)
    this.db.prepare(`INSERT INTO asset_ai_analysis (asset_id,status,schema_version,started_at,updated_at,retry_count)
      VALUES (?, 'analyzing', 1, ?, ?, 0)
      ON CONFLICT(asset_id) DO UPDATE SET status='analyzing', started_at=excluded.started_at, updated_at=excluded.updated_at, error_message=NULL`).run(assetId, now, now)
    const row = this.db.prepare('SELECT attempts FROM ai_analysis_jobs WHERE asset_id=?').get(assetId) as unknown as { attempts: number }
    return row.attempts
  }

  complete(assetId: string, provider: string, model: string, result: NormalizedAIAnalysis, promptVersion: string | null = null): void {
    const now = new Date().toISOString()
    runTransaction(this.db, () => {
      const removed = new Set((this.db.prepare("SELECT type, normalized_value FROM asset_ai_overrides WHERE asset_id=? AND action='manual_removed'").all(assetId) as unknown as Array<{ type: string; normalized_value: string }>).map((row) => `${row.type}:${row.normalized_value}`))
      this.db.prepare("DELETE FROM asset_ai_terms WHERE asset_id=? AND source IN ('ai','system')").run(assetId)
      const insertTerm = this.db.prepare(`INSERT INTO asset_ai_terms (id,asset_id,type,value,normalized_value,confidence,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      result.terms.filter((term) => !removed.has(`${term.type}:${term.normalizedValue}`)).forEach((term) => insertTerm.run(term.id, assetId, term.type, term.value, term.normalizedValue, term.confidence, term.source, now, now))
      this.db.prepare(`
        INSERT INTO asset_ai_analysis (
          asset_id,status,provider,model,schema_version,primary_category,primary_category_label,primary_category_confidence,
          secondary_category,secondary_category_label,secondary_category_confidence,tertiary_category,tertiary_category_label,
          tertiary_category_confidence,description,overall_confidence,analyzed_at,updated_at,error_message,retry_count,prompt_version,
          result_version,primary_object,primary_object_label,primary_object_confidence,primary_scene,primary_scene_label,primary_scene_confidence,
          primary_style,primary_style_label,primary_style_confidence
        ) VALUES (@assetId,'completed',@provider,@model,1,@primary,@primaryLabel,@primaryConfidence,@secondary,@secondaryLabel,
          @secondaryConfidence,@tertiary,@tertiaryLabel,@tertiaryConfidence,@description,@overallConfidence,@now,@now,NULL,0,@promptVersion,
          2,@primaryObject,@primaryObjectLabel,@primaryObjectConfidence,@primaryScene,@primarySceneLabel,@primarySceneConfidence,
          @primaryStyle,@primaryStyleLabel,@primaryStyleConfidence)
        ON CONFLICT(asset_id) DO UPDATE SET status='completed',provider=excluded.provider,model=excluded.model,schema_version=excluded.schema_version,
          primary_category=excluded.primary_category,primary_category_label=excluded.primary_category_label,primary_category_confidence=excluded.primary_category_confidence,
          secondary_category=excluded.secondary_category,secondary_category_label=excluded.secondary_category_label,secondary_category_confidence=excluded.secondary_category_confidence,
          tertiary_category=excluded.tertiary_category,tertiary_category_label=excluded.tertiary_category_label,tertiary_category_confidence=excluded.tertiary_category_confidence,
          description=excluded.description,overall_confidence=excluded.overall_confidence,analyzed_at=excluded.analyzed_at,updated_at=excluded.updated_at,error_message=NULL,retry_count=0,prompt_version=excluded.prompt_version,
          result_version=2,primary_object=excluded.primary_object,primary_object_label=excluded.primary_object_label,primary_object_confidence=excluded.primary_object_confidence,
          primary_scene=excluded.primary_scene,primary_scene_label=excluded.primary_scene_label,primary_scene_confidence=excluded.primary_scene_confidence,
          primary_style=excluded.primary_style,primary_style_label=excluded.primary_style_label,primary_style_confidence=excluded.primary_style_confidence
      `).run({ assetId, provider, model, primary: result.category.primary?.normalizedValue ?? null, primaryLabel: result.category.primary?.value ?? null,
        primaryConfidence: result.category.primary?.confidence ?? null, secondary: result.category.secondary?.normalizedValue ?? null,
        secondaryLabel: result.category.secondary?.value ?? null, secondaryConfidence: result.category.secondary?.confidence ?? null,
        tertiary: result.category.tertiary?.normalizedValue ?? null, tertiaryLabel: result.category.tertiary?.value ?? null,
        tertiaryConfidence: result.category.tertiary?.confidence ?? null, description: result.description,
        overallConfidence: result.overallConfidence, promptVersion,
        primaryObject: result.primaryObject.normalizedValue, primaryObjectLabel: result.primaryObject.value, primaryObjectConfidence: result.primaryObject.confidence,
        primaryScene: result.primaryScene.normalizedValue, primarySceneLabel: result.primaryScene.value, primarySceneConfidence: result.primaryScene.confidence,
        primaryStyle: result.primaryStyle.normalizedValue, primaryStyleLabel: result.primaryStyle.value, primaryStyleConfidence: result.primaryStyle.confidence, now })
      this.db.prepare("UPDATE ai_analysis_jobs SET state='completed',finished_at=?,error_message=NULL WHERE asset_id=?").run(now, assetId)
      this.db.prepare('UPDATE assets_fts SET description=? WHERE asset_id=?').run(result.description, assetId)
    })
  }

  fail(assetId: string, message: string, retryable: boolean): number {
    const now = new Date().toISOString()
    const job = this.db.prepare('SELECT attempts FROM ai_analysis_jobs WHERE asset_id=?').get(assetId) as unknown as { attempts: number } | undefined
    const attempts = job?.attempts ?? 1
    const state = retryable && attempts < 3 ? 'queued' : 'failed'
    this.db.prepare('UPDATE ai_analysis_jobs SET state=?,finished_at=?,error_message=? WHERE asset_id=?').run(state, now, message, assetId)
    this.db.prepare("UPDATE asset_ai_analysis SET status=?,updated_at=?,error_message=?,retry_count=? WHERE asset_id=?").run(state === 'queued' ? 'queued' : 'failed', now, message, attempts, assetId)
    return attempts
  }

  defer(assetIds: string[], message: string): void {
    const now = new Date().toISOString()
    const job = this.db.prepare("UPDATE ai_analysis_jobs SET state='queued',started_at=NULL,finished_at=NULL,error_message=? WHERE asset_id=?")
    const analysis = this.db.prepare("UPDATE asset_ai_analysis SET status='queued',updated_at=?,error_message=? WHERE asset_id=?")
    runTransaction(this.db, () => assetIds.forEach((id) => { job.run(message, id); analysis.run(now, message, id) }))
  }

  cancel(assetIds: string[]): void {
    const now = new Date().toISOString()
    const job = this.db.prepare("UPDATE ai_analysis_jobs SET state='cancelled',finished_at=? WHERE asset_id=? AND state IN ('queued','analyzing')")
    const analysis = this.db.prepare("UPDATE asset_ai_analysis SET status='not_analyzed',updated_at=?,error_message=NULL WHERE asset_id=? AND status IN ('queued','analyzing')")
    runTransaction(this.db, () => assetIds.forEach((id) => { job.run(now, id); analysis.run(now, id) }))
  }

  addManualTerm(assetId: string, type: AITermType, value: string): void {
    const normalized = type === 'object' ? normalizePrimaryObject(value).normalizedValue : normalizeOpenTerm(value), now = new Date().toISOString()
    runTransaction(this.db, () => {
      this.db.prepare(`INSERT INTO asset_ai_overrides (asset_id,type,normalized_value,value,action,created_at,updated_at) VALUES (?,?,?,?,'manual_added',?,?)
        ON CONFLICT(asset_id,type,normalized_value) DO UPDATE SET value=excluded.value,action='manual_added',updated_at=excluded.updated_at`).run(assetId, type, normalized, value.trim(), now, now)
      this.db.prepare(`INSERT INTO asset_ai_terms (id,asset_id,type,value,normalized_value,confidence,source,created_at,updated_at) VALUES (?,?,?,?,?,1,'manual',?,?)
        ON CONFLICT(asset_id,type,normalized_value,source) DO UPDATE SET value=excluded.value,confidence=1,updated_at=excluded.updated_at`).run(nanoid(18), assetId, type, value.trim(), normalized, now, now)
    })
  }

  removeTerm(assetId: string, type: AITermType, value: string): void {
    const normalized = type === 'object' ? normalizePrimaryObject(value).normalizedValue : normalizeOpenTerm(value), now = new Date().toISOString()
    runTransaction(this.db, () => {
      this.db.prepare(`INSERT INTO asset_ai_overrides (asset_id,type,normalized_value,value,action,created_at,updated_at) VALUES (?,?,?,?,'manual_removed',?,?)
        ON CONFLICT(asset_id,type,normalized_value) DO UPDATE SET value=excluded.value,action='manual_removed',updated_at=excluded.updated_at`).run(assetId, type, normalized, value.trim(), now, now)
      this.db.prepare('DELETE FROM asset_ai_terms WHERE asset_id=? AND type=? AND normalized_value=?').run(assetId, type, normalized)
    })
  }

  queueStatus(paused: boolean, pauseReason: AIQueueStatus['pauseReason'] = null): AIQueueStatus {
    const batch = this.db.prepare(`SELECT batch_id FROM ai_analysis_jobs WHERE batch_id IS NOT NULL
      ORDER BY CASE WHEN state IN ('queued','analyzing') THEN 0 ELSE 1 END, requested_at DESC LIMIT 1`).get() as unknown as { batch_id: string } | undefined
    const rows = batch
      ? this.db.prepare('SELECT state,COUNT(*) count FROM ai_analysis_jobs WHERE batch_id=? GROUP BY state').all(batch.batch_id) as unknown as Array<{ state: string; count: number }>
      : this.db.prepare('SELECT state,COUNT(*) count FROM ai_analysis_jobs GROUP BY state').all() as unknown as Array<{ state: string; count: number }>
    const count = (state: string): number => rows.find((row) => row.state === state)?.count ?? 0
    const provider = batch
      ? this.db.prepare('SELECT provider_id FROM ai_analysis_jobs WHERE batch_id=? ORDER BY requested_at LIMIT 1').get(batch.batch_id) as unknown as { provider_id: AIQueueStatus['providerId'] } | undefined
      : this.db.prepare("SELECT provider_id FROM ai_analysis_jobs WHERE state IN ('queued','analyzing') ORDER BY requested_at LIMIT 1").get() as unknown as { provider_id: AIQueueStatus['providerId'] } | undefined
    return { queued: count('queued'), analyzing: count('analyzing'), completed: count('completed'), failed: count('failed'), paused, pauseReason, providerId: provider?.provider_id ?? null }
  }

  getQueuePause(): { paused: boolean; reason: AIQueueStatus['pauseReason'] } {
    const row = this.db.prepare('SELECT paused,pause_reason FROM ai_queue_runtime_state WHERE id=1').get() as unknown as { paused: number; pause_reason: AIQueueStatus['pauseReason'] } | undefined
    return { paused: Boolean(row?.paused), reason: row?.pause_reason ?? null }
  }

  saveQueuePause(paused: boolean, reason: AIQueueStatus['pauseReason'], providerId: AIQueueStatus['providerId'] = null): void {
    this.db.prepare("UPDATE ai_queue_runtime_state SET paused=?,pause_reason=?,provider_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1").run(paused ? 1 : 0, reason ?? null, providerId ?? null)
  }

  suggestions(limit = 8): AISmartCollectionSuggestion[] {
    const rows = this.db.prepare(`SELECT type,MAX(value) value,normalized_value,COUNT(DISTINCT asset_id) asset_count
      FROM asset_ai_terms WHERE type IN ('object','scene','style') AND (confidence >= .60 OR source='manual')
      GROUP BY type,normalized_value HAVING COUNT(DISTINCT asset_id) >= 2 ORDER BY asset_count DESC,value LIMIT ?`).all(limit) as unknown as Array<{ type: AISmartCollectionSuggestion['type']; value: string; normalized_value: string; asset_count: number }>
    const fields = { object: 'aiObject', scene: 'aiScene', style: 'aiStyle' } as const
    return rows.map((row) => ({ type: row.type, field: fields[row.type], value: row.value, normalizedValue: row.normalized_value, assetCount: row.asset_count }))
  }
}

const toValue = (row: TermRow): AIValue => ({ value: row.value, normalizedValue: row.normalized_value, confidence: row.confidence, source: row.source })
const categoryValue = (label: string | null, normalized: string | null, confidence: number | null): AIValue | null =>
  label && normalized ? { value: label, normalizedValue: normalized, confidence: confidence ?? 0, source: 'ai' } : null
const preferredPrimary = (terms: AIValue[], stored: AIValue | null, resultVersion: number): AIValue | null =>
  terms.find((item) => item.source === 'manual') ?? (resultVersion >= 2 ? terms[0] : stored ?? terms[0]) ?? null

function parseSnapshot(row: { provider_id: string | null; model_id: string | null; provider_config_json: string | null }): AIJobProviderSnapshot {
  try {
    const value = JSON.parse(row.provider_config_json ?? '') as AIJobProviderSnapshot
    if (value.providerId && value.modelId && typeof value.baseUrl === 'string') return value
  } catch { /* migrate interrupted legacy jobs without losing them */ }
  return { ...LEGACY_SNAPSHOT, providerId: (row.provider_id as AIJobProviderSnapshot['providerId']) || LEGACY_SNAPSHOT.providerId, modelId: row.model_id || LEGACY_SNAPSHOT.modelId }
}
