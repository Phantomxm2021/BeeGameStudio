import { describe, expect, test } from 'bun:test'
import { projectDeliveryProgress } from './display-progress'

describe('delivery display progress', () => {
  test('projects accepted foundation remediation as stage four', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        documentReviewState: {
          repairPasses: { foundation: 1 },
          activeCycle: {
            acceptedSemanticResult: true,
            activeTarget: 'foundation',
            mode: 'initial',
          },
        },
      }),
    ).toEqual({
      stageId: 'DOCUMENT_CONVERGENCE',
      phaseIndex: 4,
      phaseCount: 11,
      substage: 'REPAIR_PLANNING',
      convergencePass: 1,
    })
  })

  test('keeps foundation closure and checklist work in stage four', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        documentReviewState: {
          repairPasses: { foundation: 2 },
          activeCycle: { mode: 'closure', activeTarget: 'foundation' },
        },
      }),
    ).toEqual({
      stageId: 'DOCUMENT_CONVERGENCE',
      phaseIndex: 4,
      phaseCount: 11,
      substage: 'CLOSURE_REVIEW',
      convergencePass: 2,
    })
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toEqual({
      stageId: 'DOCUMENT_CONVERGENCE',
      phaseIndex: 4,
      phaseCount: 11,
      substage: 'CHECKLIST_DRAFTING',
    })
  })

  test('keeps complete-scope review and remediation in stage six', () => {
    const completeCycle = {
      originScope: 'complete',
      scope: 'complete',
      mode: 'initial',
    }
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'COMPREHENSIVE_REVIEW',
        documentReviewState: { activeCycle: completeCycle },
      }),
    ).toEqual({
      stageId: 'COMPREHENSIVE_CONVERGENCE',
      phaseIndex: 6,
      phaseCount: 11,
      substage: 'INITIAL_REVIEW',
    })
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        documentReviewState: {
          repairPasses: { foundation: 1 },
          activeCycle: {
            ...completeCycle,
            acceptedSemanticResult: true,
            activeTarget: 'foundation',
            repairPlan: { groups: [], completedPaths: [] },
          },
        },
      }),
    ).toEqual({
      stageId: 'COMPREHENSIVE_CONVERGENCE',
      phaseIndex: 6,
      phaseCount: 11,
      substage: 'REPAIRING',
      convergencePass: 1,
    })
    expect(
      projectDeliveryProgress({
        phase: 'RESOURCE_PREPARATION',
        documentReviewState: {
          repairPasses: { resource: 1 },
          activeCycle: {
            ...completeCycle,
            acceptedSemanticResult: true,
            activeTarget: 'resource',
          },
        },
      }),
    ).toEqual({
      stageId: 'COMPREHENSIVE_CONVERGENCE',
      phaseIndex: 6,
      phaseCount: 11,
      substage: 'REPAIRING',
      convergencePass: 1,
    })
  })

  test('shifts downstream stages after comprehensive convergence', () => {
    expect(projectDeliveryProgress({ phase: 'RESOURCE_PREPARATION' })).toEqual({
      stageId: 'RESOURCE_PREPARATION',
      phaseIndex: 5,
      phaseCount: 11,
    })
    expect(projectDeliveryProgress({ phase: 'DELIVERY' })).toEqual({
      stageId: 'DELIVERY',
      phaseIndex: 11,
      phaseCount: 11,
    })
  })

  test('projects initial drafting without inventing a convergence pass', () => {
    expect(
      projectDeliveryProgress({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      }),
    ).toEqual({
      stageId: 'DOCUMENT_DRAFTING',
      phaseIndex: 2,
      phaseCount: 11,
      substage: 'INITIAL_DRAFTING',
    })
  })
})
