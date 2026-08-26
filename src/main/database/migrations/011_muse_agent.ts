export const museAgentMigration = {
  version: 11,
  name: '011_muse_agent',
  sql: `
    CREATE TABLE muse_agent_conversations (
      id TEXT PRIMARY KEY,
      codex_thread_id TEXT UNIQUE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
    );
    CREATE INDEX idx_muse_agent_conversations_active
      ON muse_agent_conversations(archived, updated_at DESC);

    CREATE TABLE muse_agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES muse_agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_muse_agent_messages_conversation
      ON muse_agent_messages(conversation_id, created_at, id);

    CREATE TABLE muse_agent_tool_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES muse_agent_conversations(id) ON DELETE SET NULL,
      codex_thread_id TEXT,
      turn_id TEXT,
      tool_name TEXT NOT NULL,
      permission TEXT NOT NULL CHECK (permission IN ('read', 'safe-write', 'destructive')),
      target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
      approved INTEGER CHECK (approved IS NULL OR approved IN (0, 1)),
      result_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_muse_agent_tool_audit_thread
      ON muse_agent_tool_audit(codex_thread_id, created_at DESC);
    CREATE INDEX idx_muse_agent_tool_audit_tool
      ON muse_agent_tool_audit(tool_name, created_at DESC);
  `
} as const
