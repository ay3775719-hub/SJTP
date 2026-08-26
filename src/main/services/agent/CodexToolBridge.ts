import { EventEmitter } from 'node:events'
import type { MuseAgentCapabilities } from '@shared/types/domain'
import type { CodexAppServerManager, CodexProtocolMessage } from '../ai/codex/CodexAppServerManager'
import type { MuseToolExecutionContext, MuseToolRegistry } from './MuseToolRegistry'
import { MUSE_AGENT_INSTRUCTIONS } from './museAgentInstructions'

interface BridgeThreadInput { modelId: string; workspacePath: string }
interface BridgeTurnInput {
  conversationId: string
  threadId: string
  modelId: string
  text: string
  contextText: string
  signal?: AbortSignal
  onStarted?(turnId: string): void
}
interface BridgeTurnOutput { turnId: string; text: string; status: string }

export interface BridgeEvent {
  type: 'delta' | 'activity'
  threadId: string
  turnId: string
  delta?: string
  toolName?: string
  active?: boolean
}

export class CodexToolBridge {
  private readonly events = new EventEmitter()
  private readonly conversationsByThread = new Map<string, string>()
  private readonly executions = new Map<string, MuseToolExecutionContext>()
  private dynamicToolsSupported = true
  private unavailableReason: string | null = null

  constructor(private readonly manager: CodexAppServerManager, private readonly registry: MuseToolRegistry) {
    this.manager.setServerRequestHandler((message) => this.handleServerRequest(message))
    this.manager.onProtocolMessage((message) => this.handleNotification(message))
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void { this.events.on('event', listener); return () => this.events.off('event', listener) }

  capabilities(connected: boolean): MuseAgentCapabilities {
    return { connected, runtimeVersion: this.manager.getRuntimeVersion(), dynamicTools: connected && this.dynamicToolsSupported,
      toolProtocol: connected && this.dynamicToolsSupported ? 'dynamic-tools-experimental' : 'unavailable', unavailableReason: this.unavailableReason }
  }

  async startThread(input: BridgeThreadInput): Promise<{ threadId: string; toolsEnabled: boolean }> {
    try {
      const result = await this.manager.protocolRequest<{ thread: { id: string } }>('thread/start', this.threadParams(input, true), 30_000)
      this.dynamicToolsSupported = true; this.unavailableReason = null
      return { threadId: result.thread.id, toolsEnabled: true }
    } catch (error) {
      this.dynamicToolsSupported = false
      this.unavailableReason = `当前 Codex Runtime 暂不支持 Muse 操作工具：${error instanceof Error ? error.message : String(error)}`
      const result = await this.manager.protocolRequest<{ thread: { id: string } }>('thread/start', this.threadParams(input, false), 30_000)
      return { threadId: result.thread.id, toolsEnabled: false }
    }
  }

  async resumeThread(threadId: string, input: BridgeThreadInput): Promise<void> {
    await this.manager.protocolRequest('thread/resume', {
      threadId, model: input.modelId, cwd: input.workspacePath, approvalPolicy: 'never', sandbox: 'read-only',
      baseInstructions: MUSE_AGENT_INSTRUCTIONS, developerInstructions: this.developerInstructions(),
      config: museAgentFeatureConfig()
    }, 30_000)
  }

  async runTurn(input: BridgeTurnInput): Promise<BridgeTurnOutput> {
    this.conversationsByThread.set(input.threadId, input.conversationId)
    const response = await this.manager.protocolRequest<{ turn: { id: string } }>('turn/start', {
      threadId: input.threadId,
      input: [{ type: 'text', text: `${input.contextText}\n\n用户请求：${input.text}`, text_elements: [] }],
      cwd: undefined,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: input.modelId,
      effort: 'low',
      summary: 'none'
    }, 15_000)
    const turnId = response.turn.id
    input.onStarted?.(turnId)
    this.executions.set(turnId, { conversationId: input.conversationId, threadId: input.threadId, turnId, signal: input.signal })
    const abort = (): void => { void this.manager.protocolRequest('turn/interrupt', { threadId: input.threadId, turnId }).catch(() => undefined) }
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
      const completion = await this.manager.waitForProtocolTurn(turnId, input.signal)
      return { turnId, text: this.manager.protocolAgentMessage(turnId), status: completion.status }
    } finally {
      input.signal?.removeEventListener('abort', abort)
      this.executions.delete(turnId)
      this.manager.clearProtocolTurn(turnId)
    }
  }

  interrupt(threadId: string, turnId: string): Promise<unknown> {
    return this.manager.protocolRequest('turn/interrupt', { threadId, turnId })
  }

  private threadParams(input: BridgeThreadInput, withTools: boolean): object {
    return {
      model: input.modelId, cwd: input.workspacePath, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false,
      environments: [], serviceName: 'muse_visual_library_agent', baseInstructions: MUSE_AGENT_INSTRUCTIONS,
      developerInstructions: this.developerInstructions(), config: museAgentFeatureConfig(),
      ...(withTools ? { dynamicTools: this.registry.specs().map((tool) => ({ type: 'function', name: `muse_${tool.name}`, description: tool.description, inputSchema: tool.inputSchema, deferLoading: false })) } : {})
    }
  }

  private developerInstructions(): string {
    return this.dynamicToolsSupported ? 'Use only tools whose names start with muse_ for application tasks. Do not use shell, files, source code, browser, apps, or coding tools.' :
      'Muse operation tools are unavailable in this runtime. Do not guess library facts or claim to have changed anything; explain the capability limitation.'
  }

  private async handleServerRequest(message: CodexProtocolMessage): Promise<unknown> {
    if (message.method !== 'item/tool/call') throw new Error(`Unsupported Codex server request: ${message.method}`)
    const params = message.params ?? {}, namespace = typeof params.namespace === 'string' ? params.namespace : null
    const rawTool = String(params.tool ?? '')
    if (namespace && namespace !== 'muse') throw new Error('Only the Muse dynamic tool namespace is allowed')
    if (!namespace && !rawTool.startsWith('muse_')) throw new Error('Only Muse dynamic tools are allowed')
    const turnId = String(params.turnId ?? ''), execution = this.executions.get(turnId)
    if (!execution) throw new Error('No active Muse Agent turn for this tool call')
    const result = await this.registry.execute(namespace ? rawTool : rawTool.slice('muse_'.length), params.arguments, execution)
    return { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success: result.success }
  }

  private handleNotification(message: CodexProtocolMessage): void {
    const params = message.params ?? {}, threadId = String(params.threadId ?? ''), turnId = String(params.turnId ?? '')
    if (message.method === 'item/agentMessage/delta' && threadId && turnId) {
      this.events.emit('event', { type: 'delta', threadId, turnId, delta: String(params.delta ?? '') } satisfies BridgeEvent)
    }
  }
}

function museAgentFeatureConfig(): object {
  // Dynamic Tools execute through the official code-mode host. Keep that host
  // enabled while removing every non-Muse runtime capability from the model.
  return { features: {
    code_mode_host: true,
    shell_tool: false,
    apps: false,
    browser_use: false,
    computer_use: false,
    image_generation: false,
    plugins: false,
    multi_agent: false,
    multi_agent_v2: false,
    skill_search: false,
    workspace_dependencies: false
  } }
}
