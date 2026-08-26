import { create } from 'zustand'
import type { MuseAgentApprovalRequest, MuseAgentConversation, MuseAgentEvent, MuseAgentMessage, MuseAgentState } from '@shared/types/domain'
import { museApi } from '../api/client'

interface MuseAgentStore {
  open: boolean
  initialized: boolean
  state: MuseAgentState | null
  conversations: MuseAgentConversation[]
  conversationId: string | null
  messages: MuseAgentMessage[]
  stream: string
  sending: boolean
  activity: string | null
  approval: MuseAgentApprovalRequest | null
  error: string | null
  initialize(): Promise<void>
  openPanel(): Promise<void>
  closePanel(): void
  newConversation(): Promise<void>
  selectConversation(id: string): Promise<void>
  send(text: string): Promise<void>
  stop(): Promise<void>
  resolveApproval(approved: boolean): Promise<void>
  login(deviceCode?: boolean): Promise<void>
}

let subscribed = false
const messageFor = (error: unknown): string => error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : String(error)

export const useMuseAgentStore = create<MuseAgentStore>((set, get) => ({
  open: false, initialized: false, state: null, conversations: [], conversationId: null,
  messages: [], stream: '', sending: false, activity: null, approval: null, error: null,
  initialize: async () => {
    if (!subscribed) {
      subscribed = true
      museApi.agent.onEvent((event) => handleEvent(event, set, get))
    }
    try {
      const [state, conversations] = await Promise.all([museApi.agent.state(), museApi.agent.conversations()])
      set({ state, conversations, initialized: true })
    } catch (error) { set({ initialized: true, error: messageFor(error) }) }
  },
  openPanel: async () => {
    set({ open: true })
    if (!get().initialized) await get().initialize()
    const current = get().conversationId ?? get().conversations[0]?.id
    if (current) await get().selectConversation(current)
    else await get().newConversation()
  },
  closePanel: () => set({ open: false }),
  newConversation: async () => {
    try {
      const conversation = await museApi.agent.createConversation()
      set((state) => ({ conversations: [conversation, ...state.conversations], conversationId: conversation.id, messages: [], stream: '', activity: null, approval: null, error: null }))
    } catch (error) { set({ error: messageFor(error) }) }
  },
  selectConversation: async (id) => {
    try {
      const messages = await museApi.agent.messages(id)
      set({ conversationId: id, messages, stream: '', activity: null, approval: null, error: null })
    } catch (error) { set({ error: messageFor(error) }) }
  },
  send: async (text) => {
    const value = text.trim(), conversationId = get().conversationId
    if (!value || !conversationId || get().sending) return
    set({ sending: true, stream: '', activity: '正在理解你的请求…', error: null })
    try {
      await museApi.agent.send(conversationId, value)
      const conversations = await museApi.agent.conversations()
      set({ conversations })
    } catch (error) { set({ sending: false, activity: null, error: messageFor(error) }) }
  },
  stop: async () => {
    const id = get().conversationId
    if (!id) return
    try { await museApi.agent.stop(id) } catch (error) { set({ error: messageFor(error) }) }
  },
  resolveApproval: async (approved) => {
    const request = get().approval
    if (!request) return
    try { await museApi.agent.resolveApproval(request.id, approved); set({ approval: null }) }
    catch (error) { set({ error: messageFor(error) }) }
  },
  login: async (deviceCode = false) => {
    try { await museApi.ai.codexLogin(deviceCode); set({ state: await museApi.agent.state(), error: null }) }
    catch (error) { set({ error: messageFor(error) }) }
  }
}))

function handleEvent(event: MuseAgentEvent, set: (partial: Partial<MuseAgentStore> | ((state: MuseAgentStore) => Partial<MuseAgentStore>)) => void, get: () => MuseAgentStore): void {
  if (event.type === 'state-changed') { void museApi.agent.state().then((state) => set({ state })).catch(() => undefined); return }
  if (event.type === 'approval-requested') { if (!event.request.conversationId || event.request.conversationId === get().conversationId) set({ approval: event.request }); return }
  if (event.type === 'approval-resolved') { if (get().approval?.id === event.requestId) set({ approval: null }); return }
  if (event.type === 'error') { if (!event.conversationId || event.conversationId === get().conversationId) set({ error: event.message }); return }
  if (event.conversationId !== get().conversationId) return
  if (event.type === 'message-delta') { set((state) => ({ stream: state.stream + event.delta, activity: null })); return }
  if (event.type === 'message-completed') {
    set((state) => ({ messages: state.messages.some((item) => item.id === event.message.id) ? state.messages : [...state.messages, event.message], stream: event.message.role === 'assistant' ? '' : state.stream }))
    return
  }
  if (event.type === 'activity') { set({ activity: event.active ? event.label : null }); return }
  if (event.type === 'turn-completed') { set({ sending: false, activity: null, stream: '' }); return }
}
