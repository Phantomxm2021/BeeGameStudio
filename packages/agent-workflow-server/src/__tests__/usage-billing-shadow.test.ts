import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  calculateShadowCreditsMicro,
  calculateShadowWeightedTokens,
  recordShadowUsage,
  summarizeShadowUsage,
} from '../usage-billing-shadow'

const usage = (
  input: Partial<Parameters<typeof calculateShadowWeightedTokens>[0]> = {},
) => ({
  prompt_tokens: 100,
  completion_tokens: 20,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 120,
  ...input,
})

describe('shadow token billing', () => {
  test('uses the weighted token pricing baseline and fractional credits', () => {
    expect(calculateShadowWeightedTokens(usage())).toBe(200)
    expect(calculateShadowCreditsMicro(10_000)).toBe(1_000_000)
  })

  test('records only the usage delta for repeated cumulative snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-shadow-'))
    const first = recordShadowUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:1',
    })
    const repeated = recordShadowUsage({
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:2',
    })

    expect(first.event.weightedTokensDelta).toBe(200)
    expect(repeated.event.weightedTokensDelta).toBe(0)
    expect(repeated.shadowCreditsMicro).toBe(first.shadowCreditsMicro)
  })

  test('is idempotent for a repeated event key', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-shadow-'))
    const input = {
      dataDir,
      userId: 'user-1',
      sessionId: 'session-1',
      usage: usage(),
      idempotencyKey: 'session-1:usage:1',
    }
    const first = recordShadowUsage(input)
    const repeated = recordShadowUsage(input)
    const stored = JSON.parse(
      await readFile(join(dataDir, 'usage-billing-shadow.json'), 'utf8'),
    )

    expect(repeated.duplicate).toBe(true)
    expect(repeated.event.id).toBe(first.event.id)
    expect(stored.events).toHaveLength(1)
  })

  test('summarizes incremental events without re-adding cumulative snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-shadow-'))
    const events = [
      recordShadowUsage({
        dataDir,
        userId: 'user-1',
        sessionId: 'session-1',
        usage: usage(),
        idempotencyKey: 'session-1:usage:1',
      }).event,
      recordShadowUsage({
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
    const summary = summarizeShadowUsage(events)

    expect(summary.promptTokens).toBe(150)
    expect(summary.completionTokens).toBe(30)
    expect(summary.totalTokens).toBe(180)
    expect(summary.weightedTokens).toBe(300)
  })

  test('starts a new accounting epoch when a provider snapshot resets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-shadow-'))
    recordShadowUsage({
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
    const nextEpoch = recordShadowUsage({
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
