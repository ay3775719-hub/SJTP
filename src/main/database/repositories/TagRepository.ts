import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { Tag } from '@shared/types/domain'
import { runTransaction } from '../transaction'

interface TagRow { id: string; name: string; type: Tag['type']; asset_count: number }

export class TagRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Tag[] {
    const rows = this.db.prepare(`
      SELECT t.id, t.name, t.type, COUNT(CASE WHEN a.deleted_at IS NULL THEN 1 END) AS asset_count
      FROM tags t
      LEFT JOIN asset_tags at ON at.tag_id = t.id
      LEFT JOIN assets a ON a.id = at.asset_id
      GROUP BY t.id ORDER BY asset_count DESC, t.name COLLATE NOCASE
    `).all() as unknown as TagRow[]
    return rows.map((row) => ({ id: row.id, name: row.name, type: row.type, assetCount: row.asset_count }))
  }

  create(name: string): Tag {
    const existing = this.db.prepare('SELECT id, name, type FROM tags WHERE name = ? COLLATE NOCASE').get(name) as unknown as Tag | undefined
    if (existing) return existing
    const tag: Tag = { id: nanoid(12), name, type: 'manual', assetCount: 0 }
    this.db.prepare('INSERT INTO tags (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(tag.id, tag.name, tag.type, new Date().toISOString())
    return tag
  }

  attach(assetIds: string[], tagId: string): void {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, confidence, source, created_at) VALUES (?, ?, NULL, 'manual', ?)
    `)
    const now = new Date().toISOString()
    runTransaction(this.db, () => assetIds.forEach((assetId) => statement.run(assetId, tagId, now)))
  }

  detach(assetIds: string[], tagId: string): void {
    const statement = this.db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?')
    runTransaction(this.db, () => assetIds.forEach((assetId) => statement.run(assetId, tagId)))
  }
}
