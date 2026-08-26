import type { AssetPage, AssetQuery, SmartCollection, SmartCollectionInput } from '@shared/types/domain'
import { smartCollectionInputSchema } from '@shared/schemas/smartCollections'
import type { SmartCollectionRepository } from '../../database/repositories/SmartCollectionRepository'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import { SmartCollectionQueryBuilder } from './SmartCollectionQueryBuilder'
import { canonicalRuleSignature } from './CollectionSuggestionRules'

export class SmartCollectionService {
  private readonly builder = new SmartCollectionQueryBuilder()
  constructor(private readonly collections: SmartCollectionRepository, private readonly assets: AssetRepository) {}

  list(): SmartCollection[] {
    return this.collections.list().map((collection) => {
      const invalidRuleIds = collection.rules.length ? collection.rules.filter((rule) => !this.collections.relationExists(rule)).map((rule) => rule.id) : ['missing-rules']
      return { ...collection, invalidRuleIds, assetCount: invalidRuleIds.length ? 0 : this.assets.countWithPredicate(this.builder.build(collection)) }
    })
  }
  create(input: SmartCollectionInput): SmartCollection { const id = this.collections.create(smartCollectionInputSchema.parse(input)); return this.require(id) }
  findEquivalent(input: Pick<SmartCollectionInput, 'matchMode' | 'rules'>): SmartCollection | null {
    const signature = canonicalRuleSignature(input)
    return this.list().find((collection) => canonicalRuleSignature(collection) === signature) ?? null
  }
  update(id: string, input: SmartCollectionInput): SmartCollection { this.collections.update(id, smartCollectionInputSchema.parse(input)); return this.require(id) }
  remove(id: string): void { this.collections.remove(id) }
  duplicate(id: string): SmartCollection { return this.require(this.collections.duplicate(id)) }
  preview(input: SmartCollectionInput): AssetPage { const validated = smartCollectionInputSchema.parse({ ...input, name: input.name.trim() || '预览' }); return this.assets.listWithPredicate({ limit: 6 }, this.builder.build(validated)) }
  listAssets(id: string, query: AssetQuery): AssetPage {
    const collection = this.collections.get(id)
    if (!collection) return { items: [], total: 0, nextCursor: null }
    if (collection.rules.some((rule) => !this.collections.relationExists(rule))) return { items: [], total: 0, nextCursor: null }
    return this.assets.listWithPredicate(query, this.builder.build(collection))
  }
  private require(id: string): SmartCollection { const result = this.list().find((collection) => collection.id === id); if (!result) throw new Error('Smart Collection not found'); return result }
}
