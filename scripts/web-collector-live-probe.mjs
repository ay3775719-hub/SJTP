import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const [databasePath, command] = process.argv.slice(2)
if (!databasePath || !command) throw new Error('Usage: node --experimental-sqlite scripts/web-collector-live-probe.mjs <db> <pair|status>')
const db = new DatabaseSync(databasePath)
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
try {
  if (command === 'pair') {
    const token = process.env.MUSE_WEB_COLLECTOR_TEST_TOKEN
    if (!token) throw new Error('MUSE_WEB_COLLECTOR_TEST_TOKEN is required')
    const hash = createHash('sha256').update(token).digest('hex'), now = new Date().toISOString()
    db.prepare(`INSERT INTO web_collector_pairings(extension_id,token_hash,browser_name,created_at,last_used_at,revoked_at)
      VALUES(?,?,?,?,NULL,NULL) ON CONFLICT(extension_id) DO UPDATE SET token_hash=excluded.token_hash,browser_name=excluded.browser_name,created_at=excluded.created_at,revoked_at=NULL`)
      .run('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', hash, 'Chrome QA', now)
    console.log(JSON.stringify({ paired: true, extensionId: 'aaaaaaaa…' }))
  } else if (command === 'status') {
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL) assets,
      (SELECT COUNT(*) FROM asset_sources) sources,
      (SELECT COUNT(*) FROM ai_analysis_jobs) ai_jobs,
      (SELECT COUNT(*) FROM asset_embeddings WHERE status='completed') embeddings`).get()
    const latest = db.prepare(`SELECT a.id,a.filename,a.import_source,aia.status ai_status,
      (SELECT COUNT(*) FROM asset_sources s WHERE s.asset_id=a.id) source_count,
      (SELECT COUNT(*) FROM asset_colors c WHERE c.asset_id=a.id) color_count,
      (SELECT COUNT(*) FROM asset_embeddings e WHERE e.asset_id=a.id AND e.status='completed') embedding_count
      FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id
      WHERE EXISTS(SELECT 1 FROM asset_sources s WHERE s.asset_id=a.id) ORDER BY a.imported_at DESC LIMIT 1`).get()
    const aiSettings = db.prepare("SELECT value FROM settings WHERE key='ai.settings'").get()?.value ?? null
    console.log(JSON.stringify({ counts, latest, aiSettings: aiSettings ? JSON.parse(aiSettings) : null }))
  }
} finally { db.close() }
