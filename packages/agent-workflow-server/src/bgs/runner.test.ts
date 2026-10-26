import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { createBgsRunner, bgsUsage, bgsProviderConfig, editProtectedFileText, bgsApplicationContext } from './runner'
import { BeeGameSessionManager, getLatestRuntimeUsage, type BeeGameEvent, type DashboardPermissionRequest } from '../beegame/session-manager'
import { appendChatTranscript } from '../beegame/project-records'
import * as browserCleanup from '../beegame/native-test-browser-cleanup'
import type { BgsClient } from './client'

const resolveOutboundTarget: typeof import('@bee-game-studio/security-core').resolveApprovedOutboundTarget = async (value) => ({ url: new URL(value), addresses: ['93.184.216.34'],
  lookup: (_host, _options, callback) => callback(null, '93.184.216.34', 4) })
const command = [process.execPath, fileURLToPath(new URL('./fixtures/app-server.ts', import.meta.url))]

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error('Fixture condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('application context preserves complete UTF-8 values within native field limits and ordering', () => {
  expect(bgsApplicationContext('fixture')).toEqual({})
  for (const value of ['', 'a'.repeat(3999), 'a'.repeat(4000), 'a'.repeat(4001),
    'a'.repeat(3999) + '中🎮' + 'b'.repeat(4000),
    ('编辑器契约 🎮\n' + '中'.repeat(1800) + '\r\n').repeat(12)]) {
    const entries = Object.entries(bgsApplicationContext('fixture', value)).sort(([a], [b]) => a.localeCompare(b))
    expect(entries.map(([, part]) => part.value).join('')).toBe(value)
    for (const [, part] of entries) {
      expect(Buffer.byteLength(part.value)).toBeLessThanOrEqual(4000)
      expect(part.kind).toBe('application')
    }
  }
  expect(bgsApplicationContext('fixture', 'short')).toEqual({ fixture: { value: 'short', kind: 'application' } })
})

test('game Agent startup rejects a missing or empty catalog before starting native processes', async () => {
  const root = await mkdtemp('/private/tmp/bgs-missing-skills-')
  const workspace = join(root, 'game'), catalog = join(root, 'game-skills')
  await mkdir(workspace)
  try {
    for (const empty of [false, true]) {
      if (empty) await mkdir(catalog)
      await expect(createBgsRunner({ command: ['/must-not-start-bgs'], resolveOutboundTarget }).start({
        sessionId: 'missing-skills', cwd: workspace,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: catalog },
      })).rejects.toThrow(`BeeGameStudio built-in Skills are unavailable: ${catalog}`)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function fixture(permission: 'allow' | 'deny' = 'allow', env: Record<string, string> = {}, network = resolveOutboundTarget, resumeSessionId?: string,
  nativeGoal?: import('../beegame/session-manager').BeeGameNativeGoalInput, nativeRecovery = false,
  permissionHandler?: (request: DashboardPermissionRequest) => Promise<import('../beegame/session-manager').DashboardPermissionDecision>,
  workflow?: import('../beegame/session-manager').BeeGameHostToolCapability,
  hostTools: Pick<import('../beegame/session-manager').BeeGameTurnTools, 'measurement'|'finishDelivery'> = {}) {
  const root = await mkdtemp('/private/tmp/bgs-bgs-runner-'), workspace = join(root, 'game')
  const childPidFile = join(root, 'owned-child.pid')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  const events: Record<string, any>[] = [], usage: BeeGameEvent[] = [], questions: unknown[] = []
  let sessionId = ''
  const runtime = await createBgsRunner({ command, resolveOutboundTarget: network }).start({ sessionId: 'fixture', cwd: workspace,
    env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', BGS_FIXTURE_RPC_TRACE: join(root, 'rpc.jsonl'),
      ...(env.BGS_FIXTURE_NATIVE_GOAL_FINALIZE === '1' ? { BGS_FIXTURE_NATIVE_GOAL_CHILD_PID_FILE: childPidFile } : {}), ...env },
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(nativeGoal ? { nativeGoal } : {}),
    ...(nativeRecovery ? { nativeRecovery } : {}),
    workflow, ...hostTools,
    onNativeSessionId: id => { sessionId = id },
    onNativeUsage: (value, epoch, accounting) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
      payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value,
        ...(accounting?.baselineOnly ? { usageBaselineOnly: true } : {}),
        ...(accounting?.replayed ? { usageReplayed: true } : {}),
        ...(accounting?.nativeTurnId ? { nativeTurnId: accounting.nativeTurnId } : {}) } }),
    requestPermission: async request => {
      questions.push(request)
      if (permissionHandler) return permissionHandler(request)
      return { behavior: permission, source: 'policy', ...(permission === 'deny' ? { message: 'Fixture policy denied the operation' } : {}), updatedInput: { ...request.input, answers: { 'Choose style': 'A' } } }
    },
  })
  const submit = (prompt: Parameters<typeof runtime.submit>[0]['prompt'], signal = new AbortController().signal,
    submitNativeGoal?: import('../beegame/session-manager').BeeGameNativeGoalInput) => runtime.submit({ prompt, signal, ...hostTools,
    ...(submitNativeGoal ? { nativeGoal: submitNativeGoal } : {}),
    onMessage: message => { events.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
  return { root, workspace, childPidFile, runtime, events, usage, questions, sessionId, submit,
    async close() { await runtime.dispose?.(); await rm(root, { recursive: true, force: true }) } }
}

test('streams text once, preserves tool lifecycle, and counts cached tokens once', async () => {
  const f = await fixture()
  try {
    await f.submit('hello')
    expect(f.events.filter(e => e.eventType.startsWith('assistant.')).map(e => e.text).join('')).toBe('Hello Bgs')
    expect(f.events.filter(e => e.eventType.startsWith('tool.')).map(e => e.eventType)).toEqual(['tool.started', 'tool.completed'])
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({ exitCode: 0, durationMs: 1200 })
    expect(f.events.filter(e => e.eventType.startsWith('tool.')).every(e => !('cwd' in e.input))).toBe(true)
    expect(getLatestRuntimeUsage(f.usage)).toEqual({ prompt_tokens: 80, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 0, total_tokens: 130 })
    expect(f.sessionId).toBe('019a0000-0000-7000-8000-000000000001')
  } finally { await f.close() }
}, 30_000)

test('native Goal injects the current assignment before activation and owns continuation boundaries', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined,
    { mode: 'start', objective: 'Finish the native fixture Goal' })
  try {
    await f.submit('native assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal')
      .map(event => event.nativeGoal?.status)).toEqual(['active', 'complete'])
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_started')).toHaveLength(1)
    expect(f.events.find(event => event.eventType === 'assistant.message')?.text).toBe('Native Goal: native assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_completed')).toHaveLength(1)
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('host-controlled native Goal completion closes the turn without another model turn and cleans owned children', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', {
    OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_FINALIZE: '1',
  }, resolveOutboundTarget, undefined, { mode: 'start', objective: 'Finalize the delivery' })
  let submit: Promise<void> | undefined
  let childPid = 0
  try {
    submit = f.submit('delivery submission')
    await waitUntil(() => f.events.some(event => event.eventType === 'tool.started' && event.toolUseID === 'submission-command'))
    childPid = Number(await readFile(f.childPidFile, 'utf8'))
    expect(childPid).toBeGreaterThan(0)
    expect(() => process.kill(childPid, 0)).not.toThrow()

    await (f.runtime as unknown as { completeGoal(): Promise<void> }).completeGoal()
    await submit
    await waitUntil(() => {
      try { process.kill(childPid, 0); return false } catch { return true }
    })

    expect(f.events.filter(event => event.eventType === 'assistant.message')).toHaveLength(0)
    expect(f.events.filter(event => event.eventType?.startsWith('tool.')).map(event => event.eventType))
      .toEqual(['tool.started', 'tool.completed'])
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_started')).toHaveLength(1)
    expect(f.events.findLast(event => event.eventType === 'system.status' && event.subtype === 'native_goal')?.nativeGoal?.status).toBe('complete')
    expect(getLatestRuntimeUsage(f.usage)).toMatchObject({ total_tokens: 130 })
  } finally {
    await submit?.catch(() => {})
    await f.close()
    cleanup.mockRestore()
    if (childPid) { try { process.kill(childPid, 'SIGKILL') } catch {} }
  }
}, 30_000)

test('host-controlled completion publishes the goal/set response when no Goal update notification follows', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', {
    OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_FINALIZE: '1',
    BGS_FIXTURE_NATIVE_GOAL_FINALIZE_NO_UPDATED: '1',
  }, resolveOutboundTarget, undefined, { mode: 'start', objective: 'Finalize without a Goal update notification' })
  let submit: Promise<void> | undefined
  let childPid = 0
  try {
    submit = f.submit('delivery submission without update')
    await waitUntil(() => f.events.some(event => event.eventType === 'tool.started' && event.toolUseID === 'submission-command'))
    childPid = Number(await readFile(f.childPidFile, 'utf8'))
    expect(childPid).toBeGreaterThan(0)
    await (f.runtime as unknown as { completeGoal(): Promise<void> }).completeGoal()
    await submit
    await waitUntil(() => {
      try { process.kill(childPid, 0); return false } catch { return true }
    })

    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal')
      .map(event => event.nativeGoal?.status)).toEqual(['active', 'complete'])
    expect(f.events.filter(event => event.eventType === 'assistant.message')).toHaveLength(0)
    expect(getLatestRuntimeUsage(f.usage)).toMatchObject({ total_tokens: 130 })
  } finally {
    await submit?.catch(() => {})
    await f.close()
    cleanup.mockRestore()
    if (childPid) { try { process.kill(childPid, 'SIGKILL') } catch {} }
  }
}, 30_000)

test('native Goal keeps one outer turn across multiple native continuations', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_TURNS: '2' }, resolveOutboundTarget, undefined,
    { mode: 'start', objective: 'Run two native continuations' })
  try {
    await f.submit('two-turn assignment')
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_started')).toHaveLength(2)
    expect(f.events.filter(event => event.eventType === 'system.status' && event.subtype === 'native_goal_turn_completed')).toHaveLength(2)
    expect(f.events.filter(event => event.eventType === 'assistant.message').map(event => event.text)).toEqual([
      'Native Goal: two-turn assignment', 'Native Goal: two-turn assignment',
    ])
    expect(f.events.findLast(event => event.eventType === 'system.status' && event.subtype === 'native_goal')?.nativeGoal?.status).toBe('complete')
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('native Goal tool requests wait for ordered turn admission when a prior host event is slow', async () => {
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const f = await fixture('allow', {
    OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_WRITE: '1',
  }, resolveOutboundTarget, undefined, { mode: 'start', objective: 'Write the protected design record' })
  try {
    await f.runtime.submit({
      prompt: 'delayed native write', signal: AbortSignal.timeout(30_000),
      onMessage: async message => {
        f.events.push(message)
        if (message.eventType === 'system.status' && message.subtype === 'native_goal' &&
          (message.nativeGoal as { status?: unknown } | undefined)?.status === 'active')
          await new Promise(resolve => setTimeout(resolve, 50))
      },
      requestPermission: async () => ({ behavior: 'allow', source: 'policy' }),
    })
    expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('Native Goal protected write')
    expect(f.events.some(event => event.subtype === 'native_goal_turn_started')).toBe(true)
  } finally { await f.close(); cleanup.mockRestore() }
}, 30_000)

test('changed requirements cannot run with an obsolete native instruction baseline', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' })
  try {
    await expect(f.runtime.submit({ prompt: 'Changed goal', confirmedBriefContext: 'new confirmed goal',
      signal: new AbortController().signal, onMessage() {}, requestPermission: async () => ({ behavior: 'deny' }),
    })).rejects.toThrow('Confirmed requirements changed after BGS runtime preparation')
    expect(f.events).toHaveLength(0)
    expect(f.usage).toHaveLength(0)
  } finally { await f.close() }
}, 30_000)

test('converted providers retain native counters as baselines without counting their usage twice', async () => {
  const f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'chat-completions' })
  try {
    await f.submit('hello')
    expect(f.usage.length).toBeGreaterThan(0)
    expect(f.usage.every(event => event.payload?.usageBaselineOnly === true)).toBe(true)
    expect(f.usage.at(-1)?.payload?.usage).toMatchObject({ total_tokens: 130 })
    // This stdio fixture makes no provider request; only a native notification.
    expect(getLatestRuntimeUsage(f.usage).total_tokens).toBe(0)
  } finally { await f.close() }
}, 30_000)

test('resume token usage is marked as replay while the following live turn is not', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_REPLAY_RESUME_USAGE: '1' }, resolveOutboundTarget,
    '019a0000-0000-7000-8000-000000000001')
  try {
    const replayed = f.usage.filter(event => event.payload?.usageReplayed === true)
    expect(replayed.length).toBeGreaterThan(0)
    expect(replayed.every(event => event.payload?.nativeAccountingEpoch === 'bgs:019a0000-0000-7000-8000-000000000001')).toBe(true)
    expect(replayed.every(event => event.payload?.nativeTurnId === 'historical-turn')).toBe(true)

    await f.submit('hello')
    const live = f.usage.filter(event => event.payload?.usageReplayed !== true)
    expect(live.length).toBeGreaterThan(0)
    expect(live.every(event => event.payload?.usageReplayed !== true)).toBe(true)
    expect(live.every(event => event.payload?.nativeTurnId === 'turn-1')).toBe(true)
  } finally { await f.close() }
}, 30_000)

test('native compaction start and completion use the existing Chat projection contract', async () => {
  // This stdio fixture starts no browser. Keep OS process enumeration outside
  // this event-contract test; browser ownership/cleanup has its own regressions.
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  try {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' })
    try {
      await f.submit('compaction')
      expect(f.events.filter(event => event.eventType === 'system.status')).toEqual(expect.arrayContaining([
        expect.objectContaining({ subtype: 'status', status: 'compacting' }),
        expect.objectContaining({ subtype: 'compact_boundary', status: 'compacted' }),
      ]))
    } finally { await f.close() }
  } finally { cleanup.mockRestore() }
}, 10_000)

test('a nonzero native command exit is a failed tool receipt even when the item status is completed', async () => {
  const f = await fixture()
  try {
    await f.submit('command-fail')
    expect(f.events.find(e => e.eventType === 'tool.failed')).toMatchObject({ toolUseID: 'shell-1', exitCode: 2, durationMs: 1200, is_error: true })
    expect(f.events.some(e => e.eventType === 'tool.completed')).toBe(false)
  } finally { await f.close() }
}, 30_000)

test('native file change receipts retain the actual diff in a structured field', async () => {
  const f = await fixture()
  try {
    await f.submit('file-diff')
    expect(f.events.find(e => e.eventType === 'tool.completed')).toMatchObject({
      toolUseID: 'edit-1:0', toolName: 'Edit', input: { file_path: 'src/Example.ts' },
      diff: '@@ -11 +11 @@\n-old\n+new\n', output: '@@ -11 +11 @@\n-old\n+new\n',
    })
  } finally { await f.close() }
}, 30_000)

test('native command lifecycle retains cwd through progress and a completion that omits it', async () => {
  const f = await fixture()
  try {
    await f.submit('command-progress')
    const progress = f.events.filter(e => e.eventType === 'tool.progress')
    expect(progress.map(e => e.text)).toEqual(['Bu', 'ilt'])
    expect(progress.map(e => e.output)).toEqual(['Bu', 'ilt'])
    expect(f.events.find(e => e.eventType === 'tool.completed')?.output).toBe('Built')
    const tools = f.events.filter(e => e.eventType.startsWith('tool.'))
    expect(tools.map(e => e.eventType)).toEqual(['tool.started', 'tool.progress', 'tool.progress', 'tool.completed'])
    expect(tools.map(e => e.input)).toEqual(Array(4).fill({ command: 'bun run build', cwd: join(f.workspace, 'command-workdir') }))
  } finally { await f.close() }
}, 30_000)

test('failed command receipts retain the native nonexistent cwd and error', async () => {
  const f = await fixture()
  try {
    await f.submit('command-missing-cwd')
    expect(f.events.find(e => e.eventType === 'tool.failed')).toMatchObject({
      toolUseID: 'missing-cwd', toolName: 'Shell', is_error: true,
      input: { command: 'bun run build', cwd: join(f.workspace, 'missing-workdir') },
      output: 'No such file or directory (os error 2)',
    })
    expect(f.events.some(e => e.eventType === 'tool.completed')).toBe(false)
  } finally { await f.close() }
}, 30_000)

test('protected file writes use the live BGS authority', async () => {
  for (const permission of ['allow', 'deny'] as const) {
    const f = await fixture(permission)
    try {
      await f.submit('write-design')
      if (permission === 'allow') expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('Authorized design')
      else expect(await Bun.file(join(f.workspace, 'docs/GDD.md')).exists()).toBe(false)
      expect(f.questions.length).toBeGreaterThan(0)
    } finally { await f.close() }
  }
}, 30_000)

test('protected-file tool cannot write outside the game', async () => {
  const f = await fixture()
  try { await f.submit('write-outside'); expect(await Bun.file(join(f.root, 'outside.md')).exists()).toBe(false); expect(f.questions).toHaveLength(0) }
  finally { await f.close() }
}, 30_000)

test.each(['../outside.md', 'absolute-sibling', 'docs/GDD.mdd', 'src/example.js', 'docs/README.md'])(
  'protected-file path diagnostics reject without authorizing writes: %s', async input => {
  const f = await fixture()
  try {
    const path = input === 'absolute-sibling' ? join(f.root, 'game-sibling/docs/GDD.md') : input
    await f.submit('write-path:' + path)
    const text = f.events.at(-1)?.text ?? ''
    if (input === '../outside.md' || input === 'absolute-sibling') {
      expect(text).toContain('Path is outside the project workspace')
      expect(text).not.toContain('Use native BGS file tools')
    } else {
      expect(text).toContain('Path is not a BGS protected design record or AGENTS.md')
      expect(text).toContain('Check file_path')
      expect(text).toContain('use exec_command with project-local file operations')
      expect(text).toContain('does not deny ordinary workspace writes')
    }
    expect(await Bun.file(resolve(f.workspace, path)).exists()).toBe(false)
    expect(f.questions).toHaveLength(0)
  } finally { await f.close() }
}, 30_000)

test('questions return actual user answers to the requesting item', async () => {
  const f = await fixture()
  try { await f.submit('question'); expect(f.events.some(e => e.text.includes('"answers":["A"]'))).toBe(true) }
  finally { await f.close() }
}, 30_000)

test('failure, process loss and unfinished child work never resolve as success', async () => {
  for (const prompt of ['fail', 'crash', 'unfinished-child']) {
    const f = await fixture()
    try { await expect(f.submit(prompt)).rejects.toThrow() } finally { await f.close() }
  }
}, 30_000)

test.each(['running', 'pending', 'turn-started'])(
  'reused child %s prevents premature parent completion', async outcome => {
    const f = await fixture()
    try { await expect(f.submit('reused-child:' + outcome)).rejects.toThrow('unfinished child work') }
    finally { await f.close() }
  })

test.each(['completed', 'turn-completed', 'errored', 'interrupted', 'shutdown', 'notFound'])(
  'reused child terminal state %s releases the running slot', async outcome => {
    const f = await fixture()
    try {
      await f.submit('reused-child:' + outcome)
      expect(f.events.findLast(event => event.childThreadId === 'reused-child')?.childStatus)
        .toBe(outcome === 'turn-completed' ? 'completed' : outcome)
    } finally { await f.close() }
  })

test('host-controlled Goal completion refuses a running reused child', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_GOAL_FINALIZE: '1',
    BGS_FIXTURE_REUSED_CHILD: '1' }, resolveOutboundTarget, undefined, {mode:'start',objective:'Offline reused-child check'})
  const abort = new AbortController()
  const submitted = f.submit('delivery submission', abort.signal).catch(error => error)
  try {
    await waitUntil(() => f.events.some(event => event.toolUseID === 'submission-command'))
    await expect((f.runtime as unknown as {completeGoal():Promise<void>}).completeGoal())
      .rejects.toThrow('requires all child agents to finish')
    expect(f.events.findLast(event => event.subtype === 'native_goal')?.nativeGoal?.status).toBe('active')
  } finally { abort.abort(); await submitted; await f.close() }
})

test('failed turns retain upstream error details from completion or the preceding error notification', async () => {
  for (const prompt of ['failure-details', 'failure-notification']) {
    const f = await fixture()
    try {
      await expect(f.submit(prompt)).rejects.toMatchObject({ message: 'Connection error. fixture ECONNRESET',
        bgsErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } })
      if (prompt === 'failure-notification') expect(f.events.find(e => e.eventType === 'system.status'))
        .toMatchObject({ text: 'Connection error. fixture ECONNRESET', willRetry: false })
    } finally { await f.close() }
  }
}, 10000)

test.each(['hang', 'reused-child:cancel'])('cancellation closes waiting work before returning: %s', async prompt => {
  const f = await fixture(), abort = new AbortController()
  try {
    const result = f.submit(prompt, abort.signal)
    if (prompt !== 'hang') await waitUntil(() => f.events.some(event => event.childThreadId === 'reused-child' && event.childStatus === 'running'))
    setTimeout(() => abort.abort(), 30)
    await expect(result).rejects.toThrow()
    await expect(f.submit('hello')).rejects.toThrow('stopped')
  } finally { await f.close() }
}, 30_000)

test('cache is a subset of input; reasoning output is not counted twice', () => {
  expect(bgsUsage({ inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 30, reasoningOutputTokens: 15 }))
    .toEqual({ prompt_tokens: 70, completion_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 10, total_tokens: 130 })
  expect(() => bgsUsage({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 })).toThrow()
  expect(() => bgsProviderConfig({ OPENAI_AUTH_MODE: 'chatgpt', OPENAI_BASE_URL: 'https://example.invalid' })).toThrow()
})


test('BGS resumes Bgs history without double charging and does not resume legacy agent UUIDs', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-resume-'), workspace=join(root,'game')
  const environment=()=>({BEEGAME_CONFIG_DIR:join(root,'config'),OPENAI_API_KEY:'fixture-only'})
  let manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
  try {
    const session=manager.start({workspacePath:workspace,userId:'owner'})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).runtime).toBe('bgs')
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(130)
    await manager.dispose()
    manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    await manager.sendWithDisplay(session.id,'hello');await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(260)
    expect(manager.transcriptFacts(session.id).some(event=>event.type==='turn.completed')).toBe(true)
    await manager.dispose()
    const path=join(root,'snapshots',session.id+'.json'), snapshot=JSON.parse(await readFile(path,'utf8'))
    delete snapshot.runtime
    await writeFile(path,JSON.stringify(snapshot))
    manager=new BeeGameSessionManager(createBgsRunner({command,resolveOutboundTarget}),root,environment)
    manager.start({workspacePath:workspace,userId:'owner',transcriptSessionId:session.id})
    expect(manager.runtimeSnapshot(session.id).nativeSessionId).toBeUndefined()
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true})}
},30_000)

test.each(['write', 'edit', 'denied', 'revoked', 'cancelled', 'instructions'] as const)(
  'protected write rechecks preserve authority and audit results: %s', async mode => {
  // The local stdio fixture creates no browsers or model requests.
  const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
  const root = await mkdtemp('/private/tmp/bgs-write-recheck-'), workspace = join(root, 'game')
  const path = join(workspace, mode === 'instructions' ? 'AGENTS.md' : 'docs/GDD.md')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(path, 'original')
  const requests: DashboardPermissionRequest[] = []
  let sessionId = ''
  const runner = createBgsRunner({ command, resolveOutboundTarget })
  const manager = new BeeGameSessionManager({ async start(input) {
    return runner.start({ ...input, requestPermission: async request => {
      requests.push(request)
      const deny = mode === 'denied' || mode === 'revoked' && request.phase === 'recheck'
      const pending = input.requestPermission!(deny ? { ...request, decisionReason: 'Fixture explicit authorization' } : request)
      if (deny) manager.resolvePermission(sessionId, request.toolUseID, { behavior: 'deny', source: 'user', message: 'Fixture write denied' })
      if (mode === 'instructions') manager.resolvePermission(sessionId, request.toolUseID, { behavior: 'allow', source: 'user' })
      const decision = await pending
      if (mode === 'cancelled' && request.phase === 'recheck') manager.stop(sessionId)
      return decision
    } })
  } }, root, () => ({ BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only' }))
  try {
    sessionId = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' }).id
    const allowed = ['write', 'edit', 'instructions'].includes(mode)
    // Reusing the fixture call ID in a later turn must not suppress its initial receipt.
    const turns = mode === 'write' || mode === 'edit' ? 2 : 1
    for (let turn = 0; turn < turns; turn++) {
      const prompt = mode === 'instructions' ? 'write-path:AGENTS.md' : mode === 'edit'
        ? 'edit-design:' + JSON.stringify({ old_string: turn ? 'edited-0' : 'original', new_string: 'edited-' + turn }) : 'write-design'
      await manager.sendWithDisplay(sessionId, prompt)
      await manager.waitForSessionIdle(sessionId)
    }
    expect(manager.transcriptFacts(sessionId).filter(event => event.type === 'turn.failed')).toEqual([])
    expect(requests.map(request => request.phase ?? 'initial')).toEqual(
      Array.from({ length: turns }, () => mode === 'denied' || mode === 'instructions' ? ['initial'] as const : ['initial', 'recheck'] as const).flat())
    expect(await readFile(path, 'utf8')).toBe(allowed ? mode === 'edit' ? 'edited-1' : 'Authorized design' : 'original')
    const events = manager.transcriptFacts(sessionId)
    const resolved = events.filter(event => event.type === 'permission.resolved')
    expect(resolved.map(event => event.payload?.decision)).toEqual(mode === 'revoked' ? ['allow', 'deny'] :
      Array(turns).fill(mode === 'denied' ? 'deny' : 'allow'))
    expect(resolved.every(event => event.payload?.toolUseID === 'write-design')).toBe(true)
    expect(events.filter(event => event.type === 'permission.requested')).toHaveLength(['instructions', 'denied', 'revoked'].includes(mode) ? 1 : 0)
    if (mode === 'revoked' || mode === 'denied') {
      expect(resolved.at(-1)?.payload).toMatchObject({ decision: 'deny' })
      const failure = events.find(event => event.type === 'assistant.message' && event.text.includes('Write rejected'))
      expect(failure?.text).toContain('Fixture write denied')
    }
    if (mode === 'cancelled') expect(events.some(event => event.type === 'session.stopped')).toBe(true)
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
    cleanup.mockRestore()
  }
}, 30_000)

test('required Bgs skill selection fails clearly when absent and accepts a real catalog entry', async () => {
  const missing=await fixture()
  try {await expect(missing.submit('$missing-fixture-skill Use method')).rejects.toThrow('Required BGS skill is unavailable')}
  finally {await missing.close()}
  const available=await fixture()
  try {
    await available.submit([{type:'text',text:'Current platform facts'}, {type:'text',text:'$game-creative-director-expert Apply the method'}])
    expect(available.events.some(event=>event.text==='Native skill selected')).toBe(true)
  } finally {await available.close()}
},30000)

test('an unrelated broken skill does not block valid skills, while a missing required skill still stops before submission', async () => {
  const root = await mkdtemp('/private/tmp/bgs-skill-catalog-'), game = join(root, 'game')
  await mkdir(game)
  const warnings: unknown[][] = [], warn = console.warn
  console.warn = (...args) => { warnings.push(args) }
  let runtime: Awaited<ReturnType<ReturnType<typeof createBgsRunner>['start']>> | undefined
  try {
    for (const required of ['game-creative-director-expert', 'missing-fixture-skill']) {
      let submitted = false
      const events: Record<string, any>[] = []
      runtime = await createBgsRunner({ command, resolveOutboundTarget }).start({ sessionId: required, cwd: game,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_API_KEY: 'fixture-only', BGS_FIXTURE_RPC_TRACE: join(root, 'rpc.jsonl'), BGS_FIXTURE_SKILL_CATALOG_ERROR: '1' },
        onNativeSubmission: () => { submitted = true } })
      const result = runtime.submit({ prompt: '$'+required+' Apply the method', signal: AbortSignal.timeout(5000),
        onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
      if (required === 'game-creative-director-expert') {
        await result
        expect(submitted).toBe(true)
        expect(events.some(event => event.text === 'Native skill selected')).toBe(true)
      } else {
        await expect(result).rejects.toThrow('Required BGS skill is unavailable: '+required)
        expect(submitted).toBe(false)
        expect(events.some(event => event.eventType === 'assistant.message')).toBe(false)
      }
      await runtime.dispose?.(); runtime = undefined
    }
    expect(warnings).toHaveLength(2)
    expect(JSON.stringify(warnings)).not.toContain('PRIVATE_')
  } finally { console.warn = warn; await runtime?.dispose?.(); await rm(root, { recursive: true, force: true }) }
}, 10000)


test('protected edits are literal, unique and non-overlapping against the original text', () => {
  expect(editProtectedFileText('alpha beta', { edits: [
    { old_string: 'beta', new_string: 'alpha' }, { old_string: 'alpha', new_string: '$& $1' },
  ] })).toBe('$& $1 alpha')
  expect(editProtectedFileText('alpha', { old_string: 'alpha', new_string: '$&' })).toBe('$&')
  for (const args of [
    { edits: [] },
    { edits: [{ old_string: '', new_string: 'x' }] },
    { edits: [{ old_string: 'absent', new_string: 'x' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }, { old_string: 'pha', new_string: 'y' }] },
    { edits: [{ old_string: 'alpha', new_string: 'x' }], old_string: 'beta', new_string: 'y' },
  ]) expect(() => editProtectedFileText('alpha beta', args)).toThrow()
  expect(() => editProtectedFileText('aaa', { old_string: 'aa', new_string: 'x' })).toThrow('exactly once')
})

test('protected edit errors identify all failing original-file matches without echoing content', () => {
  const run = () => editProtectedFileText('alpha beta beta', { edits: [
    { old_string: 'alpha', new_string: 'saved only if all succeed' },
    { old_string: 'PRIVATE_ABSENT_CONTENT', new_string: 'x' },
    { old_string: 'beta', new_string: 'y' },
  ] })
  expect(run).toThrow('edits[1]: old_string matched 0 times')
  expect(run).toThrow('edits[2]: old_string matched 2 times')
  expect(run).toThrow('Nothing saved')
  try { run() } catch (error) { expect(String(error)).not.toContain('PRIVATE_ABSENT_CONTENT') }
})

test.each(['success', 'missing-match', 'denied'] as const)('protected batch edits preserve permissions and all-or-nothing writes: %s', async mode => {
  const f = await fixture(mode === 'denied' ? 'deny' : 'allow')
  try {
    const path = join(f.workspace, 'docs/GDD.md')
    await writeFile(path, 'alpha beta')
    await f.submit('edit-design:' + JSON.stringify({ edits: [
      { old_string: 'alpha', new_string: '$&' },
      { old_string: mode === 'missing-match' ? 'absent' : 'beta', new_string: 'gamma' },
    ] }))
    expect(await readFile(path, 'utf8')).toBe(mode === 'success' ? '$& gamma' : 'alpha beta')
    expect(f.questions.length).toBeGreaterThan(0)
    expect(f.events.some(e => e.text?.includes(mode === 'success' ? 'Saved design' : 'Write rejected'))).toBe(true)
  } finally { await f.close() }
}, 30_000)


test('provider unknown tools reach the active BGS event stream without executing or retrying them', async () => {
  let requests = 0
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'unknown-call',
      function: { name: 'PRIVATE_UNSUPPORTED_NAME', arguments: '{"secret":"PRIVATE_ARGUMENT"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture('allow', { BEEGAME_API_PROTOCOL: 'chat-completions', BEEGAME_MODEL: 'fixture-model', OPENAI_BASE_URL: provider.url.toString().replace(/\/$/, '') },
      async value => ({ url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }))
    await f.submit('provider-unknown-tool')
    const failures = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ toolUseID: 'unknown-call', toolName: 'Unknown provider tool', is_error: true,
      output: expect.stringContaining('No action was executed') })
    expect(JSON.stringify(failures)).not.toContain('PRIVATE_')
    expect(f.questions).toHaveLength(0)
    expect(requests).toBe(1)
  } finally { await f?.close(); provider.stop(true) }
}, 10_000)


test.each(['boundary', 'policy', 'unspecified'])('native denial receipts retain the available reason: %s', async mode => {
  const f = await fixture(mode === 'policy' ? 'deny' : 'allow')
  try {
    await f.submit('native-denial:' + mode)
    const failed = f.events.filter(event => event.eventType === 'tool.failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].output).toBe(mode === 'boundary'
      ? 'BGS denied the request because it cannot preserve the project permission boundary.'
      : mode === 'policy' ? 'Fixture policy denied the operation'
      : 'Native tool approval was declined; no detailed reason was supplied.')
    expect(f.questions).toHaveLength(mode === 'policy' ? 1 : 0)
  } finally { await f.close() }
}, 10000)

test.each(['empty', 'result'])('native MCP failures keep their message and any partial result: %s', async mode => {
  const f = await fixture()
  try {
    await f.submit('mcp-error:' + mode)
    const failure = f.events.find(event => event.eventType === 'tool.failed')
    if (mode === 'empty') expect(failure?.output).toBe('Fixture resource unavailable')
    else expect(failure?.output).toEqual({ result: { content: [{ type: 'text', text: 'Partial output' }] }, error: 'Fixture resource unavailable' })
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_INTERNAL_DATA')
  } finally { await f.close() }
}, 10000)

test.each(['stale', 'success', 'denied'])('edit feedback preserves atomic writes and authorization: %s', async mode => {
  const f = await fixture(mode === 'denied' ? 'deny' : 'allow')
  try {
    const path = join(f.workspace, 'docs/GDD.md')
    const original = '# Rules\nSpeed: 4\n\n# Controls\nAction: turn\n'
    await writeFile(path, original)
    await f.submit('edit-design:' + JSON.stringify(mode === 'success' ? { edits: [
      { old_string: 'Speed: 4', new_string: 'Speed: 5\nNote: updated' },
      { old_string: 'Action: turn', new_string: 'Action: move' },
    ] } : { old_string: '# Rules\nSpeed: 3', new_string: '# Rules\nSpeed: 5' }))
    const receipt = f.events.at(-1)?.text
    if (mode === 'success') {
      expect(receipt).toContain('File saved: docs/GDD.md. Applied 2 replacement(s); original lines: 2, 5.')
      expect(await readFile(path, 'utf8')).toBe('# Rules\nSpeed: 5\nNote: updated\n\n# Controls\nAction: move\n')
    } else {
      expect(await readFile(path, 'utf8')).toBe(original)
      if (mode === 'stale') {
        expect(receipt).toContain('docs/GDD.md: edits[0]: old_string matched 0 times')
        expect(receipt).toContain('exact first-line anchor at original line 1')
        expect(receipt).toContain('2: Speed: 4')
      } else {
        expect(receipt).toContain('Fixture policy denied the operation')
        expect(receipt).not.toContain('Speed: 4')
        expect(receipt).not.toContain('current text')
      }
    }
  } finally { await f.close() }
}, 10000)

test('edit diagnostics bound source excerpts and distinguish ambiguous from absent anchors', () => {
  const error = (text: string, old_string: string) => {
    try { editProtectedFileText(text, { old_string, new_string: '' }); throw Error('Expected rejection') }
    catch (error) { return String(error) }
  }
  expect(error('alpha\nbeta\nalpha', 'alpha')).toContain('original match lines: 1, 3')
  expect(error('# Title\nold\n# Title\nnew', '# Title\nabsent')).not.toContain('current text')
  expect(error('# Title\n' + 'x'.repeat(10000), '# Title\nabsent').length).toBeLessThan(700)
})

test('a unique line-prefix helps locate stale text without applying fuzzy or partial edits', () => {
  const body = '# Design\n| Recovery action | Display "Try again" |\n'
  const stale = '| Recovery action | Display “Try again” |'
  let error = ''
  try { editProtectedFileText(body, {old_string:stale,new_string:'replacement'}) }
  catch (caught) { error = String(caught) }
  expect(error).toContain('matched 0 times')
  expect(error).toContain('line-prefix candidate (diagnostic only) at original line 2')
  expect(error).toContain('2: | Recovery action | Display "Try again" |')
  expect(error).toContain('Nothing saved')
  expect(() => editProtectedFileText(body + '| Recovery action | Another entry |\n',
    {old_string:stale,new_string:''})).toThrow('matched 0 times; must match exactly once. Nothing saved')
  expect(editProtectedFileText(body,{old_string:'| Recovery action | Display "Try again" |',new_string:'Updated'}))
    .toBe('# Design\nUpdated\n')
  expect(() => editProtectedFileText(body,{edits:[
    {old_string:'# Design',new_string:'# Changed'}, {old_string:stale,new_string:'replacement'},
  ]})).toThrow('Nothing saved')
})


test('BGS bounds native child concurrency without enabling tools or overriding child models', () => {
  for (const goals of [false, true]) {
    const config = bgsProviderConfig({ OPENAI_AUTH_MODE: 'chatgpt' }, { goals })
    expect(config['agents.max_concurrent_threads_per_session']).toBe(2)
    expect(config).not.toHaveProperty('agents.enabled')
    expect(config).not.toHaveProperty('agents.default_subagent_model')
    expect(config).not.toHaveProperty('agents.default_subagent_reasoning_effort')
  }
})


test('doubling streamed output doubles persisted bytes instead of replaying all prior chunks', async () => {
  const sizes: number[] = []
  for (const count of [64, 128]) {
    const f = await fixture()
    try {
      await f.submit(`command-volume:${count}`)
      const path = join(f.workspace, 'volume.jsonl')
      const events = f.events.filter(event => event.eventType.startsWith('tool.'))
      for (const [id, event] of events.entries()) appendChatTranscript(path, {
        id, sessionId: 'fixture', type: event.eventType, text: event.text, payload: event, createdAt: new Date(0),
      })
      sizes.push((await readFile(path)).byteLength)
      expect(events.filter(e => e.eventType === 'tool.progress').map(e => e.text).join('')).toBe('x'.repeat(count * 1024))
      expect(events.at(-1)?.output).toBe('x'.repeat(count * 1024))
    } finally { await f.close() }
  }
  expect(sizes[1]).toBeLessThan(sizes[0]! * 2.1)
  expect(sizes[1]).toBeLessThan(1024 * 1024)
}, 30_000)


test('provider retry policy is left to the native CLI defaults for API and ChatGPT connections', () => {
  for (const env of [{}, { OPENAI_AUTH_MODE: 'chatgpt' }] as Record<string, string>[]) {
    const config = bgsProviderConfig(env) as any
    expect(config.model_providers?.bgs).not.toHaveProperty('request_max_retries')
    expect(config.model_providers?.bgs).not.toHaveProperty('stream_max_retries')
  }
})

test('native retry notifications remain progress within the original submission', async () => {
  const f = await fixture()
  try {
    await f.submit('native-retry')
    expect(f.events.find(event => event.eventType === 'system.status' && event.willRetry === true)).toMatchObject({ willRetry: true })
    expect(f.events.filter(event => event.eventType?.startsWith('assistant.')).map(event => event.text).join('')).toBe('Hello Bgs')
    const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rpc.filter(call => call.method === 'turn/start')).toHaveLength(1)
  } finally { await f.close() }
})

for (const status of [undefined, 'active', 'paused', 'blocked', 'complete', 'budgetLimited', 'usageLimited'])
  test(`manual native recovery respects persisted Goal state: ${status ?? 'ordinary turn'}`, async () => {
    const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
    const savedGoal = { objective: 'Original objective', tokenBudget: 5000, tokensUsed: 123, status }
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt',
      ...(status ? { BGS_FIXTURE_SAVED_GOAL: JSON.stringify(savedGoal) } : {}),
    }, resolveOutboundTarget, '019a0000-0000-7000-8000-000000000001', status ? { mode: 'resume' } : undefined, true)
    try {
      if (['complete', 'budgetLimited', 'usageLimited'].includes(status ?? '')) {
        await expect(f.submit('')).rejects.toThrow('already ' + status)
      } else await f.submit('')
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(rpc.some(call => call.method === 'thread/start' || call.method === 'thread/goal/clear')).toBe(false)
      for (const resume of rpc.filter(call => call.method === 'thread/resume')) {
        expect(resume.params.excludeTurns).toBe(false)
      }
      const starts = rpc.filter(call => call.method === 'turn/start')
      if (!status) {
        expect(starts).toHaveLength(1)
        expect(starts[0].params).toMatchObject({ threadId: '019a0000-0000-7000-8000-000000000001', input: [] })
        expect(rpc.findIndex(call => call.method === 'thread/resume')).toBeLessThan(rpc.indexOf(starts[0]))
      } else {
        expect(starts).toHaveLength(0)
        const activations = rpc.filter(call => call.method === 'thread/goal/set' && call.params.status === 'active')
        const terminal = ['complete', 'budgetLimited', 'usageLimited'].includes(status)
        expect(activations).toHaveLength(terminal ? 0 : 1)
        for (const call of activations) {
          expect(call.params).not.toHaveProperty('objective')
          expect(call.params).not.toHaveProperty('tokenBudget')
        }
        const injected = rpc.filter(call => call.method === 'thread/inject_items').flatMap(call => call.params.items)
        expect(injected.some(item => item.role === 'user')).toBe(false)
        if (!terminal) expect(f.events.find(event => event.subtype === 'native_goal' && event.nativeGoal?.status === 'active')?.nativeGoal)
          .toMatchObject({ objective: 'Original objective', tokenBudget: 5000, tokensUsed: 123 })
      }
    } finally { await f.close(); cleanup.mockRestore() }
  })


test('ordinary native recovery leaves an unrelated persisted Goal dormant', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt',
    BGS_FIXTURE_SAVED_GOAL: JSON.stringify({ objective: 'Earlier implementation', status: 'paused', tokenBudget: 5000, tokensUsed: 123 }),
  }, resolveOutboundTarget, '019a0000-0000-7000-8000-000000000001', undefined, true)
  try {
    await f.submit('')
    const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rpc.some(call => call.method.startsWith('thread/goal/'))).toBe(false)
    expect(rpc.find(call => call.method === 'turn/start')?.params.input).toEqual([])
  } finally { await f.close() }
})


test.each(['resolved', 'turn-completed', 'collab-terminal'])(
  'child cancellation blocks late protected writes and permits a fresh reused turn: %s', async mode => {
    const waits: Array<{ request: DashboardPermissionRequest; allow(): void }> = []
    const cleanup = spyOn(browserCleanup, 'closeSessionTestBrowsers').mockResolvedValue(undefined)
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget, undefined, undefined, false,
      request => request.phase === 'recheck' ? Promise.resolve({ behavior: 'allow' }) : new Promise(resolve => {
        waits.push({ request, allow: () => resolve({ behavior: 'allow' }) })
      }))
    const client = (f.runtime as unknown as { client: BgsClient }).client
    const abort = new AbortController(), submitted = f.submit('hang', abort.signal).catch(error => error)
    const emit = (...events: unknown[]) => client.request('fixture/events', { events })
    const childStatus = (tool: string, status: string) => ({ method: 'item/completed', params: {
      threadId: f.sessionId, turnId: 'turn-1', item: { id: tool + '-' + status, type: 'collabAgentToolCall',
        tool, receiverThreadIds: ['child'], agentsStates: { child: { status } }, status: 'completed' },
    } })
    const write = (id: string, turnId: string, content: string) => ({ id, method: 'item/tool/call', params: {
      threadId: 'child', turnId, callId: id, tool: 'WriteProjectFile', arguments: { file_path: 'docs/GDD.md', content },
    } })
    const terminal = { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-1', status: 'interrupted' } } }
    const responses = async () => (await client.request('fixture/responses', {})).responses as Array<any>
    try {
      await writeFile(join(f.workspace, 'docs/GDD.md'), 'original')
      // A child listener may attach after turn/started; the first live request supplies its turn ID.
      await emit(childStatus('spawnAgent', 'running'), write('old', 'child-1', 'late old write'))
      await waitUntil(() => waits.length === 1)
      const cancel = mode === 'resolved'
        ? { method: 'serverRequest/resolved', params: { threadId: 'child', requestId: 'old' } }
        : mode === 'turn-completed' ? terminal : childStatus('wait', 'interrupted')
      await emit(cancel)
      await waitUntil(() => waits[0]!.request.signal?.aborted === true)
      waits[0]!.allow()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('original')
      expect((await responses()).some(response => response.id === 'old')).toBe(false)
      if (mode === 'resolved') await emit(terminal)
      await emit(childStatus('sendInput', 'running'), write('late', 'child-1', 'must not revive'))
      await waitUntil(() => f.questions.length === 1)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'late')?.error).toBeDefined()
      expect(waits).toHaveLength(1)
      await emit(write('new', 'child-2', 'new authorized write'))
      await waitUntil(() => waits.length === 2)
      expect(waits[1]!.request.signal?.aborted).toBe(false)
      waits[1]!.allow()
      await waitUntil(() => f.questions.length === 3) // allow plus the live host authority recheck
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'new')?.result.success).toBe(true)
      expect(await readFile(join(f.workspace, 'docs/GDD.md'), 'utf8')).toBe('new authorized write')
      await emit({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-2', status: 'completed' } } },
        childStatus('sendInput', 'running'), write('older-late', 'child-1', 'must stay ended across multiple reuses'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect((await responses()).find(response => response.id === 'older-late')?.error).toBeDefined()
      expect(waits).toHaveLength(2)
    } finally {
      abort.abort(); for (const wait of waits) wait.allow()
      await submitted; await f.close(); cleanup.mockRestore()
    }
  }, 10_000)


test('native workflow registration respects new versus resumed thread capabilities', async () => {
  for (const mode of ['ordinary', 'new-workflow', 'resumed-workflow']) {
    const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget,
      mode === 'resumed-workflow' ? '019a0000-0000-7000-8000-000000000001' : undefined,
      undefined, false, undefined, mode === 'ordinary' ? undefined : async () => ({}))
    try {
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const start = rpc.find(call => ['thread/start', 'thread/resume'].includes(call.method))
      expect(start.params.dynamicTools?.some((tool: any) => tool.name === 'BgsWorkflow') ?? false).toBe(mode === 'new-workflow')
      if (mode === 'resumed-workflow') expect(start.params).not.toHaveProperty('dynamicTools')
      else expect(start.params.dynamicTools.every((tool: any) => tool.type === 'function')).toBe(true)
    } finally { await f.close() }
  }
})

test('native workflow uses the live parent callback and rejects cancelled, stale and child requests', async () => {
  const f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt' }, resolveOutboundTarget,
    undefined, undefined, false, undefined, async () => { throw Error('Must not use startup callback') })
  const client = (f.runtime as unknown as { client: BgsClient }).client
  const abort = new AbortController()
  const calls: unknown[] = []
  let pendingSignal: AbortSignal | undefined, release: (() => void) | undefined
  const submitted = f.runtime.submit({ prompt: 'hang', signal: abort.signal,
    measurement: async value => ({ receipt: value }),
    workflow: async (value, signal) => {
      calls.push(value)
      if ((value as any).action === 'advance') {
        pendingSignal = signal
        await new Promise<void>(resolve => { release = resolve })
      }
      return { assignment: 'current' }
    }, onMessage: () => {}, requestPermission: async () => ({ behavior: 'deny' }) }).catch(error => error)
  const emit = (...events: unknown[]) => client.request('fixture/events', { events })
  const call = (id: string, action = 'status', threadId = f.sessionId, turnId = 'turn-1') => ({ id, method: 'item/tool/call',
    params: { threadId, turnId, callId: id, tool: 'BgsWorkflow', arguments: { action } } })
  const response = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const result = (await client.request('fixture/responses', {})).responses.find((item: any) => item.id === id)
      if (result) return result
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error('No fixture response: ' + id)
  }
  try {
    await emit(call('status'))
    expect((await response('status')).result).toEqual({ success: true, contentItems: [{ type: 'inputText', text: '{"assignment":"current"}' }] })
    await emit({ id:'measure', method:'item/tool/call', params:{threadId:f.sessionId,turnId:'turn-1',callId:'measure',
      tool:'BgsMeasurement',arguments:{inspectRequestKey:'saved'}} })
    expect((await response('measure')).result).toEqual({success:true,contentItems:[{type:'inputText',text:'{"receipt":{"inspectRequestKey":"saved"}}'}]})
    await emit({ method: 'item/completed', params: { threadId: f.sessionId, turnId: 'turn-1', item: {
      id: 'spawn-child', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } }, status: 'completed' } } }, call('child', 'advance', 'child', 'child-1'))
    expect((await response('child')).result.success).toBe(false)
    await emit(call('stale', 'advance', f.sessionId, 'stale-turn'))
    expect((await response('stale')).error).toBeDefined()
    expect(calls).toEqual([{ action: 'status' }])
    await emit(call('cancelled', 'advance'))
    await waitUntil(() => pendingSignal !== undefined)
    await emit({ method: 'serverRequest/resolved', params: { threadId: f.sessionId, requestId: 'cancelled' } })
    await waitUntil(() => pendingSignal!.aborted)
    release!()
    await emit(call('after-cancel'))
    expect((await response('after-cancel')).result.success).toBe(true)
    expect((await client.request('fixture/responses', {})).responses.some((item: any) => item.id === 'cancelled')).toBe(false)
  } finally { abort.abort(); release?.(); await submitted; await f.close() }
})


test.each(['valid', 'command', 'dynamic', 'child'])(
  'native terminal delivery closes only its own submission and rejects other work: %s', async mode => {
    let f!: Awaited<ReturnType<typeof fixture>>
    let calls = 0
    f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_FINISH: mode },
      resolveOutboundTarget, undefined, { mode: 'start', objective: 'Deliver the fixture' }, false, undefined, undefined,
      { measurement: async () => ({}), finishDelivery: async (value, signal) => {
        expect(value).toEqual({ requirementsRevision: 'fixture-revision' })
        expect(signal?.aborted).toBe(false)
        calls++
        await f.runtime.completeGoal!()
        return { submitted: true }
      } })
    const abort = new AbortController()
    const submitted = f.submit('Submit the saved report', abort.signal).catch(error => error)
    try {
      if (mode === 'valid') {
        expect(await submitted).toBeUndefined()
        expect(f.events.some(event => event.eventType === 'assistant.message')).toBe(false)
        expect(f.events.findLast(event => event.subtype === 'native_goal')?.nativeGoal.status).toBe('complete')
        expect(f.events.some(event => event.eventType === 'tool.completed' && event.toolUseID === 'native-finish')).toBe(false)
      } else {
        await waitUntil(() => f.events.some(event => event.eventType === 'assistant.message'))
        expect(f.events.find(event => event.eventType === 'assistant.message')?.text).toContain('"success":false')
      }
      const rpc = (await readFile(join(f.root, 'rpc.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      const names = rpc.find(call => call.method === 'thread/start').params.dynamicTools.map((tool: any) => tool.name)
      expect(names).toContain('BgsMeasurement'); expect(names).toContain('BgsFinishDelivery')
      expect(rpc.filter(call => call.method === 'thread/goal/set' && call.params.status === 'complete')).toHaveLength(mode === 'valid' ? 1 : 0)
      expect(rpc.some(call => call.method === 'turn/start')).toBe(false)
      expect(calls).toBe(1)
    } finally { abort.abort(); await submitted; await f.close() }
  })


test('cancelled native terminal delivery cannot finish the Goal after its callback resumes', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>
  let signal: AbortSignal | undefined, release!: () => void, attempted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const done = new Promise<void>(resolve => { attempted = resolve })
  f = await fixture('allow', { OPENAI_AUTH_MODE: 'chatgpt', BGS_FIXTURE_NATIVE_FINISH: 'valid' },
    resolveOutboundTarget, undefined, { mode:'start', objective:'Deliver the fixture' }, false, undefined, undefined,
    { finishDelivery: async (_value, requestSignal) => {
      signal = requestSignal
      await gate
      try { await f.runtime.completeGoal!(); return {} } finally { attempted() }
    } })
  const abort = new AbortController(), submitted = f.submit('Submit the saved report', abort.signal).catch(error => error)
  const client = (f.runtime as unknown as { client: BgsClient }).client
  try {
    await waitUntil(() => signal !== undefined)
    await client.request('fixture/events', { events: [{ method:'serverRequest/resolved', params:{threadId:f.sessionId,requestId:'native-finish'} }] })
    await waitUntil(() => signal!.aborted)
    release(); await done
    const rpc = (await readFile(join(f.root,'rpc.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    expect(rpc.some(call => call.method==='thread/goal/set' && call.params.status==='complete')).toBe(false)
    expect((await client.request('fixture/responses',{})).responses.some((item:any)=>item.id==='native-finish')).toBe(false)
  } finally { release(); abort.abort(); await submitted; await f.close() }
})


test('native terminal delivery crosses SessionManager submission persistence and settlement cleanup', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-delivery-session-')
  const native = createBgsRunner({ command, resolveOutboundTarget })
  const manager = new BeeGameSessionManager({ start: input => native.start({ ...input,
    env: { ...input.env, BGS_FIXTURE_NATIVE_FINISH:'valid' } }) }, root,
    () => ({ BEEGAME_CONFIG_DIR:join(root,'config'), OPENAI_AUTH_MODE:'chatgpt' }))
  let turnId = '', closed = 0
  try {
    const session = manager.start({workspacePath:join(root,'game'),userId:'owner'})
    await manager.sendWithDisplay(session.id,'Submit the validated fixture',{
      nativeGoal:{mode:'start',objective:'Deliver the fixture'},
      executionIdentity:{attemptId:'fixture-attempt',workerId:'fixture-worker',fence:1},
      onTurnAccepted:id=>{turnId=id},
      prepareTurn:async()=>({finishDelivery:async value=>{
        // Validation itself is covered with real reports in agent-measurement;
        // this fixture exercises persistence, native shutdown and settlement.
        await manager.completeNativeGoal(session.id,turnId,{attemptId:'fixture-attempt',
          requirementsRevision:(value as any).requirementsRevision,reportPath:'.beegame/delivery/acceptance.json',
          reportSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),summary:'Synthetic validated submission'})
        return {}
      },close:async()=>{closed++}}),
    })
    await manager.waitForSessionIdle(session.id)
    const events=manager.transcript(session.id)
    const receipt=events.findIndex(event=>event.payload?.subtype==='delivery_submission')
    const complete=events.findIndex(event=>event.payload?.subtype==='native_goal' && (event.payload.nativeGoal as any)?.status==='complete')
    expect(receipt).toBeGreaterThanOrEqual(0);expect(complete).toBeGreaterThan(receipt)
    expect(events.some(event=>event.type==='turn.failed')).toBe(false)
    expect(closed).toBe(1)
    expect(manager.get(session.id)?.turnStatus).toBe('idle')
  } finally {await manager.dispose();await rm(root,{recursive:true,force:true})}
}, 10000)
