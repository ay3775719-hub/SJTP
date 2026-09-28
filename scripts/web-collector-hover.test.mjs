import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../browser-extension/src/content/imageContextMenu.js', import.meta.url), 'utf8')
const actionId = 'muse-web-collector-image-action'

function setup(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 })
  const dom = new JSDOM('<!doctype html><body><img id="photo" src="https://example.com/photo.jpg"><div id="overlay"></div><img id="second" src="https://example.com/second.jpg"></body>', {
    url: 'https://example.com/gallery', runScripts: 'outside-only', pretendToBeVisual: true
  })
  t.after(() => dom.window.close())
  const { window } = dom
  const { document } = window
  window.Date.now = () => Date.now()
  const photo = document.getElementById('photo')
  const second = document.getElementById('second')
  const overlay = document.getElementById('overlay')
  for (const [img, left] of [[photo, 100], [second, 500]]) {
    Object.defineProperties(img, { naturalWidth: { value: 300 }, naturalHeight: { value: 300 } })
    img.getBoundingClientRect = () => ({ left, top: 100, right: left + 300, bottom: 400, width: 300, height: 300 })
  }
  let pointed = photo
  document.elementsFromPoint = () => [pointed]
  document.elementFromPoint = () => pointed
  const messages = []
  window.chrome = { runtime: {
    onMessage: { addListener() {} }, getManifest: () => ({ version: 'test' }),
    sendMessage: async (message) => { messages.push(message); return { ok: true, message: '已保存' } }
  } }
  window.eval(source)
  const move = (target, x = 200, y = 200) => {
    pointed = target
    target.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
  }
  const leave = (target, relatedTarget) => target.dispatchEvent(new window.MouseEvent('pointerleave', { relatedTarget }))
  const tick = (ms) => t.mock.timers.tick(ms)
  const action = () => document.getElementById(actionId)
  const show = () => { move(photo); tick(1200); assert.ok(action(), 'hover should show the action') }
  return { window, document, photo, second, overlay, move, leave, tick, action, show, messages }
}

test('moving across image children does not dismiss the action while stationary afterward', (t) => {
  const h = setup(t)
  h.show()
  const button = h.action()
  h.leave(h.photo, h.overlay)
  h.tick(250)
  assert.equal(h.action(), button)
})

test('crossing an image overlay retains the same action and its collection target', async (t) => {
  const h = setup(t)
  h.show()
  const button = h.action()
  h.move(h.overlay, 240, 200)
  h.tick(300)
  assert.equal(h.action(), button)
  h.move(button.firstChild, 300, 130)
  button.click()
  await Promise.resolve()
  assert.equal(h.messages[0].payload.imageUrl, h.photo.src)
})

test('returning to the image within the resolution throttle cancels pending hiding', (t) => {
  const h = setup(t)
  h.show()
  const button = h.action()
  h.move(h.document.body, 900, 600)
  h.tick(20)
  h.move(h.photo)
  h.tick(300)
  assert.equal(h.action(), button)
})

test('leaving the image hides the action and a different image requires hover intent', (t) => {
  const h = setup(t)
  h.move(h.photo)
  h.tick(1199)
  assert.equal(h.action(), null)
  h.tick(1)
  assert.ok(h.action())
  h.move(h.document.body, 900, 600)
  h.tick(200)
  assert.equal(h.action(), null)
  h.move(h.second, 600, 200)
  h.tick(1199)
  assert.equal(h.action(), null)
  h.tick(1)
  assert.equal(h.action()?.dataset.imageUrl, h.second.src)
})

test('moving directly to another image replaces the target after hover intent', (t) => {
  const h = setup(t)
  h.show()
  h.move(h.second, 600, 200)
  assert.equal(h.action(), null)
  h.tick(1200)
  assert.equal(h.action()?.dataset.imageUrl, h.second.src)
})

test('leaving the page, scrolling, Escape, and blur still dismiss the action', (t) => {
  const h = setup(t)
  for (const dismiss of [
    () => { h.leave(h.document, null); h.tick(200) },
    () => h.document.dispatchEvent(new h.window.Event('scroll')),
    () => h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape' })),
    () => h.window.dispatchEvent(new h.window.Event('blur'))
  ]) {
    h.tick(100)
    h.show()
    dismiss()
    assert.equal(h.action(), null)
  }
})

test('a removed image does not keep the action alive through its old rectangle', (t) => {
  const h = setup(t)
  h.show()
  h.photo.remove()
  h.move(h.overlay)
  h.tick(200)
  assert.equal(h.action(), null)
})
