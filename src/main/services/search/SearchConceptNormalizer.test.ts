import { describe, expect, it } from 'vitest'
import { normalizeSearchConcept } from './SearchConceptNormalizer'

describe('SearchConceptNormalizer', () => {
  it('keeps specific people concepts ahead of the generic person alias', () => {
    expect(normalizeSearchConcept('女人')).toBe('woman')
    expect(normalizeSearchConcept('男人')).toBe('man')
    expect(normalizeSearchConcept('人物')).toBe('person')
    expect(normalizeSearchConcept('穿裙子的人物')).toContain('dress')
    expect(normalizeSearchConcept('穿裙子的人物')).toContain('person')
  })

  it('normalizes common local retrieval concepts without query-specific branches', () => {
    expect(normalizeSearchConcept('绿色的户外背包')).toBe('绿色的 outdoor backpack')
    expect(normalizeSearchConcept('双肩包')).toBe('backpack')
    expect(normalizeSearchConcept('摩托车')).toBe('motorcycle')
  })
})
