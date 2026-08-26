import { z } from 'zod'

export const WEB_COLLECTOR_PROTOCOL_VERSION = 1
export const WEB_COLLECTOR_PORT = 47831
export const WEB_COLLECTOR_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

export const webCollectPayloadSchema = z.object({
  imageUrl: z.string().url().max(8_192),
  pageUrl: z.string().url().max(8_192),
  pageTitle: z.string().trim().max(500).optional(),
  siteName: z.string().trim().max(200).optional(),
  domain: z.string().trim().max(253).optional(),
  altText: z.string().trim().max(1_000).optional(),
  imageWidth: z.number().int().positive().max(200_000).optional(),
  imageHeight: z.number().int().positive().max(200_000).optional(),
  collectedAt: z.string().datetime(),
  extensionVersion: z.string().trim().min(1).max(40)
})

export const webCollectEnvelopeSchema = z.object({
  protocolVersion: z.literal(WEB_COLLECTOR_PROTOCOL_VERSION),
  type: z.literal('collect_image'),
  requestId: z.string().uuid(),
  payload: webCollectPayloadSchema
})

export const pairingRequestSchema = z.object({
  protocolVersion: z.literal(WEB_COLLECTOR_PROTOCOL_VERSION),
  browserName: z.enum(['Chrome', 'Edge']),
  extensionVersion: z.string().trim().min(1).max(40)
})

export function extensionIdFromOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  return match?.[1] ?? null
}
