import { MuseError } from '../../../errors'

export function requestSignal(signal?: AbortSignal, timeoutMs = 8_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function readJson<T>(response: Response, providerName: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text()
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500
    const code = response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : retryable ? 'AI_RETRYABLE' : 'AI_PROVIDER_ERROR'
    throw new MuseError(code, `${providerName} 请求失败 (${response.status})`, body.slice(0, 500))
  }
  return response.json() as Promise<T>
}

export function normalizeBaseUrl(value: string, suffixToStrip?: string): string {
  let result = value.trim().replace(/\/+$/, '')
  if (suffixToStrip && result.toLowerCase().endsWith(suffixToStrip.toLowerCase())) result = result.slice(0, -suffixToStrip.length)
  return result
}

export const VISION_MODEL_PATTERN = /(llava|bakllava|moondream|mini[-_]?cpm[-_]?v|qwen(?:2(?:\.5)?|3)[-_]?(?:vl|omni)|gemma[34]|llama(?:3\.2)?[-_:]?vision|llama4|granite.*vision|pixtral|vision|vlm)/i
