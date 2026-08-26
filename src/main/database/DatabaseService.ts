import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrations } from './migrations'
import { logger } from '../logger'
import { runTransaction } from './transaction'

export class DatabaseService {
  readonly db: DatabaseSync

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)

    const applied = new Set(
      this.db.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as unknown as { version: number }).version)
    )

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      const needsForeignKeysOff = 'foreignKeysOff' in migration && migration.foreignKeysOff
      if (needsForeignKeysOff) this.db.exec('PRAGMA foreign_keys = OFF')
      try {
        runTransaction(this.db, () => {
          this.db.exec(migration.sql)
          this.db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name)
        })
      } finally {
        if (needsForeignKeysOff) this.db.exec('PRAGMA foreign_keys = ON')
      }
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Foreign key check failed after ${migration.name}`)
      logger.info(`Applied database migration ${migration.name}`)
    }
  }

  close(): void {
    this.db.close()
  }
}
