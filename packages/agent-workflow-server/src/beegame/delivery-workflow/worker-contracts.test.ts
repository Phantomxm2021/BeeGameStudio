import { describe, expect, test } from 'bun:test'
import {
  documentAuthorTerminalSchema,
  foundationReviewWorkerTerminalSchema,
} from './worker-contracts'

test('binds a foundation remediation terminal to its committed receipt', () => {
  const receipt = {
    reviewDigest: 'a'.repeat(64),
    sourceRevision: 'b'.repeat(64),
    targetPath: 'docs/GDD.md' as const,
    sourceDigest: 'c'.repeat(64),
    patchedUnitIds: ['section:core-loop'],
    finalDigest: 'd'.repeat(64),
    committedAt: '2026-08-17T11:00:00.000Z',
  }
  expect(
    documentAuthorTerminalSchema.parse({
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: ['docs/GDD.md'],
      remediationReceipt: receipt,
    }),
  ).toMatchObject({ remediationReceipt: receipt })
})

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
