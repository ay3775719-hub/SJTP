import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { runTransaction } from '../../database/transaction'
import { logger, serializeError } from '../../logger'

interface LegacyWebpAsset {
  id: string
  path: string
  filename: string
  originalFilename: string
}

export class WebAssetFormatNormalizer {
  constructor(private readonly db: DatabaseSync, private readonly backupRoot: string) {}

  async normalizeLegacyAssets(): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT id,path,filename,original_filename AS originalFilename
      FROM assets
      WHERE import_source='browser_extension' AND extension='webp'
      ORDER BY imported_at,id
    `).all() as unknown as LegacyWebpAsset[]
    if (!rows.length) return []

    const backupDirectory = join(this.backupRoot, 'web-collector-originals')
    await mkdir(backupDirectory, { recursive: true })
    const normalized: string[] = []
    for (const row of rows) {
      try {
        if (await this.normalizeOne(row, backupDirectory)) normalized.push(row.id)
      } catch (error) {
        logger.warn('Legacy web asset format normalization failed', { assetId: row.id, error: serializeError(error) })
      }
    }
    if (normalized.length) logger.info('Legacy web assets normalized for compatibility', { count: normalized.length })
    return normalized
  }

  private async normalizeOne(row: LegacyWebpAsset, backupDirectory: string): Promise<boolean> {
    const sourceBytes = await readFile(row.path)
    const sourceMetadata = await sharp(sourceBytes, { animated: true }).metadata()
    if ((sourceMetadata.pages ?? 1) > 1) return false

    const extension = sourceMetadata.hasAlpha ? 'png' : 'jpg'
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg'
    const targetPath = join(dirname(row.path), `${row.id}.${extension}`)
    const temporaryPath = `${targetPath}.normalizing-${process.pid}`
    const backupPath = join(backupDirectory, `${row.id}.webp`)

    await copyFile(row.path, backupPath, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    await unlink(temporaryPath).catch(() => undefined)
    const image = sharp(sourceBytes, { animated: false, pages: 1 }).rotate()
    if (extension === 'png') await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(temporaryPath)
    else await image.jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(temporaryPath)

    const [file, metadata, hash] = await Promise.all([stat(temporaryPath), sharp(temporaryPath).metadata(), sha256(temporaryPath)])
    if (!metadata.width || !metadata.height) { await unlink(temporaryPath); throw new Error('Normalized image has invalid dimensions') }
    await unlink(targetPath).catch(() => undefined)
    await rename(temporaryPath, targetPath)

    const filename = replaceExtension(row.filename, extension)
    const originalFilename = replaceExtension(row.originalFilename, extension)
    try {
      runTransaction(this.db, () => {
        this.db.prepare(`UPDATE assets SET filename=?,original_filename=?,path=?,mime_type=?,extension=?,width=?,height=?,size=?,hash=?,updated_at=? WHERE id=?`)
          .run(filename, originalFilename, targetPath, mimeType, extension, metadata.width, metadata.height, file.size, hash, new Date().toISOString(), row.id)
        this.db.prepare('UPDATE assets_fts SET filename=? WHERE asset_id=?').run(filename, row.id)
        this.db.prepare("UPDATE asset_embeddings SET status='stale',vector_blob=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE asset_id=?")
          .run(new Date().toISOString(), row.id)
      })
    } catch (error) {
      await unlink(targetPath).catch(() => undefined)
      throw error
    }
    await unlink(row.path)
    return true
  }
}

function replaceExtension(filename: string, extension: string): string {
  const current = extname(filename)
  const base = current ? filename.slice(0, -current.length) : basename(filename)
  return `${base}.${extension}`
}

const sha256 = (path: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256'), stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex')))
})
