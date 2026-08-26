const state = document.querySelector('#state')
const last = document.querySelector('#last')
const connect = document.querySelector('#connect')
document.querySelector('#version').textContent = `版本 ${chrome.runtime.getManifest().version} · 全网站通用采集`

connect.addEventListener('click', () => { void refresh() })

async function refresh() {
  connect.disabled = true
  state.textContent = '正在检查 Muse...'
  const stored = await chrome.storage.local.get('lastFeedback')
  if (stored.lastFeedback) {
    last.hidden = false
    last.textContent = stored.lastFeedback.title
  }

  const result = await send({ type: 'status' }).catch(() => ({ available: false }))
  connect.disabled = false
  if (result.available) {
    state.textContent = '● 已连接'
    state.className = 'ok'
    connect.hidden = true
    return
  }

  state.textContent = '○ Muse 未连接，请先启动最新版 Muse'
  state.className = 'off'
  connect.hidden = false
  connect.textContent = '重新检查'
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(response || { available: false })
    })
  })
}

await refresh()
