import { z } from 'zod'

export const findSimilarSchema = z.object({
  sourceAssetId: z.string().min(1).max(128),
  limit: z.number().int().min(1).max(200).default(100),
  minimumScore: z.number().min(-1).max(1).optional()
})

export const visualIndexPreferenceSchema = z.object({ autoIndexOnImport: z.boolean() })
export const regenerateEmbeddingSchema = z.object({ assetIds: z.array(z.string().min(1).max(128)).min(1).max(5000) })
