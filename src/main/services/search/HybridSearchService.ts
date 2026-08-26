import { nanoid } from 'nanoid'
import type { AssetPage, AssetQuery, NaturalSearchExpression, SearchResultSetSummary } from '@shared/types/domain'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import { NaturalSearchQueryBuilder } from './NaturalSearchQueryBuilder'
import { SearchEntityResolver } from './SearchEntityResolver'
import type { LocalSemanticSearchService } from './LocalSemanticSearchService'
import { normalizeSearchConcept } from './SearchConceptNormalizer'

export interface SearchDebugEntry { assetId: string; structuredMatch: boolean; metadataMatch: boolean; semanticScore: number | null; colorMatch: boolean | null; finalScore: number }
interface StoredResult { id: string; assetIds: string[]; query: AssetQuery; coverage: SearchResultSetSummary['coverage']; debug: SearchDebugEntry[]; createdAt: number }
export class HybridSearchService {
  private readonly builder = new NaturalSearchQueryBuilder()
  private readonly results = new Map<string, StoredResult>()
  constructor(private readonly assets: AssetRepository, private readonly resolver: SearchEntityResolver, private readonly semantic: LocalSemanticSearchService) {}

  async create(query: AssetQuery, previewLimit = 5): Promise<SearchResultSetSummary> {
    const started = performance.now()
    this.expire()
    const base = { ...query, search: undefined, naturalSearch: undefined, searchResultSetId: undefined, cursor: undefined, limit: undefined }
    let ranked: string[], metadata = new Set<string>(), semanticIds = new Set<string>(), indexed = 0, semanticScores = new Map<string, number>()
    if (query.naturalSearch) {
      const expression = this.resolver.resolve(query.naturalSearch)
      metadata = new Set(this.assets.listIdsWithPredicate(base, this.builder.build(expression)))
      const evaluated = await this.evaluate(expression, base)
      ranked = [...evaluated.ids]; semanticIds = evaluated.semantic; indexed = evaluated.indexed
      semanticScores = evaluated.scores
      ranked.sort((a, b) => (metadata.has(b) ? 1 : 0) - (metadata.has(a) ? 1 : 0) || (evaluated.scores.get(b) ?? -1) - (evaluated.scores.get(a) ?? -1))
    } else {
      metadata = new Set(this.assets.listIdsWithPredicate({ ...base, search: query.search }))
      const local = query.search ? await this.semantic.search(query.search) : { matches: [], indexed: 0 }
      const eligible = new Set(this.assets.listIdsEligibleForSemantic(base, 'freeText', conceptParts(query.search ?? '')))
      semanticIds = new Set(local.matches.filter((item) => eligible.has(item.assetId)).map((item) => item.assetId)); indexed = local.indexed
      const score = new Map(local.matches.map((item) => [item.assetId, item.score]))
      semanticScores = score
      ranked = [...new Set([...metadata, ...semanticIds])]
      ranked.sort((a, b) => (metadata.has(b) ? 1 : 0) - (metadata.has(a) ? 1 : 0) || (score.get(b) ?? -1) - (score.get(a) ?? -1))
    }
    const colorCondition = query.naturalSearch ? findCondition(query.naturalSearch, 'color') : null
    const colorIds = colorCondition ? new Set(this.assets.listIdsWithPredicate(base, this.builder.build(colorCondition))) : null
    const debug = ranked.map((assetId) => ({ assetId, structuredMatch: metadata.has(assetId), metadataMatch: metadata.has(assetId),
      semanticScore: semanticScores.get(assetId) ?? null, colorMatch: colorIds ? colorIds.has(assetId) : null,
      finalScore: metadata.has(assetId) ? 1 : semanticScores.get(assetId) ?? 0 }))
    const id = nanoid(16), createdAt = Date.now(), stored: StoredResult = { id, assetIds: ranked, query, coverage: { metadataMatches: metadata.size, localSemanticMatches: [...semanticIds].filter((id) => !metadata.has(id)).length, localSemanticIndexed: indexed, queryMs: performance.now() - started }, debug, createdAt }
    this.results.set(id, stored)
    return { id, totalCount: ranked.length, previewAssets: this.assets.getMany(ranked.slice(0, Math.min(10, previewLimit))), previewCount: Math.min(ranked.length, previewLimit), query, coverage: stored.coverage, createdAt }
  }
  page(id: string, cursor = '0', limit = 120): AssetPage {
    const result = this.results.get(id); if (!result) return { items: [], total: 0, nextCursor: null, resultSetId: id }
    const offset = Number.parseInt(cursor, 10) || 0, size = Math.min(500, Math.max(1, limit)), ids = result.assetIds.slice(offset, offset + size)
    return { items: this.assets.getMany(ids), total: result.assetIds.length, nextCursor: offset + ids.length < result.assetIds.length ? String(offset + ids.length) : null, resultSetId: id }
  }
  async list(query: AssetQuery): Promise<AssetPage> { if (query.searchResultSetId) return this.page(query.searchResultSetId, query.cursor, query.limit); const result = await this.create(query, Math.min(query.limit ?? 120, 10)); return this.page(result.id, query.cursor, query.limit) }
  debug(id: string): readonly SearchDebugEntry[] { return this.results.get(id)?.debug ?? [] }

  private async evaluate(expression: NaturalSearchExpression, base: AssetQuery): Promise<{ ids: Set<string>; semantic: Set<string>; scores: Map<string, number>; indexed: number }> {
    if ('field' in expression) {
      const exact = new Set(this.assets.listIdsWithPredicate(base, this.builder.build(expression))), semantic = new Set<string>(), scores = new Map<string, number>()
      let indexed = 0
      if (['object', 'scene', 'style', 'description', 'freeText'].includes(expression.field)) {
        const local = await this.semantic.search(String(expression.value)); indexed = local.indexed
        const field = expression.field as 'object' | 'scene' | 'style' | 'description' | 'freeText'
        const eligible = new Set(this.assets.listIdsEligibleForSemantic(base, field, conceptParts(String(expression.value))))
        local.matches.filter((item) => eligible.has(item.assetId)).forEach((item) => { semantic.add(item.assetId); scores.set(item.assetId, item.score) })
      }
      return { ids: new Set([...exact, ...semantic]), semantic, scores, indexed }
    }
    if (expression.operator === 'not') {
      const child = await this.evaluate(expression.child, base), all = new Set(this.assets.listIdsWithPredicate(base))
      return { ids: new Set([...all].filter((id) => !child.ids.has(id))), semantic: child.semantic, scores: child.scores, indexed: child.indexed }
    }
    const children = await Promise.all(expression.children.map((child) => this.evaluate(child, base))), first = children[0]?.ids ?? new Set<string>()
    const ids = expression.operator === 'and' ? new Set([...first].filter((id) => children.every((child) => child.ids.has(id)))) : new Set(children.flatMap((child) => [...child.ids]))
    const semantic = new Set(children.flatMap((child) => [...child.semantic])), scores = new Map<string, number>()
    children.forEach((child) => child.scores.forEach((score, id) => scores.set(id, Math.max(score, scores.get(id) ?? -1))))
    return { ids, semantic, scores, indexed: Math.max(0, ...children.map((child) => child.indexed)) }
  }
  private expire(): void { const cutoff = Date.now() - 60 * 60 * 1000; for (const [id, result] of this.results) if (result.createdAt < cutoff) this.results.delete(id) }

}

function conceptParts(value: string): string[] { return normalizeSearchConcept(value).split(/\s+/).filter(Boolean) }
function findCondition(expression: NaturalSearchExpression, field: 'color'): NaturalSearchExpression | null {
  if ('field' in expression) return expression.field === field ? expression : null
  if (expression.operator === 'not') return findCondition(expression.child, field)
  return expression.children.map((child) => findCondition(child, field)).find(Boolean) ?? null
}
