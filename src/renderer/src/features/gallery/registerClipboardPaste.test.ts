// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { registerClipboardPaste } from './registerClipboardPaste'

describe('paste image shortcut scope', () => {
  it('imports from the Gallery and releases its listener when unmounted', () => {
    const importImage = vi.fn(async () => undefined)
    const cleanup = registerClipboardPaste(importImage)
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(importImage).toHaveBeenCalledTimes(1)
    } finally { cleanup() }
    document.body.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
    expect(importImage).toHaveBeenCalledTimes(1)
  })

  it('preserves normal paste into text inputs and editable content', () => {
    const importImage = vi.fn(async () => undefined)
    const cleanup = registerClipboardPaste(importImage)
    const container = document.createElement('div')
    container.innerHTML = '<input><textarea></textarea><div contenteditable="true"><span>editor</span></div><div contenteditable="plaintext-only">editor</div>'
    document.body.append(container)
    try {
      for (const element of container.querySelectorAll('input, textarea, span, [contenteditable="plaintext-only"]')) {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        element.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      expect(importImage).not.toHaveBeenCalled()
    } finally { cleanup(); container.remove() }
  })
})
