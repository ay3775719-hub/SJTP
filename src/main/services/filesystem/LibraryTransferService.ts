import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { backup, DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { LibraryBackupResult, LibraryMergeResult, LibraryTransferStatus } from '@shared/types/domain'
import type { LibraryDirectories } from './LibraryPaths'

const MANIFEST_NAME = 'muse-library.json'
const BACKUP_FORMAT_VERSION = 1
const MAX_LIBRARY_SEARCH_DEPTH = 6
const MAX_LIBRARY_SEARCH_DIRECTORIES = 2000

interface LibraryManifest {
  formatVersion: number
  createdAt: string
  appVersion: string
  assetCount: number
  folderCount: number
  tagCount: number
  smartCollectionCount: number
}

interface PathRow { id: string; path: string; extension: string; thumbnail_path: string | null }
interface ThumbnailPathRow { asset_id: string; size_key: string; path: string }
type SqlRow = Record<string, SQLInputValue>

interface MergeAssetPlan {
  source: SqlRow
  targetId: string
  targetPath: string
  thumbnailPath: string | null
  thumbnails: Array<{ row: SqlRow; targetPath: string }>
}

export class LibraryTransferService {
  private state: LibraryTransferStatus = { state: 'idle' }

  constructor(
    private readonly db: DatabaseSync,
    private readonly library: LibraryDirectories,
    private readonly appVersion: string
  ) {}

  status(): LibraryTransferStatus { return this.state }

  async backupTo(parentDirectory: string): Promise<LibraryBackupResult> {
    if (this.state.state === 'backing_up' || this.state.state === 'merging') throw new Error('Library 正在处理，请等待当前任务完成')
    const parent = resolve(parentDirectory)
    if (isWithin(this.library.root, parent)) throw new Error('备份位置不能放在当前 Library 内部')
    await mkdir(parent, { recursive: true })
    const destination = await uniqueBackupDirectory(parent)
    this.state = { state: 'backing_up', destinationPath: destination }

    try {
      await mkdir(destination, { recursive: false })
      const targetOriginals = join(destination, 'originals')
      const targetThumbnails = join(destination, 'thumbnails')
      await Promise.all([
        mkdir(join(destination, 'cache'), { recursive: true }),
        mkdir(join(destination, 'backups'), { recursive: true })
      ])

      // node:sqlite backup produces a transactionally consistent snapshot even
      // while the live Library is using WAL mode.
      const targetDatabase = join(destination, 'muse.db')
      await backup(this.db, targetDatabase)
      await Promise.all([
        cp(this.library.originals, targetOriginals, { recursive: true, force: false, errorOnExist: true }),
        cp(this.library.thumbnails, targetThumbnails, { recursive: true, force: false, errorOnExist: true })
      ])

      const snapshot = new DatabaseSync(targetDatabase)
      try { relocateManagedPaths(snapshot, destination) } finally { snapshot.close() }

      const manifest = this.createManifest()
      await writeFile(join(destination, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8')
      const bytes = await directoryBytes(destination)
      const result: LibraryBackupResult = {
        path: destination,
        createdAt: manifest.createdAt,
        assetCount: manifest.assetCount,
        folderCount: manifest.folderCount,
        bytes
      }
      this.state = { state: 'completed', destinationPath: destination, result }
      return result
    } catch (error) {
      this.state = { state: 'failed', destinationPath: destination, error: error instanceof Error ? error.message : String(error) }
      await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async mergeFrom(sourceRoot: string): Promise<LibraryMergeResult> {
    if (this.state.state === 'backing_up' || this.state.state === 'merging') throw new Error('Library 正在处理，请等待当前任务完成')
    const sourcePath = resolve(sourceRoot)
    if (sourcePath === resolve(this.library.root)) throw new Error('不能把当前 Library 合并到自身')
    const validation = validateExistingLibrary(sourcePath)
    if (!validation.valid) throw new Error(validation.message)
    this.state = { state: 'merging', sourcePath }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safetyBackupPath = join(this.library.backups, `before-merge-${stamp}.db`)
    const copiedFiles: string[] = []
    let sourceDb: DatabaseSync | null = null
    try {
      await backup(this.db, safetyBackupPath)
      sourceDb = new DatabaseSync(validation.databasePath, { readOnly: true })
      sourceDb.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      requireMergeTables(sourceDb)

      const targetIds = new Set((this.db.prepare('SELECT id FROM assets').all() as unknown as Array<{ id: string }>).map((row) => row.id))
      const targetByHash = new Map<string, string>()
      for (const row of this.db.prepare('SELECT id,hash FROM assets ORDER BY deleted_at IS NULL DESC, imported_at').all() as unknown as Array<{ id: string; hash: string }>) {
        if (!targetByHash.has(row.hash)) targetByHash.set(row.hash, row.id)
      }
      const sourceAssets = sourceDb.prepare('SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY imported_at,id').all() as unknown as SqlRow[]
      const sourceThumbnails = tableExists(sourceDb, 'thumbnails')
        ? sourceDb.prepare('SELECT * FROM thumbnails').all() as unknown as SqlRow[] : []
      const thumbnailsByAsset = new Map<string, SqlRow[]>()
      for (const row of sourceThumbnails) {
        const id = String(row.asset_id)
        thumbnailsByAsset.set(id, [...(thumbnailsByAsset.get(id) ?? []), row])
      }

      const assetMap = new Map<string, string>()
      const newPlans: MergeAssetPlan[] = []
      let duplicateAssetCount = 0
      let failureCount = 0
      for (const source of sourceAssets) {
        const sourceId = String(source.id), hash = String(source.hash)
        const existing = targetByHash.get(hash)
        if (existing) {
          assetMap.set(sourceId, existing)
          duplicateAssetCount += 1
          continue
        }
        const targetId = targetIds.has(sourceId) ? nanoid(16) : sourceId
        targetIds.add(targetId)
        const extension = String(source.extension || extname(String(source.path)).slice(1) || 'jpg').toLowerCase()
        const sourceOriginal = managedSourceFile(sourcePath, 'originals', String(source.path), `${sourceId}.${extension}`)
        if (!sourceOriginal) { failureCount += 1; continue }
        const targetPath = join(this.library.originals, `${targetId}.${extension}`)
        const thumbnails: MergeAssetPlan['thumbnails'] = []
        for (const row of thumbnailsByAsset.get(sourceId) ?? []) {
          const sizeKey = String(row.size_key)
          const stored = String(row.path)
          const sourceThumbnail = managedSourceFile(sourcePath, 'thumbnails', stored, join(sourceId.slice(0, 2), basename(stored)))
          if (!sourceThumbnail) continue
          const suffix = extname(stored) || '.webp'
          thumbnails.push({ row, targetPath: join(this.library.thumbnails, targetId.slice(0, 2), `${targetId}-${sizeKey}${suffix}`) })
        }
        const medium = thumbnails.find((item) => item.row.size_key === 'medium')?.targetPath ?? thumbnails[0]?.targetPath ?? null
        newPlans.push({ source, targetId, targetPath, thumbnailPath: medium, thumbnails })
        assetMap.set(sourceId, targetId)
        targetByHash.set(hash, targetId)
      }

      for (const plan of newPlans) {
        const sourceOriginal = managedSourceFile(sourcePath, 'originals', String(plan.source.path), `${String(plan.source.id)}.${String(plan.source.extension)}`)!
        await mkdir(join(this.library.thumbnails, plan.targetId.slice(0, 2)), { recursive: true })
        await copyFile(sourceOriginal, plan.targetPath, constants.COPYFILE_EXCL)
        copiedFiles.push(plan.targetPath)
        for (const thumbnail of plan.thumbnails) {
          const stored = String(thumbnail.row.path)
          const sourceThumbnail = managedSourceFile(sourcePath, 'thumbnails', stored, join(String(plan.source.id).slice(0, 2), basename(stored)))!
          await copyFile(sourceThumbnail, thumbnail.targetPath, constants.COPYFILE_EXCL)
          copiedFiles.push(thumbnail.targetPath)
        }
      }

      let addedFolderCount = 0, addedTagCount = 0, updatedAssetCount = 0
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const plan of newPlans) {
          insertRow(this.db, 'assets', plan.source, { id: plan.targetId, path: plan.targetPath, thumbnail_path: plan.thumbnailPath }, 'ABORT')
          for (const thumbnail of plan.thumbnails) insertRow(this.db, 'thumbnails', thumbnail.row, { asset_id: plan.targetId, path: thumbnail.targetPath }, 'IGNORE')
        }

        const folderResult = mergeFolders(sourceDb, this.db)
        addedFolderCount = folderResult.added
        const tagResult = mergeTags(sourceDb, this.db)
        addedTagCount = tagResult.added

        const newlyAdded = new Set(newPlans.map((plan) => plan.targetId))
        for (const source of sourceAssets) {
          const sourceId = String(source.id), targetId = assetMap.get(sourceId)
          if (!targetId) continue
          if (!newlyAdded.has(targetId)) {
            const changed = this.db.prepare(`UPDATE assets SET favorite=MAX(favorite,?),rating=MAX(rating,?),deleted_at=NULL,
              last_opened_at=CASE WHEN ? IS NOT NULL AND (last_opened_at IS NULL OR ?>last_opened_at) THEN ? ELSE last_opened_at END,
              source_url=COALESCE(source_url,?),source_domain=COALESCE(source_domain,?),source_title=COALESCE(source_title,?),
              source_author=COALESCE(source_author,?),source_saved_at=COALESCE(source_saved_at,?) WHERE id=?`)
              .run(source.favorite ?? 0, source.rating ?? 0, source.last_opened_at ?? null, source.last_opened_at ?? null,
                source.last_opened_at ?? null, source.source_url ?? null, source.source_domain ?? null,
                source.source_title ?? null, source.source_author ?? null, source.source_saved_at ?? null, targetId)
            if (changed.changes) updatedAssetCount += 1
          }
          mergeAssetRelations(sourceDb, this.db, sourceId, targetId, folderResult.map, tagResult.map)
        }
        mergeSmartCollections(sourceDb, this.db, folderResult.map, tagResult.map)
        rebuildFts(this.db, [...new Set(assetMap.values())])
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }

      const result: LibraryMergeResult = {
        sourcePath, safetyBackupPath, addedAssetCount: newPlans.length, duplicateAssetCount,
        updatedAssetCount, addedFolderCount, addedTagCount, failureCount
      }
      this.state = { state: 'merge_completed', sourcePath, result }
      return result
    } catch (error) {
      await Promise.allSettled(copiedFiles.map((path) => unlink(path)))
      this.state = { state: 'failed', destinationPath: sourcePath, error: error instanceof Error ? error.message : String(error) }
      throw error
    } finally { sourceDb?.close() }
  }

  private createManifest(): LibraryManifest {
    return {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: this.appVersion,
      assetCount: count(this.db, 'assets'),
      folderCount: count(this.db, 'folders'),
      tagCount: count(this.db, 'tags'),
      smartCollectionCount: count(this.db, 'smart_collections')
    }
  }
}

export function validateExistingLibrary(root: string): { valid: true; databasePath: string } | { valid: false; message: string } {
  const normalized = resolve(root)
  const databasePath = existsSync(join(normalized, 'muse.sqlite3')) ? join(normalized, 'muse.sqlite3') : join(normalized, 'muse.db')
  if (!existsSync(databasePath)) return { valid: false, message: '所选文件夹不是 Muse Library：缺少 muse.db' }
  if (!existsSync(join(normalized, 'originals'))) return { valid: false, message: '所选 Library 缺少 originals 原图文件夹' }
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('assets','folders','asset_folders')").all()
    if (tables.length !== 3) return { valid: false, message: 'Muse Library 数据库结构不完整' }
    db.prepare('SELECT COUNT(*) FROM assets').get()
    return { valid: true, databasePath }
  } catch {
    return { valid: false, message: 'Muse Library 数据库无法读取或已经损坏' }
  } finally { db?.close() }
}

/** Accept a Library itself or a folder containing one, including nested backup folders. */
export async function findExistingLibraries(selectedFolder: string): Promise<{ paths: string[]; truncated: boolean }> {
  const queue = [{ path: resolve(selectedFolder), depth: 0 }]
  const paths: string[] = []
  let truncated = false

  for (let index = 0; index < queue.length; index += 1) {
    const { path, depth } = queue[index]!
    if (validateExistingLibrary(path).valid) {
      paths.push(path)
      continue // Do not treat backups inside a complete Library as separate choices.
    }
    if (depth >= MAX_LIBRARY_SEARCH_DEPTH) continue

    let entries
    try { entries = await readdir(path, { withFileTypes: true }) }
    catch { continue }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue // Also avoids following directory symlinks and junctions.
      if (queue.length >= MAX_LIBRARY_SEARCH_DIRECTORIES) { truncated = true; break }
      queue.push({ path: join(path, entry.name), depth: depth + 1 })
    }
  }
  return { paths, truncated }
}

/** Rewrites managed absolute paths after a Library folder is moved to another drive/computer. */
export function relocateManagedPaths(db: DatabaseSync, newRoot: string): number {
  const root = resolve(newRoot)
  const originals = join(root, 'originals')
  const thumbnails = join(root, 'thumbnails')
  const assets = db.prepare('SELECT id,path,extension,thumbnail_path FROM assets').all() as unknown as PathRow[]
  const thumbnailRows = db.prepare('SELECT asset_id,size_key,path FROM thumbnails').all() as unknown as ThumbnailPathRow[]
  const updateAsset = db.prepare('UPDATE assets SET path=?, thumbnail_path=? WHERE id=?')
  const updateThumbnail = db.prepare('UPDATE thumbnails SET path=? WHERE asset_id=? AND size_key=?')
  let changed = 0

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const asset of assets) {
      const expectedOriginal = join(originals, basename(asset.path || `${asset.id}.${asset.extension}`))
      const medium = thumbnailRows.find((row) => row.asset_id === asset.id && row.size_key === 'medium')
      const fallback = asset.thumbnail_path ? basename(asset.thumbnail_path) : `${asset.id}-medium.webp`
      const expectedThumbnail = join(thumbnails, asset.id.slice(0, 2), basename(medium?.path ?? fallback))
      if (resolve(asset.path) !== expectedOriginal || !asset.thumbnail_path || resolve(asset.thumbnail_path) !== expectedThumbnail) {
        updateAsset.run(expectedOriginal, expectedThumbnail, asset.id)
        changed += 1
      }
    }
    for (const thumbnail of thumbnailRows) {
      const expected = join(thumbnails, thumbnail.asset_id.slice(0, 2), basename(thumbnail.path))
      if (resolve(thumbnail.path) !== expected) updateThumbnail.run(expected, thumbnail.asset_id, thumbnail.size_key)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return changed
}

async function uniqueBackupDirectory(parent: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').replace('Z', '')
  const base = join(parent, `Muse Library Backup ${stamp}`)
  if (!existsSync(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error('无法创建唯一的备份文件夹')
}

function count(db: DatabaseSync, table: 'assets' | 'folders' | 'tags' | 'smart_collections'): number {
  return Number((db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as unknown as { value: number }).value)
}

async function directoryBytes(root: string): Promise<number> {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(root, { withFileTypes: true }))
  let total = 0
  for (const entry of entries) {
    const path = join(root, entry.name)
    total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size
  }
  return total
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate))
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

export async function readLibraryManifest(root: string): Promise<LibraryManifest | null> {
  try { return JSON.parse(await readFile(join(root, MANIFEST_NAME), 'utf8')) as LibraryManifest } catch { return null }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

function requireMergeTables(db: DatabaseSync): void {
  const required = ['assets', 'thumbnails', 'folders', 'asset_folders', 'tags', 'asset_tags']
  const missing = required.filter((table) => !tableExists(db, table))
  if (missing.length) throw new Error(`所选 Library 版本不兼容：缺少 ${missing.join('、')}`)
}

function managedSourceFile(root: string, managedFolder: 'originals' | 'thumbnails', storedPath: string, fallback: string): string | null {
  const normalizedRoot = resolve(root)
  if (storedPath && isWithin(normalizedRoot, storedPath) && existsSync(storedPath)) return storedPath
  const candidate = join(normalizedRoot, managedFolder, fallback)
  return existsSync(candidate) ? candidate : null
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((row) => row.name)
}

function insertRow(
  db: DatabaseSync,
  table: string,
  source: SqlRow,
  overrides: SqlRow = {},
  conflict: 'IGNORE' | 'REPLACE' | 'ABORT' = 'IGNORE'
): void {
  if (!tableExists(db, table)) return
  const data: SqlRow = { ...source, ...overrides }
  const columns = tableColumns(db, table).filter((column) => Object.hasOwn(data, column))
  if (!columns.length) return
  const values = columns.map((column) => data[column] ?? null)
  db.prepare(`INSERT OR ${conflict} INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values)
}

function mergeFolders(source: DatabaseSync, target: DatabaseSync): { map: Map<string, string>; added: number } {
  const rows = source.prepare('SELECT * FROM folders ORDER BY position,created_at,id').all() as unknown as SqlRow[]
  const map = new Map<string, string>()
  const pending = [...rows]
  let added = 0
  while (pending.length) {
    let progressed = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const row = pending[index]!, sourceId = String(row.id)
      const sourceParent = row.parent_id == null ? null : String(row.parent_id)
      if (sourceParent && !map.has(sourceParent)) continue
      const parentId = sourceParent ? map.get(sourceParent)! : null
      const existing = target.prepare('SELECT id FROM folders WHERE parent_id IS ? AND name=? COLLATE NOCASE LIMIT 1')
        .get(parentId, row.name ?? '') as unknown as { id: string } | undefined
      if (existing) map.set(sourceId, existing.id)
      else {
        const collision = target.prepare('SELECT 1 FROM folders WHERE id=?').get(sourceId)
        const targetId = collision ? nanoid(12) : sourceId
        insertRow(target, 'folders', row, { id: targetId, parent_id: parentId }, 'ABORT')
        map.set(sourceId, targetId)
        added += 1
      }
      pending.splice(index, 1)
      progressed = true
    }
    if (!progressed) throw new Error('来源 Library 的文件夹层级无法解析')
  }
  return { map, added }
}

function mergeTags(source: DatabaseSync, target: DatabaseSync): { map: Map<string, string>; added: number } {
  const rows = source.prepare('SELECT * FROM tags ORDER BY created_at,id').all() as unknown as SqlRow[]
  const map = new Map<string, string>()
  let added = 0
  for (const row of rows) {
    const sourceId = String(row.id)
    const existing = target.prepare('SELECT id FROM tags WHERE name=? COLLATE NOCASE LIMIT 1').get(row.name ?? '') as unknown as { id: string } | undefined
    if (existing) map.set(sourceId, existing.id)
    else {
      const collision = target.prepare('SELECT 1 FROM tags WHERE id=?').get(sourceId)
      const targetId = collision ? nanoid(12) : sourceId
      insertRow(target, 'tags', row, { id: targetId }, 'ABORT')
      map.set(sourceId, targetId)
      added += 1
    }
  }
  return { map, added }
}

function mergeAssetRelations(
  source: DatabaseSync,
  target: DatabaseSync,
  sourceId: string,
  targetId: string,
  folderMap: Map<string, string>,
  tagMap: Map<string, string>
): void {
  for (const row of source.prepare('SELECT * FROM asset_folders WHERE asset_id=?').all(sourceId) as unknown as SqlRow[]) {
    const folderId = folderMap.get(String(row.folder_id))
    if (folderId) insertRow(target, 'asset_folders', row, { asset_id: targetId, folder_id: folderId }, 'IGNORE')
  }
  for (const row of source.prepare('SELECT * FROM asset_tags WHERE asset_id=?').all(sourceId) as unknown as SqlRow[]) {
    const tagId = tagMap.get(String(row.tag_id))
    if (tagId) insertRow(target, 'asset_tags', row, { asset_id: targetId, tag_id: tagId }, 'IGNORE')
  }

  mergeSingleton(source, target, 'ai_metadata', sourceId, targetId, 'updated_at')
  mergeSingleton(source, target, 'asset_ai_analysis', sourceId, targetId, 'updated_at')
  mergeSingleton(source, target, 'asset_color_analysis', sourceId, targetId, 'analyzed_at')
  mergeSingleton(source, target, 'asset_perceptual_hashes', sourceId, targetId, 'updated_at')

  copyAssetRows(source, target, 'asset_colors', sourceId, targetId)
  copyAssetRows(source, target, 'asset_embeddings', sourceId, targetId)
  copyAssetRows(source, target, 'asset_ai_overrides', sourceId, targetId, 'REPLACE')
  copyAssetRows(source, target, 'asset_ai_terms', sourceId, targetId, 'IGNORE', true)
  mergeAssetSources(source, target, sourceId, targetId)
}

function mergeAssetSources(source: DatabaseSync, target: DatabaseSync, sourceId: string, targetId: string): void {
  if (!tableExists(source, 'asset_sources') || !tableExists(target, 'asset_sources')) return
  for (const row of source.prepare('SELECT * FROM asset_sources WHERE asset_id=?').all(sourceId) as unknown as SqlRow[]) {
    const page = String(row.page_url_normalized), image = String(row.image_url_normalized)
    if (target.prepare('SELECT 1 FROM asset_sources WHERE asset_id=? AND page_url_normalized=? AND image_url_normalized=?').get(targetId, page, image)) continue
    const sourceRowId = String(row.id)
    const id = target.prepare('SELECT 1 FROM asset_sources WHERE id=?').get(sourceRowId) ? nanoid(16) : sourceRowId
    const signature = createHash('sha256').update(`${targetId}\0${page}\0${image}`).digest('hex')
    insertRow(target, 'asset_sources', row, { id, asset_id: targetId, source_signature: signature }, 'IGNORE')
  }
}

function mergeSingleton(source: DatabaseSync, target: DatabaseSync, table: string, sourceId: string, targetId: string, timestamp: string): void {
  if (!tableExists(source, table) || !tableExists(target, table)) return
  const row = source.prepare(`SELECT * FROM ${table} WHERE asset_id=?`).get(sourceId) as unknown as SqlRow | undefined
  if (!row) return
  const current = target.prepare(`SELECT * FROM ${table} WHERE asset_id=?`).get(targetId) as unknown as SqlRow | undefined
  if (!current || String(row[timestamp] ?? '') > String(current[timestamp] ?? '')) insertRow(target, table, row, { asset_id: targetId }, 'REPLACE')
}

function copyAssetRows(
  source: DatabaseSync,
  target: DatabaseSync,
  table: string,
  sourceId: string,
  targetId: string,
  conflict: 'IGNORE' | 'REPLACE' = 'IGNORE',
  renewId = false
): void {
  if (!tableExists(source, table) || !tableExists(target, table)) return
  for (const row of source.prepare(`SELECT * FROM ${table} WHERE asset_id=?`).all(sourceId) as unknown as SqlRow[]) {
    const overrides: SqlRow = { asset_id: targetId }
    if (renewId && Object.hasOwn(row, 'id')) {
      const sourceRowId = String(row.id)
      overrides.id = target.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(sourceRowId) ? nanoid(18) : sourceRowId
    }
    insertRow(target, table, row, overrides, conflict)
  }
}

function mergeSmartCollections(source: DatabaseSync, target: DatabaseSync, folderMap: Map<string, string>, tagMap: Map<string, string>): void {
  if (!tableExists(source, 'smart_collections') || !tableExists(source, 'smart_collection_rules')) return
  const collections = source.prepare('SELECT * FROM smart_collections ORDER BY sort_order,created_at,id').all() as unknown as SqlRow[]
  for (const collection of collections) {
    const sourceId = String(collection.id)
    if (target.prepare('SELECT 1 FROM smart_collections WHERE name=? COLLATE NOCASE').get(collection.name ?? '')) continue
    const targetId = target.prepare('SELECT 1 FROM smart_collections WHERE id=?').get(sourceId) ? nanoid(14) : sourceId
    insertRow(target, 'smart_collections', collection, { id: targetId }, 'ABORT')
    const rules = source.prepare('SELECT * FROM smart_collection_rules WHERE smart_collection_id=? ORDER BY sort_order,id').all(sourceId) as unknown as SqlRow[]
    for (const rule of rules) {
      let value = rule.value_json
      try {
        const parsed: unknown = JSON.parse(String(value))
        if (rule.field === 'folder' && typeof parsed === 'string') value = JSON.stringify(folderMap.get(parsed) ?? parsed)
        if (rule.field === 'tag' && typeof parsed === 'string') value = JSON.stringify(tagMap.get(parsed) ?? parsed)
      } catch { /* Existing validation will surface malformed rules when opened. */ }
      const sourceRuleId = String(rule.id)
      const ruleId = target.prepare('SELECT 1 FROM smart_collection_rules WHERE id=?').get(sourceRuleId) ? nanoid(10) : sourceRuleId
      insertRow(target, 'smart_collection_rules', rule, { id: ruleId, smart_collection_id: targetId, value_json: value ?? 'null' }, 'ABORT')
    }
  }
}

function rebuildFts(db: DatabaseSync, assetIds: string[]): void {
  const remove = db.prepare('DELETE FROM assets_fts WHERE asset_id=?')
  const insert = db.prepare(`INSERT INTO assets_fts(asset_id,filename,description,tags,folders)
    SELECT a.id,a.filename,COALESCE(aia.description,''),
      COALESCE((SELECT group_concat(t.name,' ') FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id),''),
      COALESCE((SELECT group_concat(f.name,' ') FROM asset_folders af JOIN folders f ON f.id=af.folder_id WHERE af.asset_id=a.id),'')
    FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id WHERE a.id=?`)
  for (const id of assetIds) { remove.run(id); insert.run(id) }
}
