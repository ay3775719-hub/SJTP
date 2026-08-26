export const minimalAIMetadataMigration = {
  version: 6,
  name: '006_minimal_ai_metadata',
  sql: `
    ALTER TABLE asset_ai_analysis ADD COLUMN result_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_object TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_object_label TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_object_confidence REAL;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_scene TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_scene_label TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_scene_confidence REAL;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_style TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_style_label TEXT;
    ALTER TABLE asset_ai_analysis ADD COLUMN primary_style_confidence REAL;

    CREATE INDEX idx_ai_analysis_primary_object ON asset_ai_analysis(primary_object, status);
    CREATE INDEX idx_ai_analysis_primary_scene ON asset_ai_analysis(primary_scene, status);
    CREATE INDEX idx_ai_analysis_primary_style ON asset_ai_analysis(primary_style, status);
  `
} as const
