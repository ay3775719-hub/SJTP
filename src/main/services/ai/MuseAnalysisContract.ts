import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY } from '@shared/constants/aiVocabulary'
import { aiAnalysisResultSchema, type RawAIAnalysisResult } from '@shared/schemas/ai'
import { MuseError } from '../../errors'

export const MUSE_ANALYSIS_SYSTEM_PROMPT = `你是 Muse 的轻量图片索引引擎。每张图只返回一个主对象、一个主场景、一个主要视觉风格和一句 15–40 个中文字的搜索描述。不要返回次要对象或多个场景/风格；不要分析分类、情绪、光线、构图、材质、用途、颜色或标签。只依据可见内容，不确定时降低 confidence。场景和风格必须使用 schema 中的 normalizedValue。`

export const MUSE_ANALYSIS_USER_PROMPT = '分析这张图片并严格按给定 JSON Schema 返回。看不清或无法判断的开放字段不要强行填充。不要使用 Markdown 代码块。'

export const MUSE_ANALYSIS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    primaryObject: primarySchema(),
    primaryScene: primarySchema(Object.keys(MINIMAL_SCENE_VOCABULARY)),
    primaryStyle: primarySchema(Object.keys(MINIMAL_STYLE_VOCABULARY)),
    description: { type: 'string', minLength: 1, maxLength: 60 }
  },
  required: ['primaryObject','primaryScene','primaryStyle','description']
} as const

export function parseMuseAnalysis(text: string): RawAIAnalysisResult {
  const candidates = [text.trim(), extractJsonObject(text)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try { return aiAnalysisResultSchema.parse(JSON.parse(candidate)) }
    catch { /* try the single safe extraction pass */ }
  }
  throw new MuseError('AI_INVALID_RESPONSE', 'AI 返回结果未通过 Muse 结构校验')
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return fenced.trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : null
}

function primarySchema(values?: string[]): object { return { type: 'object', additionalProperties: false, properties: { value: { type: 'string', minLength: 1, maxLength: 40 }, normalizedValue: { type: 'string', minLength: 1, maxLength: 80, ...(values ? { enum: values } : {}) }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['value','normalizedValue','confidence'] } }
