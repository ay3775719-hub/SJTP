import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { AssetPage, AssetQuery, NaturalSearchChip, NaturalSearchCondition, NaturalSearchExpression, NaturalSearchHistoryItem, NaturalSearchIntent, NaturalSearchParseResult, SmartCollectionInput, SmartCollectionRule } from '@shared/types/domain'
import { COLOR_BUCKETS, type ColorBucket } from '@shared/constants/colorBuckets'
import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY, normalizePrimaryObject } from '@shared/constants/aiVocabulary'
import { naturalSearchIntentSchema } from '@shared/schemas/naturalSearch'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { NaturalSearchRepository } from '../../database/repositories/NaturalSearchRepository'
import type { SmartCollectionService } from '../smartCollections/SmartCollectionService'
import type { CodexAppServerManager } from '../ai/codex/CodexAppServerManager'
import { NATURAL_SEARCH_OUTPUT_SCHEMA, NATURAL_SEARCH_PARSER_VERSION, NATURAL_SEARCH_SYSTEM_PROMPT, createNaturalSearchPrompt } from './naturalLanguageSearchPrompt'
import { SearchEntityResolver } from './SearchEntityResolver'
import { NaturalSearchQueryBuilder } from './NaturalSearchQueryBuilder'
import { logger, serializeError } from '../../logger'
import { z } from 'zod'
import type { HybridSearchService } from './HybridSearchService'

export class NaturalLanguageSearchService {
  private readonly builder = new NaturalSearchQueryBuilder()

  constructor(
    private readonly db: DatabaseSync,
    private readonly repository: NaturalSearchRepository,
    private readonly assets: AssetRepository,
    private readonly smartCollections: SmartCollectionService,
    private readonly resolver: SearchEntityResolver,
    private readonly codex: CodexAppServerManager,
    private readonly workspaceRoot: string,
    private readonly hybrid?: HybridSearchService
  ) {}

  async parse(queryText: string, forceNatural = false): Promise<NaturalSearchParseResult> {
    const query = queryText.normalize('NFKC').trim(), startedAt = Date.now()
    if (!forceNatural && !shouldUseNaturalLanguageParser(query)) {
      this.repository.addHistory(query, null)
      return this.result('direct', query, null, 'local', null, null, Date.now() - startedAt)
    }
    const cached = this.repository.getCached(query, NATURAL_SEARCH_PARSER_VERSION)
    if (cached) {
      this.repository.addHistory(query, cached.intent)
      return this.result('natural', query, cached.intent, 'cache', cached.model, null, Date.now() - startedAt)
    }
    try {
      let parsed: { intent: NaturalSearchIntent; model: string; durationMs: number }
      try { parsed = await this.parseWithCodex(query) }
      catch (firstError) {
        logger.warn('Retrying natural language search parser once', { query, error: serializeError(firstError) })
        parsed = await this.parseWithCodex(query)
      }
      const { intent } = parsed
      this.repository.saveCache(query, NATURAL_SEARCH_PARSER_VERSION, intent, parsed.model)
      this.repository.addHistory(query, intent)
      return this.result('natural', query, intent, 'codex', parsed.model, null, parsed.durationMs)
    } catch (error) {
      logger.warn('Natural language search parser fallback', { query, error: serializeError(error) })
      this.repository.addHistory(query, null)
      return this.result('fallback', query, null, 'fallback', null, '无法理解这个搜索条件，已改用普通搜索。', Date.now() - startedAt)
    }
  }

  private async parseWithCodex(query: string): Promise<{ intent: NaturalSearchIntent; model: string; durationMs: number }> {
    const models = await this.codex.listModels()
    const model = models.find((item) => item.isDefault) ?? models[0]
    if (!model) throw new Error('当前 Codex 账号没有可用的文本解析模型')
    const turn = await this.codex.runStructuredTextTurn({
      modelId: model.id, effort: 'low', workspacePath: join(this.workspaceRoot, 'natural-search'),
      baseInstructions: NATURAL_SEARCH_SYSTEM_PROMPT, prompt: createNaturalSearchPrompt(query), outputSchema: NATURAL_SEARCH_OUTPUT_SCHEMA
    })
    return { intent: normalizeIntent(parseCodexIntent(parseJson(turn.text))), model: turn.modelId, durationMs: turn.durationMs }
  }

  listAssets(query: AssetQuery): AssetPage {
    if (!query.naturalSearch) return this.assets.list(query)
    const resolved = this.resolver.resolve(query.naturalSearch)
    return this.assets.listWithPredicate({ ...query, search: undefined, naturalSearch: undefined }, this.builder.build(resolved))
  }

  async listHybridAssets(query: AssetQuery): Promise<AssetPage> {
    return this.hybrid && (query.search || query.naturalSearch || query.searchResultSetId) ? this.hybrid.list(query) : this.listAssets(query)
  }

  async createResultSet(query: AssetQuery, previewLimit = 5) {
    if (!this.hybrid) throw new Error('Hybrid search is unavailable')
    return this.hybrid.create(query, previewLimit)
  }

  history(limit = 10): NaturalSearchHistoryItem[] { return this.repository.history(limit) }

  removeCondition(intent: NaturalSearchIntent, signature: string): { intent: NaturalSearchIntent | null; chips: NaturalSearchChip[]; canSaveAsSmartCollection: boolean } {
    const expression = removeExpression(intent.expression, signature)
    const next = expression ? { ...intent, expression } : null
    return { intent: next, chips: next ? chipsFor(next.expression) : [], canSaveAsSmartCollection: next ? canFlatten(next.expression) : false }
  }

  saveAsSmartCollection(queryText: string, intent: NaturalSearchIntent) {
    const input = toSmartCollectionInput(queryText, this.resolver.resolve(intent.expression))
    return this.smartCollections.create(input)
  }

  private result(mode: NaturalSearchParseResult['mode'], queryText: string, intent: NaturalSearchIntent | null, parsedBy: NaturalSearchParseResult['parsedBy'], model: string | null, warning: string | null, durationMs: number): NaturalSearchParseResult {
    return {
      mode, queryText, intent, chips: intent ? chipsFor(intent.expression) : [], parsedBy, model, warning,
      canSaveAsSmartCollection: intent ? canFlatten(intent.expression) : false,
      unAnalyzedCount: this.unAnalyzedCount(), durationMs
    }
  }

  private unAnalyzedCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id
      WHERE a.deleted_at IS NULL AND (aia.asset_id IS NULL OR aia.status!='completed')`).get() as unknown as { count: number }).count
  }
}

export function shouldUseNaturalLanguageParser(query: string): boolean {
  const compact = query.replace(/\s+/g, '')
  if (!compact) return false
  const exactLocalKeyword = /^(背包|鞋|鞋子|手机|手表|沙发|椅子|汽车|建筑|海报|包装|人物|家具|相机|png|jpg|jpeg|webp|gif)$/i
  if (exactLocalKeyword.test(compact)) return false
  return /找|帮我|的|或者|或是|不要|排除|收藏|最近|今天|上个月|竖版|横版|方形|白底|户外|室内|工作室|产品摄影|生活方式|极简|Editorial|复古|科技感|电影感|奢华|自然主义|清新|绿色|蓝色|红色|暖色|冷色|文件夹|标签/i.test(compact)
    || /\s+(and|or|not|in|from|with)\s+/i.test(query)
    || compact.length > 10
}

function normalizeIntent(intent: NaturalSearchIntent): NaturalSearchIntent {
  return { ...intent, expression: normalizeExpression(intent.expression) }
}
function normalizeExpression(expression: NaturalSearchExpression): NaturalSearchExpression {
  if ('field' in expression) {
    const value = typeof expression.value === 'string' ? expression.value.normalize('NFKC').trim() : expression.value
    return { ...expression, value } as NaturalSearchCondition
  }
  if (expression.operator === 'not') return { operator: 'not', child: normalizeExpression(expression.child) }
  return { operator: expression.operator, children: expression.children.map(normalizeExpression) }
}
function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

const codexConditionSchema = z.object({
  field: z.enum(['object','scene','style','color','favorite','folder','tag','orientation','importedDate','filename','description','freeText','extension']),
  operator: z.enum(['equals','contains','near','within']), value: z.string().trim().min(1).max(120), negate: z.boolean()
})
const codexOutputSchema = z.object({ operator: z.enum(['and','or']), conditions: z.array(codexConditionSchema).min(1).max(12) })

function parseCodexIntent(value: unknown): NaturalSearchIntent {
  const parsed = codexOutputSchema.parse(value)
  const conditions = parsed.conditions.map((raw): NaturalSearchExpression => {
    let condition: NaturalSearchCondition
    if (raw.field === 'favorite') condition = { field: 'favorite', operator: 'equals', value: /^(true|yes|1|是|收藏)$/i.test(raw.value) }
    else if (raw.field === 'orientation') condition = { field: 'orientation', operator: 'equals', value: raw.value as 'portrait' | 'landscape' | 'square' }
    else if (raw.field === 'importedDate') condition = { field: 'importedDate', operator: 'within', value: raw.value as 'today' | 'last_7_days' | 'last_30_days' }
    else if (raw.field === 'color') condition = { field: 'color', operator: 'near', value: raw.value }
    else if (raw.field === 'object' || raw.field === 'scene' || raw.field === 'style' || raw.field === 'folder' || raw.field === 'tag' || raw.field === 'extension') condition = { field: raw.field, operator: 'equals', value: raw.value } as NaturalSearchCondition
    else condition = { field: raw.field, operator: raw.operator === 'equals' ? 'equals' : 'contains', value: raw.value }
    return raw.negate ? { operator: 'not', child: condition } : condition
  })
  const expression: NaturalSearchExpression = conditions.length === 1 ? conditions[0]! : { operator: parsed.operator, children: conditions }
  return naturalSearchIntentSchema.parse({ expression }) as NaturalSearchIntent
}

function chipsFor(expression: NaturalSearchExpression, negative = false): NaturalSearchChip[] {
  if ('field' in expression) return [{ signature: signatureFor(expression, negative), label: labelFor(expression), negative }]
  if (expression.operator === 'not') return chipsFor(expression.child, !negative)
  return expression.children.flatMap((child) => chipsFor(child, negative))
}
function signatureFor(condition: NaturalSearchCondition, negative: boolean): string { return `${negative ? '!' : ''}${condition.field}:${condition.operator}:${String(condition.value)}` }
function labelFor(condition: NaturalSearchCondition): string {
  if (condition.field === 'object') return `对象：${normalizePrimaryObject(condition.value).value}`
  if (condition.field === 'scene') return `场景：${MINIMAL_SCENE_VOCABULARY[stripPrefix(condition.value) as keyof typeof MINIMAL_SCENE_VOCABULARY] ?? condition.value}`
  if (condition.field === 'style') return `风格：${MINIMAL_STYLE_VOCABULARY[stripPrefix(condition.value) as keyof typeof MINIMAL_STYLE_VOCABULARY] ?? condition.value}`
  if (condition.field === 'color') return `颜色：${COLOR_BUCKETS[condition.value as ColorBucket]?.label ?? condition.value}`
  if (condition.field === 'favorite') return condition.value ? '已收藏' : '未收藏'
  if (condition.field === 'orientation') return `方向：${{ portrait: '竖版', landscape: '横版', square: '方形' }[condition.value]}`
  if (condition.field === 'importedDate') return `时间：${{ today: '今天', last_7_days: '最近 7 天', last_30_days: '最近 30 天' }[condition.value]}`
  if (condition.field === 'folder') return `文件夹：${condition.value}`
  if (condition.field === 'tag') return `标签：${condition.value}`
  if (condition.field === 'extension') return `格式：${condition.value.toUpperCase()}`
  if (condition.field === 'filename') return `文件名：${condition.value}`
  if (condition.field === 'description') return `描述：${condition.value}`
  return `文本：${condition.value}`
}
function stripPrefix(value: string): string { return value.replace(/^(scene|style)\./, '') }

function removeExpression(expression: NaturalSearchExpression, signature: string, negative = false): NaturalSearchExpression | null {
  if ('field' in expression) return signatureFor(expression, negative) === signature ? null : expression
  if (expression.operator === 'not') {
    const child = removeExpression(expression.child, signature, !negative)
    return child ? { operator: 'not', child } : null
  }
  const children = expression.children.map((child) => removeExpression(child, signature, negative)).filter((child): child is NaturalSearchExpression => Boolean(child))
  if (!children.length) return null
  if (children.length === 1) return children[0]!
  return { operator: expression.operator, children }
}

function canFlatten(expression: NaturalSearchExpression): boolean {
  if ('field' in expression) return true
  if (expression.operator === 'not') return 'field' in expression.child && supportsNegation(expression.child)
  return expression.children.every((child) => 'field' in child || (child.operator === 'not' && 'field' in child.child && supportsNegation(child.child)))
}
function supportsNegation(condition: NaturalSearchCondition): boolean { return condition.field !== 'color' && condition.field !== 'importedDate' }

function toSmartCollectionInput(queryText: string, expression: NaturalSearchExpression): SmartCollectionInput {
  if (!canFlatten(expression)) throw new Error('这个搜索包含嵌套条件，当前版本无法无损保存为智能集合')
  const root = 'field' in expression || expression.operator === 'not' ? [expression] : expression.children
  const matchMode = !('field' in expression) && expression.operator !== 'not' && expression.operator === 'or' ? 'any' : 'all'
  const rules = root.map((item, index) => {
    const negative = !('field' in item) && item.operator === 'not'
    const condition = (negative ? item.child : item) as NaturalSearchCondition
    return smartRule(condition, negative, index)
  })
  const name = queryText.replace(/^(帮我)?找(一下|一些|些)?/u, '').replace(/[，。！？]/g, '').trim().slice(0, 80) || '自然语言搜索'
  return { name, matchMode, rules }
}
function smartRule(condition: NaturalSearchCondition, negative: boolean, index: number): SmartCollectionRule {
  const id = nanoid(10)
  if (condition.field === 'object' || condition.field === 'scene' || condition.field === 'style') return { id, field: condition.field === 'object' ? 'aiObject' : condition.field === 'scene' ? 'aiScene' : 'aiStyle', operator: negative ? 'notEquals' : 'equals', value: condition.value }
  if (condition.field === 'color') return { id, field: 'colorHex', operator: 'near', value: COLOR_BUCKETS[condition.value as ColorBucket]?.hex ?? '#808080' }
  if (condition.field === 'favorite') return { id, field: 'favorite', operator: 'is', value: negative ? !condition.value : condition.value }
  if (condition.field === 'folder' || condition.field === 'tag') return { id, field: condition.field, operator: negative ? 'isNot' : 'is', value: condition.value }
  if (condition.field === 'orientation') return { id, field: 'orientation', operator: negative ? 'isNot' : 'is', value: condition.value }
  if (condition.field === 'importedDate') return { id, field: 'importedAt', operator: condition.value === 'today' ? 'today' : condition.value === 'last_7_days' ? 'last7' : 'last30', value: null }
  if (condition.field === 'extension') return { id, field: 'extension', operator: negative ? 'notEquals' : 'equals', value: condition.value }
  const field = condition.field === 'filename' ? 'filename' : 'aiDescription'
  return { id, field, operator: negative ? 'notContains' : condition.operator, value: condition.value }
}
