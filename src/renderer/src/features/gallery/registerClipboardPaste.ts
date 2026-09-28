export function registerClipboardPaste(importImage: () => Promise<void>): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    const target = event.target
    if (event.defaultPrevented || (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')))) return
    event.preventDefault()
    void importImage()
  }
  window.addEventListener('paste', onPaste)
  return () => window.removeEventListener('paste', onPaste)
}
