import { app, BrowserWindow, Menu, net, protocol } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join, normalize, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '@shared/constants/ipc'
import type { DesktopAction } from '@shared/types/domain'
import { DatabaseService } from './database/DatabaseService'
import { AssetRepository } from './database/repositories/AssetRepository'
import { FolderRepository } from './database/repositories/FolderRepository'
import { TagRepository } from './database/repositories/TagRepository'
import { SettingsRepository } from './database/repositories/SettingsRepository'
import { SmartCollectionRepository } from './database/repositories/SmartCollectionRepository'
import { SmartCollectionService } from './services/smartCollections/SmartCollectionService'
import { CollectionSuggestionRepository } from './database/repositories/CollectionSuggestionRepository'
import { CollectionSuggestionService } from './services/smartCollections/CollectionSuggestionService'
import { ensureLibrary, type LibraryDirectories } from './services/filesystem/LibraryPaths'
import { AssetImporter } from './services/assets/AssetImporter'
import { TrashService } from './services/assets/TrashService'
import { WindowStateService } from './services/desktop/WindowStateService'
import { LibraryLocationService } from './services/desktop/LibraryLocationService'
import { registerIpc } from './ipc/registerIpc'
import { logger, serializeError } from './logger'
import { AIAnalysisRepository } from './database/repositories/AIAnalysisRepository'
import { AIAnalysisService } from './services/ai/AIService'
import { AICredentialStore } from './services/ai/AICredentialStore'
import { LocalColorAnalysisService } from './services/ai/LocalColorAnalysisService'
import { CodexAppServerManager } from './services/ai/codex/CodexAppServerManager'
import { NaturalSearchRepository } from './database/repositories/NaturalSearchRepository'
import { NaturalLanguageSearchService } from './services/search/NaturalLanguageSearchService'
import { SearchEntityResolver } from './services/search/SearchEntityResolver'
import { EmbeddingRepository } from './database/repositories/EmbeddingRepository'
import { EmbeddingModelManager, BUILTIN_EMBEDDING_MODEL } from './services/embeddings/EmbeddingModelManager'
import { EmbeddingWorkerClient } from './services/embeddings/EmbeddingWorkerClient'
import { VisualEmbeddingService } from './services/embeddings/VisualEmbeddingService'
import { DuplicateRepository } from './database/repositories/DuplicateRepository'
import { DuplicateDetectionService } from './services/duplicates/DuplicateDetectionService'
import { MuseAgentRepository } from './database/repositories/MuseAgentRepository'
import { MuseAgentContextService } from './services/agent/MuseAgentContextService'
import { MuseAgentApprovalService } from './services/agent/MuseAgentApprovalService'
import { MuseToolRegistry } from './services/agent/MuseToolRegistry'
import { CodexToolBridge } from './services/agent/CodexToolBridge'
import { MuseAgentService } from './services/agent/MuseAgentService'
import { SemanticSearchModelManager, SEMANTIC_SEARCH_MODEL } from './services/search/SemanticSearchModelManager'
import { SemanticSearchWorkerClient } from './services/search/SemanticSearchWorkerClient'
import { LocalSemanticSearchService } from './services/search/LocalSemanticSearchService'
import { HybridSearchService } from './services/search/HybridSearchService'
import { AssetSourceRepository } from './database/repositories/AssetSourceRepository'
import { WebCollectorRepository } from './database/repositories/WebCollectorRepository'
import { WebCollectorPairingService } from './services/webCollector/WebCollectorPairingService'
import { WebImageDownloader } from './services/webCollector/WebImageDownloader'
import { WebAssetFormatNormalizer } from './services/webCollector/WebAssetFormatNormalizer'
import { WebCollectorService } from './services/webCollector/WebCollectorService'
import { WebCollectorBridge } from './services/webCollector/WebCollectorBridge'
import { WebCollectorNativeBridge } from './services/webCollector/WebCollectorNativeBridge'
import { registerNativeMessagingHost } from './services/webCollector/NativeMessagingRegistration'
import { LibraryTransferService, relocateManagedPaths } from './services/filesystem/LibraryTransferService'

if (process.env.MUSE_DISABLE_HARDWARE_ACCELERATION === '1') app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'muse', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let database: DatabaseService | null = null
let library: LibraryDirectories | null = null
let codexManager: CodexAppServerManager | null = null
let visualEmbedding: VisualEmbeddingService | null = null
let localSemanticSearch: LocalSemanticSearchService | null = null
let webCollectorBridge: WebCollectorBridge | null = null
let webCollectorNativeBridge: WebCollectorNativeBridge | null = null

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
})

const encodePath = (absolutePath: string): string => Buffer.from(absolutePath, 'utf8').toString('base64url')
const decodePath = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

function isWithin(root: string, candidate: string): boolean {
  const result = relative(normalize(root), normalize(candidate))
  return result !== '' ? !result.startsWith(`..${sep}`) && result !== '..' && !result.startsWith(sep) : true
}

function sendDesktopAction(action: DesktopAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC.app.desktopAction, action)
}

function resolveBundledSibling(directory: 'preload' | 'renderer', filename: string): string {
  const direct = join(__dirname, '..', directory, filename)
  return existsSync(direct) ? direct : join(__dirname, '..', '..', directory, filename)
}

function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '文件', submenu: [
        { label: '导入图片…', accelerator: 'CmdOrCtrl+I', click: () => sendDesktopAction({ type: 'import' }) },
        { label: '打开 Library 文件夹', click: () => { if (library) void import('electron').then(({ shell }) => shell.openPath(library!.root)) } },
        { type: 'separator' }, { role: isMac ? 'close' : 'quit' }
      ]
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { label: '复制', click: () => sendDesktopAction({ type: 'copy-selection' }) }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '显示', submenu: [{ role: 'reload' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]), { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])] }
  ]))
}

function createWindow(stateService: WindowStateService): BrowserWindow {
  const state = stateService.load()
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    ...state,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 15, y: 18 } : undefined,
    backgroundColor: '#15171a',
    webPreferences: {
      preload: resolveBundledSibling('preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  stateService.track(window)
  if (state.maximized) window.maximize()
  window.webContents.on('console-message', (_event, level, message) => logger.info(`Renderer[${level}]: ${message}`))
  window.webContents.on('did-fail-load', (_event, code, description) => logger.error('Renderer failed to load', { code, description }))
  window.once('ready-to-show', () => {
    window.show()
  })
  window.webContents.once('did-finish-load', () => {
    const capturePath = process.env.MUSE_CAPTURE_PATH
    if (capturePath) setTimeout(async () => {
      const previewImportPath = process.env.MUSE_QA_PREVIEW_IMPORT_PATH
      if (previewImportPath) {
        const importPaths = [previewImportPath, process.env.MUSE_QA_PREVIEW_IMPORT_PATH_2].filter((value): value is string => Boolean(value))
        await window.webContents.executeJavaScript(`window.muse.assets.importPaths(${JSON.stringify(importPaths)})`)
        await new Promise((resolve) => setTimeout(resolve, 1400))
        await window.webContents.executeJavaScript(`(() => { const card = document.querySelector('.asset-card'); card?.dispatchEvent(new MouseEvent('click', { bubbles: true })); card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`)
        await new Promise((resolve) => setTimeout(resolve, 900))
        if (process.env.MUSE_QA_VIEWER_ACTION === 'zoom-pan') {
          await window.webContents.executeJavaScript(`(() => {
            const stage = document.querySelector('.preview-image-stage');
            if (!stage) return;
            const rect = stage.getBoundingClientRect();
            stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: rect.right - 100, clientY: rect.bottom - 80, deltaY: -650 }));
            stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
            window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: rect.left + rect.width / 2 - 150, clientY: rect.top + rect.height / 2 - 90 }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: rect.left + rect.width / 2 - 150, clientY: rect.top + rect.height / 2 - 90 }));
          })()`)
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'double-click') {
          await window.webContents.executeJavaScript(`document.querySelector('.preview-image-stage')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 768, clientY: 512 }))`)
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'double-click-twice') {
          await window.webContents.executeJavaScript(`(() => { const stage = document.querySelector('.preview-image-stage'); stage?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 768, clientY: 512 })); stage?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 768, clientY: 512 })); })()`)
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'zoom-switch') {
          await window.webContents.executeJavaScript(`document.querySelector('.preview-arrow.left')?.click()`)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'resize-fit') {
          window.setSize(1200, 800)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'escape') {
          await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))`)
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'actual-key') {
          await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '1', ctrlKey: true }))`)
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        if (process.env.MUSE_QA_VIEWER_ACTION === 'fit-key') {
          await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0', ctrlKey: true }))`)
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      if (process.env.MUSE_QA_OPEN_SMART_COLLECTION === 'true') {
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="创建智能集合"]')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      if (process.env.MUSE_QA_CREATE_SMART_COLLECTION === 'true') {
        await window.webContents.executeJavaScript(`(() => { document.querySelector('[aria-label="创建智能集合"]')?.click(); setTimeout(() => { const name = document.querySelector('.smart-field-label input'); if (name) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(name, 'PNG 图片'); name.dispatchEvent(new Event('input', { bubbles: true })); } setTimeout(() => document.querySelector('.smart-modal footer .primary')?.click(), 350); }, 250); })()`)
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      if (process.env.MUSE_QA_SELECT_FIRST === 'true') {
        await window.webContents.executeJavaScript(`document.querySelector('.asset-card')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
        await new Promise((resolve) => setTimeout(resolve, 450))
      }
      if (process.env.MUSE_QA_FIND_SIMILAR) {
        sendDesktopAction({ type: 'find-similar', assetId: process.env.MUSE_QA_FIND_SIMILAR })
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_FIND_SIMILAR_WAIT_MS ?? 2_000)))
      }
      if (process.env.MUSE_QA_OPEN_DUPLICATES === 'true') {
        sendDesktopAction({ type: 'open-duplicates' })
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_DUPLICATES_WAIT_MS ?? 4_000)))
      }
      if (process.env.MUSE_QA_OPEN_AI_SETTINGS === 'true') {
        await window.webContents.executeJavaScript(`document.querySelector('.sidebar-settings')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 3800))
      }
      if (process.env.MUSE_QA_OPEN_SUGGESTIONS === 'true') {
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label="整理建议入口"] button')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 900))
      }
      if (process.env.MUSE_QA_IMPORT_PATH) {
        await window.webContents.executeJavaScript(`(async () => { window.__MUSE_QA_IMPORT_RESULT__ = await window.muse.assets.importPaths([${JSON.stringify(process.env.MUSE_QA_IMPORT_PATH)}]); return window.__MUSE_QA_IMPORT_RESULT__; })()`)
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_IMPORT_WAIT_MS ?? 8_000)))
      }
      if (process.env.MUSE_QA_OPEN_TRASH === 'true') {
        if (process.env.MUSE_QA_TRASH_IMPORTED === 'true') {
          await window.webContents.executeJavaScript(`(async () => { const ids = (window.__MUSE_QA_IMPORT_RESULT__?.imported ?? []).map((asset) => asset.id); if (ids.length) await window.muse.assets.remove(ids); })()`)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('回收站'))?.click()`)
        await new Promise((resolve) => setTimeout(resolve, 700))
        if (process.env.MUSE_QA_SHOW_EMPTY_TRASH_CONFIRM === 'true') {
          await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('清空回收站'))?.click()`)
          await new Promise((resolve) => setTimeout(resolve, 350))
        }
      }
      if (process.env.MUSE_QA_OPEN_AGENT === 'true') {
        await window.webContents.executeJavaScript(`document.querySelector('.sidebar-agent')?.click()`)
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_AGENT_WAIT_MS ?? 1_200)))
        if (process.env.MUSE_QA_AGENT_PROMPT) {
          await window.webContents.executeJavaScript(`(() => {
            const input = document.querySelector('.muse-agent-panel textarea');
            if (!input) return;
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(process.env.MUSE_QA_AGENT_PROMPT)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
          })()`)
          await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_AGENT_PROMPT_WAIT_MS ?? 20_000)))
        }
      }
      if (process.env.MUSE_QA_NATURAL_SEARCH) {
        const searchQuery = process.env.MUSE_QA_NATURAL_SEARCH
        await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('#asset-search');
          if (!input) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(searchQuery)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        })()`)
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.MUSE_QA_NATURAL_SEARCH_WAIT_MS ?? 18_000)))
      }
      const diagnostics = await window.webContents.executeJavaScript(`JSON.stringify((() => { const overlay = document.querySelector('.preview-overlay'); const stage = document.querySelector('.preview-image-stage'); const image = document.querySelector('.preview-image-transform img'); const galleryTitle = document.querySelector('.gallery-title'); return { url: location.href, title: document.title, muse: Boolean(window.muse), qaImport: window.__MUSE_QA_IMPORT_RESULT__ ?? null, filename: document.querySelector('.preview-top > span')?.textContent, gallery: galleryTitle ? { text: galleryTitle.textContent, renderedCards: document.querySelectorAll('.asset-card').length, emptyState: document.querySelector('.empty-library')?.textContent } : null, bodyScroll: { width: document.body.scrollWidth, clientWidth: document.body.clientWidth, height: document.body.scrollHeight, clientHeight: document.body.clientHeight }, overlay: overlay ? { rect: overlay.getBoundingClientRect().toJSON(), display: getComputedStyle(overlay).display, position: getComputedStyle(overlay).position, zIndex: getComputedStyle(overlay).zIndex, background: getComputedStyle(overlay).backgroundColor } : null, viewer: stage ? { mode: stage.dataset.zoomMode, zoom: stage.dataset.zoom, overflow: getComputedStyle(stage).overflow, scrollWidth: stage.scrollWidth, clientWidth: stage.clientWidth, scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight, imageTransform: image?.style.transform, panTransform: document.querySelector('.preview-image-transform')?.style.transform } : null } })())`)
      writeFileSync(`${capturePath}.json`, diagnostics, 'utf8')
      await window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
      const image = await window.webContents.capturePage()
      writeFileSync(capturePath, image.toPNG())
      app.quit()
    }, 1500)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('context-menu', (event) => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(resolveBundledSibling('renderer', 'index.html'))
  return window
}

app.whenReady().then(async () => {
  if (!singleInstance) return
  const libraryLocation = new LibraryLocationService()
  const libraryRoot = await libraryLocation.resolve()
  if (!libraryRoot) { app.quit(); return }
  library = ensureLibrary(libraryRoot)
  database = new DatabaseService(library.database)
  const relocatedAssets = relocateManagedPaths(database.db, library.root)
  if (relocatedAssets) logger.info('Relocated managed Library paths', { root: library.root, assets: relocatedAssets })
  const toLocalUrl = (path: string): string => `muse://local/${encodePath(path)}`
  const assets = new AssetRepository(database.db, toLocalUrl)
  await new WebAssetFormatNormalizer(database.db, library.backups).normalizeLegacyAssets()
  const trash = new TrashService(database.db, library)
  const folders = new FolderRepository(database.db)
  const tags = new TagRepository(database.db)
  const settings = new SettingsRepository(database.db)
  const smartCollections = new SmartCollectionService(new SmartCollectionRepository(database.db), assets)
  const collectionSuggestions = new CollectionSuggestionService(new CollectionSuggestionRepository(database.db), assets, smartCollections)
  codexManager = new CodexAppServerManager({ userDataPath: app.getPath('userData'), resourcesPath: process.resourcesPath, projectRoot: app.isPackaged ? undefined : process.cwd() })
  const searchResolver = new SearchEntityResolver(() => folders.list(), () => tags.list())
  const semanticModelRoot = process.env.MUSE_SEMANTIC_MODEL_ROOT?.trim() || join(app.getPath('userData'), 'models', 'semantic-search')
  const semanticRepository = new EmbeddingRepository(database.db, { providerId: SEMANTIC_SEARCH_MODEL.providerId, modelId: SEMANTIC_SEARCH_MODEL.modelId, modelVersion: SEMANTIC_SEARCH_MODEL.modelVersion, dimension: SEMANTIC_SEARCH_MODEL.dimension })
  localSemanticSearch = new LocalSemanticSearchService(semanticRepository, new SemanticSearchModelManager(semanticModelRoot), new SemanticSearchWorkerClient({ modelsRoot: semanticModelRoot, localModelId: SEMANTIC_SEARCH_MODEL.localModelId, dimension: SEMANTIC_SEARCH_MODEL.dimension }))
  const hybridSearch = new HybridSearchService(assets, searchResolver, localSemanticSearch)
  const search = new NaturalLanguageSearchService(
    database.db, new NaturalSearchRepository(database.db), assets, smartCollections,
    searchResolver, codexManager, join(app.getPath('userData'), 'codex-search-workspace'), hybridSearch
  )
  const ai = new AIAnalysisService(new AIAnalysisRepository(database.db), assets, settings, new AICredentialStore(app.getPath('userData')), codexManager, join(app.getPath('userData'), 'codex-batch-workspaces'), (assetId) => {
    collectionSuggestions.invalidate()
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.app.libraryChanged, { kind: 'ai:updated', assetIds: [assetId] }))
  })
  const embeddingRepository = new EmbeddingRepository(database.db, {
    providerId: BUILTIN_EMBEDDING_MODEL.providerId, modelId: BUILTIN_EMBEDDING_MODEL.modelId,
    modelVersion: BUILTIN_EMBEDDING_MODEL.modelVersion, dimension: BUILTIN_EMBEDDING_MODEL.dimension
  })
  const visualModelRoot = process.env.MUSE_VISUAL_MODEL_ROOT?.trim() || join(app.getPath('userData'), 'models', 'visual-embedding')
  const embeddingModelManager = new EmbeddingModelManager(visualModelRoot)
  const embeddingWorker = new EmbeddingWorkerClient({
    modelsRoot: visualModelRoot, localModelId: BUILTIN_EMBEDDING_MODEL.localModelId, databasePath: library.database, model: embeddingRepository.model
  })
  visualEmbedding = new VisualEmbeddingService(embeddingRepository, assets, settings, embeddingModelManager, embeddingWorker)
  await visualEmbedding.initialize()
  const duplicates = new DuplicateDetectionService(new DuplicateRepository(database.db, assets, embeddingRepository.model), assets, embeddingRepository)
  const agentRepository = new MuseAgentRepository(database.db)
  const agentContext = new MuseAgentContextService()
  const agentApproval = new MuseAgentApprovalService()
  let agent!: MuseAgentService
  const agentRegistry = new MuseToolRegistry({
    assets, folders, tags, smartCollections, search, visualSimilarity: visualEmbedding, duplicates,
    context: agentContext, approval: agentApproval, repository: agentRepository,
    emitAction: (action) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.app.desktopAction, action)),
    emitLibraryChange: (kind, assetIds) => {
      collectionSuggestions.invalidate(); duplicates.invalidate()
      BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.app.libraryChanged, { kind, assetIds }))
    },
    emitActivity: (context, toolName, label, active) => agent.emitActivity(context, toolName, label, active)
  })
  const agentBridge = new CodexToolBridge(codexManager, agentRegistry)
  agent = new MuseAgentService(agentRepository, codexManager, agentBridge, agentApproval, agentContext, join(app.getPath('userData'), 'muse-agent-workspace'))
  visualEmbedding.onStatus((status) => { if (status.modelState === 'ready' && status.queued === 0 && status.generating === 0) duplicates.invalidate() })
  ai.queue.onStatus((status) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.ai.queueChanged, status)))
  const importer = new AssetImporter(library, assets, (assetIds) => {
    ai.autoAnalyze(assetIds)
    // Keep local inference outside the import transaction and never allow a
    // background model failure to become an unhandled rejection in Electron
    // Main. Sequential work also keeps CPU and memory pressure predictable.
    void (async () => {
      try { await visualEmbedding?.onAssetsImported(assetIds) }
      catch (error) { logger.warn('Imported visual indexing failed', { assetIds, error: serializeError(error) }) }
      try { await localSemanticSearch?.onAssetsImported(assetIds) }
      catch (error) { logger.warn('Imported semantic indexing failed', { assetIds, error: serializeError(error) }) }
      duplicates.invalidate()
    })()
  })
  const assetSources = new AssetSourceRepository(database.db)
  const webCollectorRepository = new WebCollectorRepository(database.db)
  const webCollectorPairing = new WebCollectorPairingService(webCollectorRepository)
  const libraryTransfer = new LibraryTransferService(database.db, library, app.getVersion())
  const webCollector = new WebCollectorService(
    new WebImageDownloader(join(library.cache, 'web-collector')),
    importer, assets, assetSources,
    (assetId, status, domain) => {
      collectionSuggestions.invalidate(); duplicates.invalidate()
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send(IPC.app.libraryChanged, { kind: status === 'saved' ? 'asset:created' : 'asset:updated', assetIds: [assetId] })
        window.webContents.send(IPC.app.desktopAction, { type: 'web-asset-collected', assetId, status, domain })
      })
    }
  )
  webCollectorBridge = new WebCollectorBridge(webCollectorRepository, webCollectorPairing, webCollector)
  webCollectorNativeBridge = new WebCollectorNativeBridge(webCollectorRepository, webCollector)
  const localColors = new LocalColorAnalysisService(assets, (assetId) => {
    collectionSuggestions.invalidate()
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(IPC.app.libraryChanged, { kind: 'ai:updated', assetIds: [assetId] }))
  })

  protocol.handle('muse', (request) => {
    try {
      if (!library) return new Response('Library unavailable', { status: 503 })
      const url = new URL(request.url)
      const requestedPath = decodePath(url.pathname.slice(1))
      if (!isWithin(library.root, requestedPath)) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(requestedPath).toString())
    } catch (error) {
      logger.warn('Invalid muse protocol request', serializeError(error))
      return new Response('Bad request', { status: 400 })
    }
  })

  registerIpc({ assets, trash, importer, folders, tags, settings, smartCollections, collectionSuggestions, library, ai, search, visualSimilarity: visualEmbedding, duplicates, agent, assetSources, webCollector: webCollectorBridge, webCollectorPairing, libraryTransfer, libraryLocation })
  ai.queue.start()
  localColors.startBackfill()
  void localSemanticSearch.initialize().catch((error) => logger.warn('Local semantic search initialization deferred', serializeError(error)))
  installApplicationMenu()
  const stateService = new WindowStateService(join(app.getPath('userData'), 'window-state.json'))
  createWindow(stateService)
  await webCollectorBridge.start()
  await webCollectorNativeBridge.start()
  void registerNativeMessagingHost().catch((error) => logger.warn('Native Messaging host registration failed', serializeError(error)))
  duplicates.invalidate()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(stateService) })
}).catch((error) => {
  logger.error('App initialization failed', serializeError(error))
  app.quit()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => database?.close())
app.on('before-quit', () => { void codexManager?.shutdown() })
app.on('before-quit', () => { void visualEmbedding?.dispose() })
app.on('before-quit', () => { void localSemanticSearch?.dispose() })
app.on('before-quit', () => { void webCollectorBridge?.stop() })
app.on('before-quit', () => { void webCollectorNativeBridge?.stop() })
