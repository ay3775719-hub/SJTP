import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { NaturalSearchHistoryItem, NaturalSearchIntent } from '@shared/types/domain'
import { naturalSearchIntentSchema } from '@shared/schemas/naturalSearch'

interface CacheRow { intent_json: string; model: string | null }
interface HistoryRow { id: string; query_text: string; intent_json: string | null; last_used_at: string; use_count: number }

export class NaturalSearchRepository {
  constructor(private readonly db: DatabaseSync) {}

  static queryKey(queryText: string, parserVersion: string): string {
    return createHash('sha256').update(`${parserVersion}\0${queryText.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')}`).digest('hex')
  }

  getCached(queryText: string, parserVersion: string): { intent: NaturalSearchIntent; model: string | null } | null {
    const row = this.db.prepare('SELECT intent_json,model FROM natural_search_parse_cache WHERE query_key=? AND parser_version=?')
      .get(NaturalSearchRepository.queryKey(queryText, parserVersion), parserVersion) as unknown as CacheRow | undefined
    if (!row) return null
    try { return { intent: naturalSearchIntentSchema.parse(JSON.parse(row.intent_json)) as NaturalSearchIntent, model: row.model } }
    catch { return null }
  }

  saveCache(queryText: string, parserVersion: string, intent: NaturalSearchIntent, model: string | null): void {
    const now = new Date().toISOString(), key = NaturalSearchRepository.queryKey(queryText, parserVersion)
    this.db.prepare(`INSERT INTO natural_search_parse_cache(query_key,query_text,parser_version,intent_json,model,parsed_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(query_key) DO UPDATE SET intent_json=excluded.intent_json,model=excluded.model,parsed_at=excluded.parsed_at`)
      .run(key, queryText, parserVersion, JSON.stringify(intent), model, now)
  }

  addHistory(queryText: string, intent: NaturalSearchIntent | null): void {
    const now = new Date().toISOString(), key = createHash('sha256').update(queryText.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')).digest('hex')
    this.db.prepare(`INSERT INTO natural_search_history(id,query_key,query_text,intent_json,created_at,last_used_at,use_count) VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(query_key) DO UPDATE SET query_text=excluded.query_text,intent_json=excluded.intent_json,last_used_at=excluded.last_used_at,use_count=natural_search_history.use_count+1`)
      .run(nanoid(12), key, queryText, intent ? JSON.stringify(intent) : null, now, now)
  }

  history(limit = 10): NaturalSearchHistoryItem[] {
    const rows = this.db.prepare('SELECT id,query_text,intent_json,last_used_at,use_count FROM natural_search_history ORDER BY last_used_at DESC LIMIT ?').all(limit) as unknown as HistoryRow[]
    return rows.map((row) => {
      let intent: NaturalSearchIntent | null = null
      try { intent = row.intent_json ? naturalSearchIntentSchema.parse(JSON.parse(row.intent_json)) as NaturalSearchIntent : null } catch { intent = null }
      return { id: row.id, queryText: row.query_text, intent, lastUsedAt: row.last_used_at, useCount: row.use_count }
    })
  }
}
