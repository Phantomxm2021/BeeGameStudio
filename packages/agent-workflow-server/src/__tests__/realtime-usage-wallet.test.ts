import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { debitLocalRealtimeUsage } from '../realtime-usage-wallet'
import type { RecordShadowUsageResult } from '../usage-billing-shadow'

function shadowResult(amount: number): RecordShadowUsageResult {
  return {
    duplicate: false,
    event: {
      id: 'event-1',
      idempotencyKey: 'usage-1',
      userId: 'user-1',
      sessionId: 'session-1',
      pricingVersion: 'weighted-v1',
      usageSource: 'runtime_snapshot',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 2,
      },
      delta: {
        prompt_tokens: 1,
        completion_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 2,
      },
      weightedTokens: amount,
      weightedTokensDelta: amount,
      shadowCreditsMicro: amount,
      createdAt: new Date().toISOString(),
      metadata: {},
    },
    cumulativeUsage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 2,
    },
    cumulativeWeightedTokens: amount,
    shadowCreditsMicro: amount,
  }
}

describe('local realtime usage wallet', () => {
  test('debits once for an idempotent usage event', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-wallet-'))
    try {
      const first = debitLocalRealtimeUsage({
        dataDir,
        userId: 'user-1',
        idempotencyKey: 'usage-1',
        shadow: shadowResult(100),
      })
      const repeated = debitLocalRealtimeUsage({
        dataDir,
        userId: 'user-1',
        idempotencyKey: 'usage-1',
        shadow: shadowResult(100),
      })
      expect(first.duplicate).toBe(false)
      expect(repeated.duplicate).toBe(true)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('rejects a debit that exceeds the local wallet balance', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-wallet-'))
    try {
      expect(() =>
        debitLocalRealtimeUsage({
          dataDir,
          userId: 'user-1',
          idempotencyKey: 'usage-large',
          shadow: shadowResult(300 * 1_000_000 + 1),
        }),
      ).toThrow('Insufficient realtime usage credits')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
