export type AssetSource = 'local' | 'url' | 'browser_extension' | 'clipboard' | 'screenshot'
export type TagSource = 'manual' | 'ai' | 'system'
export type ThumbnailSize = 'small' | 'medium' | 'large'
export type VisualEmbeddingStatus = 'not_generated' | 'queued' | 'generating' | 'completed' | 'failed' | 'stale'
export type VisualModelState = 'not_installed' | 'preparing' | 'ready' | 'failed'

export interface AssetWebSource {
  id: string
  assetId: string
  sourceType: 'web'
  pageUrl: string
  imageUrl: string
  pageTitle: string | null
  siteName: string | null
  domain: string
  altText: string | null
  collectedAt: string
  createdAt: string
}

export type WebCollectStatus = 'saved' | 'existing_asset_source_added' | 'already_collected' | 'download_failed' | 'invalid_image' | 'unsupported_format' | 'file_too_large' | 'muse_unavailable' | 'unauthorized' | 'invalid_request'

export interface WebCollectPayload {
  imageUrl: string
  pageUrl: string
  pageTitle?: string
  siteName?: string
  domain?: string
  altText?: string
  imageWidth?: number
  imageHeight?: number
  collectedAt: string
  extensionVersion: string
}

export interface WebCollectResult {
  requestId: string
  status: WebCollectStatus
  assetId?: string
  message?: string
}

export interface WebCollectorStatus {
  running: boolean
  port: number
  protocolVersion: number
  pairedBrowsers: Array<{ extensionId: string; browserName: string; createdAt: string; lastUsedAt: string | null }>
}

export interface WebCollectorPairingRequest {
  id: string
  extensionId: string
  browserName: string
  extensionVersion: string
  requestedAt: string
}

export interface ColorSwatch {
  hex: string
  population?: number
  ratio?: number
  hue?: number
  saturation?: number
  lightness?: number
}

export interface ColorAnalysis {
  averageHex: string
  brightness: number
  saturation: number
  temperature: 'cool' | 'neutral' | 'warm'
}

export type AIAnalysisStatus = 'not_analyzed' | 'queued' | 'analyzing' | 'completed' | 'failed'
export type AITermType = 'object' | 'scene' | 'style' | 'mood' | 'lighting' | 'composition' | 'material' | 'usage' | 'semantic_color' | 'open_tag'
export type AITermSource = 'ai' | 'manual' | 'system'
export type AIProviderId = 'codex-chatgpt' | 'ollama' | 'lmstudio' | 'openai' | 'gemini' | 'anthropic' | 'openai-compatible'
export type AIRunMode = 'local-only' | 'cloud-only' | 'manual'
export type AIProviderKind = 'local' | 'cloud' | 'custom'
export type AIProviderHealthStatus = 'connected' | 'disconnected' | 'model_missing' | 'model_incompatible' | 'auth_failed' | 'rate_limited' | 'unknown'

export interface AIModelCapabilities {
  vision: boolean
  structuredOutput: boolean
  text: boolean
  local: boolean
}

export interface AIModelInfo {
  id: string
  name: string
  providerId: AIProviderId
  capabilities: AIModelCapabilities
  capabilitySource: 'reported' | 'inferred' | 'verified' | 'unknown'
  size?: number
  isDefault?: boolean
  defaultReasoningEffort?: string
  supportedReasoningEfforts?: string[]
}

export interface AIProviderInfo {
  id: AIProviderId
  name: string
  kind: AIProviderKind
  defaultBaseUrl: string | null
  requiresApiKey: boolean
  recommendedConcurrency: number
  available: boolean
  authMode?: 'none' | 'api-key' | 'chatgpt'
  supportsBatchImages?: boolean
  supportsChatGPTAuth?: boolean
}

export interface CodexAccountState {
  connected: boolean
  email: string | null
  planType: string | null
  authMode: 'chatgpt' | 'apiKey' | null
  runtimeVersion: string | null
}

export interface CodexRateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexUsageState {
  limitReached: boolean
  reachedType: string | null
  primary: CodexRateLimitWindow | null
  secondary: CodexRateLimitWindow | null
}

export interface CodexLoginStartResult {
  type: 'chatgpt' | 'chatgptDeviceCode'
  loginId: string
  authUrl?: string
  verificationUrl?: string
  userCode?: string
}

export interface ProviderConnectionResult {
  providerId: AIProviderId
  status: AIProviderHealthStatus
  message: string
  checkedAt: string
  models: AIModelInfo[]
}

export interface AIProviderConfig {
  baseUrl: string
  modelId: string
  displayName?: string
}

export interface AIValue {
  value: string
  normalizedValue: string
  confidence: number
  source: AITermSource
}

export interface AICategory {
  primary: AIValue | null
  secondary: AIValue | null
  tertiary: AIValue | null
}

export interface Asset {
  id: string
  filename: string
  originalFilename: string
  mimeType: string
  extension: string
  width: number
  height: number
  size: number
  favorite: boolean
  rating: number
  createdAt: string
  importedAt: string
  lastOpenedAt: string | null
  sourceUrl: string | null
  sourceDomain: string | null
  sourceTitle: string | null
  sourceAuthor: string | null
  sourceSavedAt: string | null
  importSource: AssetSource
  thumbnailUrl: string
  previewUrl: string
  colors: ColorSwatch[]
  colorAnalysis: ColorAnalysis | null
  tags: Tag[]
  folderIds: string[]
  ai: AIMetadata | null
}

export interface VisualIndexStatus {
  modelState: VisualModelState
  modelId: string
  modelVersion: string
  modelName: string
  modelBytes: number
  embeddingDimension: number
  autoIndexOnImport: boolean
  paused: boolean
  totalEligible: number
  completed: number
  queued: number
  generating: number
  failed: number
  stale: number
  preparingProgress: number | null
  lastError: string | null
}

export interface VisualIndexPreferences { autoIndexOnImport: boolean }

export interface VisualSimilarityItem {
  asset: Asset
  score: number
  tier: 'very_similar' | 'similar' | 'related'
}

export interface VisualSimilarityResult {
  source: Asset
  results: VisualSimilarityItem[]
  indexedCount: number
  totalEligible: number
  pendingCount: number
  searchMs: number
}

export type DuplicateGroupKind = 'exact' | 'near'
export type DuplicateScanState = 'idle' | 'scanning' | 'completed' | 'cancelled' | 'failed'

export interface DuplicateGroupMember {
  asset: Asset
  visualSimilarity: number | null
  duplicateScore: number
  perceptualHashDistance: number | null
  recommendationRank: number
  recommendationReasons: string[]
}

export interface DuplicateGroup {
  id: string
  kind: DuplicateGroupKind
  memberSignature: string
  score: number
  recommendedKeepAssetId: string
  generatedAt: string
  members: DuplicateGroupMember[]
}

export interface DuplicateScanStatus {
  state: DuplicateScanState
  processed: number
  total: number
  groupCount: number
  exactGroupCount: number
  nearGroupCount: number
  embeddingMissingCount: number
  lastScanAt: string | null
  errorMessage: string | null
}

export interface AIMetadata {
  status: AIAnalysisStatus
  provider: string | null
  model: string | null
  schemaVersion: number
  promptVersion: string | null
  resultVersion: number
  primaryObject: AIValue | null
  primaryScene: AIValue | null
  primaryStyle: AIValue | null
  category: AICategory
  terms: AIValue[]
  termGroups: Record<AITermType, AIValue[]>
  description: string | null
  styles: string[]
  moods: string[]
  colors: string[]
  objects: string[]
  materials: string[]
  lighting: string[]
  composition: string[]
  scene: string[]
  usage: string[]
  ocrText: string | null
  semanticEmbeddingStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled'
  visualEmbeddingStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled'
  aiModel: string | null
  analyzedAt: string | null
  startedAt: string | null
  updatedAt: string
  overallConfidence: number | null
  errorMessage: string | null
  retryCount: number
}

export interface AISettings {
  enabled: boolean
  autoAnalyzeOnImport: boolean
  runMode: AIRunMode
  providerId: AIProviderId
  providerConfigs: Partial<Record<AIProviderId, AIProviderConfig>>
  concurrency: number
  cloudPrivacyAccepted: boolean
  configured: boolean
  secretConfigured: boolean
}

export interface AIJobProviderSnapshot {
  providerId: AIProviderId
  modelId: string
  baseUrl: string
  displayName?: string
}

export interface AIQueueStatus {
  queued: number
  analyzing: number
  completed: number
  failed: number
  paused: boolean
  pauseReason?: 'manual' | 'usage_limit' | 'auth_required' | 'service_unavailable' | 'restart_checkpoint' | null
  providerId?: AIProviderId | null
}

export interface AISmartCollectionSuggestion {
  type: 'object' | 'scene' | 'style'
  field: 'aiObject' | 'aiScene' | 'aiStyle'
  value: string
  normalizedValue: string
  assetCount: number
}

export type CollectionSuggestionDimension = 'object' | 'scene' | 'style' | 'color'
export type CollectionSuggestionKind = 'single' | 'pair'

export interface CollectionSuggestionCondition {
  dimension: CollectionSuggestionDimension
  field: 'aiObject' | 'aiScene' | 'aiStyle' | 'colorHex'
  label: string
  normalizedValue: string
  ruleValue: string
}

export interface CollectionSuggestion {
  ruleSignature: string
  name: string
  kind: CollectionSuggestionKind
  conditions: CollectionSuggestionCondition[]
  rules: SmartCollectionRule[]
  assetCount: number
  supportRatio: number
  score: number
  previews: Asset[]
}

export interface CollectionSuggestionResult {
  items: CollectionSuggestion[]
  unAnalyzedCount: number
  generatedAt: string
}

export type NaturalSearchField =
  | 'object' | 'scene' | 'style' | 'color' | 'favorite'
  | 'folder' | 'tag' | 'orientation' | 'importedDate'
  | 'filename' | 'description' | 'freeText' | 'extension'
export type NaturalSearchTextOperator = 'equals' | 'contains'
export type NaturalSearchDateValue = 'today' | 'last_7_days' | 'last_30_days'

export type NaturalSearchCondition =
  | { field: 'object' | 'scene' | 'style'; operator: 'equals'; value: string }
  | { field: 'color'; operator: 'near'; value: string }
  | { field: 'favorite'; operator: 'equals'; value: boolean }
  | { field: 'folder' | 'tag'; operator: 'equals'; value: string }
  | { field: 'orientation'; operator: 'equals'; value: 'portrait' | 'landscape' | 'square' }
  | { field: 'importedDate'; operator: 'within'; value: NaturalSearchDateValue }
  | { field: 'filename' | 'description' | 'freeText'; operator: NaturalSearchTextOperator; value: string }
  | { field: 'extension'; operator: 'equals'; value: string }

export type NaturalSearchExpression =
  | NaturalSearchCondition
  | { operator: 'and' | 'or'; children: NaturalSearchExpression[] }
  | { operator: 'not'; child: NaturalSearchExpression }

export interface NaturalSearchIntent {
  expression: NaturalSearchExpression
  sort?: AssetQuery['sort']
}

export interface NaturalSearchChip {
  signature: string
  label: string
  negative: boolean
}

export interface NaturalSearchParseResult {
  mode: 'direct' | 'natural' | 'fallback'
  queryText: string
  intent: NaturalSearchIntent | null
  chips: NaturalSearchChip[]
  parsedBy: 'local' | 'codex' | 'cache' | 'fallback'
  model: string | null
  warning: string | null
  canSaveAsSmartCollection: boolean
  unAnalyzedCount: number
  durationMs: number
}

export interface NaturalSearchHistoryItem {
  id: string
  queryText: string
  intent: NaturalSearchIntent | null
  lastUsedAt: string
  useCount: number
}

export interface IgnoredCollectionSuggestion {
  ruleSignature: string
  ignoredAt: string
  restoredAt: string | null
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  assetCount: number
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  type: 'manual' | 'ai' | 'system'
  assetCount?: number
}

export type SmartCollectionMatchMode = 'all' | 'any'
export type SmartCollectionTextField =
  | 'filename' | 'extension' | 'sourceDomain' | 'sourceType'
  | 'aiPrimaryCategory' | 'aiSecondaryCategory' | 'aiTertiaryCategory'
  | 'aiObject' | 'aiScene' | 'aiStyle' | 'aiMood' | 'aiLighting' | 'aiComposition' | 'aiMaterial' | 'aiUsage'
  | 'aiDescription' | 'aiOpenTag' | 'aiSemanticColor'
export type SmartCollectionNumberField = 'width' | 'height' | 'size' | 'colorBrightness' | 'colorSaturation'
export type SmartCollectionRelationField = 'folder' | 'tag'
export type SmartCollectionDateField = 'importedAt' | 'createdAt' | 'lastOpenedAt'
export type SmartCollectionField = SmartCollectionTextField | SmartCollectionNumberField | SmartCollectionRelationField | SmartCollectionDateField | 'favorite' | 'orientation' | 'colorHex' | 'colorTemperature'
export type TextOperator = 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith'
export type NumberOperator = 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
export type RelationOperator = 'is' | 'isNot' | 'contains' | 'notContains'
export type DateOperator = 'today' | 'last7' | 'last30' | 'last90' | 'before' | 'after' | 'between'

export type SmartCollectionRule =
  | { id: string; field: SmartCollectionTextField; operator: TextOperator; value: string }
  | { id: string; field: SmartCollectionNumberField; operator: NumberOperator; value: number | { min: number; max: number } }
  | { id: string; field: SmartCollectionRelationField; operator: RelationOperator; value: string }
  | { id: string; field: SmartCollectionDateField; operator: DateOperator; value: null | string | { from: string; to: string } }
  | { id: string; field: 'favorite'; operator: 'is'; value: boolean }
  | { id: string; field: 'orientation'; operator: 'is' | 'isNot'; value: 'landscape' | 'portrait' | 'square' }
  | { id: string; field: 'colorHex'; operator: 'near'; value: string }
  | { id: string; field: 'colorTemperature'; operator: 'is' | 'isNot'; value: 'cool' | 'neutral' | 'warm' }

export interface SmartCollectionInput {
  name: string
  matchMode: SmartCollectionMatchMode
  rules: SmartCollectionRule[]
}

export interface SmartCollection {
  id: string
  name: string
  matchMode: SmartCollectionMatchMode
  rules: SmartCollectionRule[]
  assetCount: number
  invalidRuleIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AssetQuery {
  search?: string
  naturalSearch?: NaturalSearchExpression
  /** Ephemeral, Muse-owned ranked result set. Never place full asset ids in an agent thread. */
  searchResultSetId?: string
  folderId?: string
  tagIds?: string[]
  favorite?: boolean
  deleted?: boolean
  recent?: 'added' | 'opened'
  smartCollectionId?: string
  formats?: string[]
  minRating?: number
  sourceDomains?: string[]
  sourceTypes?: Array<'web'>
  sort?: 'imported-desc' | 'imported-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'width-desc' | 'height-desc'
  cursor?: string
  limit?: number
}

export interface AssetPage {
  items: Asset[]
  nextCursor: string | null
  total: number
  resultSetId?: string
}

export interface SearchResultCoverage {
  metadataMatches: number
  localSemanticMatches: number
  localSemanticIndexed: number
  queryMs?: number
}

export interface SearchResultSetSummary {
  id: string
  totalCount: number
  previewAssets: Asset[]
  previewCount: number
  query: AssetQuery
  coverage: SearchResultCoverage
  createdAt: number
}

export interface LibraryStats {
  total: number
  recentlyAdded: number
  recentlyOpened: number
  favorites: number
  trash: number
}

export interface BootstrapPayload {
  appVersion: string
  libraryName: string
  libraryPath: string
  stats: LibraryStats
  folders: Folder[]
  tags: Tag[]
  smartCollections: SmartCollection[]
  platform: 'win32' | 'darwin' | 'linux'
  preferences: AppPreferences
}

export interface AppPreferences {
  sidebarWidth: number
  inspectorWidth: number
  galleryZoom: number
  galleryView: 'masonry' | 'grid'
}

export type LibraryChangeKind =
  | 'asset:created'
  | 'asset:updated'
  | 'asset:deleted'
  | 'asset:restored'
  | 'folder:created'
  | 'folder:updated'
  | 'folder:deleted'
  | 'tag:created'
  | 'tag:updated'
  | 'tag:deleted'
  | 'smart-collection:created'
  | 'smart-collection:updated'
  | 'smart-collection:deleted'
  | 'ai:updated'

export interface LibraryChangeEvent {
  kind: LibraryChangeKind
  assetIds?: string[]
}

export type DesktopAction =
  | { type: 'import' }
  | { type: 'preview'; assetId: string }
  | { type: 'edit-smart-collection'; smartCollectionId: string }
  | { type: 'delete-smart-collection'; smartCollectionId: string }
  | { type: 'analyze-assets'; assetIds: string[] }
  | { type: 'find-similar'; assetId: string }
  | { type: 'open-duplicates' }
  | { type: 'open-ai-settings' }
  | { type: 'open-muse-ai' }
  | { type: 'copy-selection' }
  | { type: 'agent-search-results'; title: string; resultSetId: string }
  | { type: 'agent-similar-results'; result: VisualSimilarityResult }
  | { type: 'web-asset-collected'; assetId: string; status: WebCollectStatus; domain: string }

export interface ImportProgress {
  completed: number
  total: number
  currentFilename: string
}

export interface ImportResult {
  imported: Asset[]
  duplicateIds: string[]
  failures: Array<{ path: string; message: string }>
}

export interface TrashPurgeResult {
  deletedCount: number
  reclaimedBytes: number
  fileCleanupPending: boolean
}

export interface MuseErrorShape {
  code: string
  message: string
  details?: unknown
}

export type MuseToolPermission = 'read' | 'safe-write' | 'destructive'

export interface MuseAgentConversation {
  id: string
  codexThreadId: string | null
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

export interface MuseAgentMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface MuseAgentContextSnapshot {
  currentViewType: 'library' | 'folder' | 'smart-collection' | 'search' | 'similar' | 'duplicates'
  currentViewId: string | null
  selectionCount: number
  selectedAssetIds: string[]
  focusedAssetId: string | null
}

export interface MuseAgentApprovalRequest {
  id: string
  conversationId: string | null
  threadId: string
  turnId: string
  toolName: string
  title: string
  summary: string
  targetCount: number
  details: Array<{ label: string; value: string }>
  createdAt: string
}

export interface MuseAgentCapabilities {
  connected: boolean
  runtimeVersion: string | null
  dynamicTools: boolean
  toolProtocol: 'dynamic-tools-experimental' | 'unavailable'
  unavailableReason: string | null
}

export interface MuseAgentState {
  account: CodexAccountState
  usage: CodexUsageState | null
  capabilities: MuseAgentCapabilities
  activeTurnId: string | null
}

export type MuseAgentEvent =
  | { type: 'message-delta'; conversationId: string; turnId: string; delta: string }
  | { type: 'message-completed'; conversationId: string; message: MuseAgentMessage }
  | { type: 'activity'; conversationId: string; turnId: string; toolName: string; label: string; active: boolean }
  | { type: 'approval-requested'; request: MuseAgentApprovalRequest }
  | { type: 'approval-resolved'; requestId: string; approved: boolean }
  | { type: 'turn-completed'; conversationId: string; turnId: string; status: 'completed' | 'interrupted' | 'failed' }
  | { type: 'state-changed' }
  | { type: 'error'; conversationId: string | null; code: string; message: string }
