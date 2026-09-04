import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { AIAnalysisStatus, AIMetadata, AITermType, AIValue, Asset, AssetPage, AssetQuery, ColorAnalysis, ColorSwatch, Tag } from '@shared/types/domain'
import { runTransaction } from '../transaction'
import type { SqlPredicate } from '../../services/smartCollections/SmartCollectionQueryBuilder'
import { rgbToLab } from '../../services/thumbnails/PaletteService'
import type { PaletteResult } from '../../services/thumbnails/PaletteService'

interface AssetRow {
  id: string
  filename: string
  original_filename: string
  path: string
  thumbnail_path: string | null
  mime_type: string
  extension: string
  width: number
  height: number
  size: number
  favorite: number
  rating: number
  created_at: string
  imported_at: string
  last_opened_at: string | null
  source_url: string | null
  source_domain: string | null
  source_title: string | null
  source_author: string | null
  source_saved_at: string | null
  import_source: Asset['importSource']
  ai_status: AIAnalysisStatus | null
  ai_provider: string | null
  ai_model: string | null
  ai_schema_version: number | null
  ai_prompt_version: string | null
  ai_result_version: number | null
  primary_object: string | null; primary_object_label: string | null; primary_object_confidence: number | null
  primary_scene: string | null; primary_scene_label: string | null; primary_scene_confidence: number | null
  primary_style: string | null; primary_style_label: string | null; primary_style_confidence: number | null
  ai_description: string | null
  primary_category: string | null; primary_category_label: string | null; primary_category_confidence: number | null
  secondary_category: string | null; secondary_category_label: string | null; secondary_category_confidence: number | null
  tertiary_category: string | null; tertiary_category_label: string | null; tertiary_category_confidence: number | null
  overall_confidence: number | null
  ai_started_at: string | null
  analyzed_at: string | null
  ai_updated_at: string | null
  ai_error_message: string | null
  ai_retry_count: number | null
}

export interface NewAssetRecord {
  id: string
  filename: string
  originalFilename: string
  path: string
  thumbnailPath: string
  mimeType: string
  extension: string
  width: number
  height: number
  size: number
  hash: string
  importSource: Asset['importSource']
  createdAt: string
  importedAt: string
  colors: ColorSwatch[]
  colorAnalysis: ColorAnalysis
  thumbnails: Array<{ size: string; path: string; width: number; height: number; bytes: number }>
  folderId?: string
}

const parseStringArray = (value: string | null): string[] => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export class AssetRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly toLocalUrl: (absolutePath: string) => string
  ) {}

  findIdByHash(hash: string): string | null {
    const row = this.db.prepare('SELECT id FROM assets WHERE hash = ?').get(hash) as unknown as { id: string } | undefined
    return row?.id ?? null
  }

  insert(record: NewAssetRecord, beforeCommit?: (assetId: string) => void): void {
    runTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO assets (
          id, filename, original_filename, path, thumbnail_path, mime_type, extension,
          width, height, size, hash, import_source, created_at, updated_at, imported_at
        ) VALUES (
          @id, @filename, @originalFilename, @path, @thumbnailPath, @mimeType, @extension,
          @width, @height, @size, @hash, @importSource, @createdAt, @importedAt, @importedAt
        )
      `).run({
        id: record.id,
        filename: record.filename,
        originalFilename: record.originalFilename,
        path: record.path,
        thumbnailPath: record.thumbnailPath,
        mimeType: record.mimeType,
        extension: record.extension,
        width: record.width,
        height: record.height,
        size: record.size,
        hash: record.hash,
        importSource: record.importSource,
        createdAt: record.createdAt,
        importedAt: record.importedAt
      })

      const thumbnailStatement = this.db.prepare(`
        INSERT INTO thumbnails (asset_id, size_key, path, width, height, bytes, created_at)
        VALUES (@assetId, @size, @path, @width, @height, @bytes, @createdAt)
      `)
      for (const thumbnail of record.thumbnails) {
        thumbnailStatement.run({ ...thumbnail, assetId: record.id, createdAt: record.importedAt })
      }

      const colorStatement = this.db.prepare(`
        INSERT INTO asset_colors (asset_id, position, hex, population, ratio, hue, saturation, lightness, lab_l, lab_a, lab_b)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      record.colors.forEach((color, position) => {
        const rgb = hexToRgb(color.hex), lab = rgbToLab(rgb.r, rgb.g, rgb.b)
        colorStatement.run(record.id, position, color.hex, color.population ?? null, color.ratio ?? color.population ?? null,
          color.hue ?? null, color.saturation ?? null, color.lightness ?? null, lab.l, lab.a, lab.b)
      })
      this.db.prepare(`INSERT INTO asset_color_analysis (asset_id,average_hex,brightness,saturation,temperature,analyzed_at) VALUES (?,?,?,?,?,?)`)
        .run(record.id, record.colorAnalysis.averageHex, record.colorAnalysis.brightness, record.colorAnalysis.saturation, record.colorAnalysis.temperature, record.importedAt)

      if (record.folderId) {
        this.db.prepare('INSERT INTO asset_folders (asset_id, folder_id, created_at) VALUES (?, ?, ?)')
          .run(record.id, record.folderId, record.importedAt)
      }
      this.db.prepare('INSERT INTO assets_fts (asset_id, filename, description, tags, folders) VALUES (?, ?, ?, ?, ?)')
        .run(record.id, record.filename, '', '', '')
      beforeCommit?.(record.id)
    })
  }

  list(query: AssetQuery = {}): AssetPage { return this.listWithPredicate(query) }

  countWithPredicate(predicate: SqlPredicate): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id WHERE a.deleted_at IS NULL AND ${predicate.sql}`).get(predicate.params) as unknown as { count: number }).count
  }

  listIdsWithPredicate(query: AssetQuery = {}, predicate?: SqlPredicate): string[] {
    const where: string[] = [query.deleted ? 'a.deleted_at IS NOT NULL' : 'a.deleted_at IS NULL']
    const params: Record<string, SQLInputValue> = {}
    if (predicate) { where.push(predicate.sql); Object.assign(params, predicate.params) }
    if (query.favorite !== undefined) { where.push('a.favorite=@favorite'); params.favorite = query.favorite ? 1 : 0 }
    if (query.recent === 'added') where.push("a.imported_at >= datetime('now', '-30 days')")
    if (query.recent === 'opened') where.push("a.last_opened_at >= datetime('now', '-30 days')")
    if (query.folderId) { where.push('EXISTS (SELECT 1 FROM asset_folders af WHERE af.asset_id=a.id AND af.folder_id=@folderId)'); params.folderId = query.folderId }
    if (query.tagIds?.length) {
      const placeholders = query.tagIds.map((_, index) => `@tag${index}`)
      where.push(`EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id=a.id AND at.tag_id IN (${placeholders.join(',')}))`)
      query.tagIds.forEach((id, index) => { params[`tag${index}`] = id })
    }
    if (query.formats?.length) {
      const placeholders = query.formats.map((_, index) => `@format${index}`)
      where.push(`a.extension IN (${placeholders.join(',')})`)
      query.formats.forEach((format, index) => { params[`format${index}`] = format.toLowerCase() })
    }
    if (query.minRating !== undefined) { where.push('a.rating >= @minRating'); params.minRating = query.minRating }
    if (query.sourceDomains?.length) {
      const placeholders = query.sourceDomains.map((_, index) => `@sourceDomain${index}`)
      where.push(`(a.source_domain IN (${placeholders.join(',')}) OR EXISTS (SELECT 1 FROM asset_sources aws WHERE aws.asset_id=a.id AND aws.domain IN (${placeholders.join(',')})))`)
      query.sourceDomains.forEach((domain, index) => { params[`sourceDomain${index}`] = domain.toLocaleLowerCase('en-US').replace(/^www\./, '') })
    }
    if (query.sourceTypes?.length) where.push(`EXISTS (SELECT 1 FROM asset_sources aws WHERE aws.asset_id=a.id AND aws.source_type='web')`)
    if (query.search) {
      where.push(`(a.filename LIKE @search ESCAPE '\\' OR EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND t.name LIKE @search ESCAPE '\\') OR EXISTS (SELECT 1 FROM asset_folders af JOIN folders f ON f.id=af.folder_id WHERE af.asset_id=a.id AND f.name LIKE @search ESCAPE '\\') OR COALESCE(aia.description,'') LIKE @search ESCAPE '\\' OR COALESCE(aia.primary_object_label,'') LIKE @search ESCAPE '\\' OR COALESCE(aia.primary_scene_label,'') LIKE @search ESCAPE '\\' OR COALESCE(aia.primary_style_label,'') LIKE @search ESCAPE '\\')`)
      params.search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
    }
    return (this.db.prepare(`SELECT a.id FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id WHERE ${where.join(' AND ')}`).all(params) as unknown as Array<{ id: string }>).map((row) => row.id)
  }

  listIdsEligibleForSemantic(query: AssetQuery, field: 'object' | 'scene' | 'style' | 'description' | 'freeText', concepts: string[]): string[] {
    const normalized = [...new Set(concepts.map((value) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')).filter(Boolean))]
    let column: 'primary_object' | 'primary_scene' | 'primary_style' | null = null
    let accepted = normalized
    if (field === 'object') column = 'primary_object'
    else if (field === 'scene') column = 'primary_scene'
    else if (field === 'style') column = 'primary_style'
    else {
      const joined = normalized.join(' ')
      if (/\b(person|woman|man|child|portrait|dress)\b/.test(joined)) { column = 'primary_object'; accepted = ['person'] }
      else if (/\b(backpack|bag)\b/.test(joined)) { column = 'primary_object'; accepted = ['backpack', 'bag'] }
      else if (/\b(shoe|chair|sofa|car|motorcycle|phone|watch)\b/.test(joined)) { column = 'primary_object'; accepted = normalized }
      else if (/\b(outdoor|indoor|studio|street|office|bedroom|living room|kitchen|store|nature)\b/.test(joined)) { column = 'primary_scene'; accepted = normalized }
      else if (/\b(product photo|fashion|lifestyle photo|minimalist|editorial|retro|technology|cinematic|luxury)\b/.test(joined)) { column = 'primary_style'; accepted = normalized }
    }
    if (!column) {
      return this.listIdsWithPredicate(query, { sql: `(aia.status IS NULL OR aia.status<>'completed')`, params: {} })
    }
    const params: Record<string, SQLInputValue> = {}
    const placeholders = accepted.map((value, index) => { params[`semanticValue${index}`] = value; return `@semanticValue${index}` })
    return this.listIdsWithPredicate(query, {
      sql: `(aia.status IS NULL OR aia.status<>'completed' OR aia.${column} IS NULL OR LOWER(aia.${column}) IN (${placeholders.join(',')}))`,
      params
    })
  }

  listWithPredicate(query: AssetQuery = {}, predicate?: SqlPredicate): AssetPage {
    const limit = Math.min(query.limit ?? 120, 500)
    const offset = Number.parseInt(query.cursor ?? '0', 10) || 0
    const where: string[] = [query.deleted ? 'a.deleted_at IS NOT NULL' : 'a.deleted_at IS NULL']
    const params: Record<string, SQLInputValue> = { limit, offset }
    if (predicate) { where.push(predicate.sql); Object.assign(params, predicate.params) }

    if (query.favorite !== undefined) { where.push('a.favorite = @favorite'); params.favorite = query.favorite ? 1 : 0 }
    if (query.recent === 'added') where.push("a.imported_at >= datetime('now', '-30 days')")
    if (query.recent === 'opened') where.push("a.last_opened_at >= datetime('now', '-30 days')")
    if (query.folderId) { where.push('EXISTS (SELECT 1 FROM asset_folders af WHERE af.asset_id = a.id AND af.folder_id = @folderId)'); params.folderId = query.folderId }
    if (query.tagIds?.length) {
      const placeholders = query.tagIds.map((_, index) => `@tag${index}`)
      where.push(`EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id AND at.tag_id IN (${placeholders.join(',')}))`)
      query.tagIds.forEach((id, index) => { params[`tag${index}`] = id })
    }
    if (query.formats?.length) {
      const placeholders = query.formats.map((_, index) => `@format${index}`)
      where.push(`a.extension IN (${placeholders.join(',')})`)
      query.formats.forEach((format, index) => { params[`format${index}`] = format.toLowerCase() })
    }
    if (query.minRating !== undefined) { where.push('a.rating >= @minRating'); params.minRating = query.minRating }
    if (query.sourceDomains?.length) {
      const placeholders = query.sourceDomains.map((_, index) => `@sourceDomain${index}`)
      where.push(`(a.source_domain IN (${placeholders.join(',')}) OR EXISTS (SELECT 1 FROM asset_sources aws WHERE aws.asset_id=a.id AND aws.domain IN (${placeholders.join(',')})))`)
      query.sourceDomains.forEach((domain, index) => { params[`sourceDomain${index}`] = domain.toLocaleLowerCase('en-US').replace(/^www\./, '') })
    }
    if (query.sourceTypes?.length) where.push(`EXISTS (SELECT 1 FROM asset_sources aws WHERE aws.asset_id=a.id AND aws.source_type='web')`)
    if (query.search) {
      where.push(`(
        a.filename LIKE @search ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = a.id AND t.name LIKE @search ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM asset_folders af JOIN folders f ON f.id = af.folder_id WHERE af.asset_id = a.id AND f.name LIKE @search ESCAPE '\\')
        OR aia.description LIKE @search ESCAPE '\\'
        OR aia.primary_object_label LIKE @search ESCAPE '\\'
        OR aia.primary_scene_label LIKE @search ESCAPE '\\'
        OR aia.primary_style_label LIKE @search ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM asset_ai_terms ait WHERE ait.asset_id = a.id AND ait.type IN ('object','scene','style') AND (ait.value LIKE @search ESCAPE '\\' OR ait.normalized_value LIKE @search ESCAPE '\\'))
      )`)
      params.search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
    }

    const orderBy: Record<NonNullable<AssetQuery['sort']>, string> = {
      'imported-desc': 'a.imported_at DESC, a.rowid DESC',
      'imported-asc': 'a.imported_at ASC, a.rowid ASC',
      'name-asc': 'a.filename COLLATE NOCASE ASC, a.id ASC',
      'name-desc': 'a.filename COLLATE NOCASE DESC, a.id DESC',
      'size-desc': 'a.size DESC, a.id DESC',
      'width-desc': 'a.width DESC, a.id DESC',
      'height-desc': 'a.height DESC, a.id DESC'
    }
    const join = 'LEFT JOIN asset_ai_analysis aia ON aia.asset_id = a.id'
    const whereSql = where.join(' AND ')
    const rows = this.db.prepare(`
      SELECT a.*, aia.status AS ai_status, aia.provider AS ai_provider, aia.model AS ai_model,
        aia.schema_version AS ai_schema_version, aia.description AS ai_description,
        aia.prompt_version AS ai_prompt_version,
        aia.result_version AS ai_result_version,aia.primary_object,aia.primary_object_label,aia.primary_object_confidence,
        aia.primary_scene,aia.primary_scene_label,aia.primary_scene_confidence,aia.primary_style,aia.primary_style_label,aia.primary_style_confidence,
        aia.primary_category, aia.primary_category_label, aia.primary_category_confidence,
        aia.secondary_category, aia.secondary_category_label, aia.secondary_category_confidence,
        aia.tertiary_category, aia.tertiary_category_label, aia.tertiary_category_confidence,
        aia.overall_confidence, aia.started_at AS ai_started_at, aia.analyzed_at,
        aia.updated_at AS ai_updated_at, aia.error_message AS ai_error_message, aia.retry_count AS ai_retry_count
      FROM assets a ${join}
      WHERE ${whereSql}
      ORDER BY ${orderBy[query.sort ?? 'imported-desc']}
      LIMIT @limit OFFSET @offset
    `).all(params) as unknown as AssetRow[]
    const countParams = Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'limit' && key !== 'offset'))
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM assets a ${join} WHERE ${whereSql}`).get(countParams) as unknown as { count: number }).count
    const items = this.hydrate(rows)
    return { items, total, nextCursor: offset + items.length < total ? String(offset + items.length) : null }
  }

  get(id: string): Asset | null {
    const row = this.db.prepare(`
      SELECT a.*, aia.status AS ai_status, aia.provider AS ai_provider, aia.model AS ai_model,
        aia.schema_version AS ai_schema_version, aia.description AS ai_description,
        aia.prompt_version AS ai_prompt_version,
        aia.result_version AS ai_result_version,aia.primary_object,aia.primary_object_label,aia.primary_object_confidence,
        aia.primary_scene,aia.primary_scene_label,aia.primary_scene_confidence,aia.primary_style,aia.primary_style_label,aia.primary_style_confidence,
        aia.primary_category, aia.primary_category_label, aia.primary_category_confidence,
        aia.secondary_category, aia.secondary_category_label, aia.secondary_category_confidence,
        aia.tertiary_category, aia.tertiary_category_label, aia.tertiary_category_confidence,
        aia.overall_confidence, aia.started_at AS ai_started_at, aia.analyzed_at,
        aia.updated_at AS ai_updated_at, aia.error_message AS ai_error_message, aia.retry_count AS ai_retry_count
      FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id = a.id WHERE a.id = ?
    `).get(id) as unknown as AssetRow | undefined
    return row ? (this.hydrate([row])[0] ?? null) : null
  }

  getMany(ids: string[]): Asset[] {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT a.*, aia.status AS ai_status, aia.provider AS ai_provider, aia.model AS ai_model,
        aia.schema_version AS ai_schema_version, aia.description AS ai_description,aia.prompt_version AS ai_prompt_version,
        aia.result_version AS ai_result_version,aia.primary_object,aia.primary_object_label,aia.primary_object_confidence,
        aia.primary_scene,aia.primary_scene_label,aia.primary_scene_confidence,aia.primary_style,aia.primary_style_label,aia.primary_style_confidence,
        aia.primary_category,aia.primary_category_label,aia.primary_category_confidence,
        aia.secondary_category,aia.secondary_category_label,aia.secondary_category_confidence,
        aia.tertiary_category,aia.tertiary_category_label,aia.tertiary_category_confidence,
        aia.overall_confidence,aia.started_at AS ai_started_at,aia.analyzed_at,aia.updated_at AS ai_updated_at,
        aia.error_message AS ai_error_message,aia.retry_count AS ai_retry_count
      FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id WHERE a.id IN (${placeholders})
    `).all(...ids) as unknown as AssetRow[]
    const byId = new Map(this.hydrate(rows).map((asset) => [asset.id, asset]))
    return ids.flatMap((id) => { const asset = byId.get(id); return asset ? [asset] : [] })
  }

  toggleFavorite(id: string): Asset {
    this.db.prepare("UPDATE assets SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id)
    const asset = this.get(id)
    if (!asset) throw new Error('Asset not found')
    return asset
  }

  setFavorite(ids: string[], favorite: boolean): number {
    if (!ids.length) return 0
    const statement = this.db.prepare("UPDATE assets SET favorite=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND deleted_at IS NULL")
    let affected = 0
    runTransaction(this.db, () => ids.forEach((id) => { affected += Number(statement.run(favorite ? 1 : 0, id).changes) }))
    return affected
  }

  listRecent(days = 30, limit = 50, offset = 0): AssetPage {
    const boundedDays = Math.min(365, Math.max(1, Math.trunc(days)))
    const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
    const predicate: SqlPredicate = { sql: `a.imported_at >= datetime('now', @recentDays)`, params: { recentDays: `-${boundedDays} days` } }
    return this.listWithPredicate({ limit: boundedLimit, cursor: String(Math.max(0, Math.trunc(offset))), sort: 'imported-desc' }, predicate)
  }

  countUnanalyzed(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM assets a LEFT JOIN asset_ai_analysis aia ON aia.asset_id=a.id
      WHERE a.deleted_at IS NULL AND (aia.asset_id IS NULL OR aia.status!='completed')`).get() as unknown as { count: number }).count
  }

  softDelete(ids: string[]): void {
    const statement = this.db.prepare("UPDATE assets SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    runTransaction(this.db, () => ids.forEach((id) => statement.run(id)))
  }

  restore(ids: string[]): void {
    const statement = this.db.prepare("UPDATE assets SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    runTransaction(this.db, () => ids.forEach((id) => statement.run(id)))
  }

  markOpened(id: string): void {
    this.db.prepare("UPDATE assets SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id)
  }

  getFilePath(id: string): string | null {
    const row = this.db.prepare('SELECT path FROM assets WHERE id = ?').get(id) as unknown as { path: string } | undefined
    return row?.path ?? null
  }

  isTrashed(id: string): boolean {
    const row = this.db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(id) as unknown as { deleted_at: string | null } | undefined
    return Boolean(row?.deleted_at)
  }

  listMissingColorAnalysis(limit = 25): Array<{ id: string; path: string }> {
    return this.db.prepare(`SELECT a.id,a.path FROM assets a LEFT JOIN asset_color_analysis aca ON aca.asset_id=a.id WHERE aca.asset_id IS NULL ORDER BY a.imported_at LIMIT ?`).all(limit) as unknown as Array<{ id: string; path: string }>
  }

  saveColorAnalysis(assetId: string, palette: PaletteResult): void {
    const now = new Date().toISOString()
    runTransaction(this.db, () => {
      this.db.prepare('DELETE FROM asset_colors WHERE asset_id=?').run(assetId)
      const insert = this.db.prepare(`INSERT INTO asset_colors (asset_id,position,hex,population,ratio,hue,saturation,lightness,lab_l,lab_a,lab_b) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      palette.swatches.forEach((color, position) => {
        const rgb = hexToRgb(color.hex), lab = rgbToLab(rgb.r, rgb.g, rgb.b)
        insert.run(assetId, position, color.hex, color.population ?? null, color.ratio ?? color.population ?? null, color.hue ?? null, color.saturation ?? null, color.lightness ?? null, lab.l, lab.a, lab.b)
      })
      this.db.prepare(`INSERT INTO asset_color_analysis (asset_id,average_hex,brightness,saturation,temperature,analyzed_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(asset_id) DO UPDATE SET average_hex=excluded.average_hex,brightness=excluded.brightness,saturation=excluded.saturation,temperature=excluded.temperature,analyzed_at=excluded.analyzed_at`)
        .run(assetId, palette.analysis.averageHex, palette.analysis.brightness, palette.analysis.saturation, palette.analysis.temperature, now)
    })
  }

  attachToFolder(ids: string[], folderId: string): void {
    const statement = this.db.prepare(`INSERT OR IGNORE INTO asset_folders (asset_id, folder_id, created_at) VALUES (?, ?, ?)`)
    const now = new Date().toISOString()
    runTransaction(this.db, () => ids.forEach((id) => statement.run(id, folderId, now)))
  }

  detachFromFolder(ids: string[], folderId: string): void {
    const statement = this.db.prepare('DELETE FROM asset_folders WHERE asset_id = ? AND folder_id = ?')
    runTransaction(this.db, () => ids.forEach((id) => statement.run(id, folderId)))
  }

  moveBetweenFolders(ids: string[], sourceFolderId: string, targetFolderId: string): void {
    if (sourceFolderId === targetFolderId) return
    const attach = this.db.prepare(`INSERT OR IGNORE INTO asset_folders (asset_id, folder_id, created_at) VALUES (?, ?, ?)`)
    const detach = this.db.prepare('DELETE FROM asset_folders WHERE asset_id = ? AND folder_id = ?')
    const now = new Date().toISOString()
    runTransaction(this.db, () => {
      ids.forEach((id) => {
        // Attach first so a missing/invalid target rolls back without losing the source relation.
        attach.run(id, targetFolderId, now)
        detach.run(id, sourceFolderId)
      })
    })
  }

  stats(): { total: number; recentlyAdded: number; recentlyOpened: number; favorites: number; trash: number } {
    return this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS total,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND imported_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS recentlyAdded,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND last_opened_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS recentlyOpened,
        COALESCE(SUM(CASE WHEN deleted_at IS NULL AND favorite = 1 THEN 1 ELSE 0 END), 0) AS favorites,
        COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS trash
      FROM assets
    `).get() as unknown as { total: number; recentlyAdded: number; recentlyOpened: number; favorites: number; trash: number }
  }

  private hydrate(rows: AssetRow[]): Asset[] {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const colors = this.db.prepare(`SELECT asset_id, hex, population, ratio, hue, saturation, lightness FROM asset_colors WHERE asset_id IN (${placeholders}) ORDER BY position`).all(...ids) as unknown as Array<{ asset_id: string; hex: string; population: number | null; ratio: number | null; hue: number | null; saturation: number | null; lightness: number | null }>
    const colorAnalysisRows = this.db.prepare(`SELECT asset_id, average_hex, brightness, saturation, temperature FROM asset_color_analysis WHERE asset_id IN (${placeholders})`).all(...ids) as unknown as Array<{ asset_id: string; average_hex: string; brightness: number; saturation: number; temperature: ColorAnalysis['temperature'] }>
    const aiTerms = this.db.prepare(`SELECT asset_id,type,value,normalized_value,confidence,source FROM asset_ai_terms WHERE asset_id IN (${placeholders}) ORDER BY type,confidence DESC,value`).all(...ids) as unknown as Array<{ asset_id: string; type: AITermType; value: string; normalized_value: string; confidence: number; source: AIValue['source'] }>
    const tags = this.db.prepare(`SELECT at.asset_id, t.id, t.name, t.type FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id IN (${placeholders}) ORDER BY t.name`).all(...ids) as unknown as Array<{ asset_id: string } & Tag>
    const folders = this.db.prepare(`SELECT asset_id, folder_id FROM asset_folders WHERE asset_id IN (${placeholders})`).all(...ids) as unknown as Array<{ asset_id: string; folder_id: string }>

    return rows.map((row) => {
      const termsForAsset = aiTerms.filter((term) => term.asset_id === row.id)
      const values = (type: AITermType): AIValue[] => termsForAsset.filter((term) => term.type === type).map((term) => ({ value: term.value, normalizedValue: term.normalized_value, confidence: term.confidence, source: term.source }))
      const termGroups = { object: values('object'), scene: values('scene'), style: values('style'), mood: values('mood'), lighting: values('lighting'), composition: values('composition'), material: values('material'), usage: values('usage'), semantic_color: values('semantic_color'), open_tag: values('open_tag') }
      const pickPrimary = (items: AIValue[], stored: AIValue | null): AIValue | null => items.find((item) => item.source === 'manual') ?? ((row.ai_result_version ?? 1) >= 2 ? items[0] : stored ?? items[0]) ?? null
      const primaryObject = pickPrimary(termGroups.object, categoryValue(row.primary_object_label, row.primary_object, row.primary_object_confidence))
      const primaryScene = pickPrimary(termGroups.scene, categoryValue(row.primary_scene_label, row.primary_scene, row.primary_scene_confidence))
      const primaryStyle = pickPrimary(termGroups.style, categoryValue(row.primary_style_label, row.primary_style, row.primary_style_confidence))
      const ai = row.ai_status ? {
        status: row.ai_status, provider: row.ai_provider, model: row.ai_model, schemaVersion: row.ai_schema_version ?? 1, promptVersion: row.ai_prompt_version,
        resultVersion: row.ai_result_version ?? 1, primaryObject, primaryScene, primaryStyle,
        category: { primary: categoryValue(row.primary_category_label, row.primary_category, row.primary_category_confidence), secondary: categoryValue(row.secondary_category_label, row.secondary_category, row.secondary_category_confidence), tertiary: categoryValue(row.tertiary_category_label, row.tertiary_category, row.tertiary_category_confidence) },
        terms: Object.values(termGroups).flat(), termGroups, description: row.ai_description,
        styles: termGroups.style.map((item) => item.value), moods: termGroups.mood.map((item) => item.value), colors: termGroups.semantic_color.map((item) => item.value),
        objects: termGroups.object.map((item) => item.value), materials: termGroups.material.map((item) => item.value), lighting: termGroups.lighting.map((item) => item.value),
        composition: termGroups.composition.map((item) => item.value), scene: termGroups.scene.map((item) => item.value), usage: termGroups.usage.map((item) => item.value),
        ocrText: null, semanticEmbeddingStatus: 'disabled', visualEmbeddingStatus: 'disabled', aiModel: row.ai_model,
        analyzedAt: row.analyzed_at, startedAt: row.ai_started_at, updatedAt: row.ai_updated_at ?? row.imported_at,
        overallConfidence: row.overall_confidence, errorMessage: row.ai_error_message, retryCount: row.ai_retry_count ?? 0
      } satisfies AIMetadata : null
      const colorAnalysisRow = colorAnalysisRows.find((item) => item.asset_id === row.id)
      return {
        id: row.id, filename: row.filename, originalFilename: row.original_filename, mimeType: row.mime_type,
        extension: row.extension, width: row.width, height: row.height, size: row.size, favorite: row.favorite === 1,
        rating: row.rating, createdAt: row.created_at, importedAt: row.imported_at, lastOpenedAt: row.last_opened_at,
        sourceUrl: row.source_url, sourceDomain: row.source_domain, sourceTitle: row.source_title, sourceAuthor: row.source_author,
        sourceSavedAt: row.source_saved_at, importSource: row.import_source,
        thumbnailUrl: this.toLocalUrl(row.thumbnail_path ?? row.path), previewUrl: this.toLocalUrl(row.path),
        colors: colors.filter((color) => color.asset_id === row.id).map(({ hex, population, ratio, hue, saturation, lightness }) => ({ hex, population: population ?? undefined, ratio: ratio ?? undefined, hue: hue ?? undefined, saturation: saturation ?? undefined, lightness: lightness ?? undefined })),
        colorAnalysis: colorAnalysisRow ? { averageHex: colorAnalysisRow.average_hex, brightness: colorAnalysisRow.brightness, saturation: colorAnalysisRow.saturation, temperature: colorAnalysisRow.temperature } : null,
        tags: tags.filter((tag) => tag.asset_id === row.id).map(({ asset_id: _assetId, ...tag }) => tag),
        folderIds: folders.filter((folder) => folder.asset_id === row.id).map((folder) => folder.folder_id), ai
      }
    })
  }
}

const categoryValue = (label: string | null, normalizedValue: string | null, confidence: number | null): AIValue | null => label && normalizedValue ? { value: label, normalizedValue, confidence: confidence ?? 0, source: 'ai' } : null
const hexToRgb = (hex: string): { r: number; g: number; b: number } => { const value = hex.replace('#', ''); return { r: Number.parseInt(value.slice(0, 2), 16), g: Number.parseInt(value.slice(2, 4), 16), b: Number.parseInt(value.slice(4, 6), 16) } }
