import { useEffect, useState } from 'react'
import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react'
import { useNoticeStore } from '../stores/useNoticeStore'

export function NoticeToast(): React.JSX.Element | null {
  const notice = useNoticeStore((state) => state.notice)
  const dismiss = useNoticeStore((state) => state.dismiss)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    setWorking(false)
    if (!notice || notice.durationMs <= 0) return
    const timer = window.setTimeout(() => dismiss(notice.id), notice.durationMs)
    return () => window.clearTimeout(timer)
  }, [notice?.id, notice?.durationMs, dismiss])

  if (!notice) return null
  const Icon = notice.tone === 'success' ? CheckCircle : notice.tone === 'error' ? WarningCircle : Info
  const runAction = async (): Promise<void> => {
    if (!notice.action || working) return
    setWorking(true)
    try { await notice.action(); dismiss(notice.id) }
    finally { setWorking(false) }
  }
  return <div className={`notice-toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
    <Icon size={18} weight={notice.tone === 'success' ? 'fill' : 'regular'} />
    <span><strong>{notice.message}</strong>{notice.detail && <small>{notice.detail}</small>}</span>
    {notice.action && <button type="button" className="notice-action" disabled={working} onClick={() => void runAction()}>{working ? '处理中…' : notice.actionLabel}</button>}
    <button type="button" className="notice-dismiss" aria-label="关闭提示" onClick={() => dismiss(notice.id)}><X size={14} /></button>
  </div>
}
