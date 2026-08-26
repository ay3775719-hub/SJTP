import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { AssetWebSource, WebCollectPayload } from '@shared/types/domain'

interface SourceRow {
  id: string
  asset_id: string
  source_type: 'web'
  page_url: string
  image_url: string
  page_title: string | null
  site_name: string | null
  domain: string
  alt_text: string | null
  collected_at: string
  created_at: string
}

export interface PreparedAssetSource {
  id: string
  assetId: string
  pageUrl: string
  pageUrlNormalized: string
  imageUrl: string
  imageUrlNormalized: string
  pageTitle: string | null
  siteName: string | null
  domain: string
  altText: string | null
  collectedAt: string
  createdAt: string
  signature: string
}

export class AssetSourceRepository {
  constructor(private readonly db: DatabaseSync) {}

  prepare(assetId: string, payload: WebCollectPayload): PreparedAssetSource {
    const pageUrlNormalized = normalizeWebUrl(payload.pageUrl)
    const imageUrlNormalized = normalizeWebUrl(payload.imageUrl)
    const domain = canonicalDomain(new URL(payload.pageUrl).hostname)
    const signature = createHash('sha256').update(`${assetId}\0${pageUrlNormalized}\0${imageUrlNormalized}`).digest('hex')
    return {
      id: nanoid(16), assetId, pageUrl: payload.pageUrl, pageUrlNormalized,
      imageUrl: payload.imageUrl, imageUrlNormalized, pageTitle: payload.pageTitle?.trim() || null,
      siteName: payload.siteName?.trim() || null, domain, altText: payload.altText?.trim() || null,
      collectedAt: payload.collectedAt, createdAt: new Date().toISOString(), signature
    }
  }

  insertPrepared(source: PreparedAssetSource): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO asset_sources (
      id,asset_id,source_type,page_url,page_url_normalized,image_url,image_url_normalized,page_title,site_name,domain,alt_text,collected_at,created_at,source_signature
    ) VALUES (@id,@assetId,'web',@pageUrl,@pageUrlNormalized,@imageUrl,@imageUrlNormalized,@pageTitle,@siteName,@domain,@altText,@collectedAt,@createdAt,@signature)`).run({ ...source })
    return Number(result.changes) > 0
  }

  add(assetId: string, payload: WebCollectPayload): boolean { return this.insertPrepared(this.prepare(assetId, payload)) }

  list(assetId: string): AssetWebSource[] {
    const rows = this.db.prepare(`SELECT id,asset_id,source_type,page_url,image_url,page_title,site_name,domain,alt_text,collected_at,created_at
      FROM asset_sources WHERE asset_id=? ORDER BY collected_at DESC,created_at DESC`).all(assetId) as unknown as SourceRow[]
    return rows.map(hydrate)
  }
}

export function normalizeWebUrl(input: string): string {
  const url = new URL(input)
  url.hash = ''
  url.hostname = url.hostname.toLocaleLowerCase('en-US')
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = ''
  return url.toString()
}

export function canonicalDomain(hostname: string): string {
  const host = hostname.toLocaleLowerCase('en-US').replace(/^www\./, '')
  return host.endsWith('.') ? host.slice(0, -1) : host
}

function hydrate(row: SourceRow): AssetWebSource {
  return { id: row.id, assetId: row.asset_id, sourceType: row.source_type, pageUrl: row.page_url, imageUrl: row.image_url,
    pageTitle: row.page_title, siteName: row.site_name, domain: row.domain, altText: row.alt_text,
    collectedAt: row.collected_at, createdAt: row.created_at }
}
