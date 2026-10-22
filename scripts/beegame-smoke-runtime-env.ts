type JsonObject = Record<string, unknown>

export function assertSmokeRuntimeEnv(
  env: JsonObject,
  context: {
    modelConfigOwnerId?: string
  } = {},
): void {
  const model = stringField(env.BEEGAME_MODEL)
  if (
    model &&
    ['OPENAI', 'ANTHROPIC', 'GEMINI', 'GROK'].some(
      prefix =>
        stringField(env[prefix + '_BASE_URL']) &&
        (stringField(env[prefix + '_API_KEY']) ||
          (prefix === 'ANTHROPIC' && stringField(env.ANTHROPIC_AUTH_TOKEN))),
    )
  )
    return

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
          ? shouldRedact(key)
            ? '<redacted>'
            : '<set>'
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
