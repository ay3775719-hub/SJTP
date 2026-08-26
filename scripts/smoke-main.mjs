import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import sharp from 'sharp'

const root = join(tmpdir(), `muse-smoke-${nanoid(6)}`)
const dbPath = join(root, 'muse.sqlite3')
await import('node:fs/promises').then(({ mkdir }) => mkdir(root, { recursive: true }))

const db = new DatabaseSync(dbPath)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE assets (id TEXT PRIMARY KEY, filename TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
`)
db.prepare('INSERT INTO assets (id, filename, hash) VALUES (?, ?, ?)').run('asset-1', 'smoke.jpg', 'abc')
const row = db.prepare('SELECT filename FROM assets WHERE id = ?').get('asset-1')
if (row?.filename !== 'smoke.jpg') throw new Error('SQLite smoke check failed')
db.close()

const thumbnail = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#c6aa83' } })
  .resize({ width: 320 })
  .webp({ quality: 80 })
  .toBuffer({ resolveWithObject: true })
if (thumbnail.info.width !== 320 || thumbnail.info.height !== 240) throw new Error('Sharp smoke check failed')

await rm(root, { recursive: true, force: true })
console.log('SQLite transaction + Sharp thumbnail smoke checks passed')
