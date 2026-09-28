import { expect, test } from 'bun:test'
import { subprocessEnv } from './subprocessEnv.js'

test('scrubs provider and BGS service credentials from tool subprocesses', () => {
  const keys = [
    'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'BEEGAME_ARTIFACTS_TOKEN',
    'TAVILY_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'EXA_API_KEY',
    'BEEGAME_TEST_NON_SECRET',
  ] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) process.env[key] = `fixture-${key}`
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
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
