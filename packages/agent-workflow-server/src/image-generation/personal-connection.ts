import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { decryptSecret, encryptSecret } from '../security/secret-crypto'
import { defaultImageConfig, imageConfigSchema, imageProviderSchema, type ImageGenerationConfig } from './config'

const sourceSchema = z.enum(['platform', 'byok'])
const inputSchema = z.object({
  source: sourceSchema,
  provider: imageProviderSchema.optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  upstreamApiKey: z.string().optional(),
}).strict()

type Connection = { source: z.infer<typeof sourceSchema>; config: ImageGenerationConfig }
const secretType = 'personal-image-connection'
const file = (root: string) => join(root, '.runtime', 'image-connection.json')

export function loadPersonalImageConnection(root: string): Connection {
  const target = file(root)
  if (!existsSync(target)) return { source: 'platform', config: defaultImageConfig('openai') }
  const stored = z.object({ source: sourceSchema, config: z.record(z.string(), z.unknown()) }).parse(JSON.parse(readFileSync(target, 'utf8')))
  const config = imageConfigSchema.parse({ ...stored.config,
    apiKey: stored.config.apiKey ? decryptSecret(String(stored.config.apiKey), secretType) : '',
    upstreamApiKey: stored.config.upstreamApiKey ? decryptSecret(String(stored.config.upstreamApiKey), secretType + ':upstream') : '',
    billing: null,
  })
  return { source: stored.source, config }
}

export function publicPersonalImageConnection(connection: Connection) {
  const { apiKey, upstreamApiKey, provider, baseUrl, model } = connection.config
  return { source: connection.source, provider, baseUrl, model: apiKey ? model : '',
    hasApiKey: Boolean(apiKey), hasUpstreamApiKey: Boolean(upstreamApiKey) }
}

export function savePersonalImageConnection(root: string, input: unknown) {
  const value = inputSchema.parse(input)
  const previous = loadPersonalImageConnection(root)
  let config = previous.config
  if (value.source === 'byok') {
    const provider = value.provider ?? config.provider
    const baseUrl = value.baseUrl?.trim() ?? config.baseUrl
    const model = value.model?.trim() ?? config.model
    const sameEndpoint = provider === config.provider && baseUrl === config.baseUrl
    if (!config.apiKey && !value.model?.trim()) throw new Error('Select a personal image model')
    config = imageConfigSchema.parse({ provider, baseUrl, model,
      apiKey: value.apiKey?.trim() || (sameEndpoint ? config.apiKey : ''),
      upstreamApiKey: value.upstreamApiKey?.trim() || (sameEndpoint ? config.upstreamApiKey : ''),
      billing: null, quality: 'medium', size: '1024x1024' })
    if (!config.apiKey) throw new Error('A personal image API key is required')
  }
  const stored = { source: value.source, config: { ...config,
    apiKey: config.apiKey ? encryptSecret(config.apiKey, secretType) : '',
    upstreamApiKey: config.upstreamApiKey ? encryptSecret(config.upstreamApiKey, secretType + ':upstream') : '',
    billing: null } }
  const target = file(root)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, target)
  return publicPersonalImageConnection({ source: value.source, config })
}
