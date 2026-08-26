import { z } from 'zod'

export const ruleSignatureSchema = z.string().trim().min(3).max(500).regex(/^[\w%=&:#.-]+$/i)
