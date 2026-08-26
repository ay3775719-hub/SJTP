import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/constants/ipc'
import type { AIQueueStatus, AssetQuery, DesktopAction, DuplicateScanStatus, LibraryChangeEvent, MuseAgentEvent, VisualIndexStatus, WebCollectorPairingRequest } from '@shared/types/domain'
import type { MuseAPI } from '@shared/types/ipc'

const api: MuseAPI = {
  app: {
    getBootstrap: () => ipcRenderer.invoke(IPC.app.getBootstrap),
    updatePreferences: (patch) => ipcRenderer.invoke(IPC.app.updatePreferences, patch),
    onLibraryChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: LibraryChangeEvent): void => listener(payload)
      ipcRenderer.on(IPC.app.libraryChanged, handler)
      return () => ipcRenderer.removeListener(IPC.app.libraryChanged, handler)
    },
    onDesktopAction: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: DesktopAction): void => listener(payload)
      ipcRenderer.on(IPC.app.desktopAction, handler)
      return () => ipcRenderer.removeListener(IPC.app.desktopAction, handler)
    }
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC.window.toggleMaximize),
    close: () => ipcRenderer.send(IPC.window.close),
    toggleFullscreen: () => ipcRenderer.send(IPC.window.toggleFullscreen)
  },
  ai: {
    getSettings: () => ipcRenderer.invoke(IPC.ai.getSettings),
    updateSettings: (patch) => ipcRenderer.invoke(IPC.ai.updateSettings, patch),
    listProviders: () => ipcRenderer.invoke(IPC.ai.listProviders),
    detectLocalProviders: () => ipcRenderer.invoke(IPC.ai.detectLocalProviders),
    testConnection: (providerId) => ipcRenderer.invoke(IPC.ai.testConnection, { providerId }),
    listModels: (providerId) => ipcRenderer.invoke(IPC.ai.listModels, { providerId }),
    setProviderSecret: (providerId, secret) => ipcRenderer.invoke(IPC.ai.setProviderSecret, { providerId, secret }),
    clearProviderSecret: (providerId) => ipcRenderer.invoke(IPC.ai.clearProviderSecret, { providerId }),
    analyzeAssets: (assetIds, force = false) => ipcRenderer.invoke(IPC.ai.analyzeAssets, { assetIds, force }),
    cancel: (assetIds) => ipcRenderer.invoke(IPC.ai.cancel, assetIds),
    pause: () => ipcRenderer.invoke(IPC.ai.pause), resume: () => ipcRenderer.invoke(IPC.ai.resume),
    getQueueStatus: () => ipcRenderer.invoke(IPC.ai.getQueueStatus),
    addTerm: (assetId, type, value) => ipcRenderer.invoke(IPC.ai.addTerm, { assetId, type, value }),
    removeTerm: (assetId, type, value) => ipcRenderer.invoke(IPC.ai.removeTerm, { assetId, type, value }),
    suggestions: () => ipcRenderer.invoke(IPC.ai.suggestions),
    onQueueChanged: (listener) => { const handler = (_event: Electron.IpcRendererEvent, status: AIQueueStatus): void => listener(status); ipcRenderer.on(IPC.ai.queueChanged, handler); return () => ipcRenderer.removeListener(IPC.ai.queueChanged, handler) }
    ,codexAccount: () => ipcRenderer.invoke(IPC.ai.codexAccount),
    codexLogin: (deviceCode = false) => ipcRenderer.invoke(IPC.ai.codexLogin, { deviceCode }),
    codexLogout: () => ipcRenderer.invoke(IPC.ai.codexLogout),
    codexUsage: () => ipcRenderer.invoke(IPC.ai.codexUsage),
    onCodexChanged: (listener) => { const handler = (): void => listener(); ipcRenderer.on(IPC.ai.codexChanged, handler); return () => ipcRenderer.removeListener(IPC.ai.codexChanged, handler) }
  },
  assets: {
    list: (query: AssetQuery = {}) => ipcRenderer.invoke(IPC.assets.list, query),
    get: (id) => ipcRenderer.invoke(IPC.assets.get, id),
    pickAndImport: (folderId) => ipcRenderer.invoke(IPC.assets.pickAndImport, folderId),
    importPaths: (paths, folderId) => ipcRenderer.invoke(IPC.assets.importPaths, { paths, source: 'local', folderId }),
    toggleFavorite: (id) => ipcRenderer.invoke(IPC.assets.toggleFavorite, id),
    remove: (ids) => ipcRenderer.invoke(IPC.assets.remove, ids),
    restore: (ids) => ipcRenderer.invoke(IPC.assets.restore, ids),
    emptyTrash: () => ipcRenderer.invoke(IPC.assets.emptyTrash),
    markOpened: (id) => ipcRenderer.invoke(IPC.assets.markOpened, id),
    showContextMenu: (assetId, selectedAssetIds) => ipcRenderer.invoke(IPC.assets.showContextMenu, { assetId, selectedAssetIds }),
    sources: (assetId) => ipcRenderer.invoke(IPC.assets.sources, assetId)
  },
  webCollector: {
    status: () => ipcRenderer.invoke(IPC.webCollector.status),
    revoke: (extensionId) => ipcRenderer.invoke(IPC.webCollector.revoke, extensionId),
    resolvePairing: (id, approved) => ipcRenderer.invoke(IPC.webCollector.resolvePairing, { id, approved }),
    onPairingRequested: (listener) => { const handler = (_event: Electron.IpcRendererEvent, request: WebCollectorPairingRequest): void => listener(request); ipcRenderer.on(IPC.webCollector.pairingRequested, handler); return () => ipcRenderer.removeListener(IPC.webCollector.pairingRequested, handler) }
  },
  files: { getPath: (file) => webUtils.getPathForFile(file) },
  desktop: {
    openFileDialog: (folderId) => ipcRenderer.invoke(IPC.desktop.openFileDialog, folderId),
    openFolderDialog: () => ipcRenderer.invoke(IPC.desktop.openFolderDialog),
    showItemInFolder: (assetId) => ipcRenderer.invoke(IPC.desktop.showItemInFolder, assetId),
    openExternal: (url) => ipcRenderer.invoke(IPC.desktop.openExternal, url),
    copyFile: (assetId) => ipcRenderer.invoke(IPC.desktop.copyFile, assetId),
    copyImage: (assetId) => ipcRenderer.invoke(IPC.desktop.copyImage, assetId),
    copyAssets: (assetIds) => ipcRenderer.invoke(IPC.desktop.copyAssets, assetIds),
    getLibraryPath: () => ipcRenderer.invoke(IPC.desktop.getLibraryPath),
    openLibraryFolder: () => ipcRenderer.invoke(IPC.desktop.openLibraryFolder),
    getPlatform: () => ipcRenderer.invoke(IPC.desktop.getPlatform),
    libraryTransferStatus: () => ipcRenderer.invoke(IPC.desktop.libraryTransferStatus),
    backupLibrary: () => ipcRenderer.invoke(IPC.desktop.backupLibrary),
    openExistingLibrary: () => ipcRenderer.invoke(IPC.desktop.openExistingLibrary)
  },
  folders: {
    list: () => ipcRenderer.invoke(IPC.folders.list),
    create: (name, parentId) => ipcRenderer.invoke(IPC.folders.create, { name, parentId }),
    rename: (id, name) => ipcRenderer.invoke(IPC.folders.rename, { id, name }),
    remove: (id) => ipcRenderer.invoke(IPC.folders.remove, id),
    attachAssets: (assetIds, folderId) => ipcRenderer.invoke(IPC.folders.attachAssets, { assetIds, folderId }),
    detachAssets: (assetIds, folderId) => ipcRenderer.invoke(IPC.folders.detachAssets, { assetIds, folderId }),
    moveAssets: (assetIds, sourceFolderId, targetFolderId) => ipcRenderer.invoke(IPC.folders.moveAssets, { assetIds, sourceFolderId, targetFolderId })
  },
  tags: {
    list: () => ipcRenderer.invoke(IPC.tags.list),
    create: (name) => ipcRenderer.invoke(IPC.tags.create, { name }),
    attach: (assetIds, tagId) => ipcRenderer.invoke(IPC.tags.attach, { assetIds, tagId }),
    detach: (assetIds, tagId) => ipcRenderer.invoke(IPC.tags.detach, { assetIds, tagId })
  },
  smartCollections: {
    list: () => ipcRenderer.invoke(IPC.smartCollections.list),
    create: (input) => ipcRenderer.invoke(IPC.smartCollections.create, input),
    update: (id, input) => ipcRenderer.invoke(IPC.smartCollections.update, { id, input }),
    remove: (id) => ipcRenderer.invoke(IPC.smartCollections.remove, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.smartCollections.duplicate, id),
    preview: (input) => ipcRenderer.invoke(IPC.smartCollections.preview, input),
    showContextMenu: (id) => ipcRenderer.invoke(IPC.smartCollections.showContextMenu, id)
  },
  collectionSuggestions: {
    list: () => ipcRenderer.invoke(IPC.collectionSuggestions.list),
    create: (ruleSignature) => ipcRenderer.invoke(IPC.collectionSuggestions.create, ruleSignature),
    ignore: (ruleSignature) => ipcRenderer.invoke(IPC.collectionSuggestions.ignore, ruleSignature),
    listIgnored: () => ipcRenderer.invoke(IPC.collectionSuggestions.listIgnored),
    restore: (ruleSignature) => ipcRenderer.invoke(IPC.collectionSuggestions.restore, ruleSignature)
  },
  search: {
    parse: (query, forceNatural = false) => ipcRenderer.invoke(IPC.search.parse, { query, forceNatural }),
    history: (limit = 10) => ipcRenderer.invoke(IPC.search.history, limit),
    removeCondition: (intent, signature) => ipcRenderer.invoke(IPC.search.removeCondition, { intent, signature }),
    saveAsSmartCollection: (queryText, intent) => ipcRenderer.invoke(IPC.search.saveAsSmartCollection, { queryText, intent })
  },
  visualSimilarity: {
    getStatus: () => ipcRenderer.invoke(IPC.visualSimilarity.getStatus),
    prepare: () => ipcRenderer.invoke(IPC.visualSimilarity.prepare),
    findSimilar: (sourceAssetId, limit = 100, minimumScore) => ipcRenderer.invoke(IPC.visualSimilarity.findSimilar, { sourceAssetId, limit, minimumScore }),
    pause: () => ipcRenderer.invoke(IPC.visualSimilarity.pause),
    resume: () => ipcRenderer.invoke(IPC.visualSimilarity.resume),
    rebuild: () => ipcRenderer.invoke(IPC.visualSimilarity.rebuild),
    regenerate: (assetIds) => ipcRenderer.invoke(IPC.visualSimilarity.regenerate, { assetIds }),
    updatePreferences: (autoIndexOnImport) => ipcRenderer.invoke(IPC.visualSimilarity.updatePreferences, { autoIndexOnImport }),
    onStatusChanged: (listener) => { const handler = (_event: Electron.IpcRendererEvent, status: VisualIndexStatus): void => listener(status); ipcRenderer.on(IPC.visualSimilarity.statusChanged, handler); return () => ipcRenderer.removeListener(IPC.visualSimilarity.statusChanged, handler) }
  },
  duplicates: {
    status: () => ipcRenderer.invoke(IPC.duplicates.status),
    list: (kind) => ipcRenderer.invoke(IPC.duplicates.list, kind),
    get: (id) => ipcRenderer.invoke(IPC.duplicates.get, id),
    scan: () => ipcRenderer.invoke(IPC.duplicates.scan),
    cancel: () => ipcRenderer.invoke(IPC.duplicates.cancel),
    ignore: (groupId) => ipcRenderer.invoke(IPC.duplicates.ignore, groupId),
    moveOthersToTrash: (groupId, keepAssetId) => ipcRenderer.invoke(IPC.duplicates.moveOthersToTrash, { groupId, keepAssetId }),
    onStatusChanged: (listener) => { const handler = (_event: Electron.IpcRendererEvent, status: DuplicateScanStatus): void => listener(status); ipcRenderer.on(IPC.duplicates.statusChanged, handler); return () => ipcRenderer.removeListener(IPC.duplicates.statusChanged, handler) }
  },
  agent: {
    state: () => ipcRenderer.invoke(IPC.agent.state),
    conversations: (includeArchived = false) => ipcRenderer.invoke(IPC.agent.conversations, { includeArchived }),
    createConversation: () => ipcRenderer.invoke(IPC.agent.createConversation),
    archiveConversation: (conversationId) => ipcRenderer.invoke(IPC.agent.archiveConversation, conversationId),
    messages: (conversationId, limit = 200) => ipcRenderer.invoke(IPC.agent.messages, { conversationId, limit }),
    send: (conversationId, text) => ipcRenderer.invoke(IPC.agent.send, { conversationId, text }),
    stop: (conversationId) => ipcRenderer.invoke(IPC.agent.stop, conversationId),
    updateContext: (snapshot) => ipcRenderer.invoke(IPC.agent.updateContext, snapshot),
    resolveApproval: (requestId, approved) => ipcRenderer.invoke(IPC.agent.resolveApproval, { requestId, approved }),
    onEvent: (listener) => { const handler = (_event: Electron.IpcRendererEvent, payload: MuseAgentEvent): void => listener(payload); ipcRenderer.on(IPC.agent.event, handler); return () => ipcRenderer.removeListener(IPC.agent.event, handler) }
  }
}

contextBridge.exposeInMainWorld('muse', api)
