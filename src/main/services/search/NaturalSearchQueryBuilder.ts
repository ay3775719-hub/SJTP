import type { SQLInputValue } from 'node:sqlite'
import type { NaturalSearchCondition, NaturalSearchExpression, SmartCollectionRule } from '@shared/types/domain'
import { COLOR_BUCKETS, type ColorBucket } from '@shared/constants/colorBuckets'
import { SmartCollectionQueryBuilder, type SqlPredicate } from '../smartCollections/SmartCollectionQueryBuilder'

export class NaturalSearchQueryBuilder {
  private readonly smart = new SmartCollectionQueryBuilder()
  private index = 0

  build(expression: NaturalSearchExpression): SqlPredicate {
    this.index = 0
    const params: Record<string, SQLInputValue> = {}
    return { sql: this.expression(expression, params), params }
  }

  private expression(expression: NaturalSearchExpression, params: Record<string, SQLInputValue>): string {
    if ('field' in expression) return this.condition(expression, params)
    if (expression.operator === 'not') return `NOT (${this.expression(expression.child, params)})`
    const children = expression.children.map((child) => this.expression(child, params))
    return `(${children.join(expression.operator === 'and' ? ' AND ' : ' OR ')})`
  }

  private condition(condition: NaturalSearchCondition, params: Record<string, SQLInputValue>): string {
    const index = this.index++
    if (condition.field === 'freeText') {
      const key = `ns${index}`
      params[key] = `%${escapeLike(condition.value)}%`
      return `(a.filename LIKE @${key} ESCAPE '\\' OR COALESCE(aia.description,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_object,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_object_label,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_scene,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_scene_label,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_style,'') LIKE @${key} ESCAPE '\\'
        OR COALESCE(aia.primary_style_label,'') LIKE @${key} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM asset_ai_terms nsait WHERE nsait.asset_id=a.id AND nsait.type IN ('object','scene','style')
          AND (nsait.value LIKE @${key} ESCAPE '\\' OR nsait.normalized_value LIKE @${key} ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM asset_tags nsat JOIN tags nst ON nst.id=nsat.tag_id WHERE nsat.asset_id=a.id AND nst.name LIKE @${key} ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM asset_folders nsaf JOIN folders nsf ON nsf.id=nsaf.folder_id WHERE nsaf.asset_id=a.id AND nsf.name LIKE @${key} ESCAPE '\\'))`
    }
    if (condition.field === 'color') return this.localColor(condition.value as ColorBucket, index, params)
    const rule = toSmartRule(condition, index)
    const built = this.smart.build({ name: 'search', matchMode: 'all', rules: [rule] })
    let sql = built.sql
    for (const key of Object.keys(built.params).sort((a, b) => b.length - a.length)) {
      const next = `ns${index}_${key}`
      sql = sql.replace(new RegExp(`@${escapeRegExp(key)}\\b`, 'g'), `@${next}`)
      params[next] = built.params[key]!
    }
    return sql
  }

  /** Search uses perceptual color buckets, while Smart Collections retain their
   * existing Delta-E rule semantics. A 2% palette share is enough for content
   * recall, but still rejects tiny incidental pixels. */
  private localColor(bucket: ColorBucket, index: number, params: Record<string, SQLInputValue>): string {
    const prefix = `ns${index}_color`
    const common = `COALESCE(nsc.ratio,nsc.population,0)>=@${prefix}_ratio`
    params[`${prefix}_ratio`] = 0.02
    const hueRanges: Partial<Record<ColorBucket, [number, number] | 'red'>> = {
      red: 'red', orange: [15, 45], yellow: [45, 70], green: [70, 165], cyan: [165, 195],
      blue: [195, 255], purple: [255, 300], pink: [300, 345], brown: [15, 50]
    }
    const range = hueRanges[bucket]
    if (range) {
      params[`${prefix}_sat`] = bucket === 'brown' ? 0.12 : 0.08
      params[`${prefix}_light_min`] = bucket === 'brown' ? 0.08 : 0.08
      params[`${prefix}_light_max`] = bucket === 'brown' ? 0.65 : 0.93
      const hue = range === 'red'
        ? `(nsc.hue<=15 OR nsc.hue>=345)`
        : `nsc.hue BETWEEN ${range[0]} AND ${range[1]}`
      return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common}
        AND nsc.saturation>=@${prefix}_sat AND nsc.lightness BETWEEN @${prefix}_light_min AND @${prefix}_light_max AND ${hue})`
    }
    if (bucket === 'black') return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common} AND nsc.lightness<=0.16)`
    if (bucket === 'white') return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common} AND nsc.lightness>=0.88 AND nsc.saturation<=0.18)`
    if (bucket === 'gray') return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common} AND nsc.saturation<=0.12 AND nsc.lightness BETWEEN 0.16 AND 0.88)`
    if (bucket === 'warm-neutral') return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common} AND nsc.hue BETWEEN 15 AND 70 AND nsc.saturation BETWEEN 0.04 AND 0.28 AND nsc.lightness BETWEEN 0.28 AND 0.9)`
    return `EXISTS (SELECT 1 FROM asset_colors nsc WHERE nsc.asset_id=a.id AND ${common} AND nsc.hue BETWEEN 165 AND 255 AND nsc.saturation BETWEEN 0.04 AND 0.28 AND nsc.lightness BETWEEN 0.28 AND 0.9)`
  }
}

function toSmartRule(condition: Exclude<NaturalSearchCondition, { field: 'freeText' }>, index: number): SmartCollectionRule {
  const id = `natural-${index}`
  if (condition.field === 'object') return { id, field: 'aiObject', operator: 'equals', value: condition.value }
  if (condition.field === 'scene') return { id, field: 'aiScene', operator: 'equals', value: condition.value }
  if (condition.field === 'style') return { id, field: 'aiStyle', operator: 'equals', value: condition.value }
  if (condition.field === 'color') return { id, field: 'colorHex', operator: 'near', value: COLOR_BUCKETS[condition.value as ColorBucket]?.hex ?? '#808080' }
  if (condition.field === 'favorite') return { id, field: 'favorite', operator: 'is', value: condition.value }
  if (condition.field === 'folder' || condition.field === 'tag') return { id, field: condition.field, operator: 'is', value: condition.value }
  if (condition.field === 'orientation') return { id, field: 'orientation', operator: 'is', value: condition.value }
  if (condition.field === 'importedDate') return { id, field: 'importedAt', operator: condition.value === 'today' ? 'today' : condition.value === 'last_7_days' ? 'last7' : 'last30', value: null }
  if (condition.field === 'filename') return { id, field: 'filename', operator: condition.operator, value: condition.value }
  if (condition.field === 'description') return { id, field: 'aiDescription', operator: condition.operator, value: condition.value }
  return { id, field: 'extension', operator: 'equals', value: condition.value }
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, '\\$&') }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
