import { z } from 'zod'

const id = z.string().min(1).max(128)
const textOperator = z.enum(['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith'])
const numberOperator = z.enum(['equals', 'gt', 'gte', 'lt', 'lte'])
const relationOperator = z.enum(['is', 'isNot', 'contains', 'notContains'])
const dateOperator = z.enum(['today', 'last7', 'last30', 'last90'])

export const smartCollectionRuleSchema = z.union([
  z.object({ id, field: z.enum(['filename', 'extension', 'sourceDomain', 'sourceType','aiPrimaryCategory','aiSecondaryCategory','aiTertiaryCategory','aiObject','aiScene','aiStyle','aiMood','aiLighting','aiComposition','aiMaterial','aiUsage','aiDescription','aiOpenTag','aiSemanticColor']), operator: textOperator, value: z.string().max(500) }),
  z.object({ id, field: z.enum(['width', 'height', 'size','colorBrightness','colorSaturation']), operator: numberOperator, value: z.number().finite().min(0) }),
  z.object({ id, field: z.enum(['width', 'height', 'size','colorBrightness','colorSaturation']), operator: z.literal('between'), value: z.object({ min: z.number().finite().min(0), max: z.number().finite().min(0) }).refine((value) => value.min <= value.max, 'Minimum must not exceed maximum') }),
  z.object({ id, field: z.enum(['folder', 'tag']), operator: relationOperator, value: id }),
  z.object({ id, field: z.enum(['importedAt', 'createdAt', 'lastOpenedAt']), operator: dateOperator, value: z.null() }),
  z.object({ id, field: z.enum(['importedAt', 'createdAt', 'lastOpenedAt']), operator: z.enum(['before', 'after']), value: z.string().date() }),
  z.object({ id, field: z.enum(['importedAt', 'createdAt', 'lastOpenedAt']), operator: z.literal('between'), value: z.object({ from: z.string().date(), to: z.string().date() }).refine((value) => value.from <= value.to, 'Start date must not exceed end date') }),
  z.object({ id, field: z.literal('favorite'), operator: z.literal('is'), value: z.boolean() }),
  z.object({ id, field: z.literal('orientation'), operator: z.enum(['is', 'isNot']), value: z.enum(['landscape', 'portrait', 'square']) }),
  z.object({ id, field: z.literal('colorHex'), operator: z.literal('near'), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ id, field: z.literal('colorTemperature'), operator: z.enum(['is','isNot']), value: z.enum(['cool','neutral','warm']) })
])

export const smartCollectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  matchMode: z.enum(['all', 'any']),
  rules: z.array(smartCollectionRuleSchema).min(1).max(30)
})

export const smartCollectionUpdateSchema = z.object({ id, input: smartCollectionInputSchema })
export const smartCollectionPreviewSchema = smartCollectionInputSchema.extend({ name: z.string().trim().max(120).default('预览') })
