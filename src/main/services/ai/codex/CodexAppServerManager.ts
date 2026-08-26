import { EventEmitter } from 'node:events'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import type { AIModelInfo, CodexAccountState, CodexLoginStartResult, CodexUsageState } from '@shared/types/domain'
import { MuseError } from '../../../errors'
import { logger, serializeError } from '../../../logger'

interface RpcResponse { id: number; result?: unknown; error?: { code: number; message: string; data?: unknown } }
interface RpcNotification { method: string; params?: Record<string, unknown>; id?: number }
interface PendingRequest { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
interface TurnCompletion { status: string; error?: { message?: string; codexErrorInfo?: unknown } | null }
export interface CodexProtocolMessage { method: string; params?: Record<string, unknown>; id?: number }
export type CodexServerRequestHandler = (message: CodexProtocolMessage) => Promise<unknown>

export interface CodexManagerOptions {
  userDataPath: string
  resourcesPath: string
  projectRoot?: string
}

export interface CodexBatchTurnInput {
  modelId: string
  effort: 'low' | 'medium'
  workspacePath: string
  baseInstructions: string
  prompt: string
  images: Array<{ assetId: string; path: string }>
  outputSchema: object
  signal?: AbortSignal
}

export interface CodexBatchTurnOutput {
  threadId: string
  turnId: string
  modelId: string
  text: string
  durationMs: number
}

export interface CodexStructuredTextTurnInput {
  modelId: string
  effort: 'low' | 'medium'
  workspacePath: string
  baseInstructions: string
  prompt: string
  outputSchema: object
  signal?: AbortSignal
}

export class CodexAppServerManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private requestId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly events = new EventEmitter()
  private readonly agentMessages = new Map<string, string>()
  private readonly completedTurns = new Map<string, TurnCompletion>()
  private readonly turnWaiters = new Map<string, { resolve(value: TurnCompletion): void; reject(error: Error): void }>()
  private starting: Promise<void> | null = null
  private runtimeVersion: string | null = null
  private shuttingDown = false
  private serverRequestHandler: CodexServerRequestHandler | null = null

  constructor(private readonly options: CodexManagerOptions) {}

  onChanged(listener: () => void): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  onProtocolMessage(listener: (message: CodexProtocolMessage) => void): () => void {
    this.events.on('protocol-message', listener)
    return () => this.events.off('protocol-message', listener)
  }

  setServerRequestHandler(handler: CodexServerRequestHandler | null): void { this.serverRequestHandler = handler }

  async protocolRequest<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    await this.ensureStarted()
    return this.request<T>(method, params, timeoutMs)
  }

  waitForProtocolTurn(turnId: string, signal?: AbortSignal): Promise<TurnCompletion> { return this.waitForTurn(turnId, signal) }
  protocolAgentMessage(turnId: string): string { return this.agentMessages.get(turnId)?.trim() ?? '' }
  clearProtocolTurn(turnId: string): void { this.agentMessages.delete(turnId); this.completedTurns.delete(turnId) }
  getRuntimeVersion(): string | null { return this.runtimeVersion }

  async account(): Promise<CodexAccountState> {
    await this.ensureStarted()
    const result = await this.request<{ account: null | { type: string; email?: string | null; planType?: string | null } }>('account/read', { refreshToken: false })
    const account = result.account
    return {
      connected: account?.type === 'chatgpt',
      email: account?.email ?? null,
      planType: account?.planType ?? null,
      authMode: account?.type === 'chatgpt' ? 'chatgpt' : account?.type === 'apiKey' ? 'apiKey' : null,
      runtimeVersion: this.runtimeVersion
    }
  }

  async startLogin(deviceCode = false): Promise<CodexLoginStartResult> {
    await this.ensureStarted()
    return this.request<CodexLoginStartResult>('account/login/start', deviceCode
      ? { type: 'chatgptDeviceCode' }
      : { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' })
  }

  async logout(): Promise<void> {
    await this.ensureStarted()
    await this.request('account/logout')
  }

  async listModels(): Promise<AIModelInfo[]> {
    await this.ensureStarted()
    const result = await this.request<{ data: Array<Record<string, unknown>> }>('model/list', { limit: 100, includeHidden: false })
    return result.data
      .filter((model) => ((model.inputModalities as string[] | undefined) ?? ['text', 'image']).includes('image'))
      .map((model) => ({
        id: String(model.id),
        name: String(model.displayName ?? model.id),
        providerId: 'codex-chatgpt' as const,
        capabilities: { vision: true, structuredOutput: true, text: true, local: false },
        capabilitySource: 'reported' as const,
        isDefault: Boolean(model.isDefault),
        defaultReasoningEffort: String(model.defaultReasoningEffort ?? 'low'),
        supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts.map((item) => String((item as Record<string, unknown>).reasoningEffort))
          : []
      })) as AIModelInfo[]
  }

  async usage(): Promise<CodexUsageState> {
    await this.ensureStarted()
    const result = await this.request<{ rateLimits: Record<string, unknown> }>('account/rateLimits/read')
    const limits = result.rateLimits
    const window = (value: unknown) => {
      if (!value || typeof value !== 'object') return null
      const row = value as Record<string, unknown>
      return { usedPercent: Number(row.usedPercent ?? 0), windowDurationMins: numberOrNull(row.windowDurationMins), resetsAt: numberOrNull(row.resetsAt) }
    }
    return {
      limitReached: Boolean(limits.rateLimitReachedType) || Boolean(limits.spendControlReached),
      reachedType: typeof limits.rateLimitReachedType === 'string' ? limits.rateLimitReachedType : null,
      primary: window(limits.primary),
      secondary: window(limits.secondary)
    }
  }

  async runBatchTurn(input: CodexBatchTurnInput): Promise<CodexBatchTurnOutput> {
    const account = await this.account()
    if (!account.connected) throw new MuseError('CODEX_AUTH_REQUIRED', 'Codex 登录已失效，请重新使用 ChatGPT 登录')
    const usage = await this.usage()
    if (usage.limitReached) throw new MuseError('CODEX_USAGE_LIMIT', 'Codex 当前使用额度已达到限制')
    await mkdir(input.workspacePath, { recursive: true })
    const startedAt = Date.now()
    const thread = await this.request<{ thread: { id: string }; model: string }>('thread/start', {
      model: input.modelId,
      cwd: input.workspacePath,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      baseInstructions: input.baseInstructions,
      developerInstructions: 'Only classify the supplied localImage inputs. Do not use tools, shell commands, file search, or code operations.'
    })
    const threadId = thread.thread.id
    const userInput: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt, text_elements: [] }]
    input.images.forEach((image) => {
      userInput.push({ type: 'text', text: `assetId=${image.assetId}`, text_elements: [] })
      userInput.push({ type: 'localImage', path: image.path, detail: 'high' })
    })
    let turnId: string | null = null
    const abort = (): void => {
      if (turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
      const turn = await this.request<{ turn: { id: string } }>('turn/start', {
        threadId,
        input: userInput,
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: input.modelId,
        effort: input.effort,
        summary: 'none',
        outputSchema: input.outputSchema
      }, 15_000)
      turnId = turn.turn.id
      const completion = await this.waitForTurn(turnId, input.signal)
      if (completion.status !== 'completed') {
        throw this.turnError(completion)
      }
      const text = this.agentMessages.get(turnId)?.trim()
      if (!text) throw new MuseError('AI_INVALID_RESPONSE', 'Codex 未返回结构化识别结果')
      return { threadId, turnId, modelId: thread.model || input.modelId, text, durationMs: Date.now() - startedAt }
    } finally {
      input.signal?.removeEventListener('abort', abort)
      await this.request('thread/archive', { threadId }).catch(() => undefined)
      if (turnId) { this.agentMessages.delete(turnId); this.completedTurns.delete(turnId) }
    }
  }

  async runStructuredTextTurn(input: CodexStructuredTextTurnInput): Promise<CodexBatchTurnOutput> {
    const account = await this.account()
    if (!account.connected) throw new MuseError('CODEX_AUTH_REQUIRED', 'Codex 登录已失效，请重新使用 ChatGPT 登录')
    const usage = await this.usage()
    if (usage.limitReached) throw new MuseError('CODEX_USAGE_LIMIT', 'Codex 当前使用额度已达到限制')
    await mkdir(input.workspacePath, { recursive: true })
    const startedAt = Date.now()
    const thread = await this.request<{ thread: { id: string }; model: string }>('thread/start', {
      model: input.modelId, cwd: input.workspacePath, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      baseInstructions: input.baseInstructions,
      developerInstructions: 'Parse only the supplied search sentence. Do not use tools, shell commands, files, source code, or databases.'
    })
    const threadId = thread.thread.id
    let turnId: string | null = null
    const abort = (): void => { if (turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined) }
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
      const turn = await this.request<{ turn: { id: string } }>('turn/start', {
        threadId,
        input: [{ type: 'text', text: input.prompt, text_elements: [] }],
        cwd: input.workspacePath, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: input.modelId, effort: input.effort, summary: 'none', outputSchema: input.outputSchema
      }, 15_000)
      turnId = turn.turn.id
      const completion = await this.waitForTurn(turnId, input.signal)
      if (completion.status !== 'completed') throw this.turnError(completion)
      const text = this.agentMessages.get(turnId)?.trim()
      if (!text) throw new MuseError('AI_INVALID_RESPONSE', 'Codex 未返回结构化搜索条件')
      return { threadId, turnId, modelId: thread.model || input.modelId, text, durationMs: Date.now() - startedAt }
    } finally {
      input.signal?.removeEventListener('abort', abort)
      await this.request('thread/archive', { threadId }).catch(() => undefined)
      if (turnId) { this.agentMessages.delete(turnId); this.completedTurns.delete(turnId) }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    // Let short account/rate-limit requests already in flight finish before the
    // stdio process is terminated. Electron's before-quit hook can otherwise
    // race the renderer's final settings refresh and report a normal shutdown
    // as an App Server crash.
    const settleDeadline = Date.now() + 750
    while (this.pending.size > 0 && Date.now() < settleDeadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    }
    const child = this.process
    this.process = null
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
      child.kill()
      await Promise.race([exited, new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 3_000))])
    }
    this.rejectAll(new Error('Codex App Server stopped'))
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && !this.process.killed) return
    this.starting ??= this.start().finally(() => { this.starting = null })
    return this.starting
  }

  private async start(): Promise<void> {
    const binary = await resolveCodexBinary(this.options)
    this.shuttingDown = false
    this.process = spawn(binary, ['app-server', '--stdio'], {
      cwd: this.options.userDataPath,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    createInterface({ input: this.process.stdout }).on('line', (line) => this.handleLine(line))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk) => logger.debug('Codex App Server', { message: String(chunk).trim() }))
    this.process.once('exit', (code, signal) => {
      const unexpected = !this.shuttingDown
      this.process = null
      this.rejectAll(new MuseError('CODEX_APP_SERVER_CRASH', `Codex App Server 已退出 (${code ?? signal ?? 'unknown'})`))
      if (unexpected) { logger.error('Codex App Server exited', { code, signal }); this.events.emit('changed') }
    })
    const initialized = await this.request<{ userAgent?: string }>('initialize', {
      clientInfo: { name: 'muse_visual_library', title: 'Muse', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    })
    this.write({ method: 'initialized', params: {} })
    this.runtimeVersion = initialized.userAgent?.match(/(?:Codex Desktop|codex(?:-cli|_cli_rs)?)[\s\/]v?([^\s/]+)/i)?.[1] ?? initialized.userAgent ?? null
  }

  private handleLine(line: string): void {
    let message: RpcResponse & RpcNotification
    try { message = JSON.parse(line) as RpcResponse & RpcNotification }
    catch (error) { logger.warn('Invalid Codex App Server JSONL', serializeError(error)); return }
    if (typeof message.id === 'number' && (message.result !== undefined || message.error)) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      clearTimeout(waiter.timer); this.pending.delete(message.id)
      if (message.error) waiter.reject(new MuseError('CODEX_RPC_ERROR', message.error.message))
      else waiter.resolve(message.result)
      return
    }
    if (message.method === 'item/completed') {
      const params = message.params ?? {}
      const turnId = String(params.turnId ?? '')
      const item = params.item as Record<string, unknown> | undefined
      if (turnId && item?.type === 'agentMessage') this.agentMessages.set(turnId, String(item.text ?? ''))
    } else if (message.method === 'turn/completed') {
      const turn = (message.params?.turn ?? {}) as Record<string, unknown>
      const turnId = String(turn.id ?? '')
      const completion = { status: String(turn.status ?? 'failed'), error: turn.error as TurnCompletion['error'] }
      const waiter = this.turnWaiters.get(turnId)
      if (waiter) { this.turnWaiters.delete(turnId); waiter.resolve(completion) }
      else this.completedTurns.set(turnId, completion)
    } else if (message.method === 'account/updated' || message.method === 'account/login/completed' || message.method === 'account/rateLimits/updated') {
      this.events.emit('changed')
    }
    if (message.method) this.events.emit('protocol-message', { method: message.method, params: message.params, id: message.id } satisfies CodexProtocolMessage)
    if (typeof message.id === 'number' && message.method) {
      if (!this.serverRequestHandler) {
        this.write({ id: message.id, error: { code: -32601, message: 'Muse client does not expose this server-requested tool' } })
        return
      }
      void this.serverRequestHandler({ method: message.method, params: message.params, id: message.id }).then(
        (result) => this.write({ id: message.id, result }),
        (error) => this.write({ id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
      )
    }
  }

  private request<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.shuttingDown) return Promise.reject(new MuseError('CODEX_APP_SERVER_UNAVAILABLE', 'Muse is shutting down the Codex App Server'))
    if (!this.process?.stdin.writable) return Promise.reject(new MuseError('CODEX_APP_SERVER_UNAVAILABLE', 'Codex App Server 不可用'))
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const id = ++this.requestId
      const timer = setTimeout(() => { this.pending.delete(id); rejectRequest(new MuseError('CODEX_RPC_TIMEOUT', `${method} 超时`)) }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolveRequest(value as T), reject: rejectRequest, timer })
      this.write({ method, id, ...(params === undefined ? {} : { params }) })
    })
  }

  private write(message: unknown): void { this.process?.stdin.write(`${JSON.stringify(message)}\n`) }

  private waitForTurn(turnId: string, signal?: AbortSignal): Promise<TurnCompletion> {
    const completed = this.completedTurns.get(turnId)
    if (completed) return Promise.resolve(completed)
    return new Promise((resolveTurn, rejectTurn) => {
      const abort = (): void => { this.turnWaiters.delete(turnId); rejectTurn(new MuseError('AI_CANCELLED', 'Codex 图片识别已取消')) }
      signal?.addEventListener('abort', abort, { once: true })
      this.turnWaiters.set(turnId, {
        resolve: (value) => { signal?.removeEventListener('abort', abort); resolveTurn(value) },
        reject: (error) => { signal?.removeEventListener('abort', abort); rejectTurn(error) }
      })
    })
  }

  private turnError(completion: TurnCompletion): MuseError {
    const detail = JSON.stringify(completion.error?.codexErrorInfo ?? '')
    const message = completion.error?.message ?? `Codex turn ${completion.status}`
    if (/rate.?limit|usage.?limit|quota/i.test(`${message} ${detail}`)) return new MuseError('CODEX_USAGE_LIMIT', message)
    if (/auth|login|unauthorized/i.test(`${message} ${detail}`)) return new MuseError('CODEX_AUTH_REQUIRED', message)
    return new MuseError('AI_RETRYABLE', message)
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    this.pending.clear()
    for (const waiter of this.turnWaiters.values()) waiter.reject(error)
    this.turnWaiters.clear()
  }
}

async function resolveCodexBinary(options: CodexManagerOptions): Promise<string> {
  const explicit = process.env.MUSE_CODEX_BINARY?.trim()
  const candidates = [
    explicit,
    join(options.resourcesPath, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    process.platform === 'win32' ? join(process.env.USERPROFILE ?? '', '.codex', 'plugins', '.plugin-appserver', 'codex.exe') : null,
    options.projectRoot ? join(options.projectRoot, 'vendor', 'codex', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex') : null,
    options.projectRoot ? join(options.projectRoot, '.qa-codex.exe') : null
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) if (await runtimeIsComplete(candidate)) return candidate
  if (process.platform !== 'win32') return 'codex'

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const packagesRoot = join(programFiles, 'WindowsApps')
  let packages: string[] = []
  try { packages = await readdir(packagesRoot) } catch { /* handled below */ }
  const matches = packages.filter((name) => /^OpenAI\.Codex_.*_x64__2p2nqsd0c76g0$/i.test(name)).sort().reverse()
  for (const name of matches) {
    const source = join(packagesRoot, name, 'app', 'resources', 'codex.exe')
    if (!await runtimeIsComplete(source)) continue
    const destinationRoot = join(options.userDataPath, 'codex-runtime', name)
    const destination = join(destinationRoot, 'codex.exe')
    await mkdir(destinationRoot, { recursive: true })
    for (const executable of codexRuntimeExecutables()) {
      const sourceExecutable = join(dirname(source), executable)
      const destinationExecutable = join(destinationRoot, executable)
      if (await exists(sourceExecutable) && !await exists(destinationExecutable)) await copyFile(sourceExecutable, destinationExecutable)
    }
    return destination
  }
  throw new MuseError('CODEX_RUNTIME_MISSING', '未找到完整的官方 Codex App Server runtime，请安装或更新 Codex / ChatGPT Desktop')
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
async function runtimeIsComplete(binary: string): Promise<boolean> {
  if (!await exists(binary)) return false
  if (process.platform !== 'win32') return true
  return exists(join(dirname(binary), 'codex-code-mode-host.exe'))
}
function codexRuntimeExecutables(): string[] {
  return ['codex.exe', 'codex-code-mode-host.exe', 'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe']
}
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
