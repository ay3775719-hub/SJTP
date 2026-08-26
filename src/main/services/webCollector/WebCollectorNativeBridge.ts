import { createServer, type Server, type Socket } from 'node:net'
import { z } from 'zod'
import type { WebCollectorRepository } from '../../database/repositories/WebCollectorRepository'
import { logger, serializeError } from '../../logger'
import { webCollectEnvelopeSchema } from './WebCollectorProtocol'
import type { WebCollectorService } from './WebCollectorService'

function nativePipeName(): string {
  const user = (process.env.USERNAME || process.env.USER || 'user').replace(/[^a-zA-Z0-9_.-]/g, '_')
  return `\\\\.\\pipe\\MuseWebCollector-v1-${user}`
}

const requestSchema = z.object({
  extensionId: z.literal('pammmlffogkfhnapajdjgelkkcpiijll')
}).and(z.union([
  z.object({ type: z.literal('status') }),
  webCollectEnvelopeSchema
]))

export class WebCollectorNativeBridge {
  private server: Server | null = null
  constructor(private readonly repository: WebCollectorRepository, private readonly collector: WebCollectorService) {}

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((socket) => this.handleSocket(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(nativePipeName(), () => { this.server!.off('error', reject); resolve() })
    })
    logger.info('Web Collector native bridge listening')
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private handleSocket(socket: Socket): void {
    const chunks: Buffer[] = []
    let expected: number | null = null
    socket.setTimeout(20_000)
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      const data = Buffer.concat(chunks)
      if (expected === null && data.length >= 4) expected = data.readUInt32LE(0)
      if (expected === null || data.length < expected + 4) return
      void this.handleMessage(data.subarray(4, expected + 4)).then((result) => { socket.end(frame(result)) }, (error) => {
        logger.warn('Web Collector native request failed', { error: serializeError(error) })
        socket.end(frame({ status: 'invalid_request' }))
      })
    })
    socket.once('timeout', () => socket.destroy())
  }

  private async handleMessage(data: Buffer): Promise<unknown> {
    const request = requestSchema.parse(JSON.parse(data.toString('utf8')))
    if (request.type === 'status') return { protocolVersion: 1, available: true, paired: true }
    const existing = this.repository.getRequest(request.requestId, request.extensionId)
    if (existing) return existing
    if (!this.repository.beginRequest(request.requestId, request.extensionId)) return { requestId: request.requestId, status: 'invalid_request' }
    const result = await this.collector.collect(request.requestId, request.payload)
    this.repository.completeRequest(request.extensionId, result)
    return result
  }
}

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}
