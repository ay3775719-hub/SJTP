# Muse

Local-first desktop visual library built with Electron, React, TypeScript and SQLite.

> Source code is published without an open-source license. No permission is granted to redistribute or sell Muse without the copyright holder's authorization.

## Development

```bash
npm install
npm run dev
```

`npm run dev` opens Muse in an Electron desktop window. The renderer is not supported as a standalone website.

## Verification and packaging

```bash
npm test
npm run build
npm run dist:win
npm run dist:mac
```

Windows artifacts are written to `release/`. macOS artifacts must be built and signed on macOS.

The bundled Codex runtime is intentionally not stored in Git. Before producing a Windows distribution, install Codex Desktop or set `MUSE_CODEX_RUNTIME_DIR`, then run `npm run prepare:codex-runtime`.

## Browser extension

```bash
npm run build:extension
```

Load `release/browser-extension` as an unpacked Manifest V3 extension in Chrome or Edge during development. See [browser-extension/README.md](browser-extension/README.md) for the connection and permission model.

## Library layout

```text
Muse Library/
├── muse.db
├── originals/
├── thumbnails/
├── cache/
└── backups/
```

Existing Libraries using `muse.sqlite3` remain supported.

## Smart Collections

> Smart Collection is a saved query, not a folder.

> Smart Collection membership is derived from asset metadata and rules. It is never manually maintained.

> SQLite is the source of truth.

Rules are stored in `smart_collections` and `smart_collection_rules`. The Main Process validates each discriminated rule, compiles whitelisted fields/operators into parameterized SQL, and executes that predicate together with Gallery sorting and pagination. No asset membership table is created.
