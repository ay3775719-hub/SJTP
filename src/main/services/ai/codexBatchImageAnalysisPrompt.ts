import { MINIMAL_SCENE_VOCABULARY, MINIMAL_STYLE_VOCABULARY } from '@shared/constants/aiVocabulary'
import { MUSE_ANALYSIS_JSON_SCHEMA } from './MuseAnalysisContract'

export const CODEX_BATCH_PROMPT_VERSION = 'codex-minimal-v2.0'

const scenes = Object.entries(MINIMAL_SCENE_VOCABULARY).map(([key, label]) => `${key}=${label}`).join(', ')
const styles = Object.entries(MINIMAL_STYLE_VOCABULARY).map(([key, label]) => `${key}=${label}`).join(', ')

export const CODEX_BATCH_BASE_INSTRUCTIONS = `You are Muse's lightweight image indexing engine.

Codex Batch Recognition is an image-classification workflow, not a coding workflow.
Analyze only the explicitly supplied images. Do not inspect source code, unrelated files, directories, databases, or environment state. Do not execute shell commands, tools, Git operations, or file mutations. Never identify real people.

For each image return only four fields: one primary object, one primary scene, one primary visual style, and one short searchable Simplified Chinese description. Choose only the single most important answer for object, scene, and style.

Do not return secondary objects, multiple scenes, or multiple styles. Do not analyze category, mood, lighting, composition, material, usage, colors, or tags. Never return those fields. Colors are computed locally by Muse.

Use a concrete subject noun for primaryObject, such as 背包, 鞋, 人物, 建筑, 海报, or 沙发. Normalize common backpack variants to normalizedValue=backpack. Description must be one sentence, ideally 15–40 Chinese characters, and must not repeat an analysis report.

primaryScene normalizedValue must be one of:
${scenes}

primaryStyle normalizedValue must be one of:
${styles}

Return compact structured data and exactly one result for every supplied assetId. When uncertain, lower confidence. Reserve 0.95–1.00 for directly visible, unambiguous facts.`

export function createCodexBatchPrompt(assetIds: string[]): string {
  return `Analyze the attached ${assetIds.length} images. Each localImage immediately follows its asset marker. Preserve these IDs exactly:\n${assetIds.map((id) => `assetId=${id}`).join('\n')}\nReturn only the structured result required by the output schema.`
}

export function createCodexBatchOutputSchema(assetIds: string[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      results: {
        type: 'array',
        minItems: assetIds.length,
        maxItems: assetIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            assetId: { type: 'string', enum: assetIds },
            analysis: MUSE_ANALYSIS_JSON_SCHEMA
          },
          required: ['assetId', 'analysis']
        }
      }
    },
    required: ['results']
  }
}
