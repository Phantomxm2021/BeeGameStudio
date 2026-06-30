type JsonObject = Record<string, unknown>

const PROVIDER_REQUIREMENTS = [
  {
    label: 'OpenAI-compatible',
    keys: [
      'CLAUDE_CODE_USE_OPENAI',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_DEFAULT_SONNET_MODEL',
    ],
  },
  {
    label: 'Anthropic-compatible',
    keys: [
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
    ],
  },
  {
    label: 'Gemini',
    keys: [
      'CLAUDE_CODE_USE_GEMINI',
      'GEMINI_API_KEY',
      'GEMINI_DEFAULT_SONNET_MODEL',
    ],
  },
  {
    label: 'Grok',
    keys: [
      'CLAUDE_CODE_USE_GROK',
      'GROK_API_KEY',
      'GROK_DEFAULT_SONNET_MODEL',
    ],
  },
] as const

export function assertSmokeRuntimeEnv(
  env: JsonObject,
  context: {
    modelConfigOwnerId?: string
  } = {},
): void {
  const matchedProvider = PROVIDER_REQUIREMENTS.find(provider =>
    provider.keys.every(key => stringField(env[key])),
  )
  if (matchedProvider) return

  const diagnostics = context.modelConfigOwnerId?.trim()
    ? ` effective model config owner: ${context.modelConfigOwnerId.trim()}.`
    : ''
  throw new Error(
    `beegame_runtime_env did not return a usable model provider configuration.${diagnostics} Configure a platform default model in Settings > Platform, then re-run the Supabase smoke check.`,
  )
}

export function summarizeRuntimeEnv(env: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === 'string' && value
          ? shouldRedact(key) ? '<redacted>' : '<set>'
          : '<empty>',
      ]),
  )
}

function stringField(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}

function shouldRedact(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(key)
}
