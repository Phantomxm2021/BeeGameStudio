import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import { createDeliveryWorkflowController } from './controller'
import { createRunStore } from './run-store'
import { acceptedWorkflowUnitSchema, parseDeliveryRun } from './schema'
import { transitionDeliveryRun } from './transition'
import { commitCanonicalDocument } from '../native-canonical-document-tool'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
  type WorkflowEvent,
  type WorkerDispatchRequest,
} from './types'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import {
  activeElapsedWithinStage,
  isFrozenWorkflowStageCardEvent,
} from './workflow-stage-card-history'

function run(): DeliveryRun {
  return createTestDeliveryRun({
    runId: 'accepted-unit-run',
    projectId: 'accepted-unit-project',
    ownerId: 'accepted-unit-owner',
    foundationDraftComplete: false,
  })
}

function completedDocumentDispatch(
  base: DeliveryRun,
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): NonNullable<DeliveryRun['activeDispatch']> {
  const dispatchId = `dispatch-${CANONICAL_PROJECT_DOCUMENT_IDS[path]}`
  return {
    dispatchId,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: path,
    revision: base.revision.document,
    status: 'completed',
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T00:01:00.000Z',
    request: {
      dispatchId,
      runId: base.runId,
      ownerId: base.ownerId,
      projectId: base.projectId,
      workspacePath: '/synthetic/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: base.revision.document,
      allowedPaths: [path],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: path,
      },
    },
  }
}

function reviewRun(completedCheckIds: string[]): DeliveryRun {
  const base = run()
  const checks = completedCheckIds.map(id => ({
    id,
    status: 'pass' as const,
    conclusion: `Accepted ${id}.`,
    evidence: [{ path: 'docs/GDD.md', anchor: '$' }],
    findingIds: [],
    assessments: [],
  }))
  return {
    ...base,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    documentReviewState: {
      ...base.documentReviewState,
      activeCycle: {
        cycleId: 'review-cycle',
        originScope: 'foundation',
        scope: 'foundation',
        mode: 'initial',
        sourceRevision: 'document-revision',
        requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        completedCheckIds:
          completedCheckIds as (typeof FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS)[number][],
        checks:
          checks as DeliveryRun['documentReviewState']['activeCycle'] extends infer _
            ? any
            : never,
        checkEvidenceDigests: Object.fromEntries(
          completedCheckIds.map(id => [id, { 'docs/GDD.md': 'digest' }]),
        ),
        findings: [],
        acceptedSemanticResult:
          completedCheckIds.length ===
          FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.length,
        changedPaths: [],
        sourceArtifactDigests: { 'docs/GDD.md': 'digest' },
      },
    },
  }
}

describe('accepted workflow unit journal', () => {
  test('does not re-emit Foundation approvals inherited by Comprehensive Review', () => {
    const approvedFoundation = reviewRun([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    const foundationCycle = approvedFoundation.documentReviewState.activeCycle!
    const before = {
      ...approvedFoundation,
      documentStep: 'COMPREHENSIVE_REVIEW' as const,
      documentReviewState: {
        ...approvedFoundation.documentReviewState,
        foundationApproval: {
          scope: 'foundation' as const,
          revision: foundationCycle.sourceRevision,
          checks: foundationCycle.checks,
          checkEvidenceDigests: foundationCycle.checkEvidenceDigests,
          evidencePath: '.beegame/workflow/evidence/foundation-review.json',
          approvedAt: '2026-08-05T00:00:00.000Z',
        },
        activeCycle: undefined,
      },
    }
    const resourceCheck = {
      id: 'resource_semantic_fitness' as const,
      status: 'pass' as const,
      conclusion: 'Resources satisfy the accepted design.',
      evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
      findingIds: [],
      assessments: [],
    }
    const after = {
      ...before,
      documentReviewState: {
        ...before.documentReviewState,
        foundationApproval: undefined,
        activeCycle: {
          cycleId: 'comprehensive-cycle',
          originScope: 'complete' as const,
          scope: 'complete' as const,
          mode: 'initial' as const,
          sourceRevision: 'resource-revision',
          requiredCheckIds: [
            ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
            'resource_semantic_fitness' as const,
          ],
          completedCheckIds: [
            ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
            'resource_semantic_fitness' as const,
          ],
          checks: [...foundationCycle.checks, resourceCheck],
          checkEvidenceDigests: {
            ...foundationCycle.checkEvidenceDigests,
            resource_semantic_fitness: {
              'assets/asset-manifest.json': 'resource-digest',
            },
          },
          findings: [],
          acceptedSemanticResult: false,
          changedPaths: [],
          sourceArtifactDigests: {
            'assets/asset-manifest.json': 'resource-digest',
          },
        },
      },
    }

    expect(
      deriveAcceptedWorkflowUnits(before as DeliveryRun, after as DeliveryRun),
    ).toEqual([
      expect.objectContaining({ unitId: 'review:resource_semantic_fitness' }),
    ])
  })

  test('subtracts durable prior approvals even when the next snapshot no longer carries them', () => {
    const approvedFoundation = reviewRun([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    const foundationCycle = approvedFoundation.documentReviewState.activeCycle!
    const before = {
      ...approvedFoundation,
      documentStep: 'COMPREHENSIVE_REVIEW' as const,
      documentReviewState: {
        ...approvedFoundation.documentReviewState,
        foundationApproval: {
          scope: 'foundation' as const,
          revision: foundationCycle.sourceRevision,
          checks: foundationCycle.checks,
          checkEvidenceDigests: foundationCycle.checkEvidenceDigests,
          evidencePath: '.beegame/workflow/evidence/foundation-review.json',
          approvedAt: '2026-08-05T00:00:00.000Z',
        },
        activeCycle: undefined,
      },
    }
    const resourceCheck = {
      id: 'resource_semantic_fitness' as const,
      status: 'pass' as const,
      conclusion: 'Resources satisfy the accepted design.',
      evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
      findingIds: [],
      assessments: [],
    }
    const after = {
      ...before,
      documentReviewState: {
        ...before.documentReviewState,
        foundationApproval: undefined,
        activeCycle: {
          cycleId: 'comprehensive-cycle',
          originScope: 'complete' as const,
          scope: 'complete' as const,
          mode: 'initial' as const,
          sourceRevision: 'resource-revision',
          requiredCheckIds: [
            ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
            'resource_semantic_fitness' as const,
          ],
          completedCheckIds: [
            ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
            'resource_semantic_fitness' as const,
          ],
          checks: [...foundationCycle.checks, resourceCheck],
          checkEvidenceDigests: {
            ...foundationCycle.checkEvidenceDigests,
            resource_semantic_fitness: {
              'assets/asset-manifest.json': 'resource-digest',
            },
          },
          findings: [],
          acceptedSemanticResult: false,
          changedPaths: [],
          sourceArtifactDigests: {
            'assets/asset-manifest.json': 'resource-digest',
          },
        },
      },
    }

    expect(
      deriveAcceptedWorkflowUnits(before as DeliveryRun, after as DeliveryRun),
    ).toEqual([
      expect.objectContaining({ unitId: 'review:resource_semantic_fitness' }),
    ])
  })

  test('requires dispatch identity and a canonical receipt for dispatch-backed units', () => {
    const base = run()
    const common = {
      eventSchemaVersion: 1 as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      predecessorUnitIds: [],
      inputRevision: base.revision.document,
      dependencyDigests: {},
      acceptedAt: '2026-08-05T00:00:00.000Z',
    }

    expect(
      acceptedWorkflowUnitSchema.safeParse({
        ...common,
        unitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
        kind: 'document',
        payload: {
          path: CANONICAL_FOUNDATION_DOCUMENTS[0],
          revision: base.revision.document,
        },
      }).success,
    ).toBe(false)
    expect(
      acceptedWorkflowUnitSchema.safeParse({
        ...common,
        unitId: 'resource:content',
        kind: 'resource-content',
        phase: 'RESOURCE_PREPARATION',
        predecessorUnitIds: ['resource:inventory'],
        dependencyDigests: { content: 'content-digest' },
        inputRevision: 'content-digest',
        payload: { contentDigest: 'content-digest' },
      }).success,
    ).toBe(false)
  })

  test('fails closed when an accepted document has no matching predecessor dispatch', () => {
    const before = {
      ...run(),
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[0],
      foundationDraftState: { completedPaths: [] },
    }
    const after = {
      ...before,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }

    expect(() => deriveAcceptedWorkflowUnits(before, after)).toThrow('dispatch')
  })

  test('journals the exact Resource Content dispatch and canonical receipt', () => {
    const base = run()
    const dispatchId = 'resource-content-dispatch'
    const before = {
      ...base,
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT' as const,
      },
      activeDispatch: {
        dispatchId,
        workerType: 'resource-content-author' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        taskId: 'RESOURCE_CONTENT',
        revision: base.revision.document,
        status: 'completed' as const,
        startedAt: '2026-08-05T00:00:00.000Z',
        finishedAt: '2026-08-05T00:01:00.000Z',
        request: {
          dispatchId,
          runId: base.runId,
          ownerId: base.ownerId,
          projectId: base.projectId,
          workspacePath: '/synthetic/workspace',
          workerType: 'resource-content-author' as const,
          phase: 'RESOURCE_PREPARATION' as const,
          taskId: 'RESOURCE_CONTENT',
          revision: base.revision.document,
          contract: { task: 'RESOURCE_CONTENT' },
        },
      },
    }
    const after = {
      ...before,
      activeDispatch: undefined,
      resourceProductionState: {
        currentTask: 'RESOURCE_GATE' as const,
        contentReceipt: {
          contentDigest: 'content-digest',
          acceptedAt: '2026-08-05T00:01:00.000Z',
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(before, after)).toEqual([
      expect.objectContaining({
        unitId: 'resource:content',
        dispatchId,
        receiptRef: `.beegame/workflow/resource-content-commits/${dispatchId}.json`,
      }),
    ])
  })

  test('journals the exact document dispatch receipt across the real controller handoff', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-handoff-'))
    const initial = {
      ...run(),
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[0],
      foundationDraftState: { completedPaths: [] },
    }
    const store = createRunStore(workspace, initial.ownerId)
    await store.save(initial)
    const requests = new Map<string, WorkerDispatchRequest>()
    let releaseSecondStart!: () => void
    const secondStarted = new Promise<void>(resolve => {
      releaseSecondStart = resolve
    })
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: initial.ownerId,
      workerPort: {
        async start(request) {
          requests.set(request.dispatchId!, request)
          if (requests.size === 2) releaseSecondStart()
          return {
            sessionId: request.dispatchId!,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
        async waitForTerminal(dispatchId) {
          const request = requests.get(dispatchId)!
          if (requests.size > 1) return new Promise(() => undefined)
          const path =
            request.taskId as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
          await commitCanonicalDocument({
            workspacePath: workspace,
            contract: {
              dispatchId,
              targetPath: path,
              documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
              operation: 'create',
              baselineDigest: null,
            },
            body: '# Synthetic accepted document',
          })
          return {
            workerType: 'document-author' as const,
            status: 'completed' as const,
            writtenPaths: [path],
            resolvedFindingIds: [],
          }
        },
      },
    })

    await controller.start(initial)
    await secondStarted

    const accepted = (await store.readEvents()).find(
      event => event.type === 'workflow.unit.accepted',
    )
    const firstRequest = [...requests.values()][0]!
    expect(accepted?.unit).toMatchObject({
      unitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
      dispatchId: firstRequest.dispatchId,
      receiptRef: `.beegame/workflow/document-commits/${firstRequest.dispatchId}.json`,
    })
  })

  test('builds the one strict nested dependency payload for accepted review units', () => {
    const before = reviewRun([])
    const after = reviewRun(['brief_alignment'])

    const [accepted] = deriveAcceptedWorkflowUnits(before, after)
    const parsed = acceptedWorkflowUnitSchema.safeParse(accepted)

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.payload).toEqual({
      check: after.documentReviewState.activeCycle?.checks[0],
      findings: [],
      dependencyDigests: {
        brief_alignment:
          after.documentReviewState.activeCycle?.checkEvidenceDigests
            .brief_alignment,
      },
    })
  })

  test('derives every newly accepted semantic unit from a reconciled run transition', () => {
    const documentBase = run()
    const beforeDocument = {
      ...documentBase,
      activeDispatch: completedDocumentDispatch(
        documentBase,
        CANONICAL_FOUNDATION_DOCUMENTS[0],
      ),
      foundationDraftState: { completedPaths: [] },
    }
    const afterDocument = {
      ...beforeDocument,
      activeDispatch: undefined,
      revision: { ...beforeDocument.revision, document: 'document-revision' },
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    expect(deriveAcceptedWorkflowUnits(beforeDocument, afterDocument)).toEqual([
      expect.objectContaining({
        unitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
        kind: 'document',
      }),
    ])

    const beforePacket = reviewRun([])
    const afterPacket = reviewRun([
      'brief_alignment',
      'cross_document_consistency',
    ])
    expect(deriveAcceptedWorkflowUnits(beforePacket, afterPacket)).toEqual([
      expect.objectContaining({ unitId: 'review:brief_alignment' }),
      expect.objectContaining({ unitId: 'review:cross_document_consistency' }),
    ])

    const beforeChecklist = run()
    const approvedChecklist = createTestDeliveryRun({
      runId: beforeChecklist.runId,
      projectId: beforeChecklist.projectId,
      ownerId: beforeChecklist.ownerId,
      checklistApproved: true,
    })
    const afterChecklist = {
      ...beforeChecklist,
      documentReviewState: {
        ...beforeChecklist.documentReviewState,
        checklistApproval:
          approvedChecklist.documentReviewState.checklistApproval,
      },
    }
    expect(
      deriveAcceptedWorkflowUnits(beforeChecklist, afterChecklist),
    ).toEqual([
      expect.objectContaining({
        unitId: 'review:checklist_traceability',
        kind: 'review-check',
      }),
      expect.objectContaining({
        unitId: 'checklist:docs/acceptance/gameplay-checklist.md',
        kind: 'checklist',
      }),
    ])

    const beforeInventory = run()
    const afterInventory = {
      ...beforeInventory,
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT' as const,
        inventoryReceipt: {
          revision: 'inventory-revision',
          bindings: [
            { requirementId: 'requirement-1', resourceIds: ['resource-1'] },
          ],
          catalogObserved: true,
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(
      deriveAcceptedWorkflowUnits(beforeInventory, afterInventory),
    ).toEqual([
      expect.objectContaining({
        unitId: 'resource:inventory',
        kind: 'resource-inventory',
      }),
    ])

    const beforeContent = {
      ...afterInventory,
      activeDispatch: {
        dispatchId: 'content-dispatch',
        workerType: 'resource-content-author' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        taskId: 'RESOURCE_CONTENT',
        revision: afterInventory.revision.document,
        status: 'completed' as const,
        startedAt: '2026-08-05T00:00:00.000Z',
        finishedAt: '2026-08-05T00:01:00.000Z',
        request: {
          dispatchId: 'content-dispatch',
          runId: afterInventory.runId,
          ownerId: afterInventory.ownerId,
          projectId: afterInventory.projectId,
          workspacePath: '/synthetic/workspace',
          workerType: 'resource-content-author' as const,
          phase: 'RESOURCE_PREPARATION' as const,
          taskId: 'RESOURCE_CONTENT',
          revision: afterInventory.revision.document,
          contract: { task: 'RESOURCE_CONTENT' },
        },
      },
    }
    const afterContent = {
      ...beforeContent,
      activeDispatch: undefined,
      resourceProductionState: {
        ...beforeContent.resourceProductionState,
        currentTask: 'RESOURCE_GATE' as const,
        contentReceipt: {
          contentDigest: 'content-digest',
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(beforeContent, afterContent)).toEqual([
      expect.objectContaining({
        unitId: 'resource:content',
        kind: 'resource-content',
      }),
    ])

    const afterGate = {
      ...afterContent,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'COMPREHENSIVE_REVIEW' as const,
      revision: { ...afterContent.revision, resource: 'resource-revision' },
      evidence: {
        resourcePreparation: {
          path: '.beegame/workflow/evidence/resource-gate.json',
          kind: 'resource_preparation' as const,
          revision: 'resource-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(afterContent, afterGate)).toEqual([
      expect.objectContaining({
        unitId: 'resource:gate',
        kind: 'resource-gate',
      }),
    ])

    const planned = {
      ...afterGate,
      phase: 'IMPLEMENTATION' as const,
      tasks: [
        {
          id: 'task-1',
          title: 'Task',
          checklistIds: ['check-1'],
          resourceIds: ['resource-1'],
          contentIds: ['content-1'],
          dependsOn: [],
          allowedPaths: ['src/'],
          expectedArtifacts: ['src/file.ts'],
          verification: [
            {
              kind: 'test' as const,
              commandOrAction: 'bun test',
              expectedResult: 'pass',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }
    expect(deriveAcceptedWorkflowUnits(afterGate, planned)).toEqual([
      expect.objectContaining({ unitId: 'plan:atomic', kind: 'atomic-plan' }),
    ])

    const implemented = {
      ...planned,
      tasks: planned.tasks.map(task => ({
        ...task,
        status: 'completed' as const,
        completedRevision: 'implementation-revision',
        evidenceRefs: ['.beegame/workflow/evidence/task-1.json'],
      })),
      revision: {
        ...planned.revision,
        implementation: 'implementation-revision',
      },
    }
    expect(deriveAcceptedWorkflowUnits(planned, implemented)).toEqual([
      expect.objectContaining({
        unitId: 'implementation:task-1',
        kind: 'implementation-task',
      }),
    ])

    const audited = {
      ...implemented,
      phase: 'ACCEPTANCE' as const,
      evidence: {
        implementationAudit: {
          path: '.beegame/workflow/evidence/audit.json',
          kind: 'implementation_audit' as const,
          revision: 'implementation-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(implemented, audited)).toEqual([
      expect.objectContaining({
        unitId: 'audit:implementation',
        kind: 'implementation-audit',
      }),
    ])

    const accepted = {
      ...audited,
      phase: 'DELIVERY' as const,
      evidence: {
        ...audited.evidence,
        acceptance: {
          path: '.beegame/workflow/evidence/acceptance.json',
          kind: 'acceptance' as const,
          revision: 'implementation-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(audited, accepted)).toEqual([
      expect.objectContaining({
        unitId: 'acceptance:delivery',
        kind: 'acceptance',
      }),
    ])
  })

  test('commits ordinary and accepted events once and flushes the complete marker', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-journal-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const base = run()
    const before = {
      ...base,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      activeDispatch: completedDocumentDispatch(
        base,
        CANONICAL_FOUNDATION_DOCUMENTS[0],
      ),
    }
    const next = {
      ...before,
      activeDispatch: undefined,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    const acceptedUnits = deriveAcceptedWorkflowUnits(before, next)

    await store.commit(
      next,
      {
        runId: next.runId,
        type: 'document.reconciled',
        phase: next.phase,
        status: next.status,
        revision: next.revision,
      },
      acceptedUnits,
    )

    const events = await store.readEvents()
    expect(events.map(event => event.type)).toEqual([
      'document.reconciled',
      'workflow.unit.accepted',
    ])
    expect(
      events.filter(event => event.type === 'workflow.unit.accepted'),
    ).toHaveLength(1)
    expect((await store.load())?.pendingEvents).toBeUndefined()
  })

  test('freezes the completed stage card exactly once at a semantic stage boundary', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'stage-card-boundary-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const initial = {
      ...run(),
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:00.000Z',
    }
    await store.commit(initial, {
      runId: initial.runId,
      type: 'run.created',
      phase: initial.phase,
      status: initial.status,
      revision: initial.revision,
      eventId: 'run-created',
      createdAt: '2026-08-06T00:00:01.000Z',
    })

    const transitioned = transitionDeliveryRun(initial, {
      type: 'documents_ready',
    })
    const transitionedAt = '2026-08-06T00:00:05.000Z'
    const phaseEntered = {
      runId: transitioned.runId,
      type: 'phase.entered',
      phase: transitioned.phase,
      status: transitioned.status,
      revision: transitioned.revision,
      eventId: 'documents-ready',
      createdAt: transitionedAt,
    }
    await store.commit(transitioned, phaseEntered)

    const reloaded = await store.load()
    const events = await store.readEvents()
    const boundaryEvents = events.filter(isFrozenWorkflowStageCardEvent)
    expect(reloaded?.phase).toBe('DOCUMENT_DRAFTING')
    expect(boundaryEvents).toHaveLength(1)
    expect(boundaryEvents[0]).toMatchObject({
      eventId: 'documents-ready',
      createdAt: transitionedAt,
      stageSnapshot: {
        stageId: 'BRIEF_CONFIRMED',
        status: 'completed',
        completedAt: transitionedAt,
        elapsedMs: 5000,
      },
    })

    await store.commit(transitioned, phaseEntered)
    expect(
      (await store.readEvents()).filter(isFrozenWorkflowStageCardEvent),
    ).toHaveLength(1)
  })

  test('does not attach a frozen stage card to an intra-stage commit', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'stage-card-intra-stage-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const initial = run()
    await store.save(initial)
    const next = {
      ...initial,
      currentMessage: 'durable progress',
      updatedAt: '2026-08-06T00:00:05.000Z',
    }

    await store.commit(next, {
      runId: next.runId,
      type: 'workflow.progress',
      phase: next.phase,
      status: next.status,
      revision: next.revision,
      eventId: 'same-stage-progress',
      createdAt: '2026-08-06T00:00:05.000Z',
    })

    expect(
      (await store.readEvents()).filter(isFrozenWorkflowStageCardEvent),
    ).toHaveLength(0)
    expect((await store.load())?.currentMessage).toBe('durable progress')
  })

  test('sorts journal events before calculating active elapsed time', () => {
    const event = (
      eventId: string,
      createdAt: string,
      status: WorkflowEvent['status'],
    ): WorkflowEvent => ({
      eventId,
      runId: 'accepted-unit-run',
      type: 'workflow.progress',
      phase: 'BRIEF_CONFIRMED',
      status,
      revision: {
        document: 'document-revision',
        workspace: 'workspace-revision',
      },
      createdAt,
    })

    expect(
      activeElapsedWithinStage({
        // An accepted-unit event can be appended after an ordinary event even
        // though its acceptedAt timestamp is older.
        events: [
          event('running-late', '2026-08-06T00:00:08.000Z', 'running'),
          event('waiting-early', '2026-08-06T00:00:05.000Z', 'completed'),
          event('running-older', '2026-08-06T00:00:02.000Z', 'running'),
        ],
        stageStartedAt: '2026-08-06T00:00:00.000Z',
        stageEndedAt: '2026-08-06T00:00:10.000Z',
      }),
    ).toBe(7000)
  })

  test('replaces a malformed expected-digest snapshot without reloading it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'malformed-replacement-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const malformed = '{"schemaVersion":'
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(store.paths.snapshot, malformed, 'utf8')
    const expectedDigest = createHash('sha256').update(malformed).digest('hex')
    const next = {
      ...run(),
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
    }

    await expect(
      store.replaceSnapshotIfDigest({
        expectedDigest,
        run: next,
        event: {
          runId: next.runId,
          type: 'workflow.run.reconstructed',
          phase: next.phase,
          status: next.status,
          revision: next.revision,
          eventId: 'malformed-replacement',
          createdAt: '2026-08-06T00:00:05.000Z',
        },
      }),
    ).resolves.toMatchObject({ phase: 'DOCUMENT_DRAFTING' })
    expect((await store.readEvents()).map(event => event.eventId)).toEqual([
      'malformed-replacement',
    ])
  })

  test('keeps strict tasks.planned receipts valid while journaling their stage boundary', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'strict-task-plan-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const initial = {
      ...createTestDeliveryRun({
        runId: 'strict-task-plan-run',
        projectId: 'strict-task-plan-project',
        ownerId: 'accepted-unit-owner',
        checklistApproved: true,
      }),
      phase: 'ATOMIC_TASK_PLANNING' as const,
    }
    const task = {
      id: 'task-id',
      title: 'Synthetic task',
      checklistIds: ['check-id'],
      resourceIds: ['resource-id'],
      contentIds: ['content-id'],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/artifact.ts'],
      verification: [
        {
          kind: 'test' as const,
          commandOrAction: 'synthetic verification',
          expectedResult: 'pass',
        },
      ],
      status: 'pending' as const,
      attempt: 0,
      evidenceRefs: [],
    }
    const next = { ...initial, phase: 'IMPLEMENTATION' as const, tasks: [task] }
    await store.save(initial)
    await store.commit(next, {
      runId: next.runId,
      type: 'tasks.planned',
      phase: next.phase,
      status: next.status,
      revision: next.revision,
      eventId: 'tasks-planned',
      createdAt: '2026-08-06T00:00:05.000Z',
      taskGraph: [task],
    })

    const events = await store.readEvents()
    const event = events.find(
      candidate => candidate.eventId === 'tasks-planned',
    )
    expect(event).toBeDefined()
    expect(event).not.toHaveProperty('stageSnapshot')
    const stageSnapshotEvent = events.find(
      candidate => candidate.type === 'workflow.stage_snapshot',
    )
    expect(stageSnapshotEvent).toMatchObject({
      runId: next.runId,
      phase: next.phase,
      status: next.status,
      revision: next.revision,
      createdAt: '2026-08-06T00:00:05.000Z',
      stageSnapshot: {
        stageId: 'ATOMIC_TASK_PLANNING',
        status: 'completed',
      },
    })
    expect(isFrozenWorkflowStageCardEvent(stageSnapshotEvent)).toBe(true)
  })

  test('journals the final review check when reconciliation replaces its cycle with an approval', () => {
    const before = reviewRun([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.slice(0, -1),
    ])
    const completed = reviewRun([...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS])
    const cycle = completed.documentReviewState.activeCycle!
    const after = {
      ...completed,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      documentReviewState: {
        ...completed.documentReviewState,
        activeCycle: undefined,
        foundationApproval: {
          scope: 'foundation' as const,
          revision: cycle.sourceRevision,
          checks: cycle.checks,
          checkEvidenceDigests: cycle.checkEvidenceDigests,
          evidencePath: '.beegame/workflow/evidence/foundation-review.json',
          approvedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(before, after)).toEqual([
      expect.objectContaining({
        unitId: `review:${FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.at(-1)}`,
      }),
    ])
  })

  test('does not re-derive an approval after a JSON round trip', () => {
    const baseline = createTestDeliveryRun({
      runId: 'round-trip-run',
      projectId: 'round-trip-project',
      ownerId: 'accepted-unit-owner',
      checklistApproved: true,
    })
    const persisted = JSON.parse(JSON.stringify(baseline)) as DeliveryRun
    const next = JSON.parse(
      JSON.stringify({ ...persisted, currentMessage: 'unchanged acceptance' }),
    ) as DeliveryRun

    expect(deriveAcceptedWorkflowUnits(persisted, next)).toEqual([])
  })

  test('controller persistence does not append accepted events or redispatch accepted work after a JSON round trip', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-controller-'))
    const base = createTestDeliveryRun({
      runId: 'controller-round-trip-run',
      projectId: 'controller-round-trip-project',
      ownerId: 'accepted-unit-owner',
      checklistApproved: true,
    })
    const store = createRunStore(workspace, base.ownerId)
    await store.save(base)
    const withoutApproval = {
      ...base,
      documentReviewState: {
        ...base.documentReviewState,
        checklistApproval: undefined,
      },
    }
    const acceptedUnits = deriveAcceptedWorkflowUnits(withoutApproval, base)
    for (const [index, unit] of acceptedUnits.entries())
      await store.appendEvent({
        eventId: `accepted-before-${index}`,
        runId: base.runId,
        type: 'workflow.unit.accepted',
        phase: unit.phase,
        status: base.status,
        revision: base.revision,
        createdAt: unit.acceptedAt,
        projectId: base.projectId,
        ownerId: base.ownerId,
        unit,
      })

    const startedWorkers: string[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: base.ownerId,
      workerPort: {
        async start(request) {
          startedWorkers.push(request.workerType)
          return {
            sessionId: 'controller-round-trip',
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

    await controller.requestChange(
      JSON.parse(JSON.stringify(base)) as DeliveryRun,
      'A durable change request.',
    )

    expect(
      (await store.readEvents()).filter(
        event => event.type === 'workflow.unit.accepted',
      ),
    ).toHaveLength(acceptedUnits.length)
    expect(startedWorkers).toEqual(['change-impact-analyzer'])
  })

  test('records the canonical content digest when content is accepted before the gate', () => {
    const before = {
      ...run(),
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: { currentTask: 'RESOURCE_CONTENT' as const },
      activeDispatch: {
        dispatchId: 'content-digest-dispatch',
        workerType: 'resource-content-author' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        taskId: 'RESOURCE_CONTENT',
        revision: 'uncomputed',
        status: 'completed' as const,
        startedAt: '2026-08-05T00:00:00.000Z',
        request: {
          dispatchId: 'content-digest-dispatch',
          runId: 'accepted-unit-run',
          ownerId: 'accepted-unit-owner',
          projectId: 'accepted-unit-project',
          workspacePath: '/synthetic/workspace',
          workerType: 'resource-content-author' as const,
          phase: 'RESOURCE_PREPARATION' as const,
          taskId: 'RESOURCE_CONTENT',
          revision: 'uncomputed',
          contract: { task: 'RESOURCE_CONTENT' },
        },
      },
    }
    const after = {
      ...before,
      resourceProductionState: {
        currentTask: 'RESOURCE_GATE' as const,
        contentReceipt: {
          contentDigest: 'content-digest',
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(before, after)).toEqual([
      expect.objectContaining({
        unitId: 'resource:content',
        inputRevision: 'content-digest',
        dependencyDigests: { content: 'content-digest' },
        payload: { contentDigest: 'content-digest' },
      }),
    ])
  })

  test('rejects a pending accepted event whose payload does not match its kind', () => {
    const base = run()
    expect(() =>
      parseDeliveryRun({
        ...base,
        pendingEvents: [
          {
            eventId: 'invalid-accepted-event',
            runId: base.runId,
            type: 'workflow.unit.accepted',
            phase: base.phase,
            status: base.status,
            revision: base.revision,
            createdAt: '2026-08-05T00:00:00.000Z',
            projectId: base.projectId,
            ownerId: base.ownerId,
            unit: {
              eventSchemaVersion: 1,
              unitId: 'document:docs/GDD.md',
              kind: 'document',
              phase: base.phase,
              predecessorUnitIds: [],
              inputRevision: base.revision.document,
              dependencyDigests: {},
              acceptedAt: '2026-08-05T00:00:00.000Z',
              payload: { receiptRef: 'not-a-document-payload' },
            },
          },
        ],
      }),
    ).toThrow()
  })

  test('recovers a marker after the snapshot write and after a partial append', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-crash-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const base = run()
    const before = {
      ...base,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      activeDispatch: completedDocumentDispatch(
        base,
        CANONICAL_FOUNDATION_DOCUMENTS[0],
      ),
    }
    const next = {
      ...before,
      activeDispatch: undefined,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    const unit = deriveAcceptedWorkflowUnits(before, next)[0]
    const ordinary = {
      eventId: 'ordinary-event',
      runId: next.runId,
      type: 'document.reconciled',
      phase: next.phase,
      status: next.status,
      revision: next.revision,
      createdAt: '2026-08-05T00:00:00.000Z',
    }
    const accepted = {
      eventId: 'accepted-event',
      runId: next.runId,
      type: 'workflow.unit.accepted',
      phase: unit.phase,
      status: next.status,
      revision: next.revision,
      createdAt: unit.acceptedAt,
      projectId: next.projectId,
      ownerId: next.ownerId,
      unit,
    }
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify({ ...next, pendingEvents: [ordinary, accepted] })}\n`,
      'utf8',
    )
    await store.appendEvent(ordinary)

    await expect(store.load()).resolves.toMatchObject({ runId: next.runId })
    const events = await store.readEvents()
    expect(events.map(event => event.eventId)).toEqual([
      'ordinary-event',
      'accepted-event',
    ])
    expect(await readFile(store.paths.snapshot, 'utf8')).not.toContain(
      'pendingEvents',
    )
  })

  test('rejects an invalid tasks.planned receipt before appending it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'task-graph-write-'))
    const base = run()
    const store = createRunStore(workspace, base.ownerId)

    await expect(
      store.appendEvent({
        runId: base.runId,
        type: 'tasks.planned',
        phase: 'IMPLEMENTATION',
        status: 'running',
        revision: base.revision,
        taskGraph: 'invalid-task-graph',
      }),
    ).rejects.toThrow('tasks.planned')
    await expect(store.readEvents()).resolves.toEqual([])
  })

  test('rejects an invalid tasks.planned receipt while reading the journal', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'task-graph-read-'))
    const base = run()
    const store = createRunStore(workspace, base.ownerId)
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.events,
      `${JSON.stringify({
        eventId: 'invalid-task-graph-event',
        runId: base.runId,
        type: 'tasks.planned',
        phase: 'IMPLEMENTATION',
        status: 'running',
        revision: base.revision,
        createdAt: '2026-08-05T00:00:00.000Z',
        taskGraph: [],
      })}\n`,
      'utf8',
    )

    await expect(store.readEvents()).rejects.toThrow('tasks.planned')
  })
})
