import { describe, expect, it } from 'bun:test'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'

describe('canonical resource-content workflow', () => {
  it('moves passed resources to the isolated Scene/UI content phase', () => {
    const run = {
      ...createTestDeliveryRun({
        runId: 'resource-review',
        projectId: 'project',
        ownerId: 'owner',
        documentRevision: 'a'.repeat(64),
        checklistApproved: true,
      }),
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_DELIVERED' as const,
        deliveryReceipt: {
          bindings: [],
          catalogObserved: false,
          resourceDigest: 'resource-digest',
          acceptedAt: new Date().toISOString(),
        },
      },
    }

    const next = transitionDeliveryRun(run, {
      type: 'resource_preparation_ready',
      resourceRevision: 'b'.repeat(64),
      evidence: {
        path: 'assets/asset-manifest.json',
        kind: 'resource_preparation',
        revision: 'b'.repeat(64),
        status: 'passed',
        observedAt: new Date().toISOString(),
      },
    })

    expect(next).toMatchObject({
      phase: 'GAME_CONTENT',
      documentStep: undefined,
    })
  })
})
