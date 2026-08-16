import { describe, expect, test } from 'bun:test'
import { foundationReviewWorkerTerminalSchema } from './worker-contracts'

describe('foundation review worker terminal contract', () => {
  test('binds specialists and final reviewer to one exact staged artifact', () => {
    expect(
      foundationReviewWorkerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        mode: 'initial',
        role: 'contract-specialist',
        reportPath: `.beegame/reviews/foundation/${'a'.repeat(64)}/parts/contract.json`,
      }).role,
    ).toBe('contract-specialist')
    expect(() =>
      foundationReviewWorkerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        mode: 'verification',
        role: 'contract-specialist',
        reportPath: 'wrong.json',
      }),
    ).toThrow()
  })
})
