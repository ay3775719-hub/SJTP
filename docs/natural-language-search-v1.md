# Muse Natural Language Search v1

> Natural Language Search converts language into structured Muse queries.

> Codex parses the query; SQLite finds the assets.

> Simple keyword searches should not consume Codex usage.

> Existing structured metadata should be used before introducing embeddings.

> Natural language search must never silently change the user's intent.

> Search results remain grounded in the current Muse Library.

## Pipeline

`Renderer → IPC → NaturalLanguageSearchService → Codex parser → schema validation → SearchEntityResolver → parameterized SQLite query → Gallery`

Codex receives only the user's search sentence and the supported controlled vocabulary. It cannot access Muse's database, files, images, or search results. A short keyword such as `背包` goes directly to the existing local search. Natural-language parse results are cached, but asset results are always queried from the current SQLite Library.

The internal expression supports AND, OR, and NOT. Folder and tag names are resolved to current database IDs in the Main Process. Object, scene, style, and color reuse the same normalization and color buckets used by Minimal AI Metadata, Smart Collections, and Automatic Collection Suggestions.

Migration `008_natural_language_search` adds only local parse cache and search-history tables. It does not add a vector database or duplicate asset metadata.
