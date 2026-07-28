import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  calculateCreditsMicro,
  calculateWeightedTokens,
  recordUsage,
  summarizeUsage,
} from '../usage-billing'

const usage = (
  input: Partial<Parameters<typeof calculateWeightedTokens>[0]> = {},
) => ({
  prompt_tokens: 100,
  completion_tokens: 20,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 120,
  ...input,
})

describe('usage token billing', () => {
  test('uses the weighted token pricing baseline and fractional credits', () => {
    expect(calculateWeightedTokens(usage())).toBe(200)
    expect(
      calculateWeightedTokens({ ...usage(), cache_read_tokens: 100 }),
    ).toBe(225)
    expect(calculateCreditsMicro(10_000)).toBe(1_000_000)
  })

  test('records only the usage delta for repeated cumulative snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-usage-'))
    const first = recordUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:1',
    })
    const repeated = recordUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:2',
    })

    expect(first.event.weightedTokensDelta).toBe(200)
    expect(repeated.event.weightedTokensDelta).toBe(0)
    expect(repeated.creditsMicro).toBe(first.creditsMicro)
  })

  test('is idempotent for a repeated event key', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-usage-'))
    const input = {
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:1',
    }
    const first = recordUsage(input)
    const repeated = recordUsage(input)
    const stored = JSON.parse(
      await readFile(join(dataDir, 'usage-billing-events.json'), 'utf8'),
    )

    expect(repeated.duplicate).toBe(true)
    expect(repeated.event.id).toBe(first.event.id)
    expect(stored.events).toHaveLength(1)
  })

  test('summarizes incremental events without re-adding cumulative snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-usage-'))
    const events = [
      recordUsage({
        dataDir,
        userId: 'user-1',
        sessionId: 'session-1',
        usage: usage(),
        idempotencyKey: 'session-1:usage:1',
      }).event,
      recordUsage({
        dataDir,
        userId: 'user-1',
        sessionId: 'session-1',
        usage: usage({
          prompt_tokens: 150,
          completion_tokens: 30,
          total_tokens: 180,
        }),
        idempotencyKey: 'session-1:usage:2',
      }).event,
    ]
    const summary = summarizeUsage(events)

    expect(summary.promptTokens).toBe(150)
    expect(summary.completionTokens).toBe(30)
    expect(summary.totalTokens).toBe(180)
    expect(summary.weightedTokens).toBe(300)
  })

  test('starts a new accounting epoch when a provider snapshot resets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-usage-'))
    recordUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      usage: usage({
        prompt_tokens: 10_000,
        completion_tokens: 1_000,
        total_tokens: 11_000,
      }),
      idempotencyKey: 'session-1:usage:1',
    })
    const nextEpoch = recordUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      usage: usage({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      }),
      idempotencyKey: 'session-1:usage:2',
    })

    expect(nextEpoch.event.weightedTokensDelta).toBe(200)
    expect(nextEpoch.cumulativeWeightedTokens).toBe(15_200)
  })
})
