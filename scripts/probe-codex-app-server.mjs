import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const binary = process.env.MUSE_CODEX_BINARY || resolve('.qa-codex.exe')
const child = spawn(binary, ['app-server', '--stdio'], {
  cwd: process.cwd(),
  env: process.env,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
})

let requestId = 0
const pending = new Map()
const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
  const id = ++requestId
  pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
  child.stdin.write(`${JSON.stringify({ method, id, ...(params === undefined ? {} : { params }) })}\n`)
})

createInterface({ input: child.stdout }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id !== undefined && pending.has(message.id)) {
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  }
})

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderr += chunk })

try {
  const initialized = await request('initialize', {
    clientInfo: { name: 'muse_visual_library_probe', title: 'Muse Probe', version: '0.1.0' }
  })
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
  const [account, models, rateLimits, usage] = await Promise.all([
    request('account/read', { refreshToken: false }),
    request('model/list', { limit: 100, includeHidden: false }),
    request('account/rateLimits/read'),
    request('account/usage/read')
  ])
  const imageModels = models.data.filter((model) => (model.inputModalities ?? ['text', 'image']).includes('image'))
  process.stdout.write(`${JSON.stringify({ initialized, account, imageModels, rateLimits, usage }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.stack || error}\n${stderr}`)
  process.exitCode = 1
} finally {
  child.kill()
}
