import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportResult } from '@shared/types/domain'
import { MuseError } from '../../errors'
import { logger, serializeError } from '../../logger'
import type { AssetImporter } from '../assets/AssetImporter'
import type { LibraryDirectories } from '../filesystem/LibraryPaths'

export interface ClipboardImageReader {
  readImagePng(): Buffer | null
  readImageFiles(): Promise<string[]>
}

export class ClipboardImportService {
  private importing = false

  constructor(
    private readonly reader: ClipboardImageReader,
    private readonly importer: AssetImporter,
    private readonly library: LibraryDirectories
  ) {}

  async import(folderId?: string): Promise<ImportResult> {
    if (this.importing) throw new MuseError('CLIPBOARD_BUSY', '正在导入剪贴板图片，请稍候')
    this.importing = true
    try {
      const png = this.reader.readImagePng()
      const files = await this.reader.readImageFiles()
      // File copies preserve the original format, filename, and animation.
      if (files.length) return await this.importer.import(files, 'clipboard', folderId)
      if (!png?.length) throw new MuseError('CLIPBOARD_EMPTY', '剪贴板中没有图片，请先复制图片或截图')

      const directory = await mkdtemp(join(this.library.cache, 'clipboard-'))
      const filename = `粘贴图片_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      const path = join(directory, filename)
      try {
        await writeFile(path, png, { flag: 'wx' })
        return await this.importer.import([path], 'clipboard', folderId)
      } finally {
        try { await unlink(path) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('Clipboard image cleanup failed', serializeError(error))
        }
        try { await rmdir(directory) } catch (error) { logger.warn('Clipboard directory cleanup failed', serializeError(error)) }
      }
    } finally { this.importing = false }
  }
}
