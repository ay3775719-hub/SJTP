const PROTOCOL_VERSION = 1
const MENU_ID = 'save-to-muse'
const NATIVE_HOST = 'com.muse.web_collector'

function ensureContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => {
    void chrome.runtime.lastError
    // Some sites (notably Instagram) place a transparent interaction layer above
    // the real <img>. Chromium then classifies the click as "page", not "image".
    // The page context is a fallback; the content script still verifies that the
    // pointer was actually over a resolvable image before collection.
    chrome.contextMenus.create({ id: MENU_ID, title: '保存到 Muse', contexts: ['image', 'page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] })
  })
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureContextMenu()
  if (details.reason === 'install' || details.reason === 'update') {
    // Show the native-host connection state after an install/update.
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') })
  }
})
chrome.runtime.onStartup.addListener(ensureContextMenu)

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  if (info.srcUrl) void collectImage(info, tab)
  else void collectLastContextImage(info, tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'status') { void status().then(sendResponse); return true }
  if (message?.type === 'pair') { void pair().then(sendResponse); return true }
  if (message?.type === 'collect_page_image') {
    void collectPageImage(message.payload, sender.tab).then(sendResponse)
    return true
  }
})

async function collectImage(info, tab) {
  await feedback('…', '正在保存到 Muse...', tab?.id)
  try {
    const resolved = tab?.id ? await resolveImage(tab.id, info.srcUrl) : { imageUrl: info.srcUrl, pageTitle: '' }
    const pageUrl = info.pageUrl || tab?.url
    if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) throw new Error('invalid_request')
    const payload = {
      imageUrl: resolved?.imageUrl || info.srcUrl,
      pageUrl,
      pageTitle: resolved?.pageTitle || tab?.title || undefined,
      siteName: resolved?.siteName || undefined,
      domain: new URL(pageUrl).hostname,
      altText: resolved?.altText || undefined,
      imageWidth: resolved?.imageWidth || undefined,
      imageHeight: resolved?.imageHeight || undefined,
      collectedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version
    }
    const response = await nativeMessage(collectEnvelope(payload))
    if (response.status === 'saved') await feedback('✓', '已保存到 Muse', tab?.id)
    else if (response.status === 'existing_asset_source_added') await feedback('✓', '图片已存在，已更新来源信息', tab?.id)
    else if (response.status === 'already_collected') await feedback('✓', '图片已经收藏过', tab?.id)
    else throw new Error(response.message || response.status)
  } catch (error) {
    const code = String(error?.message || error)
    if (code.includes('native host') || code.includes('not found') || code.includes('muse_unavailable')) await feedback('!', '请先启动最新版 Muse，再重试保存', tab?.id)
    else await feedback('!', readableError(code), tab?.id)
  }
}

async function collectLastContextImage(info, tab) {
  try {
    if (!tab?.id) throw new Error('invalid_request')
    const options = Number.isInteger(info.frameId) ? { frameId: info.frameId } : undefined
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'get_last_context_image' }, options)
    if (!response?.payload) {
      await feedback('!', '没有识别到右键位置的图片', tab.id)
      return
    }
    await collectPageImage(response.payload, tab)
  } catch {
    await feedback('!', '没有识别到右键位置的图片，请刷新网页后重试', tab?.id)
  }
}

async function collectPageImage(payload, tab) {
  await feedback('…', '正在保存到 Muse...', tab?.id)
  try {
    const pageUrl = tab?.url && /^https?:\/\//i.test(tab.url) ? tab.url : payload?.pageUrl
    const imageUrl = payload?.imageUrl
    if (!pageUrl || !/^https?:\/\//i.test(pageUrl) || !imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      throw new Error('invalid_request')
    }
    const response = await nativeMessage(collectEnvelope({
      ...payload,
      pageUrl,
      domain: new URL(pageUrl).hostname,
      collectedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version
    }))
    const message = response.status === 'saved'
      ? '已保存到 Muse'
      : response.status === 'existing_asset_source_added'
        ? '图片已存在，已更新来源'
        : response.status === 'already_collected'
          ? '图片已经收藏过'
          : readableError(response.message || response.status)
    const ok = ['saved', 'existing_asset_source_added', 'already_collected'].includes(response.status)
    await feedback(ok ? '✓' : '!', message, tab?.id)
    return { ok, status: response.status, message }
  } catch (error) {
    const code = String(error?.message || error)
    const message = code.includes('native host') || code.includes('not found') || code.includes('muse_unavailable')
      ? '请先启动最新版 Muse'
      : readableError(code)
    await feedback('!', message, tab?.id)
    return { ok: false, status: 'failed', message }
  }
}

async function resolveImage(tabId, srcUrl) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, args: [srcUrl], func: (clickedUrl) => {
      const candidates = [...document.images]
      const target = candidates.find((img) => [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-original')].filter(Boolean).includes(clickedUrl))
        || candidates.find((img) => img.currentSrc === clickedUrl || img.src === clickedUrl)
      if (!target) return { imageUrl: clickedUrl, pageTitle: document.title }
      const absolute = (value) => { try { return value ? new URL(value, document.baseURI).href : undefined } catch { return undefined } }
      const srcset = target.srcset || target.getAttribute('data-srcset') || ''
      const largest = srcset.split(',').map((entry) => entry.trim().split(/\s+/)).map(([url, descriptor]) => ({ url: absolute(url), weight: descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : descriptor?.endsWith('x') ? Number.parseFloat(descriptor) * Math.max(target.naturalWidth, 1) : 0 })).filter((item) => item.url).sort((a, b) => b.weight - a.weight)[0]?.url
      const lazy = absolute(target.getAttribute('data-original') || target.getAttribute('data-src'))
      const pictureCandidates = [...(target.closest('picture')?.querySelectorAll('source') || [])].flatMap((source) => {
        const candidate = (source.srcset || source.getAttribute('data-srcset') || '').split(',').map((entry) => entry.trim().split(/\s+/)).map(([url, descriptor]) => ({ url: absolute(url), weight: descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : descriptor?.endsWith('x') ? Number.parseFloat(descriptor) * Math.max(target.naturalWidth, 1) : 0, compatible: !/webp/i.test(source.type || '') && !/webp/i.test(url || '') })).filter((item) => item.url).sort((a, b) => b.weight - a.weight)
        return candidate
      })
      const urls = [absolute(target.currentSrc), largest, pictureCandidates.find((item) => item.compatible)?.url, absolute(target.src), lazy, absolute(clickedUrl)].filter(Boolean)
      const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || undefined
      return { imageUrl: urls.find((url) => !/webp/i.test(url)) || urls[0], pageTitle: document.title, siteName, altText: target.alt || undefined, imageWidth: target.naturalWidth || undefined, imageHeight: target.naturalHeight || undefined }
    } })
    return result
  } catch { return { imageUrl: srcUrl, pageTitle: '' } }
}

async function status() {
  try {
    const result = await nativeMessage({ protocolVersion: PROTOCOL_VERSION, type: 'status' })
    return { available: Boolean(result.available), paired: Boolean(result.paired), protocolVersion: result.protocolVersion }
  } catch { return { available: false, paired: false, protocolVersion: PROTOCOL_VERSION } }
}

async function pair() {
  const result = await status()
  return result.available ? { ok: true } : { ok: false, error: '请先启动最新版 Muse' }
}

function nativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else if (!response) reject(new Error('native host returned no response'))
      else resolve(response)
    })
  })
}

function collectEnvelope(payload) {
  return { protocolVersion: PROTOCOL_VERSION, type: 'collect_image', requestId: crypto.randomUUID(), payload }
}

async function feedback(text, title, tabId) {
  await chrome.storage.local.set({ lastFeedback: { title, at: new Date().toISOString() } })
  await chrome.action.setBadgeBackgroundColor({ color: text === '!' ? '#b84b55' : '#4c6edb' })
  await chrome.action.setBadgeText({ text })
  await chrome.action.setTitle({ title })
  if (tabId) void showPageToast(tabId, title, text === '!')
  setTimeout(() => { void chrome.action.setBadgeText({ text: '' }); void chrome.action.setTitle({ title: 'Muse Web Collector' }) }, 3500)
}

async function showPageToast(tabId, message, isError) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, args: [message, isError], func: (text, failed) => {
      document.getElementById('muse-web-collector-toast')?.remove()
      const toast = document.createElement('div')
      toast.id = 'muse-web-collector-toast'
      toast.textContent = text
      Object.assign(toast.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', padding: '11px 14px', borderRadius: '8px', color: '#fff', background: failed ? '#a93f4a' : '#2f3b65', font: '13px system-ui', boxShadow: '0 8px 30px rgba(0,0,0,.3)' })
      document.documentElement.appendChild(toast)
      setTimeout(() => toast.remove(), 3500)
    } })
  } catch { /* Some protected pages do not allow script injection; the badge still reports status. */ }
}

function readableError(code) {
  if (code.includes('download_failed')) return '图片下载失败，可能需要登录或网站禁止直接访问'
  if (code.includes('file_too_large')) return '图片文件过大，未保存'
  if (code.includes('unsupported_format')) return 'Muse 暂不支持该图片格式'
  if (code.includes('invalid_image')) return '网页返回的内容不是有效图片'
  return '保存失败，请稍后重试'
}
