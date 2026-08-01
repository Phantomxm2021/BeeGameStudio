import { describe, expect, it } from 'bun:test'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

describe('v7 resource-content workflow', () => {
  it('moves directly from resource preparation to comprehensive review', () => {
    const run = {
      ...createTestDeliveryRun({
        runId: 'run-resource-content',
        projectId: 'project-resource-content',
        ownerId: 'owner-resource-content',
        documentRevision: 'docs',
        workspaceRevision: 'workspace',
      }),
      phase: 'RESOURCE_PREPARATION' as const,
      documentStep: undefined,
    }
    const next = transitionDeliveryRun(run, {
      type: 'resource_preparation_ready', resourceRevision: 'resources',
      evidence: { path: '.beegame/workflow/evidence/resources.json', kind: 'resource_preparation', revision: 'resources', status: 'passed', observedAt: new Date().toISOString() },
    })
    expect(next).toMatchObject({ phase: 'DOCUMENT_REVIEW', documentStep: 'CHECKLIST_REVIEW' })
    expect(next.evidence).not.toHaveProperty('compositionAssembly')
  })
})
