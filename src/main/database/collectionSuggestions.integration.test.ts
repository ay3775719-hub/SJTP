import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { SmartCollectionRepository } from './repositories/SmartCollectionRepository'
import { CollectionSuggestionRepository } from './repositories/CollectionSuggestionRepository'
import { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import { CollectionSuggestionService } from '../services/smartCollections/CollectionSuggestionService'
import { rgbToLab } from '../services/thumbnails/PaletteService'
import { runTransaction } from './transaction'

describe('automatic collection suggestions', () => {
  let root = ''
  let database: DatabaseService | null = null
  afterEach(async () => { database?.close(); database = null; if (root) await rm(root, { recursive: true, force: true }) })

  it('aggregates real metadata, honors manual primary values/trash, creates saved queries, and persists ignores', async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-suggestions-'))
    database = new DatabaseService(join(root, 'muse.db'))
    const db = database.db
    for (let index = 0; index < 8; index += 1) insertAsset(db, `backpack-${index}`, 'backpack', '背包', index < 5 ? 'outdoor' : 'white_background', index < 5 ? '户外' : '白底', 'product_photography', '产品摄影', '#58A66C')
    for (let index = 0; index < 4; index += 1) insertAsset(db, `person-${index}`, 'person', '人物', 'indoor', '室内', 'lifestyle_photography', '生活方式摄影', '#808080')
    insertAsset(db, 'manual-override', 'backpack', '背包', 'outdoor', '户外', 'product_photography', '产品摄影', '#58A66C', { manualObject: ['suitcase', '行李箱'] })
    insertAsset(db, 'trashed-backpack', 'backpack', '背包', 'outdoor', '户外', 'product_photography', '产品摄影', '#58A66C', { deleted: true })

    const { suggestions, collections } = services(database)
    let result = suggestions.list()
    expect(result.items.find((item) => item.ruleSignature === 'aiObject=backpack')?.assetCount).toBe(8)
    expect(result.items.some((item) => item.name === '户外背包' && item.assetCount === 5)).toBe(true)
    expect(result.items.some((item) => item.name === '绿色背包')).toBe(true)
    expect(result.items.some((item) => item.name.includes('行李箱'))).toBe(false)

    const outdoor = result.items.find((item) => item.name === '户外背包')
    expect(outdoor).toBeTruthy()
    const created = suggestions.create(outdoor!.ruleSignature)
    expect(collections.list().find((item) => item.id === created.id)?.assetCount).toBe(5)
    suggestions.invalidate(); result = suggestions.list()
    expect(result.items.some((item) => item.ruleSignature === outdoor!.ruleSignature)).toBe(false)

    insertAsset(db, 'new-outdoor-backpack', 'backpack', '背包', 'outdoor', '户外', 'product_photography', '产品摄影', '#58A66C')
    suggestions.invalidate()
    expect(collections.list().find((item) => item.id === created.id)?.assetCount).toBe(6)

    const ignored = suggestions.list().items[0]
    expect(ignored).toBeTruthy()
    suggestions.ignore(ignored!.ruleSignature)
    expect(suggestions.list().items.some((item) => item.ruleSignature === ignored!.ruleSignature)).toBe(false)

    database.close(); database = new DatabaseService(join(root, 'muse.db'))
    const reopened = services(database).suggestions
    expect(reopened.list().items.some((item) => item.ruleSignature === ignored!.ruleSignature)).toBe(false)
    expect(reopened.listIgnored().find((item) => item.ruleSignature === ignored!.ruleSignature)?.restoredAt).toBeNull()
    reopened.restore(ignored!.ruleSignature)
    expect(reopened.list().items.some((item) => item.ruleSignature === ignored!.ruleSignature)).toBe(true)
  })

  it('keeps 10k metadata aggregation off the renderer and within an interactive budget', async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-suggestions-10k-'))
    database = new DatabaseService(join(root, 'muse.db'))
    const db = database.db
    runTransaction(db, () => {
      for (let index = 0; index < 10_000; index += 1) {
        const object = index % 3 === 0 ? ['backpack', '背包'] : index % 3 === 1 ? ['chair', '椅子'] : ['poster', '海报']
        const scene = index % 2 === 0 ? ['outdoor', '户外'] : ['indoor', '室内']
        const style = index % 4 === 0 ? ['product_photography', '产品摄影'] : ['lifestyle_photography', '生活方式摄影']
        insertAsset(db, `perf-${index}`, object[0]!, object[1]!, scene[0]!, scene[1]!, style[0]!, style[1]!, null)
      }
    })
    const service = services(database).suggestions
    const started = performance.now(), result = service.list(), durationMs = performance.now() - started
    console.log(`10k collection suggestions: ${durationMs.toFixed(1)}ms, ${result.items.length} suggestions`)
    expect(result.items.length).toBeGreaterThan(0)
    expect(durationMs).toBeLessThan(5_000)
    const cachedStarted = performance.now(); service.list()
    expect(performance.now() - cachedStarted).toBeLessThan(10)
  }, 30_000)
})

function services(database: DatabaseService) {
  const assets = new AssetRepository(database.db, (path) => path)
  const collections = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
  return { collections, suggestions: new CollectionSuggestionService(new CollectionSuggestionRepository(database.db), assets, collections) }
}

function insertAsset(db: DatabaseService['db'], id: string, objectKey: string, objectLabel: string, sceneKey: string, sceneLabel: string, styleKey: string, styleLabel: string, color: string | null, options: { deleted?: boolean; manualObject?: [string, string] } = {}): void {
  const now = new Date().toISOString(), assetId = `asset-${id}`
  db.prepare(`INSERT INTO assets(id,filename,original_filename,path,mime_type,extension,width,height,size,hash,favorite,rating,import_source,created_at,updated_at,imported_at,deleted_at)
    VALUES(?,?,?,?,'image/png','png',1200,900,1000,?,0,0,'local',?,?,?,?)`)
    .run(assetId, `${id}.png`, `${id}.png`, join(tmpdir(), `${id}.png`), `hash-${id}`, now, now, now, options.deleted ? now : null)
  db.prepare(`INSERT INTO asset_ai_analysis(asset_id,status,provider,model,schema_version,result_version,primary_object,primary_object_label,primary_object_confidence,primary_scene,primary_scene_label,primary_scene_confidence,primary_style,primary_style_label,primary_style_confidence,description,updated_at)
    VALUES(?,'completed','codex-chatgpt','test',2,2,?,?,.95,?,?,.95,?,?,.95,'测试素材',?)`).run(assetId, objectKey, objectLabel, sceneKey, sceneLabel, styleKey, styleLabel, now)
  const insertTerm = db.prepare(`INSERT INTO asset_ai_terms(id,asset_id,type,value,normalized_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,?,'ai',?,?)`)
  insertTerm.run(nanoid(), assetId, 'object', objectLabel, objectKey, .95, now, now)
  insertTerm.run(nanoid(), assetId, 'scene', sceneLabel, sceneKey, .95, now, now)
  insertTerm.run(nanoid(), assetId, 'style', styleLabel, styleKey, .95, now, now)
  if (options.manualObject) db.prepare(`INSERT INTO asset_ai_terms(id,asset_id,type,value,normalized_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,1,'manual',?,?)`).run(nanoid(), assetId, 'object', options.manualObject[1], options.manualObject[0], now, now)
  if (color) {
    const rgb = { r: Number.parseInt(color.slice(1, 3), 16), g: Number.parseInt(color.slice(3, 5), 16), b: Number.parseInt(color.slice(5, 7), 16) }, lab = rgbToLab(rgb.r, rgb.g, rgb.b)
    db.prepare(`INSERT INTO asset_colors(asset_id,position,hex,population,ratio,hue,saturation,lightness,lab_l,lab_a,lab_b) VALUES(?,0,?,.4,.4,135,.32,.5,?,?,?)`).run(assetId, color, lab.l, lab.a, lab.b)
  }
}
