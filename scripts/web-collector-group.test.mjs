import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../browser-extension/src/content/imageContextMenu.js', import.meta.url), 'utf8')
const images = ['https://cdn.example.com/first.jpg', 'https://cdn.example.com/second.jpg', 'https://cdn.example.com/third.jpg']

function setup(t, { site = 'instagram', initial = 0, failureAt = -1, cssIcons = false, nesting = 0 } = {}) {
  const url = site === 'instagram' ? 'https://www.instagram.com/p/example/' : 'https://www.xiaohongshu.com/explore/example'
  const next = cssIcons ? '<button data-direction="next" class="_afxw _al46 _al47"><div class="_9zm2"></div></button>'
    : site === 'instagram' ? '<button data-direction="next" aria-label="Next">next</button>' : '<button data-direction="next" class="swiper-button-next">next</button>'
  const previous = cssIcons ? '<button data-direction="previous" class="_afxw _al46 _al48"><div class="_9zm0"></div></button>'
    : site === 'instagram' ? '<button data-direction="previous" aria-label="Previous">prev</button>' : '<button data-direction="previous" class="swiper-button-prev">prev</button>'
  const photoMarkup = `${'<div>'.repeat(nesting)}<img id="photo" src="${images[initial]}">${'</div>'.repeat(nesting)}`
  const dom = new JSDOM(`<!doctype html><article id="post"><img id="avatar" src="https://cdn.example.com/avatar.jpg">${photoMarkup}${previous}${next}</article><article id="unrelated"><img src="https://cdn.example.com/unrelated.jpg"></article>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true
  })
  t.after(() => dom.window.close())
  const { window } = dom
  const { document } = window
  const photo = document.querySelector('#photo')
  const avatar = document.querySelector('#avatar')
  const nextButton = document.querySelector('[data-direction="next"]')
  const previousButton = document.querySelector('[data-direction="previous"]')
  nextButton.getBoundingClientRect = () => ({ left: 460, right: 490, top: 285, bottom: 315, width: 30, height: 30 })
  previousButton.getBoundingClientRect = () => ({ left: 110, right: 140, top: 285, bottom: 315, width: 30, height: 30 })
  let index = initial
  let moves = 0
  const update = () => {
    photo.src = images[index]
    nextButton.disabled = index === images.length - 1
    previousButton.disabled = index === 0
    moves++
  }
  nextButton.onclick = () => { if (index < images.length - 1) { index++; update() } }
  previousButton.onclick = () => { if (index > 0) { index--; update() } }
  update()
  for (const image of [photo, avatar]) {
    Object.defineProperties(image, { naturalWidth: { value: 500 }, naturalHeight: { value: 500 } })
    image.getBoundingClientRect = () => image === photo
      ? { left: 100, right: 500, top: 100, bottom: 500, width: 400, height: 400 }
      : { left: 530, right: 570, top: 100, bottom: 140, width: 40, height: 40 }
  }
  const messages = []
  window.chrome = { runtime: {
    onMessage: { addListener() {} }, getManifest: () => ({ version: 'test' }),
    sendMessage: async (message) => {
      messages.push(message)
      if (message.type === 'collect_group_image') return message.payload.imageUrl === images[failureAt]
        ? { ok: false, status: 'download_failed' } : { ok: true, status: 'saved' }
      return { ok: true, status: 'saved' }
    }
  } }
  document.elementsFromPoint = () => [photo]
  document.elementFromPoint = () => photo
  window.eval(source)
  return {
    window, document, photo, messages, get index() { return index }, get moves() { return moves },
    carousel: () => window.eval('findCarousel(document.querySelector("#photo"))'),
    payload: () => window.eval('buildPayload(document.querySelector("#photo").src, "", 500, 500)'),
    read: () => window.eval('readCarousel(findCarousel(document.querySelector("#photo")), buildPayload(document.querySelector("#photo").src, "", 500, 500))')
  }
}

test('Instagram carousel reads every slide in order, stays within the post, and returns to the original slide', async (t) => {
  const h = setup(t, { initial: 1 })
  assert.ok(h.carousel())
  const result = await h.read()
  assert.deepEqual(Array.from(result.payloads, (payload) => payload.imageUrl), images)
  assert.ok(result.payloads.every((payload) => payload.pageUrl === 'https://www.instagram.com/p/example/'))
  assert.equal(result.incomplete, false)
  assert.equal(h.index, 1)
  assert.ok(h.moves >= 4)
})

test('Instagram carousel controls with labels on their SVG icons are recognized', async (t) => {
  const h = setup(t)
  for (const label of ['Next', 'Previous']) {
    const button = h.document.querySelector(`[aria-label="${label}"]`)
    button.removeAttribute('aria-label')
    button.innerHTML = `<svg aria-label="${label}"></svg>`
  }
  assert.ok(h.carousel())
  const result = await h.read()
  assert.deepEqual(Array.from(result.payloads, (payload) => payload.imageUrl), images)
})

test('Instagram CSS-only arrows show the group action and collect every slide', async (t) => {
  const h = setup(t, { cssIcons: true, initial: 1 })
  h.window.eval('showAction(150, 150, buildPayload(document.querySelector("#photo").src, "", 500, 500), document.querySelector("#photo").getBoundingClientRect(), document.querySelector("#photo"))')
  assert.ok(h.document.querySelector('#muse-web-collector-group-action'))
  const result = await h.read()
  assert.deepEqual(Array.from(result.payloads, (payload) => payload.imageUrl), images)
  assert.equal(h.index, 1)
})

test('unlabelled Instagram icon arrows still work when their CSS class names change', async (t) => {
  const h = setup(t, { cssIcons: true })
  for (const button of h.document.querySelectorAll('#post button')) {
    button.className = 'changed-class-name'
    button.innerHTML = '<span class="changed-icon"></span>'
  }
  assert.ok(h.carousel())
  const result = await h.read()
  assert.deepEqual(Array.from(result.payloads, (payload) => payload.imageUrl), images)
  assert.equal(result.incomplete, false)
})

test('deeply nested post images still find their own carousel', async (t) => {
  const h = setup(t, { nesting: 14 })
  assert.ok(h.carousel())
  const result = await h.read()
  assert.equal(result.payloads.length, 3)
})

test('controls added after the hover action appears reveal the group action without moving the pointer', async (t) => {
  const h = setup(t)
  const controls = Array.from(h.document.querySelectorAll('#post button'))
  controls.forEach((button) => button.remove())
  h.window.eval('showAction(150, 150, buildPayload(document.querySelector("#photo").src, "", 500, 500), document.querySelector("#photo").getBoundingClientRect(), document.querySelector("#photo"))')
  assert.equal(h.document.querySelector('#muse-web-collector-group-action'), null)
  h.document.querySelector('#post').append(...controls)
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.ok(h.document.querySelector('#muse-web-collector-group-action'))
})

test('an adjacent post carousel cannot add a group action to a single-image post', (t) => {
  const h = setup(t)
  const controls = Array.from(h.document.querySelectorAll('#post button'))
  h.document.querySelector('#unrelated').append(...controls)
  assert.equal(h.carousel(), null)
})

test('Xiaohongshu swiper is detected and reads unloaded slides by advancing', async (t) => {
  const h = setup(t, { site: 'xiaohongshu' })
  assert.ok(h.carousel())
  const result = await h.read()
  assert.deepEqual(Array.from(result.payloads, (payload) => payload.imageUrl), images)
  assert.equal(result.incomplete, false)
  assert.equal(h.index, 0)
})

test('one group action sends each image and reports partial failures without stopping the rest', async (t) => {
  const h = setup(t, { failureAt: 1 })
  h.window.eval('showAction(150, 150, buildPayload(document.querySelector("#photo").src, "", 500, 500), document.querySelector("#photo").getBoundingClientRect(), document.querySelector("#photo"))')
  const action = h.document.querySelector('#muse-web-collector-group-action')
  assert.ok(action)
  action.click()
  for (let attempt = 0; attempt < 20 && !h.messages.some((message) => message.type === 'collect_group_complete'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.deepEqual(h.messages.filter((message) => message.type === 'collect_group_image').map((message) => message.payload.imageUrl), images)
  assert.match(h.messages.find((message) => message.type === 'collect_group_complete').summary, /保存 2 张，已存在 0 张，失败 1 张/)
  assert.equal(h.index, 0)
})

test('single image without carousel controls keeps the existing single-image action', (t) => {
  const h = setup(t)
  h.document.querySelectorAll('#post button').forEach((button) => button.remove())
  assert.equal(h.carousel(), null)
  h.window.eval('showAction(150, 150, buildPayload(document.querySelector("#photo").src, "", 500, 500), document.querySelector("#photo").getBoundingClientRect(), document.querySelector("#photo"))')
  assert.ok(h.document.querySelector('#muse-web-collector-image-action'))
  assert.equal(h.document.querySelector('#muse-web-collector-group-action'), null)
})
