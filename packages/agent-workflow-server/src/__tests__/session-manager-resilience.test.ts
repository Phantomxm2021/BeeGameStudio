import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BeeGameSessionManager,
  type BeeGameSessionRunner,
  type DashboardSDKMessage,
} from '../beegame/session-manager'
import {
  QueryEngineWorkerError,
  serializeQueryEngineError,
} from '../beegame/query-engine-worker-protocol'
import type { RecordUsageResult, Usage } from '../usage-billing'

const waitForIdle = async (
  manager: BeeGameSessionManager,
  sessionId: string,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (manager.get(sessionId)?.turnStatus === 'idle') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('session did not become idle')
}

const usageMessage = (tokens: number): DashboardSDKMessage =>
  ({
    type: 'stream_event',
    event: {
      type: 'message_delta',
      usage: { input_tokens: tokens, output_tokens: 0 },
    },
  }) as DashboardSDKMessage

const usageResult = (
  usage: Usage,
  idempotencyKey: string,
): RecordUsageResult => ({
  event: {
    id: idempotencyKey,
    idempotencyKey,
    userId: 'user-1',
    sessionId: 'session-1',
    pricingVersion: 'test-v1',
    usageSource: 'runtime_snapshot',
    usage,
    delta: usage,
    weightedTokens: 0,
    weightedTokensDelta: 0,
    creditsMicro: 0,
    createdAt: new Date().toISOString(),
    metadata: {},
  },
  duplicate: false,
  cumulativeUsage: usage,
  cumulativeWeightedTokens: 0,
  creditsMicro: 0,
})

describe('BeeGame session runtime resilience', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  test('preserves structured transport retryability across worker boundaries', () => {
    const nativeError = Object.assign(new Error('transport failed'), {
      cause: { code: 'CERTIFICATE_VERIFY_FAILED' },
    })
    const serialized = serializeQueryEngineError(nativeError, 'fallback')
    const reconstructed = new QueryEngineWorkerError(serialized)

    expect(serialized).toMatchObject({
      causeCode: 'CERTIFICATE_VERIFY_FAILED',
      retryable: true,
    })
    expect(reconstructed).toMatchObject({
      message: 'transport failed',
      retryable: true,
    })
  })

  test('restarts once when a retryable worker failure precedes all runtime messages', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-retry-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        const current = starts
        return {
          submit: async () => {
            if (current === 1) {
              throw new QueryEngineWorkerError({
                message: 'temporary transport failure',
                name: 'Error',
                code: 'ECONNRESET',
                retryable: true,
              })
            }
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(2)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(false)
    manager.dispose()
  })

  test('does not replay a turn after the runtime emitted an event', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-runtime-no-replay-'))
    let starts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => {
        starts += 1
        return {
          submit: async input => {
            input.onMessage({
              type: 'stream_event',
              event: { type: 'message_start' },
            } as DashboardSDKMessage)
            throw new QueryEngineWorkerError({
              message: 'temporary transport failure',
              name: 'Error',
              code: 'ECONNRESET',
              retryable: true,
            })
          },
          stop: () => undefined,
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(starts).toBe(1)
    expect(
      manager.events(session.id).some(event => event.type === 'turn.failed'),
    ).toBe(true)
    manager.dispose()
  })

  test('coalesces cumulative usage snapshots while a write is in flight', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-coalesce-'))
    const recorded: Usage[] = []
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => {
          input.onMessage(usageMessage(10))
          input.onMessage(usageMessage(20))
          input.onMessage(usageMessage(30))
        },
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root, () => ({}), {
      recordUsage: async (_userId, input) => {
        recorded.push(input.usage)
        if (recorded.length === 1) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        return usageResult(input.usage, input.idempotencyKey)
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    await waitForIdle(manager, session.id)

    expect(recorded).toHaveLength(2)
    expect(recorded[1]!.total_tokens).toBeGreaterThan(recorded[0]!.total_tokens)
    manager.dispose()
  })

  test('bounds failed usage retries and does not append billing errors after stop', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-usage-stop-'))
    let attempts = 0
    const runner: BeeGameSessionRunner = {
      start: async () => ({
        submit: async input => input.onMessage(usageMessage(10)),
        stop: () => undefined,
      }),
    }
    const manager = new BeeGameSessionManager(runner, root, () => ({}), {
      recordUsage: async () => {
        attempts += 1
        throw new Error('billing transport failed')
      },
    })
    const session = manager.start({
      workspacePath: join(root, 'workspace'),
      userId: 'user-1',
    })

    await manager.send(session.id, 'continue')
    for (let wait = 0; wait < 50 && attempts === 0; wait += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    manager.stop(session.id)
    await new Promise(resolve => setTimeout(resolve, 350))

    expect(attempts).toBe(3)
    expect(
      manager
        .events(session.id)
        .some(event => event.payload?.type === 'billing.usage_record_failed'),
    ).toBe(false)
    manager.dispose()
  })
})
