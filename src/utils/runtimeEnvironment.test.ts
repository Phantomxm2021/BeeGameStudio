import { expect, test } from 'bun:test'
import { normalizeRuntimeEnvironment, RUNTIME_ENV_ALIASES } from './runtimeEnvironment'
import { subprocessEnv } from './subprocessEnv'

test.each(Object.entries(RUNTIME_ENV_ALIASES))('normalizes %s to %s without changing its value', (legacy, product) => {
  const original = { [legacy]: 'fixture-value', UNRELATED: 'keep' }
  const result = normalizeRuntimeEnvironment(original)
  expect(result[product]).toBe('fixture-value')
  expect(result).not.toHaveProperty(legacy)
  expect(result.UNRELATED).toBe('keep')
  expect(original[legacy]).toBe('fixture-value')
  expect(normalizeRuntimeEnvironment(result)).toEqual(result)
})

test.each(['0', ''])('explicit product value %j wins over legacy enabled values', value => {
  for (const [legacy, product] of Object.entries(RUNTIME_ENV_ALIASES)) {
    const result = normalizeRuntimeEnvironment({ [legacy]: '1', [product]: value })
    expect(result[product]).toBe(value)
    expect(result).not.toHaveProperty(legacy)
  }
})

test('does not rename credentials, endpoints, OAuth or externally identified models', () => {
  const external = {
    ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_AUTH_TOKEN: 'fixture-token',
    ANTHROPIC_BASE_URL: 'https://provider.example', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-oauth',
    BGS_DEFAULT_STRONG_MODEL: 'claude-opus-4-6',
  }
  expect(normalizeRuntimeEnvironment(external)).toEqual(external)
})

test('Bun proxy properties survive the child environment snapshot without leaking into explicit environments', () => {
  const keys = ['HTTPS_PROXY', 'NO_PROXY'] as const
  const before = keys.map(key => process.env[key])
  try {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
    process.env.NO_PROXY = 'localhost'
    expect(normalizeRuntimeEnvironment(process.env).HTTPS_PROXY).toBe('http://127.0.0.1:9')
    expect(subprocessEnv().NO_PROXY).toBe('localhost')
    expect(subprocessEnv({ HTTPS_PROXY: '' }).HTTPS_PROXY).toBe('')
    expect(normalizeRuntimeEnvironment({})).toEqual({})
  } finally {
    keys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key]
      else process.env[key] = before[index]
    })
  }
})

test('legacy subprocess isolation flag still removes parent-only credentials', () => {
  const keys = ['BGS_SUBPROCESS_ENV_SCRUB', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'ANTHROPIC_API_KEY'] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    delete process.env.BGS_SUBPROCESS_ENV_SCRUB
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
    process.env.ANTHROPIC_API_KEY = 'fixture-key'
    const child = subprocessEnv()
    expect(child.BGS_SUBPROCESS_ENV_SCRUB).toBe('1')
    expect(child.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined()
    expect(child.ANTHROPIC_API_KEY).toBeUndefined()
    expect(process.env.ANTHROPIC_API_KEY).toBe('fixture-key')
    const overridden = subprocessEnv({ BGS_SUBPROCESS_ENV_SCRUB: '0', ANTHROPIC_API_KEY: 'override-key' })
    expect(overridden.ANTHROPIC_API_KEY).toBeUndefined()
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})
