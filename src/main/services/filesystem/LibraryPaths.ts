import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface LibraryDirectories {
  root: string
  originals: string
  thumbnails: string
  cache: string
  backups: string
  database: string
}

export function ensureLibrary(root: string): LibraryDirectories {
  const directories: LibraryDirectories = {
    root,
    originals: join(root, 'originals'),
    thumbnails: join(root, 'thumbnails'),
    cache: join(root, 'cache'),
    backups: join(root, 'backups'),
    database: existsSync(join(root, 'muse.sqlite3')) ? join(root, 'muse.sqlite3') : join(root, 'muse.db')
  }
  mkdirSync(directories.originals, { recursive: true })
  mkdirSync(directories.thumbnails, { recursive: true })
  mkdirSync(directories.cache, { recursive: true })
  mkdirSync(directories.backups, { recursive: true })
  return directories
}
