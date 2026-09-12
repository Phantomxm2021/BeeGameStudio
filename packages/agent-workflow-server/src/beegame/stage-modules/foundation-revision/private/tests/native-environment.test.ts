import { expect, test } from 'bun:test'
import { buildRevisionNativeEnvironment } from '../native-environment'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
const boundary = () => ({ workspacePath: '/tmp/revision-authority', writablePaths: [...CANONICAL_FOUNDATION_DOCUMENTS] })
test('forwards allowed model configuration without exposing obsolete bridge authority or arbitrary environment', () => {
  const env = buildRevisionNativeEnvironment({ OPENAI_API_KEY: 'fixture-secret', OPENAI_BASE_URL: 'https://example.test',
    NODE_OPTIONS: 'unsafe', HOME: '/configured', UNRELATED_SECRET: 'private', BEEGAME_REVISION_CONTRACT: '{}',
    BEEGAME_WORKSPACE_PATH: '/foreign', BEEGAME_WORKFLOW_WORKER_TYPE: 'old-worker' }, boundary())
  expect(env.OPENAI_API_KEY).toBe('fixture-secret')
  expect(env.OPENAI_BASE_URL).toBe('https://example.test')
  expect<unknown>(env.HOME).toBe(process.env.HOME)
  for (const key of ['NODE_OPTIONS', 'UNRELATED_SECRET', 'BEEGAME_REVISION_CONTRACT', 'BEEGAME_WORKSPACE_PATH', 'BEEGAME_WORKFLOW_WORKER_TYPE'])
    expect(env).not.toHaveProperty(key)
})
test('file boundary requires all eight distinct paths and rejects hostile input', () => {
  for (const invalid of [{ ...boundary(), workspacePath: 'relative' }, { ...boundary(), writablePaths: [] },
    { ...boundary(), writablePaths: Array(8).fill('docs/GDD.md') }, { ...boundary(), extra: true },
    { BEEGAME_WORKSPACE_PATH: '/tmp/legacy' }])
    expect(() => buildRevisionNativeEnvironment({}, invalid)).toThrow()
  let reads = 0
  expect(() => buildRevisionNativeEnvironment({ get OPENAI_API_KEY() { reads++; return 'secret' } }, boundary())).toThrow()
  expect(reads).toBe(0)
})
