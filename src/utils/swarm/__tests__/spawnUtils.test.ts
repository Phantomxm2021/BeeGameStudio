import { describe, expect, test } from 'bun:test'
import { buildInheritedCliFlags, buildInheritedEnvVars, getInheritedEnvVarAssignments, getInheritedProviderEnvironment } from '../spawnUtils'
import { RUNTIME_ENV_ALIASES } from '../../runtimeEnvironment'

test('independent panes forward product switches and model slots, with legacy aliases normalized', () => {
  const keys = [...Object.keys(RUNTIME_ENV_ALIASES), ...Object.values(RUNTIME_ENV_ALIASES), 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
  const previous = new Map(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    for (const [legacy, product] of Object.entries(RUNTIME_ENV_ALIASES)) {
      process.env[legacy] = 'fixture'
      const assignments = { ...Object.fromEntries(getInheritedEnvVarAssignments()), ...getInheritedProviderEnvironment() }
      expect(assignments[product]).toBe('fixture')
      expect(assignments[legacy]).toBeUndefined()
      delete process.env[legacy]
    }
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.BGS_USE_GEMINI = '0'
    process.env.ANTHROPIC_API_KEY = 'private-fixture'
    process.env.OPENAI_API_KEY = 'private-fixture'
    const assignments = Object.fromEntries(getInheritedEnvVarAssignments())
    expect(getInheritedProviderEnvironment().BGS_USE_GEMINI).toBe('0')
    expect(assignments.BGS_USE_GEMINI).toBeUndefined()
    expect(assignments.ANTHROPIC_API_KEY).toBeUndefined()
    expect(assignments.OPENAI_API_KEY).toBeUndefined()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('explicit empty values survive both public and private pane handoff', () => {
  const keys = ['BGS_SIMPLE', 'BGS_USE_OPENAI', 'OPENAI_BASE_URL', 'OPENAI_DEFAULT_SONNET_MODEL'] as const
  const before = new Map(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) process.env[key] = ''
    const publicValues = Object.fromEntries(getInheritedEnvVarAssignments())
    expect(publicValues.BGS_SIMPLE).toBe('')
    const privateValues = getInheritedProviderEnvironment()
    for (const key of keys.slice(1)) expect(privateValues[key]).toBe('')
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

describe('buildInheritedCliFlags', () => {
  test('propagates auto permission mode to process-based teammates', () => {
    const flags = buildInheritedCliFlags({ permissionMode: 'auto' })

    expect(flags).toContain('--permission-mode auto')
  })
})

test('proxy credentials and SDK account selectors are inherited only through the private environment', () => {
  const fixtures = {
    HTTPS_PROXY: 'http://fixture-user:fixture-password@proxy.invalid:8080',
    https_proxy: '',
    HTTP_PROXY: 'http://fixture-proxy.invalid',
    http_proxy: '',
    NO_PROXY: 'fixture.invalid',
    no_proxy: '',
    XAI_API_KEY: 'fixture-xai-secret',
    OPENAI_ORG_ID: 'fixture-org',
    OPENAI_PROJECT_ID: 'fixture-project',
    AWS_PROFILE: 'fixture-profile',
  }
  const previous = new Map(Object.keys(fixtures).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, fixtures)
    expect(getInheritedProviderEnvironment()).toMatchObject(fixtures)
    const publicValues = Object.fromEntries(getInheritedEnvVarAssignments())
    for (const key of Object.keys(fixtures)) expect(publicValues[key]).toBeUndefined()
    expect(buildInheritedEnvVars()).not.toContain('fixture-password')
    expect(buildInheritedEnvVars()).not.toContain('fixture-xai-secret')
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
