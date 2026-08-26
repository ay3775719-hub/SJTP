import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type { LibraryBackupResult, LibraryTransferStatus } from '@shared/types/domain'
import type { LibraryDirectories } from './LibraryPaths'

const MANIFEST_NAME = 'muse-library.json'
const BACKUP_FORMAT_VERSION = 1

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

export class LibraryTransferService {
  private state: LibraryTransferStatus = { state: 'idle' }

  constructor(
    private readonly db: DatabaseSync,
    private readonly library: LibraryDirectories,
    private readonly appVersion: string
  ) {}

  status(): LibraryTransferStatus { return this.state }

  async backupTo(parentDirectory: string): Promise<LibraryBackupResult> {
    if (this.state.state === 'backing_up') throw new Error('Library 正在备份，请等待当前任务完成')
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
