import { z } from 'zod'
import { idSchema } from './ipc'

export const museAgentContextSchema = z.object({
  currentViewType: z.enum(['library', 'folder', 'smart-collection', 'search', 'similar', 'duplicates']),
  currentViewId: z.string().max(128).nullable(),
  selectionCount: z.number().int().min(0).max(100_000),
  selectedAssetIds: z.array(idSchema).max(5_000),
  focusedAssetId: idSchema.nullable()
}).refine((value) => value.selectionCount === value.selectedAssetIds.length, 'Selection count does not match selected asset IDs')

export const museAgentSendSchema = z.object({
  conversationId: idSchema,
  text: z.string().trim().min(1).max(8_000)
})

export const museAgentApprovalResolutionSchema = z.object({ requestId: idSchema, approved: z.boolean() })
export const museAgentConversationListSchema = z.object({ includeArchived: z.boolean().default(false) })
export const museAgentMessageListSchema = z.object({ conversationId: idSchema, limit: z.number().int().min(1).max(500).default(200) })
