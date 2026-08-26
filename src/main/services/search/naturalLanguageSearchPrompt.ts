import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY } from '@shared/constants/aiVocabulary'
import { COLOR_BUCKETS } from '@shared/constants/colorBuckets'

export const NATURAL_SEARCH_PARSER_VERSION = 'natural-search-v1.1'

export const NATURAL_SEARCH_SYSTEM_PROMPT = `You are Muse's search query parser.
Convert one natural-language visual-library request into a structured Muse search intent.
Do not search the library, invent results, inspect files, access a database, or explain your reasoning.
Use only supported fields. Multiple unstated conditions mean AND. Use OR only for explicit alternatives and NOT only for explicit exclusions.
Preserve useful unsupported visual words as freeText instead of dropping them. Return compact JSON only.`

export const NATURAL_SEARCH_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['operator','conditions'],
  properties: {
    operator: { type: 'string', enum: ['and','or'] },
    conditions: { type: 'array', minItems: 1, maxItems: 12, items: {
      type: 'object', additionalProperties: false, required: ['field','operator','value','negate'],
      properties: {
        field: { type: 'string', enum: ['object','scene','style','color','favorite','folder','tag','orientation','importedDate','filename','description','freeText','extension'] },
        operator: { type: 'string', enum: ['equals','contains','near','within'] },
        value: { type: 'string' },
        negate: { type: 'boolean' }
      }
    } }
  }
} as const

export function createNaturalSearchPrompt(query: string): string {
  return `Supported scenes (normalized_key: label): ${pairs(MINIMAL_SCENE_VOCABULARY)}
Supported styles: ${pairs(MINIMAL_STYLE_VOCABULARY)}
Color buckets: ${pairs(COLOR_BUCKETS, (value) => (value as { label: string }).label)}
Date values: today, last_7_days, last_30_days.
Folder and tag values must remain user-visible names, never IDs.
For phrases like "有帐篷的背包图", keep the main subject as object=backpack and put the secondary visible word 帐篷 in description or freeText; never emit two primary object conditions joined with AND.
Examples:
"绿色的户外背包" => operator=and; object/backpack, scene/outdoor, color/green
"背包或者鞋" => operator=or; object/backpack, object/shoes
"户外背包，但不要白底" => operator=and; object/backpack, scene/outdoor, scene/white_background with negate=true
User search: ${JSON.stringify(query)}`
}
function pairs(values: Record<string, unknown>, label = (value: unknown) => String(value)): string {
  return Object.entries(values).map(([key, value]) => `${key}:${label(value)}`).join(', ')
}
