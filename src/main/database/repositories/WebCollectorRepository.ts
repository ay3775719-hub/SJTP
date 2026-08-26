import { createHash, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { WebCollectResult, WebCollectorStatus } from '@shared/types/domain'

interface PairingRow { extension_id: string; browser_name: string; created_at: string; last_used_at: string | null; token_hash: string }

export class WebCollectorRepository {
  constructor(private readonly db: DatabaseSync) {}

  savePairing(extensionId: string, browserName: string, token: string): void {
    const now = new Date().toISOString(), tokenHash = hashToken(token)
    this.db.prepare(`INSERT INTO web_collector_pairings(extension_id,token_hash,browser_name,created_at,last_used_at,revoked_at)
      VALUES(?,?,?,?,NULL,NULL) ON CONFLICT(extension_id) DO UPDATE SET token_hash=excluded.token_hash,browser_name=excluded.browser_name,created_at=excluded.created_at,last_used_at=NULL,revoked_at=NULL`)
      .run(extensionId, tokenHash, browserName, now)
  }

  authenticate(extensionId: string, token: string): boolean {
    const row = this.db.prepare(`SELECT token_hash FROM web_collector_pairings WHERE extension_id=? AND revoked_at IS NULL`).get(extensionId) as unknown as { token_hash: string } | undefined
    if (!row) return false
    const expected = Buffer.from(row.token_hash, 'hex'), actual = Buffer.from(hashToken(token), 'hex')
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual)
    if (valid) this.db.prepare("UPDATE web_collector_pairings SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE extension_id=?").run(extensionId)
    return valid
  }

  listPairings(): WebCollectorStatus['pairedBrowsers'] {
    const rows = this.db.prepare(`SELECT extension_id,browser_name,created_at,last_used_at,token_hash FROM web_collector_pairings WHERE revoked_at IS NULL ORDER BY created_at`).all() as unknown as PairingRow[]
    return rows.map((row) => ({ extensionId: row.extension_id, browserName: row.browser_name, createdAt: row.created_at, lastUsedAt: row.last_used_at }))
  }

  revoke(extensionId: string): boolean {
    return Number(this.db.prepare("UPDATE web_collector_pairings SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE extension_id=? AND revoked_at IS NULL").run(extensionId).changes) > 0
  }

  getRequest(requestId: string, extensionId: string): WebCollectResult | null {
    const row = this.db.prepare('SELECT request_id,status,asset_id,error_code FROM web_collect_requests WHERE request_id=? AND extension_id=?').get(requestId, extensionId) as unknown as { request_id: string; status: WebCollectResult['status']; asset_id: string | null; error_code: string | null } | undefined
    return row ? { requestId: row.request_id, status: row.status, assetId: row.asset_id ?? undefined, message: row.error_code ?? undefined } : null
  }

  beginRequest(requestId: string, extensionId: string): boolean {
    return Number(this.db.prepare(`INSERT OR IGNORE INTO web_collect_requests(request_id,extension_id,status,created_at) VALUES(?,?,'invalid_request',?)`).run(requestId, extensionId, new Date().toISOString()).changes) > 0
  }

  completeRequest(extensionId: string, result: WebCollectResult): void {
    this.db.prepare(`UPDATE web_collect_requests SET status=?,asset_id=?,error_code=?,completed_at=? WHERE request_id=? AND extension_id=?`)
      .run(result.status, result.assetId ?? null, result.message ?? null, new Date().toISOString(), result.requestId, extensionId)
  }
}

function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex') }
