import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeRevisionNativeProcess, type RevisionNativeProcessInput, type RevisionNativeProcessError } from '../native-process'

const fixture = fileURLToPath(new URL('./fixture-revision-process.ts', import.meta.url))
const marker = 'caller-only-marker'

function input(mode = 'basic', cwd: string, extra: Partial<RevisionNativeProcessInput> = {}): RevisionNativeProcessInput {
  return {
    configuration: { command: [process.execPath, fixture], env: { BEEGAME_TEST_CASE: mode, BEEGAME_MARKER: marker } },
    cwd,
    scope: 'section',
    prompt: 'repair this document',
    ...extra,
  }
}

async function run(mode = 'basic', extra: Partial<RevisionNativeProcessInput> = {}): Promise<Awaited<ReturnType<typeof executeRevisionNativeProcess>>> {
  const root = await mkdtemp(join(tmpdir(), 'beegame-revision-native-test-'))
  try { return await executeRevisionNativeProcess(input(mode, root, extra)) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function failure(mode: string, extra: Partial<RevisionNativeProcessInput> = {}): Promise<RevisionNativeProcessError> {
  try { await run(mode, extra); throw new Error('expected failure') }
  catch (error) { return error as RevisionNativeProcessError }
}

test('runs an isolated direct child with fixed argv and returns session/completion', async () => {
  const messages: Record<string, unknown>[] = []
  const result = await run('basic', { onMessage: message => { messages.push(message) } })
  expect(result.markdown).toBe('# Revision fixture')
  expect(result.nativeSessionId).toBe('123e4567-e89b-12d3-a456-426614174000')
  expect(result.completion.scope).toBe('direct-child')
  expect(result.completion.stdoutDrained).toBe(true)
  expect(result.completion.termination).toBe('term_requested')
  expect(messages.some(message => message.type === 'result')).toBe(true)
})

test('passes exact native flags and caller environment without inheriting process env', async () => {
  const result = await run('argv-env')
  const report = JSON.parse(result.markdown) as { argv: string[]; marker: string; inheritedPath: boolean }
  expect(report.argv).toEqual(['--print', '--verbose', '--input-format=stream-json', '--output-format=stream-json', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool=stdio', '--tools', ''])
  expect(report.marker).toBe(marker)
  expect(report.inheritedPath).toBe(false)

  const document = await run('argv-env', { scope: 'document' })
  expect((JSON.parse(document.markdown) as { argv: string[] }).argv.at(-1)).toBe('ReadAssignedFoundationRevision')
  expect(document.markdown).not.toContain('json-schema')
})

test('restarts one empty result with the same reported native session', async () => {
  const result = await run('empty-restart')
  expect(result.markdown).toBe('# Revision fixture')
})

test('denies every stdio permission request and lets the native read boundary continue', async () => {
  const seen: Record<string, unknown>[] = []
  const result = await run('permission', { scope: 'document', onMessage: message => { seen.push(message) } })
  expect(result.markdown).toBe('# Revision fixture')
  expect(seen.some(message => message.type === 'control_request')).toBe(true)
})

test('observer receives independent clones and late messages are still awaited after terminal', async () => {
  const seen: Record<string, unknown>[] = []
  const result = await run('late-usage', {
    onMessage: async message => {
      seen.push(message)
      if (message.type === 'result') message.result = 'observer mutation'
    },
  })
  expect(result.markdown).toBe('# Revision fixture')
  expect(seen.some(message => message.type === 'usage')).toBe(true)
})

test('late error for an already accepted ReadAssigned tool is observation-only', async () => {
  const seen: Record<string, unknown>[] = []
  const result = await run('late-tool-error', { scope: 'document', onMessage: message => { seen.push(message) } })
  expect(result.markdown).toBe('# Revision fixture')
  expect(seen.some(message => message.type === 'user')).toBe(true)
})

test('rejects tool errors, forbidden tools, bad JSON, missing terminal, and observer failures safely', async () => {
  expect((await failure('tool-error', { scope: 'document' })).code).toBe('revision_native_tool_failed')
  expect((await failure('tool-error')).code).toBe('revision_native_tool_rejected')
  expect((await failure('bad-json')).code).toBe('revision_native_invalid_json')
  expect((await failure('no-terminal')).code).toBe('revision_native_missing_terminal')
  expect((await failure('assistant', { onMessage: () => { throw new Error('secret observer detail') } })).code).toBe('revision_native_observer_failed')
  const stderrFailure = await failure('stderr-secret', { onMessage: () => { throw new Error('observer') } })
  expect(stderrFailure.code).toBe('revision_native_observer_failed')
  expect(String(stderrFailure)).not.toContain('fixture-secret-stderr')
})

test('abort before spawn is safe, and abort requests TERM then owned-child KILL after grace', async () => {
  const controller = new AbortController()
  controller.abort()
  const pre = await failure('wait', { signal: controller.signal })
  expect(pre.code).toBe('revision_native_aborted')
  expect(pre.completion).toBeUndefined()

  const running = new AbortController()
  const seen: string[] = []
  const promise = failure('wait-ready', { signal: running.signal, onMessage: message => {
    seen.push(String(message.subtype ?? ''))
    if (message.subtype === 'ready') running.abort()
  } })
  const aborted = await promise
  expect(aborted.code).toBe('revision_native_aborted')
  expect(seen).toContain('ready')
  expect(aborted.completion?.stdoutDrained).toBe(true)
  expect(aborted.completion?.termination).toBe('kill_requested')
})

test('a valid terminal result remains successful after the executor requests TERM', async () => {
  const result = await run('basic')
  expect(result.markdown).toBe('# Revision fixture')
  expect(result.completion.exitCode === null || typeof result.completion.exitCode === 'number').toBe(true)
})

test('reports missing terminal safely when the fixture closes stdin and exits', async () => {
  const error = await failure('early-stdin-close')
  expect(error.code).toBe('revision_native_missing_terminal')
  expect(error.completion?.stdoutDrained).toBe(true)
})

test('keeps transport framing above the legacy body cap while rejecting an oversized Markdown body', async () => {
  const valid = await run('large-valid')
  expect(valid.markdown.length).toBeGreaterThan(2 * 1024 * 1024 - 200)
  expect((await failure('large-invalid')).code).toBe('revision_native_markdown_invalid')
})

test('rejects unsafe input without evaluating accessors or cycles, and reports spawn failures safely', async () => {
  let reads = 0
  const getter = { get configuration() { reads += 1; return {} } }
  await expect(executeRevisionNativeProcess(getter)).rejects.toMatchObject({ code: 'revision_native_invalid_input' })
  expect(reads).toBe(0)
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  await expect(executeRevisionNativeProcess({ configuration: { command: ['/bin/true'], env: cycle }, cwd: process.cwd(), scope: 'section', prompt: '' })).rejects.toMatchObject({ code: 'revision_native_invalid_input' })
  const missing = await failure('basic', { configuration: { command: ['/definitely/not-a-real-revision-executable'], env: {} } })
  expect(missing.code).toBe('revision_native_spawn_failed')
  expect(missing.completion?.scope).toBe('direct-child')
})
