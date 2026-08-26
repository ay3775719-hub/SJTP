# Local Visual Similarity Search v1

> Visual Similarity Search must remain 100% local by default.
>
> Similarity results come from visual embeddings, not filenames, AI labels, folders, tags, or color heuristics.
>
> SQLite remains the source of truth for index state and model provenance.

## v1 model decision

Muse v1 uses the quantized ONNX export of `DINOv2 Small` from `onnx-community/dinov2-small`, pinned to revision `8b1f705a3a7f6f062f6bdd21986c1583d3ef105d`.

- Runtime: Transformers.js 3 + ONNX Runtime Node, CPU execution provider.
- Output: the 384-dimensional CLS token from the final hidden state, L2 normalized.
- Preprocessing: Transformers.js applies the pinned processor configuration (EXIF-aware RGB decode via Sharp, resize shortest edge to 256, 224×224 center crop, 1/255 rescale, and ImageNet mean/std normalization).
- Similarity: dot product between normalized vectors (equivalent to cosine similarity).
- Model files: 24,448,035 bytes in total; SHA-256 verified before activation.
- License: upstream DINOv2 model weights are Apache-2.0.
- Distribution: the model is downloaded on first use to Muse's application data directory; it is not bundled in the installer.
- Integrity: every model activation verifies the pinned byte length and SHA-256, including cached files after app restart.
- Privacy: image pixels and embeddings remain on the computer. No Codex or AI provider is called.

DINOv2 Small was selected for v1 because it provides a useful CPU/quality trade-off for product imagery while keeping the download and resident memory practical. The production ONNX artifact is the pinned `onnx-community` conversion of Meta's Apache-2.0 DINOv2 Small weights, loaded by Transformers.js through ONNX Runtime Node. Meta's model card explicitly lists image retrieval/nearest-neighbor use and a 384-dimensional ViT-S embedding. CLIP/SigLIP remain possible future experiments, not parallel production implementations.

## Data flow

```text
asset original
  -> EmbeddingQueue
  -> worker_threads worker
  -> official DINOv2 preprocessing
  -> 384-d Float32 normalized embedding
  -> asset_embeddings (SQLite BLOB)

query asset embedding
  -> SQLite active embeddings
  -> normalized dot product
  -> top-K asset IDs
  -> AssetRepository
  -> Gallery similar-results mode
```

The renderer never reads files, loads the ONNX model, or accesses SQLite. It calls typed preload IPC. Model inference and brute-force search run outside the renderer thread.

## Persistence and invalidation

`asset_embeddings` is keyed by `asset_id + provider_id + model_id + model_version`. Each row also stores the embedding dimension, normalization flag, source fingerprint, status, errors, and timestamps.

The source fingerprint is derived from the asset hash, recorded size, and file modification time. Changed files become stale and are regenerated. Changing the model version naturally selects a separate index; older rows remain attributable to their model version.

Trash assets are excluded from indexing counts and search results. The query asset itself is always excluded.

## Scaling path

v1 uses exact brute-force top-K search, which is deterministic and sufficient for the initial 10k–100k target on desktop hardware. The repository boundary intentionally allows a future HNSW/vector-extension implementation without changing renderer IPC or Gallery state.

The production UI reports index progress, failures, pause/resume, model state, and rebuild controls. Failed assets are retryable; successful rows are checkpointed individually so app restart does not discard completed work.
