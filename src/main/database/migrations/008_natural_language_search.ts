export const naturalLanguageSearchMigration = {
  version: 8,
  name: '008_natural_language_search',
  sql: `
    CREATE TABLE natural_search_parse_cache (
      query_key TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      model TEXT,
      parsed_at TEXT NOT NULL
    );

    CREATE TABLE natural_search_history (
      id TEXT PRIMARY KEY,
      query_key TEXT NOT NULL UNIQUE,
      query_text TEXT NOT NULL,
      intent_json TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX idx_natural_search_history_recent
      ON natural_search_history(last_used_at DESC);
  `
} as const
