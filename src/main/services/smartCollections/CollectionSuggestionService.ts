import type { CollectionSuggestion, CollectionSuggestionResult, IgnoredCollectionSuggestion, SmartCollection } from '@shared/types/domain'
import type { CollectionSuggestionRepository, SuggestionAggregateRow } from '../../database/repositories/CollectionSuggestionRepository'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { SmartCollectionService } from './SmartCollectionService'
import { SmartCollectionQueryBuilder } from './SmartCollectionQueryBuilder'
import { buildSuggestionName } from './SuggestionNameBuilder'
import { canonicalRuleSignature, conditionsToInput, suggestionCondition } from './CollectionSuggestionRules'

interface Candidate extends Omit<CollectionSuggestion, 'previews'> { input: ReturnType<typeof conditionsToInput> }
interface Thresholds { single: number; pair: number }

export class CollectionSuggestionService {
  private readonly builder = new SmartCollectionQueryBuilder()
  private revision = 0
  private cachedRevision = -1
  private cache: CollectionSuggestionResult | null = null

  constructor(
    private readonly repository: CollectionSuggestionRepository,
    private readonly assets: AssetRepository,
    private readonly collections: SmartCollectionService,
    private readonly limit = 8
  ) {}

  invalidate(): void { this.revision += 1 }

  list(): CollectionSuggestionResult {
    if (this.cache && this.cachedRevision === this.revision) return this.cache
    const total = this.repository.librarySize()
    const generatedAt = new Date().toISOString()
    if (!total) return this.remember({ items: [], unAnalyzedCount: 0, generatedAt })
    const thresholds = thresholdsFor(total)
    const aggregates = [
      ...this.repository.single('object'), ...this.repository.single('scene'), ...this.repository.single('style'),
      ...this.repository.pair('object', 'scene'), ...this.repository.pair('object', 'style'), ...this.repository.pair('scene', 'style'),
      ...this.repository.colorPairs('object'), ...this.repository.colorPairs('style')
    ]
    const singleSupport = new Map(aggregates.filter((item) => item.dimensions.length === 1).map((item) => [`${item.dimensions[0]!.dimension}:${item.dimensions[0]!.normalizedValue}`, item.assetCount]))
    const existing = new Set(this.collections.list().map((collection) => canonicalRuleSignature(collection)))
    const ignored = this.repository.activeIgnoredSignatures()
    const deduplicated = new Map<string, Candidate>()
    for (const aggregate of aggregates) {
      const candidate = this.toCandidate(aggregate, total, thresholds, singleSupport)
      if (!candidate || existing.has(candidate.ruleSignature) || ignored.has(candidate.ruleSignature)) continue
      const previous = deduplicated.get(candidate.ruleSignature)
      if (!previous || candidate.score > previous.score) deduplicated.set(candidate.ruleSignature, candidate)
    }
    const ranked = [...deduplicated.values()].sort((left, right) => right.score - left.score || right.assetCount - left.assetCount || left.name.localeCompare(right.name, 'zh-CN'))
    // Keep a few broad anchors (Object / Scene / Style) visible. Pair candidates
    // may legitimately overlap their parent group and still provide a useful,
    // more specific saved query. The 0.9 suppression is applied among peers.
    const selected: Candidate[] = ranked.filter((item) => item.kind === 'single').slice(0, 3)
    const bestObjectColor = ranked.find((item) => item.conditions.some((condition) => condition.dimension === 'color') && item.conditions.some((condition) => condition.dimension === 'object'))
    const bestStyleColor = ranked.find((item) => item.conditions.some((condition) => condition.dimension === 'color') && item.conditions.some((condition) => condition.dimension === 'style'))
    if (bestObjectColor) selected.push(bestObjectColor)
    if (bestStyleColor && bestStyleColor.ruleSignature !== bestObjectColor?.ruleSignature) selected.push(bestStyleColor)
    for (const candidate of ranked) {
      if (selected.some((other) => other.ruleSignature === candidate.ruleSignature)) continue
      if (selected.some((other) => other.kind === candidate.kind && overlapEstimate(candidate, other) > 0.90)) continue
      selected.push(candidate)
      if (selected.length >= this.limit) break
    }
    selected.sort((left, right) => right.score - left.score || right.assetCount - left.assetCount || left.name.localeCompare(right.name, 'zh-CN'))
    const items = selected.slice(0, this.limit).map(({ input: _input, ...candidate }) => ({
      ...candidate,
      previews: this.assets.listWithPredicate({ limit: 6 }, this.builder.build(candidateToInput(candidate))).items
    }))
    return this.remember({ items, unAnalyzedCount: this.repository.unAnalyzedCount(), generatedAt })
  }

  create(signature: string): SmartCollection {
    const suggestion = this.list().items.find((item) => item.ruleSignature === signature)
    if (!suggestion) throw new Error('Collection suggestion is no longer available')
    const collection = this.collections.create(candidateToInput(suggestion))
    this.invalidate()
    return collection
  }

  ignore(signature: string): void { this.repository.ignore(signature); this.invalidate() }
  listIgnored(): IgnoredCollectionSuggestion[] { return this.repository.listIgnored() }
  restore(signature: string): void { this.repository.restore(signature); this.invalidate() }

  private toCandidate(aggregate: SuggestionAggregateRow, total: number, thresholds: Thresholds, singleSupport: Map<string, number>): Candidate | null {
    if (aggregate.dimensions.some((item) => !item.normalizedValue || item.normalizedValue === 'other' || item.normalizedValue.endsWith('.other'))) return null
    const kind = aggregate.dimensions.length === 1 ? 'single' : 'pair'
    if (aggregate.assetCount < thresholds[kind]) return null
    const conditions = aggregate.dimensions.map((item) => suggestionCondition(item.dimension, item.label, item.normalizedValue))
    const name = buildSuggestionName(conditions)
    const input = conditionsToInput(name, conditions)
    const predicate = this.builder.build(input)
    const exactCount = aggregate.dimensions.some((item) => item.dimension === 'color') ? this.assets.countWithPredicate(predicate) : aggregate.assetCount
    if (exactCount < thresholds[kind]) return null
    const colorDimension = aggregate.dimensions.find((item) => item.dimension === 'color')
    const colorParent = aggregate.dimensions.find((item) => item.dimension !== 'color')
    if (colorDimension && colorParent) {
      const parentCount = singleSupport.get(`${colorParent.dimension}:${colorParent.normalizedValue}`) ?? exactCount
      // A color condition that retains nearly the entire parent group adds no
      // organizational value (for example, white backgrounds on every product
      // image). Do not spend a Top-8 slot on that noise.
      if (['white', 'gray', 'black', 'warm-neutral', 'cool-neutral'].includes(colorDimension.normalizedValue) && exactCount / Math.max(1, parentCount) > 0.85) return null
    }
    const supportRatio = exactCount / total
    const colorPenalty = conditions.some((item) => item.dimension === 'color') ? 7 : 0
    const genericPenalty = conditions.length === 1 && ['white_background', 'indoor', 'product_photography', 'lifestyle_photography'].includes(conditions[0]?.normalizedValue ?? '') ? 4 : 0
    const specificity = kind === 'pair' ? 14 : 5
    const score = round(Math.log2(exactCount + 1) * 18 + supportRatio * 42 + specificity - colorPenalty - genericPenalty)
    return { ruleSignature: canonicalRuleSignature(input), name, kind, conditions, rules: input.rules, assetCount: exactCount, supportRatio, score, input }
  }

  private remember(result: CollectionSuggestionResult): CollectionSuggestionResult {
    this.cache = result; this.cachedRevision = this.revision; return result
  }
}

function thresholdsFor(total: number): Thresholds {
  if (total <= 50) return { single: Math.max(3, Math.ceil(total * 0.12)), pair: Math.max(3, Math.ceil(total * 0.10)) }
  if (total <= 1_000) return { single: Math.max(5, Math.ceil(total * 0.025)), pair: Math.max(4, Math.ceil(total * 0.015)) }
  return { single: Math.max(12, Math.ceil(total * 0.005)), pair: Math.max(8, Math.ceil(total * 0.003)) }
}

function candidateToInput(candidate: Pick<CollectionSuggestion, 'name' | 'conditions'>) { return conditionsToInput(candidate.name, candidate.conditions) }
function overlapEstimate(left: Candidate, right: Candidate): number {
  const leftKeys = new Set(left.conditions.map((item) => `${item.field}:${item.normalizedValue}`))
  const shared = right.conditions.filter((item) => leftKeys.has(`${item.field}:${item.normalizedValue}`)).length
  if (!shared) return 0
  const semanticOverlap = shared / Math.max(left.conditions.length, right.conditions.length)
  const supportOverlap = Math.min(left.assetCount, right.assetCount) / Math.max(left.assetCount, right.assetCount)
  return semanticOverlap * supportOverlap
}
function round(value: number): number { return Math.round(value * 100) / 100 }
