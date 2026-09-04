import { z } from 'zod'
import { naturalSearchExpressionSchema } from './naturalSearch'

export const assetQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  naturalSearch: naturalSearchExpressionSchema.optional(),
  searchResultSetId: z.string().min(1).max(128).optional(),
  folderId: z.string().min(1).optional(),
  tagIds: z.array(z.string().min(1)).max(50).optional(),
  favorite: z.boolean().optional(),
  deleted: z.boolean().optional(),
  recent: z.enum(['added', 'opened']).optional(),
  smartCollectionId: z.string().min(1).optional(),
  formats: z.array(z.string().min(1)).max(20).optional(),
  minRating: z.number().int().min(0).max(5).optional(),
  sourceDomains: z.array(z.string().min(1)).max(50).optional(),
  sourceTypes: z.array(z.enum(['web'])).max(10).optional(),
  sort: z.enum(['imported-desc', 'imported-asc', 'name-asc', 'name-desc', 'size-desc', 'width-desc', 'height-desc']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(120)
})

export const idSchema = z.string().min(1).max(128)
export const setFavoriteSchema = z.object({
  assetIds: z.array(idSchema).min(1).max(5000),
  favorite: z.boolean()
})
export const importPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(5000),
  source: z.enum(['local', 'url', 'browser_extension', 'clipboard', 'screenshot']).default('local'),
  folderId: z.string().optional()
})

export const createFolderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional() })
export const renameFolderSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(120) })
export const createTagSchema = z.object({ name: z.string().trim().min(1).max(80) })
export const tagAssetSchema = z.object({ assetIds: z.array(idSchema).min(1).max(5000), tagId: idSchema })
export const folderAssetSchema = z.object({ assetIds: z.array(idSchema).min(1).max(5000), folderId: idSchema })
export const moveFolderAssetsSchema = z.object({
  assetIds: z.array(idSchema).min(1).max(5000),
  sourceFolderId: idSchema,
  targetFolderId: idSchema
})
