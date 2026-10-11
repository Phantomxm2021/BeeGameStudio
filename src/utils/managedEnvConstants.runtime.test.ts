import { expect, test } from 'bun:test'
import { isProviderManagedEnvVar, PROVIDER_CONNECTION_ENV_VARS, SAFE_ENV_VARS } from './managedEnvConstants'
import { normalizeRuntimeEnvironment } from './runtimeEnvironment'

test.each(['BEDROCK', 'VERTEX', 'FOUNDRY', 'OPENAI', 'GEMINI', 'GROK'])(
  '%s selection is protected from settings overrides, including legacy inputs',
  provider => {
    const environment = normalizeRuntimeEnvironment({ ['CLAUDE_CODE_USE_' + provider]: '1' })
    expect(Object.keys(environment)).toEqual(['BGS_USE_' + provider])
    expect(isProviderManagedEnvVar(Object.keys(environment)[0]!)).toBe(true)
  },
)

test.each(['BASE_URL', 'API_KEY', 'MODEL', 'DEFAULT_SONNET_MODEL', 'DEFAULT_OPUS_MODEL_NAME'])(
  'Grok %s routing configuration is protected',
  suffix => {
    expect(isProviderManagedEnvVar('GROK_' + suffix)).toBe(true)
  },
)

test('unrelated product switches are not classified as inference routing', () => {
  expect(isProviderManagedEnvVar('BGS_DISABLE_AUTO_MEMORY')).toBe(false)
  expect(isProviderManagedEnvVar('BGS_SUBPROCESS_ENV_SCRUB')).toBe(false)
})

test('host ownership flag is protected under both canonical and legacy names', () => {
  for (const key of ['BGS_PROVIDER_MANAGED_BY_HOST', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST']) {
    expect(isProviderManagedEnvVar(key)).toBe(true)
    expect(SAFE_ENV_VARS.has(key)).toBe(false)
  }
})

test.each(['XAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'AWS_PROFILE'])(
  '%s authentication/account selection is protected from settings overrides',
  key => expect(isProviderManagedEnvVar(key)).toBe(true),
)

test.each([...PROVIDER_CONNECTION_ENV_VARS])('%s connection setting is host protected', key => {
  expect(isProviderManagedEnvVar(key)).toBe(true)
  expect(SAFE_ENV_VARS.has(key.toUpperCase())).toBe(false)
})

test.each(['OPENAI_BASE_URL', 'GROK_BASE_URL', 'GEMINI_BASE_URL',
  'OPENAI_API_KEY', 'GROK_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_FOUNDRY_API_KEY',
])('%s cannot be applied from an untrusted project', key => {
  expect(SAFE_ENV_VARS.has(key)).toBe(false)
})
