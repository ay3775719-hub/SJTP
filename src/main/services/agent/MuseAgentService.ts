import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import type { MuseAgentContextSnapshot, MuseAgentConversation, MuseAgentEvent, MuseAgentMessage, MuseAgentState } from '@shared/types/domain'
import type { MuseAgentRepository } from '../../database/repositories/MuseAgentRepository'
import type { CodexAppServerManager } from '../ai/codex/CodexAppServerManager'
import type { CodexToolBridge } from './CodexToolBridge'
import type { MuseAgentApprovalService } from './MuseAgentApprovalService'
import type { MuseAgentContextService } from './MuseAgentContextService'
import { MuseError } from '../../errors'

interface ActiveTurn { conversationId: string; threadId: string; turnId: string | null; controller: AbortController }

export class MuseAgentService {
  private readonly events = new EventEmitter()
  private readonly active = new Map<string, ActiveTurn>()
  private readonly conversationByThread = new Map<string, string>()

  constructor(
    private readonly repository: MuseAgentRepository,
    private readonly manager: CodexAppServerManager,
    private readonly bridge: CodexToolBridge,
    private readonly approval: MuseAgentApprovalService,
    private readonly context: MuseAgentContextService,
    private readonly workspacePath: string
  ) {
    this.bridge.onEvent((event) => {
      if (event.type !== 'delta' || !event.delta) return
      const conversationId = this.conversationByThread.get(event.threadId)
      if (conversationId) this.emit({ type: 'message-delta', conversationId, turnId: event.turnId, delta: event.delta })
    })
    this.approval.onRequested((request) => this.emit({ type: 'approval-requested', request }))
    this.approval.onResolved((requestId, approved) => this.emit({ type: 'approval-resolved', requestId, approved }))
    this.manager.onChanged(() => this.emit({ type: 'state-changed' }))
  }

  onEvent(listener: (event: MuseAgentEvent) => void): () => void { this.events.on('event', listener); return () => this.events.off('event', listener) }
  updateContext(snapshot: MuseAgentContextSnapshot): void { this.context.update(snapshot) }

  async state(): Promise<MuseAgentState> {
    const account = await this.manager.account()
    let usage = null
    if (account.connected) { try { usage = await this.manager.usage() } catch { /* status remains usable */ } }
    const active = [...this.active.values()].find((turn) => turn.turnId)
    return { account, usage, capabilities: this.bridge.capabilities(account.connected), activeTurnId: active?.turnId ?? null }
  }

  conversations(includeArchived = false): MuseAgentConversation[] { return this.repository.listConversations(includeArchived) }
  messages(conversationId: string, limit = 200): MuseAgentMessage[] { return this.repository.messages(conversationId, limit) }
  createConversation(): MuseAgentConversation { return this.repository.createConversation() }

  async archiveConversation(conversationId: string): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    if (this.active.has(conversationId)) await this.stop(conversationId)
    this.repository.archive(conversationId, true)
    if (conversation.codexThreadId) await this.manager.protocolRequest('thread/archive', { threadId: conversation.codexThreadId }).catch(() => undefined)
  }

  async send(conversationId: string, text: string): Promise<void> {
    if (this.active.has(conversationId)) throw new MuseError('AGENT_TURN_ACTIVE', '当前对话仍在处理中')
    const conversation = this.requireConversation(conversationId), account = await this.manager.account()
    if (!account.connected) throw new MuseError('CODEX_AUTH_REQUIRED', '请先使用 ChatGPT 登录 Muse AI')
    const usage = await this.manager.usage()
    if (usage.limitReached) throw new MuseError('CODEX_USAGE_LIMIT', 'Muse AI 当前达到 Codex 使用限制，本地 Library 功能仍可正常使用。')
    await mkdir(this.workspacePath, { recursive: true })
    const models = await this.manager.listModels(), model = models.find((item) => item.isDefault) ?? models[0]
    if (!model) throw new MuseError('CODEX_MODEL_UNAVAILABLE', '当前 Codex 账号没有可用模型')

    let threadId = conversation.codexThreadId
    if (!threadId) {
      const started = await this.bridge.startThread({ modelId: model.id, workspacePath: this.workspacePath })
      threadId = started.threadId
      this.repository.setThread(conversationId, threadId)
    } else {
      try { await this.bridge.resumeThread(threadId, { modelId: model.id, workspacePath: this.workspacePath }) }
      catch {
        const started = await this.bridge.startThread({ modelId: model.id, workspacePath: this.workspacePath })
        threadId = started.threadId
        this.repository.setThread(conversationId, threadId)
      }
    }
    this.conversationByThread.set(threadId, conversationId)
    const userMessage = this.repository.addMessage(conversationId, 'user', text)
    if (this.repository.messages(conversationId, 2).length === 1) this.repository.setTitle(conversationId, titleFrom(text))
    const controller = new AbortController(), active: ActiveTurn = { conversationId, threadId, turnId: null, controller }
    this.active.set(conversationId, active)
    this.emit({ type: 'message-completed', conversationId, message: userMessage })
    this.emit({ type: 'state-changed' })
    try {
      const output = await this.bridge.runTurn({ conversationId, threadId, modelId: model.id, text,
        contextText: contextText(this.context.current()), signal: controller.signal,
        onStarted: (turnId) => { active.turnId = turnId; this.emit({ type: 'state-changed' }) } })
      if (output.status !== 'completed') {
        this.emit({ type: 'turn-completed', conversationId, turnId: output.turnId, status: output.status === 'interrupted' ? 'interrupted' : 'failed' })
        return
      }
      const content = output.text.trim()
      if (content) {
        const message = this.repository.addMessage(conversationId, 'assistant', content)
        this.emit({ type: 'message-completed', conversationId, message })
      }
      this.emit({ type: 'turn-completed', conversationId, turnId: output.turnId, status: 'completed' })
    } catch (error) {
      const code = error instanceof MuseError ? error.code : 'AGENT_TURN_FAILED', message = error instanceof Error ? error.message : String(error)
      const status = controller.signal.aborted ? 'interrupted' : 'failed'
      this.emit({ type: 'error', conversationId, code, message })
      this.emit({ type: 'turn-completed', conversationId, turnId: active.turnId ?? 'pending', status })
      if (!controller.signal.aborted) throw error
    } finally {
      this.active.delete(conversationId)
      this.emit({ type: 'state-changed' })
    }
  }

  async stop(conversationId: string): Promise<void> {
    const active = this.active.get(conversationId)
    if (!active) return
    active.controller.abort()
    if (active.turnId) {
      this.approval.cancelTurn(active.turnId)
      await this.bridge.interrupt(active.threadId, active.turnId).catch(() => undefined)
    }
  }

  resolveApproval(requestId: string, approved: boolean): boolean { return this.approval.resolve(requestId, approved) }

  emitActivity(context: { conversationId: string | null; turnId: string }, toolName: string, label: string, active: boolean): void {
    if (!context.conversationId) return
    this.emit({ type: 'activity', conversationId: context.conversationId, turnId: context.turnId, toolName, label, active })
  }

  private requireConversation(id: string): MuseAgentConversation {
    const conversation = this.repository.getConversation(id)
    if (!conversation || conversation.archived) throw new MuseError('AGENT_CONVERSATION_NOT_FOUND', '找不到该 Muse AI 对话')
    return conversation
  }
  private emit(event: MuseAgentEvent): void { this.events.emit('event', event) }
}

function titleFrom(text: string): string { return text.replace(/[\r\n]+/g, ' ').trim().slice(0, 28) || '新对话' }
function contextText(context: MuseAgentContextSnapshot): string {
  return `<muse_ui_context>\ncurrentViewType=${context.currentViewType}\ncurrentViewId=${context.currentViewId ?? 'none'}\nselectionCount=${context.selectionCount}\nfocusedAssetId=${context.focusedAssetId ?? 'none'}\n</muse_ui_context>\nThe context is only a lightweight UI snapshot. Fetch real data with Muse tools.`
}
