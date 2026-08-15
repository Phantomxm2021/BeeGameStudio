import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

describe('resource entry review authority', () => {
  test('stores only project report approvals as downstream authority', () => {
    const run = createTestDeliveryRun({
      runId: 'resource-entry',
      projectId: 'project',
      ownerId: 'owner',
      checklistApproved: true,
    })

    expect(run.documentReviewState.approvals.checklist).toBeDefined()
    expect(run.documentReviewState).not.toHaveProperty('activeCycle')
    expect(run.documentReviewState).not.toHaveProperty('repairPasses')
  })
})
