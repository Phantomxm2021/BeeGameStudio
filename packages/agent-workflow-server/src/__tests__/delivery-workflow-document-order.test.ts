import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  beginResourceDocumentReviewClosure,
  buildDocumentReviewDispatch,
  completeDocumentDraft,
  createInitialDocumentReviewCycle,
  deriveFoundationRepairGroups,
  documentReviewerDispatchMatchesActivePacket,
  reconcileDocumentReview as reconcileDocumentReviewCheck,
  startChecklistDraftStage,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import { validateDocumentReviewSubmission } from '../beegame/delivery-workflow/document-review-input'
import { repairPlanMatchesCanonicalGraph } from '../beegame/delivery-workflow/document-repair-graph'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import { parseDeliveryRun } from '../beegame/delivery-workflow/schema'
import {
  computeDocumentRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'
import { startResourcePreparation } from '../beegame/delivery-workflow/resource-stage'
import { writeBeeGameAssetManifest } from '../beegame/asset-contracts'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  DOCUMENT_REVIEW_CHECK_PACKETS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_PACKETS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  GAME_DESIGN_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
  type DocumentReviewCheck,
  type DocumentReviewScope,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import type { WorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

const workspaces: string[] = []

function minimumRepairPlan(
  request: WorkerDispatchRequest,
  groupDecisions: string[],
) {
  const groups = (
    request.contract.repairPlanTask as {
      groups: Array<{
        subjectPaths: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number][]
      }>
    }
  ).groups
  return {
    decisions: groups.map((group, index) => ({
      groupDecision: groupDecisions[index] ?? `Repair group ${index + 1}.`,
      pathDecisions: group.subjectPaths.map(path => ({
        path,
        decision: `Apply the group decision to ${path}.`,
      })),
    })),
  }
}

async function reconcileDocumentReview(
  input: Parameters<typeof reconcileDocumentReviewCheck>[0],
): Promise<DeliveryRun> {
  let run = input.run
  while (
    run.documentReviewState.activeCycle &&
    !run.documentReviewState.activeCycle.acceptedSemanticResult
  ) {
    const request = await buildDocumentReviewDispatch({
      run,
      workspacePath: input.workspacePath,
    })
    const currentCheckIds = request.contract
      .currentCheckIds as DocumentReviewCheck['id'][]
    const checks = currentCheckIds.map(checkId => {
      const check = input.terminal.checks.find(item => item.id === checkId)
      if (!check) throw new Error(`missing test review check ${checkId}`)
      return check
    })
    const findings = input.terminal.findings.filter(finding =>
      currentCheckIds.includes(finding.checkId),
    )
    run = await reconcileDocumentReviewCheck({
      ...input,
      run,
      terminal: {
        ...input.terminal,
        verdict: checks.every(check => check.status === 'pass')
          ? 'READY'
          : 'NEEDS_REVISION',
        checks,
        findings,
      },
    })
  }
  return run
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('single-track document review workflow', () => {
  test('groups shared repair subjects and derives owner dependencies', () => {
    const groups = deriveFoundationRepairGroups([
      reviewFinding({
        findingId: 'gdd-a',
        checkId: 'brief_alignment',
        owner: 'foundation',
        path: 'docs/GDD.md',
      }),
      reviewFinding({
        findingId: 'gdd-b',
        checkId: 'brief_alignment',
        owner: 'foundation',
        path: 'docs/GDD.md',
      }),
      reviewFinding({
        findingId: 'balance-a',
        checkId: 'numeric_balance_feasibility',
        owner: 'foundation',
        path: 'docs/BALANCE_DESIGN.md',
      }),
      reviewFinding({
        findingId: 'ui-a',
        checkId: 'ui_audio_consistency',
        owner: 'foundation',
        path: 'docs/UI_UX_SPEC.md',
      }),
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({
      subjectPaths: ['docs/GDD.md'],
      dependsOn: [],
    })
    expect(groups[0]?.findings.map(finding => finding.findingId)).toEqual([
      'gdd-a',
      'gdd-b',
    ])
    expect(groups[1]?.dependsOn).toEqual(['repair-group-1'])
    expect(groups[2]?.dependsOn).toEqual(['repair-group-1'])
  })

  test('groups findings through their shared highest fact owner', () => {
    const groups = deriveFoundationRepairGroups([
      reviewFinding({
        findingId: 'balance-conflict',
        checkId: 'numeric_balance_feasibility',
        owner: 'foundation',
        path: 'docs/BALANCE_DESIGN.md',
        evidence: [
          { path: 'docs/GDD.md', anchor: 'Spec' },
          { path: 'docs/BALANCE_DESIGN.md', anchor: 'Spec' },
        ],
      }),
      reviewFinding({
        findingId: 'ui-conflict',
        checkId: 'ui_audio_consistency',
        owner: 'foundation',
        path: 'docs/UI_UX_SPEC.md',
        evidence: [
          { path: 'docs/GDD.md', anchor: 'Spec' },
          { path: 'docs/UI_UX_SPEC.md', anchor: 'Spec' },
        ],
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.findings.map(finding => finding.findingId)).toEqual([
      'balance-conflict',
      'ui-conflict',
    ])
  })
  test('accepts a canonical graph prefix when owner order differs from finding discovery order', () => {
    const findings = [
      reviewFinding({
        findingId: 'ui-discovered-first',
        checkId: 'cross_document_consistency',
        owner: 'foundation',
        path: 'docs/UI_UX_SPEC.md',
      }),
      reviewFinding({
        findingId: 'gdd-owned-first',
        checkId: 'gameplay_strategy_viability',
        owner: 'foundation',
        path: 'docs/GDD.md',
      }),
    ]
    const derived = deriveFoundationRepairGroups(findings)
    expect(derived[0]?.findings.map(finding => finding.findingId)).toEqual([
      'gdd-owned-first',
    ])
    expect(
      repairPlanMatchesCanonicalGraph(
        [
          {
            groupId: derived[0]!.groupId,
            findingIds: derived[0]!.findings.map(finding => finding.findingId),
            groupDecision: 'Repair the canonical upstream owner first.',
            pathDecisions: derived[0]!.subjectPaths.map(path => ({
              path,
              decision: 'Repair this owner.',
            })),
            dependsOn: derived[0]!.dependsOn,
          },
        ],
        derived,
      ),
    ).toBe(true)
    const firstGroup = derived[0]!
    const canonicalPlanGroup = {
      groupId: firstGroup.groupId,
      findingIds: firstGroup.findings.map(finding => finding.findingId),
      groupDecision: 'Repair the canonical upstream owner first.',
      pathDecisions: firstGroup.subjectPaths.map(path => ({
        path,
        decision: 'Repair this owner.',
      })),
      dependsOn: firstGroup.dependsOn,
    }
    expect(
      repairPlanMatchesCanonicalGraph(
        [
          {
            ...canonicalPlanGroup,
            findingIds: [
              ...canonicalPlanGroup.findingIds,
              canonicalPlanGroup.findingIds[0]!,
            ],
          },
        ],
        derived,
      ),
    ).toBe(false)
    expect(
      repairPlanMatchesCanonicalGraph(
        [
          {
            ...canonicalPlanGroup,
            pathDecisions: [
              ...canonicalPlanGroup.pathDecisions,
              canonicalPlanGroup.pathDecisions[0]!,
            ],
          },
        ],
        derived,
      ),
    ).toBe(false)
    const secondGroup = derived[1]!
    expect(
      repairPlanMatchesCanonicalGraph(
        [
          canonicalPlanGroup,
          {
            groupId: secondGroup.groupId,
            findingIds: secondGroup.findings.map(finding => finding.findingId),
            groupDecision: 'Repair the dependent UI owner.',
            pathDecisions: secondGroup.subjectPaths.map(path => ({
              path,
              decision: 'Repair this owner.',
            })),
            dependsOn: [...secondGroup.dependsOn, secondGroup.dependsOn[0]!],
          },
        ],
        derived,
      ),
    ).toBe(false)
  })
  test('uses 12 Foundation checks, one checklist check and 3 resource checks in 2 packets', () => {
    expect(CANONICAL_FOUNDATION_DOCUMENTS).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ])
    expect(CANONICAL_PROJECT_DOCUMENTS).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
      'docs/acceptance/gameplay-checklist.md',
    ])
    expect(FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS).toEqual([
      'brief_alignment',
      'cross_document_consistency',
      'gameplay_completeness',
      'gameplay_strategy_viability',
      'economy_progression_integrity',
      'numeric_balance_feasibility',
      'pacing_difficulty_coherence',
      'level_scene_design_integrity',
      'technical_feasibility',
      'art_direction_coherence',
      'ui_audio_consistency',
      'acceptance_observability',
    ])
    expect(COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS).toEqual([
      'resource_semantic_fitness',
      'content_structure_fitness',
      'resource_content_consistency',
    ])
    expect(COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS).toEqual([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
      ...COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
    ])
    expect(CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS).toEqual([
      'checklist_traceability',
    ])
    expect(FOUNDATION_DOCUMENT_REVIEW_CHECK_PACKETS).toEqual([
      [
        'brief_alignment',
        'cross_document_consistency',
        'gameplay_completeness',
      ],
      ['gameplay_strategy_viability', 'economy_progression_integrity'],
      ['numeric_balance_feasibility', 'pacing_difficulty_coherence'],
      [
        'level_scene_design_integrity',
        'technical_feasibility',
        'art_direction_coherence',
        'ui_audio_consistency',
      ],
      ['acceptance_observability'],
    ])
    expect(DOCUMENT_REVIEW_CHECK_PACKETS.slice(-2)).toEqual([
      ['resource_semantic_fitness'],
      ['content_structure_fitness', 'resource_content_consistency'],
    ])
    expect(GAME_DESIGN_DOCUMENT_REVIEW_CHECK_IDS).toHaveLength(5)
    expect(
      Object.values(GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA).reduce(
        (total, criteria) => total + criteria.length,
        0,
      ),
    ).toBe(15)
  })

  test('uses the durable cursor instead of existing files for the next author task', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-checkpoint-'))
    workspaces.push(workspacePath)
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs/GDD.md'), '# Durable GDD\n')
    const initial = createTestDeliveryRun({
      projectId: 'project-document-checkpoint',
      ownerId: 'owner-1',
      documentRevision: 'uncomputed',
      foundationDraftComplete: false,
    })
    let request: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run: {
        ...initial,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        foundationDraftState: { completedPaths: ['docs/GDD.md'] },
      },
      workspacePath,
      dispatcher: {
        async dispatch(value) {
          request = value
          return value
        },
      },
    })

    expect(request?.allowedPaths).toEqual(['docs/LEVEL_SCENE_DESIGN.md'])
    expect(request?.taskId).toBe('docs/LEVEL_SCENE_DESIGN.md')
    expect(request?.contract).toMatchObject({
      authoringMode: 'initial',
      foundationDocumentPath: 'docs/LEVEL_SCENE_DESIGN.md',
      upstreamDocumentPaths: ['docs/GDD.md'],
    })
    expect(request?.contract).not.toHaveProperty('existingDocumentPaths')
  })

  test('authors eight durable single-document tasks before entering review', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-serial-'))
    workspaces.push(workspacePath)
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    let run: DeliveryRun = {
      ...createTestDeliveryRun({
        projectId: 'project-document-serial',
        ownerId: 'owner-1',
        documentRevision: 'uncomputed',
        foundationDraftComplete: false,
      }),
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
    }
    const expectedUpstreamPaths = [
      [],
      ['docs/GDD.md'],
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md'],
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/UI_UX_SPEC.md'],
      [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
      ],
    ]

    for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
      let request: WorkerDispatchRequest | undefined
      await startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(value) {
            request = value
            return value
          },
        },
      })
      expect(request?.allowedPaths).toEqual([path])
      expect(request?.taskId).toBe(path)
      expect(request?.contract.upstreamDocumentPaths).toEqual(
        expectedUpstreamPaths[index],
      )
      await mkdir(join(workspacePath, path, '..'), { recursive: true })
      await writeFile(
        join(workspacePath, path),
        documentContent(path, '1.0.0', '2026-08-03T00:00:00.000Z'),
      )
      run = await completeDocumentDraft({
        run: withDispatch(run, request!),
        workspacePath,
        terminal: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: [path],
          resolvedFindingIds: [],
        },
        documentSet: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      })
      expect(run.foundationDraftState.completedPaths).toEqual(
        CANONICAL_FOUNDATION_DOCUMENTS.slice(0, index + 1),
      )
      if (index < CANONICAL_FOUNDATION_DOCUMENTS.length - 1) {
        expect(run.phase).toBe('DOCUMENT_DRAFTING')
        expect(run.documentStep).toBe('FOUNDATION_DRAFTING')
      }
    }

    expect(run.phase).toBe('DOCUMENT_REVIEW')
    expect(run.documentStep).toBe('FOUNDATION_REVIEW')
  })

  test('rejects review state before all durable authoring checkpoints exist', () => {
    const run = createTestDeliveryRun({
      projectId: 'project-premature-review',
      ownerId: 'owner-1',
      foundationDraftComplete: false,
    })
    expect(() =>
      parseDeliveryRun({
        ...run,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      }),
    ).toThrow('require all durable authoring checkpoints')
  })

  test('rejects resource and downstream state without the frozen current checklist approval', () => {
    const run = createTestDeliveryRun({
      projectId: 'project-unapproved-resource-entry',
      ownerId: 'owner-1',
    })
    expect(() =>
      parseDeliveryRun({
        ...run,
        phase: 'RESOURCE_PREPARATION',
      }),
    ).toThrow('require the frozen current checklist approval')

    const checklistChecks = passingChecks('checklist')
    expect(() =>
      parseDeliveryRun({
        ...run,
        phase: 'RESOURCE_PREPARATION',
        documentReviewState: {
          ...run.documentReviewState,
          checklistApproval: {
            scope: 'checklist',
            revision: 'stale-document-revision',
            checks: checklistChecks,
            checkEvidenceDigests: {},
            evidencePath: 'docs/reviews/checklist.json',
            approvedAt: '2026-08-05T00:00:00.000Z',
          },
        },
      }),
    ).toThrow('require the frozen current checklist approval')

    expect(() =>
      parseDeliveryRun({
        ...run,
        phase: 'RESOURCE_PREPARATION',
        documentReviewState: {
          ...run.documentReviewState,
          checklistApproval: {
            scope: 'checklist',
            revision: run.revision.document,
            checks: checklistChecks,
            checkEvidenceDigests: {},
            evidencePath: 'docs/reviews/checklist.json',
            approvedAt: '2026-08-05T00:00:00.000Z',
          },
        },
      }),
    ).not.toThrow()
  })

  test('freezes one authority-bound Initial Review cycle and dispatch contract', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    const confirmedBriefContext = JSON.stringify({
      kind: 'confirmed_build_brief',
      idea: 'Test the current packet boundary.',
    })
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    run = {
      ...run,
      confirmedBriefContext,
      confirmedBriefDigest,
      revision: {
        ...run.revision,
        document: await computeDocumentRevision(
          workspacePath,
          confirmedBriefDigest,
        ),
      },
    }

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
    const request = await buildDocumentReviewDispatch({ run, workspacePath })
    const repeatedRequest = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    expect(repeatedRequest.contract.referenceIndex).toBe(
      request.contract.referenceIndex,
    )
    expect(request.contract).toMatchObject({
      reviewMode: 'initial',
      reviewScope: 'foundation',
      requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
      currentCheckIds: [
        'brief_alignment',
        'cross_document_consistency',
        'gameplay_completeness',
      ],
      reviewAuthority: {
        confirmedBriefContext: run.confirmedBriefContext,
        confirmedBriefDigest: run.confirmedBriefDigest,
      },
    })
    expect(request.contract.reviewArtifacts).toHaveLength(
      CANONICAL_FOUNDATION_DOCUMENTS.length + 1,
    )
    expect(request.contract.reviewArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'systemDeliveryContract' }),
      ]),
    )
    expect(request.contract.referenceIndex).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({ path: 'docs/GDD.md' }),
      ]),
      references: expect.arrayContaining([
        expect.objectContaining({
          subjectOwner: 'foundation',
        }),
      ]),
    })
    expect(request.contract.artifactPathsByCheck).toMatchObject({
      brief_alignment: expect.not.arrayContaining(['systemDeliveryContract']),
      cross_document_consistency: expect.arrayContaining([
        'systemDeliveryContract',
        'docs/GDD.md',
      ]),
      gameplay_completeness: expect.not.arrayContaining([
        'docs/TECHNICAL_DESIGN.md',
      ]),
    })
    expect(
      Object.keys(run.documentReviewState.activeCycle!.sourceArtifactDigests),
    ).toEqual(
      expect.arrayContaining([
        'reviewAuthority',
        'systemDeliveryContract',
        ...CANONICAL_FOUNDATION_DOCUMENTS,
      ]),
    )

    const firstPacket = passingChecks('foundation').slice(0, 3)
    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'READY',
        checks: firstPacket,
        findings: [],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(run.documentReviewState.activeCycle).toMatchObject({
      completedCheckIds: [
        'brief_alignment',
        'cross_document_consistency',
        'gameplay_completeness',
      ],
      acceptedSemanticResult: false,
    })
    const strategyEconomyDispatch = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    expect(strategyEconomyDispatch.contract.currentCheckIds).toEqual([
      'gameplay_strategy_viability',
      'economy_progression_integrity',
    ])
    expect(strategyEconomyDispatch.contract.criteriaByCheck).toEqual({
      gameplay_strategy_viability: [
        'meaningful_choices',
        'dominant_strategy_risk',
        'counterplay_and_recovery',
      ],
      economy_progression_integrity: [
        'sources_and_sinks',
        'affordability_and_growth',
        'exploit_and_deadlock',
      ],
    })
    expect(
      documentReviewerDispatchMatchesActivePacket(run, {
        dispatchId: 'old-four-check-packet',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: run.revision.document,
        status: 'completed',
        request: {
          ...strategyEconomyDispatch,
          contract: {
            ...strategyEconomyDispatch.contract,
            currentCheckIds: [
              'gameplay_strategy_viability',
              'economy_progression_integrity',
              'numeric_balance_feasibility',
              'pacing_difficulty_coherence',
            ],
          },
        },
        terminalResult: { workerType: 'document-reviewer' },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }),
    ).toBe(false)
    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'READY',
        checks: passingChecks('foundation').slice(3, 5),
        findings: [],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(
      (await buildDocumentReviewDispatch({ run, workspacePath })).contract
        .currentCheckIds,
    ).toEqual(['numeric_balance_feasibility', 'pacing_difficulty_coherence'])
    await writeFile(
      join(workspacePath, 'docs/GDD.md'),
      documentContent('Changed Rules', '1.0.1', '2026-08-04T00:00:00.000Z'),
    )
    await expect(
      buildDocumentReviewDispatch({ run, workspacePath }),
    ).rejects.toThrow('canonical artifacts changed during document review')
  })

  test('rejects an incomplete review packet without persisting any check', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    const terminal = await reviewTerminal({
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
      verdict: 'READY',
      checks: passingChecks('foundation').slice(0, 2),
      findings: [],
    })

    await expect(
      reconcileDocumentReviewCheck({
        run,
        workspacePath,
        terminal,
        currentDocumentRevision: run.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('active check packet')
    expect(run.documentReviewState.activeCycle?.completedCheckIds).toEqual([])
    await expect(
      readFile(join(workspacePath, terminal.evidencePath), 'utf8'),
    ).rejects.toThrow()
  })

  test('discards a terminal from a stale packet boundary and dispatches the current packet', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    const confirmedBriefContext = JSON.stringify({
      kind: 'confirmed_build_brief',
      idea: 'Test stale packet terminal recovery.',
    })
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    run = {
      ...run,
      confirmedBriefContext,
      confirmedBriefDigest,
      revision: {
        ...run.revision,
        document: await computeDocumentRevision(
          workspacePath,
          confirmedBriefDigest,
        ),
      },
    }
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'READY',
        checks: passingChecks('foundation').slice(0, 3),
        findings: [],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    const currentRequest = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    const staleRequest = {
      ...currentRequest,
      dispatchId: 'stale-packet-dispatch',
      contract: {
        ...currentRequest.contract,
        currentCheckIds: [
          'gameplay_strategy_viability',
          'economy_progression_integrity',
          'numeric_balance_feasibility',
          'pacing_difficulty_coherence',
        ],
      },
    }
    run = {
      ...run,
      activeDispatch: {
        dispatchId: staleRequest.dispatchId,
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: run.revision.document,
        status: 'completed',
        request: staleRequest,
        terminalResult: { workerType: 'document-reviewer' },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    }
    let dispatched: WorkerDispatchRequest | undefined
    const controller = createDeliveryWorkflowController({
      workspacePath,
      ownerId: run.ownerId,
      workerPort: {
        async start(request) {
          dispatched = request
          return {
            sessionId: 'current-packet-session',
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
    await controller.store.save(run)
    await controller.resume(run)

    expect(dispatched?.contract.currentCheckIds).toEqual([
      'gameplay_strategy_viability',
      'economy_progression_integrity',
    ])
    expect(
      (await controller.store.load())?.activeDispatch?.request?.contract
        .currentCheckIds,
    ).toEqual(['gameplay_strategy_viability', 'economy_progression_integrity'])
  })

  test('inherits one fresh Foundation approval prefix and dispatches only Comprehensive additions', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'READY',
        checks: passingChecks('foundation'),
        findings: [],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    const resourceRevision = await computeResourceRevision(
      workspacePath,
      run.revision.document,
    )
    run = {
      ...run,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'COMPREHENSIVE_REVIEW',
      revision: { ...run.revision, resource: resourceRevision },
    }
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: resourceRevision,
    })

    expect(run.documentReviewState.activeCycle).toMatchObject({
      requiredCheckIds: [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS],
      completedCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
      acceptedSemanticResult: false,
    })
    const resourceSemanticsDispatch = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    expect(resourceSemanticsDispatch.contract.currentCheckIds).toEqual([
      'resource_semantic_fitness',
    ])

    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: resourceRevision,
        verdict: 'READY',
        checks: passingChecks('complete').filter(
          check => check.id === 'resource_semantic_fitness',
        ),
        findings: [],
      }),
      currentDocumentRevision: resourceRevision,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    const contentIntegrationDispatch = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    expect(contentIntegrationDispatch.contract.currentCheckIds).toEqual([
      'content_structure_fitness',
      'resource_content_consistency',
    ])

    await expect(
      reconcileDocumentReviewCheck({
        run,
        workspacePath,
        terminal: await reviewTerminal({
          workspacePath,
          scope: 'complete',
          revision: resourceRevision,
          verdict: 'READY',
          checks: passingChecks('complete').filter(
            check => check.id === 'content_structure_fitness',
          ),
          findings: [],
        }),
        currentDocumentRevision: resourceRevision,
        scope: 'complete',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow(
      'document review must submit exactly the active check packet',
    )
  })

  test('does not partially inherit a stale Foundation approval', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'READY',
        checks: passingChecks('foundation'),
        findings: [],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    await writeFile(
      join(workspacePath, 'docs/GDD.md'),
      documentContent('Changed GDD', '1.0.1', '2026-08-02T00:00:00.000Z'),
    )
    const documentRevision = await computeDocumentRevision(
      workspacePath,
      run.confirmedBriefDigest,
    )
    const resourceRevision = await computeResourceRevision(
      workspacePath,
      documentRevision,
    )
    run = {
      ...run,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'COMPREHENSIVE_REVIEW',
      revision: {
        ...run.revision,
        document: documentRevision,
        resource: resourceRevision,
      },
    }
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: resourceRevision,
    })

    expect(run.documentReviewState.activeCycle?.completedCheckIds).toEqual([])
    expect(
      (await buildDocumentReviewDispatch({ run, workspacePath })).contract
        .currentCheckIds,
    ).toEqual([
      'brief_alignment',
      'cross_document_consistency',
      'gameplay_completeness',
    ])
  })

  test('projects complete accepted finding ownership into every later check', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    const acceptedFinding = reviewFinding({
      findingId: 'owned-root',
      checkId: 'brief_alignment',
      owner: 'foundation',
      path: 'docs/GDD.md',
    })
    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          brief_alignment: ['owned-root'],
        }).slice(0, 3),
        findings: [acceptedFinding],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    const request = await buildDocumentReviewDispatch({ run, workspacePath })
    expect(request.contract.priorFindings).toEqual([
      expect.objectContaining({
        findingId: 'owned-root',
        checkId: 'brief_alignment',
        owner: 'foundation',
        subjects: acceptedFinding.subjects,
        blockingImpact: acceptedFinding.blockingImpact,
        requiredOutcome: acceptedFinding.requiredOutcome,
      }),
    ])
  })

  test('rejects a finding ID already accepted by an earlier Initial packet', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    const acceptedFinding = reviewFinding({
      findingId: 'cycle-unique-finding',
      checkId: 'cross_document_consistency',
      owner: 'foundation',
      path: 'docs/GDD.md',
    })
    run = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          cross_document_consistency: [acceptedFinding.findingId],
        }).slice(0, 3),
        findings: [acceptedFinding],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    const duplicate = reviewFinding({
      findingId: acceptedFinding.findingId,
      checkId: 'gameplay_strategy_viability',
      owner: 'foundation',
      path: 'docs/GDD.md',
    })
    await expect(
      reconcileDocumentReviewCheck({
        run,
        workspacePath,
        terminal: await reviewTerminal({
          workspacePath,
          scope: 'foundation',
          revision: run.revision.document,
          verdict: 'NEEDS_REVISION',
          checks: checksWithBlocks('foundation', {
            gameplay_strategy_viability: [duplicate.findingId],
          }).slice(3, 5),
          findings: [duplicate],
        }),
        currentDocumentRevision: run.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('finding ID already exists in the cycle ledger')
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
        reviewFinding({
          findingId: 'foundation-conflict',
          checkId: 'cross_document_consistency',
          owner: 'foundation',
          path: 'docs/GDD.md',
        }),
        reviewFinding({
          findingId: 'resource-conflict',
          checkId: 'resource_semantic_fitness',
          owner: 'resource',
          path: CANONICAL_ASSET_MANIFEST,
          requirementId: 'REQ-1',
        }),
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
    expect(
      approved.documentReviewState.comprehensiveApproval?.checks.map(
        check => check.id,
      ),
    ).toEqual([...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS])
    expect(
      approved.documentReviewState.comprehensiveApproval?.checks,
    ).toHaveLength(15)
  })

  test('rejects an unplanned document mutation before repair planning', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
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
          reviewFinding({
            findingId: 'authority-conflict',
            checkId: 'brief_alignment',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    await writeFile(
      join(workspacePath, 'docs/GDD.md'),
      documentContent('GDD', '1.0.1', '2026-08-02T00:00:00.000Z'),
    )

    await expect(
      startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(request) {
            return request
          },
        },
      }),
    ).rejects.toThrow('canonical artifacts changed during document review')
  })

  test('accepts the complete canonical repair plan atomically', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          brief_alignment: ['gdd-finding'],
          numeric_balance_feasibility: ['balance-finding'],
        }),
        findings: [
          reviewFinding({
            findingId: 'gdd-finding',
            checkId: 'brief_alignment',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
          reviewFinding({
            findingId: 'balance-finding',
            checkId: 'numeric_balance_feasibility',
            owner: 'foundation',
            path: 'docs/BALANCE_DESIGN.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    let planningRequest: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(request) {
          planningRequest = request
          return request
        },
      },
    })
    const rejected = await completeDocumentDraft({
      run: withDispatch(run, planningRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan: minimumRepairPlan(planningRequest!, [
          'Correct the GDD authority.',
          'Correct the Balance authority.',
        ]),
      },
      documentSet: 'foundation',
    })
    expect(rejected.blockedReason).toBeUndefined()
    expect(
      rejected.documentReviewState.activeCycle?.repairPlan?.groups,
    ).toHaveLength(2)
  })

  test('keeps cross-document evidence outside the exact repair subject scope', async () => {
    const workspacePath = await createWorkspace()
    await writeFile(
      join(workspacePath, 'docs/BALANCE_DESIGN.md'),
      `${documentContent('Balance', '1.0.0', '2026-08-01T00:00:00.000Z')}\nThe shared authority is \`ECONOMY.THRESHOLD\`.\n`,
    )
    await writeFile(
      join(workspacePath, 'docs/TECHNICAL_DESIGN.md'),
      `${documentContent('Technical', '1.0.0', '2026-08-01T00:00:00.000Z')}\nRuntime consumes \`ECONOMY.THRESHOLD\`.\n`,
    )
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    const finding = reviewFinding({
      findingId: 'shared-threshold-conflict',
      checkId: 'numeric_balance_feasibility',
      owner: 'foundation',
      path: 'docs/BALANCE_DESIGN.md',
      evidence: [
        { path: 'docs/BALANCE_DESIGN.md', anchor: 'Spec' },
        { path: 'docs/GDD.md', anchor: 'Spec' },
        { path: 'docs/LEVEL_SCENE_DESIGN.md', anchor: 'Spec' },
      ],
    })
    const earlierFinding = reviewFinding({
      findingId: 'ui-discovered-before-balance-owner',
      checkId: 'cross_document_consistency',
      owner: 'foundation',
      path: 'docs/UI_UX_SPEC.md',
    })
    const checks = checksWithBlocks('foundation', {
      cross_document_consistency: [earlierFinding.findingId],
      numeric_balance_feasibility: ['shared-threshold-conflict'],
    }).map(check =>
      check.id === 'numeric_balance_feasibility'
        ? {
            ...check,
            evidence: [
              { path: 'docs/BALANCE_DESIGN.md', anchor: 'Spec' },
              { path: 'docs/GDD.md', anchor: 'Spec' },
              { path: 'docs/LEVEL_SCENE_DESIGN.md', anchor: 'Spec' },
            ],
          }
        : check,
    )
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks,
        findings: [earlierFinding, finding],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    let planningRequest: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(request) {
          planningRequest = request
          return request
        },
      },
    })
    const submittedRepairPlan = minimumRepairPlan(planningRequest!, [
      'Correct the shared threshold at its Balance authority.',
      'Correct the UI authority.',
    ])
    expect(planningRequest?.contract.repairPlanTask).toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          findings: [
            expect.objectContaining({ findingId: 'shared-threshold-conflict' }),
          ],
          subjectPaths: ['docs/BALANCE_DESIGN.md'],
        }),
      ]),
      authorityReferences: expect.arrayContaining([
        expect.objectContaining({
          path: 'docs/BALANCE_DESIGN.md',
          anchor: '# Balance',
        }),
        expect.objectContaining({ path: 'docs/GDD.md', anchor: 'Spec' }),
        expect.objectContaining({
          path: 'docs/LEVEL_SCENE_DESIGN.md',
          anchor: 'Spec',
        }),
        expect.objectContaining({
          path: 'docs/TECHNICAL_DESIGN.md',
          anchor: '# Technical',
        }),
      ]),
    })

    const accepted = await completeDocumentDraft({
      run: withDispatch(run, planningRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan: submittedRepairPlan,
      },
      documentSet: 'foundation',
    })

    expect(accepted.blockedReason).toBeUndefined()
    expect(() => parseDeliveryRun(accepted)).not.toThrow()
    const duplicatedPlan = structuredClone(accepted)
    const duplicatedFindingIds =
      duplicatedPlan.documentReviewState.activeCycle?.repairPlan?.groups[0]
        ?.findingIds
    duplicatedFindingIds?.push(duplicatedFindingIds[0]!)
    expect(() => parseDeliveryRun(duplicatedPlan)).toThrow(
      'repair plan must be the stable canonical repair-graph prefix',
    )
    expect(accepted.documentReviewState.activeCycle?.repairPlan).toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          findingIds: ['shared-threshold-conflict'],
          pathDecisions: [
            expect.objectContaining({ path: 'docs/BALANCE_DESIGN.md' }),
          ],
        }),
      ]),
      completedPaths: [],
    })
  })

  test('rejects repair planning when canonical artifacts changed after review acceptance', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          numeric_balance_feasibility: ['balance-finding'],
        }),
        findings: [
          reviewFinding({
            findingId: 'balance-finding',
            checkId: 'numeric_balance_feasibility',
            owner: 'foundation',
            path: 'docs/BALANCE_DESIGN.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    await writeFile(
      join(workspacePath, 'docs/TECHNICAL_DESIGN.md'),
      documentContent(
        'Externally changed technical design',
        '1.0.0',
        '2026-08-01T00:00:00.000Z',
      ),
    )

    await expect(
      startDocumentStage({
        run,
        workspacePath,
        dispatcher: {
          async dispatch(request) {
            return request
          },
        },
      }),
    ).rejects.toThrow('canonical artifacts changed during document review')
  })

  test('derives the coordinated change set from accepted Repair Lead path decisions', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          brief_alignment: ['gdd-finding'],
          numeric_balance_feasibility: ['balance-finding'],
        }),
        findings: [
          reviewFinding({
            findingId: 'gdd-finding',
            checkId: 'brief_alignment',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
          reviewFinding({
            findingId: 'balance-finding',
            checkId: 'numeric_balance_feasibility',
            owner: 'foundation',
            path: 'docs/BALANCE_DESIGN.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    let planningRequest: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(request) {
          planningRequest = request
          return request
        },
      },
    })
    const repairPlan = minimumRepairPlan(planningRequest!, [
      'Correct the GDD authority and its UI consumer.',
      'Correct the Balance authority.',
    ])
    repairPlan.decisions[0]!.pathDecisions.push({
      path: 'docs/UI_UX_SPEC.md',
      decision: 'Update the exact downstream UI reference.',
    })

    const rejected = await completeDocumentDraft({
      run: withDispatch(run, planningRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan,
      },
      documentSet: 'foundation',
    })

    expect(rejected.blockedReason).toBeUndefined()
    expect(
      rejected.documentReviewState.activeCycle?.repairPlan?.groups[0]?.pathDecisions.map(
        pathDecision => pathDecision.path,
      ),
    ).toEqual(['docs/GDD.md', 'docs/UI_UX_SPEC.md'])
  })

  test('repairs multiple documents through one durable serial owner cursor', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'foundation')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'foundation',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('foundation', {
          brief_alignment: ['gdd-finding'],
          numeric_balance_feasibility: ['balance-finding'],
        }),
        findings: [
          reviewFinding({
            findingId: 'gdd-finding',
            checkId: 'brief_alignment',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
          reviewFinding({
            findingId: 'balance-finding',
            checkId: 'numeric_balance_feasibility',
            owner: 'foundation',
            path: 'docs/BALANCE_DESIGN.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    let request: WorkerDispatchRequest | undefined
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(next) {
          request = next
          return next
        },
      },
    })
    expect(request?.contract.authoringMode).toBe('repair-planning')
    run = await completeDocumentDraft({
      run: withDispatch(run, request!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan: minimumRepairPlan(request!, [
          'Correct the GDD authority.',
          'Correct the Balance authority.',
        ]),
      },
      documentSet: 'foundation',
    })
    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(next) {
          request = next
          return next
        },
      },
    })
    expect(request?.contract.authoringMode).toBe('remediation')
    expect(request?.contract.foundationDocumentPath).toBe('docs/GDD.md')
    expect(request?.allowedPaths).toEqual(['docs/GDD.md'])
    await writeFile(
      join(workspacePath, 'docs/GDD.md'),
      documentContent('GDD', '1.0.1', '2026-08-02T00:00:00.000Z'),
    )
    run = await completeDocumentDraft({
      run: withDispatch(run, request!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: [],
      },
      documentSet: 'foundation',
    })
    expect(
      run.documentReviewState.activeCycle?.repairPlan?.completedPaths,
    ).toEqual(['docs/GDD.md'])

    await startDocumentStage({
      run,
      workspacePath,
      dispatcher: {
        async dispatch(next) {
          request = next
          return next
        },
      },
    })
    expect(request?.contract.authoringMode).toBe('remediation')
    expect(request?.contract.foundationDocumentPath).toBe(
      'docs/BALANCE_DESIGN.md',
    )
    expect(request?.allowedPaths).toEqual(['docs/BALANCE_DESIGN.md'])
    expect(request?.contract).not.toHaveProperty('remediation')
    await writeFile(
      join(workspacePath, 'docs/BALANCE_DESIGN.md'),
      documentContent('BALANCE_DESIGN', '1.0.1', '2026-08-02T00:00:00.000Z'),
    )
    run = await completeDocumentDraft({
      run: withDispatch(run, request!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/BALANCE_DESIGN.md'],
        resolvedFindingIds: [],
      },
      documentSet: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(run.documentReviewState.activeCycle).toMatchObject({
      mode: 'closure',
      activeTarget: 'foundation',
      changedPaths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
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
          reviewFinding({
            findingId: 'authority-conflict',
            checkId: 'brief_alignment',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
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
        version: 8,
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
    const findingId =
      run.documentReviewState.activeCycle!.findings[0]!.findingId
    run = await completeDocumentDraft({
      run: withDispatch(run, authorRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan: minimumRepairPlan(authorRequest!, [
          'Correct the cited GDD authority conflict.',
        ]),
      },
      documentSet: 'foundation',
    })
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
    expect(authorRequest?.contract.authoringMode).toBe('remediation')
    expect(authorRequest?.allowedPaths).toEqual(['docs/GDD.md'])
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
        resolvedFindingIds: [],
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
    const closureRequest = await buildDocumentReviewDispatch({
      run,
      workspacePath,
    })
    const expectedClosureChecks: DocumentReviewCheck['id'][] = [
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
    ]
    expect(closureRequest.contract).toMatchObject({
      reviewMode: 'closure',
      requiredCheckIds: expectedClosureChecks,
      changedPaths: ['docs/GDD.md'],
    })
    expect(closureRequest.contract.priorFindings as unknown[]).toHaveLength(1)

    const closed = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: run.documentReviewState.activeCycle!.sourceRevision,
        verdict: 'READY',
        checks: passingChecks('foundation').filter(check =>
          expectedClosureChecks.includes(check.id),
        ),
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

  test('projects a comprehensive baseline onto foundation closure scope', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.revision.resource!,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('complete', {
          level_scene_design_integrity: ['foundation-gap'],
        }),
        findings: [
          reviewFinding({
            findingId: 'foundation-gap',
            checkId: 'level_scene_design_integrity',
            owner: 'foundation',
            path: 'docs/GDD.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
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
    run = await completeDocumentDraft({
      run: withDispatch(run, authorRequest!),
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [],
        resolvedFindingIds: [],
        repairPlan: minimumRepairPlan(authorRequest!, [
          'Correct the cited foundation gap in GDD.',
        ]),
      },
      documentSet: 'foundation',
    })
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
        resolvedFindingIds: [],
      },
      documentSet: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(run.documentReviewState.activeCycle).toMatchObject({
      originScope: 'complete',
      scope: 'foundation',
      mode: 'closure',
      activeTarget: 'foundation',
      changedPaths: ['docs/GDD.md'],
    })
    expect(
      Object.keys(run.documentReviewState.activeCycle!.sourceArtifactDigests),
    ).toEqual(
      expect.arrayContaining([
        'reviewAuthority',
        'systemDeliveryContract',
        ...CANONICAL_FOUNDATION_DOCUMENTS,
      ]),
    )
    expect(
      Object.keys(run.documentReviewState.activeCycle!.sourceArtifactDigests),
    ).not.toContain(CANONICAL_ASSET_MANIFEST)
  })

  test('reviews and closes the checklist before freezing it for resource production', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'checklist')
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'checklist',
      revision: run.revision.document,
    })
    run = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'checklist',
        revision: run.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('checklist', {
          checklist_traceability: ['checklist-gap'],
        }),
        findings: [
          reviewFinding({
            findingId: 'checklist-gap',
            checkId: 'checklist_traceability',
            owner: 'checklist',
            path: 'docs/acceptance/gameplay-checklist.md',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.document,
      scope: 'checklist',
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
        resolvedFindingIds: [],
      },
      documentSet: 'checklist',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(run.documentReviewState.repairPasses.checklist).toBe(1)
    const afterChecklist = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'checklist',
        revision: run.documentReviewState.activeCycle!.sourceRevision,
        verdict: 'READY',
        checks: passingChecks('checklist'),
        findings: [],
      }),
      currentDocumentRevision:
        run.documentReviewState.activeCycle!.sourceRevision,
      scope: 'checklist',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(afterChecklist.phase).toBe('RESOURCE_PREPARATION')
    expect(afterChecklist.documentReviewState.activeCycle).toBeUndefined()
    expect(afterChecklist.documentReviewState.checklistApproval).toMatchObject({
      scope: 'checklist',
      revision: run.documentReviewState.activeCycle!.sourceRevision,
    })
    expect(afterChecklist.documentReviewState.repairPasses).toEqual({
      foundation: 0,
      checklist: 1,
      resource: 0,
    })
  })

  test('stops an invalid initial checklist instead of creating an author self-revision lane', async () => {
    const workspacePath = await createWorkspace()
    const base = await reviewRun(workspacePath, 'checklist')
    const run: DeliveryRun = {
      ...base,
      documentStep: 'CHECKLIST_DRAFTING',
      documentReviewState: {
        ...base.documentReviewState,
        activeCycle: undefined,
      },
    }

    const stopped = await completeDocumentDraft({
      run,
      workspacePath,
      terminal: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/acceptance/gameplay-checklist.md'],
        resolvedFindingIds: [],
      },
      documentSet: 'checklist',
      audit: (_workspace, options) =>
        options?.includeChecklist
          ? { valid: false, issues: ['checklist task is malformed'] }
          : { valid: true, issues: [] },
    })

    expect(stopped.status).toBe('needs_action')
    expect(stopped.blockedReason).toContain('checklist task is malformed')
    expect(stopped.activeDispatch).toBeUndefined()
  })

  test('continues resource remediation without a repair-pass cutoff', async () => {
    const workspacePath = await createWorkspace()
    let run = await reviewRun(workspacePath, 'complete')
    run = withChecklistApproval(run)
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
    const routed = await reconcileDocumentReview({
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
          reviewFinding({
            findingId: 'resource-gap',
            checkId: 'resource_semantic_fitness',
            owner: 'resource',
            path: CANONICAL_ASSET_MANIFEST,
            requirementId: 'REQ-1',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(routed.status).toBe('running')
    expect(routed.phase).toBe('RESOURCE_PREPARATION')
    expect(routed.documentReviewState.repairPasses.resource).toBe(3)
    expect(routed.blockedReason).toBeUndefined()
  })

  test('reviews a changed content artifact through the single content-integration Closure packet', async () => {
    const workspacePath = await createWorkspace()
    await mkdir(join(workspacePath, 'assets/content'), { recursive: true })
    const contentPath = join(workspacePath, 'assets/content/game-data.json')
    await writeFile(
      contentPath,
      JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'game-data',
        kind: 'numeric-configuration',
        fulfills: ['REQ-1'],
        resources: ['RES-1'],
        data: { value: 1 },
      }),
    )
    let run = withChecklistApproval(await reviewRun(workspacePath, 'complete'))
    run = await createInitialDocumentReviewCycle({
      run,
      workspacePath,
      scope: 'complete',
      revision: run.revision.resource!,
    })
    const routed = await reconcileDocumentReview({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'complete',
        revision: run.revision.resource!,
        verdict: 'NEEDS_REVISION',
        checks: checksWithBlocks('complete', {
          content_structure_fitness: ['content-structure-gap'],
        }),
        findings: [
          reviewFinding({
            findingId: 'content-structure-gap',
            checkId: 'content_structure_fitness',
            owner: 'resource',
            path: 'assets/content/game-data.json',
            contentId: 'game-data',
          }),
        ],
      }),
      currentDocumentRevision: run.revision.resource,
      scope: 'complete',
      audit: () => ({ valid: true, issues: [] }),
    })
    await writeFile(
      contentPath,
      JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'game-data',
        kind: 'numeric-configuration',
        fulfills: ['REQ-1'],
        resources: ['RES-1'],
        data: { value: 2 },
      }),
    )
    const currentRevision = await computeResourceRevision(
      workspacePath,
      routed.revision.document,
    )
    const closure = await beginResourceDocumentReviewClosure({
      run: {
        ...routed,
        revision: { ...routed.revision, resource: currentRevision },
      },
      workspacePath,
      currentRevision,
    })

    expect(closure.documentReviewState.activeCycle?.requiredCheckIds).toEqual([
      'content_structure_fitness',
      'resource_content_consistency',
    ])
    expect(
      (await buildDocumentReviewDispatch({ run: closure, workspacePath }))
        .contract.currentCheckIds,
    ).toEqual(['content_structure_fitness', 'resource_content_consistency'])
  })

  test('accepts new findings in an affected Closure check and validates declared regressions', async () => {
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
          completedCheckIds: [],
          checks: [
            {
              ...passingChecks('complete').find(
                check => check.id === 'resource_semantic_fitness',
              )!,
              status: 'block',
              findingIds: ['resource-untouched'],
            },
          ],
          checkEvidenceDigests: {},
          findings: [
            reviewFinding({
              findingId: 'resource-untouched',
              checkId: 'resource_semantic_fitness',
              owner: 'resource',
              path: CANONICAL_ASSET_MANIFEST,
              requirementId: 'REQ-1',
            }),
          ],
          activeTarget: 'foundation',
          acceptedSemanticResult: false,
          changedPaths: ['docs/GDD.md'],
          sourceArtifactDigests: {},
        },
      },
    }
    const regression = (path: string) =>
      reviewFinding({
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

    const rejectedTerminal = await reviewTerminal({
      workspacePath,
      scope: 'foundation',
      revision: base.revision.document,
      verdict: 'NEEDS_REVISION',
      checks,
      findings: [regression('docs/TECHNICAL_DESIGN.md')],
    })
    await expect(
      reconcileDocumentReviewCheck({
        run,
        workspacePath,
        terminal: rejectedTerminal,
        currentDocumentRevision: base.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('regression must reference only changed paths')
    await expect(
      readFile(join(workspacePath, rejectedTerminal.evidencePath), 'utf8'),
    ).rejects.toThrow()

    const accepted = await reconcileDocumentReviewCheck({
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
    expect(
      accepted.documentReviewState.activeCycle?.findings.map(
        finding => finding.findingId,
      ),
    ).toEqual(['resource-untouched', 'regression-1'])

    const omittedInitialFinding = reviewFinding({
      findingId: 'initial-review-omission',
      checkId: 'brief_alignment',
      owner: 'foundation',
      path: 'docs/GDD.md',
    })
    const crossOwnerCollision = {
      ...omittedInitialFinding,
      findingId: 'resource-untouched',
    }
    await expect(
      reconcileDocumentReviewCheck({
        run,
        workspacePath,
        terminal: await reviewTerminal({
          workspacePath,
          scope: 'foundation',
          revision: base.revision.document,
          verdict: 'NEEDS_REVISION',
          checks: [
            {
              ...passingChecks('foundation')[0]!,
              status: 'block',
              findingIds: [crossOwnerCollision.findingId],
            },
          ],
          findings: [crossOwnerCollision],
        }),
        currentDocumentRevision: base.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('does not preserve its accepted identity')

    const acceptedOmission = await reconcileDocumentReviewCheck({
      run,
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: base.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: [
          {
            ...passingChecks('foundation')[0]!,
            status: 'block',
            findingIds: [omittedInitialFinding.findingId],
          },
        ],
        findings: [omittedInitialFinding],
      }),
      currentDocumentRevision: base.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(
      acceptedOmission.documentReviewState.activeCycle?.findings.map(
        finding => finding.findingId,
      ),
    ).toEqual(['resource-untouched', 'initial-review-omission'])
  })

  test('uses one Closure ledger transition for unresolved and resolved prior findings', async () => {
    const workspacePath = await createWorkspace()
    const base = await reviewRun(workspacePath, 'foundation')
    const prior = reviewFinding({
      findingId: 'foundation-prior',
      checkId: 'brief_alignment',
      owner: 'foundation',
      path: 'docs/GDD.md',
    })
    const blockedCheck = {
      ...passingChecks('foundation')[0]!,
      status: 'block' as const,
      findingIds: [prior.findingId],
    }
    const closureRun = (): DeliveryRun => ({
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
          completedCheckIds: [],
          checks: [blockedCheck],
          checkEvidenceDigests: {},
          findings: [prior],
          activeTarget: 'foundation',
          acceptedSemanticResult: false,
          changedPaths: ['docs/GDD.md'],
          sourceArtifactDigests: {},
        },
      },
    })
    const unresolved = await reconcileDocumentReviewCheck({
      run: closureRun(),
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: base.revision.document,
        verdict: 'NEEDS_REVISION',
        checks: [blockedCheck],
        findings: [prior],
      }),
      currentDocumentRevision: base.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(unresolved.documentReviewState.activeCycle?.findings).toEqual([
      prior,
    ])

    const changedIdentity = {
      ...prior,
      requiredOutcome: 'A different outcome cannot reuse the prior ID.',
    }
    await expect(
      reconcileDocumentReviewCheck({
        run: closureRun(),
        workspacePath,
        terminal: await reviewTerminal({
          workspacePath,
          scope: 'foundation',
          revision: base.revision.document,
          verdict: 'NEEDS_REVISION',
          checks: [blockedCheck],
          findings: [changedIdentity],
        }),
        currentDocumentRevision: base.revision.document,
        scope: 'foundation',
        audit: () => ({ valid: true, issues: [] }),
      }),
    ).rejects.toThrow('does not preserve its accepted identity')

    expect(
      validateDocumentReviewSubmission({
        contract: {
          scope: 'foundation',
          mode: 'closure',
          requiredCheckIds: ['brief_alignment'],
          currentCheckIds: ['brief_alignment'],
          artifacts: [],
          activeTarget: 'foundation',
          priorFindings: [{ ...prior, open: false }],
          changedPaths: ['docs/GDD.md'],
        },
        checks: [blockedCheck],
        findings: [prior],
      }),
    ).toContain('closure review finding foundation-prior is already closed')

    expect(
      validateDocumentReviewSubmission({
        contract: {
          scope: 'foundation',
          mode: 'closure',
          requiredCheckIds: ['brief_alignment'],
          currentCheckIds: ['brief_alignment'],
          artifacts: [],
          activeTarget: 'foundation',
          priorFindings: [{ ...prior, open: true }],
          changedPaths: ['docs/GDD.md'],
        },
        checks: [blockedCheck],
        findings: [{ ...prior, regressionPaths: ['docs/GDD.md'] }],
      }),
    ).toContain(
      'closure review prior finding foundation-prior cannot declare regression paths',
    )

    const resolved = await reconcileDocumentReviewCheck({
      run: closureRun(),
      workspacePath,
      terminal: await reviewTerminal({
        workspacePath,
        scope: 'foundation',
        revision: base.revision.document,
        verdict: 'READY',
        checks: [passingChecks('foundation')[0]!],
        findings: [],
      }),
      currentDocumentRevision: base.revision.document,
      scope: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })
    expect(resolved.documentReviewState.activeCycle).toMatchObject({
      acceptedSemanticResult: true,
      findings: [prior],
    })
  })

  test('rejects a semantically incomplete check matrix at the active scope boundary', () => {
    expect(
      validateDocumentReviewSubmission({
        contract: {
          scope: 'foundation',
          mode: 'initial',
          requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
          currentCheckIds: ['brief_alignment'],
          artifacts: [],
        },
        checks: [],
        findings: [],
      }),
    ).toContain('document review must submit exactly the active check packet')
  })
})

async function createWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'beegame-review-contract-'),
  )
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
  await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspacePath, 'assets/runtime/resource.glb'), 'asset')
  await writeBeeGameAssetManifest(workspacePath, {
    version: 8,
    project_target: {
      platform: 'selected-target',
      runtime: 'project-native',
      asset_format_capabilities: ['glb'],
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'REQ-1', required: true }],
    resources: [
      {
        id: 'RES-1',
        source: {
          type: 'agent-authored',
          created_at: '2026-08-01T00:00:00.000Z',
          reason: 'Test resource.',
        },
        root_path: 'assets/runtime/resource.glb',
        file_paths: ['assets/runtime/resource.glb'],
        provisional: true,
        status: 'verified',
        selected_at: '2026-08-01T00:00:00.000Z',
        selection_reason: ['Test review resource.'],
      },
    ],
  })
  return workspacePath
}

function documentContent(
  title: string,
  version: string,
  updatedAt: string,
): string {
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
    documentStep:
      scope === 'foundation'
        ? 'FOUNDATION_REVIEW'
        : scope === 'checklist'
          ? 'CHECKLIST_REVIEW'
          : 'COMPREHENSIVE_REVIEW',
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
      : scope === 'checklist'
        ? CHECKLIST_DOCUMENT_REVIEW_CHECK_IDS
        : COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS
  return ids.map(id => ({
    id,
    status: 'pass',
    conclusion: 'The required invariant is satisfied.',
    evidence: [
      ...(![
        'technical_feasibility',
        'content_structure_fitness',
        'resource_content_consistency',
      ].includes(id)
        ? [{ path: 'docs/GDD.md', anchor: 'Spec' }]
        : []),
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
    assessments:
      id in GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
        ? GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
            id as keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
          ].map(criterion => ({
            criterion,
            status: 'pass' as const,
            evidence: [{ path: 'docs/GDD.md', anchor: 'Spec' }],
            derivation:
              'Compared the documented choices, values and state paths.',
            conclusion: 'The criterion is satisfied by the cited design facts.',
          }))
        : [],
  }))
}

function checksWithBlocks(
  scope: DocumentReviewScope,
  blocks: Partial<Record<DocumentReviewCheck['id'], string[]>>,
): DocumentReviewCheck[] {
  return passingChecks(scope).map(check => {
    const findingIds = blocks[check.id]
    if (!findingIds) return check
    return {
      ...check,
      status: 'block' as const,
      findingIds,
      assessments: check.assessments.map((assessment, index) =>
        index === 0 ? { ...assessment, status: 'block' as const } : assessment,
      ),
    }
  })
}

function reviewFinding(input: {
  findingId: string
  checkId: DocumentReviewCheck['id']
  owner: 'foundation' | 'checklist' | 'resource'
  path: string
  anchor?: string
  requirementId?: string
  contentId?: string
  regressionPaths?: string[]
  evidence?: Array<{ path: string; anchor: string }>
}) {
  return {
    findingId: input.findingId,
    checkId: input.checkId,
    severity: 'blocking' as const,
    owner: input.owner,
    ...(input.regressionPaths
      ? { regressionPaths: input.regressionPaths }
      : {}),
    evidence: input.evidence ?? [
      {
        path: input.path,
        anchor: input.anchor ?? (input.path.endsWith('.md') ? 'Spec' : '$'),
      },
    ],
    subjects: [
      {
        path: input.path,
        anchor: input.anchor ?? (input.path.endsWith('.md') ? 'Spec' : '$'),
        ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        ...(input.contentId ? { contentId: input.contentId } : {}),
      },
    ],
    observation: 'The current artifacts contain a blocking inconsistency.',
    blockingImpact:
      'The current review gate cannot approve an ambiguous contract.',
    requiredOutcome: 'The cited artifacts agree and the check passes.',
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
}): Promise<
  Extract<WorkerTerminalResult, { workerType: 'document-reviewer' }>
> {
  const evidencePath = `.beegame/workflow/evidence/review-${randomUUID()}.json`
  return {
    workerType: 'document-reviewer',
    revision: input.revision,
    verdict: input.verdict,
    checks: input.checks,
    checklistIds: input.scope === 'foundation' ? [] : ['PATH-001'],
    findings: input.findings,
    evidencePath,
    rejectedSubmissionCount: 0,
  }
}

function withChecklistApproval(run: DeliveryRun): DeliveryRun {
  return {
    ...run,
    documentReviewState: {
      ...run.documentReviewState,
      checklistApproval: {
        scope: 'checklist',
        revision: run.revision.document,
        checks: passingChecks('checklist'),
        checkEvidenceDigests: {},
        evidencePath: '.beegame/workflow/evidence/checklist-approved.json',
        approvedAt: '2026-08-02T00:00:00.000Z',
      },
    },
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
