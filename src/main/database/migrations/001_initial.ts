export const initialMigration = {
  version: 1,
  name: '001_initial',
  sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
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
      hash TEXT NOT NULL UNIQUE,
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

    CREATE TABLE IF NOT EXISTS thumbnails (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      size_key TEXT NOT NULL CHECK (size_key IN ('small','medium','large')),
      path TEXT NOT NULL UNIQUE,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, size_key)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(parent_id, name)
    );

    CREATE TABLE IF NOT EXISTS asset_folders (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, folder_id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      type TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual','ai','system')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      confidence REAL CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
      source TEXT NOT NULL CHECK (source IN ('manual','ai','system')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS ai_metadata (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      description TEXT,
      styles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(styles_json)),
      moods_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(moods_json)),
      colors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(colors_json)),
      objects_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(objects_json)),
      materials_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(materials_json)),
      lighting_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lighting_json)),
      composition_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(composition_json)),
      scene_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scene_json)),
      usage_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(usage_json)),
      ocr_text TEXT,
      semantic_embedding_status TEXT NOT NULL DEFAULT 'disabled' CHECK (semantic_embedding_status IN ('pending','processing','ready','failed','disabled')),
      visual_embedding_status TEXT NOT NULL DEFAULT 'disabled' CHECK (visual_embedding_status IN ('pending','processing','ready','failed','disabled')),
      semantic_embedding BLOB,
      visual_embedding BLOB,
      ai_model TEXT,
      ai_provider TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      analyzed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_colors (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      hex TEXT NOT NULL,
      population REAL,
      PRIMARY KEY (asset_id, position)
    );

    CREATE TABLE IF NOT EXISTS smart_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      query_json TEXT NOT NULL CHECK (json_valid(query_json)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
      asset_id UNINDEXED,
      filename,
      description,
      tags,
      folders,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE INDEX IF NOT EXISTS idx_assets_imported_id ON assets(imported_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_deleted_imported ON assets(deleted_at, imported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite, deleted_at, imported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_extension ON assets(extension, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_assets_last_opened ON assets(last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_folders_folder ON asset_folders(folder_id, asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id, asset_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_position ON folders(parent_id, position);
  `
} as const
