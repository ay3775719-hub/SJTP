const ACTION_ID = 'muse-web-collector-image-action'
const CONTEXT_TTL_MS = 15000
const ACTION_WIDTH = 124
const ACTION_HEIGHT = 42
const HOVER_RESOLVE_INTERVAL_MS = 90
const HOVER_INTENT_DELAY_MS = 1200
let lastContextImage = null
let lastContextAt = 0
let lastHoverResolveAt = 0
let lastPointerX = -1
let lastPointerY = -1
let hideActionTimer = null
let hoverIntentTimer = null
let hoverIntent = null

document.addEventListener('pointermove', (event) => {
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  if (event.target instanceof Element && event.target.closest(`#${ACTION_ID}`)) {
    cancelHoverIntent()
    cancelHideAction()
    return
  }
  const now = Date.now()
  if (now - lastHoverResolveAt < HOVER_RESOLVE_INTERVAL_MS) return
  lastHoverResolveAt = now
  const resolved = resolveImageAt(event.target, event.clientX, event.clientY, false)
  if (!resolved || !isHoverableRect(resolved.anchorRect)) {
    cancelHoverIntent()
    scheduleHideAction()
    return
  }
  cancelHideAction()
  const current = document.getElementById(ACTION_ID)
  if (current?.dataset.imageUrl === resolved.payload.imageUrl) {
    cancelHoverIntent()
    return
  }
  if (current) removeAction()
  scheduleHoverIntent(event.clientX, event.clientY, resolved)
}, { capture: true, passive: true })

document.addEventListener('pointerleave', () => { cancelHoverIntent(); scheduleHideAction() }, { capture: true, passive: true })
document.addEventListener('mouseout', (event) => {
  if (!event.relatedTarget) { cancelHoverIntent(); scheduleHideAction() }
}, { capture: true, passive: true })
window.addEventListener('blur', () => { cancelHoverIntent(); removeAction() })

document.addEventListener('contextmenu', (event) => {
  const resolved = resolveImageAt(event.target, event.clientX, event.clientY)
  lastContextImage = resolved?.payload || null
  lastContextAt = Date.now()
  cancelHoverIntent()
  removeAction()
  if (!resolved) return

  // Many image sites replace Chrome's context menu with their own DOM menu.
  // Keep that menu intact and place Muse in the image corner, away from the
  // pointer where browser/site menus normally open.
  setTimeout(() => showAction(event.clientX, event.clientY, resolved.payload, resolved.anchorRect), 0)
}, { capture: true })

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'get_last_context_image') return
  const fresh = lastContextImage && Date.now() - lastContextAt <= CONTEXT_TTL_MS
  sendResponse({ payload: fresh ? lastContextImage : null })
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { cancelHoverIntent(); removeAction() }
}, { capture: true })
document.addEventListener('scroll', () => { cancelHoverIntent(); removeAction() }, { capture: true, passive: true })

function scheduleHoverIntent(x, y, resolved) {
  const imageUrl = resolved.payload.imageUrl
  if (hoverIntent?.imageUrl === imageUrl) {
    hoverIntent = { imageUrl, x, y, payload: resolved.payload, anchorRect: resolved.anchorRect }
    return
  }
  cancelHoverIntent()
  hoverIntent = { imageUrl, x, y, payload: resolved.payload, anchorRect: resolved.anchorRect }
  hoverIntentTimer = setTimeout(() => {
    const pending = hoverIntent
    hoverIntentTimer = null
    hoverIntent = null
    if (!pending) return
    const target = document.elementFromPoint(lastPointerX, lastPointerY)
    const confirmed = resolveImageAt(target, lastPointerX, lastPointerY, false)
    if (!confirmed || confirmed.payload.imageUrl !== pending.imageUrl || !isHoverableRect(confirmed.anchorRect)) return
    showAction(lastPointerX, lastPointerY, confirmed.payload, confirmed.anchorRect)
  }, HOVER_INTENT_DELAY_MS)
}

function cancelHoverIntent() {
  if (hoverIntentTimer) clearTimeout(hoverIntentTimer)
  hoverIntentTimer = null
  hoverIntent = null
}

function resolveImageAt(node, clientX, clientY, allowBackground = true) {
  if (!(node instanceof Element)) return null

  const pointElements = Number.isFinite(clientX) && Number.isFinite(clientY)
    ? document.elementsFromPoint(clientX, clientY)
    : []
  const candidates = allowBackground
    ? uniqueElements([...pointElements, node])
    : uniqueElements(pointElements.filter((element) => element instanceof HTMLImageElement))
  let image = null

  for (const candidate of candidates) {
    image = imageFromElement(candidate, clientX, clientY)
    if (image && isUsableImage(image)) break
    image = null
  }

  // Overlay-heavy sites can omit the underlying image from elementsFromPoint.
  // Fall back to the visible document image whose rectangle contains the click.
  if (!image && allowBackground && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    image = [...document.images]
      .filter((candidate) => isUsableImage(candidate) && rectContainsPoint(candidate.getBoundingClientRect(), clientX, clientY))
      .sort((left, right) => rectArea(left.getBoundingClientRect()) - rectArea(right.getBoundingClientRect()))[0] || null
  }

  if (image) {
    const imageUrl = preferredCompatibleUrl(
      image.currentSrc,
      largestSrcsetUrl(image.srcset || image.getAttribute('data-srcset'), image),
      largestPictureSourceUrl(image),
      image.src,
      image.getAttribute('data-original'),
      image.getAttribute('data-src')
    )
    if (imageUrl) {
      return {
        payload: buildPayload(imageUrl, image.alt, image.naturalWidth, image.naturalHeight),
        anchorRect: snapshotRect(image.getBoundingClientRect())
      }
    }
  }

  if (allowBackground) {
    for (const candidate of candidates) {
      for (let current = candidate; current && current !== document.documentElement; current = current.parentElement) {
        const imageUrl = backgroundImageUrl(current)
        if (imageUrl) {
          return {
            payload: buildPayload(imageUrl, current.getAttribute('aria-label') || '', current.clientWidth, current.clientHeight),
            anchorRect: snapshotRect(current.getBoundingClientRect())
          }
        }
      }
    }
  }
  return null
}

function imageFromElement(element, clientX, clientY) {
  if (!(element instanceof Element)) return null
  if (element instanceof HTMLImageElement) return element
  const closestPictureImage = element.closest('picture')?.querySelector('img')
  if (closestPictureImage && pointMatchesImage(closestPictureImage, clientX, clientY)) return closestPictureImage
  const nestedImage = element.querySelector?.('img') || null
  return nestedImage && pointMatchesImage(nestedImage, clientX, clientY) ? nestedImage : null
}

function pointMatchesImage(image, clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return true
  return rectContainsPoint(image.getBoundingClientRect(), clientX, clientY)
}

function isUsableImage(image) {
  if (!(image instanceof HTMLImageElement)) return false
  const rect = image.getBoundingClientRect()
  const style = getComputedStyle(image)
  const opacity = Number.parseFloat(style.opacity || '1')
  return image.naturalWidth > 0 && image.naturalHeight > 0 && rect.width > 8 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden' && opacity > 0.05
}

function rectContainsPoint(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function rectArea(rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function uniqueElements(elements) {
  return [...new Set(elements.filter((element) => element instanceof Element))]
}

function snapshotRect(rect) {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
}

function isHoverableRect(rect) {
  return Boolean(rect && rect.width >= 80 && rect.height >= 80 && rect.width * rect.height >= 12000)
}

function buildPayload(imageUrl, altText, imageWidth, imageHeight) {
  return {
    imageUrl,
    pageUrl: location.href,
    pageTitle: document.title || undefined,
    siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || undefined,
    domain: location.hostname,
    altText: altText || undefined,
    imageWidth: positiveInteger(imageWidth),
    imageHeight: positiveInteger(imageHeight),
    collectedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version
  }
}

function showAction(x, y, payload, anchorRect) {
  removeAction()
  const position = actionPosition(x, y, anchorRect)
  const button = document.createElement('button')
  const mark = document.createElement('span')
  const label = document.createElement('span')
  button.id = ACTION_ID
  button.dataset.imageUrl = payload.imageUrl
  button.type = 'button'
  mark.textContent = '✦'
  label.textContent = 'Muse'
  button.title = '保存到 Muse'
  Object.assign(button.style, {
    all: 'initial',
    position: 'fixed',
    left: `${position.left}px`,
    top: `${position.top}px`,
    zIndex: '2147483647',
    boxSizing: 'border-box',
    width: `${ACTION_WIDTH}px`,
    height: `${ACTION_HEIGHT}px`,
    padding: '0 13px 0 8px',
    border: '1px solid rgba(169,183,255,.34)',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, rgba(22,25,38,.96), rgba(48,61,105,.96))',
    backdropFilter: 'blur(18px) saturate(145%)',
    WebkitBackdropFilter: 'blur(18px) saturate(145%)',
    color: '#fff',
    boxShadow: '0 12px 34px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(76,110,219,.08)',
    font: '600 13px system-ui, "Microsoft YaHei", sans-serif',
    textAlign: 'center',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    letterSpacing: '.1px',
    userSelect: 'none',
    transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease'
  })
  Object.assign(mark.style, {
    all: 'initial',
    width: '27px',
    height: '27px',
    flex: '0 0 27px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '9px',
    color: '#fff',
    background: 'linear-gradient(145deg, #7187ff, #8d63df)',
    boxShadow: '0 4px 12px rgba(92,111,221,.46), inset 0 1px 0 rgba(255,255,255,.28)',
    font: '700 14px system-ui'
  })
  Object.assign(label.style, {
    all: 'initial',
    color: '#f7f8ff',
    font: '600 13px system-ui, "Microsoft YaHei", sans-serif',
    whiteSpace: 'nowrap'
  })
  button.append(mark, label)
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-2px) scale(1.015)'
    button.style.borderColor = 'rgba(190,200,255,.62)'
    button.style.boxShadow = '0 15px 38px rgba(0,0,0,.44), 0 0 22px rgba(89,111,224,.22), inset 0 1px 0 rgba(255,255,255,.16)'
  })
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'none'
    button.style.borderColor = 'rgba(169,183,255,.34)'
    button.style.boxShadow = '0 12px 34px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(76,110,219,.08)'
  })
  button.addEventListener('contextmenu', (event) => event.preventDefault())
  button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    button.disabled = true
    mark.textContent = '·'
    label.textContent = '正在保存…'
    button.style.cursor = 'default'
    try {
      const result = await chrome.runtime.sendMessage({ type: 'collect_page_image', payload })
      mark.textContent = result?.ok ? '✓' : '!'
      label.textContent = compactResultMessage(result?.ok ? result.message : (result?.message || '保存失败'))
    } catch {
      mark.textContent = '!'
      label.textContent = '保存失败，请重试'
    }
    setTimeout(removeAction, 2400)
  }, { capture: true })
  document.documentElement.appendChild(button)
}

function actionPosition(x, y, anchorRect) {
  const width = ACTION_WIDTH
  const height = ACTION_HEIGHT
  const margin = 12
  if (anchorRect && anchorRect.width > width && anchorRect.height > height) {
    return {
      left: clamp(anchorRect.right - width - margin, margin, window.innerWidth - width - margin),
      top: clamp(anchorRect.top + margin, margin, window.innerHeight - height - margin)
    }
  }
  return {
    left: clamp(x >= width + margin * 2 ? x - width - margin : x + margin, margin, window.innerWidth - width - margin),
    top: clamp(y - height - margin, margin, window.innerHeight - height - margin)
  }
}

function compactResultMessage(message) {
  if (/已更新来源/.test(message || '')) return '新来源已保存'
  if (/已经收藏过/.test(message || '')) return '已经收藏'
  if (/已保存/.test(message || '')) return '已保存'
  return message || '操作完成'
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum))
}

function removeAction() {
  document.getElementById(ACTION_ID)?.remove()
}

function scheduleHideAction() {
  if (hideActionTimer) return
  hideActionTimer = setTimeout(() => {
    hideActionTimer = null
    removeAction()
  }, 180)
}

function cancelHideAction() {
  if (!hideActionTimer) return
  clearTimeout(hideActionTimer)
  hideActionTimer = null
}

function largestSrcsetUrl(srcset, image) {
  if (!srcset) return undefined
  const baseWidth = Math.max(image?.naturalWidth || 0, image?.clientWidth || 0, 1)
  return srcset.split(',')
    .map((entry) => entry.trim().split(/\s+/))
    .map(([url, descriptor]) => ({
      url: absoluteWebUrl(url),
      weight: descriptor?.endsWith('w')
        ? Number.parseInt(descriptor, 10)
        : descriptor?.endsWith('x') ? Number.parseFloat(descriptor) * baseWidth : 0
    }))
    .filter((item) => item.url)
    .sort((a, b) => b.weight - a.weight)[0]?.url
}

function backgroundImageUrl(element) {
  const value = getComputedStyle(element).backgroundImage
  if (!value || value === 'none') return undefined
  const match = value.match(/url\((?:"|')?(.*?)(?:"|')?\)/i)
  return match ? absoluteWebUrl(match[1]) : undefined
}

function firstWebUrl(...values) {
  for (const value of values) {
    const resolved = absoluteWebUrl(value)
    if (resolved) return resolved
  }
  return undefined
}

function preferredCompatibleUrl(...values) {
  const urls = values.map(absoluteWebUrl).filter(Boolean)
  return urls.find((value) => !/webp/i.test(value)) || urls[0]
}

function largestPictureSourceUrl(image) {
  const sources = [...(image.closest('picture')?.querySelectorAll('source') || [])]
  const candidates = sources.flatMap((source) => {
    const srcset = source.srcset || source.getAttribute('data-srcset') || ''
    const resolved = largestSrcsetUrl(srcset, image)
    return resolved ? [{ url: resolved, compatible: !/webp/i.test(source.type || '') && !/webp/i.test(resolved) }] : []
  })
  return candidates.find((candidate) => candidate.compatible)?.url || candidates[0]?.url
}

function absoluteWebUrl(value) {
  try {
    if (!value) return undefined
    const url = new URL(value, document.baseURI)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function positiveInteger(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined
}
