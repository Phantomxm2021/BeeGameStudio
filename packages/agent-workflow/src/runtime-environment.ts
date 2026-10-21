/** Snapshot only the explicitly selected environment. No vendor aliases or
 * fallback credentials are introduced into owner-scoped execution. */
export function normalizeRuntimeEnvironment(
  env: Readonly<Record<string, string>>,
): Record<string, string>
export function normalizeRuntimeEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv
export function normalizeRuntimeEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const copy = { ...env }
  if (env === process.env)
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
    ])
      if (env[key] !== undefined) copy[key] = env[key]
  return copy
}
export function isEnvTruthy(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  )
}

export function inferRuntimeModelType(
  env: Record<string, string>,
): import('./model-config').RuntimeModelConfig['modelType'] | undefined {
  const selected = env.BEEGAME_MODEL_TYPE
  if (selected) {
    if (!['openai', 'anthropic', 'gemini', 'grok'].includes(selected))
      throw Error('Unsupported model provider')
    return selected as import('./model-config').RuntimeModelConfig['modelType']
  }
  const providers = (['openai', 'anthropic', 'gemini', 'grok'] as const).filter(
    provider => {
      const prefix = provider.toUpperCase()
      return (
        env[prefix + '_BASE_URL'] ||
        env[prefix + '_API_KEY'] ||
        (provider === 'anthropic' && env.ANTHROPIC_AUTH_TOKEN) ||
        (provider === 'openai' && env.OPENAI_AUTH_MODE === 'chatgpt')
      )
    },
  )
  if (providers.length > 1)
    throw Error('The selected environment contains multiple providers')
  return providers[0] ?? (env.BEEGAME_MODEL ? 'openai' : undefined)
}
