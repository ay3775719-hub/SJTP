import type { SmartCollectionField } from '../types/domain'

/** Fields that are queryable today and implemented by the SQL query builder. */
export const ACTIVE_SMART_COLLECTION_FIELDS = [
  'filename',
  'extension',
  'sourceDomain',
  'sourceType',
  'width',
  'height',
  'size',
  'favorite',
  'orientation',
  'folder',
  'tag',
  'importedAt',
  'createdAt',
  'lastOpenedAt'
  ,'aiObject','aiScene','aiStyle'
  ,'colorHex','colorTemperature','colorBrightness','colorSaturation'
] as const satisfies readonly SmartCollectionField[]

/**
 * Reserved fields that still require embeddings or OCR infrastructure.
 */
export const RESERVED_AI_SMART_COLLECTION_FIELDS = [
  'ocr.text',
  'ai.analysisStatus',
  'ai.similarity'
] as const

export type ReservedAISmartCollectionField = typeof RESERVED_AI_SMART_COLLECTION_FIELDS[number]
