import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { ThumbnailSize } from '@shared/types/domain'

const widths: Record<ThumbnailSize, number> = { small: 320, medium: 720, large: 1440 }

export interface GeneratedThumbnail {
  size: ThumbnailSize
  path: string
  width: number
  height: number
  bytes: number
}

export class ThumbnailService {
  constructor(private readonly thumbnailsRoot: string) {}

  async generate(assetId: string, sourcePath: string): Promise<GeneratedThumbnail[]> {
    const directory = join(this.thumbnailsRoot, assetId.slice(0, 2))
    await mkdir(directory, { recursive: true })

    return Promise.all((Object.keys(widths) as ThumbnailSize[]).map(async (size) => {
      const outputPath = join(directory, `${assetId}-${size}.webp`)
      const metadata = await sharp(sourcePath, { animated: false, pages: 1 })
        .rotate()
        .resize({ width: widths[size], withoutEnlargement: true })
        .webp({ quality: size === 'large' ? 88 : 82, effort: 4 })
        .toFile(outputPath)
      const file = await stat(outputPath)
      return { size, path: outputPath, width: metadata.width, height: metadata.height, bytes: file.size }
    }))
  }

  async ensureParent(outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true })
  }
}
