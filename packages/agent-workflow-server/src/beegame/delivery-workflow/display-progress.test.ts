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
      phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf('DOCUMENT_REVIEW') + 1,
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
      phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf('DOCUMENT_DRAFTING') + 1,
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
})
