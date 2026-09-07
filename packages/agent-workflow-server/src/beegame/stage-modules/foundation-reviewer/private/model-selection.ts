type RuntimeModelConfig = { modelType: 'anthropic' | 'openai' | 'gemini' | 'grok' }

/** Reviewer-owned provider aliases; preserve the production tier selection. */
export function selectFoundationFactFastRuntime(runtime: RuntimeModelConfig | undefined, environment: Record<string, string>): Record<string, string> {
  const provider = foundationRuntimeProvider(runtime, environment)
  if (!provider) throw new Error('foundation fact extractor fast model is not configured')
  const fastModel = environment[`${provider.toUpperCase()}_DEFAULT_HAIKU_MODEL`]
  if (!fastModel) throw new Error('foundation fact extractor fast model is not configured')
  return { ...environment, [`${provider.toUpperCase()}_DEFAULT_SONNET_MODEL`]: fastModel }
}
export function selectFoundationSemanticRuntime(runtime: RuntimeModelConfig | undefined, environment: Record<string, string>, tier: 'fast' | 'balanced' | 'strong'): Record<string, string> {
  const suffix = tier === 'fast' ? 'HAIKU' : tier === 'balanced' ? 'SONNET' : 'OPUS'
  const provider = foundationRuntimeProvider(runtime, environment)
  if (!provider) throw new Error(`foundation semantic ${tier} model is not configured`)
  const key = `${provider.toUpperCase()}_DEFAULT_${suffix}_MODEL`
  if (!environment[key]) throw new Error(`foundation semantic ${tier} model is not configured`)
  return { ...environment, [`${provider.toUpperCase()}_DEFAULT_SONNET_MODEL`]: environment[key] }
}
const PROVIDERS: RuntimeModelConfig['modelType'][] = ['anthropic', 'openai', 'gemini', 'grok']
function foundationRuntimeProvider(runtime: RuntimeModelConfig | undefined, environment: Record<string, string>) {
  if (runtime?.modelType) return runtime.modelType
  const providers = PROVIDERS.filter(provider => ['HAIKU', 'SONNET', 'OPUS'].some(tier => Boolean(environment[`${provider.toUpperCase()}_DEFAULT_${tier}_MODEL`])))
  if (providers.length > 1) throw new Error('Selected model environment contains multiple providers')
  return providers[0]
}
export function resolvedReviewerProvider(environment: Record<string, string>): RuntimeModelConfig | undefined {
  const value = environment.BEEGAME_MODEL_TYPE
  return PROVIDERS.includes(value as RuntimeModelConfig['modelType']) ? { modelType: value as RuntimeModelConfig['modelType'] } : undefined
}
