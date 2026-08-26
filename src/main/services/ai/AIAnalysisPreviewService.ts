import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export class AIAnalysisPreviewService {
  async createFile(path: string, directory: string, fileName: string): Promise<string> {
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${fileName}.jpg`)
    await this.pipeline(path).toFile(destination)
    return destination
  }

  async createDataUrl(path: string): Promise<{ dataUrl: string; mimeType: 'image/jpeg' }> {
    const buffer = await this.pipeline(path).toBuffer()
    return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`, mimeType: 'image/jpeg' }
  }

  private pipeline(path: string): sharp.Sharp {
    return sharp(path, { animated: false, pages: 1 })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
  }
}
