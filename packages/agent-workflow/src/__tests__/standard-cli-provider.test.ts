import { expect, test } from 'bun:test'
import { standardCliArtifactEnvironment, standardCliProvider } from '../standard-cli-provider'
import { createNativeTaskAccess } from '../native-task-access'
import { mkdtemp, realpath, rm } from 'node:fs/promises'

test.each(['anthropic', 'openai', 'gemini', 'grok'] as const)('selected %s uses public CLI settings, not native BGS env', type => {
  const original = { BEEGAME_MODEL_TYPE: type, BGS_USE_OPENAI: '1', BGS_USE_BEDROCK: '1', ANTHROPIC_AUTH_TOKEN: 'fixture' }
  const selection = standardCliProvider(original)
  expect(selection.modelType).toBe(type)
  expect(selection.environment.BEEGAME_MODEL_TYPE).toBeUndefined()
  expect(selection.environment.BGS_USE_OPENAI).toBe('0')
  expect(selection.environment.BGS_USE_BEDROCK).toBe('0')
  expect(selection.environment.ANTHROPIC_AUTH_TOKEN).toBe('fixture')
  expect(original.BGS_USE_OPENAI).toBe('1')
})

test('without explicit host selection, existing native provider flags remain authoritative', () => {
  expect(standardCliProvider({ BGS_USE_VERTEX: '1' })).toEqual({ modelType: undefined, environment: { BGS_USE_VERTEX: '1' } })
  expect(() => standardCliProvider({ BEEGAME_MODEL_TYPE: 'unknown' })).toThrow('Invalid BGS selected provider')
})

test('artifact translation preserves the configured target without supplying defaults or leaking private keys', () => {
  expect(standardCliArtifactEnvironment({})).toEqual({})
  expect(standardCliProvider({ BEEGAME_ARTIFACTS_URL: 'https://selected.test', BEEGAME_ARTIFACTS_TOKEN: 'fixture-token', CLAUDE_ARTIFACTS_URL: 'https://stale.test' }).environment)
    .toEqual({ CLAUDE_ARTIFACTS_URL: 'https://selected.test', CLAUDE_ARTIFACTS_TOKEN: 'fixture-token' })
  expect(standardCliArtifactEnvironment({ CLAUDE_ARTIFACTS_URL: 'https://public.test' })).toEqual({ CLAUDE_ARTIFACTS_URL: 'https://public.test' })
})

test('isolated task settings retain the selected provider and permission boundary together', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/native-provider-task-'))
  try {
    const access = await createNativeTaskAccess({ workspacePath: root, modelType: 'gemini' })
    const settings = JSON.parse(access.flags[access.flags.indexOf('--settings') + 1]!)
    expect(settings.modelType).toBe('gemini')
    expect(settings.sandbox.filesystem.denyRead).toEqual(['/'])
    expect(settings.permissions.ask).toContain('Write')
    expect(access.environment).not.toHaveProperty('BEEGAME_MODEL_TYPE')
  } finally { await rm(root, { recursive: true, force: true }) }
})
