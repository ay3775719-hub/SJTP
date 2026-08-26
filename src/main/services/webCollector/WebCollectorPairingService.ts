import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nanoid } from 'nanoid'
import type { WebCollectorPairingRequest } from '@shared/types/domain'
import type { WebCollectorRepository } from '../../database/repositories/WebCollectorRepository'

interface PendingPairing {
  request: WebCollectorPairingRequest
  resolve: (token: string | null) => void
  timer: NodeJS.Timeout
  notificationTimer: NodeJS.Timeout
}

export class WebCollectorPairingService {
  private readonly events = new EventEmitter()
  private readonly pending = new Map<string, PendingPairing>()
  constructor(private readonly repository: WebCollectorRepository) {}

  request(extensionId: string, browserName: string, extensionVersion: string): Promise<string | null> {
    const existing = [...this.pending.values()].find((item) => item.request.extensionId === extensionId)
    if (existing) return new Promise((resolve) => {
      const listener = (request: WebCollectorPairingRequest, token: string | null): void => { if (request.id === existing.request.id) { this.events.off('resolved', listener); resolve(token) } }
      this.events.on('resolved', listener)
    })
    const request: WebCollectorPairingRequest = { id: nanoid(16), extensionId, browserName, extensionVersion, requestedAt: new Date().toISOString() }
    return new Promise((resolve) => {
      const notificationTimer = setInterval(() => {
        if (this.pending.has(request.id)) this.events.emit('request', request)
        else clearInterval(notificationTimer)
      }, 1_000)
      const timer = setTimeout(() => {
        clearInterval(notificationTimer)
        this.pending.delete(request.id)
        resolve(null)
        this.events.emit('resolved', request, null)
      }, 120_000)
      this.pending.set(request.id, { request, resolve, timer, notificationTimer })
      this.events.emit('request', request)
    })
  }

  resolve(id: string, approved: boolean): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    clearTimeout(pending.timer); clearInterval(pending.notificationTimer); this.pending.delete(id)
    const token = approved ? randomBytes(32).toString('base64url') : null
    if (token) this.repository.savePairing(pending.request.extensionId, pending.request.browserName, token)
    pending.resolve(token); this.events.emit('resolved', pending.request, token)
    return true
  }

  onRequest(listener: (request: WebCollectorPairingRequest) => void): () => void {
    this.events.on('request', listener)
    return () => this.events.off('request', listener)
  }
}
