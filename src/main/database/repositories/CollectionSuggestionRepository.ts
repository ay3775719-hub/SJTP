import type { DatabaseSync } from 'node:sqlite'
import type { ColorBucket } from '@shared/constants/colorBuckets'
import type { CollectionSuggestionDimension, IgnoredCollectionSuggestion } from '@shared/types/domain'

export interface SuggestionAggregateRow {
  dimensions: Array<{ dimension: CollectionSuggestionDimension; label: string; normalizedValue: string }>
  assetCount: number
}

interface TermAggregateRow { first_value: string; first_label: string; second_value?: string; second_label?: string; asset_count: number }
interface ColorAggregateRow { bucket: ColorBucket; value: string; label: string; asset_count: number }

const EFFECTIVE_TERMS = `
  ranked_terms AS (
    SELECT ait.asset_id,ait.type,ait.value,ait.normalized_value,ait.confidence,ait.source,
      ROW_NUMBER() OVER (
        PARTITION BY ait.asset_id,ait.type
        ORDER BY CASE WHEN ait.source='manual' THEN 0 ELSE 1 END,ait.confidence DESC,ait.updated_at DESC
      ) AS rank
    FROM asset_ai_terms ait
    JOIN assets a ON a.id=ait.asset_id AND a.deleted_at IS NULL
    WHERE ait.type IN ('object','scene','style') AND (ait.source='manual' OR ait.confidence>=0.60)
  ),
  effective_terms AS (
    SELECT asset_id,type,value,normalized_value FROM ranked_terms WHERE rank=1
  )`

const COLOR_BUCKET_CASE = `CASE
  WHEN ac.lightness <= 0.14 THEN 'black'
  WHEN ac.lightness >= 0.90 AND ac.saturation <= 0.22 THEN 'white'
  WHEN ac.saturation <= 0.10 AND ac.lab_b >= 4 THEN 'warm-neutral'
  WHEN ac.saturation <= 0.10 AND ac.lab_b <= -4 THEN 'cool-neutral'
  WHEN ac.saturation <= 0.10 THEN 'gray'
  WHEN ac.hue >= 15 AND ac.hue < 55 AND ac.lightness < 0.58 THEN 'brown'
  WHEN ac.hue >= 345 OR ac.hue < 15 THEN 'red'
  WHEN ac.hue < 45 THEN 'orange'
  WHEN ac.hue < 70 THEN 'yellow'
  WHEN ac.hue < 165 THEN 'green'
  WHEN ac.hue < 195 THEN 'cyan'
  WHEN ac.hue < 255 THEN 'blue'
  WHEN ac.hue < 290 THEN 'purple'
  ELSE 'pink' END`

export class CollectionSuggestionRepository {
  constructor(private readonly db: DatabaseSync) {}

  librarySize(): number {
    return (this.db.prepare('SELECT COUNT(*) count FROM assets WHERE deleted_at IS NULL').get() as unknown as { count: number }).count
  }

  unAnalyzedCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) count FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id
      WHERE a.deleted_at IS NULL AND COALESCE(aia.status,'not_analyzed')!='completed'`).get() as unknown as { count: number }).count
  }

  single(dimension: Exclude<CollectionSuggestionDimension, 'color'>): SuggestionAggregateRow[] {
    const type = dimension
    const rows = this.db.prepare(`WITH ${EFFECTIVE_TERMS}
      SELECT normalized_value first_value,MAX(value) first_label,COUNT(*) asset_count
      FROM effective_terms WHERE type=? GROUP BY normalized_value ORDER BY asset_count DESC`).all(type) as unknown as TermAggregateRow[]
    return rows.map((row) => ({ dimensions: [{ dimension, label: row.first_label, normalizedValue: row.first_value }], assetCount: row.asset_count }))
  }

  pair(first: Exclude<CollectionSuggestionDimension, 'color'>, second: Exclude<CollectionSuggestionDimension, 'color'>): SuggestionAggregateRow[] {
    const rows = this.db.prepare(`WITH ${EFFECTIVE_TERMS}
      SELECT one.normalized_value first_value,MAX(one.value) first_label,two.normalized_value second_value,MAX(two.value) second_label,COUNT(*) asset_count
      FROM effective_terms one JOIN effective_terms two ON two.asset_id=one.asset_id
      WHERE one.type=? AND two.type=?
      GROUP BY one.normalized_value,two.normalized_value ORDER BY asset_count DESC`).all(first, second) as unknown as TermAggregateRow[]
    return rows.map((row) => ({ dimensions: [
      { dimension: first, label: row.first_label, normalizedValue: row.first_value },
      { dimension: second, label: row.second_label ?? '', normalizedValue: row.second_value ?? '' }
    ], assetCount: row.asset_count }))
  }

  colorPairs(dimension: 'object' | 'style'): SuggestionAggregateRow[] {
    const rows = this.db.prepare(`WITH ${EFFECTIVE_TERMS},
      color_swatches AS (
        SELECT ac.asset_id,${COLOR_BUCKET_CASE} bucket,COALESCE(ac.ratio,ac.population,0) ratio
        FROM asset_colors ac JOIN assets a ON a.id=ac.asset_id AND a.deleted_at IS NULL
        WHERE ac.position < 6 AND ac.hue IS NOT NULL AND ac.saturation IS NOT NULL AND ac.lightness IS NOT NULL
      ),
      effective_colors AS (
        SELECT asset_id,bucket FROM color_swatches GROUP BY asset_id,bucket HAVING SUM(ratio)>=0.16
      )
      SELECT colors.bucket,term.normalized_value value,MAX(term.value) label,COUNT(*) asset_count
      FROM effective_colors colors JOIN effective_terms term ON term.asset_id=colors.asset_id AND term.type=?
      GROUP BY colors.bucket,term.normalized_value ORDER BY asset_count DESC`).all(dimension) as unknown as ColorAggregateRow[]
    return rows.map((row) => ({ dimensions: [
      { dimension: 'color', label: row.bucket, normalizedValue: row.bucket },
      { dimension, label: row.label, normalizedValue: row.value }
    ], assetCount: row.asset_count }))
  }

  activeIgnoredSignatures(): Set<string> {
    const rows = this.db.prepare('SELECT rule_signature FROM smart_collection_suggestion_ignores WHERE restored_at IS NULL').all() as unknown as Array<{ rule_signature: string }>
    return new Set(rows.map((row) => row.rule_signature))
  }

  listIgnored(): IgnoredCollectionSuggestion[] {
    const rows = this.db.prepare('SELECT rule_signature,ignored_at,restored_at FROM smart_collection_suggestion_ignores ORDER BY ignored_at DESC').all() as unknown as Array<{ rule_signature: string; ignored_at: string; restored_at: string | null }>
    return rows.map((row) => ({ ruleSignature: row.rule_signature, ignoredAt: row.ignored_at, restoredAt: row.restored_at }))
  }

  ignore(signature: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO smart_collection_suggestion_ignores(rule_signature,ignored_at,restored_at) VALUES(?,?,NULL)
      ON CONFLICT(rule_signature) DO UPDATE SET ignored_at=excluded.ignored_at,restored_at=NULL`).run(signature, now)
  }

  restore(signature: string): void {
    this.db.prepare('UPDATE smart_collection_suggestion_ignores SET restored_at=? WHERE rule_signature=?').run(new Date().toISOString(), signature)
  }
}
