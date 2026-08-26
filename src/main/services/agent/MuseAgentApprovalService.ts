import { EventEmitter } from 'node:events'
import { nanoid } from 'nanoid'
import type { MuseAgentApprovalRequest } from '@shared/types/domain'
import { MuseError } from '../../errors'

interface ApprovalInput {
  conversationId: string | null
  threadId: string
  turnId: string
  toolName: string
  title: string
  summary: string
  targetCount: number
  details: Array<{ label: string; value: string }>
}

interface PendingApproval {
  request: MuseAgentApprovalRequest
  resolve(value: boolean): void
  timer: NodeJS.Timeout
}

export class MuseAgentApprovalService {
  private readonly events = new EventEmitter()
  private readonly pending = new Map<string, PendingApproval>()

  onRequested(listener: (request: MuseAgentApprovalRequest) => void): () => void {
    this.events.on('requested', listener)
    return () => this.events.off('requested', listener)
  }

  onResolved(listener: (requestId: string, approved: boolean) => void): () => void {
    this.events.on('resolved', listener)
    return () => this.events.off('resolved', listener)
  }

  request(input: ApprovalInput, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.reject(new MuseError('AI_CANCELLED', '当前 Muse AI 操作已取消'))
    const request: MuseAgentApprovalRequest = { id: nanoid(16), ...input, createdAt: new Date().toISOString() }
    return new Promise<boolean>((resolve, reject) => {
      const finish = (approved: boolean): void => {
        const current = this.pending.get(request.id)
        if (!current) return
        clearTimeout(current.timer); this.pending.delete(request.id); signal?.removeEventListener('abort', abort)
        this.events.emit('resolved', request.id, approved)
        resolve(approved)
      }
      const abort = (): void => { finish(false); reject(new MuseError('AI_CANCELLED', '当前 Muse AI 操作已取消')) }
      const timer = setTimeout(() => finish(false), 5 * 60_000)
      this.pending.set(request.id, { request, resolve: finish, timer })
      signal?.addEventListener('abort', abort, { once: true })
      this.events.emit('requested', request)
    })
  }

  resolve(requestId: string, approved: boolean): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    pending.resolve(approved)
    return true
  }

  cancelTurn(turnId: string): void {
    for (const pending of [...this.pending.values()]) if (pending.request.turnId === turnId) pending.resolve(false)
  }
}
