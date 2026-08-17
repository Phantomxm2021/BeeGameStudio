import { describe, expect, test } from 'bun:test'
import { foundationReviewWorkerTerminalSchema } from './worker-contracts'

describe('foundation review worker terminal contract', () => {
  test('binds initial and verification lanes plus synthesis to exact committed artifacts', () => {
    expect(
      foundationReviewWorkerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        mode: 'initial',
        role: 'core-design',
        reportPath: `.beegame/reviews/foundation/${'a'.repeat(64)}/parts/core-design.json`,
      }).role,
    ).toBe('core-design')
    expect(
      foundationReviewWorkerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        mode: 'initial',
        role: 'synthesis',
        reportPath: `.beegame/reviews/foundation/${'a'.repeat(64)}/review.json`,
      }).role,
    ).toBe('synthesis')
    expect(
      foundationReviewWorkerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        mode: 'verification',
        role: 'core-design',
        reportPath: `.beegame/reviews/foundation/${'a'.repeat(64)}/parts/core-design.json`,
      }).role,
    ).toBe('core-design')
  })
})
