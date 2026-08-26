import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { SmartCollection, SmartCollectionInput, SmartCollectionRule } from '@shared/types/domain'
import { smartCollectionInputSchema, smartCollectionRuleSchema } from '@shared/schemas/smartCollections'
import { runTransaction } from '../transaction'

interface CollectionRow { id: string; name: string; match_mode: 'all' | 'any'; created_at: string; updated_at: string }
interface RuleRow { id: string; smart_collection_id: string; field: SmartCollectionRule['field']; operator: string; value_json: string }

export class SmartCollectionRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Array<Omit<SmartCollection, 'assetCount' | 'invalidRuleIds'>> {
    const collections = this.db.prepare('SELECT id, name, match_mode, created_at, updated_at FROM smart_collections ORDER BY sort_order, created_at').all() as unknown as CollectionRow[]
    const rules = this.db.prepare('SELECT id, smart_collection_id, field, operator, value_json FROM smart_collection_rules ORDER BY smart_collection_id, sort_order').all() as unknown as RuleRow[]
    return collections.map((collection) => ({ id: collection.id, name: collection.name, matchMode: collection.match_mode, rules: rules.filter((rule) => rule.smart_collection_id === collection.id).map(parseRule), createdAt: collection.created_at, updatedAt: collection.updated_at }))
  }

  get(id: string): Omit<SmartCollection, 'assetCount' | 'invalidRuleIds'> | null { return this.list().find((collection) => collection.id === id) ?? null }

  create(input: SmartCollectionInput): string {
    const validated = smartCollectionInputSchema.parse(input)
    const id = nanoid(14), now = new Date().toISOString()
    const order = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM smart_collections').get() as unknown as { next: number }).next
    runTransaction(this.db, () => {
      this.db.prepare('INSERT INTO smart_collections (id, name, match_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, validated.name, validated.matchMode, order, now, now)
      this.replaceRules(id, validated.rules, now)
    })
    return id
  }

  update(id: string, input: SmartCollectionInput): void {
    const validated = smartCollectionInputSchema.parse(input), now = new Date().toISOString()
    runTransaction(this.db, () => {
      const result = this.db.prepare('UPDATE smart_collections SET name = ?, match_mode = ?, updated_at = ? WHERE id = ?').run(validated.name, validated.matchMode, now, id)
      if (!result.changes) throw new Error('Smart Collection not found')
      this.db.prepare('DELETE FROM smart_collection_rules WHERE smart_collection_id = ?').run(id)
      this.replaceRules(id, validated.rules, now)
    })
  }

  remove(id: string): void { this.db.prepare('DELETE FROM smart_collections WHERE id = ?').run(id) }

  duplicate(id: string): string {
    const source = this.get(id)
    if (!source) throw new Error('Smart Collection not found')
    return this.create({ name: `${source.name} 副本`, matchMode: source.matchMode, rules: source.rules.map((rule) => ({ ...rule, id: nanoid(10) })) })
  }

  relationExists(rule: SmartCollectionRule): boolean {
    if (rule.field === 'folder') return Boolean(this.db.prepare('SELECT 1 FROM folders WHERE id = ?').get(rule.value))
    if (rule.field === 'tag') return Boolean(this.db.prepare('SELECT 1 FROM tags WHERE id = ?').get(rule.value))
    return true
  }

  private replaceRules(collectionId: string, rules: SmartCollectionRule[], now: string): void {
    const statement = this.db.prepare('INSERT INTO smart_collection_rules (id, smart_collection_id, field, operator, value_json, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    rules.forEach((rule, index) => statement.run(rule.id, collectionId, rule.field, rule.operator, JSON.stringify(rule.value), index, now))
  }
}

function parseRule(row: RuleRow): SmartCollectionRule {
  return smartCollectionRuleSchema.parse({ id: row.id, field: row.field, operator: row.operator, value: JSON.parse(row.value_json) }) as SmartCollectionRule
}
