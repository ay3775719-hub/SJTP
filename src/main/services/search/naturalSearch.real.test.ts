import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseService } from '../../database/DatabaseService'
import { AssetRepository } from '../../database/repositories/AssetRepository'
import { FolderRepository } from '../../database/repositories/FolderRepository'
import { TagRepository } from '../../database/repositories/TagRepository'
import { NaturalSearchRepository } from '../../database/repositories/NaturalSearchRepository'
import { SmartCollectionRepository } from '../../database/repositories/SmartCollectionRepository'
import { SmartCollectionService } from '../smartCollections/SmartCollectionService'
import { CodexAppServerManager } from '../ai/codex/CodexAppServerManager'
import { SearchEntityResolver } from './SearchEntityResolver'
import { NaturalLanguageSearchService } from './NaturalLanguageSearchService'

const run = process.env.MUSE_RUN_REAL_NATURAL_SEARCH === '1'
const libraryPath = process.env.MUSE_REAL_LIBRARY_DB ?? 'D:\\桌面\\图片\\Muse Library\\muse.db'
const userData = process.env.APPDATA ? join(process.env.APPDATA, 'muse-visual-library') : ''
const manager = run ? new CodexAppServerManager({ userDataPath: userData, resourcesPath: process.cwd(), projectRoot: process.cwd() }) : null
let database: DatabaseService | null = null
afterAll(async () => { database?.close(); await manager?.shutdown() })

const samples = [
  ['背包', []], ['绿色的背包', ['对象：背包','颜色：绿色']], ['户外背包', ['对象：背包','场景：户外']],
  ['绿色的户外背包', ['对象：背包','场景：户外','颜色：绿色']], ['白底产品摄影', ['场景：白底','风格：产品摄影']],
  ['我收藏的背包', ['已收藏','对象：背包']], ['最近30天导入的户外图片', ['时间：最近 30 天','场景：户外']],
  ['竖版的产品摄影', ['方向：竖版','风格：产品摄影']], ['背包或者鞋', ['对象：背包','对象：鞋']],
  ['找户外背包，但不要白底', ['对象：背包','场景：户外','排除 · 场景：白底']],
  ['找项目A里面的背包', ['文件夹：项目A','对象：背包']], ['标签为灵感的极简图片', ['标签：灵感','风格：极简']],
  ['文件名包含 campaign 的图', ['文件名：campaign']], ['有帐篷的背包图', ['对象：背包','帐篷']],
  ['湖边的图片', ['文本：湖边']], ['PNG 格式的素材', ['格式：PNG']], ['蓝色产品摄影', ['颜色：蓝色','风格：产品摄影']],
  ['暖色极简图片', ['颜色：暖中性色','风格：极简']], ['室内家具', ['场景：室内','对象：家具']],
  ['工作室里的鞋', ['场景：工作室','对象：鞋']], ['街道上的人物', ['场景：街道','对象：人物']],
  ['极简沙发', ['风格：极简','对象：沙发']], ['Editorial 海报', ['风格：Editorial','对象：海报']],
  ['科技感手机', ['风格：科技感','对象：手机']], ['方形包装图片', ['方向：方形','对象：包装']],
  ['今天导入的图片', ['时间：今天']], ['收藏的白底产品摄影', ['已收藏','场景：白底','风格：产品摄影']],
  ['复古或者电影感的图', ['风格：复古','风格：电影感']], ['不要室内的背包', ['对象：背包','排除 · 场景：室内']],
  ['最近7天的绿色竖版图片', ['时间：最近 7 天','颜色：绿色','方向：竖版']]
] as const

describe.runIf(run)('real Codex natural-search parser and live Library query', () => {
  it('parses 30 real requests and executes each intent against the current SQLite Library', async () => {
    database = new DatabaseService(libraryPath)
    const assets = new AssetRepository(database.db, (path) => path), folders = new FolderRepository(database.db), tags = new TagRepository(database.db)
    const smart = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
    const service = new NaturalLanguageSearchService(database.db, new NaturalSearchRepository(database.db), assets, smart,
      new SearchEntityResolver(() => folders.list(), () => tags.list()), manager!, join(userData, 'codex-search-workspace'))
    const limit = Math.min(samples.length, Number(process.env.MUSE_REAL_NATURAL_LIMIT ?? samples.length))
    const report = []
    for (const [query, expected] of samples.slice(0, limit)) {
      const started = performance.now(), result = await service.parse(query)
      const count = result.intent ? service.listAssets({ naturalSearch: result.intent.expression, limit: 1 }).total : assets.list({ search: query, limit: 1 }).total
      const labels = result.chips.map((chip) => `${chip.negative ? '排除 · ' : ''}${chip.label}`)
      const correct = expected.every((label) => labels.some((actual) => actual.includes(label))) && (query === '背包' ? result.mode === 'direct' : result.mode === 'natural')
      report.push({ query, expected, mode: result.mode, parsedBy: result.parsedBy, model: result.model, labels, correct, resultCount: count, parseMs: Math.round(performance.now() - started), warning: result.warning })
      console.log(`[natural-search] ${report.length}/${limit} ${query}: ${labels.join(' | ') || result.mode} -> ${count}`)
    }
    const output = { generatedAt: new Date().toISOString(), libraryPath, samples: report, accuracy: report.filter((item) => item.correct).length / report.length,
      averageParseMs: report.reduce((sum, item) => sum + item.parseMs, 0) / report.length }
    const outputPath = join(process.cwd(), 'design-qa-artifacts', 'natural-search-real-report.json')
    await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8')
    expect(report).toHaveLength(limit)
    expect(report.every((item) => item.mode !== 'fallback')).toBe(true)
  }, 15 * 60_000)
})
