import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput } from './session-manager'
import { sendProjectConversation, isProjectConversation } from './project-conversation'
import { createRunStore } from './delivery-workflow/run-store'
import { computeWorkspaceRevision } from './delivery-workflow/revision'
import { createTestDeliveryRun } from '../__tests__/delivery-workflow-test-helpers'

async function idle(manager: BeeGameSessionManager, id: string) {
  for (let i = 0; i < 500 && manager.get(id)?.turnStatus !== 'idle'; i++)
    await Bun.sleep(5)
  expect(manager.get(id)?.turnStatus).toBe('idle')
}

test('raw project turns reuse native context; language change resumes, not a new delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let closed = 0
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: '检查完成' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const send = (message: string, language: 'zh' | 'en', clientMessageId: string) => sendProjectConversation({
      sessions: manager, sessionId: session.id, ownerId: 'owner', message,
      options: { language, clientMessageId },
      openCapabilities: () => ({ instruction: 'Optional preview tool', close: async () => { closed++ } }),
    })
    await send('UI 有问题，先只诊断', 'zh', 'one'); await idle(manager, session.id)
    await send('只修复按钮文字', 'zh', 'two'); await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    await send('Make the player faster', 'en', 'three'); await idle(manager, session.id)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect(prompts).toEqual(['UI 有问题，先只诊断', '只修复按钮文字', 'Make the player faster'])
    expect(starts[0]?.workflowWorker).toBeUndefined()
    expect(starts[0]?.workflowProtectedPaths).toBeUndefined()
    expect(starts[0]?.systemContext).toContain('relevant project documents')
    expect(starts[0]?.systemContext).not.toContain('UI 有问题')
    expect(closed).toBe(3)
    expect(manager.events(session.id).filter(e => e.type === 'user.message').map(e => e.payload?.clientMessageId)).toEqual(['one', 'two', 'three'])
    expect(isProjectConversation(manager.events(session.id))).toBe(true)
    expect(await createRunStore(session.cwd, 'owner').load()).toBeNull()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

for (const changed of [false, true]) test(`completed task facts survive a ${changed ? 'fix' : 'question'}; acceptance follows actual files`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-verdict-'))
  const workspace = join(root, 'project')
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    if (changed) await writeFile(join(workspace, 'game.ts'), 'export const speed = 2')
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } } } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await writeFile(join(workspace, 'game.ts'), 'export const speed = 1')
    const revision = await computeWorkspaceRevision(workspace)
    const store = createRunStore(workspace, 'owner')
    const run = { ...createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' }),
      phase: 'DELIVERY' as const, status: 'completed' as const, completedAt: new Date().toISOString(),
      tasks: [{ id: 'DIRECT_IMPLEMENTATION', title: 'Game', checklistIds: [], resourceIds: [], contentIds: [],
        allowedPaths: ['./'], status: 'completed' as const, attempt: 1, completedRevision: revision, evidenceRefs: ['prior.json'] }],
      evidence: { acceptance: { kind: 'acceptance' as const, status: 'passed' as const, path: 'prior.json', revision, observedAt: new Date().toISOString() } } }
    await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
    const before = await readFile(store.paths.snapshot, 'utf8')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: changed ? '把速度改为2' : '当前速度是多少？' })
    await idle(manager, session.id)
    const after = (await store.load())!
    expect(after.tasks).toEqual(run.tasks)
    expect(after.phase).toBe('DELIVERY')
    if (changed) {
      expect(after.status).toBe('needs_action')
      expect(after.evidence.acceptance).toBeUndefined()
    } else {
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(before)
    }
    expect(manager.events(session.id).some(e => e.text?.includes('Request cleanup failed'))).toBe(false)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('continue uses ordinary conversation with existing blocker facts, without restarting or certifying delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-blocked-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let observedReason: string | undefined
  let handoff = ''
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      observedReason = (await createRunStore(workspace, 'owner').load())?.blockedReason
      handoff = await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8')
      await turn.onMessage({ type: 'result', subtype: 'success', result: '已读取现有阻塞原因' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    manager.appendUserMessage(session.id, '做一个老师批改作业的游戏', { displayKind: 'confirmed_brief' })
    manager.appendProjectChatEvent({ userId: 'owner', projectId: 'project', workspacePath: workspace,
      type: 'assistant.message', text: '实现已完成，待核对触控区域。',
      payload: { type: 'assistant.message', workflowSourceSessionId: 'implementation-worker' } })
    const store = createRunStore(workspace, 'owner')
    const run = { ...createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' }),
      phase: 'ACCEPTANCE' as const, status: 'needs_action' as const, blockedReason: 'Runtime evidence missing' }
    await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
    const before = await readFile(store.paths.snapshot, 'utf8')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '继续' })
    await idle(manager, session.id)
    expect(prompts).toEqual(['继续'])
    expect(starts[0]?.systemContext).toContain('context.md')
    expect(starts[0]?.systemContext).not.toContain('做一个老师批改作业的游戏')
    expect(handoff).toContain('做一个老师批改作业的游戏')
    expect(handoff).toContain('实现已完成，待核对触控区域。')
    expect(handoff).toContain(run.blockedReason)
    expect(handoff).toContain('.beegame/workflow/run.json')
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'context.md')).exists()).toBe(false)
    expect(starts[0]?.workflowWorker).toBeUndefined()
    expect(observedReason).toBe(run.blockedReason)
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(before)
    expect(manager.events(session.id).filter(e => e.type === 'user.message' && e.text === '继续')).toHaveLength(1)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('busy workflow rejects the request before publishing a user message or opening capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-busy-'))
  const manager = new BeeGameSessionManager({ async start() { throw new Error('Must not start a model') } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const store = createRunStore(session.cwd, 'owner')
    const run = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    await store.commit({ ...run, status: 'running' }, { runId: run.runId, type: 'run.created', phase: run.phase, status: 'running', revision: run.revision })
    await expect(sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '修复',
      openCapabilities: () => { throw new Error('Must not open services') } })).rejects.toThrow('Stop the active workflow')
    expect(manager.events(session.id).filter(e => e.type === 'user.message')).toHaveLength(0)
    expect(manager.get(session.id)?.turnStatus).toBe('idle')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('attachments survive the project entry and a transport retry does not duplicate the turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-images-'))
  const prompts: unknown[] = []
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    prompts.push(turn.prompt)
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } } } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='
    const input = { sessions: manager, sessionId: session.id, ownerId: 'owner', message: '修复截图中的问题',
      options: { clientMessageId: 'picture-request', attachments: [{ type: 'image' as const, filename: 'bug.png', mediaType: 'image/png' as const, data }] } }
    await sendProjectConversation(input); await idle(manager, session.id)
    await sendProjectConversation(input)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject([{ type: 'text', text: input.message }, { type: 'image', source: { data } }])
    expect(manager.events(session.id).filter(e => e.type === 'user.message')[0]?.payload?.attachments).toHaveLength(1)
    await expect(sendProjectConversation({ ...input, message: '另外的问题' })).rejects.toThrow('another request')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('restart restores the native UUID and request identity without delivery recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-resume-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runner = { async start(start: BeeGameSessionRunnerStartInput) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn: Parameters<import('./session-manager').BeeGameSessionRuntime['submit']>[0]) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }
  let manager = new BeeGameSessionManager(runner, root)
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    await idle(manager, session.id); await manager.dispose()
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({ ...base, transcriptSessionId: session.id })
    expect(isProjectConversation(manager.transcript(restored.id))).toBe(true)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    expect(starts).toHaveLength(1)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '继续' })
    await idle(manager, restored.id)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stop during preparation closes capabilities and does not launch a model or publish a user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-stop-'))
  const manager = new BeeGameSessionManager({ async start() { throw new Error('Must not launch') } }, root)
  let release!: () => void
  const preparing = new Promise<void>(resolve => { release = resolve })
  let closed = 0
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    const sent = manager.sendWithDisplay(session.id, '修复', { prepareTurn: async () => {
      await preparing
      return { close: async () => { closed++ } }
    } })
    manager.stop(session.id)
    expect(() => manager.start({ ...base, transcriptSessionId: session.id })).toThrow('still stopping')
    release()
    await expect(sent).rejects.toThrow('stopped during turn preparation')
    expect(closed).toBe(1)
    expect(manager.events(session.id).filter(e => e.type === 'user.message')).toHaveLength(0)
    expect(manager.get(session.id)?.turnStatus).toBe('idle')
  } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
