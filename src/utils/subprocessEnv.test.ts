import { expect, test } from 'bun:test'
import { subprocessEnv } from './subprocessEnv.js'

test('legacy overrides replace canonical parent values, while canonical values win within the override source', () => {
  const keys = ['BGS_SIMPLE', 'CLAUDE_CODE_SIMPLE', 'BGS_SUBPROCESS_ENV_SCRUB', 'ANTHROPIC_AUTH_TOKEN'] as const
  const before = new Map(keys.map(key => [key, process.env[key]]))
  try {
    delete process.env.CLAUDE_CODE_SIMPLE
    process.env.BGS_SIMPLE = '1'
    process.env.BGS_SUBPROCESS_ENV_SCRUB = '1'
    process.env.ANTHROPIC_AUTH_TOKEN = 'private-fixture'
    expect(subprocessEnv({ CLAUDE_CODE_SIMPLE: '0' }).BGS_SIMPLE).toBe('0')
    expect(subprocessEnv({ CLAUDE_CODE_SIMPLE: '' }).BGS_SIMPLE).toBe('')
    expect(subprocessEnv({ CLAUDE_CODE_SIMPLE: '0', BGS_SIMPLE: '1' }).BGS_SIMPLE).toBe('1')
    const attempted = subprocessEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0', ANTHROPIC_AUTH_TOKEN: 'override-secret' })
    expect(attempted.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(process.env.BGS_SIMPLE).toBe('1')
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('scrubs provider and BGS service credentials from tool subprocesses', () => {
  const keys = [
    'BGS_SUBPROCESS_ENV_SCRUB',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'XAI_API_KEY',
    'CLAUDE_ARTIFACTS_TOKEN',
    'TAVILY_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'EXA_API_KEY',
    'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
    'CLAUDE_LOCAL_VAULT_PASSPHRASE',
    'CLAUDE_TRUSTED_DEVICE_TOKEN',
    'LANGFUSE_SECRET_KEY',
    'DATADOG_API_KEY',
    'MCP_CLIENT_SECRET',
    'BRAVE_API_KEY',
    'BEEGAME_TEST_NON_SECRET',
  ] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) process.env[key] = `fixture-${key}`
    process.env.BGS_SUBPROCESS_ENV_SCRUB = '1'
    const child = subprocessEnv()
    for (const key of keys.slice(1, -1)) expect(child[key]).toBeUndefined()
    expect(child.BEEGAME_TEST_NON_SECRET).toBe('fixture-BEEGAME_TEST_NON_SECRET')
    const overridden = subprocessEnv({ ANTHROPIC_AUTH_TOKEN: 'override-secret', BEEGAME_TEST_NON_SECRET: 'override' })
    expect(overridden.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(overridden.BEEGAME_TEST_NON_SECRET).toBe('override')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('fixture-ANTHROPIC_AUTH_TOKEN')
  } finally {
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
