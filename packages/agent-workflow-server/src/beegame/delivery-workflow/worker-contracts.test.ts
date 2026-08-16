import { describe, expect, test } from 'bun:test'
import {
  documentReviewerTerminalSchema,
  foundationReviewWorkerTerminalSchema,
} from './worker-contracts'

describe('document reviewer terminal contract', () => {
  test('accepts one committed non-Foundation specialist report', () => {
    expect(
      documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        scope: 'checklist',
        role: 'checklist',
        reportPaths: [
          `.beegame/reviews/checklist/${'a'.repeat(64)}/parts/checklist.md`,
        ],
      }),
    ).not.toHaveProperty('findings')
  })

  test('accepts one Foundation review artifact without terminal routing fields', () => {
    expect(
      documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        scope: 'foundation',
        role: 'final',
        reportPaths: [
          `.beegame/reviews/foundation/${'a'.repeat(64)}/review.json`,
        ],
      }),
    ).not.toHaveProperty('verdict')
    expect(() =>
      documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        status: 'completed',
        revision: 'a'.repeat(64),
        scope: 'foundation',
        role: 'final',
        reportPaths: [
          `.beegame/reviews/foundation/${'a'.repeat(64)}/review.json`,
        ],
        verdict: 'READY',
        affectedPaths: [],
      }),
    ).toThrow()
  })
})

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
