import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/constants/ipc'
import { assetQuerySchema, createFolderSchema, createTagSchema, folderAssetSchema, idSchema, importPathsSchema, moveFolderAssetsSchema, renameFolderSchema, setFavoriteSchema, tagAssetSchema } from '@shared/schemas/ipc'
import type { AppPreferences, DesktopAction, LibraryChangeEvent, LibraryChangeKind } from '@shared/types/domain'
import type { AssetImporter } from '../services/assets/AssetImporter'
import type { AssetRepository } from '../database/repositories/AssetRepository'
import type { FolderRepository } from '../database/repositories/FolderRepository'
import type { TagRepository } from '../database/repositories/TagRepository'
import type { SettingsRepository } from '../database/repositories/SettingsRepository'
import type { SmartCollectionService } from '../services/smartCollections/SmartCollectionService'
import type { CollectionSuggestionService } from '../services/smartCollections/CollectionSuggestionService'
import { smartCollectionInputSchema, smartCollectionPreviewSchema, smartCollectionUpdateSchema } from '@shared/schemas/smartCollections'
import type { LibraryDirectories } from '../services/filesystem/LibraryPaths'
import { logger, serializeError } from '../logger'
import { toPublicError } from '../errors'
import type { AIAnalysisService } from '../services/ai/AIService'
import { aiAnalyzeAssetsSchema, aiProviderRequestSchema, aiProviderSecretSchema, aiSettingsPatchSchema, aiTermMutationSchema } from '@shared/schemas/ai'
import { ruleSignatureSchema } from '@shared/schemas/collectionSuggestions'
import { naturalSearchHistoryLimitSchema, naturalSearchParseRequestSchema, naturalSearchRemoveChipSchema, naturalSearchSaveSchema } from '@shared/schemas/naturalSearch'
import type { NaturalLanguageSearchService } from '../services/search/NaturalLanguageSearchService'
import type { VisualEmbeddingService } from '../services/embeddings/VisualEmbeddingService'
import { findSimilarSchema, regenerateEmbeddingSchema, visualIndexPreferenceSchema } from '@shared/schemas/visualSimilarity'
import { duplicateCleanupSchema, duplicateKindSchema } from '@shared/schemas/duplicates'
import type { DuplicateDetectionService } from '../services/duplicates/DuplicateDetectionService'
import type { MuseAgentService } from '../services/agent/MuseAgentService'
import type { TrashService } from '../services/assets/TrashService'
import type { AssetSourceRepository } from '../database/repositories/AssetSourceRepository'
import type { WebCollectorBridge } from '../services/webCollector/WebCollectorBridge'
import type { WebCollectorPairingService } from '../services/webCollector/WebCollectorPairingService'
import { museAgentApprovalResolutionSchema, museAgentContextSchema, museAgentConversationListSchema, museAgentMessageListSchema, museAgentSendSchema } from '@shared/schemas/museAgent'
import { ClipboardService } from '../services/clipboard/ClipboardService'
import type { LibraryTransferService } from '../services/filesystem/LibraryTransferService'
import { validateExistingLibrary } from '../services/filesystem/LibraryTransferService'
import type { LibraryLocationService } from '../services/desktop/LibraryLocationService'

interface IpcDependencies {
  assets: AssetRepository
  trash: TrashService
  importer: AssetImporter
  folders: FolderRepository
  tags: TagRepository
  settings: SettingsRepository
  smartCollections: SmartCollectionService
  collectionSuggestions: CollectionSuggestionService
  library: LibraryDirectories
  ai: AIAnalysisService
  search: NaturalLanguageSearchService
  visualSimilarity: VisualEmbeddingService
  duplicates: DuplicateDetectionService
  agent: MuseAgentService
  assetSources: AssetSourceRepository
  webCollector: WebCollectorBridge
  webCollectorPairing: WebCollectorPairingService
  libraryTransfer: LibraryTransferService
  libraryLocation: LibraryLocationService
}

const idListSchema = z.array(idSchema).min(1).max(5000)
const contextMenuSchema = z.object({ assetId: idSchema, selectedAssetIds: idListSchema })
const codexLoginSchema = z.object({ deviceCode: z.boolean().default(false) })
const preferenceSchema = z.object({
  sidebarWidth: z.number().min(190).max(360).optional(),
  inspectorWidth: z.number().min(300).max(520).optional(),
  galleryZoom: z.number().min(0).max(1).optional(),
  galleryView: z.enum(['masonry', 'grid']).optional()
})

export function registerIpc(dependencies: IpcDependencies): void {
  const clipboardService = new ClipboardService()
  const emitChange = (kind: LibraryChangeKind, assetIds?: string[]): void => {
    dependencies.collectionSuggestions.invalidate()
    dependencies.duplicates.invalidate()
    const payload: LibraryChangeEvent = { kind, assetIds }
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.app.libraryChanged, payload))
  }
  const emitAction = (window: BrowserWindow, action: DesktopAction): void => window.webContents.send(IPC.app.desktopAction, action)
  const handle = <T>(channel: string, schema: z.ZodType<T>, handler: (value: T) => unknown | Promise<unknown>): void => {
    ipcMain.handle(channel, async (_event, payload) => {
      try { return await handler(schema.parse(payload)) }
      catch (error) {
        logger.error(`IPC handler failed: ${channel}`, serializeError(error))
        throw toPublicError(error)
      }
    })
  }
  const importWithDialog = async (folderId?: string) => {
    const result = await dialog.showOpenDialog({
      title: '导入图片到 Muse', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (result.canceled) return { imported: [], duplicateIds: [], failures: [] }
    const imported = await dependencies.importer.import(result.filePaths, 'local', folderId)
    if (imported.imported.length) emitChange('asset:created', imported.imported.map((asset) => asset.id))
    return imported
  }

  ipcMain.handle(IPC.app.getBootstrap, () => ({
    appVersion: app.getVersion(),
    libraryName: 'Muse Library', libraryPath: dependencies.library.root,
    stats: dependencies.assets.stats(), folders: dependencies.folders.list(), tags: dependencies.tags.list(), smartCollections: dependencies.smartCollections.list(),
    platform: normalizePlatform(), preferences: dependencies.settings.getPreferences()
  }))
  handle(IPC.app.updatePreferences, preferenceSchema, (patch) => dependencies.settings.updatePreferences(patch as Partial<AppPreferences>))
  ipcMain.handle(IPC.ai.getSettings, () => dependencies.ai.getSettings())
  handle(IPC.ai.updateSettings, aiSettingsPatchSchema, (patch) => dependencies.ai.updateSettings(patch))
  ipcMain.handle(IPC.ai.listProviders, () => dependencies.ai.listProviders())
  ipcMain.handle(IPC.ai.detectLocalProviders, () => dependencies.ai.detectLocalProviders())
  handle(IPC.ai.testConnection, aiProviderRequestSchema, ({ providerId }) => dependencies.ai.testConnection(providerId))
  handle(IPC.ai.listModels, aiProviderRequestSchema, ({ providerId }) => dependencies.ai.listModels(providerId))
  handle(IPC.ai.setProviderSecret, aiProviderSecretSchema, ({ providerId, secret }) => dependencies.ai.setProviderSecret(providerId, secret))
  handle(IPC.ai.clearProviderSecret, aiProviderRequestSchema, ({ providerId }) => dependencies.ai.clearProviderSecret(providerId))
  handle(IPC.ai.analyzeAssets, aiAnalyzeAssetsSchema, ({ assetIds, force }) => dependencies.ai.analyze(assetIds, force))
  handle(IPC.ai.cancel, idListSchema, (ids) => dependencies.ai.queue.cancel(ids))
  ipcMain.handle(IPC.ai.pause, () => { dependencies.ai.queue.pause(); return dependencies.ai.queue.status() })
  ipcMain.handle(IPC.ai.resume, () => { dependencies.ai.queue.resume(); return dependencies.ai.queue.status() })
  ipcMain.handle(IPC.ai.getQueueStatus, () => dependencies.ai.queue.status())
  ipcMain.handle(IPC.ai.suggestions, () => dependencies.ai.suggestions())
  ipcMain.handle(IPC.ai.codexAccount, () => dependencies.ai.codexAccount())
  handle(IPC.ai.codexLogin, codexLoginSchema, async ({ deviceCode }) => {
    const result = await dependencies.ai.codexLogin(deviceCode)
    const url = result.type === 'chatgpt' ? result.authUrl : result.verificationUrl
    if (url) await shell.openExternal(url)
    return result
  })
  ipcMain.handle(IPC.ai.codexLogout, () => dependencies.ai.codexLogout())
  ipcMain.handle(IPC.ai.codexUsage, () => dependencies.ai.codexUsage())
  dependencies.ai.onCodexChanged(() => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.ai.codexChanged)))
  handle(IPC.ai.addTerm, aiTermMutationSchema, ({ assetId, type, value }) => { dependencies.ai.addManualTerm(assetId, type, value); emitChange('ai:updated', [assetId]) })
  handle(IPC.ai.removeTerm, aiTermMutationSchema, ({ assetId, type, value }) => { dependencies.ai.removeTerm(assetId, type, value); emitChange('ai:updated', [assetId]) })

  handle(IPC.assets.list, assetQuerySchema, (query) => query.search || query.naturalSearch || query.searchResultSetId ? dependencies.search.listHybridAssets(query) : query.smartCollectionId ? dependencies.smartCollections.listAssets(query.smartCollectionId, query) : dependencies.assets.list(query))
  handle(IPC.assets.get, idSchema, (id) => dependencies.assets.get(id))
  handle(IPC.assets.sources, idSchema, (id) => dependencies.assetSources.list(id))
  handle(IPC.assets.toggleFavorite, idSchema, (id) => { const asset = dependencies.assets.toggleFavorite(id); emitChange('asset:updated', [id]); return asset })
  handle(IPC.assets.setFavorite, setFavoriteSchema, ({ assetIds, favorite }) => {
    const affectedCount = dependencies.assets.setFavorite(assetIds, favorite)
    emitChange('asset:updated', assetIds)
    return affectedCount
  })
  handle(IPC.assets.remove, idListSchema, (ids) => { dependencies.assets.softDelete(ids); emitChange('asset:deleted', ids) })
  handle(IPC.assets.restore, idListSchema, (ids) => { dependencies.assets.restore(ids); emitChange('asset:restored', ids) })
  ipcMain.handle(IPC.assets.emptyTrash, async () => {
    try {
      const result = await dependencies.trash.empty()
      emitChange('asset:deleted')
      return result
    } catch (error) {
      logger.error(`IPC handler failed: ${IPC.assets.emptyTrash}`, serializeError(error))
      throw toPublicError(error)
    }
  })
  handle(IPC.assets.markOpened, idSchema, (id) => { dependencies.assets.markOpened(id); emitChange('asset:updated', [id]) })
  handle(IPC.assets.importPaths, importPathsSchema, async ({ paths, source, folderId }) => {
    const result = await dependencies.importer.import(paths, source, folderId)
    if (result.imported.length) emitChange('asset:created', result.imported.map((asset) => asset.id))
    return result
  })
  ipcMain.handle(IPC.assets.pickAndImport, async (_event, folderId?: string) => importWithDialog(folderId))
  ipcMain.handle(IPC.desktop.openFileDialog, async (_event, folderId?: string) => importWithDialog(folderId))

  ipcMain.handle(IPC.folders.list, () => dependencies.folders.list())
  handle(IPC.folders.create, createFolderSchema, ({ name, parentId }) => { const folder = dependencies.folders.create(name, parentId ?? null); emitChange('folder:created'); return folder })
  handle(IPC.folders.rename, renameFolderSchema, ({ id, name }) => { const folder = dependencies.folders.rename(id, name); emitChange('folder:updated'); return folder })
  handle(IPC.folders.remove, idSchema, (id) => { dependencies.folders.remove(id); emitChange('folder:deleted') })
  handle(IPC.folders.attachAssets, folderAssetSchema, ({ assetIds, folderId }) => { dependencies.assets.attachToFolder(assetIds, folderId); emitChange('asset:updated', assetIds) })
  handle(IPC.folders.detachAssets, folderAssetSchema, ({ assetIds, folderId }) => { dependencies.assets.detachFromFolder(assetIds, folderId); emitChange('asset:updated', assetIds) })
  handle(IPC.folders.moveAssets, moveFolderAssetsSchema, ({ assetIds, sourceFolderId, targetFolderId }) => {
    dependencies.assets.moveBetweenFolders(assetIds, sourceFolderId, targetFolderId)
    emitChange('asset:updated', assetIds)
  })

  ipcMain.handle(IPC.tags.list, () => dependencies.tags.list())
  handle(IPC.tags.create, createTagSchema, ({ name }) => { const tag = dependencies.tags.create(name); emitChange('tag:created'); return tag })
  handle(IPC.tags.attach, tagAssetSchema, ({ assetIds, tagId }) => { dependencies.tags.attach(assetIds, tagId); emitChange('asset:updated', assetIds) })
  handle(IPC.tags.detach, tagAssetSchema, ({ assetIds, tagId }) => { dependencies.tags.detach(assetIds, tagId); emitChange('asset:updated', assetIds) })

  ipcMain.handle(IPC.smartCollections.list, () => dependencies.smartCollections.list())
  handle(IPC.smartCollections.create, smartCollectionInputSchema, (input) => { const collection = dependencies.smartCollections.create(input); emitChange('smart-collection:created'); return collection })
  handle(IPC.smartCollections.update, smartCollectionUpdateSchema, ({ id, input }) => { const collection = dependencies.smartCollections.update(id, input); emitChange('smart-collection:updated'); return collection })
  handle(IPC.smartCollections.remove, idSchema, (id) => { dependencies.smartCollections.remove(id); emitChange('smart-collection:deleted') })
  handle(IPC.smartCollections.duplicate, idSchema, (id) => { const collection = dependencies.smartCollections.duplicate(id); emitChange('smart-collection:created'); return collection })
  handle(IPC.smartCollections.preview, smartCollectionPreviewSchema, (input) => dependencies.smartCollections.preview(input))
  handle(IPC.smartCollections.showContextMenu, idSchema, (id) => {
    const window = BrowserWindow.getFocusedWindow()
    const collection = dependencies.smartCollections.list().find((item) => item.id === id)
    if (!window || !collection) return
    Menu.buildFromTemplate([
      { label: '编辑智能集合', click: () => emitAction(window, { type: 'edit-smart-collection', smartCollectionId: id }) },
      { label: '重命名', click: () => emitAction(window, { type: 'edit-smart-collection', smartCollectionId: id }) },
      { label: '复制', click: () => { dependencies.smartCollections.duplicate(id); emitChange('smart-collection:created') } },
      { type: 'separator' },
      { label: '删除智能集合…', click: () => emitAction(window, { type: 'delete-smart-collection', smartCollectionId: id }) }
    ]).popup({ window })
  })

  ipcMain.handle(IPC.collectionSuggestions.list, () => dependencies.collectionSuggestions.list())
  handle(IPC.collectionSuggestions.create, ruleSignatureSchema, (signature) => {
    const collection = dependencies.collectionSuggestions.create(signature)
    emitChange('smart-collection:created')
    return collection
  })
  handle(IPC.collectionSuggestions.ignore, ruleSignatureSchema, (signature) => {
    dependencies.collectionSuggestions.ignore(signature)
    emitChange('smart-collection:updated')
  })
  ipcMain.handle(IPC.collectionSuggestions.listIgnored, () => dependencies.collectionSuggestions.listIgnored())
  handle(IPC.collectionSuggestions.restore, ruleSignatureSchema, (signature) => {
    dependencies.collectionSuggestions.restore(signature)
    emitChange('smart-collection:updated')
  })

  handle(IPC.search.parse, naturalSearchParseRequestSchema, ({ query, forceNatural }) => dependencies.search.parse(query, forceNatural))
  handle(IPC.search.history, naturalSearchHistoryLimitSchema, (limit) => dependencies.search.history(limit))
  handle(IPC.search.removeCondition, naturalSearchRemoveChipSchema, ({ intent, signature }) => dependencies.search.removeCondition(intent, signature))
  handle(IPC.search.saveAsSmartCollection, naturalSearchSaveSchema, ({ queryText, intent }) => {
    const collection = dependencies.search.saveAsSmartCollection(queryText, intent)
    emitChange('smart-collection:created')
    return collection
  })

  ipcMain.handle(IPC.visualSimilarity.getStatus, () => dependencies.visualSimilarity.status())
  ipcMain.handle(IPC.visualSimilarity.prepare, () => dependencies.visualSimilarity.prepare())
  handle(IPC.visualSimilarity.findSimilar, findSimilarSchema, ({ sourceAssetId, limit, minimumScore }) => dependencies.visualSimilarity.findSimilar(sourceAssetId, limit, minimumScore))
  ipcMain.handle(IPC.visualSimilarity.pause, () => dependencies.visualSimilarity.pause())
  ipcMain.handle(IPC.visualSimilarity.resume, () => dependencies.visualSimilarity.resume())
  ipcMain.handle(IPC.visualSimilarity.rebuild, () => dependencies.visualSimilarity.rebuild())
  handle(IPC.visualSimilarity.regenerate, regenerateEmbeddingSchema, ({ assetIds }) => dependencies.visualSimilarity.regenerate(assetIds))
  handle(IPC.visualSimilarity.updatePreferences, visualIndexPreferenceSchema, ({ autoIndexOnImport }) => dependencies.visualSimilarity.setAutoIndexOnImport(autoIndexOnImport))
  dependencies.visualSimilarity.onStatus((status) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.visualSimilarity.statusChanged, status)))

  ipcMain.handle(IPC.duplicates.status, () => dependencies.duplicates.status())
  handle(IPC.duplicates.list, duplicateKindSchema, (kind) => dependencies.duplicates.list(kind))
  handle(IPC.duplicates.get, idSchema, (id) => dependencies.duplicates.get(id))
  ipcMain.handle(IPC.duplicates.scan, () => dependencies.duplicates.scan())
  ipcMain.handle(IPC.duplicates.cancel, () => dependencies.duplicates.cancel())
  handle(IPC.duplicates.ignore, idSchema, (id) => dependencies.duplicates.ignore(id))
  handle(IPC.duplicates.moveOthersToTrash, duplicateCleanupSchema, async ({ groupId, keepAssetId }) => {
    const group = dependencies.duplicates.get(groupId)
    const removedIds = group?.members.map((member) => member.asset.id).filter((id) => id !== keepAssetId) ?? []
    await dependencies.duplicates.moveOthersToTrash(groupId, keepAssetId)
    emitChange('asset:deleted', removedIds)
  })
  dependencies.duplicates.onStatus((status) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.duplicates.statusChanged, status)))

  ipcMain.handle(IPC.agent.state, () => dependencies.agent.state())
  handle(IPC.agent.conversations, museAgentConversationListSchema, ({ includeArchived }) => dependencies.agent.conversations(includeArchived))
  ipcMain.handle(IPC.agent.createConversation, () => dependencies.agent.createConversation())
  handle(IPC.agent.archiveConversation, idSchema, (id) => dependencies.agent.archiveConversation(id))
  handle(IPC.agent.messages, museAgentMessageListSchema, ({ conversationId, limit }) => dependencies.agent.messages(conversationId, limit))
  handle(IPC.agent.send, museAgentSendSchema, ({ conversationId, text }) => dependencies.agent.send(conversationId, text))
  handle(IPC.agent.stop, idSchema, (conversationId) => dependencies.agent.stop(conversationId))
  handle(IPC.agent.updateContext, museAgentContextSchema, (snapshot) => dependencies.agent.updateContext(snapshot))
  handle(IPC.agent.resolveApproval, museAgentApprovalResolutionSchema, ({ requestId, approved }) => dependencies.agent.resolveApproval(requestId, approved))
  dependencies.agent.onEvent((event) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.agent.event, event)))

  ipcMain.handle(IPC.webCollector.status, () => dependencies.webCollector.status())
  handle(IPC.webCollector.revoke, idSchema, (extensionId) => dependencies.webCollector.revoke(extensionId))
  handle(IPC.webCollector.resolvePairing, z.object({ id: idSchema, approved: z.boolean() }), ({ id, approved }) => dependencies.webCollectorPairing.resolve(id, approved))
  dependencies.webCollectorPairing.onRequest((request) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.webCollector.pairingRequested, request)))

  handle(IPC.desktop.showItemInFolder, idSchema, (id) => { const path = requireAssetPath(dependencies.assets, id); shell.showItemInFolder(path) })
  handle(IPC.desktop.copyFile, idSchema, (id) => clipboard.writeText(requireAssetPath(dependencies.assets, id)))
  handle(IPC.desktop.copyImage, idSchema, (id) => clipboard.writeImage(nativeImage.createFromPath(requireAssetPath(dependencies.assets, id))))
  handle(IPC.desktop.copyAssets, idListSchema, (ids) => clipboardService.copyAssetPaths(ids.map((id) => requireAssetPath(dependencies.assets, id))))
  ipcMain.on(IPC.desktop.startAssetDrag, (event, payload) => {
    try {
      const ids = idListSchema.parse(payload)
      const files = [...new Set(ids.map((id) => requireAssetPath(dependencies.assets, id)))]
      clipboardService.startAssetDrag(event.sender, files)
    } catch (error) {
      logger.error(`IPC handler failed: ${IPC.desktop.startAssetDrag}`, serializeError(error))
    }
  })
  handle(IPC.desktop.openExternal, z.string().url(), async (url) => { if (!/^https?:/i.test(url)) throw new Error('Only http(s) links are allowed'); await shell.openExternal(url) })
  ipcMain.handle(IPC.desktop.openFolderDialog, async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return result.filePaths[0] ?? null })
  ipcMain.handle(IPC.desktop.getLibraryPath, () => dependencies.library.root)
  ipcMain.handle(IPC.desktop.openLibraryFolder, () => shell.openPath(dependencies.library.root))
  ipcMain.handle(IPC.desktop.getPlatform, () => normalizePlatform())
  ipcMain.handle(IPC.desktop.libraryTransferStatus, () => dependencies.libraryTransfer.status())
  ipcMain.handle(IPC.desktop.backupLibrary, async () => {
    const selected = await dialog.showOpenDialog({
      title: '选择 Muse Library 备份保存位置',
      buttonLabel: '备份到这里',
      properties: ['openDirectory', 'createDirectory']
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    try { return await dependencies.libraryTransfer.backupTo(selected.filePaths[0]) }
    catch (error) {
      logger.error('Library backup failed', serializeError(error))
      throw toPublicError(error)
    }
  })
  ipcMain.handle(IPC.desktop.openExistingLibrary, async () => {
    const selected = await dependencies.libraryLocation.chooseExisting()
    if (!selected) return { switched: false }
    const validation = validateExistingLibrary(selected)
    if (!validation.valid) throw new Error(validation.message)
    if (selected === dependencies.library.root) return { switched: false, path: selected }
    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: '打开已有 Muse Library',
      message: '切换到所选 Library 并重新启动 Muse？',
      detail: '原图、文件夹分组、标签、收藏、智能集合和 AI 数据会从所选 Library 读取。当前 Library 不会被删除。',
      buttons: ['打开并重启', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (confirmation.response !== 0) return { switched: false }
    dependencies.libraryLocation.remember(selected)
    setTimeout(() => { app.relaunch(); app.exit(0) }, 180)
    return { switched: true, path: selected }
  })

  handle(IPC.assets.showContextMenu, contextMenuSchema, ({ assetId, selectedAssetIds }) => {
    const window = BrowserWindow.getFocusedWindow()
    const asset = dependencies.assets.get(assetId)
    if (!window || !asset) return
    const selected = selectedAssetIds.includes(assetId) ? selectedAssetIds : [assetId]
    const aiProviderId = dependencies.ai.getSettings().providerId
    const revealLabel = process.platform === 'darwin' ? '在 Finder 中显示' : '在文件资源管理器中显示'
    if (dependencies.assets.isTrashed(assetId)) {
      Menu.buildFromTemplate([
        { label: '打开预览', click: () => emitAction(window, { type: 'preview', assetId }) },
        { label: `复制图片${selected.length > 1 ? ` (${selected.length})` : ''}`, click: () => { void clipboardService.copyAssetPaths(selected.map((id) => requireAssetPath(dependencies.assets, id))) } },
        { label: revealLabel, click: () => shell.showItemInFolder(requireAssetPath(dependencies.assets, assetId)) },
        { type: 'separator' },
        { label: `恢复${selected.length > 1 ? ` (${selected.length})` : ''}`, click: () => { dependencies.assets.restore(selected); emitChange('asset:restored', selected) } }
      ]).popup({ window })
      return
    }
    Menu.buildFromTemplate([
      { label: '打开预览', click: () => emitAction(window, { type: 'preview', assetId }) },
      { label: '查找相似图片', click: () => emitAction(window, { type: 'find-similar', assetId }) },
      { label: asset.favorite ? '取消收藏' : '收藏', click: () => { dependencies.assets.toggleFavorite(assetId); emitChange('asset:updated', [assetId]) } },
      { label: `${aiProviderId === 'codex-chatgpt' ? '使用 Codex 智能识别' : 'AI 分析'}${selected.length > 1 ? ` (${selected.length})` : ''}`, click: () => emitAction(window, { type: 'analyze-assets', assetIds: selected }) },
      { type: 'separator' },
      { label: '添加到文件夹', submenu: dependencies.folders.list().map((folder) => ({ label: `${folder.name} (${folder.assetCount})`, click: () => { dependencies.assets.attachToFolder(selected, folder.id); emitChange('asset:updated', selected) } })) },
      { label: '添加标签', submenu: dependencies.tags.list().map((tag) => ({ label: `${tag.name} (${tag.assetCount ?? 0})`, click: () => { dependencies.tags.attach(selected, tag.id); emitChange('asset:updated', selected) } })) },
      { label: `复制图片${selected.length > 1 ? ` (${selected.length})` : ''}`, click: () => { void clipboardService.copyAssetPaths(selected.map((id) => requireAssetPath(dependencies.assets, id))) } },
      { label: revealLabel, click: () => shell.showItemInFolder(requireAssetPath(dependencies.assets, assetId)) },
      { type: 'separator' },
      { label: '移到回收站', click: () => { dependencies.assets.softDelete(selected); emitChange('asset:deleted', selected) } }
    ]).popup({ window })
  })

  ipcMain.on(IPC.window.minimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on(IPC.window.toggleMaximize, (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (window) window.isMaximized() ? window.unmaximize() : window.maximize() })
  ipcMain.on(IPC.window.toggleFullscreen, (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (window) window.setFullScreen(!window.isFullScreen()) })
  ipcMain.on(IPC.window.close, (event) => BrowserWindow.fromWebContents(event.sender)?.close())
}

function requireAssetPath(assets: AssetRepository, id: string): string {
  const path = assets.getFilePath(id)
  if (!path) throw new Error('Asset file not found')
  return path
}

function normalizePlatform(): 'win32' | 'darwin' | 'linux' {
  return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}
