import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { DatabaseService } from '../../database/DatabaseService'
import { AssetRepository } from '../../database/repositories/AssetRepository'
import { FolderRepository } from '../../database/repositories/FolderRepository'
import { TagRepository } from '../../database/repositories/TagRepository'
import { EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import { SmartCollectionRepository } from '../../database/repositories/SmartCollectionRepository'
import { MuseAgentRepository } from '../../database/repositories/MuseAgentRepository'
import { SmartCollectionService } from '../smartCollections/SmartCollectionService'
import type { NaturalLanguageSearchService } from '../search/NaturalLanguageSearchService'
import { HybridSearchService } from '../search/HybridSearchService'
import { SearchEntityResolver } from '../search/SearchEntityResolver'
import { LocalSemanticSearchService } from '../search/LocalSemanticSearchService'
import { SEMANTIC_SEARCH_MODEL, SemanticSearchModelManager } from '../search/SemanticSearchModelManager'
import { SemanticSearchWorkerClient } from '../search/SemanticSearchWorkerClient'
import type { VisualEmbeddingService } from '../embeddings/VisualEmbeddingService'
import type { DuplicateDetectionService } from '../duplicates/DuplicateDetectionService'
import { CodexAppServerManager } from '../ai/codex/CodexAppServerManager'
import { MuseAgentContextService } from './MuseAgentContextService'
import { MuseAgentApprovalService } from './MuseAgentApprovalService'
import { MuseToolRegistry } from './MuseToolRegistry'
import { CodexToolBridge } from './CodexToolBridge'

const enabled = process.env.MUSE_REAL_AGENT === '1'
const realLibrary = process.env.MUSE_REAL_LIBRARY || 'D:\\桌面\\图片\\Muse Library'

describe.skipIf(!enabled)('Muse Agent real Codex dynamic tools', () => {
  let manager: CodexAppServerManager | null = null
  let root: string | null = null
  let libraryDb: DatabaseSync | null = null
  let auditDb: DatabaseService | null = null
  let semantic: LocalSemanticSearchService | null = null
  afterAll(async () => { await semantic?.dispose(); libraryDb?.close(); auditDb?.close(); await manager?.shutdown(); if (root) await rm(root, { recursive: true, force: true }) })

  it('uses item/tool/call to read the current real Library through MuseToolRegistry', async () => {
    root = await mkdtemp(join(tmpdir(), 'muse-agent-real-'))
    libraryDb = new DatabaseSync(join(realLibrary, 'muse.db'), { readOnly: true })
    auditDb = new DatabaseService(join(root, 'agent-audit.db'))
    const assets = new AssetRepository(libraryDb, (path) => path), folders = new FolderRepository(libraryDb), tags = new TagRepository(libraryDb)
    const smartCollections = new SmartCollectionService(new SmartCollectionRepository(libraryDb), assets)
    const repository = new MuseAgentRepository(auditDb.db), conversation = repository.createConversation('真实图库读取验证')
    const context = new MuseAgentContextService(), approval = new MuseAgentApprovalService()
    const semanticModelRoot = process.env.MUSE_SEMANTIC_MODEL_ROOT
    if (!semanticModelRoot) throw new Error('MUSE_SEMANTIC_MODEL_ROOT is required for the real search recall test')
    semantic = new LocalSemanticSearchService(
      new EmbeddingRepository(libraryDb, { providerId: SEMANTIC_SEARCH_MODEL.providerId, modelId: SEMANTIC_SEARCH_MODEL.modelId, modelVersion: SEMANTIC_SEARCH_MODEL.modelVersion, dimension: SEMANTIC_SEARCH_MODEL.dimension }),
      new SemanticSearchModelManager(semanticModelRoot),
      new SemanticSearchWorkerClient({ modelsRoot: semanticModelRoot, localModelId: SEMANTIC_SEARCH_MODEL.localModelId, dimension: SEMANTIC_SEARCH_MODEL.dimension, workerPath: join(process.cwd(), 'out/main/workers/semanticSearchWorker.js') })
    )
    const hybrid = new HybridSearchService(assets, new SearchEntityResolver(() => folders.list(), () => tags.list()), semantic)
    await semantic.initialize()
    const search = { createResultSet: (query: Parameters<HybridSearchService['create']>[0], previewLimit: number) => hybrid.create(query, previewLimit) } as unknown as NaturalLanguageSearchService
    const visualSimilarity = { findSimilar: async () => { throw new Error('not requested') } } as unknown as VisualEmbeddingService
    const duplicateGroupCount = Number((libraryDb.prepare('SELECT COUNT(*) AS count FROM duplicate_groups').get() as unknown as { count: number }).count)
    const duplicates = { status: () => ({ groupCount: duplicateGroupCount }), list: () => [] } as unknown as DuplicateDetectionService
    const registry = new MuseToolRegistry({ assets, folders, tags, smartCollections, search, visualSimilarity, duplicates, context, approval, repository,
      emitAction: () => undefined, emitLibraryChange: () => undefined, emitActivity: () => undefined })
    manager = new CodexAppServerManager({ userDataPath: join(process.env.APPDATA ?? root, 'muse-visual-library'), resourcesPath: process.cwd(), projectRoot: process.cwd() })
    const protocolMethods: string[] = [], protocolDetails: unknown[] = []
    manager.onProtocolMessage((message) => { protocolMethods.push(message.method); if (message.method === 'warning' || message.method === 'item/completed' || message.method === 'item/started') protocolDetails.push({ method: message.method, params: message.params }) })
    const bridge = new CodexToolBridge(manager, registry)
    const account = await manager.account(), models = await manager.listModels(), model = models.find((item) => item.isDefault) ?? models[0]
    expect(account.connected).toBe(true); expect(model).toBeTruthy()
    const thread = await bridge.startThread({ modelId: model!.id, workspacePath: join(root, 'workspace') })
    expect(thread.toolsEnabled).toBe(true)
    const output = await bridge.runTurn({ conversationId: conversation.id, threadId: thread.threadId, modelId: model!.id,
      contextText: '<muse_ui_context>currentViewType=library selectionCount=0</muse_ui_context>',
      text: '我的图库里现在有多少张图片？必须调用 Muse 工具读取真实数据，只回答总数。' })
    const expectedTotal = assets.stats().total
    const audit = auditDb.db.prepare("SELECT tool_name,permission,approved,result_code FROM muse_agent_tool_audit WHERE tool_name='muse.get_library_stats'").get() as unknown as { tool_name: string; permission: string; approved: null; result_code: string } | undefined
    process.stdout.write(`\nMUSE_AGENT_REAL_DEBUG ${JSON.stringify({ output, expectedTotal, audit, protocolMethods, protocolDetails })}\n`)
    expect(output.status).toBe('completed')
    expect(audit).toMatchObject({ tool_name: 'muse.get_library_stats', permission: 'read', approved: null, result_code: 'OK' })
    expect(output.text).toContain(String(expectedTotal))
    const directSearch = await registry.execute('search_assets', { expression: { field: 'freeText', operator: 'contains', value: '背包' }, limit: 100 },
      { conversationId: conversation.id, threadId: thread.threadId, turnId: 'direct-search-check' })
    expect(directSearch.data).toMatchObject({ totalCount: 12, previewCount: 5 })
    const searchOutput = await bridge.runTurn({ conversationId: conversation.id, threadId: thread.threadId, modelId: model!.id,
      contextText: '<muse_ui_context>currentViewType=library selectionCount=0</muse_ui_context>',
      text: '搜索背包。必须调用 muse.search_assets。工具的 totalCount 才是完整结果数，previewCount 只是预览；回答完整结果数。' })
    const searchAudit = auditDb.db.prepare("SELECT tool_name,result_code FROM muse_agent_tool_audit WHERE tool_name='muse.search_assets' ORDER BY created_at DESC LIMIT 1").get() as unknown as { tool_name: string; result_code: string } | undefined
    expect(searchAudit).toMatchObject({ tool_name: 'muse.search_assets', result_code: 'OK' })
    expect(searchOutput.text).toContain('12')
    expect(searchOutput.text).not.toMatch(/找到\s*3\s*张/)
    process.stdout.write(`\nMUSE_AGENT_REAL ${JSON.stringify({ runtime: manager.getRuntimeVersion(), model: model!.id, expectedTotal, output: output.text, dynamicTools: thread.toolsEnabled })}\n`)
    await manager.protocolRequest('thread/archive', { threadId: thread.threadId }).catch(() => undefined)
    libraryDb.close(); libraryDb = null; auditDb.close(); auditDb = null
  }, 180_000)
})
