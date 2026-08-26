export const duplicateDetectionMigration = {
  version: 10,
  name: '010_duplicate_detection',
  foreignKeysOff: true,
  sql: `
    CREATE TABLE assets_v10 (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      thumbnail_path TEXT,
      mime_type TEXT NOT NULL,
      extension TEXT NOT NULL,
      width INTEGER NOT NULL CHECK (width >= 0),
      height INTEGER NOT NULL CHECK (height >= 0),
      size INTEGER NOT NULL CHECK (size >= 0),
      hash TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
      import_source TEXT NOT NULL DEFAULT 'local' CHECK (import_source IN ('local','url','browser_extension','clipboard','screenshot')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      last_opened_at TEXT,
      deleted_at TEXT,
      source_url TEXT,
      source_domain TEXT,
      source_title TEXT,
      source_author TEXT,
      source_saved_at TEXT
    );
    INSERT INTO assets_v10 SELECT * FROM assets;
    DROP TABLE assets;
    ALTER TABLE assets_v10 RENAME TO assets;

    CREATE INDEX idx_assets_imported_id ON assets(imported_at DESC, id DESC);
    CREATE INDEX idx_assets_deleted_imported ON assets(deleted_at, imported_at DESC);
    CREATE INDEX idx_assets_favorite ON assets(favorite, deleted_at, imported_at DESC);
    CREATE INDEX idx_assets_extension ON assets(extension, deleted_at);
    CREATE INDEX idx_assets_last_opened ON assets(last_opened_at DESC);
    CREATE INDEX idx_assets_dimensions ON assets(width, height, deleted_at);
    CREATE INDEX idx_assets_size ON assets(size, deleted_at);
    CREATE INDEX idx_assets_created ON assets(created_at, deleted_at);
    CREATE INDEX idx_assets_source_domain ON assets(source_domain, deleted_at);
    CREATE INDEX idx_assets_import_source ON assets(import_source, deleted_at);
    CREATE INDEX idx_assets_active_id ON assets(deleted_at, id);
    CREATE INDEX idx_assets_hash_active ON assets(hash, deleted_at, id);

    CREATE TABLE asset_perceptual_hashes (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      algorithm TEXT NOT NULL,
      version TEXT NOT NULL,
      hash_hex TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','stale')),
      source_fingerprint TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_asset_perceptual_hashes_status ON asset_perceptual_hashes(status, asset_id);
    CREATE INDEX idx_asset_perceptual_hashes_hash ON asset_perceptual_hashes(hash_hex, asset_id);

    CREATE TABLE duplicate_scan_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('scanning','completed','cancelled','failed')),
      scan_version TEXT NOT NULL,
      embedding_model_id TEXT NOT NULL,
      embedding_model_version TEXT NOT NULL,
      threshold_version TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      exact_groups INTEGER NOT NULL DEFAULT 0,
      near_groups INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE duplicate_groups (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('exact','near')),
      member_signature TEXT NOT NULL UNIQUE,
      representative_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      recommended_keep_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      score REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
      scan_version TEXT NOT NULL,
      embedding_model_id TEXT NOT NULL,
      embedding_model_version TEXT NOT NULL,
      threshold_version TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE INDEX idx_duplicate_groups_kind_score ON duplicate_groups(kind, score DESC, generated_at DESC);
    CREATE TABLE duplicate_group_members (
      group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      visual_similarity REAL,
      duplicate_score REAL NOT NULL CHECK (duplicate_score BETWEEN 0 AND 1),
      perceptual_hash_distance INTEGER,
      recommendation_rank INTEGER NOT NULL,
      recommendation_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recommendation_reasons_json)),
      PRIMARY KEY (group_id, asset_id)
    );
    CREATE INDEX idx_duplicate_group_members_asset ON duplicate_group_members(asset_id, group_id);
    CREATE TABLE duplicate_ignores (
      member_signature TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('exact','near')),
      ignored_at TEXT NOT NULL,
      restored_at TEXT
    );
    CREATE INDEX idx_duplicate_ignores_active ON duplicate_ignores(restored_at, member_signature);
  `
} as const
