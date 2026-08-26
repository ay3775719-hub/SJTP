import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { WebCollectPayload, WebCollectorStatus } from '@shared/types/domain'
import type { WebCollectorRepository } from '../../database/repositories/WebCollectorRepository'
import { logger, serializeError } from '../../logger'
import { extensionIdFromOrigin, pairingRequestSchema, WEB_COLLECTOR_MAX_DOWNLOAD_BYTES, WEB_COLLECTOR_PORT, WEB_COLLECTOR_PROTOCOL_VERSION, webCollectEnvelopeSchema } from './WebCollectorProtocol'
import type { WebCollectorPairingService } from './WebCollectorPairingService'
import type { WebCollectorService } from './WebCollectorService'

export class WebCollectorBridge {
  private server: Server | null = null
  private readonly uploadTickets = new Map<string, { extensionId: string; requestId: string; payload: WebCollectPayload; expiresAt: number; timer: NodeJS.Timeout }>()
  constructor(private readonly repository: WebCollectorRepository, private readonly pairing: WebCollectorPairingService, private readonly collector: WebCollectorService) {}

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(WEB_COLLECTOR_PORT, '127.0.0.1', () => { this.server!.off('error', reject); resolve() })
    })
    logger.info('Web Collector bridge listening', { address: '127.0.0.1', port: WEB_COLLECTOR_PORT })
  }

  status(): WebCollectorStatus { return { running: Boolean(this.server?.listening), port: WEB_COLLECTOR_PORT, protocolVersion: WEB_COLLECTOR_PROTOCOL_VERSION, pairedBrowsers: this.repository.listPairings() } }
  revoke(extensionId: string): boolean { return this.repository.revoke(extensionId) }
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    for (const pending of this.uploadTickets.values()) clearTimeout(pending.timer)
    this.uploadTickets.clear()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin, extensionId = extensionIdFromOrigin(origin)
    if (!extensionId) return json(response, 403, { status: 'unauthorized' })
    cors(response, origin!)
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    try {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${WEB_COLLECTOR_PORT}`)
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const token = bearer(request), paired = token ? this.repository.authenticate(extensionId, token) : false
        return json(response, 200, { protocolVersion: WEB_COLLECTOR_PROTOCOL_VERSION, available: true, paired })
      }
      if (request.method === 'POST' && url.pathname === '/v1/pair') {
        const body = pairingRequestSchema.parse(await readJson(request))
        const token = await this.pairing.request(extensionId, body.browserName, body.extensionVersion)
        return token ? json(response, 200, { protocolVersion: WEB_COLLECTOR_PROTOCOL_VERSION, status: 'paired', token }) : json(response, 403, { status: 'rejected' })
      }
      if (request.method === 'POST' && url.pathname === '/v1/collect') {
        const token = bearer(request)
        if (!token || !this.repository.authenticate(extensionId, token)) return json(response, 401, { status: 'unauthorized' })
        const envelope = webCollectEnvelopeSchema.parse(await readJson(request))
        const existing = this.repository.getRequest(envelope.requestId, extensionId)
        if (existing) return json(response, 200, existing)
        if (!this.repository.beginRequest(envelope.requestId, extensionId)) return json(response, 409, { requestId: envelope.requestId, status: 'invalid_request' })
        const result = await this.collector.collect(envelope.requestId, envelope.payload)
        this.repository.completeRequest(extensionId, result)
        return json(response, result.status === 'saved' || result.status === 'existing_asset_source_added' || result.status === 'already_collected' ? 200 : 422, result)
      }
      if (request.method === 'POST' && url.pathname === '/v1/upload-ticket') {
        const token = bearer(request)
        if (!token || !this.repository.authenticate(extensionId, token)) return json(response, 401, { status: 'unauthorized' })
        const envelope = webCollectEnvelopeSchema.parse(await readJson(request))
        if (this.repository.getRequest(envelope.requestId, extensionId) || !this.repository.beginRequest(envelope.requestId, extensionId)) {
          return json(response, 409, { requestId: envelope.requestId, status: 'invalid_request' })
        }
        const ticket = randomBytes(32).toString('base64url')
        const timer = setTimeout(() => this.uploadTickets.delete(ticket), 60_000)
        timer.unref()
        this.uploadTickets.set(ticket, { extensionId, requestId: envelope.requestId, payload: envelope.payload, expiresAt: Date.now() + 60_000, timer })
        return json(response, 200, { protocolVersion: WEB_COLLECTOR_PROTOCOL_VERSION, ticket })
      }
      if (request.method === 'POST' && url.pathname.startsWith('/v1/upload/')) {
        const token = bearer(request)
        if (!token || !this.repository.authenticate(extensionId, token)) return json(response, 401, { status: 'unauthorized' })
        const ticket = decodeURIComponent(url.pathname.slice('/v1/upload/'.length))
        const pending = this.uploadTickets.get(ticket)
        if (!pending || pending.extensionId !== extensionId || pending.expiresAt < Date.now()) return json(response, 404, { status: 'invalid_request' })
        clearTimeout(pending.timer)
        this.uploadTickets.delete(ticket)
        try {
          const bytes = await readBuffer(request, WEB_COLLECTOR_MAX_DOWNLOAD_BYTES)
          const result = await this.collector.collectBrowserUpload(pending.requestId, pending.payload, bytes, String(request.headers['content-type'] ?? ''))
          this.repository.completeRequest(extensionId, result)
          return json(response, result.status === 'saved' || result.status === 'existing_asset_source_added' || result.status === 'already_collected' ? 200 : 422, result)
        } catch (error) {
          const result = { requestId: pending.requestId, status: 'invalid_request' as const, message: error instanceof Error ? error.message : '图片上传失败' }
          this.repository.completeRequest(extensionId, result)
          return json(response, 400, result)
        }
      }
      return json(response, 404, { status: 'invalid_request' })
    } catch (error) {
      logger.warn('Web Collector bridge request failed', { error: serializeError(error) })
      return json(response, 400, { status: 'invalid_request' })
    }
  }
}

function bearer(request: IncomingMessage): string | null {
  const value = request.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null
}

function cors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-muse-protocol-version')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [], max = 64 * 1024
  let size = 0
  for await (const chunk of request) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length; if (size > max) throw new Error('Request too large'); chunks.push(data) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function readBuffer(request: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > max) throw new Error('图片文件过大，未保存')
    chunks.push(data)
  }
  if (!size) throw new Error('浏览器返回了空图片')
  return Buffer.concat(chunks, size)
}

function json(response: ServerResponse, status: number, body: unknown): void { response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.writeHead(status); response.end(JSON.stringify(body)) }
