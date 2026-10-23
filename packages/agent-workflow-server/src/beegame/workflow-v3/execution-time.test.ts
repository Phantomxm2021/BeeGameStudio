import { expect, test } from 'bun:test'
import { projectExecutionTime } from './execution-time'
import type { AgentTurn, Run } from './state'

const now = Date.now()
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
const turn = (id: string, start: number, end?: number): AgentTurn => ({ attemptId: id, requestKey: id,
  sessionId: 'session', workerId: 'worker', fence: 1, status: end === undefined ? 'running' : 'ended',
  startedAt: at(start), ...(end === undefined ? {} : { quiescedAt: at(end), finishedAt: at(end + 1) }) })
const run = (turns: AgentTurn[], writer?: string) => ({ agentTurns: turns,
  ...(writer ? { writer: { attemptId: writer, fence: 1, workerId: 'worker' } } : {}) }) as Run

test('adds completed rounds across sessions, excluding pause gaps and delayed settlement', () => {
  const value = run([turn('first', -60, -50), { ...turn('second', -20, -15), sessionId: 'focused-session', status: 'interrupted' }])
  value.paused = { at: at(-15) }
  expect(projectExecutionTime(value, false, now)).toEqual({ elapsed_ms: 15 * 60_000, running: false })
  expect(projectExecutionTime(value, false, now + 24 * 3600_000)).toEqual({ elapsed_ms: 15 * 60_000, running: false })
})

test('advances only the current live writer and freezes at observed exit before settlement', () => {
  const value = run([turn('first', -60, -50), turn('live', -5)], 'live')
  expect(projectExecutionTime(value, true, now)).toEqual({ elapsed_ms: 15 * 60_000, running: true })
  expect(projectExecutionTime(value, true, now + 60_000)).toEqual({ elapsed_ms: 16 * 60_000, running: true })
  value.agentTurns![1]!.quiescedAt = at(-1)
  expect(projectExecutionTime(value, true, now)).toEqual({ elapsed_ms: 14 * 60_000, running: false })
  expect(projectExecutionTime(run([turn('legacy', -5, -1)].map(t => ({ ...t, quiescedAt: undefined }))), false, now))
    .toEqual({ elapsed_ms: 5 * 60_000, running: false })
})

test('does not invent elapsed time for unresolved or malformed intervals; proven unstarted attempts count zero', () => {
  const live = run([turn('unresolved', -100)], 'unresolved')
  expect(projectExecutionTime(live, false, now)).toBeUndefined()
  expect(projectExecutionTime(run([turn('orphan', -100)]), true, now)).toBeUndefined()
  for (const invalid of [{ startedAt: 'invalid' }, { quiescedAt: 'invalid' }, { startedAt: at(1) }, { quiescedAt: at(1) }])
    expect(projectExecutionTime(run([{ ...turn('bad', -10, -5), ...invalid }]), false, now)).toBeUndefined()
  expect(projectExecutionTime(run([{ ...turn('unstarted', -100), notStarted: true }]), false, now))
    .toEqual({ elapsed_ms: 0, running: false })
  expect(projectExecutionTime(run([]), false, now)).toEqual({ elapsed_ms: 0, running: false })
  expect(projectExecutionTime(undefined, false, now)).toBeUndefined()
})

test('runtime-state exposes the persisted project total through the existing endpoint without starting work or changing the run', async () => {
  const { mkdtemp, mkdir, realpath, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createAgentWorkflowApp } = await import('../../app')
  const { createRun } = await import('./state')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-execution-time-')))
  const projects = join(root, 'projects'), workspace = join(projects, 'users/owner/fixture')
  await mkdir(workspace, { recursive: true })
  const value = createRun({ projectId: 'fixture', ownerId: 'owner', workspacePath: workspace,
    chatSessionId: 'chat', requestKey: 'create', text: 'Offline fixture', constraints: {}, ids: ['goal'] })
  value.agentTurns = [turn('first', -60, -50), turn('second', -20, -15)]
  value.paused = { at: at(-15) }
  let saved: Run | undefined = value, starts = 0, commits = 0
  const before = JSON.stringify(value), cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projects,
    currentUser: { id: 'owner', role: 'owner' }, modelConfigStore: false, skillsConfig: false,
    workflowV3Store: { async read() { return saved }, async commit() { commits++; throw Error('Read only') } },
    sessionRunner: { async start() { starts++; throw Error('No model calls') } },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const created = await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'fixture', name: 'Fixture', root_path: workspace, created_at: Date.now() - 86_400_000 }) })
    expect(created.status).toBe(200)
    const response = await app.request('/api/projects/fixture/runtime-state')
    expect(response.status).toBe(200)
    expect((await response.json()).execution_time).toEqual({ elapsed_ms: 15 * 60_000, running: false })
    saved = undefined
    expect((await (await app.request('/api/projects/fixture/runtime-state')).json()).execution_time).toBeNull()
    expect(JSON.stringify(value)).toBe(before)
    expect({ starts, commits }).toEqual({ starts: 0, commits: 0 })
  } finally {
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
