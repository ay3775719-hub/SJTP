export const aiAssetUnderstandingMigration = {
  version: 3,
  name: '003_ai_asset_understanding',
  sql: `
    CREATE TABLE asset_ai_analysis (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_analyzed' CHECK (status IN ('not_analyzed','queued','analyzing','completed','failed')),
      provider TEXT,
      model TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      primary_category TEXT,
      primary_category_label TEXT,
      primary_category_confidence REAL CHECK (primary_category_confidence IS NULL OR primary_category_confidence BETWEEN 0 AND 1),
      secondary_category TEXT,
      secondary_category_label TEXT,
      secondary_category_confidence REAL CHECK (secondary_category_confidence IS NULL OR secondary_category_confidence BETWEEN 0 AND 1),
      tertiary_category TEXT,
      tertiary_category_label TEXT,
      tertiary_category_confidence REAL CHECK (tertiary_category_confidence IS NULL OR tertiary_category_confidence BETWEEN 0 AND 1),
      description TEXT,
      overall_confidence REAL CHECK (overall_confidence IS NULL OR overall_confidence BETWEEN 0 AND 1),
      started_at TEXT,
      analyzed_at TEXT,
      updated_at TEXT NOT NULL,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0)
    );

    CREATE TABLE asset_ai_terms (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('object','scene','style','mood','lighting','composition','material','usage','semantic_color','open_tag')),
      value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      source TEXT NOT NULL CHECK (source IN ('ai','manual','system')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(asset_id, type, normalized_value, source)
    );

    CREATE TABLE asset_ai_overrides (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('object','scene','style','mood','lighting','composition','material','usage','semantic_color','open_tag')),
      normalized_value TEXT NOT NULL,
      value TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('manual_added','manual_removed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, type, normalized_value)
    );

    CREATE TABLE ai_analysis_jobs (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('queued','analyzing','completed','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      priority INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT
    );

    CREATE TABLE asset_color_analysis (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      average_hex TEXT NOT NULL,
      brightness REAL NOT NULL CHECK (brightness BETWEEN 0 AND 1),
      saturation REAL NOT NULL CHECK (saturation BETWEEN 0 AND 1),
      temperature TEXT NOT NULL CHECK (temperature IN ('cool','neutral','warm')),
      analyzed_at TEXT NOT NULL
    );

    ALTER TABLE asset_colors ADD COLUMN ratio REAL;
    ALTER TABLE asset_colors ADD COLUMN hue REAL;
    ALTER TABLE asset_colors ADD COLUMN saturation REAL;
    ALTER TABLE asset_colors ADD COLUMN lightness REAL;
    ALTER TABLE asset_colors ADD COLUMN lab_l REAL;
    ALTER TABLE asset_colors ADD COLUMN lab_a REAL;
    ALTER TABLE asset_colors ADD COLUMN lab_b REAL;
    UPDATE asset_colors SET ratio = population WHERE ratio IS NULL;

    INSERT INTO asset_ai_analysis (
      asset_id, status, provider, model, schema_version, description, analyzed_at, updated_at
    )
    SELECT asset_id,
      CASE WHEN analyzed_at IS NOT NULL THEN 'completed' ELSE 'not_analyzed' END,
      ai_provider, ai_model, schema_version, description, analyzed_at, updated_at
    FROM ai_metadata
    WHERE analyzed_at IS NOT NULL OR description IS NOT NULL
      OR json_array_length(styles_json) > 0 OR json_array_length(moods_json) > 0
      OR json_array_length(objects_json) > 0 OR json_array_length(scene_json) > 0;

    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'style', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.styles_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'mood', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.moods_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'object', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.objects_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'material', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.materials_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'lighting', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.lighting_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'composition', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.composition_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'scene', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.scene_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'usage', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.usage_json) j WHERE typeof(j.value) = 'text';
    INSERT OR IGNORE INTO asset_ai_terms (id, asset_id, type, value, normalized_value, confidence, source, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), m.asset_id, 'semantic_color', j.value, lower(trim(j.value)), 1, 'ai', m.updated_at, m.updated_at
      FROM ai_metadata m, json_each(m.colors_json) j WHERE typeof(j.value) = 'text';

    CREATE INDEX idx_asset_ai_analysis_status ON asset_ai_analysis(status, updated_at);
    CREATE INDEX idx_asset_ai_analysis_primary ON asset_ai_analysis(primary_category, primary_category_confidence, asset_id);
    CREATE INDEX idx_asset_ai_analysis_secondary ON asset_ai_analysis(secondary_category, secondary_category_confidence, asset_id);
    CREATE INDEX idx_asset_ai_terms_asset_type ON asset_ai_terms(asset_id, type);
    CREATE INDEX idx_asset_ai_terms_lookup ON asset_ai_terms(type, normalized_value, confidence, asset_id);
    CREATE INDEX idx_asset_ai_overrides_asset ON asset_ai_overrides(asset_id, type);
    CREATE INDEX idx_ai_analysis_jobs_state ON ai_analysis_jobs(state, priority DESC, requested_at);
    CREATE INDEX idx_asset_colors_asset ON asset_colors(asset_id, position);
    CREATE INDEX idx_asset_colors_lab ON asset_colors(lab_l, lab_a, lab_b, asset_id);
    CREATE INDEX idx_asset_color_analysis_metrics ON asset_color_analysis(temperature, brightness, saturation, asset_id);
  `
} as const
