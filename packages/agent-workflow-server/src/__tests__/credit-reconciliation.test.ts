import { describe, expect, test } from 'bun:test'
import { reconcileCreditLedgers } from '../credit-reconciliation'

describe('credit reconciliation', () => {
  test('compares incremental shadow usage with legacy settlement entries', () => {
    const report = reconcileCreditLedgers(
      [
        {
          id: 'event-1',
          idempotencyKey: 'key-1',
          userId: 'user-1',
          sessionId: 'session-1',
          pricingVersion: 'weighted-v1',
          usageSource: 'runtime_snapshot',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            total_tokens: 120,
          },
          delta: {
            prompt_tokens: 100,
            completion_tokens: 20,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            total_tokens: 120,
          },
          weightedTokens: 200,
          weightedTokensDelta: 200,
          shadowCreditsMicro: 20_000,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: {},
        },
      ],
      [
        {
          id: 'legacy-1',
          userId: 'user-1',
          kind: 'settle',
          credits: 1,
          weightedTokens: 10_000,
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    )

    expect(report.status).toBe('diverged')
    expect(report.shadow.credits).toBe(0.02)
    expect(report.legacy.settledCredits).toBe(1)
    expect(report.difference.weightedTokens).toBe(9_800)
  })

  test('reports an empty legacy ledger as shadow-only during rollout', () => {
    const report = reconcileCreditLedgers([], [])
    expect(report.status).toBe('aligned')
    expect(report.shadow.creditsMicro).toBe(0)
  })
})
