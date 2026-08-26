# Duplicate & Near-Duplicate Detection v1

## Detection contract

- Exact: complete-file SHA-256 equality only.
- Near: local DINOv2 Small Q8 similarity plus 64-bit DCT pHash, aspect ratio, and resolution relation.
- Similar: embedding similarity that does not pass the conservative duplicate gates; it stays in Find Similar.
- No Codex, API, cloud upload, new visual model, automatic permanent deletion, or metadata merge.

## Real calibration (2026-08-13)

Source: a real backpack asset from the current Muse Library (`f5dJ_0jBKBU1YSZh`). Full measurements are in `reports/duplicate-quality-2026-08-13.json`.

| Case | Expected | Result | Visual | pHash distance | Duplicate score |
|---|---:|---:|---:|---:|---:|
| exact copy | Exact | Exact | 1.0000 | 0 | 1.0000 |
| renamed exact copy | Exact | Exact | 1.0000 | 0 | 1.0000 |
| JPEG recompression | Near | Near | 0.9860 | 2 | 0.9694 |
| PNG to JPEG | Near | Near | 0.9919 | 0 | 0.9953 |
| resize to 50% | Near | Near | 0.9734 | 0 | 0.9595 |
| 3% crop | Near | Near | 0.9577 | 6 | 0.9049 |
| light color adjustment | Near | Near | 0.9922 | 0 | 0.9954 |
| small watermark | Near | Near | 0.9910 | 0 | 0.9948 |
| same backpack, different presentation/view | Similar only | Similar only | 0.7524 | 36 | 0.5716 |
| unrelated portrait with similar vertical layout | Similar only | Similar only | 0.0461 | 28 | 0.1599 |

Observed exact precision: 100%. Observed near precision: 100% (6/6 variants, 0 false positives, 0 false negatives in this calibration set). This is a small product calibration set, not a universal accuracy claim.

## Current real Library

The migrated Library contains 21 active assets and 9 Trash assets. All 21 active images have completed local pHash and DINOv2 indexes. The current material set contains no exact or conservative near-duplicate groups; visually related backpack and portrait images remain available through Find Similar instead of being mislabeled as duplicates.

## Synthetic scale benchmark

The benchmark creates metadata and signatures only; it does not add fake production assets.

- 1,000 records: exact aggregation 0.3 ms; pHash candidate generation 31.5 ms; grouping 0.7 ms.
- 10,000 records: exact aggregation 3.7 ms; pHash candidate generation 285.5 ms; grouping 16.3 ms.
- 100,000 records: exact aggregation 67.3 ms; pHash candidate generation 3,512.8 ms; grouping 1,156.6 ms.
- Existing 384-d vector benchmark: 10k Top-K scan 13.5 ms; 100k Top-K scan 92.3 ms in memory.

At 100k, the current LSH stage is suitable for background work but not instant UI. A future ANN/persistent LSH index may reduce full-rescan time. Import invalidation is debounced and cached pHashes are reused, so only new or changed assets are decoded for pHash; v1 still rebuilds the derived candidate groups from active metadata after invalidation.

## Safety and comparison workflow

- Group cards load no more than six lazy thumbnails and use `content-visibility` to avoid rendering off-screen card contents.
- Double-clicking a group thumbnail or comparison item opens the existing transform-based Image Viewer. Arrow keys stay within the duplicate group.
- The user explicitly chooses the keep candidate. Cleanup lists the affected filenames and only soft-deletes the other versions to Muse Trash.
- Cleanup warns when removed versions contain favorites, tags, folders, source information, or AI metadata. v1 never merges those fields silently.
- Candidate generation yields to the Electron main loop and checks cancellation throughout pHash bucketing, Top-K construction, and vector scoring.
