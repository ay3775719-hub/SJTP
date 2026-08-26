import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { Asset, AssetPage, DesktopAction, DuplicateGroupKind, MuseToolPermission, NaturalSearchExpression, SmartCollectionInput, VisualSimilarityResult } from '@shared/types/domain'
import { idSchema } from '@shared/schemas/ipc'
import { naturalSearchExpressionSchema } from '@shared/schemas/naturalSearch'
import { smartCollectionInputSchema } from '@shared/schemas/smartCollections'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { FolderRepository } from '../../database/repositories/FolderRepository'
import type { TagRepository } from '../../database/repositories/TagRepository'
import type { MuseAgentRepository } from '../../database/repositories/MuseAgentRepository'
import type { SmartCollectionService } from '../smartCollections/SmartCollectionService'
import type { NaturalLanguageSearchService } from '../search/NaturalLanguageSearchService'
import type { VisualEmbeddingService } from '../embeddings/VisualEmbeddingService'
import type { DuplicateDetectionService } from '../duplicates/DuplicateDetectionService'
import type { MuseAgentContextService } from './MuseAgentContextService'
import type { MuseAgentApprovalService } from './MuseAgentApprovalService'

export interface MuseToolExecutionContext {
  conversationId: string | null
  threadId: string
  turnId: string
  signal?: AbortSignal
}

export interface MuseToolResult {
  success: boolean
  code: string
  message?: string
  data?: unknown
}

export interface MuseToolSpec {
  name: string
  description: string
  inputSchema: object
  permission: MuseToolPermission
}

interface ApprovalSummary {
  title: string
  summary: string
  targetCount: number
  details: Array<{ label: string; value: string }>
}

interface ToolDefinition {
  name: string
  description: string
  permission: MuseToolPermission
  schema: z.ZodType<unknown>
  activity: string
  handler(input: unknown, context: MuseToolExecutionContext): Promise<MuseToolResult>
  approval?(input: unknown): ApprovalSummary
  resolve?(input: unknown, context: MuseToolExecutionContext): unknown
}

interface ResultSet {
  id: string
  sourceAssetId: string | null
  similarity: VisualSimilarityResult | null
  createdAt: number
}

interface RegistryDependencies {
  assets: AssetRepository
  folders: FolderRepository
  tags: TagRepository
  smartCollections: SmartCollectionService
  search: NaturalLanguageSearchService
  visualSimilarity: VisualEmbeddingService
  duplicates: DuplicateDetectionService
  context: MuseAgentContextService
  approval: MuseAgentApprovalService
  repository: MuseAgentRepository
  emitAction(action: DesktopAction): void
  emitLibraryChange(kind: 'asset:updated' | 'tag:created' | 'smart-collection:created', assetIds?: string[]): void
  emitActivity(context: MuseToolExecutionContext, toolName: string, label: string, active: boolean): void
}

const pageSchema = z.object({ offset: z.number().int().min(0).max(100_000).default(0), limit: z.number().int().min(1).max(200).default(50) })
const assetIdsSchema = z.array(idSchema).min(1).max(5_000)
const getAssetSchema = z.object({ assetId: idSchema })
const getAssetsSchema = pageSchema.extend({ assetIds: z.array(idSchema).max(200).optional() })
const recentSchema = pageSchema.extend({ days: z.number().int().min(1).max(365).default(30) })
const searchSchema = z.object({ expression: naturalSearchExpressionSchema, limit: z.number().int().min(1).max(200).default(50), sort: z.enum(['imported-desc','imported-asc','name-asc','name-desc','size-desc','width-desc','height-desc']).default('imported-desc') })
const findSimilarSchema = z.object({ sourceAssetId: idSchema, limit: z.number().int().min(1).max(100).default(20) })
const duplicateSchema = z.object({ kind: z.enum(['exact','near','all']).default('all'), assetId: idSchema.optional(), resultSetId: idSchema.optional() })
const targetSchema = z.union([
  z.object({ assetIds: assetIdsSchema, useCurrentSelection: z.literal(false).optional() }),
  z.object({ useCurrentSelection: z.literal(true), assetIds: z.array(idSchema).max(0).optional() })
])
const tagMutationSchema = targetSchema.and(z.object({ tags: z.array(z.string().trim().min(1).max(80)).min(1).max(20) }))
const favoriteSchema = targetSchema.and(z.object({ favorite: z.boolean() }))
const resolvedTagMutationSchema = z.object({ assetIds: assetIdsSchema, tags: z.array(z.string().trim().min(1).max(80)).min(1).max(20) })
const resolvedFavoriteSchema = z.object({ assetIds: assetIdsSchema, favorite: z.boolean() })

export class MuseToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>()
  private readonly resultSets = new Map<string, ResultSet>()

  constructor(private readonly dependencies: RegistryDependencies) {
    this.registerReadTools()
    this.registerWriteTools()
  }

  specs(): MuseToolSpec[] {
    return [...this.definitions.values()].map((definition) => ({
      name: definition.name,
      description: definition.description,
      permission: definition.permission,
      inputSchema: z.toJSONSchema(definition.schema) as object
    }))
  }

  permissions(): Array<{ name: string; permission: MuseToolPermission }> {
    return [...this.definitions.values()].map(({ name, permission }) => ({ name: `muse.${name}`, permission }))
  }

  async execute(name: string, input: unknown, context: MuseToolExecutionContext): Promise<MuseToolResult> {
    this.pruneResultSets()
    const definition = this.definitions.get(name)
    if (!definition) return { success: false, code: 'TOOL_NOT_FOUND', message: `Muse Tool 不存在：${name}` }
    const parsed = definition.schema.safeParse(input)
    if (!parsed.success) return { success: false, code: 'INVALID_TOOL_INPUT', message: parsed.error.issues.map((issue) => issue.message).join('; ') }
    let resolvedInput = definition.resolve ? definition.resolve(parsed.data, context) : parsed.data
    if (name === 'create_smart_collection') {
      const existing = this.dependencies.smartCollections.findEquivalent(resolvedInput as SmartCollectionInput)
      if (existing) return fail('COLLECTION_ALREADY_EXISTS', `已经存在相同规则的智能集合“${existing.name}”。`, { collectionId: existing.id })
    }
    let approved: boolean | null = definition.permission === 'read' ? null : false
    let targetCount = 0
    this.dependencies.emitActivity(context, `muse.${name}`, definition.activity, true)
    try {
      if (definition.permission === 'destructive') return { success: false, code: 'DESTRUCTIVE_TOOL_DISABLED', message: 'Muse AI v1 不开放破坏性操作。' }
      if (definition.permission === 'safe-write') {
        const summary = definition.approval?.(resolvedInput) ?? { title: name, summary: '修改 Muse 素材库', targetCount: 0, details: [] }
        targetCount = summary.targetCount
        approved = await this.dependencies.approval.request({ ...summary, conversationId: context.conversationId, threadId: context.threadId, turnId: context.turnId, toolName: `muse.${name}` }, context.signal)
        if (!approved) return { success: false, code: 'USER_DECLINED', message: '用户拒绝了这项操作。' }
        if (definition.resolve) {
          const latestInput = definition.resolve(parsed.data, context)
          if (JSON.stringify(latestInput) !== JSON.stringify(resolvedInput)) return { success: false, code: 'TARGET_CHANGED', message: '当前选择在确认期间发生了变化，未执行操作。请重新确认。' }
          resolvedInput = latestInput
        }
      }
      const result = await definition.handler(resolvedInput, context)
      if (typeof result.data === 'object' && result.data && 'affectedCount' in result.data) targetCount = Number((result.data as { affectedCount: unknown }).affectedCount) || targetCount
      this.audit(context, definition, targetCount, approved, result.code)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.audit(context, definition, targetCount, approved, 'TOOL_EXECUTION_FAILED')
      return { success: false, code: 'TOOL_EXECUTION_FAILED', message }
    } finally {
      this.dependencies.emitActivity(context, `muse.${name}`, definition.activity, false)
      if (definition.permission === 'safe-write' && approved === false) this.audit(context, definition, targetCount, false, 'USER_DECLINED')
    }
  }

  private registerReadTools(): void {
    this.add('get_library_stats', 'Read real Muse Library counts and index status. Never estimate counts.', z.object({}), 'read', '正在查看图库统计...', async () => {
      const stats = this.dependencies.assets.stats()
      return ok({ ...stats, unanalyzed: this.dependencies.assets.countUnanalyzed(), folders: this.dependencies.folders.list().length, tags: this.dependencies.tags.list().length,
        smartCollections: this.dependencies.smartCollections.list().length, duplicateGroupCount: this.dependencies.duplicates.status().groupCount,
        visualClusterCount: null, visualClustersAvailable: false })
    })
    this.add('get_selected_assets', 'Read the current Gallery selection at execution time. Use this for “这些”, “这张”, “当前” or “选中的”.', pageSchema, 'read', '正在读取当前选择...', async (input) => {
      const page = pageSchema.parse(input), snapshot = this.dependencies.context.current()
      const ids = snapshot.selectedAssetIds.slice(page.offset, page.offset + page.limit)
      return ok({ count: snapshot.selectionCount, offset: page.offset, assets: this.dependencies.assets.getMany(ids).map(assetSummary), focusedAssetId: snapshot.focusedAssetId })
    })
    this.add('get_asset', 'Read one Muse asset by assetId. Returns library metadata, never file binary or embedding vectors.', getAssetSchema, 'read', '正在读取素材信息...', async (input) => {
      const { assetId } = getAssetSchema.parse(input), asset = this.dependencies.assets.get(assetId)
      return asset ? ok(assetDetail(asset)) : fail('ASSET_NOT_FOUND', '找不到该素材。')
    })
    this.add('get_assets', 'Read a paginated list of active assets, or a bounded list of explicit assetIds. Maximum 200.', getAssetsSchema, 'read', '正在读取素材...', async (input) => {
      const value = getAssetsSchema.parse(input)
      if (value.assetIds) return ok({ total: value.assetIds.length, offset: 0, assets: this.dependencies.assets.getMany(value.assetIds).map(assetSummary) })
      return ok(pageResult(this.dependencies.assets.list({ cursor: String(value.offset), limit: value.limit })))
    })
    this.add('get_recent_assets', 'Read assets imported in the last N days, newest first.', recentSchema, 'read', '正在查看最近导入的素材...', async (input) => {
      const value = recentSchema.parse(input)
      return ok(pageResult(this.dependencies.assets.listRecent(value.days, value.limit, value.offset)))
    })
    this.add('search_assets', 'Search through the existing Muse SearchService using a structured AND/OR/NOT expression. Supported fields: object, scene, style, color, favorite, folder, tag, orientation, importedDate, filename, description, freeText, extension.', searchSchema, 'read', '正在搜索素材...', async (input) => {
      const value = searchSchema.parse(input)
      const query = { naturalSearch: value.expression as NaturalSearchExpression, limit: value.limit, sort: value.sort }
      const result = await this.dependencies.search.createResultSet(query, 5)
      this.dependencies.emitAction({ type: 'agent-search-results', title: 'Muse AI 搜索结果', resultSetId: result.id })
      return ok({ resultSetId: result.id, totalCount: result.totalCount, previewCount: result.previewCount,
        previewAssets: result.previewAssets.map(assetSummary), querySummary: value.expression, coverage: result.coverage })
    })
    this.add('list_folders', 'List real Muse folders and active asset counts.', z.object({}), 'read', '正在读取文件夹...', async () => ok({ folders: this.dependencies.folders.list() }))
    this.add('list_tags', 'List real Muse tags and active asset counts.', z.object({}), 'read', '正在读取标签...', async () => ok({ tags: this.dependencies.tags.list() }))
    this.add('list_smart_collections', 'List real smart collections with rules and live counts. Use before creating one to avoid duplicates.', z.object({}), 'read', '正在读取智能集合...', async () => ok({ collections: this.dependencies.smartCollections.list() }))
    this.add('get_visual_clusters', 'Read existing visual clusters. This capability is unavailable when Muse has no VisualClusteringService.', z.object({ limit: z.number().int().min(1).max(50).default(12) }), 'read', '正在查看视觉分组...', async () => fail('VISUAL_CLUSTERING_UNAVAILABLE', '当前仓库没有可复用的 VisualClusteringService，Muse AI 不会伪造视觉分组。'))
    this.add('get_duplicate_groups', 'Read exact or near-duplicate groups from DuplicateDetectionService. When resultSetId is supplied, exclude duplicate variants of that result set source and refresh Gallery.', duplicateSchema, 'read', '正在检查重复素材...', async (input) => {
      const value = duplicateSchema.parse(input), kind = value.kind === 'all' ? undefined : value.kind as DuplicateGroupKind
      let groups = this.dependencies.duplicates.list(kind)
      if (value.assetId) groups = groups.filter((group) => group.members.some((member) => member.asset.id === value.assetId))
      let excludedAssetIds: string[] = []
      if (value.resultSetId) excludedAssetIds = this.excludeDuplicatesFromResultSet(value.resultSetId, groups)
      return ok({ groupCount: groups.length, excludedAssetIds, groups: groups.map((group) => ({ id: group.id, kind: group.kind, count: group.members.length,
        recommendedKeepAssetId: group.recommendedKeepAssetId, memberAssetIds: group.members.map((member) => member.asset.id) })) })
    })
    this.add('find_similar', 'Find real visual neighbors with the existing local VisualSimilaritySearchService. This is visual similarity, not duplicate probability.', findSimilarSchema, 'read', '正在查找相似图片...', async (input) => {
      const value = findSimilarSchema.parse(input), result = await this.dependencies.visualSimilarity.findSimilar(value.sourceAssetId, value.limit)
      const resultSetId = nanoid(14)
      this.resultSets.set(resultSetId, { id: resultSetId, sourceAssetId: value.sourceAssetId, similarity: result, createdAt: Date.now() })
      this.dependencies.emitAction({ type: 'agent-similar-results', result })
      return ok({ resultSetId, sourceAssetId: value.sourceAssetId, count: result.results.length,
        results: result.results.map((item) => ({ ...assetSummary(item.asset), visualSimilarity: item.score })) })
    })
  }

  private registerWriteTools(): void {
    this.add('create_smart_collection', 'Create a saved dynamic query through the existing SmartCollectionService. Requires user approval and rejects equivalent existing rules.', smartCollectionInputSchema, 'safe-write', '准备创建智能集合...', async (input) => {
      const value = smartCollectionInputSchema.parse(input) as SmartCollectionInput
      const existing = this.dependencies.smartCollections.findEquivalent(value)
      if (existing) return fail('COLLECTION_ALREADY_EXISTS', `已经存在相同规则的智能集合“${existing.name}”。`, { collectionId: existing.id })
      const collection = this.dependencies.smartCollections.create(value)
      this.dependencies.emitLibraryChange('smart-collection:created')
      return ok({ collection, affectedCount: collection.assetCount }, 'COLLECTION_CREATED')
    }, (input) => {
      const value = smartCollectionInputSchema.parse(input)
      const preview = this.dependencies.smartCollections.preview(value)
      return { title: '创建智能集合', summary: `创建“${value.name}”`, targetCount: preview.total,
        details: [{ label: '名称', value: value.name }, { label: '规则', value: summarizeRules(value) }, { label: '当前匹配', value: `${preview.total} 项素材` }] }
    })
    this.add('add_tags', 'Add one or more manual tags to explicit assets using the existing TagRepository. Missing tags are created. Requires user approval.', tagMutationSchema, 'safe-write', '准备添加标签...', async (input) => {
      const value = resolvedTagMutationSchema.parse(input), tagIds: string[] = []
      for (const name of uniqueNames(value.tags)) { const tag = this.dependencies.tags.create(name); tagIds.push(tag.id); this.dependencies.tags.attach(value.assetIds, tag.id) }
      this.dependencies.emitLibraryChange('tag:created', value.assetIds)
      this.dependencies.emitLibraryChange('asset:updated', value.assetIds)
      return ok({ affectedCount: value.assetIds.length, tagIds }, 'TAGS_ADDED')
    }, (input) => { const value = resolvedTagMutationSchema.parse(input); return { title: '添加标签', summary: `为 ${value.assetIds.length} 张素材添加标签`, targetCount: value.assetIds.length, details: [{ label: '标签', value: uniqueNames(value.tags).join('、') }, { label: '目标', value: `${value.assetIds.length} 项素材` }] } }, (input) => resolveSelectionTarget(input, this.dependencies.context.current().selectedAssetIds))
    this.add('remove_tags', 'Remove named tags from explicit assets through the existing TagRepository. Requires user approval.', tagMutationSchema, 'safe-write', '准备移除标签...', async (input) => {
      const value = resolvedTagMutationSchema.parse(input), byName = new Map(this.dependencies.tags.list().map((tag) => [tag.name.normalize('NFKC').toLocaleLowerCase(), tag]))
      const removed: string[] = []
      for (const name of uniqueNames(value.tags)) { const tag = byName.get(name.normalize('NFKC').toLocaleLowerCase()); if (tag) { this.dependencies.tags.detach(value.assetIds, tag.id); removed.push(tag.id) } }
      this.dependencies.emitLibraryChange('asset:updated', value.assetIds)
      return ok({ affectedCount: value.assetIds.length, removedTagIds: removed }, 'TAGS_REMOVED')
    }, (input) => { const value = resolvedTagMutationSchema.parse(input); return { title: '移除标签', summary: `从 ${value.assetIds.length} 张素材移除标签`, targetCount: value.assetIds.length, details: [{ label: '标签', value: uniqueNames(value.tags).join('、') }, { label: '目标', value: `${value.assetIds.length} 项素材` }] } }, (input) => resolveSelectionTarget(input, this.dependencies.context.current().selectedAssetIds))
    this.add('set_favorite', 'Set favorite state for explicit active assets. Requires user approval.', favoriteSchema, 'safe-write', '准备更新收藏状态...', async (input) => {
      const value = resolvedFavoriteSchema.parse(input), affectedCount = this.dependencies.assets.setFavorite(value.assetIds, value.favorite)
      this.dependencies.emitLibraryChange('asset:updated', value.assetIds)
      return ok({ affectedCount, favorite: value.favorite }, 'FAVORITE_UPDATED')
    }, (input) => { const value = resolvedFavoriteSchema.parse(input); return { title: value.favorite ? '收藏素材' : '取消收藏', summary: `${value.favorite ? '收藏' : '取消收藏'} ${value.assetIds.length} 张素材`, targetCount: value.assetIds.length, details: [{ label: '操作', value: value.favorite ? '设为收藏' : '取消收藏' }, { label: '目标', value: `${value.assetIds.length} 项素材` }] } }, (input) => resolveSelectionTarget(input, this.dependencies.context.current().selectedAssetIds))
  }

  private add<T>(name: string, description: string, schema: z.ZodType<T>, permission: MuseToolPermission, activity: string,
    handler: (input: T, context: MuseToolExecutionContext) => Promise<MuseToolResult>, approval?: (input: T) => ApprovalSummary,
    resolve?: (input: T, context: MuseToolExecutionContext) => T): void {
    this.definitions.set(name, { name, description, permission, schema: schema as z.ZodType<unknown>, activity,
      handler: (input, context) => handler(input as T, context), approval: approval ? (input) => approval(input as T) : undefined,
      resolve: resolve ? (input, context) => resolve(input as T, context) : undefined })
  }

  private excludeDuplicatesFromResultSet(resultSetId: string, groups: ReturnType<DuplicateDetectionService['list']>): string[] {
    const resultSet = this.resultSets.get(resultSetId)
    if (!resultSet?.similarity || !resultSet.sourceAssetId) return []
    const sourceGroups = groups.filter((group) => group.members.some((member) => member.asset.id === resultSet.sourceAssetId))
    const excluded = new Set(sourceGroups.flatMap((group) => group.members.map((member) => member.asset.id)).filter((id) => id !== resultSet.sourceAssetId))
    const filtered: VisualSimilarityResult = { ...resultSet.similarity, results: resultSet.similarity.results.filter((item) => !excluded.has(item.asset.id)) }
    resultSet.similarity = filtered
    this.dependencies.emitAction({ type: 'agent-similar-results', result: filtered })
    return [...excluded]
  }

  private pruneResultSets(): void {
    const cutoff = Date.now() - 30 * 60_000
    for (const [id, result] of this.resultSets) if (result.createdAt < cutoff) this.resultSets.delete(id)
  }

  private audit(context: MuseToolExecutionContext, definition: ToolDefinition, targetCount: number, approved: boolean | null, resultCode: string): void {
    this.dependencies.repository.audit({ conversationId: context.conversationId, codexThreadId: context.threadId, turnId: context.turnId,
      toolName: `muse.${definition.name}`, permission: definition.permission, targetCount, approved, resultCode })
  }
}

function ok(data: unknown, code = 'OK'): MuseToolResult { return { success: true, code, data } }
function fail(code: string, message: string, data?: unknown): MuseToolResult { return { success: false, code, message, ...(data === undefined ? {} : { data }) } }
function assetSummary(asset: Asset): object { return { id: asset.id, filename: asset.filename, primaryObject: asset.ai?.primaryObject?.value ?? null, primaryScene: asset.ai?.primaryScene?.value ?? null,
  primaryStyle: asset.ai?.primaryStyle?.value ?? null, favorite: asset.favorite, importedAt: asset.importedAt } }
function assetDetail(asset: Asset): object { return { ...assetSummary(asset), dimensions: { width: asset.width, height: asset.height }, format: asset.extension, size: asset.size,
  folderIds: asset.folderIds, tags: asset.tags.map((tag) => ({ id: tag.id, name: tag.name })), description: asset.ai?.description ?? null,
  colors: asset.colors.slice(0, 6).map((color) => ({ hex: color.hex, ratio: color.ratio ?? null })), sourceUrl: asset.sourceUrl } }
function pageResult(page: AssetPage): object { return { total: page.total, nextOffset: page.nextCursor ? Number(page.nextCursor) : null, assets: page.items.map(assetSummary) } }
function uniqueNames(values: string[]): string[] { return [...new Set(values.map((value) => value.normalize('NFKC').trim()).filter(Boolean))] }
function summarizeRules(input: SmartCollectionInput): string { return input.rules.map((rule) => `${rule.field} ${rule.operator} ${formatRuleValue(rule.value)}`).join(input.matchMode === 'all' ? ' 且 ' : ' 或 ') }
function formatRuleValue(value: SmartCollectionInput['rules'][number]['value']): string { return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '') }
function resolveSelectionTarget<T extends { useCurrentSelection?: boolean; assetIds?: string[] }>(input: T, selectedAssetIds: string[]): T & { assetIds: string[] } {
  return { ...input, assetIds: input.useCurrentSelection ? [...selectedAssetIds] : [...(input.assetIds ?? [])] }
}
