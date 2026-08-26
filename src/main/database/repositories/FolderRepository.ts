import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { Folder } from '@shared/types/domain'

interface FolderRow { id: string; name: string; parent_id: string | null; created_at: string; asset_count: number }

export class FolderRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Folder[] {
    const rows = this.db.prepare(`
      SELECT f.id, f.name, f.parent_id, f.created_at,
        COUNT(CASE WHEN a.deleted_at IS NULL THEN 1 END) AS asset_count
      FROM folders f
      LEFT JOIN asset_folders af ON af.folder_id = f.id
      LEFT JOIN assets a ON a.id = af.asset_id
      GROUP BY f.id
      ORDER BY f.position, f.created_at
    `).all() as unknown as FolderRow[]
    return rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at, assetCount: row.asset_count }))
  }

  create(name: string, parentId: string | null = null): Folder {
    const id = nanoid(12)
    const now = new Date().toISOString()
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM folders WHERE parent_id IS ?').get(parentId) as unknown as { next: number }).next
    this.db.prepare('INSERT INTO folders (id, name, parent_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, parentId, position, now, now)
    return { id, name, parentId, createdAt: now, assetCount: 0 }
  }

  rename(id: string, name: string): Folder {
    this.db.prepare("UPDATE folders SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(name, id)
    const folder = this.list().find((item) => item.id === id)
    if (!folder) throw new Error('Folder not found')
    return folder
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  }
}
