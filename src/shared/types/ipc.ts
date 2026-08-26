import type { AIModelInfo, AIProviderId, AIProviderInfo, AIQueueStatus, AISettings, AISmartCollectionSuggestion, AITermType, AppPreferences, Asset, AssetPage, AssetQuery, AssetWebSource, BootstrapPayload, CodexAccountState, CodexLoginStartResult, CodexUsageState, CollectionSuggestionResult, DesktopAction, DuplicateGroup, DuplicateGroupKind, DuplicateScanStatus, Folder, IgnoredCollectionSuggestion, ImportResult, LibraryBackupResult, LibraryChangeEvent, LibraryTransferStatus, MuseAgentContextSnapshot, MuseAgentConversation, MuseAgentEvent, MuseAgentMessage, MuseAgentState, NaturalSearchChip, NaturalSearchHistoryItem, NaturalSearchIntent, NaturalSearchParseResult, ProviderConnectionResult, SmartCollection, SmartCollectionInput, Tag, TrashPurgeResult, VisualIndexStatus, VisualSimilarityResult, WebCollectorPairingRequest, WebCollectorStatus } from './domain'

export interface MuseAPI {
  app: {
    getBootstrap(): Promise<BootstrapPayload>
    updatePreferences(patch: Partial<AppPreferences>): Promise<AppPreferences>
    onLibraryChanged(listener: (event: LibraryChangeEvent) => void): () => void
    onDesktopAction(listener: (action: DesktopAction) => void): () => void
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    toggleFullscreen(): void
  }
  ai: {
    getSettings(): Promise<AISettings>
    updateSettings(patch: Partial<Omit<AISettings, 'configured' | 'secretConfigured'>>): Promise<AISettings>
    listProviders(): Promise<AIProviderInfo[]>
    detectLocalProviders(): Promise<ProviderConnectionResult[]>
    testConnection(providerId: AIProviderId): Promise<ProviderConnectionResult>
    listModels(providerId: AIProviderId): Promise<AIModelInfo[]>
    setProviderSecret(providerId: AIProviderId, secret: string): Promise<AISettings>
    clearProviderSecret(providerId: AIProviderId): Promise<AISettings>
    analyzeAssets(assetIds: string[], force?: boolean): Promise<AIQueueStatus>
    cancel(assetIds: string[]): Promise<void>
    pause(): Promise<AIQueueStatus>
    resume(): Promise<AIQueueStatus>
    getQueueStatus(): Promise<AIQueueStatus>
    addTerm(assetId: string, type: AITermType, value: string): Promise<void>
    removeTerm(assetId: string, type: AITermType, value: string): Promise<void>
    suggestions(): Promise<AISmartCollectionSuggestion[]>
    onQueueChanged(listener: (status: AIQueueStatus) => void): () => void
    codexAccount(): Promise<CodexAccountState>
    codexLogin(deviceCode?: boolean): Promise<CodexLoginStartResult>
    codexLogout(): Promise<void>
    codexUsage(): Promise<CodexUsageState>
    onCodexChanged(listener: () => void): () => void
  }
  assets: {
    list(query?: AssetQuery): Promise<AssetPage>
    get(id: string): Promise<Asset | null>
    pickAndImport(folderId?: string): Promise<ImportResult>
    importPaths(paths: string[], folderId?: string): Promise<ImportResult>
    toggleFavorite(id: string): Promise<Asset>
    remove(ids: string[]): Promise<void>
    restore(ids: string[]): Promise<void>
    emptyTrash(): Promise<TrashPurgeResult>
    markOpened(id: string): Promise<void>
    showContextMenu(assetId: string, selectedAssetIds: string[]): Promise<void>
    sources(assetId: string): Promise<AssetWebSource[]>
  }
  webCollector: {
    status(): Promise<WebCollectorStatus>
    revoke(extensionId: string): Promise<boolean>
    resolvePairing(id: string, approved: boolean): Promise<boolean>
    onPairingRequested(listener: (request: WebCollectorPairingRequest) => void): () => void
  }
  files: {
    getPath(file: File): string
  }
  desktop: {
    openFileDialog(folderId?: string): Promise<ImportResult>
    openFolderDialog(): Promise<string | null>
    showItemInFolder(assetId: string): Promise<void>
    openExternal(url: string): Promise<void>
    copyFile(assetId: string): Promise<void>
    copyImage(assetId: string): Promise<void>
    copyAssets(assetIds: string[]): Promise<{ count: number; mode: 'image-and-files' | 'files' | 'image' | 'paths' }>
    getLibraryPath(): Promise<string>
    openLibraryFolder(): Promise<void>
    getPlatform(): Promise<'win32' | 'darwin' | 'linux'>
    libraryTransferStatus(): Promise<LibraryTransferStatus>
    backupLibrary(): Promise<LibraryBackupResult | null>
    openExistingLibrary(): Promise<{ switched: boolean; path?: string }>
  }
  folders: {
    list(): Promise<Folder[]>
    create(name: string, parentId?: string | null): Promise<Folder>
    rename(id: string, name: string): Promise<Folder>
    remove(id: string): Promise<void>
    attachAssets(assetIds: string[], folderId: string): Promise<void>
    detachAssets(assetIds: string[], folderId: string): Promise<void>
    moveAssets(assetIds: string[], sourceFolderId: string, targetFolderId: string): Promise<void>
  }
  tags: {
    list(): Promise<Tag[]>
    create(name: string): Promise<Tag>
    attach(assetIds: string[], tagId: string): Promise<void>
    detach(assetIds: string[], tagId: string): Promise<void>
  }
  smartCollections: {
    list(): Promise<SmartCollection[]>
    create(input: SmartCollectionInput): Promise<SmartCollection>
    update(id: string, input: SmartCollectionInput): Promise<SmartCollection>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<SmartCollection>
    preview(input: SmartCollectionInput): Promise<AssetPage>
    showContextMenu(id: string): Promise<void>
  }
  collectionSuggestions: {
    list(): Promise<CollectionSuggestionResult>
    create(ruleSignature: string): Promise<SmartCollection>
    ignore(ruleSignature: string): Promise<void>
    listIgnored(): Promise<IgnoredCollectionSuggestion[]>
    restore(ruleSignature: string): Promise<void>
  }
  search: {
    parse(query: string, forceNatural?: boolean): Promise<NaturalSearchParseResult>
    history(limit?: number): Promise<NaturalSearchHistoryItem[]>
    removeCondition(intent: NaturalSearchIntent, signature: string): Promise<{ intent: NaturalSearchIntent | null; chips: NaturalSearchChip[]; canSaveAsSmartCollection: boolean }>
    saveAsSmartCollection(queryText: string, intent: NaturalSearchIntent): Promise<SmartCollection>
  }
  visualSimilarity: {
    getStatus(): Promise<VisualIndexStatus>
    prepare(): Promise<VisualIndexStatus>
    findSimilar(sourceAssetId: string, limit?: number, minimumScore?: number): Promise<VisualSimilarityResult>
    pause(): Promise<VisualIndexStatus>
    resume(): Promise<VisualIndexStatus>
    rebuild(): Promise<VisualIndexStatus>
    regenerate(assetIds: string[]): Promise<VisualIndexStatus>
    updatePreferences(autoIndexOnImport: boolean): Promise<VisualIndexStatus>
    onStatusChanged(listener: (status: VisualIndexStatus) => void): () => void
  }
  duplicates: {
    status(): Promise<DuplicateScanStatus>
    list(kind?: DuplicateGroupKind): Promise<DuplicateGroup[]>
    get(id: string): Promise<DuplicateGroup | null>
    scan(): Promise<DuplicateScanStatus>
    cancel(): Promise<DuplicateScanStatus>
    ignore(groupId: string): Promise<DuplicateScanStatus>
    moveOthersToTrash(groupId: string, keepAssetId: string): Promise<void>
    onStatusChanged(listener: (status: DuplicateScanStatus) => void): () => void
  }
  agent: {
    state(): Promise<MuseAgentState>
    conversations(includeArchived?: boolean): Promise<MuseAgentConversation[]>
    createConversation(): Promise<MuseAgentConversation>
    archiveConversation(conversationId: string): Promise<void>
    messages(conversationId: string, limit?: number): Promise<MuseAgentMessage[]>
    send(conversationId: string, text: string): Promise<void>
    stop(conversationId: string): Promise<void>
    updateContext(snapshot: MuseAgentContextSnapshot): Promise<void>
    resolveApproval(requestId: string, approved: boolean): Promise<boolean>
    onEvent(listener: (event: MuseAgentEvent) => void): () => void
  }
}
