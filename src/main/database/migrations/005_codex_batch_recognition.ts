export const codexBatchRecognitionMigration = {
  version: 5,
  name: '005_codex_batch_recognition',
  sql: `
    ALTER TABLE asset_ai_analysis ADD COLUMN prompt_version TEXT;
    ALTER TABLE ai_analysis_jobs ADD COLUMN batch_id TEXT;

    CREATE TABLE ai_queue_runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
      pause_reason TEXT,
      provider_id TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO ai_queue_runtime_state (id, paused, pause_reason, provider_id, updated_at)
      VALUES (1, 0, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    CREATE INDEX idx_ai_analysis_jobs_batch ON ai_analysis_jobs(batch_id, state, requested_at);
  `
} as const
