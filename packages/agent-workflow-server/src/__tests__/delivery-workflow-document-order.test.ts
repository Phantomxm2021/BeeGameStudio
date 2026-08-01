import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDocumentReviewDispatch,
  completeDocumentDraft,
  createInitialDocumentReviewCycle,
  incrementDocumentReviewTransportAttempt,
  reconcileDocumentReview,
  startChecklistDraftStage,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import { validateDocumentReviewChecks } from '../beegame/delivery-workflow/document-review-input'
import {
  computeDocumentRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
  type DocumentReviewCheck,
  type DocumentReviewScope,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import type { WorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('single-track document review workflow', () => {
  test('uses the exact document-authoritative 7 plus 5 review matrix', () => {
    expect(FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS).toEqual([
      'brief_alignment',
      'cross_document_consistency',
      'gameplay_completeness',
      'technical_feasibility',
      'art_direction_coherence',
      'ui_audio_consistency',
      'acceptance_observability',
    ])
    expect(COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS).toEqual([
      'checklist_traceability',
      'resource_semantic_fitness',
      'content_structure_fitness',
      'resource_content_consistency',
      'implementation_readiness',
    ])
    expect(COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS).toEqual([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
      ...COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
    ])
  })

  test('carries completed foundation documents into an interrupted-pass retry', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-checkpoint-'))
    workspaces.push(workspacePath)
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs/GDD.md'), '# Durable GDD\n')
    const initial = createTestDeliveryRun({
      projectId: 'project-document-checkpoint',
      ownerId: 'owner-1',
      documentRevision: 'uncomputed',
    })
    let request: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run: {
        ...initial,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      },
      workspacePath,
      dispatcher: {
        async dispatch(value) {
          request = value
          return value
        },
      },
    })

    expect(request?.contract.existingDocumentPaths).toEqual(['docs/GDD.md'])
  })

  test('freezes one authority-bound Initial Review cycle and dispatch contract', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')

    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    const cycleId = run.documentReviewState.activeCycle?.cycleId
    const duplicate = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })

    expect(duplicate.documentReviewState.activeCycle?.cycleId).toBe(cycleId)
    run = incrementDocumentReviewTransportAttempt(run)
    const request = await buildDocumentReviewDispatch({ run, workspacePath })
    expect(request.contract).toMatchObject({
      reviewMode: 'initial',
      reviewScope: 'foundation',
      requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
      reviewAuthority: {
        confirmedBriefContext: run.confirmedBriefContext,
        confirmedBriefDigest: run.confirmedBriefDigest,
      },
    })
    expect(request.contract.reviewArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'systemDeliveryContract' }),
      ]),
    )
    expect(
      Object.keys(run.documentReviewState.activeCycle!.sourceArtifactDigests),
    ).toEqual(
      expect.arrayContaining([
        'reviewAuthority',
        'systemDeliveryContract',
        ...CANONICAL_FOUNDATION_DOCUMENTS,
      ]),
    )
    expect(run.documentReviewState.activeCycle?.transportAttempts).toBe(1)
  })

  test('keeps mixed findings in one ledger and selects the ordered foundation owner', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    run = incrementDocumentReviewTransportAttempt(run)
    const terminal = await reviewTerminal({
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
      verdict: 'NEEDS_REVISION',
      checks: checksWithBlocks('complete', {
        cross_document_consistency: ['foundation-conflict'],
        resource_semantic_fitness: ['resource-conflict'],
      }),
      findings: [
        reviewFinding({ findingId: 'foundation-conflict', checkId: 'cross_document_consistency', owner: 'foundation', path: 'docs/GDD.md' }),
        reviewFinding({ findingId: 'resource-conflict', checkId: 'resource_semantic_fitness', owner: 'resource', path: CANONICAL_ASSET_MANIFEST, requirementId: 'REQ-1' }),
      ],
    })

    const next = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal,
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(next.phase).toBe('DOCUMENT_DRAFTING')
    expect(next.documentStep).toBe('FOUNDATION_DRAFTING')
    expect(next.documentReviewState.activeCycle).toMatchObject({
      mode: 'initial',
      acceptedSemanticResult: true,
      activeTarget: 'foundation',
    })
    expect(next.documentReviewState.activeCycle?.findings).toHaveLength(2)
  })

  test('hands a passed comprehensive review to atomic task planning', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    run = incrementDocumentReviewTransportAttempt(run)

    const approved = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.revision.resource!,
        verdict: 'READY',
        checks: passingChecks('complete'),
        findings: [],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(approved).toMatchObject({
      phase: 'ATOMIC_TASK_PLANNING',
      status: 'running',
      documentReviewState: {
        comprehensiveApproval: {
          scope: 'complete',
          revision: run.revision.resource,
        },
      },
    })
  })

  test('repairs one finding batch, freezes the server diff, and closes it without a full re-review', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = incrementDocumentReviewTransportAttempt(run)
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          brief_alignment: ['authority-conflict'],
        }),
        findings: [
          reviewFinding({ findingId: 'authority-conflict', checkId: 'brief_alignment', owner: 'foundation', path: 'docs/GDD.md' }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    let authorRequest: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(request) {
          authorRequest = request
          return request
        },
      },
    })
    expect(authorRequest?.contract.systemDeliveryContract).toMatchObject({
      canonicalAssetManifest: {
        path: 'assets/asset-manifest.json',
        version: 7,
      },
      roots: {
        runtimeAssets: 'assets/runtime',
        content: 'assets/content',
        generatedAdapters: 'assets/generated',
      },
      content: { schema: 'beegame-content-v1' },
      resourceLoading: {
        manifestCount: 1,
        contentRootCount: 1,
        runtimeOrSourceMediaSubstituteAllowed: false,
        secondaryLoaderAllowed: false,
      },
    })
    const findingId = run.documentReviewState.activeCycle!.findings[0]!.findingId
    await writeFile(
      join(workspacePath, 'docs/GDD.md'),
      documentContent('GDD', '1.0.1', '2026-08-02T00:00:00.000Z'),
    )
    run = await completeDocumentDraft({
      run: withDispatch(run, authorRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: [findingId],
      },
      documentSet: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(run.documentReviewState.activeCycle).toMatchObject({
      mode: 'closure',
      activeTarget: 'foundation',
      acceptedSemanticResult: false,
      changedPaths: ['docs/GDD.md'],
    })
    expect(run.documentReviewState.repairPasses.foundation).toBe(1)
    run = incrementDocumentReviewTransportAttempt(run)
    const closureRequest = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    expect(closureRequest.contract).toMatchObject({
      reviewMode: 'closure',
      requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
      changedPaths: ['docs/GDD.md'],
    })
    expect((closureRequest.contract.priorFindings as unknown[])).toHaveLength(1)

    const closed = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.documentReviewState.activeCycle!.sourceRevision,
        verdict: 'READY',
        checks: passingChecks('foundation'),
        findings: [],
      }),
      currentDocumentRevision:
        run.documentReviewState.activeCycle!.sourceRevision,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(closed.documentReviewState.activeCycle).toBeUndefined()
    expect(closed.documentReviewState.foundationApproval?.revision).toBe(
      run.documentReviewState.activeCycle!.sourceRevision,
    )
    expect(closed.documentStep).toBe('CHECKLIST_DRAFTING')
  })

  test('closes checklist findings before handing the same ledger to the resource owner', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    run = incrementDocumentReviewTransportAttempt(run)
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.revision.resource!,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('complete', {
          checklist_traceability: ['checklist-gap'],
          resource_semantic_fitness: ['resource-gap'],
        }),
        findings: [
          reviewFinding({ findingId: 'checklist-gap', checkId: 'checklist_traceability', owner: 'checklist', path: 'docs/acceptance/gameplay-checklist.md' }),
          reviewFinding({ findingId: 'resource-gap', checkId: 'resource_semantic_fitness', owner: 'resource', path: CANONICAL_ASSET_MANIFEST, requirementId: 'REQ-1' }),
        ],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(run.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(run.documentReviewState.repairPasses).toEqual({
      foundation: 0,
      checklist: 1,
      resource: 0,
    })

    let authorRequest: WorkerDispatchRequest | undefined
    await startChecklistDraftStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(request) {
          authorRequest = request
          return request
        },
      },
    })
    const checklistFinding = run.documentReviewState.activeCycle!.findings.find(
      finding => finding.owner === 'checklist',
    )!
    await writeFile(
      join(workspacePath, 'docs/acceptance/gameplay-checklist.md'),
      `${documentContent('Acceptance', '1.0.1', '2026-08-02T00:00:00.000Z')}- [ ] PATH-001 source: docs/GDD.md implement: Execute and observe the canonical behavior expected: the complete behavior is visible evidence: runtime\n`,
    )
    run = await completeDocumentDraft({
      run: withDispatch(run, authorRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/acceptance/gameplay-checklist.md'],
        resolvedFindingIds: [checklistFinding.findingId],
      },
      documentSet: 'checklist',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(run.documentReviewState.repairPasses.checklist).toBe(1)
    run = incrementDocumentReviewTransportAttempt(run)
    const checklistClosureIds = new Set([
      'cross_document_consistency',
      'acceptance_observability',
      'checklist_traceability',
      'implementation_readiness',
    ])
    const afterChecklist = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.documentReviewState.activeCycle!.sourceRevision,
        verdict: 'READY',
        checks: passingChecks('complete').filter(check =>
          checklistClosureIds.has(check.id),
        ),
        findings: [],
      }),
      currentDocumentRevision:
        run.documentReviewState.activeCycle!.sourceRevision,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(afterChecklist.phase).toBe('RESOURCE_PREPARATION')
    expect(afterChecklist.documentReviewState.activeCycle).toMatchObject({
      activeTarget: 'resource',
      acceptedSemanticResult: true,
    })
    expect(afterChecklist.documentReviewState.activeCycle?.findings).toHaveLength(1)
    expect(afterChecklist.documentReviewState.activeCycle?.findings[0]?.findingId).toBe(
      'resource-gap',
    )
    expect(afterChecklist.documentReviewState.repairPasses).toEqual({
      foundation: 0,
      checklist: 1,
      resource: 1,
    })
  })

  test('does not enter a third repair pass from an initial review result', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = await createInitialDocumentReviewCycle({
      run: {
        ...run,
        documentReviewState: {
          ...run.documentReviewState,
          repairPasses: { foundation: 0, checklist: 0, resource: 2 },
        },
      },
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    run = incrementDocumentReviewTransportAttempt(run)
    const blocked = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.revision.resource!,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('complete', {
          resource_semantic_fitness: ['resource-gap'],
        }),
        findings: [
          reviewFinding({ findingId: 'resource-gap', checkId: 'resource_semantic_fitness', owner: 'resource', path: CANONICAL_ASSET_MANIFEST, requirementId: 'REQ-1' }),
        ],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(blocked.status).toBe('needs_action')
    expect(blocked.phase).toBe('DOCUMENT_REVIEW')
    expect(blocked.documentReviewState.repairPasses.resource).toBe(2)
    expect(blocked.blockedReason).toContain('exhausted its bounded repair passes')
  })

  test('accepts only changed-path regressions during Closure Review', async () => {
    const workspacePath = await createWorkspace()
    const base = await reviewRun(workspacePath, 'foundation')
    const run: DeliveryRun = {
      ...base,
      documentReviewState: {
        ...base.documentReviewState,
        activeCycle: {
          cycleId: 'closure-cycle',
          parentCycleId: 'initial-cycle',
          originScope: 'foundation',
          scope: 'foundation',
          mode: 'closure',
          sourceRevision: base.revision.document,
          requiredCheckIds: ['brief_alignment'],
          checks: [],
          checkEvidenceDigests: {},
          findings: [],
          activeTarget: 'foundation',
          acceptedSemanticResult: false,
          transportAttempts: 1,
          changedPaths: ['docs/GDD.md'],
          sourceArtifactDigests: {},
        },
      },
    }
    const regression = (path: string) => reviewFinding({
      findingId: 'regression-1',
      checkId: 'brief_alignment',
      owner: 'foundation',
      path: 'docs/GDD.md',
      regressionPaths: [path],
    })
    const checks = [
      {
        ...passingChecks('foundation')[0]!,
        status: 'block' as const,
        findingIds: ['regression-1'],
      },
    ]

    await expect(
      reconcileDocumentReview({
        run,
        workspacePath,
        terminal: await reviewTerminal({
          workspacePath,
          scope: 'foundation',
          revision: base.revision.document,
          verdict: 'NEEDS_REVISION',
          checks,
          findings: [regression('docs/TECHNICAL_DESIGN.md')],
        }),
        currentDocumentRevision: base.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('changed-path regression')

    const accepted = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: base.revision.document,
        verdict: 'NEEDS_REVISION',
        checks,
        findings: [regression('docs/GDD.md')],
      }),
      currentDocumentRevision: base.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(accepted.phase).toBe('DOCUMENT_DRAFTING')
    expect(accepted.documentReviewState.activeCycle?.findings[0]?.findingId).toBe(
      'regression-1',
    )
  })

  test('rejects a semantically incomplete check matrix at the active scope boundary', () => {
    expect(validateDocumentReviewChecks({
      scope: 'foundation',
      checks: [],
      artifacts: [],
    })).toContain('document review does not cover the required check set')
  })
})

async function createWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-review-contract-'))
  workspaces.push(workspacePath)
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
    await mkdir(join(workspacePath, path, '..'), { recursive: true })
    await writeFile(
      join(workspacePath, path),
      documentContent(`Spec ${index + 1}`, '1.0.0', '2026-08-01T00:00:00.000Z'),
    )
  }
  await mkdir(join(workspacePath, 'docs/acceptance'), { recursive: true })
  await writeFile(
    join(workspacePath, 'docs/acceptance/gameplay-checklist.md'),
    `${documentContent('Acceptance', '1.0.0', '2026-08-01T00:00:00.000Z')}- [ ] PATH-001 source: docs/GDD.md implement: Execute the observable behavior expected: the behavior is visible evidence: runtime\n`,
  )
  await mkdir(join(workspacePath, 'assets'), { recursive: true })
  await writeFile(
    join(workspacePath, CANONICAL_ASSET_MANIFEST),
    `${JSON.stringify(
      {
        version: 7,
        project_target: {
          platform: 'selected-target',
          runtime: 'project-native',
          asset_format_capabilities: ['glb'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [{ id: 'REQ-1', required: true }],
        resources: [{ id: 'RES-1', status: 'verified' }],
      },
      null,
      2,
    )}\n`,
  )
  return workspacePath
}

function documentContent(title: string, version: string, updatedAt: string): string {
  return `---\nversion: ${version}\nupdated_at: ${updatedAt}\n---\n# ${title}\n\n## Spec\n\nCanonical specification.\n`
}

async function reviewRun(
  workspacePath: string,
  scope: DocumentReviewScope,
): Promise<DeliveryRun> {
  const initial = createTestDeliveryRun({
    runId: `run-${scope}`,
    projectId: `project-${scope}`,
    ownerId: 'owner-1',
  })
  const documentRevision = await computeDocumentRevision(
    workspacePath,
    initial.confirmedBriefDigest,
  )
  const resourceRevision = await computeResourceRevision(
    workspacePath,
    documentRevision,
  )
  return {
    ...initial,
    phase: 'DOCUMENT_REVIEW',
    documentStep: scope === 'foundation' ? 'FOUNDATION_REVIEW' : 'CHECKLIST_REVIEW',
    revision: {
      ...initial.revision,
      document: documentRevision,
      ...(scope === 'complete' ? { resource: resourceRevision } : {}),
    },
  }
}

function passingChecks(scope: DocumentReviewScope): DocumentReviewCheck[] {
  const ids =
    scope === 'foundation'
      ? FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS
      : COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS
  return ids.map(id => ({
    id,
    status: 'pass',
    conclusion: 'The required invariant is satisfied.',
    evidence: [
      { path: 'docs/GDD.md', anchor: 'Spec' },
      ...([
        'cross_document_consistency',
        'technical_feasibility',
        'content_structure_fitness',
        'resource_content_consistency',
      ].includes(id)
        ? [
            {
              path: 'systemDeliveryContract',
              anchor: '/canonicalAssetManifest/path',
            },
          ]
        : []),
    ],
    findingIds: [],
  }))
}

function checksWithBlocks(
  scope: DocumentReviewScope,
  blocks: Partial<Record<DocumentReviewCheck['id'], string[]>>,
): DocumentReviewCheck[] {
  return passingChecks(scope).map(check =>
    blocks[check.id]
      ? { ...check, status: 'block' as const, findingIds: blocks[check.id]! }
      : check,
  )
}

function reviewFinding(input: {
  findingId: string
  checkId: DocumentReviewCheck['id']
  owner: 'foundation' | 'checklist' | 'resource'
  path: string
  anchor?: string
  requirementId?: string
  regressionPaths?: string[]
}) {
  return {
    findingId: input.findingId,
    checkId: input.checkId,
    severity: 'blocking' as const,
    owner: input.owner,
    ...(input.regressionPaths ? { regressionPaths: input.regressionPaths } : {}),
    subjects: [{
      path: input.path,
      anchor: input.anchor ?? (input.path.endsWith('.md') ? 'Spec' : '$'),
      ...(input.requirementId ? { requirementId: input.requirementId } : {}),
    }],
    observation: 'The current artifacts contain a blocking inconsistency.',
    blockingReason: 'The current review gate cannot approve an ambiguous contract.',
    requiredAction: 'Correct the canonical artifact.',
    closureCondition: 'The cited artifacts agree and the check passes.',
  }
}

async function reviewTerminal(input: {
  workspacePath: string
  scope: DocumentReviewScope
  revision: string
  verdict: 'READY' | 'NEEDS_REVISION' | 'BLOCKED'
  checks: DocumentReviewCheck[]
  findings: Extract<
    WorkerTerminalResult,
    { workerType: 'document-reviewer' }
  >['findings']
}): Promise<Extract<WorkerTerminalResult, { workerType: 'document-reviewer' }>> {
  const evidencePath = `.beegame/workflow/evidence/review-${randomUUID()}.json`
  await mkdir(join(input.workspacePath, '.beegame/workflow/evidence'), {
    recursive: true,
  })
  await writeFile(join(input.workspacePath, evidencePath), '{}\n')
  return {
    workerType: 'document-reviewer',
    revision: input.revision,
    verdict: input.verdict,
    checks: input.checks,
    reviewedDocumentPaths:
      input.scope === 'foundation'
        ? [...CANONICAL_FOUNDATION_DOCUMENTS]
        : [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST],
    checklistIds: input.scope === 'foundation' ? [] : ['PATH-001'],
    findings: input.findings,
    evidencePath,
  }
}

function withDispatch(
  run: DeliveryRun,
  request: WorkerDispatchRequest,
): DeliveryRun {
  return {
    ...run,
    activeDispatch: {
      dispatchId: 'author-dispatch',
      workerType: 'document-author',
      phase: run.phase,
      revision: run.revision.document,
      status: 'completed',
      request,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    },
  }
}
