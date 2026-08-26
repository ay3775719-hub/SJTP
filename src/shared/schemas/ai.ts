import { z } from 'zod'
import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY } from '../constants/aiVocabulary'

const confidence = z.number().finite().min(0).max(1)
const primaryValue = z.object({ value: z.string().trim().min(1).max(40), normalizedValue: z.string().trim().min(1).max(80), confidence }).strict()
const controlledPrimaryValue = (values: Record<string, string>) => primaryValue.refine((item) => Object.hasOwn(values, item.normalizedValue), 'Unknown controlled vocabulary key')

export const aiAnalysisResultSchema = z.object({
  primaryObject: primaryValue,
  primaryScene: controlledPrimaryValue(MINIMAL_SCENE_VOCABULARY),
  primaryStyle: controlledPrimaryValue(MINIMAL_STYLE_VOCABULARY),
  description: z.string().trim().min(1).max(60)
}).strict()

export type RawAIAnalysisResult = z.infer<typeof aiAnalysisResultSchema>

export const aiProviderIdSchema = z.enum(['codex-chatgpt','ollama','lmstudio','openai','gemini','anthropic','openai-compatible'])
export const aiRunModeSchema = z.enum(['local-only','cloud-only','manual'])
const providerConfigSchema = z.object({
  baseUrl: z.string().trim().max(500),
  modelId: z.string().trim().max(200),
  displayName: z.string().trim().max(80).optional()
}).strict()

export const aiSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  autoAnalyzeOnImport: z.boolean().optional(),
  runMode: aiRunModeSchema.optional(),
  providerId: aiProviderIdSchema.optional(),
  providerConfigs: z.record(aiProviderIdSchema, providerConfigSchema).optional(),
  concurrency: z.number().int().min(1).max(5).optional(),
  cloudPrivacyAccepted: z.boolean().optional()
}).strict()

export const aiProviderRequestSchema = z.object({ providerId: aiProviderIdSchema }).strict()
export const aiProviderSecretSchema = z.object({ providerId: aiProviderIdSchema, secret: z.string().max(1000) }).strict()

export const aiAnalyzeAssetsSchema = z.object({
  assetIds: z.array(z.string().min(1).max(128)).min(1).max(5000),
  force: z.boolean().default(false)
})

export const aiTermMutationSchema = z.object({
  assetId: z.string().min(1).max(128),
  type: z.enum(['object','scene','style','mood','lighting','composition','material','usage','semantic_color','open_tag']),
  value: z.string().trim().min(1).max(80)
})
