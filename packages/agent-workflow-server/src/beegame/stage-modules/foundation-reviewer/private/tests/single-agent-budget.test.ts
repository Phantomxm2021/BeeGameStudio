import { expect, test } from 'bun:test'
import { consumedReviewTime, consumedReviewTokens } from '../single-agent-budget'
import type { SingleReviewAttempt } from '../single-agent-journal'

test('active execution time and usage add across sealed attempts, not just the latest turn', () => {
  const attempts: SingleReviewAttempt[] = [1, 2, 3].map(index => ({ id: String(index), closed: {
    kind: 'closed', attemptId: String(index), elapsedMs: 240_000, sealScope: 'direct-child', summary: { modelMessages: 1, structuredOutputCalls: 0, structuredOutputSuccesses: 0, structuredOutputFailures: 0, usageSource: 'terminal' }, usageObserved: true,
    usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 2, cache_creation_tokens: 1, total_tokens: 18 },
    outcome: { kind: 'failed', code: 'stopped' },
  } }))
  expect(consumedReviewTime({ attempts })).toBe(720_000)
  expect(consumedReviewTokens({ attempts })).toBe(54)
  attempts.push({ id: 'in-flight',     usage: { prompt_tokens: 10, completion_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 11 } })
  expect(consumedReviewTokens({ attempts })).toBe(65)
})
