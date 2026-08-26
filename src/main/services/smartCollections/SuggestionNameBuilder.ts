import type { CollectionSuggestionCondition } from '@shared/types/domain'

const aestheticStyles = new Set(['minimalist', 'editorial', 'retro', 'technology', 'cinematic', 'japandi', 'brutalism', 'luxury', 'natural', 'fresh'])

export function buildSuggestionName(conditions: CollectionSuggestionCondition[]): string {
  if (conditions.length === 1) return conditions[0]?.label ?? '整理建议'
  const by = (dimension: CollectionSuggestionCondition['dimension']) => conditions.find((item) => item.dimension === dimension)
  const object = by('object'), scene = by('scene'), style = by('style'), color = by('color')
  if (color && object) return `${color.label}${object.label}`
  if (color && style) return `${color.label}${style.label}`
  if (scene && object) return `${scene.label}${object.label}`
  if (scene && style) return `${scene.label}${style.label}`
  if (style && object) return aestheticStyles.has(style.normalizedValue) ? `${style.label}${object.label}` : `${object.label}${style.label}`
  return conditions.map((item) => item.label).join(' · ')
}
