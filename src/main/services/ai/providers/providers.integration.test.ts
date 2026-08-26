import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import { OllamaProvider } from './OllamaProvider'
import { LMStudioProvider } from './LMStudioProvider'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider'
import { MUSE_ANALYSIS_JSON_SCHEMA } from '../MuseAnalysisContract'

const servers: Server[] = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))))

const analysis = { primaryObject: { value: '背包', normalizedValue: 'backpack', confidence: .95 }, primaryScene: { value: '户外', normalizedValue: 'outdoor', confidence: .9 }, primaryStyle: { value: '产品摄影', normalizedValue: 'product_photography', confidence: .92 }, description: '户外场景中的背包产品图片。' }
const input = { assetId: 'asset-1', dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' as const }

describe('multi-provider adapters', () => {
  it('discovers Ollama vision capabilities and returns Muse schema', async () => {
    const requests: Array<{ url?: string; body?: Record<string, unknown> }> = []
    const url = await listen((req: IncomingMessage, res: ServerResponse) => {
      let raw = ''; req.on('data', (chunk: Buffer) => { raw += chunk }); req.on('end', () => {
        const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined; requests.push({ url: req.url, body })
        json(res, req.url === '/api/tags' ? { models: [{ name: 'qwen3-vl:latest', size: 42 }] } : req.url === '/api/show' ? { capabilities: ['completion','vision'] } : { message: { content: JSON.stringify(analysis) } })
      })
    })
    const provider = new OllamaProvider(url)
    expect((await provider.listModels())[0]?.capabilities.vision).toBe(true)
    expect((await provider.analyzeImage(input, { modelId: 'qwen3-vl:latest' })).primaryObject.value).toBe('背包')
    const chat = requests.find((request) => request.url === '/api/chat')?.body
    expect(chat?.format).toEqual(MUSE_ANALYSIS_JSON_SCHEMA)
    expect(JSON.stringify(chat)).toContain('aGVsbG8=')
  })

  it('filters LM Studio to VLM models and uses structured chat completions', async () => {
    const url = await listen((req: IncomingMessage, res: ServerResponse) => {
      let raw = ''; req.on('data', (chunk: Buffer) => { raw += chunk }); req.on('end', () => {
        if (req.url === '/api/v1/models') return json(res, { models: [{ id: 'text-only', type: 'llm' }, { id: 'local-vision', type: 'vlm' }] })
        if (req.url === '/v1/chat/completions') return json(res, { choices: [{ message: { content: JSON.stringify(analysis) } }] })
        json(res, { data: [] })
      })
    })
    const provider = new LMStudioProvider(url)
    expect((await provider.listModels()).map((model) => model.id)).toEqual(['local-vision'])
    expect((await provider.analyzeImage(input, { modelId: 'local-vision' })).description).toContain('背包')
  })

  it('supports optional keys for OpenAI-compatible endpoints', async () => {
    let authorization = ''
    const url = await listen((req: IncomingMessage, res: ServerResponse) => {
      authorization = String(req.headers.authorization ?? '')
      let raw = ''; req.on('data', (chunk: Buffer) => { raw += chunk }); req.on('end', () => req.url === '/v1/models' ? json(res, { data: [{ id: 'my-vision-model' }] }) : json(res, { choices: [{ message: { content: JSON.stringify(analysis) } }] }))
    })
    const provider = new OpenAICompatibleProvider(`${url}/v1`, () => 'secret')
    expect((await provider.listModels())[0]?.capabilities.vision).toBe(true)
    await provider.analyzeImage(input, { modelId: 'my-vision-model' })
    expect(authorization).toBe('Bearer secret')
  })
})

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address')
  return `http://127.0.0.1:${address.port}`
}
function json(res: import('node:http').ServerResponse, body: unknown): void { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
