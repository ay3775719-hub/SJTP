import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const executable = process.argv[2]
const mode = process.argv[3] || 'status'
if (!executable) throw new Error('Usage: node scripts/native-messaging-smoke.mjs <Muse.exe> [status|collect]')

const message = mode.startsWith('collect')
  ? {
      protocolVersion: 1,
      type: 'collect_image',
      requestId: randomUUID(),
      payload: {
        imageUrl: 'https://i.pinimg.com/1200x/9f/d6/05/9fd6051f39fc88a518fe2845feddd133.jpg',
        pageUrl: mode === 'collect-alt' ? 'https://www.pinterest.com/pin/918804761516514472/?source=alternate' : 'https://www.pinterest.com/pin/918804761516514472/',
        pageTitle: mode === 'collect-alt' ? 'Pinterest alternate provenance smoke test' : 'Pinterest Web Collector Native Messaging smoke test',
        siteName: 'Pinterest',
        domain: 'pinterest.com',
        collectedAt: new Date().toISOString(),
        extensionVersion: '0.2.0'
      }
    }
  : { protocolVersion: 1, type: 'status' }

const child = spawn(executable, ['chrome-extension://pammmlffogkfhnapajdjgelkkcpiijll'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
})
const body = Buffer.from(JSON.stringify(message), 'utf8')
const header = Buffer.alloc(4)
header.writeUInt32LE(body.length, 0)
child.stdin.end(Buffer.concat([header, body]))

const chunks = []
child.stdout.on('data', (chunk) => chunks.push(chunk))
child.stderr.on('data', (chunk) => process.stderr.write(chunk))
const timer = setTimeout(() => child.kill(), 30_000)
child.on('close', (code) => {
  clearTimeout(timer)
  const output = Buffer.concat(chunks)
  if (output.length < 4) throw new Error(`Native host returned no framed response (exit ${code})`)
  const length = output.readUInt32LE(0)
  process.stdout.write(`${output.subarray(4, 4 + length).toString('utf8')}\n`)
})
