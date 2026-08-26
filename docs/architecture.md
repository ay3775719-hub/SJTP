# Muse architecture

## Multi-provider AI

Muse's AI domain depends on the normalized `AIProvider` contract, never on a vendor SDK. `AIAnalysisService` resolves providers through `AIProviderRegistry`, while every persistent queue job stores a non-secret provider snapshot (`providerId`, `modelId`, `baseUrl`). Provider adapters convert Ollama, LM Studio, OpenAI, or OpenAI-compatible responses into the same validated Muse schema before SQLite persistence.

Local-only mode never falls back to a cloud provider. Provider secrets are stored independently with Electron `safeStorage`; renderer code can only see whether a secret is configured. Smart Collections and Search query normalized SQLite AI metadata and remain provider-agnostic.

## Process boundaries

```text
React renderer
  ↕ typed window.muse bridge (contextBridge)
Preload
  ↕ allow-listed ipcRenderer.invoke channels
Main IPC handlers
  → AssetService / AssetImporter / ThumbnailService / AIService
  → repositories
  → SQLite
```

The renderer has `contextIsolation: true`, `nodeIntegration: false`, and no direct filesystem/database imports. IPC payloads are parsed with shared Zod schemas. Main-process errors are logged with internal context and returned as stable serializable errors.

## State ownership

- SQLite is authoritative for assets, folders, tags, smart collections and library settings.
- Zustand owns view state, query state, selection, transient progress and optimistic flags.
- Services own orchestration. Repositories own SQL. Components only render state and dispatch commands.
- AI is orchestrated by `AIAnalysisService` in the Main Process. Providers, credentials, queueing, validation, normalization and persistence never cross into React.

## Smart Collections

> Smart Collection is a saved query, not a folder.

> Smart Collection membership is derived from asset metadata and rules. It is never manually maintained.

> SQLite is the source of truth.

`smart_collections` stores identity, match mode, and ordering. Its normalized
`smart_collection_rules` children store typed rule values. Main-process Zod
validation rejects unsupported combinations before the query builder compiles
whitelisted fields and operators into parameterized SQLite predicates. The
predicate is composed with the existing Gallery sort and cursor pagination.

AI category, term and local-color rules query `asset_ai_analysis`,
`asset_ai_terms`, `asset_color_analysis` and `asset_colors` directly. OCR and
similarity fields remain reserved until their real data pipelines exist.
Assets without completed analysis never receive fabricated AI matches.

## AI Asset Understanding

> AI analysis results must come from a real analysis provider, never mock data in production.

> Muse AI is an indexing system, not a visual-analysis report generator.

> Each asset has one primary object, one primary scene, one primary style, and one short searchable description.

> Colors are computed locally and never consume Codex vision usage. Prefer fewer accurate labels over many speculative labels.

The non-blocking pipeline is `Asset → persistent analysis job →
AIAnalysisQueue → AIProvider → Zod validation → controlled-vocabulary
normalization → SQLite → library:changed`. The provider registry currently
supports Codex / ChatGPT, Ollama, LM Studio, OpenAI, and OpenAI-compatible
endpoints through one contract. The Renderer never
receives an API key; Electron `safeStorage` encrypts it in the app user-data
directory, with `OPENAI_API_KEY` available as a development/managed-runtime
override.

New analysis writes explicit primary object, scene, and style columns plus the
description and provenance in `asset_ai_analysis`. Exactly one normalized
object, scene, and style term is queryable through `asset_ai_terms`. Legacy
rich terms remain readable for historical assets, but are absent from new
results and from the default Smart Collection field picker. Manual additions
and removals are recorded in `asset_ai_overrides`; reanalysis replaces only
AI/system rows and honors suppressions, so user edits remain authoritative.
Jobs are persisted in `ai_analysis_jobs`, processed with configurable bounded
concurrency and retried with exponential backoff.

Pixel colors are fully independent and local-only. A Sharp-based quantizer downsamples pixels,
deduplicates nearby colors, and records palette ratios, HSL, Lab, average
color, brightness, saturation and temperature. Existing assets are backfilled
asynchronously without blocking Gallery startup. Cloud analysis receives a
JPEG analysis preview whose longest edge is at most 1800px, never the
unconditionally full-resolution original.

## Codex Batch Recognition

> Codex Batch Recognition is an image-classification workflow, not a coding workflow.

> ChatGPT managed authentication is the default authentication mode for Codex Batch Recognition. No OpenAI API key is required.

> Batch recognition must respect the user's Codex usage limits and must never silently fall back to a paid API provider.

> Completed assets are never analyzed twice unless the user explicitly requests re-analysis. SQLite remains the source of truth, and production never uses fake AI metadata.

Electron Main starts the official Codex App Server over newline-delimited
JSON-RPC on stdio. The Renderer only uses typed IPC and cannot access account
credentials, JSON-RPC, threads, turns, or local image paths. Model discovery
filters for image input support and uses the recommended model at low
reasoning effort.

The existing `AIAnalysisQueue` groups Codex work into independent four-image
batches. Each batch uses a dedicated temporary workspace, read-only sandbox,
`never` approval policy, strict output schema, real `localImage` inputs, and a
short-lived archived thread. Valid results are persisted per asset
immediately; only missing or invalid asset IDs are retried. Queue pause state
and restart checkpoints are persisted, and a restarted app asks before
continuing unfinished cloud work.

## Scale path

- Keyset pagination and bounded batches avoid loading the entire library.
- The masonry layout computes item geometry once per width/zoom change and only mounts cards intersecting the overscanned viewport.
- Gallery URLs point to managed thumbnails. Originals are loaded only in preview.
- SHA-256 is indexed as content identity but intentionally non-unique: users may keep identical files in different projects. Filters and joins have covering indexes. FTS5 stores filename, description and denormalized tag/folder text.
- The importer is a queue with concurrency limits and is ready to move into a worker/utility process without changing the IPC contract.

## Image Viewer

Preview is a fixed, overflow-hidden viewport. `ImageViewer` loads the original
asset URL while `useImageViewer` owns fit/manual/actual-size state, cursor-
anchored wheel zoom, two-axis pointer pan, ResizeObserver updates, and bounded
translation. The image keeps its natural pixel dimensions and only changes via
GPU-friendly `translate3d()` and `scale()` transforms; DOM scrolling is never
used to navigate a zoomed image.

## Automatic Collection Suggestions

> Automatic Collection Suggestions should reuse existing metadata and avoid unnecessary AI calls.

> Suggestions create saved queries, not folders or duplicated assets.

> Suggest, don't organize without user consent.

> A useful small number of suggestions is better than dozens of noisy groups.

> Existing Smart Collections and ignored rule signatures must be deduplicated.

The suggestion engine performs indexed SQLite aggregation over the effective primary Object, Scene, Style and locally computed color data. It never starts Codex analysis. Results are cached against an in-process Library revision and invalidated by Library change events. Creating a suggestion delegates to the existing `SmartCollectionService`; SQLite remains the source of truth.

## Local visual similarity

> Codex understands what an image is. Local visual embeddings determine what an image looks like.

> Visual similarity search never consumes Codex usage, and embedding generation never blocks the Renderer.

> SQLite remains the source of truth for embedding metadata.

> v1 prioritizes similarity quality and reliability over premature vector-database complexity.

> Metadata matching must never be presented as visual similarity.

The built-in DINOv2 Small Q8 pipeline runs in a Node worker thread. It stores L2-normalized 384-dimensional Float32 BLOBs keyed by provider, model, version, and source fingerprint. Search uses exact normalized dot-product ranking, excludes the query asset and Trash, and returns only hydrated asset metadata and relative similarity tiers to the Renderer.

## Duplicate and near-duplicate detection

> Exact duplicates are determined by content identity, not visual similarity.

> Near duplicates are high-confidence visual variants, not merely similar images. Similarity is not duplication.

> Duplicate detection reuses the existing local embedding infrastructure and never consumes Codex usage.

> Precision is more important than recall. Muse detects; the user decides. Cleanup moves assets to Muse Trash and never permanently deletes them.

Exact groups are an indexed `assets.hash` (SHA-256) aggregation. Historical and newly imported assets cache a local 64-bit DCT perceptual hash. Four deterministic 16-bit LSH layouts generate bounded candidate neighborhoods; the closest 20 pHash candidates are then verified with the existing normalized DINOv2 embedding, aspect ratio, and dimension relation. The conservative v1 score is `0.58 visual + 0.27 pHash + 0.10 aspect + 0.05 dimensions`, with independent visual/pHash gates and a 0.90 threshold.

Near groups use strict clique admission instead of unrestricted connected components, preventing chaining drift. Results are rebuildable derived data tied to the embedding model and threshold version. Stable member signatures persist ignores across rescans. Recommendation ranking protects Favorite and manual-tagged assets before comparing pixel count and folder assignment. SQLite remains the source of truth.

## Muse AI Assistant / Codex Agent

> Codex is Muse's reasoning and orchestration layer, not the source of truth.

> Muse Tools are the only supported path for an agent to modify Library state. Read before write, and prefer existing Muse services over agent-specific implementations.

> Current selection is dynamic and is resolved again at execution time. Muse AI never invents Library results.

> The runtime agent has no arbitrary shell, raw SQL, filesystem, source-editing, or destructive tools. Safe writes require explicit user approval; destructive actions are not registered in v1.

> The Muse runtime agent is a visual-library assistant, not a coding agent. SQLite remains the source of truth.

The Renderer sends typed IPC to `MuseAgentService`. A protocol-isolated
`CodexToolBridge` is the only component that understands experimental Codex
Dynamic Tools and `item/tool/call`. It validates and dispatches requests through
`MuseToolRegistry`, which delegates to the existing Search, Smart Collection,
Tag, Favorite, Similarity and Duplicate services. Read calls run automatically;
safe writes flow through one approval service and a persistent audit log.

Muse starts the official App Server over stdio with ChatGPT managed login. On
Windows, Dynamic Tools require the complete official runtime set, including
`codex-code-mode-host.exe`; production packaging validates and bundles that set.
Batch Recognition and the Assistant share one App Server process but keep
separate threads and instructions.

## Search recall and result sets

> Search preview size and search result size are different concepts.

> Limiting tool context must never truncate the Gallery result set.

> AI Analysis enriches search; it does not determine whether an asset is searchable.

> Unanalyzed images remain searchable through local visual-semantic indexing, which never consumes Codex usage.

> Cross-modal text/image similarity is used only with a model designed for a shared embedding space. Results below the calibrated relevance gate are never forced into Top-K.

`HybridSearchService` merges strong SQLite evidence (filename, folder, tag,
Minimal AI Object/Scene/Style/Description and local colors) with local semantic
recall. It de-duplicates and ranks structured evidence first. Internal retrieval
concepts are not written to user-visible metadata.

Agent searches create an ephemeral Muse-owned `SearchResultSet`. The tool sees
`totalCount`, a small `previewAssets` slice and the opaque result-set id; Gallery
paginates the complete ranked set from Muse app state. The model never owns the
full asset list. SQLite remains the source of truth.

## Web Collector

> Web Collector is only an ingestion channel and reuses Muse's existing ImportService.

> A collected image becomes locally searchable before Codex AI analysis is required. AI analysis enriches the asset; it does not make the asset searchable.

> Web provenance is independent from the local asset file. One asset may have multiple web sources, while exact duplicate collections attach provenance instead of creating redundant files.

> Browser collection is always user initiated. Browser history and cookies are not collected in v1, and web collection itself never consumes Codex usage.

> The existing Muse Agent architecture remains frozen. SQLite remains the source of truth.

Chrome and Edge share one Manifest V3 extension. v1 uses the registered
`com.muse.web_collector` Native Messaging host. This avoids Chrome's Local
Network Access restrictions on extension-to-loopback fetches and does not
require a localhost HTTP listener or pairing token. The host validates the
fixed extension origin and the versioned message envelope, then forwards only
`status` and `collect_image` requests to Electron Main over a per-user named
pipe. It can launch Muse when needed and exposes no shell, raw SQL, arbitrary
path, or generic filesystem capability.

Installed and Portable builds both carry the same small native-host executable.
Muse registers its current absolute host path under the per-user Chrome and
Edge Native Messaging registry keys, allowing upgrades and moved Portable
builds to repair registration without administrator access. Chrome/Edge still
require the unpacked extension to be reloaded after its manifest changes.

Electron Main validates every request, rejects non-HTTP URLs and private,
loopback, link-local or unsafe redirect destinations, then enforces timeout,
redirect, and 50 MiB limits. Content-Type, magic bytes and Sharp decode must
agree before the existing importer receives the temporary file. The first
`asset_sources` row is inserted inside the asset transaction. Existing
SHA-256 content attaches a de-duplicated source row instead of creating another
asset. Source rows survive Trash/Restore and cascade only on permanent asset
deletion.
