import { expect, test } from 'bun:test'
import { nativeFileAgentEnvironment } from '../native-file-agent'
import { nativeTaskToolEnvironment } from '../native-task-access'

test('tool caches override inherited host cache paths in both npm spellings', () => {
  const env = Object.assign({ NPM_CONFIG_CACHE: '/host/private', npm_config_cache: '/host/private' },
    nativeTaskToolEnvironment('/task/tmp'))
  expect(env.NPM_CONFIG_CACHE).toBe('/task/tmp/npm-cache')
  expect(env.npm_config_cache).toBe(env.NPM_CONFIG_CACHE)
  expect(env.TMPDIR).toBe('/task/tmp')
  expect(env.BUN_INSTALL_CACHE_DIR).toBe('/task/tmp/bun-cache')
  expect(env.BUN_RUNTIME_TRANSPILER_CACHE_PATH).toBe('/task/tmp/bun-transpiler-cache')
})

test('platform NODE_ENV does not change dependency installation in file-agent tasks', () => {
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    expect(nativeFileAgentEnvironment({ NODE_ENV: 'production' }).NODE_ENV).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
})

test('isolated file agents receive the selected Skill Search setting', () => {
  expect(nativeFileAgentEnvironment({ SKILL_SEARCH_ENABLED: '1' }).SKILL_SEARCH_ENABLED).toBe('1')
  expect(nativeFileAgentEnvironment({ BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: '/app/builtinskills' })
    .BEEGAME_NATIVE_BUILTIN_SKILLS_DIR).toBe('/app/builtinskills')
})
