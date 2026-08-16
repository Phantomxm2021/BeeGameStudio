import { describe, expect, it } from 'bun:test'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'

describe('canonical resource-content workflow', () => {
  it('moves passed resources directly to atomic task planning', () => {
    const run = {
      ...createTestDeliveryRun({
        runId: 'resource-review',
        projectId: 'project',
        ownerId: 'owner',
        documentRevision: 'a'.repeat(64),
        checklistApproved: true,
      }),
      phase: 'RESOURCE_PREPARATION' as const,
    }

    const next = transitionDeliveryRun(run, {
      type: 'resource_preparation_ready',
      resourceRevision: 'b'.repeat(64),
      evidence: {
        path: '.beegame/workflow/evidence/resources.json',
        kind: 'resource_preparation',
        revision: 'b'.repeat(64),
        status: 'passed',
        observedAt: new Date().toISOString(),
      },
    })

    expect(next).toMatchObject({
      phase: 'ATOMIC_TASK_PLANNING',
      documentStep: undefined,
    })
  })

  it('plans tasks without a retired complete-review approval', () => {
    const run = {
      ...createTestDeliveryRun({
        runId: 'resource-gate',
        projectId: 'project',
        ownerId: 'owner',
        checklistApproved: true,
      }),
      phase: 'ATOMIC_TASK_PLANNING' as const,
      revision: {
        document: 'a'.repeat(64),
        resource: 'b'.repeat(64),
        workspace: 'c'.repeat(64),
      },
      evidence: {
        resourcePreparation: {
          path: '.beegame/workflow/evidence/resources.json',
          kind: 'resource_preparation' as const,
          revision: 'b'.repeat(64),
          status: 'passed' as const,
          observedAt: new Date().toISOString(),
        },
      },
    }

    const next = transitionDeliveryRun(run, {
      type: 'tasks_planned',
      tasks: [
        {
          id: 'task-1',
          title: 'Implement the first verified slice',
          checklistIds: ['check-1'],
          resourceIds: ['resource-1'],
          contentIds: [],
          dependsOn: [],
          allowedPaths: ['src/game.ts'],
          expectedArtifacts: ['src/game.ts'],
          verification: [
            {
              kind: 'test',
              commandOrAction: 'bun test',
              expectedResult: 'passes',
            },
          ],
          status: 'pending',
          attempt: 0,
          evidenceRefs: ['.beegame/workflow/evidence/resources.json'],
        },
      ],
    })
    expect(next.phase).toBe('IMPLEMENTATION')
  })
})
