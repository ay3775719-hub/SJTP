import { z } from 'zod'
import { idSchema } from './ipc'

export const duplicateKindSchema = z.enum(['exact', 'near']).optional()
export const duplicateCleanupSchema = z.object({ groupId: idSchema, keepAssetId: idSchema })
