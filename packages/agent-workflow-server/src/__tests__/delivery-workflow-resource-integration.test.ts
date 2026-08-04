import { describe, expect, it } from 'bun:test'
import { reconcileCurrentResourcePreparation } from '../beegame/delivery-workflow/resource-stage'
import { parseDeliveryRun } from '../beegame/delivery-workflow/schema'
import {
  assertDeliveryRunInvariants,
  transitionDeliveryRun,
} from '../beegame/delivery-workflow/transition'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from './delivery-workflow-test-helpers'

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
      type: 'resource_preparation_ready',
      resourceRevision: 'resources',
      evidence: {
        path: '.beegame/workflow/evidence/resources.json',
        kind: 'resource_preparation',
        revision: 'resources',
        status: 'passed',
        observedAt: new Date().toISOString(),
      },
    })
    expect(next).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_REVIEW',
    })
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
          requiredCheckIds: ['resource_content_consistency' as const],
          completedCheckIds: ['resource_content_consistency' as const],
          checks: [{
            id: 'resource_content_consistency' as const,
            status: 'block' as const,
            conclusion: 'Resource remediation is required.',
            evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
            findingIds: ['resource-review-finding'],
            assessments: [],
          }],
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'resource-review-finding',
              checkId: 'resource_content_consistency' as const,
              severity: 'blocking' as const,
              owner: 'resource' as const,
              evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
              subjects: [
                {
                  path: 'assets/asset-manifest.json',
                  anchor: '/requirements/0',
                  requirementId: 'resource-review-requirement',
                },
              ],
              observation: 'The resource contract is incomplete.',
              blockingImpact: 'The resource cannot be loaded.',
              requiredOutcome:
                'The resource is loadable through the canonical path.',
            },
          ],
          activeTarget: 'resource' as const,
          acceptedSemanticResult: true,
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
      completedCheckIds: ['resource_content_consistency' as const],
      checks: [{
        id: 'resource_content_consistency' as const,
        status: 'block' as const,
        conclusion: 'Resource remediation is required.',
        evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
        findingIds: ['resource-format-gap'],
        assessments: [],
      }],
      checkEvidenceDigests: {},
      findings: [
        {
          findingId: 'resource-format-gap',
          checkId: 'resource_content_consistency' as const,
          severity: 'blocking' as const,
          owner: 'resource' as const,
          evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
          subjects: [
            {
              path: 'assets/asset-manifest.json',
              anchor: '/resources/0',
              resourceId: 'resource-1',
            },
          ],
          observation:
            'The registered material cannot satisfy its loading contract.',
          blockingImpact:
            'Implementation cannot load the approved resource role.',
          requiredOutcome:
            'The same resource role is loadable through the canonical path.',
        },
      ],
      activeTarget: 'resource' as const,
      acceptedSemanticResult: true,
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
      },
      {
        type: 'resource_preparation_required',
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
    expect(invalidated.resourcePreparationAttempt).toBeUndefined()
    expect(invalidated.revision.resource).toBeUndefined()
    expect(invalidated.revision.implementation).toBeUndefined()
  })

  it('rejects Resource Production retry state outside the resource phase', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-invalid-resource-retry',
      projectId: 'project-invalid-resource-retry',
      ownerId: 'owner-invalid-resource-retry',
    })

    expect(() =>
      transitionDeliveryRun(
        {
          ...initial,
          phase: 'DOCUMENT_REVIEW',
          documentStep: 'CHECKLIST_REVIEW',
          resourcePreparationAttempt: 1,
        },
        { type: 'resource_preparation_required' },
      ),
    ).toThrow(
      'resource preparation retry state is valid only in Resource Production',
    )
  })

  it('rejects downstream planning while accepted resource findings still await closure', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-unclosed-resource-review',
      projectId: 'project-unclosed-resource-review',
      ownerId: 'owner-unclosed-resource-review',
    })

    expect(() =>
      assertDeliveryRunInvariants({
        ...initial,
        phase: 'ATOMIC_TASK_PLANNING',
        documentReviewState: {
          ...initial.documentReviewState,
          activeCycle: {
            cycleId: 'unclosed-resource-cycle',
            originScope: 'complete',
            scope: 'complete',
            mode: 'initial',
            sourceRevision: 'resource-revision',
            ...createAcceptedComprehensiveReview(),
            checkEvidenceDigests: {},
            findings: [],
            activeTarget: 'resource',
            acceptedSemanticResult: true,
            changedPaths: [],
            sourceArtifactDigests: {},
          },
        },
      }),
    ).toThrow(
      'accepted resource review findings must remain in Resource Production or Closure Review',
    )
  })

  it('rejects the retired resource remediation state instead of dual-reading it', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-retired-resource-state',
      projectId: 'project-retired-resource-state',
      ownerId: 'owner-retired-resource-state',
    })

    expect(() =>
      parseDeliveryRun({
        ...initial,
        resourceRemediation: {
          sourceRevision: initial.revision.document,
          attempt: 1,
          issues: ['retired state'],
        },
      }),
    ).toThrow()
  })

  it('rejects empty accepted resource authority instead of falling back to Resource Production retry', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-empty-resource-authority',
      projectId: 'project-empty-resource-authority',
      ownerId: 'owner-empty-resource-authority',
    })

    expect(() =>
      assertDeliveryRunInvariants({
        ...initial,
        phase: 'RESOURCE_PREPARATION',
        documentReviewState: {
          ...initial.documentReviewState,
          repairPasses: {
            ...initial.documentReviewState.repairPasses,
            resource: 1,
          },
          activeCycle: {
            cycleId: 'empty-resource-cycle',
            originScope: 'complete',
            scope: 'complete',
            mode: 'initial',
            sourceRevision: 'resource-revision',
            ...createAcceptedComprehensiveReview(),
            checkEvidenceDigests: {},
            findings: [],
            activeTarget: 'resource',
            acceptedSemanticResult: true,
            changedPaths: [],
            sourceArtifactDigests: {},
          },
        },
      }),
    ).toThrow(
      'accepted resource review authority requires at least one resource finding',
    )
  })
})
