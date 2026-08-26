import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { DatabaseService } from '../../../database/DatabaseService'
import { AIAnalysisRepository } from '../../../database/repositories/AIAnalysisRepository'
import { AssetRepository } from '../../../database/repositories/AssetRepository'
import { SmartCollectionQueryBuilder } from '../../smartCollections/SmartCollectionQueryBuilder'

const enabled = process.env.MUSE_REAL_CODEX_PERSISTENCE === '1'
const libraryPath = process.env.MUSE_REAL_LIBRARY || 'D:\\桌面\\图片\\Muse Library'

describe.skipIf(!enabled)('Codex persisted Library verification', () => {
  it('restores results and exposes them through Search and Smart Collection SQL', () => {
    const database = new DatabaseService(join(libraryPath, 'muse.db'))
    try {
      const assets = new AssetRepository(database.db, (path) => path)
      const analyses = new AIAnalysisRepository(database.db)
      const completed = database.db.prepare(`
        SELECT asset_id FROM asset_ai_analysis
        WHERE status='completed' AND provider='codex-chatgpt'
      `).all() as unknown as Array<{ asset_id: string }>
      expect(completed).toHaveLength(20)
      for (const row of completed) {
        const analysis = analyses.get(row.asset_id)
        expect(analysis).toMatchObject({ status: 'completed', provider: 'codex-chatgpt', model: 'gpt-5.6-sol' })
        expect(analysis?.description?.length).toBeGreaterThan(10)
        expect(analysis?.promptVersion).toMatch(/^codex-(batch-v1|minimal-v2)\./)
      }

      const search = assets.list({ search: '背包', limit: 100 })
      expect(search.total).toBeGreaterThan(0)
      expect(search.items.some((asset) => asset.ai?.termGroups.object.some((item) => item.value.includes('背包')))).toBe(true)

      const predicate = new SmartCollectionQueryBuilder().build({
        name: 'Codex 背包 QA',
        matchMode: 'all',
        rules: [{ id: 'codex-qa-object', field: 'aiObject', operator: 'contains', value: '背包' }]
      })
      const smart = assets.listWithPredicate({ limit: 100 }, predicate)
      expect(smart.total).toBeGreaterThan(0)
      expect(smart.items.every((asset) => asset.ai?.termGroups.object.some((item) => item.value.includes('背包')))).toBe(true)

      process.stdout.write(`\nCODEX_PERSISTENCE_QA ${JSON.stringify({ completed: completed.length, searchMatches: search.total, smartCollectionMatches: smart.total })}\n`)
    } finally {
      database.close()
    }
  })
})
