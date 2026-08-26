export const IPC = {
  app: { getBootstrap: 'app:get-bootstrap', updatePreferences: 'app:update-preferences', libraryChanged: 'library:changed', desktopAction: 'desktop:action' },
  ai: {
    getSettings: 'ai:get-settings', updateSettings: 'ai:update-settings', listProviders: 'ai:list-providers',
    detectLocalProviders: 'ai:detect-local-providers', testConnection: 'ai:test-connection', listModels: 'ai:list-models',
    setProviderSecret: 'ai:set-provider-secret', clearProviderSecret: 'ai:clear-provider-secret',
    analyzeAssets: 'ai:analyze-assets', cancel: 'ai:cancel', pause: 'ai:pause', resume: 'ai:resume', getQueueStatus: 'ai:get-queue-status',
    queueChanged: 'ai:queue-changed', addTerm: 'ai:add-term', removeTerm: 'ai:remove-term', suggestions: 'ai:suggestions',
    codexAccount: 'ai:codex-account', codexLogin: 'ai:codex-login', codexLogout: 'ai:codex-logout', codexUsage: 'ai:codex-usage', codexChanged: 'ai:codex-changed'
  },
  window: { minimize: 'window:minimize', toggleMaximize: 'window:toggle-maximize', close: 'window:close', toggleFullscreen: 'window:toggle-fullscreen' },
  assets: {
    list: 'assets:list',
    get: 'assets:get',
    pickAndImport: 'assets:pick-and-import',
    importPaths: 'assets:import-paths',
    toggleFavorite: 'assets:toggle-favorite',
    remove: 'assets:remove',
    restore: 'assets:restore',
    emptyTrash: 'assets:empty-trash',
    markOpened: 'assets:mark-opened',
    showContextMenu: 'assets:show-context-menu',
    sources: 'assets:sources'
  },
  webCollector: {
    status: 'web-collector:status', revoke: 'web-collector:revoke', resolvePairing: 'web-collector:resolve-pairing',
    pairingRequested: 'web-collector:pairing-requested'
  },
  files: { getPath: 'files:get-path' },
  desktop: {
    openFileDialog: 'desktop:open-file-dialog', openFolderDialog: 'desktop:open-folder-dialog',
    showItemInFolder: 'desktop:show-item-in-folder', openExternal: 'desktop:open-external',
    copyFile: 'desktop:copy-file', copyImage: 'desktop:copy-image', copyAssets: 'desktop:copy-assets', getLibraryPath: 'desktop:get-library-path',
    openLibraryFolder: 'desktop:open-library-folder', getPlatform: 'desktop:get-platform',
    libraryTransferStatus: 'desktop:library-transfer-status', backupLibrary: 'desktop:backup-library', openExistingLibrary: 'desktop:open-existing-library'
  },
  folders: {
    list: 'folders:list', create: 'folders:create', rename: 'folders:rename', remove: 'folders:remove',
    attachAssets: 'folders:attach-assets', detachAssets: 'folders:detach-assets', moveAssets: 'folders:move-assets'
  },
  tags: { list: 'tags:list', create: 'tags:create', attach: 'tags:attach', detach: 'tags:detach' }
  ,smartCollections: {
    list: 'smart-collections:list', create: 'smart-collections:create', update: 'smart-collections:update',
    remove: 'smart-collections:remove', duplicate: 'smart-collections:duplicate', preview: 'smart-collections:preview',
    showContextMenu: 'smart-collections:show-context-menu'
  },
  collectionSuggestions: {
    list: 'collection-suggestions:list', create: 'collection-suggestions:create', ignore: 'collection-suggestions:ignore',
    listIgnored: 'collection-suggestions:list-ignored', restore: 'collection-suggestions:restore'
  },
  search: {
    parse: 'search:parse', history: 'search:history', removeCondition: 'search:remove-condition', saveAsSmartCollection: 'search:save-as-smart-collection'
  },
  visualSimilarity: {
    getStatus: 'visual-similarity:get-status', prepare: 'visual-similarity:prepare', findSimilar: 'visual-similarity:find-similar',
    pause: 'visual-similarity:pause', resume: 'visual-similarity:resume', rebuild: 'visual-similarity:rebuild',
    regenerate: 'visual-similarity:regenerate', updatePreferences: 'visual-similarity:update-preferences', statusChanged: 'visual-similarity:status-changed'
  },
  duplicates: {
    status: 'duplicates:status', list: 'duplicates:list', get: 'duplicates:get', scan: 'duplicates:scan', cancel: 'duplicates:cancel',
    ignore: 'duplicates:ignore', moveOthersToTrash: 'duplicates:move-others-to-trash', statusChanged: 'duplicates:status-changed'
  },
  agent: {
    state: 'agent:state', conversations: 'agent:conversations', createConversation: 'agent:create-conversation', archiveConversation: 'agent:archive-conversation',
    messages: 'agent:messages', send: 'agent:send', stop: 'agent:stop', updateContext: 'agent:update-context', resolveApproval: 'agent:resolve-approval',
    event: 'agent:event'
  }
} as const
