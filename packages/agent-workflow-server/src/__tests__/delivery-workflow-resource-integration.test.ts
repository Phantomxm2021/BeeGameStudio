import { describe, expect, it } from 'bun:test'
import { reconcileCurrentResourcePreparation } from '../beegame/delivery-workflow/resource-stage'
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

  it('does not reconcile ready files across an accepted resource finding batch', async () => {
    const initial = createTestDeliveryRun({
      runId: 'run-resource-review-remediation',
      projectId: 'project-resource-review-remediation',
      ownerId: 'owner-resource-review-remediation',
      documentRevision: 'docs',
      workspaceRevision: 'workspace',
    })
    const run = {
      ...initial,
      phase: 'RESOURCE_PREPARATION' as const,
      documentStep: undefined,
      documentReviewState: {
        ...initial.documentReviewState,
        activeCycle: {
          cycleId: 'resource-review-cycle',
          originScope: 'complete' as const,
          scope: 'complete' as const,
          mode: 'initial' as const,
          sourceRevision: 'resources',
          requiredCheckIds: [],
          checks: [],
          checkEvidenceDigests: {},
          findings: [],
          activeTarget: 'resource' as const,
          acceptedSemanticResult: true,
          transportAttempts: 1,
          changedPaths: [],
          sourceArtifactDigests: {},
        },
      },
    }

    expect(
      await reconcileCurrentResourcePreparation({
        run,
        workspacePath: '/workspace-is-not-read',
      }),
    ).toBeUndefined()
  })

  it('preserves the sole accepted resource finding batch when resources are invalidated', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-resource-review-invalidation',
      projectId: 'project-resource-review-invalidation',
      ownerId: 'owner-resource-review-invalidation',
      documentRevision: 'docs',
      workspaceRevision: 'workspace',
    })
    const activeCycle = {
      cycleId: 'resource-review-cycle',
      parentCycleId: 'resource-review-parent-cycle',
      originScope: 'complete' as const,
      scope: 'complete' as const,
      mode: 'closure' as const,
      sourceRevision: 'resources',
      requiredCheckIds: ['resource_content_consistency' as const],
      checks: [],
      checkEvidenceDigests: {},
      findings: [
        {
          findingId: 'resource-format-gap',
          checkId: 'resource_content_consistency' as const,
          severity: 'blocking' as const,
          owner: 'resource' as const,
          subjects: [
            {
              path: 'assets/asset-manifest.json',
              anchor: '/resources/0',
              resourceId: 'resource-1',
            },
          ],
          observation: 'The registered material cannot satisfy its loading contract.',
          blockingReason: 'Implementation cannot load the approved resource role.',
          requiredAction: 'Replace the material in the canonical inventory.',
          closureCondition: 'The same resource role is loadable through the canonical path.',
        },
      ],
      activeTarget: 'resource' as const,
      acceptedSemanticResult: true,
      transportAttempts: 1,
      changedPaths: [],
      sourceArtifactDigests: {},
    }
    const invalidated = transitionDeliveryRun(
      {
        ...initial,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_REVIEW',
        revision: {
          ...initial.revision,
          resource: 'resources',
          implementation: 'implementation',
        },
        documentReviewState: {
          ...initial.documentReviewState,
          activeCycle,
        },
        resourceRemediation: {
          sourceRevision: 'resources',
          attempt: 1,
          issues: ['parallel deterministic repair state'],
        },
      },
      {
        type: 'resource_preparation_invalidated',
        reason: 'resource inventory changed',
      },
    )

    expect(invalidated).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      documentReviewState: {
        activeCycle: {
          cycleId: activeCycle.cycleId,
          findings: [{ findingId: 'resource-format-gap' }],
        },
      },
    })
    expect(invalidated.resourceRemediation).toBeUndefined()
    expect(invalidated.revision.resource).toBeUndefined()
    expect(invalidated.revision.implementation).toBeUndefined()
  })
})
