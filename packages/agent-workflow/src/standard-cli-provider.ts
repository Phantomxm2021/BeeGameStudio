import { normalizeRuntimeEnvironment } from '../../../src/utils/runtimeEnvironment'

export type StandardCliModelType = 'anthropic' | 'openai' | 'gemini' | 'grok'

/** Translate product-owned upload configuration to upstream public keys.
 * Never choose a destination or fill in a credential automatically. */
export function standardCliArtifactEnvironment(selected: Readonly<Record<string, string>>) {
  const environment = normalizeRuntimeEnvironment(selected)
  for (const suffix of ['URL', 'TOKEN']) {
    const privateKey = 'BEEGAME_ARTIFACTS_' + suffix
    if (environment[privateKey] !== undefined) environment['CLAUDE_ARTIFACTS_' + suffix] = environment[privateKey]!
    delete environment[privateKey]
  }
  return environment
}

/** BGS selection is host state, not a private native provider override.
 * Supply the existing public modelType setting and clear conflicting public
 * provider flags only when a provider was explicitly selected. */
export function standardCliProvider(selected: Readonly<Record<string, string>>) {
  const environment = standardCliArtifactEnvironment(selected)
  const selectedType = environment.BEEGAME_MODEL_TYPE
  delete environment.BEEGAME_MODEL_TYPE
  if (selectedType === undefined) return { environment, modelType: undefined }
  if (!['anthropic', 'openai', 'gemini', 'grok'].includes(selectedType))
    throw new Error('Invalid BGS selected provider; expected anthropic, openai, gemini or grok')
  for (const flag of ['BEDROCK', 'VERTEX', 'FOUNDRY', 'OPENAI', 'GEMINI', 'GROK'])
    environment['BGS_USE_' + flag] = '0'
  return { environment, modelType: selectedType as StandardCliModelType }
}
