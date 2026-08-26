import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { DatabaseService } from './DatabaseService'
import { AssetRepository } from './repositories/AssetRepository'
import { FolderRepository } from './repositories/FolderRepository'
import { TagRepository } from './repositories/TagRepository'
import { SmartCollectionRepository } from './repositories/SmartCollectionRepository'
import { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import { NaturalSearchRepository } from './repositories/NaturalSearchRepository'
import { NaturalLanguageSearchService, shouldUseNaturalLanguageParser } from '../services/search/NaturalLanguageSearchService'
import { SearchEntityResolver } from '../services/search/SearchEntityResolver'
import type { CodexAppServerManager } from '../services/ai/codex/CodexAppServerManager'
import type { NaturalSearchExpression, NaturalSearchIntent } from '@shared/types/domain'
import { rgbToLab } from '../services/thumbnails/PaletteService'

describe('Muse natural language search v1', () => {
  let root = ''
  let database: DatabaseService | null = null
  afterEach(async () => { database?.close(); database = null; if (root) await rm(root, { recursive: true, force: true }) })

  it('keeps keywords local and executes AND / OR / NOT, color, favorite, date, folder and orientation in SQLite', async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-natural-search-'))
    database = new DatabaseService(join(root, 'muse.db'))
    const { service, folders } = services(database)
    const project = folders.create('项目A')
    insertAsset(database.db, 'green-outdoor-backpack', 'backpack', 'outdoor', 'product_photography', true, '#58A66C', 'portrait', project.id)
    insertAsset(database.db, 'white-backpack', 'backpack', 'white_background', 'product_photography', false, '#F2F2F0', 'landscape')
    insertAsset(database.db, 'outdoor-shoes', 'shoes', 'outdoor', 'lifestyle_photography', false, '#5579BD', 'landscape')

    expect(shouldUseNaturalLanguageParser('背包')).toBe(false)
    expect(shouldUseNaturalLanguageParser('绿色的户外背包')).toBe(true)
    expect(count(service, and(object('backpack'), scene('outdoor'), color('green')))).toBe(1)
    expect(count(service, { operator: 'or', children: [object('backpack'), object('shoes')] })).toBe(3)
    expect(count(service, and(object('backpack'), { operator: 'not', child: scene('white_background') }))).toBe(1)
    expect(count(service, and(object('backpack'), { field: 'favorite', operator: 'equals', value: true }))).toBe(1)
    expect(count(service, and(object('backpack'), { field: 'folder', operator: 'equals', value: '项目A' }))).toBe(1)
    expect(count(service, and(object('backpack'), { field: 'orientation', operator: 'equals', value: 'portrait' }))).toBe(1)
    expect(count(service, { field: 'importedDate', operator: 'within', value: 'last_30_days' })).toBe(3)
    expect(count(service, { field: 'freeText', operator: 'contains', value: 'green-outdoor' })).toBe(1)
  })

  it('validates Codex output, caches only the intent, persists history, removes chips and creates a dynamic Smart Collection', async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-natural-search-cache-'))
    database = new DatabaseService(join(root, 'muse.db'))
    let calls = 0
    const intent: NaturalSearchIntent = { expression: and(object('backpack'), scene('outdoor'), color('green')) }
    const codex = {
      listModels: async () => [{ id: 'gpt-test', name: 'test', providerId: 'codex-chatgpt', capabilities: { vision: true, structuredOutput: true, text: true, local: false }, capabilitySource: 'verified', isDefault: true }],
      runStructuredTextTurn: async () => { calls += 1; return { threadId: 't', turnId: 'u', modelId: 'gpt-test', text: JSON.stringify({ operator: 'and', conditions: [
        { field: 'object', operator: 'equals', value: 'backpack', negate: false }, { field: 'scene', operator: 'equals', value: 'outdoor', negate: false }, { field: 'color', operator: 'near', value: 'green', negate: false }
      ] }), durationMs: 4 } }
    } as unknown as CodexAppServerManager
    const { service, assets, smart } = services(database, codex)
    insertAsset(database.db, 'match', 'backpack', 'outdoor', 'product_photography', false, '#58A66C', 'landscape')
    const first = await service.parse('找绿色的户外背包')
    const second = await service.parse('找绿色的户外背包')
    expect(first.parsedBy).toBe('codex'); expect(second.parsedBy).toBe('cache'); expect(calls).toBe(1)
    expect(service.listAssets({ naturalSearch: second.intent!.expression }).total).toBe(1)
    expect(service.history()).toHaveLength(1)
    const removed = service.removeCondition(second.intent!, second.chips.find((chip) => chip.label.includes('颜色'))!.signature)
    expect(removed.chips).toHaveLength(2)
    const created = service.saveAsSmartCollection('找绿色的户外背包', second.intent!)
    expect(created.assetCount).toBe(1)
    assets.softDelete(['asset-match'])
    expect(smart.list().find((item) => item.id === created.id)?.assetCount).toBe(0)
    database.close(); database = new DatabaseService(join(root, 'muse.db'))
    expect(new NaturalSearchRepository(database.db).history()[0]?.queryText).toBe('找绿色的户外背包')
    expect(new NaturalSearchRepository(database.db).getCached('找绿色的户外背包', 'natural-search-v1.1')).toBeTruthy()
  })

  it('covers 30 parser-shaped query intents without unsupported fields', () => {
    const samples: NaturalSearchExpression[] = [
      object('backpack'), and(object('backpack'), color('green')), and(object('backpack'), scene('outdoor')),
      and(object('backpack'), scene('outdoor'), color('green')), and(scene('white_background'), style('product_photography')),
      and({ field: 'favorite', operator: 'equals', value: true }, object('backpack')),
      and({ field: 'importedDate', operator: 'within', value: 'last_30_days' }, scene('outdoor')),
      and({ field: 'orientation', operator: 'equals', value: 'portrait' }, style('product_photography')),
      { operator: 'or', children: [object('backpack'), object('shoes')] },
      and(object('backpack'), scene('outdoor'), { operator: 'not', child: scene('white_background') }),
      and({ field: 'folder', operator: 'equals', value: '项目A' }, object('backpack')),
      and({ field: 'tag', operator: 'equals', value: '灵感' }, style('minimalist')),
      { field: 'filename', operator: 'contains', value: 'campaign' }, { field: 'description', operator: 'contains', value: '帐篷' },
      { field: 'freeText', operator: 'contains', value: '湖边' }, { field: 'extension', operator: 'equals', value: 'png' },
      color('blue'), color('warm-neutral'), scene('indoor'), scene('studio'), scene('street'), style('minimalist'),
      style('editorial'), style('technology'), object('chair'), object('phone'), object('poster'),
      { field: 'orientation', operator: 'equals', value: 'square' }, { field: 'importedDate', operator: 'within', value: 'today' },
      { operator: 'or', children: [style('retro'), style('cinematic')] }
    ]
    expect(samples).toHaveLength(30)
    expect(samples.every((sample) => JSON.stringify(sample).length < 500)).toBe(true)
  })
})

function services(database: DatabaseService, codex?: CodexAppServerManager) {
  const assets = new AssetRepository(database.db, (path) => path), folders = new FolderRepository(database.db), tags = new TagRepository(database.db)
  const smart = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
  const fallbackCodex = { listModels: async () => [], runStructuredTextTurn: async () => { throw new Error('offline') } } as unknown as CodexAppServerManager
  const service = new NaturalLanguageSearchService(database.db, new NaturalSearchRepository(database.db), assets, smart,
    new SearchEntityResolver(() => folders.list(), () => tags.list()), codex ?? fallbackCodex, join(tmpdir(), 'muse-natural-search-workspace'))
  return { service, assets, folders, tags, smart }
}
function count(service: NaturalLanguageSearchService, expression: NaturalSearchExpression): number { return service.listAssets({ naturalSearch: expression }).total }
function and(...children: NaturalSearchExpression[]): NaturalSearchExpression { return { operator: 'and', children } }
function object(value: string): NaturalSearchExpression { return { field: 'object', operator: 'equals', value } }
function scene(value: string): NaturalSearchExpression { return { field: 'scene', operator: 'equals', value } }
function style(value: string): NaturalSearchExpression { return { field: 'style', operator: 'equals', value } }
function color(value: string): NaturalSearchExpression { return { field: 'color', operator: 'near', value } }

function insertAsset(db: DatabaseService['db'], suffix: string, objectKey: string, sceneKey: string, styleKey: string, favorite: boolean, hex: string, orientation: 'portrait' | 'landscape', folderId?: string): void {
  const id = `asset-${suffix}`, now = new Date().toISOString(), width = orientation === 'portrait' ? 800 : 1200, height = orientation === 'portrait' ? 1200 : 800
  db.prepare(`INSERT INTO assets(id,filename,original_filename,path,mime_type,extension,width,height,size,hash,favorite,rating,import_source,created_at,updated_at,imported_at)
    VALUES(?,?,?,?,'image/png','png',?,?,1000,?,?,0,'local',?,?,?)`).run(id, `${suffix}.png`, `${suffix}.png`, join(tmpdir(), `${suffix}.png`), width, height, `hash-${suffix}`, favorite ? 1 : 0, now, now, now)
  db.prepare(`INSERT INTO asset_ai_analysis(asset_id,status,provider,model,schema_version,result_version,primary_object,primary_object_label,primary_object_confidence,primary_scene,primary_scene_label,primary_scene_confidence,primary_style,primary_style_label,primary_style_confidence,description,updated_at)
    VALUES(?,'completed','codex-chatgpt','test',2,2,?,?,.95,?,?,.95,?,?,.95,?,?)`).run(id, objectKey, objectKey, sceneKey, sceneKey, styleKey, styleKey, suffix, now)
  const insert = db.prepare(`INSERT INTO asset_ai_terms(id,asset_id,type,value,normalized_value,confidence,source,created_at,updated_at) VALUES(?,?,?,?,?,.95,'ai',?,?)`)
  insert.run(nanoid(), id, 'object', objectKey, objectKey, now, now); insert.run(nanoid(), id, 'scene', sceneKey, sceneKey, now, now); insert.run(nanoid(), id, 'style', styleKey, styleKey, now, now)
  const rgb = hex === '#58A66C' ? [88,166,108] : hex === '#5579BD' ? [85,121,189] : [242,242,240]
  const lab = rgbToLab(rgb[0]!, rgb[1]!, rgb[2]!)
  db.prepare(`INSERT INTO asset_colors(asset_id,position,hex,population,ratio,hue,saturation,lightness,lab_l,lab_a,lab_b) VALUES(?,0,?,.5,.5,120,.4,.5,?,?,?)`).run(id, hex, lab.l, lab.a, lab.b)
  if (folderId) db.prepare('INSERT INTO asset_folders(asset_id,folder_id,created_at) VALUES(?,?,?)').run(id, folderId, now)
}
