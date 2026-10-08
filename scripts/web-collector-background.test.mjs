import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../browser-extension/src/background.js', import.meta.url), 'utf8')

test('group items retain the existing native protocol and only show one final result', async () => {
  let listener
  const nativeRequests = []
  const toasts = []
  const badges = []
  const chrome = {
    contextMenus: { onClicked: { addListener() {} }, remove(_id, callback) { callback() }, create() {} },
    tabs: { create: async () => undefined },
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback } },
      getManifest: () => ({ version: '0.4.0' }), lastError: null,
      sendNativeMessage(_host, envelope, callback) {
        nativeRequests.push(envelope)
        callback({ status: nativeRequests.length === 2 ? 'already_collected' : 'saved' })
      }
    },
    storage: { local: { set: async () => undefined } },
    action: {
      setBadgeBackgroundColor: async () => undefined,
      setBadgeText: async ({ text }) => { badges.push(text) },
      setTitle: async () => undefined
    },
    scripting: { executeScript: async (request) => { toasts.push(request) } }
  }
  vm.runInNewContext(source, { chrome, crypto, URL, Date, setTimeout: () => 0 })
  const tab = { id: 3, url: 'https://www.instagram.com/p/post/', title: 'post' }
  const send = (message) => new Promise((resolve) => {
    assert.equal(listener(message, { tab }, resolve), true)
  })
  const base = { pageUrl: tab.url, collectedAt: new Date().toISOString(), extensionVersion: '0.4.0' }
  const first = await send({ type: 'collect_group_image', payload: { ...base, imageUrl: 'https://cdn.example.com/a.jpg' } })
  const second = await send({ type: 'collect_group_image', payload: { ...base, imageUrl: 'https://cdn.example.com/b.jpg' } })
  assert.equal(first.status, 'saved')
  assert.equal(second.status, 'already_collected')
  assert.equal(toasts.length, 0)
  assert.equal(badges.length, 0)
  assert.deepEqual(nativeRequests.map((item) => item.type), ['collect_image', 'collect_image'])
  assert.ok(nativeRequests.every((item) => item.payload.pageUrl === tab.url))
  assert.ok(nativeRequests.every((item) => item.payload.domain === 'www.instagram.com'))

  await send({ type: 'collect_group_complete', summary: '整组：保存 1 张，已存在 1 张，失败 0 张', failed: 0 })
  assert.equal(toasts.length, 1)
  assert.deepEqual(badges, ['✓'])
})
