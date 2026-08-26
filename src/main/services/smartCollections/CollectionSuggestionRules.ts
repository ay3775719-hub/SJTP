import { nanoid } from 'nanoid'
import { COLOR_BUCKETS, type ColorBucket } from '@shared/constants/colorBuckets'
import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY, normalizeOpenTerm, normalizePrimaryObject } from '@shared/constants/aiVocabulary'
import type { CollectionSuggestionCondition, SmartCollectionInput, SmartCollectionRule } from '@shared/types/domain'

const sceneLabels = invert(MINIMAL_SCENE_VOCABULARY)
const styleLabels = invert(MINIMAL_STYLE_VOCABULARY)

export function suggestionCondition(dimension: CollectionSuggestionCondition['dimension'], label: string, normalizedValue: string): CollectionSuggestionCondition {
  if (dimension === 'color') {
    const bucket = normalizedValue as ColorBucket
    return { dimension, field: 'colorHex', label: COLOR_BUCKETS[bucket].label, normalizedValue: bucket, ruleValue: COLOR_BUCKETS[bucket].hex }
  }
  const fields = { object: 'aiObject', scene: 'aiScene', style: 'aiStyle' } as const
  return { dimension, field: fields[dimension], label, normalizedValue, ruleValue: normalizedValue }
}

export function conditionsToInput(name: string, conditions: CollectionSuggestionCondition[]): SmartCollectionInput {
  return {
    name,
    matchMode: 'all',
    rules: conditions.map((condition) => condition.field === 'colorHex'
      ? { id: nanoid(10), field: 'colorHex', operator: 'near', value: condition.ruleValue }
      : { id: nanoid(10), field: condition.field, operator: 'equals', value: condition.ruleValue })
  }
}

export function canonicalRuleSignature(input: Pick<SmartCollectionInput, 'matchMode' | 'rules'>): string {
  const parts = input.rules.map(canonicalRule).sort()
  return `${input.matchMode === 'any' ? 'any:' : ''}${parts.join('&')}`
}

function canonicalRule(rule: SmartCollectionRule): string {
  if (rule.field === 'aiObject') return `aiObject=${encode(normalizePrimaryObject(String(rule.value)).normalizedValue)}`
  if (rule.field === 'aiScene') return `aiScene=${encode(normalizeControlled(String(rule.value), sceneLabels))}`
  if (rule.field === 'aiStyle') return `aiStyle=${encode(normalizeControlled(String(rule.value), styleLabels))}`
  if (rule.field === 'colorHex') return `colorHex=${String(rule.value).toUpperCase()}`
  return `${rule.field}:${rule.operator}=${encode(typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value))}`
}

function normalizeControlled(value: string, labels: Record<string, string>): string {
  const normalized = normalizeOpenTerm(value)
  return labels[normalized] ?? normalized.replace(/^(scene|style)\./, '')
}

function invert(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [normalizeOpenTerm(value), key]))
}

function encode(value: string): string { return encodeURIComponent(value) }
