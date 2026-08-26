import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import type { AssetSource, ImportResult } from '@shared/types/domain'
import type { AssetRepository } from '../../database/repositories/AssetRepository'
import type { LibraryDirectories } from '../filesystem/LibraryPaths'
import { PaletteService } from '../thumbnails/PaletteService'
import { ThumbnailService } from '../thumbnails/ThumbnailService'
import { logger, serializeError } from '../../logger'

const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'
}

const hashFile = (path: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex')))
})

export class AssetImporter {
  private readonly thumbnails: ThumbnailService
  private readonly palette = new PaletteService()

  constructor(
    private readonly library: LibraryDirectories,
    private readonly assets: AssetRepository,
    private readonly onImported?: (assetIds: string[]) => void
  ) {
    this.thumbnails = new ThumbnailService(library.thumbnails)
  }

  async import(inputs: string[], source: AssetSource = 'local', folderId?: string, options: {
    filenames?: ReadonlyMap<string, string>
    beforeCommit?: (inputPath: string, assetId: string) => void
  } = {}): Promise<ImportResult> {
    const result: ImportResult = { imported: [], duplicateIds: [], failures: [] }
    for (const input of inputs) {
      let managedPath: string | null = null
      let generatedPaths: string[] = []
      try {
        const extension = extname(input).toLowerCase()
        if (!supportedExtensions.has(extension)) throw new Error('不支持的图片格式')
        const file = await stat(input)
        if (!file.isFile()) throw new Error('导入目标不是文件')
        const hash = await hashFile(input)
        const duplicateId = this.assets.findIdByHash(hash)
        if (duplicateId) result.duplicateIds.push(duplicateId)

        const id = nanoid(16)
        const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension
        managedPath = join(this.library.originals, `${id}${normalizedExtension}`)
        await copyFile(input, managedPath)
        const metadata = await sharp(managedPath, { animated: false, pages: 1 }).metadata()
        const width = metadata.autoOrient.width ?? metadata.width ?? 0
        const height = metadata.autoOrient.height ?? metadata.height ?? 0
        if (!width || !height) throw new Error('无法读取图片尺寸')

        const [thumbnails, palette] = await Promise.all([
          this.thumbnails.generate(id, managedPath),
          this.palette.analyze(managedPath)
        ])
        generatedPaths = thumbnails.map((thumbnail) => thumbnail.path)
        const importedAt = new Date().toISOString()
        const originalFilename = options.filenames?.get(input) ?? basename(input)
        this.assets.insert({
          id, filename: originalFilename, originalFilename, path: managedPath,
          thumbnailPath: thumbnails.find((thumbnail) => thumbnail.size === 'medium')?.path ?? thumbnails[0]?.path ?? managedPath,
          mimeType: mimeTypes[extension] ?? 'application/octet-stream', extension: normalizedExtension.slice(1),
          width, height, size: file.size, hash, importSource: source, createdAt: file.birthtime.toISOString(),
          importedAt, colors: palette.swatches, colorAnalysis: palette.analysis, thumbnails, folderId
        }, (assetId) => options.beforeCommit?.(input, assetId))
        const asset = this.assets.get(id)
        if (asset) result.imported.push(asset)
      } catch (error) {
        logger.error('Asset import failed', { input, error: serializeError(error) })
        await Promise.allSettled([...generatedPaths, ...(managedPath ? [managedPath] : [])].map((path) => unlink(path)))
        result.failures.push({ path: input, message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (result.imported.length) this.onImported?.(result.imported.map((asset) => asset.id))
    return result
  }
}
