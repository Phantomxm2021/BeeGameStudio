import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_REVISION_PHASES,
  isFoundationRevisionPhase,
} from './foundation-audit-state'
import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
} from './display-progress'

describe('delivery progress projection', () => {
  test('projects every active repair state only from the durable revision phase', () => {
    expect(FOUNDATION_REVISION_PHASES).toEqual([
      'planning',
      'revising',
      'rebuilding_facts',
      'validating',
      'semantic_recheck',
      'publishing',
      'round_closing',
    ])

    for (const status of FOUNDATION_REVISION_PHASES) {
      expect(isFoundationRevisionPhase(status)).toBe(true)
      expect(
        projectDeliveryProgress({
          phase: 'FOUNDATION_REVISION',
          documentStep: 'FOUNDATION_REVISION',
          foundationAuditState: { status },
        }),
      ).toMatchObject({ stageId: 'FOUNDATION_REVISION', substage: 'REPAIRING' })
    }

    expect(isFoundationRevisionPhase('revision_ready')).toBe(false)
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        foundationAuditState: { status: 'revision_ready' },
      }),
    ).toMatchObject({ stageId: 'DOCUMENT_REVIEW', substage: 'INITIAL_REVIEW' })
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
        foundationAuditState: { status: 'planning' },
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
        foundationAuditState: { status: 'revising' },
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
