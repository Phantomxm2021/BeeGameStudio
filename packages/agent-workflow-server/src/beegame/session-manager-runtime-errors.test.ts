import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
  getSDKExecutionErrorDetail,
  workflowToolRestriction,
} from './session-manager'

describe('BeeGame SDK execution errors', () => {
  test('preserves a structured runtime result when the SDK omits its errors array', () => {
    expect(
      getSDKExecutionErrorDetail({
        type: 'result',
        is_error: true,
        result: 'Provider request reached its deadline.',
      }),
    ).toBe('Provider request reached its deadline.')
  })

  test('prefers the SDK errors array when it is available', () => {
    expect(
      getSDKExecutionErrorDetail({
        type: 'result',
        is_error: true,
        result: 'Fallback detail',
        errors: ['Primary detail'],
      }),
    ).toBe('Primary detail')
  })

  test('limits Checklist authors to candidate writes without allowing a shell escape', () => {
    const record = { workflowAllowedTools: ['Write', 'Edit'] }
    expect(
      workflowToolRestriction(
        record as never,
        {
          toolName: 'Write',
        } as never,
      ),
    ).toBeUndefined()
    expect(
      workflowToolRestriction(
        record as never,
        {
          toolName: 'Bash',
        } as never,
      ),
    ).toContain('Write, Edit')
    expect(
      workflowToolRestriction(
        record as never,
        {
          toolName: 'Read',
        } as never,
      ),
    ).toContain('Write, Edit')
  })

  test('keeps record stream bodies in-process while events and logs expose metadata only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-record-stream-'))
    const workspace = join(root, 'workspace')
    const dataRoot = join(root, 'data')
    const sentinel = 'PRIVATE_RECORD_BODY_SHOULD_NEVER_ESCAPE'
    const runner = {
      start: async () => ({
        submit: async (input: { onMessage(message: Record<string, unknown>): void }) => {
          input.onMessage({
            type: 'result',
            record_stream: sentinel,
          })
        },
        stop: () => undefined,
      }),
    }
    try {
      const manager = new BeeGameSessionManager(runner as never, dataRoot)
      const session = manager.start({
        workspacePath: workspace,
        userId: 'user',
        workflowWorker: true,
        workflowRunId: 'run',
        workflowDispatchId: 'dispatch',
        workflowWorkerType: 'game-ir-compiler',
        workflowRecordStreamContract: {
          version: 1,
          terminalRecord: { record: 'done', sliceId: 'slice.0' },
        },
      })
      await manager.send(session.id, 'prompt')
      await new Promise(resolve => setTimeout(resolve, 20))

      const event = manager.events(session.id).find(item => item.type === 'result')
      expect(event).toBeDefined()
      expect(JSON.stringify(event)).not.toContain(sentinel)
      expect(event?.payload).toMatchObject({
        type: 'result',
        record_stream_digest: expect.any(String),
        record_stream_bytes: Buffer.byteLength(sentinel),
        record_stream_lines: 1,
      })

      const internal = manager.workflowRecordStreamEvents(session.id)
      expect(internal.find(item => item.type === 'result')?.payload).toMatchObject({
        type: 'result',
        record_stream: sentinel,
      })

      const transcriptPath = manager.metadata(session.id)!.transcriptPath
      const transcript = await readFile(transcriptPath, 'utf8')
      const runtimeLog = await readFile(
        join(workspace, '.beegame', 'workflow', 'logs', 'run', 'dispatch', 'runtime.log'),
        'utf8',
      )
      const agentRawLog = await readFile(
        join(workspace, '.beegame', 'workflow', 'logs', 'run', 'dispatch', 'agent.raw.jsonl'),
        'utf8',
      )
      expect(transcript).not.toContain(sentinel)
      expect(runtimeLog).not.toContain(sentinel)
      expect(agentRawLog).not.toContain(sentinel)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps provider error and usage bodies out of agent raw logs while retaining in-process diagnosis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-provider-error-'))
    const workspace = join(root, 'workspace')
    const dataRoot = join(root, 'data')
    const sentinel = 'PRIVATE_PROVIDER_ERROR_AND_USAGE_BODY'
    const runner = {
      start: async () => ({
        submit: async (input: { onMessage(message: Record<string, unknown>): void }) => {
          input.onMessage({
            type: 'stream_event',
            event: {
              type: 'message_delta',
              text: sentinel,
              usage: { total_tokens: 0, marker: sentinel },
            },
          })
          input.onMessage({
            type: 'result',
            subtype: 'error',
            is_error: true,
            result: sentinel,
            errors: [sentinel],
          })
        },
        stop: () => undefined,
      }),
    }
    try {
      const manager = new BeeGameSessionManager(runner as never, dataRoot)
      const session = manager.start({
        workspacePath: workspace,
        userId: 'user',
        workflowWorker: true,
        workflowRunId: 'run',
        workflowDispatchId: 'dispatch',
        workflowWorkerType: 'game-ir-compiler',
      })
      await manager.send(session.id, 'prompt')
      await new Promise(resolve => setTimeout(resolve, 20))

      const failed = manager
        .events(session.id)
        .find(item => item.type === 'turn.failed')
      expect(failed?.text).toContain(sentinel)

      const agentRawLog = await readFile(
        join(workspace, '.beegame', 'workflow', 'logs', 'run', 'dispatch', 'agent.raw.jsonl'),
        'utf8',
      )
      expect(agentRawLog).not.toContain(sentinel)
      expect(agentRawLog).toContain('"type":"result"')
      expect(agentRawLog).toContain('"type":"usage"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
