import type { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { nanoid } from 'nanoid'
import type { TrashPurgeResult } from '@shared/types/domain'
import type { LibraryDirectories } from '../filesystem/LibraryPaths'
import { MuseError } from '../../errors'
import { runTransaction } from '../../database/transaction'
import { logger, serializeError } from '../../logger'

interface TrashFileRow {
  id: string
  original_path: string
  original_bytes: number
  asset_thumbnail_path: string | null
  thumbnail_path: string | null
  thumbnail_bytes: number | null
}

interface ManagedFile {
  path: string
  bytes: number
}

interface MovedFile extends ManagedFile {
  quarantinePath: string
}

export class TrashService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly library: LibraryDirectories
  ) {}

  async empty(): Promise<TrashPurgeResult> {
    const rows = this.db.prepare(`
      SELECT a.id,a.path AS original_path,a.size AS original_bytes,a.thumbnail_path AS asset_thumbnail_path,
        t.path AS thumbnail_path,t.bytes AS thumbnail_bytes
      FROM assets a
      LEFT JOIN thumbnails t ON t.asset_id=a.id
      WHERE a.deleted_at IS NOT NULL
      ORDER BY a.id,t.size_key
    `).all() as unknown as TrashFileRow[]
    const assetIds = [...new Set(rows.map((row) => row.id))]
    if (!assetIds.length) return { deletedCount: 0, reclaimedBytes: 0, fileCleanupPending: false }

    const files = this.collectManagedFiles(rows)
    const quarantineRoot = join(this.library.cache, 'trash-purge', nanoid(12))
    const moved: MovedFile[] = []
    await mkdir(quarantineRoot, { recursive: true })

    try {
      for (const [index, file] of files.entries()) {
        if (!existsSync(file.path)) continue
        const quarantinePath = join(quarantineRoot, `${index}-${basename(file.path)}`)
        await rename(file.path, quarantinePath)
        moved.push({ ...file, quarantinePath })
      }

      const deletedCount = runTransaction(this.db, () => {
        this.db.prepare('DELETE FROM assets_fts WHERE asset_id IN (SELECT id FROM assets WHERE deleted_at IS NOT NULL)').run()
        return Number(this.db.prepare('DELETE FROM assets WHERE deleted_at IS NOT NULL').run().changes)
      })

      let fileCleanupPending = false
      try { await rm(quarantineRoot, { recursive: true, force: true }) }
      catch (error) {
        fileCleanupPending = true
        logger.warn('Trash quarantine cleanup deferred', { quarantineRoot, error: serializeError(error) })
      }
      return {
        deletedCount,
        reclaimedBytes: fileCleanupPending ? 0 : moved.reduce((sum, file) => sum + file.bytes, 0),
        fileCleanupPending
      }
    } catch (error) {
      await this.restoreMovedFiles(moved)
      await rm(quarantineRoot, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  private collectManagedFiles(rows: TrashFileRow[]): ManagedFile[] {
    const files = new Map<string, ManagedFile>()
    for (const row of rows) {
      this.assertManagedPath(row.original_path, this.library.originals)
      files.set(resolve(row.original_path), { path: resolve(row.original_path), bytes: row.original_bytes })
      if (row.asset_thumbnail_path && resolve(row.asset_thumbnail_path) !== resolve(row.original_path)) {
        this.assertManagedPath(row.asset_thumbnail_path, this.library.thumbnails)
        files.set(resolve(row.asset_thumbnail_path), { path: resolve(row.asset_thumbnail_path), bytes: row.thumbnail_bytes ?? 0 })
      }
      if (row.thumbnail_path) {
        this.assertManagedPath(row.thumbnail_path, this.library.thumbnails)
        files.set(resolve(row.thumbnail_path), { path: resolve(row.thumbnail_path), bytes: row.thumbnail_bytes ?? 0 })
      }
    }
    return [...files.values()]
  }

  private assertManagedPath(candidate: string, root: string): void {
    const parent = resolve(root), target = resolve(candidate), child = relative(parent, target)
    if (child !== '' && !child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child)) return
    throw new MuseError('TRASH_PATH_UNSAFE', '回收站中包含不受 Muse 管理的文件路径，已停止清理。')
  }

  private async restoreMovedFiles(files: MovedFile[]): Promise<void> {
    for (const file of [...files].reverse()) {
      try { if (existsSync(file.quarantinePath)) await rename(file.quarantinePath, file.path) }
      catch (error) { logger.error('Failed to restore quarantined trash file', { path: file.path, error: serializeError(error) }) }
    }
  }
}
