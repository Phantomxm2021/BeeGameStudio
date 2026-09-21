import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { encryptSecret, decryptSecret } from '../security/secret-crypto'
import { imageConfigSchema, imageConfigPatchSchema, imageProviderSchema, defaultImageConfig, updateImageConfig, type ImageProviderKind, type ImageGenerationConfig } from './config'

const SECRET_TYPE = 'image-generation:api-key'
export function encodeImageConfig(config: ImageGenerationConfig) {
  return { ...config, apiKey: config.apiKey ? encryptSecret(config.apiKey, SECRET_TYPE) : '',
    upstreamApiKey: config.upstreamApiKey ? encryptSecret(config.upstreamApiKey, SECRET_TYPE + ':upstream') : '' }
}
export function decodeImageConfig(value: unknown): ImageGenerationConfig {
  // Ciphertext is longer than the plaintext key; validate its plaintext limit after decrypting.
  const stored = imageConfigSchema.extend({ apiKey: z.string().default(''), upstreamApiKey: z.string().default('') }).parse(value ?? {})
  return imageConfigSchema.parse({ ...stored, apiKey: stored.apiKey ? decryptSecret(stored.apiKey, SECRET_TYPE) : '',
    upstreamApiKey: stored.upstreamApiKey ? decryptSecret(stored.upstreamApiKey, SECRET_TYPE + ':upstream') : '' })
}
export type ImageSettings = { activeProvider: ImageProviderKind; providers: Partial<Record<ImageProviderKind, ImageGenerationConfig>> }
export function decodeImageSettings(value: unknown): ImageSettings {
  if (value && typeof value === 'object' && 'activeProvider' in value) {
    const stored = z.object({ activeProvider: imageProviderSchema, providers: z.partialRecord(imageProviderSchema, z.unknown()) }).parse(value)
    const providers: ImageSettings['providers'] = {}
    for (const [key, entry] of Object.entries(stored.providers)) {
      const config = decodeImageConfig(entry)
      if (config.provider !== key) throw new Error('Image provider profile mismatch')
      providers[config.provider] = config
    }
    return { activeProvider: stored.activeProvider, providers }
  }
  // Migrate the single existing profile without copying its key into other providers.
  const config = decodeImageConfig(value)
  return { activeProvider: config.provider, providers: { [config.provider]: config } }
}
export function selectImageConfig(settings: ImageSettings, provider = settings.activeProvider) {
  return settings.providers[provider] ?? defaultImageConfig(provider)
}
export function updateImageSettings(settings: ImageSettings, input: unknown): ImageSettings {
  const patch = imageConfigPatchSchema.parse(input)
  const provider = patch.provider ?? settings.activeProvider
  const config = updateImageConfig(selectImageConfig(settings, provider), patch)
  return { activeProvider: provider, providers: { ...settings.providers, [provider]: config } }
}
export function encodeImageSettings(settings: ImageSettings) {
  return { activeProvider: settings.activeProvider,
    providers: Object.fromEntries(Object.entries(settings.providers).map(([key, config]) => [key, encodeImageConfig(config)])) }
}
export function loadLocalImageSettings(dataDir: string): ImageSettings {
  try { return decodeImageSettings(JSON.parse(readFileSync(join(dataDir, 'image-generation.json'), 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return decodeImageSettings({})
    throw error
  }
}
export function loadLocalImageConfig(dataDir: string): ImageGenerationConfig {
  return selectImageConfig(loadLocalImageSettings(dataDir))
}
export function saveLocalImageConfig(dataDir: string, config: ImageGenerationConfig) {
  saveLocalImageSettings(dataDir, updateImageSettings(loadLocalImageSettings(dataDir), config))
}
export function saveLocalImageSettings(dataDir: string, settings: ImageSettings) {
  mkdirSync(dataDir, { recursive: true })
  const target = join(dataDir, 'image-generation.json')
  const temporary = target + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify(encodeImageSettings(settings)), { mode: 0o600 })
  renameSync(temporary, target)
}
