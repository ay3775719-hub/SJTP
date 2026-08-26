import { create } from 'zustand'

export type NoticeTone = 'info' | 'success' | 'error'

export interface MuseNotice {
  id: number
  message: string
  detail?: string
  tone: NoticeTone
  durationMs: number
  actionLabel?: string
  action?: () => void | Promise<void>
}

interface NoticeState {
  notice: MuseNotice | null
  show(input: Omit<MuseNotice, 'id' | 'durationMs'> & { durationMs?: number }): void
  dismiss(id?: number): void
}

let nextNoticeId = 1

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notice: null,
  show: (input) => set({ notice: { ...input, id: nextNoticeId++, durationMs: input.durationMs ?? (input.action ? 8_000 : 4_000) } }),
  dismiss: (id) => {
    const current = get().notice
    if (!current || (id !== undefined && current.id !== id)) return
    set({ notice: null })
  }
}))

export function showNotice(message: string, tone: NoticeTone = 'info', detail?: string): void {
  useNoticeStore.getState().show({ message, tone, detail })
}
