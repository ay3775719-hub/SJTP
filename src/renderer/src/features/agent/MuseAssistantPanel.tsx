import { useEffect, useRef, useState } from 'react'
import { ChatCircleDots, PaperPlaneTilt, Plus, ShieldCheck, SignIn, Stop, X } from '@phosphor-icons/react'
import { useMuseAgentStore } from '../../stores/useMuseAgentStore'

const suggestions = [
  '看看最近导入的图片',
  '找绿色的户外背包',
  '找和这张图相似的素材',
  '查看最近的视觉分组',
  '把这些图收藏起来'
]

export function MuseAssistantPanel(): React.JSX.Element | null {
  const open = useMuseAgentStore((state) => state.open)
  const close = useMuseAgentStore((state) => state.closePanel)
  const newConversation = useMuseAgentStore((state) => state.newConversation)
  const selectConversation = useMuseAgentStore((state) => state.selectConversation)
  const conversations = useMuseAgentStore((state) => state.conversations)
  const conversationId = useMuseAgentStore((state) => state.conversationId)
  const messages = useMuseAgentStore((state) => state.messages)
  const stream = useMuseAgentStore((state) => state.stream)
  const sending = useMuseAgentStore((state) => state.sending)
  const activity = useMuseAgentStore((state) => state.activity)
  const approval = useMuseAgentStore((state) => state.approval)
  const error = useMuseAgentStore((state) => state.error)
  const agentState = useMuseAgentStore((state) => state.state)
  const send = useMuseAgentStore((state) => state.send)
  const stop = useMuseAgentStore((state) => state.stop)
  const resolveApproval = useMuseAgentStore((state) => state.resolveApproval)
  const login = useMuseAgentStore((state) => state.login)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages, stream, activity, approval])
  if (!open) return null

  const submit = (): void => { const value = draft.trim(); if (!value) return; setDraft(''); void send(value) }
  const connected = agentState?.account.connected ?? false
  return (
    <div className="muse-agent-layer">
      <aside className="muse-agent-panel" aria-label="Muse AI">
        <header>
          <div><span className="muse-agent-logo"><ChatCircleDots size={19} weight="duotone" /></span><div><strong>Muse AI</strong><small>{connected ? 'Codex 已连接' : '需要 ChatGPT 登录'}</small></div></div>
          <div className="muse-agent-header-actions">
            <button onClick={() => void newConversation()} title="新对话"><Plus size={17} /></button>
            <button onClick={close} title="关闭 Muse AI"><X size={17} /></button>
          </div>
        </header>

        {conversations.length > 0 && <select className="muse-agent-conversations" value={conversationId ?? ''} onChange={(event) => void selectConversation(event.target.value)} aria-label="对话历史">
          {conversations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>}

        {!connected ? <div className="muse-agent-login">
          <SignIn size={25} />
          <h3>使用 ChatGPT 登录</h3>
          <p>Muse AI 复用官方 Codex 登录，不需要单独填写 OpenAI API Key。</p>
          <button className="primary" onClick={() => void login(false)}>使用浏览器登录</button>
          <button onClick={() => void login(true)}>使用设备代码登录</button>
        </div> : <>
          {!agentState?.capabilities.dynamicTools && <div className="muse-agent-capability-warning">当前 Codex Runtime 暂不支持 Muse 操作工具。对话仍然可用，但不会修改或导航素材库。</div>}
          <div className="muse-agent-messages" ref={scrollRef}>
            {messages.length === 0 && !stream && <div className="muse-agent-welcome">
              <ChatCircleDots size={30} weight="duotone" />
              <h2>有什么可以帮你整理的吗？</h2>
              <p>Muse AI 会通过现有工具读取真实素材库；需要修改状态时，会先请求你的确认。</p>
              <div>{suggestions.map((item) => <button key={item} onClick={() => setDraft(item)}>{item}</button>)}</div>
            </div>}
            {messages.map((message) => <article key={message.id} className={`muse-agent-message ${message.role}`}><span>{message.role === 'user' ? '你' : 'Muse AI'}</span><p>{message.content}</p></article>)}
            {stream && <article className="muse-agent-message assistant streaming"><span>Muse AI</span><p>{stream}</p></article>}
            {activity && <div className="muse-agent-activity"><i />{activity}</div>}
            {error && <div className="muse-agent-error">{error}</div>}
          </div>

          <footer>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="告诉 Muse AI 你想查找或整理什么…" rows={3} disabled={sending} />
            <div><small>读取自动允许 · 修改前需要确认</small>{sending ? <button className="muse-agent-stop" onClick={() => void stop()}><Stop size={15} weight="fill" />停止</button> : <button className="muse-agent-send" disabled={!draft.trim()} onClick={submit}><PaperPlaneTilt size={16} weight="fill" />发送</button>}</div>
          </footer>
        </>}

        {approval && <div className="muse-agent-approval-backdrop"><section className="muse-agent-approval">
          <ShieldCheck size={27} weight="duotone" />
          <h3>Muse AI 请求操作</h3>
          <strong>{approval.title}</strong>
          <p>{approval.summary}</p>
          {approval.targetCount > 0 && <b>目标数量：{approval.targetCount.toLocaleString('zh-CN')} 项</b>}
          <dl>{approval.details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          <footer><button onClick={() => void resolveApproval(false)}>拒绝</button><button className="primary" onClick={() => void resolveApproval(true)}>允许</button></footer>
        </section></div>}
      </aside>
    </div>
  )
}
