import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { MuseAgentConversation, MuseAgentMessage, MuseToolPermission } from '@shared/types/domain'

interface ConversationRow { id: string; codex_thread_id: string | null; title: string; created_at: string; updated_at: string; archived: number }
interface MessageRow { id: string; conversation_id: string; role: MuseAgentMessage['role']; content: string; created_at: string }

export class MuseAgentRepository {
  constructor(private readonly db: DatabaseSync) {}

  createConversation(title = '新对话'): MuseAgentConversation {
    const now = new Date().toISOString(), id = nanoid(14)
    this.db.prepare('INSERT INTO muse_agent_conversations (id,title,created_at,updated_at) VALUES (?,?,?,?)').run(id, title, now, now)
    return { id, codexThreadId: null, title, createdAt: now, updatedAt: now, archived: false }
  }

  listConversations(includeArchived = false): MuseAgentConversation[] {
    const rows = this.db.prepare(`SELECT * FROM muse_agent_conversations ${includeArchived ? '' : 'WHERE archived=0'} ORDER BY updated_at DESC`).all() as unknown as ConversationRow[]
    return rows.map(mapConversation)
  }

  getConversation(id: string): MuseAgentConversation | null {
    const row = this.db.prepare('SELECT * FROM muse_agent_conversations WHERE id=?').get(id) as unknown as ConversationRow | undefined
    return row ? mapConversation(row) : null
  }

  setThread(id: string, threadId: string): void {
    this.db.prepare("UPDATE muse_agent_conversations SET codex_thread_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(threadId, id)
  }

  setTitle(id: string, title: string): void {
    this.db.prepare("UPDATE muse_agent_conversations SET title=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(title, id)
  }

  archive(id: string, archived = true): void {
    this.db.prepare("UPDATE muse_agent_conversations SET archived=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(archived ? 1 : 0, id)
  }

  addMessage(conversationId: string, role: MuseAgentMessage['role'], content: string): MuseAgentMessage {
    const message = { id: nanoid(16), conversationId, role, content, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO muse_agent_messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)')
      .run(message.id, conversationId, role, content, message.createdAt)
    this.db.prepare('UPDATE muse_agent_conversations SET updated_at=? WHERE id=?').run(message.createdAt, conversationId)
    return message
  }

  messages(conversationId: string, limit = 200): MuseAgentMessage[] {
    const rows = this.db.prepare(`SELECT * FROM (
      SELECT * FROM muse_agent_messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT ?
    ) ORDER BY created_at,id`).all(conversationId, Math.min(limit, 500)) as unknown as MessageRow[]
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, createdAt: row.created_at }))
  }

  audit(input: { conversationId: string | null; codexThreadId: string | null; turnId: string | null; toolName: string; permission: MuseToolPermission; targetCount: number; approved: boolean | null; resultCode: string }): void {
    this.db.prepare(`INSERT INTO muse_agent_tool_audit
      (id,conversation_id,codex_thread_id,turn_id,tool_name,permission,target_count,approved,result_code,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(nanoid(16), input.conversationId, input.codexThreadId, input.turnId, input.toolName,
      input.permission, Math.max(0, input.targetCount), input.approved === null ? null : input.approved ? 1 : 0, input.resultCode, new Date().toISOString())
  }
}

function mapConversation(row: ConversationRow): MuseAgentConversation {
  return { id: row.id, codexThreadId: row.codex_thread_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, archived: row.archived === 1 }
}
