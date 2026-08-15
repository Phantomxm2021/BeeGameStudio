import { describe, expect, test } from 'bun:test'
import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
} from './display-progress'

describe('delivery progress projection', () => {
  test('projects report review directly from the workflow phase', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        documentReviewState: {
          activeRun: { scope: 'foundation', attempt: 1 },
        },
      }),
    ).toEqual({
      stageId: 'DOCUMENT_REVIEW',
      phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf('DOCUMENT_REVIEW') + 1,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'INITIAL_REVIEW',
    })
  })

  test('projects report-driven remediation without legacy closure stages', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        documentReviewState: {
          activeRun: {
            scope: 'foundation',
            verdict: 'NEEDS_REVISION',
            attempt: 2,
          },
        },
      }),
    ).toEqual({
      stageId: 'DOCUMENT_DRAFTING',
      phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf('DOCUMENT_DRAFTING') + 1,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'REPAIRING',
      convergencePass: 2,
    })
  })

  test('uses checklist authoring and review substages', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toMatchObject({ substage: 'CHECKLIST_DRAFTING' })
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_REVIEW',
      }),
    ).toMatchObject({ substage: 'CHECKLIST_REVIEW' })
  })
})
