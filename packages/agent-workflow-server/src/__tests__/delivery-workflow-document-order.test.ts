import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  completeDocumentDraft,
  reconcileDocumentReview,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import {
  createInitialDeliveryRun,
  createRunStore,
} from '../beegame/delivery-workflow/run-store'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryWorkerPort,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'

describe('delivery workflow document ordering', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('moves six complete foundation documents to foundation review without requiring later artifacts', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-order-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const run = transitionDeliveryRun(
      createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      { type: 'documents_ready' },
    )

    const completed = await completeDocumentDraft({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: 'uncomputed',
        writtenPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      },
      documentSet: 'foundation',
    })

    expect(completed).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      blockedReason: undefined,
    })
  })

  test('requires resource preparation followed by comprehensive review before task planning', () => {
    const resourceRevision = 'resource-revision-1'
    const resourcePrepared = transitionDeliveryRun(
      {
        ...createInitialDeliveryRun({
          projectId: 'project-1',
          ownerId: 'owner-1',
          confirmedBriefDigest: 'brief-1',
          documentRevision: 'document-revision-1',
          workspaceRevision: 'workspace-revision-1',
        }),
        phase: 'RESOURCE_PREPARATION',
      },
      {
        type: 'resource_preparation_ready',
        resourceRevision,
        evidence: {
          path: '.beegame/workflow/evidence/resource.json',
          kind: 'resource_preparation',
          revision: resourceRevision,
          status: 'passed',
          observedAt: new Date().toISOString(),
        },
      },
    )

    expect(resourcePrepared).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_REVIEW',
      revision: { resource: resourceRevision },
    })

    const comprehensivelyReviewed = transitionDeliveryRun(resourcePrepared, {
      type: 'document_review_ready',
      evidence: {
        path: '.beegame/workflow/evidence/comprehensive-review.json',
        kind: 'document_review',
        revision: resourceRevision,
        status: 'ready',
        observedAt: new Date().toISOString(),
      },
    })

    expect(comprehensivelyReviewed).toMatchObject({
      phase: 'ATOMIC_TASK_PLANNING',
      documentStep: undefined,
      evidence: {
        resourcePreparation: { status: 'passed' },
        documentReview: { status: 'ready', revision: resourceRevision },
      },
    })
  })

  test('moves an approved checklist to resource preparation before comprehensive review', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-order-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const checklistPath = 'docs/acceptance/gameplay-checklist.md'
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\n- [ ] PATH-001 source: docs/GDD.md implement: Launch the game expected: playable state evidence: runtime\n',
    )
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
    }

    const completed = await completeDocumentDraft({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: run.revision.document,
        writtenPaths: [checklistPath],
      },
      documentSet: 'checklist',
    })

    expect(completed).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      blockedReason: undefined,
    })
    expect(completed.documentStep).toBeUndefined()
  })

  test('does not advance a READY review that contains a blocking finding', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-gate-'))
    const evidencePath = '.beegame/workflow/evidence/foundation-review.md'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '# Review evidence\n')
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
    }

    const reconciled = await reconcileDocumentReview({
      run,
      workspacePath: workspace,
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-reviewer',
        revision: run.revision.document,
        verdict: 'READY',
        reviewedDocumentPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        checklistIds: [],
        findings: [
          {
            // Category-level policy remains authoritative even if a reviewer
            // under-classifies the severity.
            severity: 'non_blocking',
            category: 'cross_document_conflict',
            documents: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
            description: 'The documents define incompatible runtime behavior.',
            requiredAction: 'Reconcile the behavior into one canonical rule.',
          },
        ],
        evidencePath,
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'running',
      evidence: { documentReview: { status: 'failed' } },
      documentRemediation: {
        sourceRevision: 'document-revision-1',
        attempt: 1,
        findings: [
          {
            severity: 'blocking',
            category: 'cross_document_conflict',
          },
        ],
      },
    })

    const dispatched: WorkerDispatchRequest[] = []
    await startDocumentStage({
      run: reconciled,
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          dispatched.push(request)
          return request
        },
      },
    })
    expect(dispatched[0]?.contract).toMatchObject({
      documentSet: 'foundation',
      remediation: {
        sourceRevision: 'document-revision-1',
        evidencePath,
        attempt: 1,
      },
    })
    const findingIds = reconciled.documentRemediation!.findings.map(
      finding => finding.id,
    )
    const incomplete = await completeDocumentDraft({
      run: reconciled,
      workspacePath: workspace,
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: reconciled.revision.document,
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: [],
      },
    })
    expect(incomplete).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      blockedReason:
        'document author did not resolve every required review finding',
    })

    const completed = await completeDocumentDraft({
      run: reconciled,
      workspacePath: workspace,
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        revision: reconciled.revision.document,
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: findingIds,
      },
    })
    expect(completed).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      blockedReason: undefined,
      documentRemediation: { resolvedFindingIds: findingIds },
    })
  })

  test('stops automatic document remediation after three failed passes', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-limit-'))
    const evidencePath = '.beegame/workflow/evidence/review-limit.md'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '# Review evidence\n')
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-4',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      documentRemediation: {
        sourceRevision: 'document-revision-3',
        evidencePath: '.beegame/workflow/evidence/review-3.md',
        attempt: 3,
        resolvedFindingIds: ['review-existing'],
        findings: [
          {
            id: 'review-existing',
            severity: 'blocking' as const,
            category: 'missing_spec' as const,
            documents: ['docs/UI_UX_SPEC.md'],
            description: 'A required interaction remains unspecified.',
            requiredAction: 'Specify the interaction.',
          },
        ],
      },
    }

    const reconciled = await reconcileDocumentReview({
      run,
      workspacePath: workspace,
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-reviewer',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        reviewedDocumentPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        checklistIds: [],
        findings: [
          {
            severity: 'blocking',
            category: 'missing_spec',
            documents: ['docs/UI_UX_SPEC.md'],
            description: 'A required interaction remains unspecified.',
            requiredAction: 'Specify the interaction.',
          },
        ],
        evidencePath,
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      status: 'needs_action',
      blockedReason:
        'document review still requires revision after 3 remediation attempts',
      activeDispatch: undefined,
      documentRemediation: { attempt: 4 },
    })
  })

  test('recovers a durable checklist handoff exactly once', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-recovery-'))
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
    }
    await createRunStore(workspace, run.ownerId).save(run)
    const started: WorkerDispatchRequest[] = []
    const workerPort: DeliveryWorkerPort = {
      start: async request => {
        started.push(request)
        return {
          sessionId: request.dispatchId!,
          dispatchId: request.dispatchId!,
        }
      },
      submit: async () => undefined,
      stop: async () => undefined,
      close: async () => undefined,
      status: async dispatchId => {
        const active = await createRunStore(workspace, run.ownerId).load()
        if (
          !active?.activeDispatch ||
          active.activeDispatch.dispatchId !== dispatchId
        )
          throw new Error('dispatch is not active')
        return active.activeDispatch
      },
    }
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: run.ownerId,
      workerPort,
    })

    await controller.ensureProgress(run)
    await controller.ensureProgress(run)

    const recovered = await controller.store.load()
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      workerType: 'document-author',
      phase: 'DOCUMENT_REVIEW',
      allowedPaths: ['docs/acceptance/'],
      contract: { documentSet: 'checklist' },
    })
    expect(recovered?.activeDispatch).toMatchObject({ status: 'running' })
    await controller.dispatcher.stop(
      recovered!.activeDispatch!.dispatchId,
      'test cleanup',
    )
  })

  test('passes resolved remediation evidence into the follow-up reviewer', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-followup-'))
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-2',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      documentRemediation: {
        sourceRevision: 'document-revision-1',
        evidencePath: '.beegame/workflow/evidence/review-1.md',
        attempt: 1,
        resolvedFindingIds: ['review-1'],
        findings: [
          {
            id: 'review-1',
            severity: 'blocking' as const,
            category: 'missing_spec' as const,
            documents: ['docs/UI_UX_SPEC.md'],
            description: 'A required interaction was unspecified.',
            requiredAction: 'Specify the interaction.',
          },
        ],
      },
    }
    await createRunStore(workspace, run.ownerId).save(run)
    const started: WorkerDispatchRequest[] = []
    const workerPort: DeliveryWorkerPort = {
      start: async request => {
        started.push(request)
        return {
          sessionId: request.dispatchId!,
          dispatchId: request.dispatchId!,
        }
      },
      submit: async () => undefined,
      stop: async () => undefined,
      close: async () => undefined,
      status: async dispatchId => {
        const active = await createRunStore(workspace, run.ownerId).load()
        if (
          !active?.activeDispatch ||
          active.activeDispatch.dispatchId !== dispatchId
        )
          throw new Error('dispatch is not active')
        return active.activeDispatch
      },
    }
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: run.ownerId,
      workerPort,
    })

    await controller.ensureProgress(run)

    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      workerType: 'document-reviewer',
      contract: {
        reviewScope: 'foundation',
        priorRemediation: {
          sourceRevision: 'document-revision-1',
          attempt: 1,
          resolvedFindingIds: ['review-1'],
        },
      },
    })
    const active = await controller.store.load()
    await controller.dispatcher.stop(
      active!.activeDispatch!.dispatchId,
      'test cleanup',
    )
  })
})
