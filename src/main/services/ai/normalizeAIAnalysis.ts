import { nanoid } from 'nanoid'
import type { AICategory, AITermType, AIValue } from '@shared/types/domain'
import type { RawAIAnalysisResult } from '@shared/schemas/ai'
import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY, normalizePrimaryObject } from '@shared/constants/aiVocabulary'

export interface NormalizedAIAnalysis {
  category: AICategory
  terms: Array<AIValue & { id: string; type: AITermType }>
  description: string
  overallConfidence: number
  primaryObject: AIValue
  primaryScene: AIValue
  primaryStyle: AIValue
}

export function normalizeAIAnalysis(raw: RawAIAnalysisResult): NormalizedAIAnalysis {
  const terms: NormalizedAIAnalysis['terms'] = []
  const seen = new Set<string>()
  const push = (type: AITermType, value: AIValue | null): void => {
    if (!value) return
    const key = `${type}:${value.normalizedValue}`
    if (seen.has(key)) return
    seen.add(key)
    terms.push({ id: nanoid(18), type, ...value })
  }
  const object = normalizePrimaryObject(raw.primaryObject.value)
  const primaryObject: AIValue = { ...object, confidence: raw.primaryObject.confidence, source: 'ai' }
  const primaryScene: AIValue = { value: (MINIMAL_SCENE_VOCABULARY as Record<string, string>)[raw.primaryScene.normalizedValue]!, normalizedValue: raw.primaryScene.normalizedValue, confidence: raw.primaryScene.confidence, source: 'ai' }
  const primaryStyle: AIValue = { value: (MINIMAL_STYLE_VOCABULARY as Record<string, string>)[raw.primaryStyle.normalizedValue]!, normalizedValue: raw.primaryStyle.normalizedValue, confidence: raw.primaryStyle.confidence, source: 'ai' }
  push('object', primaryObject); push('scene', primaryScene); push('style', primaryStyle)

  return {
    category: {
      primary: null, secondary: null, tertiary: null
    },
    terms,
    description: raw.description.trim(),
    overallConfidence: Math.min(primaryObject.confidence, primaryScene.confidence, primaryStyle.confidence),
    primaryObject, primaryScene, primaryStyle
  }
}
