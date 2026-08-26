import { describe, expect, it } from 'vitest'
import { AssetRepository } from '../../../database/repositories/AssetRepository'
import { DatabaseService } from '../../../database/DatabaseService'

const databasePath = process.env.MUSE_LEGACY_AI_DATABASE

describe.skipIf(!databasePath)('Minimal AI historical compatibility', () => {
  it('derives one primary object, scene and style without deleting rich legacy terms', () => {
    const database = new DatabaseService(databasePath!)
    try {
      const assets = new AssetRepository(database.db, (path) => path).list({ limit: 100 }).items
      expect(assets.length).toBeGreaterThan(0)
      expect(assets.every((asset) => asset.ai?.resultVersion === 1)).toBe(true)
      expect(assets.every((asset) => asset.ai?.primaryObject && asset.ai.primaryScene && asset.ai.primaryStyle)).toBe(true)
      expect(assets.some((asset) => (asset.ai?.termGroups.lighting.length ?? 0) > 0)).toBe(true)
      process.stdout.write(`\nMINIMAL_HISTORY_QA ${JSON.stringify({ assets: assets.length, first: { object: assets[0]?.ai?.primaryObject?.value, scene: assets[0]?.ai?.primaryScene?.value, style: assets[0]?.ai?.primaryStyle?.value } })}\n`)
    } finally { database.close() }
  })
})
