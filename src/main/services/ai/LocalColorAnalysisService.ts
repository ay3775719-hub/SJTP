import type { AssetRepository } from '../../database/repositories/AssetRepository'
import { logger, serializeError } from '../../logger'
import { PaletteService } from '../thumbnails/PaletteService'

export class LocalColorAnalysisService {
  private readonly palette = new PaletteService()
  private running = false

  constructor(private readonly assets: AssetRepository, private readonly onChanged: (assetId: string) => void) {}

  startBackfill(): void {
    if (this.running) return
    this.running = true
    void this.run()
  }

  private async run(): Promise<void> {
    const attempted = new Set<string>()
    try {
      while (true) {
        const missing = this.assets.listMissingColorAnalysis(100).filter((asset) => !attempted.has(asset.id)).slice(0, 20)
        if (!missing.length) break
        for (const asset of missing) {
          attempted.add(asset.id)
          try { this.assets.saveColorAnalysis(asset.id, await this.palette.analyze(asset.path)); this.onChanged(asset.id) }
          catch (error) { logger.warn('Local color analysis failed', { assetId: asset.id, error: serializeError(error) }) }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
    } finally { this.running = false }
  }
}
