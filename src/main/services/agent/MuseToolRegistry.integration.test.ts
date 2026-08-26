import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DatabaseService } from '../../database/DatabaseService'
import { AssetRepository } from '../../database/repositories/AssetRepository'
import { FolderRepository } from '../../database/repositories/FolderRepository'
import { TagRepository } from '../../database/repositories/TagRepository'
import { SmartCollectionRepository } from '../../database/repositories/SmartCollectionRepository'
import { MuseAgentRepository } from '../../database/repositories/MuseAgentRepository'
import { ensureLibrary } from '../filesystem/LibraryPaths'
import { AssetImporter } from '../assets/AssetImporter'
import { SmartCollectionService } from '../smartCollections/SmartCollectionService'
import type { NaturalLanguageSearchService } from '../search/NaturalLanguageSearchService'
import type { VisualEmbeddingService } from '../embeddings/VisualEmbeddingService'
import type { DuplicateDetectionService } from '../duplicates/DuplicateDetectionService'
import { MuseAgentContextService } from './MuseAgentContextService'
import { MuseAgentApprovalService } from './MuseAgentApprovalService'
import { MuseToolRegistry } from './MuseToolRegistry'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Muse runtime tool boundary', () => {
  it('uses real services, requires approval for writes, resolves current selection at execution time, and persists audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-agent-')), inputRoot = await mkdtemp(join(tmpdir(), 'muse-agent-input-'))
    cleanup.push(root, inputRoot)
    const library = ensureLibrary(root), database = new DatabaseService(library.database)
    const assets = new AssetRepository(database.db, (path) => path), folders = new FolderRepository(database.db), tags = new TagRepository(database.db)
    const smartCollections = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
    const paths = await Promise.all(['one', 'two'].map(async (name, index) => {
      const path = join(inputRoot, `${name}.png`)
      await sharp({ create: { width: 180 + index, height: 120, channels: 3, background: index ? '#336699' : '#779944' } }).png().toFile(path)
      return path
    }))
    const imported = await new AssetImporter(library, assets).import(paths)
    expect(imported.imported).toHaveLength(2)
    const selectedAssetIds = imported.imported.map((asset) => asset.id)
    const context = new MuseAgentContextService()
    context.update({ currentViewType: 'library', currentViewId: null, selectionCount: 2, selectedAssetIds, focusedAssetId: selectedAssetIds[0]! })
    const approval = new MuseAgentApprovalService(), repository = new MuseAgentRepository(database.db)
    const conversation = repository.createConversation()
    const search = {
      listAssets: (query: Parameters<AssetRepository['list']>[0]) => assets.list(query),
      createResultSet: async (query: Parameters<AssetRepository['list']>[0], previewLimit: number) => ({
        id: 'search-result-12', totalCount: 12, previewCount: Math.min(3, previewLimit),
        previewAssets: (() => { const items = assets.list({ limit: 3 }).items; return [...items, items[0]!].slice(0, 3) })(), query,
        coverage: { metadataMatches: 7, localSemanticMatches: 5, localSemanticIndexed: 12 }, createdAt: Date.now()
      })
    } as unknown as NaturalLanguageSearchService
    const visualSimilarity = { findSimilar: async () => { throw new Error('not needed') } } as unknown as VisualEmbeddingService
    const duplicates = { status: () => ({ groupCount: 0 }), list: () => [] } as unknown as DuplicateDetectionService
    const actions: unknown[] = []
    const registry = new MuseToolRegistry({
      assets, folders, tags, smartCollections, search, visualSimilarity, duplicates, context, approval, repository,
      emitAction: (action) => { actions.push(action) }, emitLibraryChange: () => undefined, emitActivity: () => undefined
    })
    const execution = { conversationId: conversation.id, threadId: 'thread-1', turnId: 'turn-1' }

    expect(registry.permissions()).toHaveLength(16)
    expect(registry.permissions().filter((item) => item.permission === 'safe-write').map((item) => item.name).sort())
      .toEqual(['muse.add_tags', 'muse.create_smart_collection', 'muse.remove_tags', 'muse.set_favorite'])
    expect(registry.permissions().some((item) => item.permission === 'destructive')).toBe(false)
    expect((await registry.execute('get_library_stats', {}, execution)).data).toMatchObject({ total: 2, favorites: 0 })
    expect((await registry.execute('get_selected_assets', { limit: 50, offset: 0 }, execution)).data).toMatchObject({ count: 2 })
    const searchResult = await registry.execute('search_assets', {
      expression: { field: 'freeText', operator: 'contains', value: '背包' }, limit: 100
    }, execution)
    expect(searchResult.data).toMatchObject({
      resultSetId: 'search-result-12', totalCount: 12, previewCount: 3,
      coverage: { metadataMatches: 7, localSemanticMatches: 5 }
    })
    expect((searchResult.data as { previewAssets: unknown[] }).previewAssets).toHaveLength(3)
    expect(actions).toContainEqual({ type: 'agent-search-results', title: 'Muse AI 搜索结果', resultSetId: 'search-result-12' })

    let unsubscribeApproval: () => void = () => undefined
    const rejectedRequest = new Promise<void>((resolve) => { unsubscribeApproval = approval.onRequested((request) => { approval.resolve(request.id, false); resolve() }) })
    const rejected = await registry.execute('set_favorite', { useCurrentSelection: true, favorite: true }, execution)
    await rejectedRequest; unsubscribeApproval()
    expect(rejected).toMatchObject({ success: false, code: 'USER_DECLINED' })
    expect(assets.stats().favorites).toBe(0)

    const approvedRequest = new Promise<void>((resolve) => { unsubscribeApproval = approval.onRequested((request) => { approval.resolve(request.id, true); resolve() }) })
    const approved = await registry.execute('set_favorite', { useCurrentSelection: true, favorite: true }, { ...execution, turnId: 'turn-2' })
    await approvedRequest; unsubscribeApproval()
    expect(approved).toMatchObject({ success: true, code: 'FAVORITE_UPDATED', data: { affectedCount: 2 } })
    expect(assets.stats().favorites).toBe(2)

    const tagApproval = new Promise<void>((resolve) => { unsubscribeApproval = approval.onRequested((request) => { approval.resolve(request.id, true); resolve() }) })
    expect(await registry.execute('add_tags', { useCurrentSelection: true, tags: ['参考'] }, { ...execution, turnId: 'turn-3' })).toMatchObject({ success: true, code: 'TAGS_ADDED' })
    await tagApproval; unsubscribeApproval()
    expect(tags.list().find((tag) => tag.name === '参考')?.assetCount).toBe(2)

    expect(await registry.execute('permanently_delete_assets', { assetIds: selectedAssetIds }, execution)).toMatchObject({ success: false, code: 'TOOL_NOT_FOUND' })
    const audits = database.db.prepare('SELECT permission,approved,result_code FROM muse_agent_tool_audit ORDER BY created_at').all() as unknown as Array<{ permission: string; approved: number | null; result_code: string }>
    expect(audits.some((row) => row.permission === 'safe-write' && row.approved === 0 && row.result_code === 'USER_DECLINED')).toBe(true)
    expect(audits.some((row) => row.permission === 'safe-write' && row.approved === 1 && row.result_code === 'FAVORITE_UPDATED')).toBe(true)

    repository.addMessage(conversation.id, 'user', '收藏这些')
    database.close()
    const reopened = new DatabaseService(library.database), reopenedRepository = new MuseAgentRepository(reopened.db)
    expect(reopenedRepository.listConversations()).toHaveLength(1)
    expect(reopenedRepository.messages(conversation.id)).toMatchObject([{ role: 'user', content: '收藏这些' }])
    expect(new AssetRepository(reopened.db, (path) => path).stats().favorites).toBe(2)
    reopened.close()
  }, 30_000)
})
