import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answeredQuestionInput } from './user-question'
import { BeeGameSessionManager, type DashboardPermissionDecision } from './session-manager'

const input = { questions: [
  { question: 'Style?', header: 'Style', options: [{ label: 'Pixel' }, { label: 'Vector' }] },
  { question: 'Features?', multiSelect: true, options: [{ label: 'Jump' }, { label: 'Run' }] },
], metadata: { source: 'test' } }
const answers = { 'Style?': 'Custom style', 'Features?': 'Jump, Run' }

test('returns answers with untouched native questions and metadata', () => {
  expect(answeredQuestionInput('AskUserQuestion', input, answers)).toEqual({ ...input, answers })
  expect('answers' in input).toBe(false)
})

test('does not accept partial, empty, unknown, malformed answers or answers for another tool', () => {
  for (const value of [undefined, [], {}, { 'Style?': 'Pixel' }, { ...answers, 'Style?': ' ' },
    { ...answers, extra: 'unexpected' }, { ...answers, 'Style?': 1 }]) {
    expect(() => answeredQuestionInput('AskUserQuestion', input, value)).toThrow()
  }
  expect(() => answeredQuestionInput('Bash', { command: 'echo test' }, answers)).toThrow()
})

for (const worker of [false, true]) {
  test(`${worker ? 'worker' : 'conversation'} keeps invalid submissions pending and delivers valid answers once`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-question-'))
    let received: DashboardPermissionDecision | undefined
    const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
      received = await turn.requestPermission({ toolUseID: 'question', toolName: 'AskUserQuestion', input, message: 'Answer?' })
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Answered' })
    } }) }, root)
    try {
      const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project', workflowWorker: worker })
      await manager.sendWithDisplay(session.id, 'Offline question fixture')
      for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(1)
      expect(() => manager.resolvePermission(session.id, 'question', { behavior: 'allow', answers: {} })).toThrow()
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(1)
      manager.resolveProjectPermission('owner', 'project', root, 'question', { behavior: 'allow', scope: 'session', answers })
      for (let i = 0; i < 200 && !received; i++) await Bun.sleep(5)
      expect(received).toMatchObject({ behavior: 'allow', scope: 'once', updatedInput: { ...input, answers }, updatedPermissions: [] })
      expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(0)
      expect(() => manager.resolvePermission(session.id, 'question', { behavior: 'allow', answers })).toThrow('Permission request not found')
    } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
  })
}

test('declining a question does not require answers or strand the agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-question-decline-'))
  let received: DashboardPermissionDecision | undefined
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit(turn) {
    received = await turn.requestPermission({ toolUseID: 'question', toolName: 'AskUserQuestion', input, message: 'Answer?' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Offline decline fixture')
    for (let i = 0; i < 200 && !manager.pendingPermissionsForProject('owner', 'project', root).length; i++) await Bun.sleep(5)
    manager.resolvePermission(session.id, 'question', { behavior: 'deny' })
    for (let i = 0; i < 200 && !received; i++) await Bun.sleep(5)
    expect(received).toMatchObject({ behavior: 'deny' })
    expect(manager.pendingPermissionsForProject('owner', 'project', root)).toHaveLength(0)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
