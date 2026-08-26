# Muse implementation plan

## Visual analysis

The 1536 × 1024 reference is a fixed, three-pane desktop workspace. The measured tracks are approximately 243 px for the library sidebar, 891 px for the asset workspace, and 402 px for the inspector. Both dividers are one-pixel low-contrast rules. The asset workspace contains a 66–72 px toolbar followed by a dense four-column masonry canvas with 8 px gaps. The inspector is an independently scrolling document.

The visual language is intentionally quiet: near-black layered surfaces, no large shadows, restrained 1 px borders, compact Inter/system typography, 7–8 px image radii, 4–6 px control radii, a cool blue selection color, and a warm yellow favorite color. Hover raises luminance slightly; active navigation uses a muted blue fill; asset selection uses a crisp two-pixel blue outline without changing the crop.

## Component hierarchy

```text
MuseApp
└─ AppShell
   ├─ Sidebar
   │  ├─ WindowControls / Brand
   │  ├─ PrimaryNavigation
   │  ├─ SmartCollections
   │  ├─ FolderTree
   │  └─ TagList
   ├─ AssetWorkspace
   │  ├─ GalleryToolbar
   │  ├─ VirtualizedMasonry
   │  │  └─ AssetCard
   │  └─ GalleryZoomControl
   ├─ Inspector
   │  ├─ SearchField
   │  ├─ InspectorActions
   │  ├─ AssetPreview
   │  ├─ FileSummary
   │  ├─ ColorPalette
   │  ├─ AIAnalysis
   │  ├─ Description
   │  ├─ SourceDetails
   │  └─ OrganizationDetails
   ├─ PreviewOverlay
   └─ ContextMenu
```

## Interaction model

- `selectedAssetIds` supports multiple selection; `focusedAssetId` drives the inspector; `selectionAnchorId` drives Shift-range selection.
- Click selects, Ctrl/Cmd-click toggles, Shift-click selects the contiguous visible range, double-click or Space opens preview, arrow keys move focus, Escape closes preview.
- Search, folder, tag, favorite, format, rating, source, time, and AI facets compile into one serializable query passed through IPC.
- Renderer never receives arbitrary filesystem access. File paths are resolved from dropped `File` objects by the preload bridge and all mutation goes through validated IPC.

## Delivery stages

1. Foundation: Electron/Vite/React strict TypeScript, process boundaries, logger, error boundary, typed IPC.
2. Visual shell: exact three-pane layout, virtualized masonry, selection, inspector, preview, menus and keyboard model.
3. Persistence: migration runner, SQLite repositories, default library creation, query paging and FTS.
4. Import: unified `AssetImporter`, SHA-256 duplicate detection, metadata extraction, managed originals, three thumbnail sizes, transactional insert.
5. Organization: folders, tags, favorites, soft-delete/restore, search/filter and undo commands.
6. Verification: typecheck, unit tests, packaged renderer build, Electron launch smoke test, reference screenshot comparison and design QA.
