import type { EmbeddingRepository } from '../../database/repositories/EmbeddingRepository'
import { cosineForNormalized } from '../embeddings/vectorMath'
import { SemanticSearchModelManager } from './SemanticSearchModelManager'
import { SemanticSearchWorkerClient } from './SemanticSearchWorkerClient'
import { normalizeSearchConcept, promptForSearchConcept } from './SearchConceptNormalizer'

export interface LocalSemanticMatch { assetId: string; score: number }

export class LocalSemanticSearchService {
  private initialized: Promise<void> | null = null
  private readonly textCache = new Map<string, Float32Array>()
  constructor(private readonly repository: EmbeddingRepository, private readonly manager: SemanticSearchModelManager, private readonly worker: SemanticSearchWorkerClient) {}

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = (async () => { await this.manager.ensureReady(); await this.worker.initialize(); await this.indexMissing() })()
    return this.initialized
  }
  async search(text: string, minimumScore = 0.215): Promise<{ matches: LocalSemanticMatch[]; indexed: number; queryMs: number }> {
    await this.initialize()
    const started = performance.now(), normalized = normalizeSearchConcept(text), queryPrompts = queryVariants(normalized).map(promptForSearchConcept)
    const queries = await Promise.all(queryPrompts.map((prompt) => this.textVector(prompt)))
    const competitors = await Promise.all(competitorsFor(normalized).map(async (concept) => ({ concept, vector: await this.textVector(promptForSearchConcept(concept)) })))
    const candidates = this.repository.listCandidates().filter((item) => item.status === 'completed')
    const vectors = this.repository.getCompletedVectors(candidates.map((item) => item.id)), matches: LocalSemanticMatch[] = []
    for (const [assetId, vector] of vectors) {
      const score = Math.max(...queries.map((query) => cosineForNormalized(query, vector)))
      const competingScore = competitors.length ? Math.max(...competitors.map((item) => cosineForNormalized(item.vector, vector))) : -1
      // CLIP's absolute cosine scale is query-dependent. A small calibrated
      // tolerance against sibling concepts preserves recall while the absolute
      // floor still prevents forced Top-K results.
      if (score >= minimumScore && score >= competingScore - 0.01) matches.push({ assetId, score })
    }
    matches.sort((a, b) => b.score - a.score)
    return { matches, indexed: vectors.size, queryMs: performance.now() - started }
  }
  async indexMissing(assetIds?: string[]): Promise<void> {
    const candidates = this.repository.listCandidates().filter((item) => !assetIds || assetIds.includes(item.id))
    for (const candidate of candidates) {
      const fingerprint = `${candidate.hash}:${candidate.size}`
      if (candidate.status === 'completed' && candidate.sourceFingerprint === fingerprint) continue
      this.repository.queue(candidate.id, fingerprint); this.repository.markGenerating(candidate.id)
      try { this.repository.save(candidate.id, fingerprint, (await this.worker.embedImage(candidate.path)).vector) }
      catch (error) { this.repository.markFailed(candidate.id, 'SEMANTIC_EMBEDDING_FAILED', error instanceof Error ? error.message : String(error)) }
    }
  }
  async onAssetsImported(assetIds: string[]): Promise<void> { await this.initialize(); await this.indexMissing(assetIds) }
  async dispose(): Promise<void> { await this.worker.dispose() }
  private async textVector(prompt: string): Promise<Float32Array> { const cached = this.textCache.get(prompt); if (cached) return cached; const vector = (await this.worker.embedText(prompt)).vector; this.textCache.set(prompt, vector); return vector }
}

const OBJECTS = ['person', 'woman', 'man', 'child', 'backpack', 'bag', 'shoe', 'chair', 'sofa', 'car', 'motorcycle', 'phone', 'watch']
const SCENES = ['outdoor', 'indoor', 'studio', 'white background', 'street', 'office', 'bedroom', 'living room', 'kitchen', 'store', 'nature']
const STYLES = ['product photo', 'portrait', 'fashion', 'lifestyle photo', 'commercial photo', 'minimalist', 'editorial', 'retro', 'technology', 'cinematic', 'luxury']
function queryVariants(value: string): string[] { if (value === 'person') return ['person', 'woman', 'man', 'child']; if (value === 'backpack') return ['backpack', 'bag']; return [value] }
function competitorsFor(value: string): string[] {
  const group = OBJECTS.some((item) => value.includes(item)) ? OBJECTS : SCENES.some((item) => value.includes(item)) ? SCENES : STYLES.some((item) => value.includes(item)) ? STYLES : OBJECTS
  const variants = new Set(queryVariants(value))
  return group.filter((item) => !variants.has(item) && !value.includes(item))
}
