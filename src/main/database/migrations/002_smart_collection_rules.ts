export const smartCollectionRulesMigration = {
  version: 2,
  name: '002_smart_collection_rules',
  sql: `
    ALTER TABLE smart_collections RENAME TO smart_collections_legacy;

    CREATE TABLE smart_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      match_mode TEXT NOT NULL CHECK (match_mode IN ('all', 'any')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE smart_collection_rules (
      id TEXT PRIMARY KEY,
      smart_collection_id TEXT NOT NULL REFERENCES smart_collections(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      operator TEXT NOT NULL,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    INSERT INTO smart_collections (id, name, match_mode, sort_order, created_at, updated_at)
      SELECT id, name, 'all', position, created_at, updated_at FROM smart_collections_legacy;
    DROP TABLE smart_collections_legacy;

    CREATE INDEX idx_smart_collection_rules_collection ON smart_collection_rules(smart_collection_id, sort_order);
    CREATE INDEX idx_smart_collections_order ON smart_collections(sort_order, created_at);
    CREATE INDEX idx_assets_dimensions ON assets(width, height, deleted_at);
    CREATE INDEX idx_assets_size ON assets(size, deleted_at);
    CREATE INDEX idx_assets_created ON assets(created_at, deleted_at);
    CREATE INDEX idx_assets_source_domain ON assets(source_domain, deleted_at);
    CREATE INDEX idx_assets_import_source ON assets(import_source, deleted_at);
    CREATE INDEX idx_asset_folders_asset ON asset_folders(asset_id, folder_id);
    CREATE INDEX idx_asset_tags_asset ON asset_tags(asset_id, tag_id);
  `
} as const
