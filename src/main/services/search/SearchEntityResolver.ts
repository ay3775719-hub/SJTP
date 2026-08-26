import type { Folder, NaturalSearchCondition, NaturalSearchExpression, Tag } from '@shared/types/domain'
import { COLOR_BUCKETS, type ColorBucket } from '@shared/constants/colorBuckets'
import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY, normalizeOpenTerm, normalizePrimaryObject } from '@shared/constants/aiVocabulary'

const aliases: Record<string, string> = {
  绿色: 'green', 绿: 'green', 蓝色: 'blue', 蓝: 'blue', 红色: 'red', 红: 'red', 黄色: 'yellow', 黄: 'yellow',
  橙色: 'orange', 紫色: 'purple', 粉色: 'pink', 棕色: 'brown', 黑色: 'black', 白色: 'white', 灰色: 'gray',
  暖色: 'warm-neutral', 暖中性: 'warm-neutral', 冷色: 'cool-neutral', 冷中性: 'cool-neutral', 黑白: 'gray'
}

export class SearchEntityResolver {
  constructor(private readonly folders: () => Folder[], private readonly tags: () => Tag[]) {}

  resolve(expression: NaturalSearchExpression): NaturalSearchExpression {
    if ('field' in expression) return this.condition(expression)
    if (expression.operator === 'not') return { operator: 'not', child: this.resolve(expression.child) }
    return { operator: expression.operator, children: expression.children.map((child) => this.resolve(child)) }
  }

  private condition(condition: NaturalSearchCondition): NaturalSearchCondition {
    if (condition.field === 'object') return { ...condition, value: normalizePrimaryObject(condition.value).normalizedValue }
    if (condition.field === 'scene') return { ...condition, value: vocabularyKey(condition.value, MINIMAL_SCENE_VOCABULARY) }
    if (condition.field === 'style') return { ...condition, value: vocabularyKey(condition.value, MINIMAL_STYLE_VOCABULARY) }
    if (condition.field === 'color') {
      const normalized = normalizeOpenTerm(condition.value)
      const bucket = (aliases[condition.value] ?? aliases[normalized] ?? normalized) as ColorBucket
      return bucket in COLOR_BUCKETS ? { ...condition, value: bucket } : { field: 'freeText', operator: 'contains', value: condition.value }
    }
    if (condition.field === 'folder' || condition.field === 'tag') {
      const values = condition.field === 'folder' ? this.folders() : this.tags()
      const match = values.find((item) => item.name.localeCompare(condition.value, 'zh-CN', { sensitivity: 'accent' }) === 0)
      return match ? { ...condition, value: match.id } : { field: 'freeText', operator: 'contains', value: condition.value }
    }
    if (condition.field === 'extension') return { ...condition, value: condition.value.replace(/^\./, '').toLocaleLowerCase('en-US') }
    return condition
  }
}

function vocabularyKey(value: string, vocabulary: Record<string, string>): string {
  const cleaned = normalizeOpenTerm(value).replace(/^(scene|style)\./, '')
  if (cleaned in vocabulary) return cleaned
  const entry = Object.entries(vocabulary).find(([, label]) => normalizeOpenTerm(label) === cleaned)
  return entry?.[0] ?? cleaned
}
