# Muse Desktop + Real Data QA

- Reference: `design-qa-artifacts/reference-1536x1024.png`
- Current Electron empty-Library capture: `muse-empty-library-4.png`
- Runtime: real Electron BrowserWindow, 1536 × 1024, Windows custom titlebar.
- Data state: isolated SQLite Library containing 0 assets, 0 folders, 0 tags.

## Visual result

The current app retains the reference's three-pane dark desktop composition, 66 px toolbar, dense sidebar rows, subtle dividers, blue selected state, gallery controls and right inspector. The screenshot confirms the empty Library is honest: every visible count is 0, Gallery shows the import empty state, and Inspector shows no selection. Windows minimize, maximize and close controls occupy the top-right titlebar and are backed by Electron IPC.

Sidebar rows now use flex layout with an icon, ellipsized label, flexible spacer and right-aligned tabular count. The sidebar has its own scroll area with a stable scrollbar gutter. Sidebar and Inspector have draggable boundaries and persisted width constraints.

## Runtime and data verification

- `npm run dev` starts Electron directly; no browser workflow is exposed.
- Renderer requires the preload bridge and no longer imports a browser preview API.
- Production Renderer assets contain no demo photography.
- SQLite acceptance A–G passed: empty 0; import 10; favorite 3; folder 4; tag 6; soft-delete 2; reopen preserves state.
- Search audit found none of the former fake counts in `src`, `database`, `scripts` or packaging config.
- `npm run build`, `npm test`, and `npm run dist:win` passed.

## Known placeholders

- Smart Collection creation, editing, duplication, deletion, live preview and SQL-backed Gallery filtering are enabled.
- AI analysis still displays “尚未分析”; AI/OCR Smart Collection fields are reserved but intentionally hidden until real analysis data exists.
- macOS build configuration is present, but a DMG cannot be verified from Windows.
- A custom product icon and code-signing identity are not configured; Windows packages currently use Electron's default icon.

## Smart Collection evidence

- Baseline disabled state: `design-qa-artifacts/smart-collections-01-before.png`
- Rule Builder: `design-qa-artifacts/smart-collections-03-editor-fixed.png`
- Created collection in Sidebar: `design-qa-artifacts/smart-collections-04-created.png`

The editor preserves the existing Muse modal language, supports keyboard-accessible native inputs, and shows an immediate SQL-backed preview. The created Sidebar row uses the same density and count alignment as Folder and Tag rows. Screenshot review cannot prove full keyboard order or screen-reader announcements; those require dedicated assistive-technology testing.

## Professional Image Viewer evidence

- Portrait Fit, 1024 × 1536: `design-qa-artifacts/viewer-01b-portrait-fit.png`
- Landscape Fit, 6000 × 4000: `design-qa-artifacts/viewer-02-landscape-fit.png`
- Cursor zoom + two-axis bounded pan: `design-qa-artifacts/viewer-03-zoom-pan.png`
- Asset switch reset to Fit: `design-qa-artifacts/viewer-05h-switch-reset-fit.png`
- Window resized to 1200 × 800 while Fit remains active: `design-qa-artifacts/viewer-06-resize-fit.png`
- ESC restores Gallery: `design-qa-artifacts/viewer-07-escape-gallery.png`

Every accepted capture includes JSON diagnostics. They confirm body dimensions equal
client dimensions and `.preview-image-stage` uses `overflow: hidden`. Wheel zoom,
pan, switch reset, ResizeObserver Fit, and ESC were exercised in a real Electron
BrowserWindow. Screenshot evidence cannot validate physical trackpad hardware;
the non-passive wheel path and Chromium `ctrlKey` pinch event handling are covered
by implementation and math tests.
