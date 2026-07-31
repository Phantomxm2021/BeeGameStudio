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
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
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

    const planned = transitionDeliveryRun(comprehensivelyReviewed, {
      type: 'tasks_planned',
      tasks: [
        {
          id: 'support-state',
          title: 'Create state required by gameplay',
          resourceRequirementIds: [],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/state/'],
          expectedArtifacts: ['src/state/store.ts'],
          verification: [
            {
              kind: 'test',
              commandOrAction: 'run state tests',
              expectedResult: 'state tests pass',
            },
          ],
          status: 'pending',
          attempt: 0,
          evidenceRefs: [],
        },
        {
          id: 'owned-gameplay',
          title: 'Implement observable gameplay',
          resourceRequirementIds: [],
          checklistIds: ['check-1'],
          dependsOn: ['support-state'],
          allowedPaths: ['src/game/'],
          expectedArtifacts: ['src/game/runtime.ts'],
          verification: [
            {
              kind: 'test',
              commandOrAction: 'run gameplay tests',
              expectedResult: 'gameplay tests pass',
            },
          ],
          status: 'pending',
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    })

    expect(planned).toMatchObject({
      phase: 'IMPLEMENTATION',
      tasks: [
        { id: 'support-state', checklistIds: [] },
        { id: 'owned-gameplay', checklistIds: ['check-1'] },
      ],
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
            remediationTarget: 'foundation',
            documents: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
            description: 'The documents define incompatible runtime behavior.',
            requiredAction: 'Reconcile the behavior into one canonical rule.',
          },
          {
            code: 'CAMERA-BASELINE-ADVISORY',
            severity: 'non_blocking',
            category: 'missing_spec',
            remediationTarget: 'foundation',
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
            remediationTarget: 'resource',
            documents: [CANONICAL_ASSET_MANIFEST],
            description: 'Implementation-time icon provenance is pending.',
            requiredAction:
              'Record final icon provenance during implementation.',
          },
          {
            severity: 'non_blocking',
            category: 'cross_document_conflict',
            remediationTarget: 'foundation',
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
            remediationTarget: 'foundation',
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
            remediationTarget: 'checklist',
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
            remediationTarget: 'resource',
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

  test('gives a remediation worker only findings owned by its writable domain', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-mixed-routing-'))
    const evidencePath = '.beegame/workflow/evidence/mixed-review.md'
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

    const reconciled = await reconcileDocumentReview({
      run: baseRun,
      workspacePath: workspace,
      currentDocumentRevision: baseRun.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
      terminal: {
        workerType: 'document-reviewer',
        revision: baseRun.revision.resource,
        verdict: 'NEEDS_REVISION',
        reviewedDocumentPaths: [
          ...CANONICAL_PROJECT_DOCUMENTS,
          CANONICAL_ASSET_MANIFEST,
        ],
        checklistIds: [],
        evidencePath,
        findings: [
          {
            code: 'DOCUMENT-CONFLICT',
            severity: 'blocking',
            category: 'cross_document_conflict',
            remediationTarget: 'foundation',
            documents: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
            description: 'Two foundation documents conflict.',
            requiredAction: 'Reconcile the two foundation documents.',
          },
          {
            code: 'RESOURCE-SOURCE-MISSING',
            severity: 'blocking',
            category: 'missing_spec',
            remediationTarget: 'resource',
            documents: [CANONICAL_ASSET_MANIFEST, 'docs/ASSET_PLAN.md'],
            description: 'A required resource source decision is missing.',
            requiredAction: 'Record the source decision in the manifest.',
          },
        ],
      },
    })

    expect(reconciled).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      documentRemediation: {
        findings: [{ code: 'DOCUMENT-CONFLICT' }],
      },
    })
    expect(reconciled.documentRemediation?.findings).toHaveLength(1)

    const requests: WorkerDispatchRequest[] = []
    await startDocumentStage({
      run: reconciled,
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })
    expect(
      (
        requests[0]?.contract.remediation as {
          findings: Array<{ code?: string }>
        }
      ).findings,
    ).toEqual([expect.objectContaining({ code: 'DOCUMENT-CONFLICT' })])
  })

  test('defers a resource-only follow-up until after foundation review and checklist drafting', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-deferred-resource-review-'),
    )
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `# ${path}\n`)
    }
    const evidencePath = '.beegame/workflow/evidence/foundation-resource.json'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '{}\n')
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
        evidencePath,
        findings: [
          {
            code: 'RESOURCE-SOURCE-MISSING',
            severity: 'blocking',
            category: 'missing_spec',
            remediationTarget: 'resource',
            resourceAction: 'reselection',
            resourceImportIds: ['import-audio-1'],
            documents: [CANONICAL_ASSET_MANIFEST, 'docs/ASSET_PLAN.md'],
            description:
              'The document correction is complete but the manifest is not.',
            requiredAction:
              'Record the missing source decision in the manifest.',
          },
        ],
      },
    })

    expect(reconciled).toMatchObject({
      status: 'running',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      documentRemediation: undefined,
      resourceRemediation: {
        mode: 'reselection',
        reselectImportIds: ['import-audio-1'],
        issues: ['Record the missing source decision in the manifest.'],
      },
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
            remediationTarget: 'foundation' as const,
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
            remediationTarget: 'foundation',
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

  test('document author contract uses server-computed revisions and accepts canonical output', () => {
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

    expect(prompt).toContain('SubmitDocumentAuthorResult exactly once')
    expect(prompt).not.toContain('Terminal JSON contract')
    expect(prompt).toContain(
      'Model the smallest reusable set of asset responsibilities',
    )
    expect(prompt).toContain(
      'it is not one requirement per event, variant, screen, destination file, or runtime call site',
    )
    expect(prompt).toContain(
      'one canonical responsibility registry and a separate runtime-use mapping',
    )
    expect(
      parseWorkerTerminalResult({
        workerType: 'document-author',
        status: 'completed',
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

  test('atomic planner prompt defines the executable task schema and avoids a duplicate terminal graph', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'atomic-task-planner',
      phase: 'ATOMIC_TASK_PLANNING',
      revision: 'revision-1',
      allowedPaths: ['.beegame/workflow/evidence/'],
      contract: {},
    })

    expect(prompt).toContain('SubmitAtomicTaskPlan')
    expect(prompt).toContain('ownership maps')
    expect(prompt).toContain(
      'never attach an unrelated gameplay or infrastructure task',
    )
    expect(prompt).toContain('"allowedPaths"')
    expect(prompt).toContain('"verification"')
    expect(prompt).toContain('contract.resourceBindings')
    expect(prompt).toContain(
      'not disposable outputs produced by build, test, coverage, packaging, cache, or preview commands',
    )
    expect(prompt).toContain(
      'record those derived outputs only as verification observations',
    )
    expect(prompt).toContain(
      'tooling already declared by the project dependency manifest',
    )
    expect(prompt).toContain('Do not write execution-state or legacy fields')
    expect(prompt).toContain(
      'Group responsibilities by implementation artifact boundary and submit one graph immediately',
    )
    expect(prompt).toContain(
      'Never introduce an implementation mechanism, framework primitive, storage pattern, class shape, or architecture term',
    )
    expect(prompt).toContain(
      'Do not draft alternate graphs, enumerate coverage in reasoning',
    )
    expect(prompt).toContain('do not duplicate the graph in the response')
    expect(prompt).not.toContain(
      'Return exactly one strict JSON terminal object',
    )
  })

  test('resource preparer receives the canonical Resource Library manifest vocabulary', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      allowedPaths: ['assets/asset-manifest.json', 'assets/runtime/'],
      contract: {
        resourceAttemptMode: 'selection',
        selectionPlan: [
          {
            responsibilities: [
              {
                requirementId: 'resource-responsibility',
                purpose: 'Provide the approved reusable responsibility.',
                remainingImportBudget: 1,
              },
            ],
            acceptedFormats: ['png'],
            resourceRequirement: { accepted_formats: ['png'] },
          },
        ],
      },
    })

    expect(prompt).toContain('Canonical Resource Library manifest vocabulary')
    expect(prompt).toContain(
      'category is zero or one enum string, never an array',
    )
    expect(prompt).toContain('"usageTags"')
    expect(prompt).toContain('"assetKinds"')
    expect(prompt).toContain('"capabilities"')
    expect(prompt).toContain('Semantic suitability is mandatory')
    expect(prompt).toContain('Never reinterpret an unrelated shape')
    expect(prompt).toContain(
      'use the returned facets to correct unsupported manifest constraints once',
    )
    expect(prompt).toContain(
      'One import_elements selection may list multiple requirement_ids',
    )
    expect(prompt).toContain(
      'one canonical requirement per approved reusable semantic responsibility',
    )
    expect(prompt).toContain(
      'only from the canonical responsibility registry in docs/ASSET_PLAN.md',
    )
  })

  test('implementation prompt requires exact satisfaction coverage for non-library responsibilities', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION',
      taskId: 'task-1',
      revision: 'revision-1',
      allowedPaths: ['src/', '.beegame/workflow/evidence/'],
      contract: {
        task: {
          resourceRequirementIds: ['requirement-authored'],
          resourceImportIds: [],
          resourceCompositionIds: [],
        },
      },
    })

    expect(prompt).toContain(
      'requirementSatisfactions must contain exactly one entry for every requirementId in ["requirement-authored"]',
    )
    expect(prompt).toContain(
      'its importIds and compositionIds may be empty for authored-asset, runtime-generated, system-provided, or silent fulfillment',
    )
    expect(prompt).toContain('resourceReferences must cover exactly []')
    expect(prompt).toContain(
      'Never author workflow evidence; the workflow service creates one canonical dispatch-scoped evidence file',
    )
    expect(prompt).toContain(
      'Treat each verification as an observable acceptance condition, not permission to invent an additional architecture',
    )
    expect(prompt).toContain('Workspace root: /workspace')
    expect(prompt).toContain(
      'do not reread canonical design documents, workflow logs, transcripts, or historical evidence',
    )
    expect(prompt).toContain(
      'append the workspace-relative path without reconstructing, abbreviating, or duplicating any directory segment',
    )
    expect(prompt).toContain(
      'Once every expected artifact exists and every active deterministic verification has concrete evidence, submit immediately',
    )
    expect(prompt).toContain('Do not create substitute temporary test scripts')
    expect(prompt).not.toContain(
      'Return exactly one strict JSON terminal object',
    )
    expect(() =>
      parseWorkerTerminalResult({
        workerType: 'implementation-worker',
        taskId: 'task-1',
        status: 'completed',
        revision: 'revision-1',
        changedPaths: ['src/runtime.ts'],
      }),
    ).toThrow('resourceReferences')
    expect(
      parseWorkerTerminalResult({
        workerType: 'implementation-worker',
        taskId: 'task-1',
        status: 'completed',
        revision: 'revision-1',
        changedPaths: ['src/runtime.ts'],
        verifiedArtifacts: ['src/runtime.ts'],
        verificationResults: [
          {
            verificationIndex: 0,
            status: 'passed',
            observations: ['The runtime file exists.'],
          },
        ],
        resourceReferences: [],
        compositionIntegrations: [],
        requirementSatisfactions: [
          {
            requirementId: 'requirement-authored',
            importIds: [],
            compositionIds: [],
            projectReferences: ['src/runtime.ts'],
          },
        ],
        evidenceRefs: ['.beegame/workflow/evidence/implementation-1.json'],
        evidencePath: '.beegame/workflow/evidence/implementation-1.json',
      }),
    ).toMatchObject({
      evidenceRefs: ['.beegame/workflow/evidence/implementation-1.json'],
      evidencePath: '.beegame/workflow/evidence/implementation-1.json',
    })
  })

  test('accepts an explicitly continued reviewer finding and rejects retired summary output', () => {
    const terminal = {
      workerType: 'document-reviewer',
      revision: 'document-revision-1',
      verdict: 'NEEDS_REVISION',
      reviewedDocumentPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      checklistIds: [],
      findings: [
        {
          code: 'RESOURCE-SOURCE-MISSING',
          severity: 'blocking',
          category: 'missing_spec',
          remediationTarget: 'resource',
          priorFindingId: 'review-prior-1',
          documents: [CANONICAL_ASSET_MANIFEST],
          description: 'The resource source remains unresolved.',
          requiredAction: 'Record the durable source decision.',
        },
      ],
      evidencePath: '.beegame/workflow/evidence/review.json',
    }

    expect(parseWorkerTerminalResult(terminal)).toMatchObject({
      findings: [{ priorFindingId: 'review-prior-1' }],
    })
    expect(() =>
      parseWorkerTerminalResult({
        ...terminal,
        findings: [
          {
            ...terminal.findings[0],
            description: undefined,
            requiredAction: undefined,
            summary: 'Current evidence and its required correction.',
          },
        ],
      }),
    ).toThrow('description')
    expect(() =>
      parseWorkerTerminalResult({
        ...terminal,
        findings: [{ ...terminal.findings[0], unsupportedKey: true }],
      }),
    ).toThrow('unsupportedKey')
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

  test('comprehensive reviewer keeps implementation outputs out of resource preparation', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'resource-revision-1',
      allowedPaths: ['.beegame/workflow/evidence/'],
      contract: { reviewScope: 'complete' },
    })

    expect(prompt).toContain('final pre-implementation comprehensive review')
    expect(prompt).toContain('cannot override the current manifest')
    expect(prompt).toContain(
      'never require the resource worker to run shell conversion',
    )
    expect(prompt).toContain('resourceRequirementIds')
    expect(prompt).toContain(
      'Do not continue a prior finding after the current canonical manifest has resolved it.',
    )
  })

  test('does not recycle a stale resource finding after the canonical manifest resolved it', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stale-resource-review-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    const evidencePath = '.beegame/workflow/evidence/stale-resource-review.json'
    await writeFile(join(workspace, evidencePath), '{}\n')
    await writeBeeGameAssetManifest(workspace, {
      version: 5,
      project_target: {
        asset_format_capabilities: ['.glb'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'public/assets',
      },
      requirements: [
        {
          id: 'requirement-authored',
          required: true,
          status: 'planned',
          source_decision: {
            type: 'runtime-generated',
            reasons: ['The approved plan assigns this to implementation.'],
            decided_at: new Date().toISOString(),
          },
        },
      ],
      imports: [],
      compositions: [],
    })
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-1',
        workspaceRevision: 'workspace-revision-1',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_REVIEW' as const,
      revision: {
        document: 'document-revision-1',
        resource: 'resource-revision-1',
        workspace: 'workspace-revision-1',
      },
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
        verdict: 'NEEDS_REVISION',
        reviewedDocumentPaths: [
          ...CANONICAL_PROJECT_DOCUMENTS,
          CANONICAL_ASSET_MANIFEST,
        ],
        checklistIds: [],
        evidencePath,
        findings: [
          {
            code: 'STALE-RESOURCE-FINDING',
            severity: 'blocking',
            category: 'missing_spec',
            remediationTarget: 'resource',
            resourceAction: 'repair',
            resourceRequirementIds: ['requirement-authored'],
            priorFindingId: 'review-prior-resource',
            documents: [CANONICAL_ASSET_MANIFEST],
            description:
              'The prior review claimed that the source decision was missing.',
            requiredAction: 'Add the source decision again.',
          },
        ],
      },
    })

    expect(reconciled).toMatchObject({
      status: 'running',
      phase: 'ATOMIC_TASK_PLANNING',
      documentRemediation: undefined,
      documentAdvisories: [
        {
          id: 'review-prior-resource',
          severity: 'non_blocking',
          resourceRequirementIds: ['requirement-authored'],
        },
      ],
    })
    expect(reconciled.resourceRemediation).toBeUndefined()
  })

  test('keeps a resource repair finding when the current manifest responsibility is unresolved', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-current-resource-review-'),
    )
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    const evidencePath =
      '.beegame/workflow/evidence/current-resource-review.json'
    await writeFile(join(workspace, evidencePath), '{}\n')
    await writeBeeGameAssetManifest(workspace, {
      version: 5,
      project_target: {
        asset_format_capabilities: ['.glb'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'public/assets',
      },
      requirements: [
        {
          id: 'requirement-unresolved',
          required: true,
          status: 'planned',
        },
      ],
      imports: [],
      compositions: [],
    })
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
        verdict: 'NEEDS_REVISION',
        reviewedDocumentPaths: [
          ...CANONICAL_PROJECT_DOCUMENTS,
          CANONICAL_ASSET_MANIFEST,
        ],
        checklistIds: [],
        evidencePath,
        findings: [
          {
            code: 'CURRENT-RESOURCE-FINDING',
            severity: 'blocking',
            category: 'missing_spec',
            remediationTarget: 'resource',
            resourceAction: 'repair',
            resourceRequirementIds: ['requirement-unresolved'],
            documents: [CANONICAL_ASSET_MANIFEST],
            description: 'The current responsibility has no source.',
            requiredAction: 'Record its current source decision.',
          },
        ],
      },
    })

    expect(reconciled).toMatchObject({
      status: 'running',
      phase: 'RESOURCE_PREPARATION',
      resourceRemediation: {
        mode: 'repair',
        issues: ['Record its current source decision.'],
      },
    })
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

  test('retry starts a fresh document author instead of replaying invalid legacy output', async () => {
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
    expect(started[0]?.workerType).toBe('document-author')
    expect(recovered).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      status: 'running',
      activeDispatch: { workerType: 'document-author', status: 'running' },
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
            remediationTarget: 'foundation' as const,
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

  test('does not pollute a complete review with historical remediation', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-complete-review-'))
    const run = {
      ...createInitialDeliveryRun({
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
        documentRevision: 'document-revision-2',
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_REVIEW' as const,
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
            remediationTarget: 'foundation' as const,
            documents: ['docs/UI_UX_SPEC.md'],
            description: 'A historical finding from the foundation review.',
            requiredAction: 'Recheck the current canonical documents.',
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
      contract: { reviewScope: 'complete' },
    })
    expect(started[0]?.contract).not.toHaveProperty('priorRemediation')
    const active = await controller.store.load()
    await controller.dispatcher.stop(
      active!.activeDispatch!.dispatchId,
      'test cleanup',
    )
  })
})
