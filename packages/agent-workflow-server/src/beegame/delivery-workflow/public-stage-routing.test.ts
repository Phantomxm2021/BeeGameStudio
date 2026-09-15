import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  isFoundationStageActive,
  isIrStageActive,
  isPublicStageActive,
} from './public-stage-routing'
import { createInitialDeliveryRun } from './run-store'
import type { DeliveryRun } from './types'

const runWithLinks = (overrides: Partial<DeliveryRun> = {}): DeliveryRun => ({
  ...createInitialDeliveryRun({
    runId: 'routing-run',
    ownerId: 'owner',
    projectId: 'project',
    confirmedBriefContext: 'Routing fixture',
    confirmedBriefDigest: createHash('sha256')
      .update('Routing fixture')
      .digest('hex'),
  }),
  authorStage: { status: 'completed' } as DeliveryRun['authorStage'],
  foundationReviewStage: {
    acceptedReview: {},
  } as DeliveryRun['foundationReviewStage'],
  ...overrides,
})

test('completed Foundation provenance does not block downstream terminal routing', () => {
  const downstreamPhases = [
    'RESOURCE_PREPARATION',
    'IMPLEMENTATION',
    'ACCEPTANCE',
    'DELIVERY',
  ] as const
  for (const phase of downstreamPhases) {
    const run = runWithLinks({ phase, documentStep: undefined })
    expect(isFoundationStageActive(run)).toBe(false)
    expect(isIrStageActive(run)).toBe(false)
    expect(isPublicStageActive(run)).toBe(false)
  }
})

test('Checklist and IR are public stages while Foundation execution is not active', () => {
  const checklist = runWithLinks({
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'CHECKLIST_DRAFTING',
  })
  expect(isFoundationStageActive(checklist)).toBe(false)
  expect(isIrStageActive(checklist)).toBe(false)
  expect(isPublicStageActive(checklist)).toBe(false)

  const ir = runWithLinks({
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'GAME_IR_COMPILATION',
  })
  expect(isFoundationStageActive(ir)).toBe(false)
  expect(isIrStageActive(ir)).toBe(true)
  expect(isPublicStageActive(ir)).toBe(true)

  const foundation = runWithLinks({
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
  })
  expect(isFoundationStageActive(foundation)).toBe(true)
  expect(isIrStageActive(foundation)).toBe(false)
  expect(isPublicStageActive(foundation)).toBe(true)
})
