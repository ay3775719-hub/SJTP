import type { SQLInputValue } from 'node:sqlite'
import type { SmartCollectionDateField, SmartCollectionInput, SmartCollectionNumberField, SmartCollectionRule, SmartCollectionTextField } from '@shared/types/domain'
import { hexToLab } from '../thumbnails/PaletteService'

export interface SqlPredicate {
  sql: string
  params: Record<string, SQLInputValue>
}

const textColumns = {
  filename: 'a.filename', extension: 'a.extension', sourceDomain: 'a.source_domain', sourceType: 'a.import_source'
} as const
const numberColumns = { width: 'a.width', height: 'a.height', size: 'a.size', colorBrightness: '(SELECT brightness FROM asset_color_analysis aca WHERE aca.asset_id=a.id)', colorSaturation: '(SELECT saturation FROM asset_color_analysis aca WHERE aca.asset_id=a.id)' } as const
const dateColumns = { importedAt: 'a.imported_at', createdAt: 'a.created_at', lastOpenedAt: 'a.last_opened_at' } as const
const categoryColumns = { aiPrimaryCategory: ['aia.primary_category','aia.primary_category_label'], aiSecondaryCategory: ['aia.secondary_category','aia.secondary_category_label'], aiTertiaryCategory: ['aia.tertiary_category','aia.tertiary_category_label'] } as const
const termFields = { aiObject: 'object', aiScene: 'scene', aiStyle: 'style', aiMood: 'mood', aiLighting: 'lighting', aiComposition: 'composition', aiMaterial: 'material', aiUsage: 'usage', aiOpenTag: 'open_tag', aiSemanticColor: 'semantic_color' } as const

export class SmartCollectionQueryBuilder {
  build(input: SmartCollectionInput): SqlPredicate {
    const params: Record<string, SQLInputValue> = {}
    const predicates = input.rules.map((rule, index) => this.rule(rule, index, params))
    return { sql: `(${predicates.join(input.matchMode === 'all' ? ' AND ' : ' OR ')})`, params }
  }

  private rule(rule: SmartCollectionRule, index: number, params: Record<string, SQLInputValue>): string {
    const key = `sc${index}`
    if ((rule.field === 'sourceDomain' || rule.field === 'sourceType') && isTextRule(rule)) {
      const column = rule.field === 'sourceDomain' ? 'aws.domain' : 'aws.source_type'
      const positive = rule.operator !== 'notContains' && rule.operator !== 'notEquals'
      const normalizedValue = rule.field === 'sourceDomain'
        ? String(rule.value).toLocaleLowerCase('en-US').replace(/^www\./, '')
        : rule.value
      const innerRule = {
        ...rule,
        value: normalizedValue,
        operator: rule.operator === 'notContains' ? 'contains' : rule.operator === 'notEquals' ? 'equals' : rule.operator
      } as TextRule
      const match = this.textExpression(column, innerRule, key, params)
      const exists = `EXISTS (SELECT 1 FROM asset_sources aws WHERE aws.asset_id=a.id AND ${match})`
      return positive ? exists : `NOT ${exists}`
    }
    if (rule.field in categoryColumns && isTextRule(rule)) return this.textExpression(`COALESCE(${categoryColumns[rule.field as keyof typeof categoryColumns][0]}, '') || ' ' || COALESCE(${categoryColumns[rule.field as keyof typeof categoryColumns][1]}, '')`, rule, key, params)
    if (rule.field === 'aiDescription' && isTextRule(rule)) return this.textExpression("COALESCE(aia.description, '')", rule, key, params)
    if (rule.field in termFields && isTextRule(rule)) {
      params[`${key}Type`] = termFields[rule.field as keyof typeof termFields]
      const positive = rule.operator !== 'notContains' && rule.operator !== 'notEquals'
      const innerRule = { ...rule, operator: rule.operator === 'notContains' ? 'contains' : rule.operator === 'notEquals' ? 'equals' : rule.operator } as TextRule
      const match = innerRule.operator === 'equals'
        ? this.termEqualsExpression(innerRule, key, params)
        : this.textExpression("ait.value || ' ' || ait.normalized_value", innerRule, key, params)
      const primaryOnly = rule.field === 'aiObject' || rule.field === 'aiScene' || rule.field === 'aiStyle'
        ? `AND ait.id=(SELECT preferred.id FROM asset_ai_terms preferred WHERE preferred.asset_id=a.id AND preferred.type=@${key}Type AND (preferred.confidence>=0.60 OR preferred.source='manual') ORDER BY CASE WHEN preferred.source='manual' THEN 0 ELSE 1 END,preferred.confidence DESC,preferred.updated_at DESC LIMIT 1)`
        : ''
      const exists = `EXISTS (SELECT 1 FROM asset_ai_terms ait WHERE ait.asset_id=a.id AND ait.type=@${key}Type AND (ait.confidence >= 0.60 OR ait.source='manual') ${primaryOnly} AND ${match})`
      return positive ? exists : `NOT ${exists}`
    }
    if (isTextRule(rule)) {
      return this.textExpression(textColumns[rule.field as keyof typeof textColumns], rule, key, params)
    }
    if (isNumberRule(rule)) {
      const column = numberColumns[rule.field]
      if (rule.operator === 'between' && typeof rule.value === 'object') {
        params[`${key}Min`] = rule.value.min; params[`${key}Max`] = rule.value.max
        return `${column} BETWEEN @${key}Min AND @${key}Max`
      }
      params[key] = rule.value as number
      const operators = { equals: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
      return `${column} ${operators[rule.operator as keyof typeof operators]} @${key}`
    }
    if (rule.field === 'favorite') { params[key] = rule.value ? 1 : 0; return `a.favorite = @${key}` }
    if (rule.field === 'colorTemperature') { params[key] = rule.value; return `${rule.operator === 'isNot' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM asset_color_analysis aca WHERE aca.asset_id=a.id AND aca.temperature=@${key})` }
    if (rule.field === 'colorHex') {
      const lab = hexToLab(rule.value); params[`${key}L`] = lab.l; params[`${key}A`] = lab.a; params[`${key}B`] = lab.b; params[`${key}Threshold`] = 18 ** 2
      return `EXISTS (SELECT 1 FROM asset_colors ac WHERE ac.asset_id=a.id AND ac.lab_l IS NOT NULL AND COALESCE(ac.ratio,ac.population,0)>=0.12 AND ((ac.lab_l-@${key}L)*(ac.lab_l-@${key}L)+(ac.lab_a-@${key}A)*(ac.lab_a-@${key}A)+(ac.lab_b-@${key}B)*(ac.lab_b-@${key}B)) <= @${key}Threshold)`
    }
    if (rule.field === 'orientation') {
      const square = 'ABS(a.width - a.height) <= MAX(a.width, a.height) * 0.03'
      const expression = rule.value === 'square' ? square : rule.value === 'portrait' ? `(a.height > a.width AND NOT (${square}))` : `(a.width > a.height AND NOT (${square}))`
      return rule.operator === 'isNot' ? `NOT (${expression})` : expression
    }
    if (rule.field === 'folder' || rule.field === 'tag') {
      params[key] = rule.value
      const table = rule.field === 'folder' ? 'asset_folders' : 'asset_tags'
      const column = rule.field === 'folder' ? 'folder_id' : 'tag_id'
      const exists = `EXISTS (SELECT 1 FROM ${table} scr WHERE scr.asset_id = a.id AND scr.${column} = @${key})`
      return rule.operator === 'isNot' || rule.operator === 'notContains' ? `NOT ${exists}` : exists
    }
    if (!isDateRule(rule)) throw new Error(`Unsupported Smart Collection field: ${rule.field}`)
    const column = dateColumns[rule.field]
    if (rule.operator === 'today') return `date(${column}) = date('now', 'localtime')`
    if (rule.operator === 'last7' || rule.operator === 'last30' || rule.operator === 'last90') {
      const days = rule.operator === 'last7' ? 7 : rule.operator === 'last30' ? 30 : 90
      return `${column} >= datetime('now', '-${days} days')`
    }
    if (rule.operator === 'between' && rule.value && typeof rule.value === 'object') {
      params[`${key}From`] = rule.value.from; params[`${key}To`] = rule.value.to
      return `date(${column}) BETWEEN date(@${key}From) AND date(@${key}To)`
    }
    params[key] = rule.value as string
    return `date(${column}) ${rule.operator === 'before' ? '<' : '>'} date(@${key})`
  }

  private textExpression(column: string, rule: TextRule, key: string, params: Record<string, SQLInputValue>): string {
    const escaped = String(rule.value).replace(/[\\%_]/g, '\\$&')
    const values: Record<string, string> = { contains: `%${escaped}%`, notContains: `%${escaped}%`, equals: String(rule.value), notEquals: String(rule.value), startsWith: `${escaped}%`, endsWith: `%${escaped}` }
    params[key] = values[rule.operator] ?? String(rule.value)
    if (rule.operator === 'equals') return `LOWER(COALESCE(${column}, '')) = LOWER(@${key})`
    if (rule.operator === 'notEquals') return `LOWER(COALESCE(${column}, '')) != LOWER(@${key})`
    return `LOWER(COALESCE(${column}, '')) ${rule.operator === 'notContains' ? 'NOT ' : ''}LIKE LOWER(@${key}) ESCAPE '\\'`
  }

  private termEqualsExpression(rule: TextRule, key: string, params: Record<string, SQLInputValue>): string {
    params[key] = String(rule.value)
    return `(LOWER(ait.value)=LOWER(@${key}) OR LOWER(ait.normalized_value)=LOWER(@${key}))`
  }
}

const textFields = new Set<SmartCollectionRule['field']>(['filename','extension','sourceDomain','sourceType','aiPrimaryCategory','aiSecondaryCategory','aiTertiaryCategory','aiObject','aiScene','aiStyle','aiMood','aiLighting','aiComposition','aiMaterial','aiUsage','aiDescription','aiOpenTag','aiSemanticColor'])
const numberFields = new Set<SmartCollectionRule['field']>(['width', 'height', 'size','colorBrightness','colorSaturation'])
const dateFields = new Set<SmartCollectionRule['field']>(['importedAt', 'createdAt', 'lastOpenedAt'])
type TextRule = Extract<SmartCollectionRule, { field: SmartCollectionTextField }>
type NumberRule = Extract<SmartCollectionRule, { field: SmartCollectionNumberField }>
type DateRule = Extract<SmartCollectionRule, { field: SmartCollectionDateField }>
const isTextRule = (rule: SmartCollectionRule): rule is TextRule => textFields.has(rule.field)
const isNumberRule = (rule: SmartCollectionRule): rule is NumberRule => numberFields.has(rule.field)
const isDateRule = (rule: SmartCollectionRule): rule is DateRule => dateFields.has(rule.field)
