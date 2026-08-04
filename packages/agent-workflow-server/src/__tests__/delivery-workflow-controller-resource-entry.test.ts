import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import { computeDocumentRevision } from '../beegame/delivery-workflow/revision'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'

describe('delivery workflow resource entry', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('restores a missing comprehensive-review prerequisite through the sole resource transition', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-entry-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/asset-manifest.json'),
      `${JSON.stringify({
        version: 7,
        project_target: {
          asset_format_capabilities: ['png'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [{ id: 'visual.player', required: true }],
        resources: [],
      })}\n`,
    )

    let dispatched: WorkerDispatchRequest | undefined
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: 'owner-resource-entry',
      workerPort: {
        async start(request) {
          dispatched = request
          return {
            sessionId: 'resource-entry-session',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const initial = createTestDeliveryRun({
      runId: 'run-resource-entry',
      projectId: 'project-resource-entry',
      ownerId: 'owner-resource-entry',
      documentRevision: 'document-revision',
    })
    const documentRevision = await computeDocumentRevision(
      workspace,
      initial.confirmedBriefDigest,
    )
    const finding = {
      findingId: 'resource-loading-gap',
      checkId: 'resource_content_consistency' as const,
      severity: 'blocking' as const,
      owner: 'resource' as const,
      evidence: [{ path: 'assets/asset-manifest.json', anchor: '/requirements/0' }],
      subjects: [
        {
          path: 'assets/asset-manifest.json',
          anchor: '/requirements/0',
          requirementId: 'visual.player',
        },
      ],
      observation: 'The approved duty has no loadable resource.',
      blockingReason: 'Implementation cannot consume the required visual.',
      requiredAction: 'Prepare one canonical loadable resource.',
      closureCondition:
        'The same requirement resolves through the canonical manifest.',
    }
    const run = {
      ...initial,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_REVIEW' as const,
      revision: {
        ...initial.revision,
        document: documentRevision,
        resource: undefined,
        implementation: 'stale-implementation',
      },
      tasks: [],
      evidence: {},
      documentReviewState: {
        ...initial.documentReviewState,
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          resource: 1,
        },
        activeCycle: {
          cycleId: 'resource-cycle',
          originScope: 'complete' as const,
          scope: 'complete' as const,
          mode: 'initial' as const,
          sourceRevision: 'stale-resource',
          requiredCheckIds: ['resource_content_consistency' as const],
          completedCheckIds: ['resource_content_consistency' as const],
          checks: [{
            id: 'resource_content_consistency' as const,
            status: 'block' as const,
            conclusion: 'Resource remediation is required.',
            evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
            findingIds: [finding.findingId],
            assessments: [],
          }],
          checkEvidenceDigests: {},
          findings: [finding],
          activeTarget: 'resource' as const,
          acceptedSemanticResult: true,
          changedPaths: [],
          sourceArtifactDigests: {},
        },
      },
    }
    await controller.store.save(run)

    await controller.ensureProgress(run)

    const persisted = await controller.store.load()
    expect(persisted?.phase).toBe('RESOURCE_PREPARATION')
    expect(persisted?.status).toBe('running')
    expect(persisted?.revision.resource).toBeUndefined()
    expect(persisted?.revision.implementation).toBeUndefined()
    expect(persisted?.documentReviewState.comprehensiveApproval).toBeUndefined()
    expect(persisted?.documentReviewState.activeCycle).toMatchObject({
      cycleId: 'resource-cycle',
      findings: [
        {
          findingId: finding.findingId,
          requiredAction: finding.requiredAction,
          closureCondition: finding.closureCondition,
        },
      ],
    })
    expect(persisted).not.toHaveProperty('resourceRemediation')
    expect(dispatched?.contract.remediation).toMatchObject({
      kind: 'document_review',
      cycleId: 'resource-cycle',
      findings: [{ findingId: finding.findingId }],
    })
    expect(dispatched?.contract).not.toHaveProperty('reviewRemediation')
  })

  test('keeps execution retry accounting while dispatching the sole semantic remediation contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-'))
    let starts = 0
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: 'owner-resource-retry',
      workerPort: {
        async start(request) {
          starts += 1
          return {
            sessionId: 'resource-retry-session',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const initial = createTestDeliveryRun({
      runId: 'run-resource-retry',
      projectId: 'project-resource-retry',
      ownerId: 'owner-resource-retry',
    })
    const retryFinding = {
      findingId: 'resource-retry-finding',
      checkId: 'resource_content_consistency' as const,
      severity: 'blocking' as const,
      owner: 'resource' as const,
      evidence: [{ path: 'assets/asset-manifest.json', anchor: '/requirements/0' }],
      subjects: [
        {
          path: 'assets/asset-manifest.json',
          anchor: '/requirements/0',
          requirementId: 'resource-retry-requirement',
        },
      ],
      observation: 'The resource contract remains incomplete.',
      blockingReason: 'The approved resource cannot be consumed.',
      requiredAction: 'Complete the canonical resource contract.',
      closureCondition:
        'The approved resource is loadable through the canonical path.',
    }
    const run = {
      ...initial,
      phase: 'RESOURCE_PREPARATION' as const,
      documentStep: undefined,
      resourcePreparationAttempt: 2,
      documentReviewState: {
        ...initial.documentReviewState,
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          resource: 1,
        },
        activeCycle: {
          cycleId: 'resource-retry-cycle',
          originScope: 'complete' as const,
          scope: 'complete' as const,
          mode: 'initial' as const,
          sourceRevision: 'resource-source',
          requiredCheckIds: ['resource_content_consistency' as const],
          completedCheckIds: ['resource_content_consistency' as const],
          checks: [{
            id: 'resource_content_consistency' as const,
            status: 'block' as const,
            conclusion: 'Resource remediation is required.',
            evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
            findingIds: [retryFinding.findingId],
            assessments: [],
          }],
          checkEvidenceDigests: {},
          findings: [retryFinding],
          activeTarget: 'resource' as const,
          acceptedSemanticResult: true,
          changedPaths: [],
          sourceArtifactDigests: {},
        },
      },
    }
    await controller.store.save(run)

    await controller.dispatcher.dispatch({
      runId: run.runId,
      ownerId: run.ownerId,
      projectId: run.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: run.revision.document,
      contract: {
        remediation: {
          kind: 'document_review',
          cycleId: 'resource-retry-cycle',
          findings: [retryFinding],
        },
      },
    })

    expect((await controller.store.load())?.resourcePreparationAttempt).toBe(2)

    const baseRequest = {
      runId: run.runId,
      ownerId: run.ownerId,
      projectId: run.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer' as const,
      phase: 'RESOURCE_PREPARATION' as const,
      revision: run.revision.document,
    }
    await expect(
      controller.dispatcher.dispatch({ ...baseRequest, contract: {} }),
    ).rejects.toThrow(
      'resource remediation must exactly match the active accepted document-review authority',
    )
    await expect(
      controller.dispatcher.dispatch({
        ...baseRequest,
        contract: {
          remediation: {
            kind: 'document_review',
            cycleId: 'wrong-resource-cycle',
            findings: [retryFinding],
          },
        },
      }),
    ).rejects.toThrow(
      'resource remediation must exactly match the active accepted document-review authority',
    )
    await expect(
      controller.dispatcher.dispatch({
        ...baseRequest,
        contract: {
          remediation: {
            kind: 'document_review',
            cycleId: 'resource-retry-cycle',
            findings: [
              {
                ...retryFinding,
                closureCondition: 'A different closure condition.',
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(
      'resource remediation must exactly match the active accepted document-review authority',
    )
    expect(starts).toBe(1)
  })

  test('rejects any resource dispatch that tries to restore two repair authorities', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-authority-'))
    let starts = 0
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: 'owner-resource-authority',
      workerPort: {
        async start(request) {
          starts += 1
          return {
            sessionId: 'resource-authority-session',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const run = createTestDeliveryRun({
      runId: 'run-resource-authority',
      projectId: 'project-resource-authority',
      ownerId: 'owner-resource-authority',
    })
    await controller.store.save(run)

    await expect(
      controller.dispatcher.dispatch({
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath: workspace,
        workerType: 'resource-preparer',
        phase: 'RESOURCE_PREPARATION',
        revision: run.revision.document,
        contract: {
          preparationRetry: {
            sourceRevision: run.revision.document,
            attempt: 2,
            issues: ['resource gate remains incomplete'],
          },
        },
      }),
    ).rejects.toThrow('resource preparation retry contracts are retired')

    await expect(
      controller.dispatcher.dispatch({
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath: workspace,
        workerType: 'resource-preparer',
        phase: 'RESOURCE_PREPARATION',
        revision: run.revision.document,
        contract: {
          remediation: {
            kind: 'document_review',
            cycleId: 'resource-authority-cycle',
            findings: [{ findingId: 'forged-resource-finding' }],
          },
        },
      }),
    ).rejects.toThrow(
      'resource remediation requires the active accepted document-review authority',
    )
    expect(starts).toBe(0)
  })
})
