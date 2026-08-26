export const collectionSuggestionsMigration = {
  version: 7,
  name: '007_collection_suggestions',
  sql: `
    CREATE TABLE smart_collection_suggestion_ignores (
      rule_signature TEXT PRIMARY KEY,
      ignored_at TEXT NOT NULL,
      restored_at TEXT
    );

    CREATE INDEX idx_suggestion_ignores_active
      ON smart_collection_suggestion_ignores(restored_at, ignored_at);

    CREATE INDEX idx_assets_active_id
      ON assets(deleted_at, id);

    CREATE INDEX idx_ai_terms_suggestion_lookup
      ON asset_ai_terms(type, normalized_value, source, confidence, asset_id);

    CREATE INDEX idx_asset_colors_suggestion
      ON asset_colors(asset_id, ratio, hue, saturation, lightness);
  `
} as const
