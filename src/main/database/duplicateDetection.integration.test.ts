import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from './DatabaseService'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'
import { AssetRepository } from './repositories/AssetRepository'
import { AssetImporter } from '../services/assets/AssetImporter'
import { ensureLibrary } from '../services/filesystem/LibraryPaths'
import { EmbeddingRepository } from './repositories/EmbeddingRepository'
import { DuplicateRepository } from './repositories/DuplicateRepository'
import { DuplicateDetectionService } from '../services/duplicates/DuplicateDetectionService'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('duplicate and near-duplicate detection', () => {
  it('upgrades an existing v9 Library without losing foreign-key data and permits duplicate hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-duplicates-upgrade-')); roots.push(root)
    const databasePath = join(root, 'muse.db'), legacy = new DatabaseSync(databasePath)
    legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);')
    for (const migration of migrations.slice(0, 9)) { legacy.exec(migration.sql); legacy.prepare('INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (?,?)').run(migration.version, migration.name) }
    const now = new Date().toISOString()
    legacy.prepare(`INSERT INTO assets(id,filename,original_filename,path,mime_type,extension,width,height,size,hash,created_at,updated_at,imported_at) VALUES ('old','old.png','old.png','old-path','image/png','png',10,10,100,'same-hash',?,?,?)`).run(now, now, now)
    legacy.prepare(`INSERT INTO tags(id,name,type,created_at) VALUES ('tag','keep-me','manual',?)`).run(now)
    legacy.prepare(`INSERT INTO asset_tags(asset_id,tag_id,source,created_at) VALUES ('old','tag','manual',?)`).run(now)
    legacy.close()
    const upgraded = new DatabaseService(databasePath)
    expect((upgraded.db.prepare(`SELECT COUNT(*) AS count FROM asset_tags WHERE asset_id='old'`).get() as unknown as { count: number }).count).toBe(1)
    upgraded.db.prepare(`INSERT INTO assets(id,filename,original_filename,path,mime_type,extension,width,height,size,hash,created_at,updated_at,imported_at) VALUES ('copy','copy.png','copy.png','copy-path','image/png','png',10,10,100,'same-hash',?,?,?)`).run(now, now, now)
    expect((upgraded.db.prepare(`SELECT COUNT(*) AS count FROM assets WHERE hash='same-hash'`).get() as unknown as { count: number }).count).toBe(2)
    upgraded.close()
  })

  it('detects SHA-256 identity, conservative visual variants, ignore persistence, and Trash cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-duplicates-')); roots.push(root)
    const library = ensureLibrary(join(root, 'library')), inputs = join(root, 'inputs')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(inputs))
    const base = join(inputs, 'base.png'), exact = join(inputs, 'renamed-copy.png'), resized = join(inputs, 'resized.jpg'), recompressed = join(inputs, 'compressed.jpg'), different = join(inputs, 'different.png')
    const canvas = sharp({ create: { width: 640, height: 480, channels: 3, background: '#d5d0bd' } })
      .composite([{ input: Buffer.from('<svg width="640" height="480"><rect x="120" y="70" width="380" height="320" rx="55" fill="#3f7358"/><circle cx="245" cy="205" r="48" fill="#d9a94d"/><path d="M205 90 C240 5 390 5 420 90" stroke="#263c31" stroke-width="25" fill="none"/></svg>'), top: 0, left: 0 }])
    await canvas.png().toFile(base)
    await cp(base, exact)
    await sharp(base).resize(320, 240).jpeg({ quality: 82 }).toFile(resized)
    await sharp(base).jpeg({ quality: 55 }).toFile(recompressed)
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#e6e8ee' } }).composite([{ input: Buffer.from('<svg width="640" height="480"><circle cx="220" cy="250" r="125" fill="#4469ad"/><rect x="360" y="100" width="170" height="280" fill="#b75353"/></svg>') }]).png().toFile(different)

    let database = new DatabaseService(library.database), assets = new AssetRepository(database.db, (path) => path)
    const imported = await new AssetImporter(library, assets).import([base, exact, resized, recompressed, different])
    expect(imported.imported).toHaveLength(5)
    expect(imported.duplicateIds).toHaveLength(1)
    const model = { providerId: 'test', modelId: 'test-vision', modelVersion: '1', dimension: 4 }
    let embeddings = new EmbeddingRepository(database.db, model)
    const ids = new Map(imported.imported.map((asset) => [asset.filename, asset.id]))
    for (const name of ['base.png', 'renamed-copy.png', 'resized.jpg', 'compressed.jpg']) embeddings.save(ids.get(name)!, 'test', new Float32Array([1, 0, 0, 0]))
    embeddings.save(ids.get('different.png')!, 'test', new Float32Array([0, 1, 0, 0]))
    let repository = new DuplicateRepository(database.db, assets, model)
    let service = new DuplicateDetectionService(repository, assets, embeddings)
    const status = await service.scan()
    expect(status.exactGroupCount).toBe(1)
    const exactGroup = service.list('exact')[0]!
    expect(exactGroup.members.map((member) => member.asset.filename).sort()).toEqual(['base.png', 'renamed-copy.png'])
    expect(service.list('near').some((group) => group.members.some((member) => member.asset.filename === 'different.png'))).toBe(false)

    const nearGroup = service.list('near')[0]!
    expect(nearGroup.members.map((member) => member.asset.filename).sort()).toEqual(['compressed.jpg', 'resized.jpg'])
    service.ignore(nearGroup.id)
    database.close(); database = new DatabaseService(library.database); assets = new AssetRepository(database.db, (path) => path); embeddings = new EmbeddingRepository(database.db, model); repository = new DuplicateRepository(database.db, assets, model); service = new DuplicateDetectionService(repository, assets, embeddings)
    expect(service.list('near').some((group) => group.memberSignature === nearGroup.memberSignature)).toBe(false)

    const persistedExact = service.list('exact')[0]!
    const keepId = persistedExact.members.find((member) => member.asset.filename === 'base.png')!.asset.id
    await service.moveOthersToTrash(persistedExact.id, keepId)
    expect(assets.stats()).toMatchObject({ total: 4, trash: 1 })
    expect(service.list('exact')).toHaveLength(0)
    database.close()
  }, 30_000)
})
