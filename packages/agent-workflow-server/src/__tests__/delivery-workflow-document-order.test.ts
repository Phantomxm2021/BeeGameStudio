import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  completeDocumentDraft,
  reconcileDocumentReview,
  startChecklistDraftStage,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import {
  createInitialDeliveryRun,
  createRunStore,
} from '../beegame/delivery-workflow/run-store'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import { parseWorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type DeliveryRun,
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

  test('captures an immutable completion timestamp at delivery', () => {
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      phase: 'DELIVERY' as const,
      evidence: {
        acceptance: {
          path: '.beegame/workflow/evidence/acceptance.json',
          kind: 'acceptance' as const,
          revision: 'workspace-revision-1',
          status: 'passed' as const,
          observedAt: new Date().toISOString(),
        },
      },
    }

    const completed = transitionDeliveryRun(run, { type: 'delivery_completed' })

    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBe(completed.updatedAt)
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

  test('automatically remediates a table-only checklist and then advances once checkbox tasks are valid', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-remediation-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const checklistPath = 'docs/acceptance/gameplay-checklist.md'
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\n| ID | Check |\n| --- | --- |\n| PATH-001 | Observe the playable result and retain runtime evidence. |\n',
    )
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'foundation-revision-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      evidence: {
        documentReview: {
          path: '.beegame/workflow/evidence/foundation-review.md',
          kind: 'document_review' as const,
          revision: 'foundation-revision-1',
          status: 'ready' as const,
          observedAt: new Date().toISOString(),
        },
      },
    }

    const incomplete = await completeDocumentDraft({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [checklistPath],
        resolvedFindingIds: [],
      },
      documentSet: 'checklist',
    })

    expect(incomplete).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      status: 'running',
      checklistRemediation: {
        attempt: 1,
        issues: [
          'docs/acceptance/gameplay-checklist.md: Acceptance checklist contains no task items.',
        ],
      },
    })

    const dispatched: WorkerDispatchRequest[] = []
    await startChecklistDraftStage({
      run: incomplete,
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          dispatched.push(request)
          return request
        },
      },
    })
    expect(dispatched[0]?.contract).toMatchObject({
      documentSet: 'checklist',
      approvedDocumentRevision: 'foundation-revision-1',
      checklistRemediation: {
        attempt: 1,
        issues: [
          'docs/acceptance/gameplay-checklist.md: Acceptance checklist contains no task items.',
        ],
      },
    })

    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\n- [ ] PATH-001 Observe the playable result and retain runtime evidence.\n',
    )
    const completed = await completeDocumentDraft({
      run: incomplete,
      workspacePath: workspace,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [checklistPath],
        resolvedFindingIds: [],
      },
      documentSet: 'checklist',
    })

    expect(completed).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      blockedReason: undefined,
      checklistRemediation: undefined,
    })
  })

  test('stops automatic checklist remediation after three correction passes', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-limit-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const checklistPath = 'docs/acceptance/gameplay-checklist.md'
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\nNo tasks yet.\n',
    )
    let run: DeliveryRun = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
    }

    for (let pass = 1; pass <= 4; pass += 1) {
      run = await completeDocumentDraft({
        run,
        workspacePath: workspace,
        terminal: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: [checklistPath],
          resolvedFindingIds: [],
        },
        documentSet: 'checklist',
      })
      expect(run.checklistRemediation?.attempt).toBe(pass)
      expect(run.status).toBe(pass <= 3 ? 'running' : 'needs_action')
    }
  })

  test('routes an explicitly blocking review finding into remediation', async () => {
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
        verdict: 'NEEDS_REVISION',
        reviewedDocumentPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        checklistIds: [],
        findings: [
          {
            code: 'RUNTIME-BEHAVIOR-CONFLICT',
            severity: 'blocking',
            category: 'cross_document_conflict',
            documents: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
            description: 'The documents define incompatible runtime behavior.',
            requiredAction: 'Reconcile the behavior into one canonical rule.',
          },
          {
            code: 'CAMERA-BASELINE-ADVISORY',
            severity: 'non_blocking',
            category: 'missing_spec',
            documents: ['docs/TECHNICAL_DESIGN.md'],
            description: 'The default camera baseline can be more explicit.',
            requiredAction: 'Record the final baseline before delivery.',
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
            code: 'RUNTIME-BEHAVIOR-CONFLICT',
            severity: 'blocking',
            category: 'cross_document_conflict',
          },
        ],
      },
      documentAdvisories: [
        {
          code: 'CAMERA-BASELINE-ADVISORY',
          severity: 'non_blocking',
          category: 'missing_spec',
        },
      ],
    })

    const store = createRunStore(workspace, reconciled.ownerId)
    await store.save(reconciled)
    const reloaded = await store.load()
    expect(reloaded).toMatchObject({
      documentRemediation: {
        findings: [{ code: 'RUNTIME-BEHAVIOR-CONFLICT' }],
      },
      documentAdvisories: [{ code: 'CAMERA-BASELINE-ADVISORY' }],
      documentReviewCycleCount: 1,
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

  test('advances a comprehensive READY review with non-blocking findings', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-advisory-'))
    const evidencePath = '.beegame/workflow/evidence/complete-review.md'
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
      documentStep: 'CHECKLIST_REVIEW' as const,
      revision: {
        document: 'document-revision-1',
        resource: 'resource-revision-1',
        workspace: 'workspace-revision-1',
      },
      documentReviewCycleCount: 2,
    }

    const reconciled = await reconcileDocumentReview({
      run,
      workspacePath: workspace,
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-reviewer',
        revision: run.revision.resource,
        verdict: 'READY',
        reviewedDocumentPaths: [
          ...CANONICAL_PROJECT_DOCUMENTS,
          CANONICAL_ASSET_MANIFEST,
        ],
        checklistIds: [],
        findings: [
          {
            severity: 'non_blocking',
            category: 'missing_spec',
            documents: [CANONICAL_ASSET_MANIFEST],
            description: 'Implementation-time icon provenance is pending.',
            requiredAction:
              'Record final icon provenance during implementation.',
          },
          {
            severity: 'non_blocking',
            category: 'cross_document_conflict',
            documents: ['docs/ASSET_PLAN.md'],
            description: 'A referenced metadata version is stale.',
            requiredAction: 'Refresh the metadata version before delivery.',
          },
        ],
        evidencePath,
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'ATOMIC_TASK_PLANNING',
      status: 'running',
      evidence: {
        documentReview: {
          revision: 'resource-revision-1',
          status: 'ready',
        },
      },
      documentAdvisories: [
        { severity: 'non_blocking', category: 'missing_spec' },
        { severity: 'non_blocking', category: 'cross_document_conflict' },
      ],
    })
    expect(reconciled.documentRemediation).toBeUndefined()
    expect(reconciled.documentReviewCycleCount).toBeUndefined()
    expect(reconciled.revision.resource).toBe('resource-revision-1')
  })

  test('rejects an internally inconsistent READY result without guessing a verdict', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-invalid-'))
    const evidencePath = '.beegame/workflow/evidence/invalid-review.md'
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
            severity: 'blocking',
            category: 'missing_spec',
            documents: ['docs/GDD.md'],
            description: 'A required behavior is absent.',
            requiredAction: 'Define the behavior.',
          },
        ],
        evidencePath,
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      blockedReason: 'document review returned READY with blocking findings',
      evidence: { documentReview: { status: 'blocked' } },
    })
    expect(reconciled.documentRemediation).toBeUndefined()
  })

  test('routes blocking derived-artifact findings to the narrow repair stage', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-routing-'))
    const evidencePath = '.beegame/workflow/evidence/routed-review.md'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '# Review evidence\n')
    const baseRun = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_REVIEW' as const,
      revision: {
        document: 'document-revision-1',
        resource: 'resource-revision-1',
        workspace: 'workspace-revision-1',
      },
    }
    const terminal = {
      workerType: 'document-reviewer' as const,
      revision: 'resource-revision-1',
      verdict: 'NEEDS_REVISION' as const,
      reviewedDocumentPaths: [
        ...CANONICAL_PROJECT_DOCUMENTS,
        CANONICAL_ASSET_MANIFEST,
      ],
      checklistIds: [],
      evidencePath,
    }

    const checklistRepair = await reconcileDocumentReview({
      run: baseRun,
      workspacePath: workspace,
      currentDocumentRevision: baseRun.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        ...terminal,
        findings: [
          {
            severity: 'blocking',
            category: 'missing_spec',
            documents: ['docs/acceptance/gameplay-checklist.md'],
            description: 'A required acceptance definition is absent.',
            requiredAction: 'Add the observable acceptance definition.',
          },
        ],
      },
    })
    expect(checklistRepair).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      documentRemediation: { attempt: 1 },
      revision: { resource: undefined },
    })

    const resourceRepair = await reconcileDocumentReview({
      run: baseRun,
      workspacePath: workspace,
      currentDocumentRevision: baseRun.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        ...terminal,
        findings: [
          {
            severity: 'blocking',
            category: 'cross_document_conflict',
            documents: [CANONICAL_ASSET_MANIFEST],
            description: 'The manifest contradicts the approved asset plan.',
            requiredAction: 'Align the manifest with the approved asset plan.',
          },
        ],
      },
    })
    expect(resourceRepair).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      documentRemediation: { attempt: 1 },
      resourceRemediation: {
        attempt: 1,
        issues: ['Align the manifest with the approved asset plan.'],
      },
      revision: { resource: undefined },
    })
  })

  test('persists the current foundation review evidence before checklist drafting', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-review-'))
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
        documentRevision: 'document-revision-2',
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
        findings: [],
        evidencePath,
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      status: 'running',
      evidence: {
        documentReview: {
          path: evidencePath,
          kind: 'document_review',
          revision: 'document-revision-2',
          status: 'ready',
        },
      },
    })
  })

  test('keeps the document review limit across intermediate successful reviews', async () => {
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
      documentReviewCycleCount: 3,
      documentRemediation: {
        sourceRevision: 'document-revision-3',
        evidencePath: '.beegame/workflow/evidence/review-3.md',
        attempt: 1,
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

  test('document author contract uses server-computed revisions and accepts retained legacy output', () => {
    const request: WorkerDispatchRequest = {
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'uncomputed',
      allowedPaths: ['docs/'],
      contract: { documentSet: 'foundation' },
    }
    const prompt = buildWorkerPrompt(request)
    const terminalContract = prompt
      .split('\n')
      .find(line => line.startsWith('Terminal JSON contract'))

    expect(terminalContract).not.toContain('"revision"')
    expect(
      parseWorkerTerminalResult({
        workerType: 'document-author',
        status: 'completed',
        revision: request.runId,
        writtenPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
        resolvedFindingIds: [],
      }),
    ).toEqual({
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      resolvedFindingIds: [],
    })
  })

  test('checklist author prompt requires canonical checkbox task lines', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_REVIEW',
      revision: 'document-revision-1',
      allowedPaths: ['docs/acceptance/'],
      contract: {
        documentSet: 'checklist',
        checklistRemediation: {
          sourceRevision: 'document-revision-1',
          attempt: 1,
          issues: ['The checklist has no machine-readable tasks.'],
        },
      },
    })

    expect(prompt).toContain(
      '- [ ] <stable-id> <observable check and evidence expectation>',
    )
    expect(prompt).toContain(
      'Tables may supplement these tasks but must not replace the checkbox task lines.',
    )
    expect(prompt).toContain('bounded checklist-structure remediation pass')
  })

  test('controller immediately dispatches a scoped checklist correction after structural rejection', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-checklist-controller-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const checklistPath = 'docs/acceptance/gameplay-checklist.md'
    await mkdir(join(workspace, 'docs', 'acceptance'), { recursive: true })
    await writeFile(
      join(workspace, checklistPath),
      '# Acceptance\n| ID | Check |\n| --- | --- |\n| PATH-001 | Observe the result. |\n',
    )
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'foundation-revision-1',
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
        if (active?.activeDispatch?.dispatchId !== dispatchId)
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
    const first = await controller.store.load()
    await controller.dispatcher.completeDispatch(
      first!.activeDispatch!.dispatchId,
      {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [checklistPath],
        resolvedFindingIds: [],
      },
    )

    const remediating = await controller.store.load()
    expect(started).toHaveLength(2)
    expect(remediating).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      status: 'running',
      checklistRemediation: { attempt: 1 },
      activeDispatch: {
        workerType: 'document-author',
        status: 'running',
        request: {
          allowedPaths: ['docs/acceptance/'],
          contract: {
            documentSet: 'checklist',
            checklistRemediation: { attempt: 1 },
          },
        },
      },
    })
    await controller.dispatcher.stop(
      remediating!.activeDispatch!.dispatchId,
      'test cleanup',
    )
  })

  test('retry salvages a valid retained document-author completion without reauthoring', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-author-recovery-'))
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const running = transitionDeliveryRun(
      createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      { type: 'documents_ready' },
    )
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-1',
      runId: running.runId,
      ownerId: running.ownerId,
      projectId: running.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'uncomputed',
      allowedPaths: ['docs/'],
      contract: {
        documentSet: 'foundation',
        confirmedBriefDigest: running.confirmedBriefDigest,
      },
    }
    const failed = {
      ...running,
      status: 'failed' as const,
      blockedReason: 'worker terminal result does not match dispatch contract',
      activeDispatch: {
        dispatchId: request.dispatchId!,
        workerType: request.workerType,
        phase: request.phase,
        revision: request.revision,
        status: 'invalid' as const,
        request,
        terminalOutput: JSON.stringify({
          workerType: 'document-author',
          status: 'completed',
          revision: running.runId,
          writtenPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
          resolvedFindingIds: [],
        }),
        startedAt: '2026-07-28T00:00:00.000Z',
        finishedAt: '2026-07-28T00:01:00.000Z',
      },
    }
    const retried = transitionDeliveryRun(failed, { type: 'retry' })
    await createRunStore(workspace, retried.ownerId).save(retried)
    const started: WorkerDispatchRequest[] = []
    const workerPort: DeliveryWorkerPort = {
      start: async nextRequest => {
        started.push(nextRequest)
        return {
          sessionId: nextRequest.dispatchId!,
          dispatchId: nextRequest.dispatchId!,
        }
      },
      submit: async () => undefined,
      stop: async () => undefined,
      close: async () => undefined,
      status: async dispatchId => ({
        dispatchId,
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: 'uncomputed',
        status: 'running',
        startedAt: '2026-07-28T00:01:00.000Z',
      }),
    }
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: retried.ownerId,
      workerPort,
    })

    await controller.ensureProgress(retried)

    const recovered = await controller.store.load()
    expect(started).toHaveLength(1)
    expect(started[0]?.workerType).toBe('document-reviewer')
    expect(recovered).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      activeDispatch: { workerType: 'document-reviewer', status: 'running' },
    })
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
