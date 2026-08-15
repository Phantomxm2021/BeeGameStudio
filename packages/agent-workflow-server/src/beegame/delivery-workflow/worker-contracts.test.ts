import { describe, expect, test } from 'bun:test'
import { documentReviewerTerminalSchema } from './worker-contracts'

describe('document reviewer terminal contract', () => {
  test('accepts one committed specialist report without semantic JSON', () => {
    expect(
      documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        scope: 'foundation',
        role: 'gameplay',
        reportPaths: [
          `.beegame/reviews/foundation/${'a'.repeat(64)}/parts/gameplay.md`,
        ],
      }),
    ).not.toHaveProperty('findings')
  })

  test('accepts a final file-derived routing decision', () => {
    expect(
      documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        scope: 'foundation',
        role: 'final',
        reportPaths: [
          `.beegame/reviews/foundation/${'a'.repeat(64)}/review.md`,
          `.beegame/reviews/foundation/${'a'.repeat(64)}/decision.json`,
        ],
        verdict: 'NEEDS_REVISION',
        affectedPaths: ['docs/GDD.md'],
      }).verdict,
    ).toBe('NEEDS_REVISION')
  })
})
