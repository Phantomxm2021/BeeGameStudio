import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildRevisionNativeEnvironment } from '../native-environment'

const section = { BEEGAME_WORKFLOW_WORKER_TYPE: 'foundation-document-reviser' }
function document() {
  return { ...section, BEEGAME_WORKSPACE_PATH: '/tmp/revision-authority', BEEGAME_REVISION_STAGED_PATH: '/tmp/revision-authority/assigned.md',
    BEEGAME_REVISION_CONTRACT: JSON.stringify({ taskId: randomUUID(), revision: 'a'.repeat(64), round: 1, scope: 'document',
      documentPath: 'docs/GDD.md', issueIds: ['issue'], sectionIds: [], stagedPath: 'assigned.md', baseDocumentDigest: 'b'.repeat(64) }) }
}

test('model forwarding matches the old whitelist while assignment owns all bridge keys', async () => {
  const source = await readFile(resolve(import.meta.dir, '../../../../session-manager.ts'), 'utf8')
  const literal = source.match(/const RUNTIME_MODEL_ENV_KEYS = new Set\(\[([\s\S]*?)\]\)/)![1]!
  const keys = [...literal.matchAll(/'([^']+)'/g)].map(match => match[1]!)
  const selected = Object.fromEntries([...keys, 'NODE_OPTIONS', 'UNRELATED_SECRET', 'BEEGAME_MODEL', 'HOME'].map(key => [key, 'configured-value']))
  const env = buildRevisionNativeEnvironment(selected, section)
  for (const key of keys.filter(key => !['BEEGAME_WORKFLOW_WORKER_TYPE', 'BEEGAME_REVISION_CONTRACT', 'BEEGAME_WORKSPACE_PATH', 'BEEGAME_REVISION_STAGED_PATH'].includes(key)))
    expect(env[key]).toBe('configured-value')
  expect(env.BEEGAME_WORKFLOW_WORKER_TYPE).toBe('foundation-document-reviser')
  for (const key of ['BEEGAME_REVISION_CONTRACT', 'BEEGAME_WORKSPACE_PATH', 'BEEGAME_REVISION_STAGED_PATH', 'NODE_OPTIONS', 'UNRELATED_SECRET', 'BEEGAME_MODEL']) expect(env).not.toHaveProperty(key)
  expect<unknown>(env.HOME).toBe(process.env.HOME)
})

test('strict document bridge cannot be overridden by configured environment or leak references', () => {
  const bridge = document()
  const env = buildRevisionNativeEnvironment({ OPENAI_API_KEY: 'fixture-secret', ...document() }, bridge)
  expect(env.BEEGAME_REVISION_CONTRACT).toBe(bridge.BEEGAME_REVISION_CONTRACT)
  bridge.BEEGAME_WORKSPACE_PATH = 'changed'
  expect(env.BEEGAME_WORKSPACE_PATH).toBe('/tmp/revision-authority')
  for (const invalid of [{ ...section, extra: 'value' }, { ...section, BEEGAME_WORKSPACE_PATH: '/tmp' },
    { ...document(), BEEGAME_REVISION_STAGED_PATH: '/outside/assigned.md' }, { ...document(), BEEGAME_REVISION_CONTRACT: '{}' }])
    expect(() => buildRevisionNativeEnvironment({}, invalid)).toThrow()
  let reads = 0
  expect(() => buildRevisionNativeEnvironment({ get OPENAI_API_KEY() { reads++; return 'secret' } }, section)).toThrow('accessors')
  expect(reads).toBe(0)
})
