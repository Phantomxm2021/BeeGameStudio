import { describe, expect, test } from 'bun:test'
import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
} from './display-progress'

describe('delivery progress projection', () => {
  test('projects public Reviewer and Revision links as their display stages', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        foundationReviewStage: { invocation: { stage: 'reviewer' } },
      }),
    ).toMatchObject({ stageId: 'DOCUMENT_REVIEW', substage: 'INITIAL_REVIEW' })

    expect(
      projectDeliveryProgress({
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationReviewStage: { invocation: { stage: 'revision' } },
      }),
    ).toMatchObject({ stageId: 'FOUNDATION_REVISION', substage: 'REPAIRING' })
  })

  test('projects the document audit boundary directly from the workflow phase', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      }),
    ).toEqual({
      stageId: 'DOCUMENT_REVIEW',
      phaseIndex: 3,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'INITIAL_REVIEW',
    })
  })

  test('projects Foundation drafting without remediation state', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      }),
    ).toEqual({
      stageId: 'DOCUMENT_DRAFTING',
      phaseIndex: 2,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'INITIAL_DRAFTING',
    })
  })

  test('keeps a public author handoff in drafting until Reviewer has a public link', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        authorStage: { protocolVersion: 1, status: 'completed' },
      }),
    ).toEqual({
      stageId: 'DOCUMENT_DRAFTING',
      phaseIndex: 2,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
      substage: 'INITIAL_DRAFTING',
    })
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        authorStage: { protocolVersion: 1, status: 'completed' },
        foundationReviewStage: { invocation: { stage: 'reviewer' } },
      }),
    ).toMatchObject({ stageId: 'DOCUMENT_REVIEW', substage: 'INITIAL_REVIEW' })
  })

  test('uses only the deterministic checklist authoring substage', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toMatchObject({ substage: 'CHECKLIST_DRAFTING' })
  })

  test('projects an active foundation revision as a repairing substage', () => {
    expect(
      projectDeliveryProgress({
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationReviewStage: { invocation: { stage: 'revision' } },
      }),
    ).toMatchObject({
      stageId: 'FOUNDATION_REVISION',
      phaseIndex: 4,
      phaseCount: 11,
      substage: 'REPAIRING',
    })

    expect(
      projectDeliveryProgress({
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationReviewStage: { invocation: { stage: 'revision' } },
      }),
    ).toMatchObject({
      stageId: 'FOUNDATION_REVISION',
      phaseIndex: 4,
      phaseCount: 11,
      substage: 'REPAIRING',
    })
  })

  test('projects checklist authoring as its own stage after Foundation revision', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toMatchObject({
      stageId: 'CHECKLIST_AUTHORING',
      phaseIndex: 5,
      phaseCount: 11,
      substage: 'CHECKLIST_DRAFTING',
    })
  })
})
