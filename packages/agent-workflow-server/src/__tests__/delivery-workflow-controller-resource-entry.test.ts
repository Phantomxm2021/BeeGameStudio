import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

describe('resource entry authority', () => {
  test('does not retain a second Reviewer approval state machine', () => {
    const run = createTestDeliveryRun({
      runId: 'resource-entry',
      projectId: 'project',
      ownerId: 'owner',
      checklistApproved: true,
    })

    expect(run).not.toHaveProperty('documentReviewState')
  })
})
