import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { WebImageDownloader } from './WebImageDownloader'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WebImageDownloader compatibility normalization', () => {
  it('normalizes an opaque static WebP upload to a high-quality JPG', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-web-downloader-'))
    roots.push(root)
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 35, g: 140, b: 220 } }
    }).webp({ quality: 90 }).toBuffer()

    const result = await new WebImageDownloader(root).acceptBrowserUpload(
      bytes,
      'https://1.1.1.1/photo.webp',
      'opaque-webp',
      'image/webp'
    )

    expect(result.mimeType).toBe('image/jpeg')
    expect(extname(result.path)).toBe('.jpg')
    expect(result.filename).toBe('photo.jpg')
    expect((await readFile(result.path)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it('normalizes a transparent static WebP upload to PNG without losing alpha', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-web-downloader-'))
    roots.push(root)
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 20, g: 80, b: 160, alpha: 0.35 } }
    }).webp({ lossless: true }).toBuffer()

    const result = await new WebImageDownloader(root).acceptBrowserUpload(
      bytes,
      'https://1.1.1.1/transparent.webp',
      'alpha-webp',
      'image/webp'
    )

    expect(result.mimeType).toBe('image/png')
    expect(extname(result.path)).toBe('.png')
    expect(result.filename).toBe('transparent.png')
    expect((await sharp(result.path).metadata()).hasAlpha).toBe(true)
  })
})
