export const visualSimilarityMigration = {
  version: 9,
  name: '009_visual_similarity',
  sql: `
    CREATE TABLE asset_embeddings (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      vector_blob BLOB,
      normalized INTEGER NOT NULL DEFAULT 1 CHECK (normalized IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('not_generated','queued','generating','completed','failed','stale')),
      source_fingerprint TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, provider_id, model_id, model_version)
    );

    CREATE INDEX idx_asset_embeddings_model_status
      ON asset_embeddings(provider_id, model_id, model_version, status, asset_id);
    CREATE INDEX idx_asset_embeddings_asset_status
      ON asset_embeddings(asset_id, status);
  `
} as const
