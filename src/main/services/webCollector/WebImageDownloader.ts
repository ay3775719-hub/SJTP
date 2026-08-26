import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { WEB_COLLECTOR_MAX_DOWNLOAD_BYTES } from './WebCollectorProtocol'

export class WebDownloadError extends Error {
  constructor(readonly code: 'download_failed' | 'invalid_image' | 'unsupported_format' | 'file_too_large' | 'invalid_request', message: string) { super(message) }
}

export interface DownloadedWebImage {
  path: string
  hash: string
  filename: string
  size: number
  mimeType: string
}

interface DetectedImageFormat {
  extension: 'jpg' | 'png' | 'webp' | 'gif'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  sharpFormat: 'jpeg' | 'png' | 'webp' | 'gif'
}

export class WebImageDownloader {
  constructor(private readonly tempRoot: string, private readonly maxBytes = WEB_COLLECTOR_MAX_DOWNLOAD_BYTES, private readonly timeoutMs = 20_000) {}

  async download(imageUrl: string, pageUrl: string, requestId: string): Promise<DownloadedWebImage> {
    await mkdir(this.tempRoot, { recursive: true })
    let current = new URL(imageUrl)
    let response: Response | null = null
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      await assertPublicHttpUrl(current)
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        response = await webFetch(current, {
          redirect: 'manual', signal: controller.signal,
          // Chromium can reject synthetic Referer/User-Agent headers with
          // ERR_BLOCKED_BY_CLIENT. The public image URL is sufficient for v1;
          // authenticated/cookie-bound images remain intentionally unsupported.
          // Prefer broadly compatible originals. Some CDNs content-negotiate
          // a JPG URL into WebP when WebP/AVIF appear first in Accept.
          headers: { Accept: 'image/jpeg,image/png,image/gif,image/webp;q=0.8,image/avif;q=0.6,image/*;q=0.5' }
        })
      } catch (error) {
        throw new WebDownloadError('download_failed', error instanceof Error ? error.message : '图片下载失败')
      } finally { clearTimeout(timer) }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location || redirect === 5) throw new WebDownloadError('download_failed', '图片重定向过多或缺少目标地址')
        current = new URL(location, current)
        continue
      }
      break
    }
    if (!response?.ok || !response.body) throw new WebDownloadError('download_failed', `图片下载失败（HTTP ${response?.status ?? 0}）`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > this.maxBytes) throw new WebDownloadError('file_too_large', '图片文件过大，未保存')

    const headerMime = ((response.headers.get('content-type') ?? '').split(';')[0] ?? '').trim().toLowerCase()
    if (headerMime && !headerMime.startsWith('image/')) throw new WebDownloadError('invalid_image', '服务器返回的内容不是图片')
    const provisional = join(this.tempRoot, `${requestId}.download`)
    let bytes = 0
    const limiter = new TransformStream<Uint8Array, Uint8Array>({ transform: (chunk, controller) => {
      bytes += chunk.byteLength
      if (bytes > this.maxBytes) throw new WebDownloadError('file_too_large', '图片文件过大，未保存')
      controller.enqueue(chunk)
    } })
    try {
      await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter) as never), createWriteStream(provisional, { flags: 'wx' }))
      const header = Buffer.alloc(32), file = await open(provisional, 'r')
      try { await file.read(header, 0, header.length, 0) } finally { await file.close() }
      const format = detectFormat(header)
      if (!format) throw new WebDownloadError('unsupported_format', 'Muse 暂不支持这个网页图片格式')
      const finalPath = join(this.tempRoot, `${requestId}.${format.extension}`)
      await rename(provisional, finalPath)
      return await this.prepareLibraryFile(finalPath, current, format, response.headers.get('content-disposition'))
    } catch (error) {
      await unlink(provisional).catch(() => undefined)
      if (error instanceof WebDownloadError) throw error
      throw new WebDownloadError('download_failed', error instanceof Error ? error.message : '图片下载失败')
    }
  }

  /**
   * Accepts bytes fetched by the browser extension after the normal Muse-side
   * download fails. The extension is only allowed to fetch the one image origin
   * that the user explicitly approved; validation and import still happen here.
   */
  async acceptBrowserUpload(bytes: Buffer, imageUrl: string, requestId: string, declaredMime = ''): Promise<DownloadedWebImage> {
    await mkdir(this.tempRoot, { recursive: true })
    const current = new URL(imageUrl)
    await assertPublicHttpUrl(current)
    if (!bytes.length) throw new WebDownloadError('invalid_image', '浏览器返回了空图片')
    if (bytes.length > this.maxBytes) throw new WebDownloadError('file_too_large', '图片文件过大，未保存')
    const mime = declaredMime.split(';')[0]?.trim().toLowerCase()
    if (mime && !mime.startsWith('image/')) throw new WebDownloadError('invalid_image', '浏览器返回的内容不是图片')
    const format = detectFormat(bytes.subarray(0, 32))
    if (!format) throw new WebDownloadError('unsupported_format', 'Muse 暂不支持这个网页图片格式')
    const finalPath = join(this.tempRoot, `${requestId}.${format.extension}`)
    try {
      await writeFile(finalPath, bytes, { flag: 'wx' })
      return await this.prepareLibraryFile(finalPath, current, format, null)
    } catch (error) {
      await unlink(finalPath).catch(() => undefined)
      if (error instanceof WebDownloadError) throw error
      throw new WebDownloadError('download_failed', error instanceof Error ? error.message : '图片上传失败')
    }
  }

  private async prepareLibraryFile(
    path: string,
    sourceUrl: URL,
    format: DetectedImageFormat,
    contentDisposition: string | null
  ): Promise<DownloadedWebImage> {
    let libraryPath = path
    let libraryFormat = format
    try {
      const sourceBytes = await readFile(path)
      const metadata = await sharp(sourceBytes, { animated: false, pages: 1 }).metadata()
      if (!metadata.width || !metadata.height || metadata.format !== format.sharpFormat) throw new WebDownloadError('invalid_image', '图片解码验证失败')

      // Web collection is a compatibility-oriented ingestion path. Static
      // WebP supplied by modern CDNs is normalized before import so Windows,
      // design tools and Ctrl+C receive a conventional JPG/PNG file. Animated
      // WebP remains untouched to avoid discarding frames.
      if (format.extension === 'webp' && (metadata.pages ?? 1) <= 1) {
        const hasAlpha = Boolean(metadata.hasAlpha)
        libraryFormat = hasAlpha
          ? { extension: 'png', mimeType: 'image/png', sharpFormat: 'png' }
          : { extension: 'jpg', mimeType: 'image/jpeg', sharpFormat: 'jpeg' }
        libraryPath = join(dirname(path), `${basename(path, extname(path))}.${libraryFormat.extension}`)
        const image = sharp(sourceBytes, { animated: false, pages: 1 }).rotate()
        if (hasAlpha) await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(libraryPath)
        else await image.jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(libraryPath)
        await unlink(path)
      }
    } catch (error) {
      await unlink(path).catch(() => undefined)
      if (libraryPath !== path) await unlink(libraryPath).catch(() => undefined)
      if (error instanceof WebDownloadError) throw error
      throw new WebDownloadError('invalid_image', '图片解码验证失败')
    }
    const info = await stat(libraryPath)
    return {
      path: libraryPath,
      hash: await sha256(libraryPath),
      filename: safeFilename(contentDisposition, sourceUrl, libraryFormat.extension),
      size: info.size,
      mimeType: libraryFormat.mimeType
    }
  }
}

async function webFetch(url: URL, init: RequestInit): Promise<Response> {
  if (process.versions.electron) {
    try {
      const { net } = await import('electron')
      return await net.fetch(url.toString(), init)
    } catch (fetchError) {
      try { return await electronNetRequest(url, init) }
      catch (requestError) {
        throw new Error(`Electron download failed: ${errorMessage(fetchError)}; ${errorMessage(requestError)}`)
      }
    }
  }
  return fetch(url, init)
}

async function electronNetRequest(url: URL, init: RequestInit): Promise<Response> {
  const { net } = await import('electron')
  return await new Promise<Response>((resolve, reject) => {
    const request = net.request({ method: init.method ?? 'GET', url: url.toString(), redirect: 'manual' })
    const headers = new Headers(init.headers)
    headers.forEach((value, name) => request.setHeader(name, value))
    const abort = (): void => { request.abort(); reject(new DOMException('The operation was aborted', 'AbortError')) }
    if (init.signal?.aborted) return abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    request.once('error', reject)
    request.once('response', (incoming) => {
      init.signal?.removeEventListener('abort', abort)
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item))
        else if (value !== undefined) responseHeaders.set(name, String(value))
      }
      resolve(new Response(Readable.toWeb(incoming as unknown as Readable) as never, { status: incoming.statusCode, headers: responseHeaders }))
    })
    request.end()
  })
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new WebDownloadError('invalid_request', '仅支持 http/https 图片地址')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase('en-US')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw new WebDownloadError('invalid_request', '不允许访问本机或私有网络地址')
  const addresses = isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new WebDownloadError('invalid_request', '不允许访问本机或私有网络地址')
}

function isPublicAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase('en-US')
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1]
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null)
  if (!ipv4) return isIP(normalized) === 6
  const [a = -1, b = -1] = ipv4.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224)
}

function detectFormat(header: Buffer): DetectedImageFormat | null {
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: 'jpg', mimeType: 'image/jpeg', sharpFormat: 'jpeg' }
  if (header.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { extension: 'png', mimeType: 'image/png', sharpFormat: 'png' }
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return { extension: 'webp', mimeType: 'image/webp', sharpFormat: 'webp' }
  if (['GIF87a','GIF89a'].includes(header.subarray(0, 6).toString('ascii'))) return { extension: 'gif', mimeType: 'image/gif', sharpFormat: 'gif' }
  return null
}

function safeFilename(contentDisposition: string | null, url: URL, extension: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition ?? '')?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition ?? '')?.[1]
  let value = encoded ? decodeURIComponent(encoded) : plain || basename(decodeURIComponent(url.pathname)) || `web-image.${extension}`
  value = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180)
  if (!value || ['.', '..'].includes(value)) value = `web-image.${extension}`
  const currentExtension = extname(value)
  value = currentExtension ? `${value.slice(0, -currentExtension.length)}.${extension}` : `${value}.${extension}`
  return value
}

const sha256 = (path: string): Promise<string> => import('node:fs').then(({ createReadStream }) => new Promise((resolve, reject) => {
  const hash = createHash('sha256'), stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex')))
}))
