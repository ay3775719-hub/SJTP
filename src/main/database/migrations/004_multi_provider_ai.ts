export const multiProviderAIMigration = {
  version: 4,
  name: '004_multi_provider_ai',
  sql: `
    ALTER TABLE ai_analysis_jobs ADD COLUMN provider_id TEXT;
    ALTER TABLE ai_analysis_jobs ADD COLUMN model_id TEXT;
    ALTER TABLE ai_analysis_jobs ADD COLUMN provider_config_json TEXT;
    UPDATE ai_analysis_jobs SET provider_id = COALESCE(provider_id, 'openai'), model_id = COALESCE(model_id, 'gpt-4.1-mini'), provider_config_json = COALESCE(provider_config_json, '{"providerId":"openai","modelId":"gpt-4.1-mini","baseUrl":"https://api.openai.com/v1"}');
    CREATE INDEX idx_ai_analysis_jobs_provider_state ON ai_analysis_jobs(provider_id, state, priority DESC, requested_at);
  `
} as const
