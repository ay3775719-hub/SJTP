import { z } from 'zod'
import type { NaturalSearchExpression, NaturalSearchIntent } from '../types/domain'

const text = z.string().trim().min(1).max(120)

export const naturalSearchConditionSchema = z.discriminatedUnion('field', [
  z.object({ field: z.enum(['object', 'scene', 'style']), operator: z.literal('equals'), value: text }),
  z.object({ field: z.literal('color'), operator: z.literal('near'), value: text }),
  z.object({ field: z.literal('favorite'), operator: z.literal('equals'), value: z.boolean() }),
  z.object({ field: z.enum(['folder', 'tag']), operator: z.literal('equals'), value: text }),
  z.object({ field: z.literal('orientation'), operator: z.literal('equals'), value: z.enum(['portrait', 'landscape', 'square']) }),
  z.object({ field: z.literal('importedDate'), operator: z.literal('within'), value: z.enum(['today', 'last_7_days', 'last_30_days']) }),
  z.object({ field: z.enum(['filename', 'description', 'freeText']), operator: z.enum(['equals', 'contains']), value: text }),
  z.object({ field: z.literal('extension'), operator: z.literal('equals'), value: text })
])

export const naturalSearchExpressionSchema: z.ZodType<NaturalSearchExpression> = z.lazy(() => z.union([
  naturalSearchConditionSchema,
  z.object({ operator: z.enum(['and', 'or']), children: z.array(naturalSearchExpressionSchema).min(1).max(12) }),
  z.object({ operator: z.literal('not'), child: naturalSearchExpressionSchema })
])) as z.ZodType<NaturalSearchExpression>

export const naturalSearchIntentSchema: z.ZodType<NaturalSearchIntent> = z.object({
  expression: naturalSearchExpressionSchema,
  sort: z.enum(['imported-desc', 'imported-asc', 'name-asc', 'name-desc', 'size-desc', 'width-desc', 'height-desc']).optional()
})

export const naturalSearchParseRequestSchema = z.object({ query: z.string().trim().min(1).max(240), forceNatural: z.boolean().default(false) })
export const naturalSearchRemoveChipSchema = z.object({ intent: naturalSearchIntentSchema, signature: z.string().min(1).max(500) })
export const naturalSearchSaveSchema = z.object({ queryText: z.string().trim().min(1).max(240), intent: naturalSearchIntentSchema })
export const naturalSearchHistoryLimitSchema = z.number().int().min(1).max(50).default(10)
