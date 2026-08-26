import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AIProviderId } from '@shared/types/domain'
import { MuseError } from '../../errors'

type SecretMap = Partial<Record<AIProviderId, string>>

const ENV_KEYS: Partial<Record<AIProviderId, string>> = {
  openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY',
  'openai-compatible': 'MUSE_OPENAI_COMPATIBLE_API_KEY', lmstudio: 'MUSE_LMSTUDIO_API_KEY'
}

export class AICredentialStore {
  private readonly path: string
  constructor(userDataPath: string) { this.path = join(userDataPath, 'ai-credentials.bin') }

  getSecret(providerId: AIProviderId): string | null {
    const envName = ENV_KEYS[providerId]
    const environmentValue = envName ? process.env[envName]?.trim() : undefined
    if (environmentValue) return environmentValue
    return this.read()[providerId]?.trim() || null
  }

  hasSecret(providerId: AIProviderId): boolean { return Boolean(this.getSecret(providerId)) }

  setSecret(providerId: AIProviderId, value: string): void {
    const secret = value.trim()
    if (!secret) throw new MuseError('AI_KEY_INVALID', '凭据不能为空')
    if (!safeStorage.isEncryptionAvailable()) throw new MuseError('AI_CREDENTIAL_STORE_UNAVAILABLE', '系统安全凭据存储当前不可用')
    this.write({ ...this.read(), [providerId]: secret })
  }

  clearSecret(providerId: AIProviderId): void {
    const values = this.read()
    delete values[providerId]
    this.write(values)
  }

  private read(): SecretMap {
    if (!existsSync(this.path) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const decrypted = safeStorage.decryptString(readFileSync(this.path)).trim()
      if (!decrypted) return {}
      if (!decrypted.startsWith('{')) return { openai: decrypted }
      return JSON.parse(decrypted) as SecretMap
    } catch { return {} }
  }

  private write(values: SecretMap): void {
    if (!safeStorage.isEncryptionAvailable()) throw new MuseError('AI_CREDENTIAL_STORE_UNAVAILABLE', '系统安全凭据存储当前不可用')
    writeFileSync(this.path, safeStorage.encryptString(JSON.stringify(values)), { mode: 0o600 })
  }
}
