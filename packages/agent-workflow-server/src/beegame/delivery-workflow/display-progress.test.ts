import { describe, expect, test } from 'bun:test'
import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
} from './display-progress'

describe('delivery progress projection', () => {
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
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        foundationAuditState: { status: 'planning' },
      }),
    ).toMatchObject({
      stageId: 'FOUNDATION_REVISION',
      phaseIndex: 4,
      phaseCount: 10,
      substage: 'REPAIRING',
    })

    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        foundationAuditState: { status: 'revising' },
      }),
    ).toMatchObject({
      stageId: 'FOUNDATION_REVISION',
      phaseIndex: 4,
      phaseCount: 10,
      substage: 'REPAIRING',
    })
  })

  test('keeps checklist drafting after revision at the virtual revision stage', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toMatchObject({
      stageId: 'FOUNDATION_REVISION',
      phaseIndex: 4,
      phaseCount: 10,
      substage: 'CHECKLIST_DRAFTING',
    })
  })
})
