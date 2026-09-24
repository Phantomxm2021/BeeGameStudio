import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { BeeGameSessionManager } from './session-manager'

test('resource, content and implementation turns share one native project conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-shared-production-session-'))
  let runnerStarts = 0
  const submitted: string[] = []
  const manager = new BeeGameSessionManager({
    async start(input) {
      runnerStarts++
      input.onNativeSessionId?.('8f32a03b-92ae-4452-8b1e-84319790388b')
      return {
        stop() {},
        async submit(turn) {
          submitted.push(typeof turn.prompt === 'string' ? turn.prompt : 'prompt')
          await turn.onMessage({ type: 'assistant', message: {
            id: `message-${submitted.length}`,
            content: [{ type: 'text', text: `Stage ${submitted.length} completed.` }],
          } })
          await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
        },
      }
    },
  }, root)
  const project = join(root, 'project')
  const projectSession = manager.start({ workspacePath: project, userId: 'owner', projectId: 'project' })
  const port = createBeeGameDeliveryWorkerPort({ sessions: manager, userId: 'owner' })
  try {
    const stages = [
      { id: 'resources', workerType: 'resource-planner', phase: 'RESOURCE_PREPARATION' },
      { id: 'content', workerType: 'content-author', phase: 'GAME_CONTENT' },
      { id: 'implementation', workerType: 'implementation-worker', phase: 'IMPLEMENTATION' },
    ] as const
    for (const stage of stages) {
      await port.start({ dispatchId: stage.id, runId: 'run-1', ownerId: 'owner', projectId: 'project',
        workspacePath: project, workerType: stage.workerType, phase: stage.phase, revision: 'rev-1',
        ...(stage.id === 'implementation' ? { taskId: 'DIRECT_IMPLEMENTATION' } : {}), contract: {} })
      // The dispatcher begins observing before it submits the next turn.
      const terminal = port.waitForTerminal!(stage.id).then(value => value, error => error)
      await port.submit(stage.id, `Do ${stage.id}`)
      await manager.waitForSessionIdle(projectSession.id)
      expect(await terminal).not.toBeInstanceOf(Error)
      await port.close?.(stage.id)
    }
    expect(runnerStarts).toBe(1)
    expect(manager.list('owner')).toHaveLength(1)
    expect(manager.runtimeSnapshot(projectSession.id, project).nativeSessionId)
      .toBe('8f32a03b-92ae-4452-8b1e-84319790388b')
    const stageMessages = manager.events(projectSession.id).filter(event =>
      event.type === 'assistant.message' && event.payload?.workflowRunId === 'run-1')
    expect(stageMessages.map(event => event.payload?.workflowWorkerType)).toEqual([
      'resource-planner', 'content-author', 'implementation-worker',
    ])
    expect(submitted).toHaveLength(3)
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('stopping a phase leaves the project session open and the next turn resumes the same native ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-shared-production-stop-'))
  let releaseFirst!: () => void
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve })
  const firstDrain = new Promise<void>(resolve => { releaseFirst = resolve })
  const resumeIds: (string | undefined)[] = []
  let submitted = 0
  const manager = new BeeGameSessionManager({
    async start(input) {
      resumeIds.push(input.resumeSessionId)
      if (!input.resumeSessionId) input.onNativeSessionId?.('8f32a03b-92ae-4452-8b1e-84319790388b')
      return {
        stop() {},
        async submit(turn) {
          submitted++
          if (submitted === 1) {
            markFirstStarted()
            await firstDrain
            return
          }
          await turn.onMessage({ type: 'assistant', message: {
            id: 'resumed-message', content: [{ type: 'text', text: 'Continued.' }],
          } })
          await turn.onMessage({ type: 'result', subtype: 'success', result: 'Continued.' })
        },
      }
    },
  }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'Start first production phase', {
      workflowContext: { runId: 'run', dispatchId: 'stage', workerType: 'content-author', phase: 'GAME_CONTENT' },
    })
    await firstStarted
    manager.interruptTurn(session.id, 'stage_cancelled')
    releaseFirst()
    await manager.waitForSessionIdle(session.id)
    expect(manager.get(session.id)).toMatchObject({ status: 'running', turnStatus: 'idle' })
    await manager.sendWithDisplay(session.id, 'Continue the same project conversation')
    await manager.waitForSessionIdle(session.id)
    expect(resumeIds).toEqual([undefined, '8f32a03b-92ae-4452-8b1e-84319790388b'])
    expect(manager.list('owner')).toHaveLength(1)
    expect(manager.get(session.id)?.status).toBe('running')
  } finally {
    releaseFirst()
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
