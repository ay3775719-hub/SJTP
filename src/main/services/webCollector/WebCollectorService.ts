import { unlink } from 'node:fs/promises'
import type { WebCollectPayload, WebCollectResult } from '@shared/types/domain'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { AssetSourceRepository } from '../../database/repositories/AssetSourceRepository'
import type { AssetImporter } from '../assets/AssetImporter'
import { WebDownloadError, WebImageDownloader, type DownloadedWebImage } from './WebImageDownloader'
import { logger, serializeError } from '../../logger'

export class WebCollectorService {
  private tail: Promise<void> = Promise.resolve()
  constructor(
    private readonly downloader: WebImageDownloader,
    private readonly importer: AssetImporter,
    private readonly assets: AssetRepository,
    private readonly sources: AssetSourceRepository,
    private readonly onCollected: (assetId: string, status: WebCollectResult['status'], domain: string) => void
  ) {}

  collect(requestId: string, payload: WebCollectPayload): Promise<WebCollectResult> {
    const task = this.tail.then(() => this.run(requestId, payload, () => this.downloader.download(payload.imageUrl, payload.pageUrl, requestId)))
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }

  collectBrowserUpload(requestId: string, payload: WebCollectPayload, bytes: Buffer, declaredMime: string): Promise<WebCollectResult> {
    const task = this.tail.then(() => this.run(requestId, payload, () => this.downloader.acceptBrowserUpload(bytes, payload.imageUrl, requestId, declaredMime)))
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }

  private async run(requestId: string, payload: WebCollectPayload, acquire: () => Promise<DownloadedWebImage>): Promise<WebCollectResult> {
    let downloadedPath: string | null = null
    try {
      const downloaded = await acquire()
      downloadedPath = downloaded.path
      const existingId = this.assets.findIdByHash(downloaded.hash)
      if (existingId) {
        const added = this.sources.add(existingId, payload)
        const status = added ? 'existing_asset_source_added' : 'already_collected'
        this.onCollected(existingId, status, new URL(payload.pageUrl).hostname)
        return { requestId, status, assetId: existingId }
      }

      const filenames = new Map([[downloaded.path, downloaded.filename]])
      const result = await this.importer.import([downloaded.path], 'browser_extension', undefined, {
        filenames,
        beforeCommit: (inputPath, assetId) => {
          if (inputPath !== downloaded.path) throw new Error('Web source transaction input mismatch')
          if (!this.sources.insertPrepared(this.sources.prepare(assetId, payload))) throw new Error('Web source already exists for new asset')
        }
      })
      const asset = result.imported[0]
      if (!asset) throw new WebDownloadError('invalid_image', result.failures[0]?.message ?? '图片导入失败')
      this.onCollected(asset.id, 'saved', new URL(payload.pageUrl).hostname)
      return { requestId, status: 'saved', assetId: asset.id }
    } catch (error) {
      logger.warn('Web collection failed', { requestId, domain: safeDomain(payload.imageUrl), error: serializeError(error) })
      if (error instanceof WebDownloadError) return { requestId, status: error.code, message: error.message }
      return { requestId, status: 'download_failed', message: error instanceof Error ? error.message : '图片保存失败' }
    } finally {
      if (downloadedPath) await unlink(downloadedPath).catch(() => undefined)
    }
  }
}

function safeDomain(value: string): string {
  try { return new URL(value).hostname }
  catch { return 'invalid-url' }
}
