import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showNotice, useNoticeStore } from './useNoticeStore'

describe('notice store', () => {
  beforeEach(() => useNoticeStore.setState({ notice: null }))

  it('shows a short informational notice and dismisses only the matching id', () => {
    showNotice('已完成', 'success')
    const first = useNoticeStore.getState().notice
    expect(first).toMatchObject({ message: '已完成', tone: 'success', durationMs: 4_000 })
    useNoticeStore.getState().dismiss((first?.id ?? 0) + 1)
    expect(useNoticeStore.getState().notice?.id).toBe(first?.id)
    useNoticeStore.getState().dismiss(first?.id)
    expect(useNoticeStore.getState().notice).toBeNull()
  })

  it('keeps undo notices visible longer and preserves the action', async () => {
    const action = vi.fn()
    useNoticeStore.getState().show({ message: '已移动', tone: 'success', actionLabel: '撤销', action })
    const notice = useNoticeStore.getState().notice
    expect(notice?.durationMs).toBe(8_000)
    await notice?.action?.()
    expect(action).toHaveBeenCalledOnce()
  })
})
