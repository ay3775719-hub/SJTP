export const webCollectorMigration = {
  version: 12,
  name: '012_web_collector',
  sql: `
    CREATE TABLE asset_sources (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('web')),
      page_url TEXT NOT NULL,
      page_url_normalized TEXT NOT NULL,
      image_url TEXT NOT NULL,
      image_url_normalized TEXT NOT NULL,
      page_title TEXT,
      site_name TEXT,
      domain TEXT NOT NULL,
      alt_text TEXT,
      collected_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_signature TEXT NOT NULL UNIQUE
    );

    CREATE INDEX idx_asset_sources_asset ON asset_sources(asset_id, collected_at DESC);
    CREATE INDEX idx_asset_sources_type_domain ON asset_sources(source_type, domain, asset_id);

    CREATE TABLE web_collector_pairings (
      extension_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      browser_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE web_collect_requests (
      request_id TEXT PRIMARY KEY,
      extension_id TEXT NOT NULL,
      status TEXT NOT NULL,
      asset_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error_code TEXT
    );
  `
} as const
