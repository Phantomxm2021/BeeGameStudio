import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager, type BeeGameSessionRunner } from './session-manager'

describe('BeeGame native validator event transport', () => {
  test('records a native asynchronous validator terminal result without polling or repair control', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-validator-event-'))
    const taskDirectory = join(workspace, '.runtime', 'tasks')
    const taskId = 'validator-task'
    const toolUseID = 'validator-tool'
    const outputFile = join(taskDirectory, `${taskId}.output`)
    const report = {
      validatorId: 'beegame-acceptance-validator',
      status: 'passed',
      summary: 'Observed the declared behavior.',
      requirements: [],
      playerPaths: [],
      findings: [],
      verifiedCapabilities: [],
    }
    await mkdir(taskDirectory, { recursive: true })
    await writeFile(outputFile, JSON.stringify(report))

    const runner: BeeGameSessionRunner = {
      async start() {
        return {
          async submit(input) {
            input.onMessage({
              type: 'assistant',
              message: { content: [{
                type: 'tool_use',
                id: toolUseID,
                name: 'Agent',
                input: { subagent_type: 'beegame-acceptance-validator' },
              }] },
            })
            input.onMessage({
              type: 'user',
              message: { content: [{
                type: 'tool_result',
                tool_use_id: toolUseID,
                content: 'Native background task started.',
              }] },
            })
            input.onMessage({
              type: 'system',
              subtype: 'task_notification',
              task_id: taskId,
              tool_use_id: toolUseID,
              status: 'completed',
              output_file: outputFile,
              summary: 'Validator completed.',
            })
            input.onMessage({ type: 'result', result: 'Done' })
          },
          stop() {},
        }
      },
    }

    const manager = new BeeGameSessionManager(runner, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, userId: 'test-user' })
      await manager.sendWithDisplay(session.id, 'Run the native validator.', {
        displayKind: 'confirmed_brief',
      })
      await waitFor(() => manager.get(session.id)?.turnStatus === 'idle')

      const validationEvents = manager.events(session.id)
        .filter(event => event.type === 'delivery.validation')
      expect(validationEvents).toHaveLength(1)
      expect(validationEvents[0]?.payload).toEqual(expect.objectContaining({
        type: 'delivery.validation',
        taskId,
        toolUseID,
        report,
      }))

      const restartedManager = new BeeGameSessionManager(runner, workspace)
      const resumed = restartedManager.start({
        workspacePath: workspace,
        userId: 'test-user',
        transcriptSessionId: session.id,
      })
      expect(restartedManager.requiresProductionContract(resumed.id)).toBe(true)
      expect(restartedManager.events(resumed.id).filter(
        event => event.type === 'delivery.validation',
      )).toHaveLength(1)
      restartedManager.stop(resumed.id)
    } finally {
      manager.list().forEach(session => manager.stop(session.id))
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
