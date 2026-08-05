import { describe, expect, test } from 'bun:test'
import { migrateWorkflowSnapshot } from './snapshot-migrations'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
} from './types'

const RETIRED_PENDING_CHECK_ID = 'implementation_readiness'

const FROZEN_V11_DESIGN_CRITERIA = {
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
  numeric_balance_feasibility: [
    'outcome_bounds',
    'relative_value',
    'formula_consistency',
  ],
  pacing_difficulty_coherence: [
    'pressure_curve',
    'capability_curve',
    'spike_and_recovery',
  ],
  level_scene_design_integrity: [
    'spatial_gameplay_support',
    'level_progression_coherence',
    'scene_state_completeness',
  ],
} as const

const FROZEN_V11_FOUNDATION_CHECK_IDS = [
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
] as const

const FROZEN_V11_COMPREHENSIVE_CHECK_IDS = [
  ...FROZEN_V11_FOUNDATION_CHECK_IDS,
  'resource_semantic_fitness',
  'content_structure_fitness',
  'resource_content_consistency',
  RETIRED_PENDING_CHECK_ID,
] as const

function frozenVersion11Check(
  id: (typeof FROZEN_V11_COMPREHENSIVE_CHECK_IDS)[number],
  findingIds: string[] = [],
) {
  const criteria =
    FROZEN_V11_DESIGN_CRITERIA[id as keyof typeof FROZEN_V11_DESIGN_CRITERIA] ??
    []
  return {
    id,
    status: findingIds.length ? ('block' as const) : ('pass' as const),
    conclusion: findingIds.length
      ? 'The historical check requires repair.'
      : 'The historical check passed.',
    evidence: [{ path: 'docs/GDD.md', anchor: '#authority' }],
    findingIds,
    assessments: criteria.map(criterion => ({
      criterion,
      status: 'pass' as const,
      evidence: [{ path: 'docs/GDD.md', anchor: '#authority' }],
      derivation: 'The frozen protocol evidence satisfies this criterion.',
      conclusion: 'The frozen criterion passed.',
    })),
  }
}

function frozenVersion11RunBase() {
  const revision = {
    document: 'document-revision',
    workspace: 'workspace-revision',
  }
  return {
    schemaVersion: 11,
    runId: 'migration-run',
    projectId: 'migration-project',
    ownerId: 'migration-owner',
    parentRunId: 'historical-parent-run',
    confirmedBriefDigest: 'confirmed-brief-digest',
    confirmedBriefContext: 'Frozen confirmed delivery brief.',
    phase: 'DOCUMENT_DRAFTING' as const,
    documentStep: 'FOUNDATION_DRAFTING' as const,
    status: 'running' as const,
    revision,
    reviewedDocumentPaths: ['docs/GDD.md'],
    tasks: [],
    evidence: {},
    documentReviewState: {
      repairPasses: { foundation: 1, checklist: 1, resource: 0 },
    },
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' as const },
    checklistRemediation: {
      sourceRevision: 'document-revision',
      attempt: 1,
      issues: ['The frozen checklist structure required correction.'],
    },
    usage: {
      input_tokens: 101,
      cache_read_tokens: 17,
      cache_creation_tokens: 3,
      completion_tokens: 29,
      total_tokens: 150,
    },
    currentMessage: 'Historical workflow progress.',
    thinking: 'working' as const,
    lastProgressAt: '2026-08-05T00:00:00.000Z',
    pendingEvent: {
      eventId: 'historical-pending-event',
      runId: 'migration-run',
      type: 'workflow.progress',
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      status: 'running' as const,
      revision,
      createdAt: '2026-08-05T00:00:00.000Z',
    },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:01:00.000Z',
  }
}

function frozenVersion11ComprehensiveSnapshot() {
  const base = frozenVersion11RunBase()
  const completedCheckIds = [...FROZEN_V11_FOUNDATION_CHECK_IDS]
  return {
    ...base,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'COMPREHENSIVE_REVIEW' as const,
    revision: {
      ...base.revision,
      resource: 'resource-revision',
    },
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: 'resource-revision',
        status: 'passed' as const,
        observedAt: '2026-08-05T00:00:00.000Z',
      },
    },
    resourceProductionState: { currentTask: 'RESOURCE_GATE' as const },
    documentReviewState: {
      repairPasses: base.documentReviewState.repairPasses,
      checklistApproval: {
        scope: 'checklist' as const,
        revision: 'document-revision',
        checks: [
          {
            id: 'checklist_traceability' as const,
            status: 'pass' as const,
            conclusion: 'The frozen checklist passed.',
            evidence: [
              {
                path: 'docs/acceptance/gameplay-checklist.md',
                anchor: '#acceptance',
              },
            ],
            findingIds: [],
            assessments: [],
          },
        ],
        checkEvidenceDigests: {},
        evidencePath: '.beegame/workflow/evidence/checklist.json',
        approvedAt: '2026-08-05T00:00:00.000Z',
      },
      activeCycle: {
        cycleId: 'comprehensive-cycle',
        originScope: 'complete' as const,
        scope: 'complete' as const,
        mode: 'initial' as const,
        sourceRevision: 'resource-revision',
        requiredCheckIds: [...FROZEN_V11_COMPREHENSIVE_CHECK_IDS],
        completedCheckIds,
        checks: completedCheckIds.map(id => frozenVersion11Check(id)),
        checkEvidenceDigests: {},
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
    activeDispatch: {
      dispatchId: 'review-dispatch',
      workerType: 'document-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: 'resource-revision',
      status: 'running' as const,
      startedAt: '2026-08-05T00:00:00.000Z',
      request: {
        dispatchId: 'review-dispatch',
        runId: base.runId,
        ownerId: base.ownerId,
        projectId: base.projectId,
        workspacePath: '/synthetic/workspace',
        workerType: 'document-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        revision: 'resource-revision',
        contract: {
          requiredCheckIds: [...FROZEN_V11_COMPREHENSIVE_CHECK_IDS],
          currentCheckIds: ['resource_semantic_fitness'],
        },
      },
      terminalResult: {
        workerType: 'document-reviewer',
        verdict: 'READY',
        checks: [frozenVersion11Check('resource_semantic_fitness')],
        reviewedDocumentPaths: ['docs/GDD.md'],
        checklistIds: [],
        findings: [],
        evidencePath: '.beegame/workflow/evidence/comprehensive.json',
        rejectedSubmissionCount: 0,
      },
    },
  }
}

function frozenVersion11RepairPlanSnapshot() {
  const base = frozenVersion11RunBase()
  const findingId = 'historical-foundation-finding'
  const checks = FROZEN_V11_FOUNDATION_CHECK_IDS.map(id =>
    frozenVersion11Check(id, id === 'brief_alignment' ? [findingId] : []),
  )
  return {
    ...base,
    currentItemId: 'docs/LEVEL_SCENE_DESIGN.md',
    documentReviewState: {
      repairPasses: base.documentReviewState.repairPasses,
      activeCycle: {
        cycleId: 'historical-closure-cycle',
        parentCycleId: 'historical-initial-cycle',
        originScope: 'foundation' as const,
        scope: 'foundation' as const,
        mode: 'closure' as const,
        sourceRevision: 'document-revision',
        requiredCheckIds: [...FROZEN_V11_FOUNDATION_CHECK_IDS],
        completedCheckIds: [...FROZEN_V11_FOUNDATION_CHECK_IDS],
        checks,
        checkEvidenceDigests: {},
        findings: [
          {
            findingId,
            checkId: 'brief_alignment' as const,
            severity: 'blocking' as const,
            owner: 'foundation' as const,
            evidence: [{ path: 'docs/GDD.md', anchor: '#authority' }],
            subjects: [{ path: 'docs/GDD.md', anchor: '#authority' }],
            observation: 'The frozen authority contains a blocking defect.',
            blockingImpact: 'The defect blocks the approved delivery.',
            requiredOutcome: 'Restore the confirmed authority.',
          },
        ],
        activeTarget: 'foundation' as const,
        acceptedSemanticResult: true,
        changedPaths: ['docs/GDD.md'],
        sourceArtifactDigests: {
          'docs/GDD.md': 'frozen-gdd-digest',
        },
        repairPlan: {
          groups: [
            {
              groupId: 'repair-group-1',
              findingIds: [findingId],
              decision: 'Restore the confirmed authority in the GDD.',
              affectedPaths: ['docs/GDD.md'],
              dependsOn: [],
            },
          ],
          completedPaths: ['docs/GDD.md'],
        },
      },
    },
  }
}

function activeCycle(value: unknown) {
  return (
    value as {
      documentReviewState: { activeCycle: unknown }
    }
  ).documentReviewState.activeCycle as {
    requiredCheckIds: string[]
    completedCheckIds: string[]
    repairPlan?: {
      groups: Array<{
        groupId: string
        findingIds: string[]
        groupDecision: string
        pathDecisions: Array<{ path: string; decision: string }>
        dependsOn: string[]
      }>
      completedPaths: string[]
    }
  }
}

function activeDispatch(value: unknown) {
  return value as {
    activeDispatch: {
      request: { contract: { currentCheckIds: string[] } }
    }
  }
}

function resourceEvidence(value: unknown) {
  return (value as { evidence: { resourcePreparation: unknown } }).evidence
    .resourcePreparation as { status: string }
}

describe('workflow snapshot migrations', () => {
  test('migrates a frozen version-11 comprehensive review without replaying accepted work', () => {
    const snapshot = frozenVersion11ComprehensiveSnapshot()
    const pendingEvent = structuredClone(snapshot.pendingEvent)
    const sourceBytes = JSON.stringify(snapshot)

    const result = migrateWorkflowSnapshot(snapshot)

    expect(result.migratedFrom).toBe(11)
    expect(result.value).toMatchObject({
      schemaVersion: 13,
      pendingEvents: [pendingEvent],
    })
    expect(result.value).not.toHaveProperty('parentRunId')
    expect(result.value).not.toHaveProperty('reviewedDocumentPaths')
    expect(result.value).not.toHaveProperty('checklistRemediation')
    expect(result.value).not.toHaveProperty('pendingEvent')
    expect(result.value).not.toHaveProperty(
      'activeDispatch.terminalResult.reviewedDocumentPaths',
    )
    expect(activeCycle(result.value).requiredCheckIds).toEqual([
      ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    expect(activeCycle(result.value).completedCheckIds).toEqual([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    expect(
      activeDispatch(result.value).activeDispatch.request.contract
        .currentCheckIds,
    ).toEqual(['resource_semantic_fitness'])
    expect(resourceEvidence(result.value).status).toBe('passed')
    expect(JSON.stringify(snapshot)).toBe(sourceBytes)
  })

  test('migrates accepted version-11 repair decisions without reopening completed paths', () => {
    const result = migrateWorkflowSnapshot(frozenVersion11RepairPlanSnapshot())

    expect(activeCycle(result.value).repairPlan).toEqual({
      groups: [
        {
          groupId: 'repair-group-1',
          findingIds: ['historical-foundation-finding'],
          groupDecision: 'Restore the confirmed authority in the GDD.',
          pathDecisions: [
            {
              path: 'docs/GDD.md',
              decision: 'Restore the confirmed authority in the GDD.',
            },
          ],
          dependsOn: [],
        },
      ],
      completedPaths: ['docs/GDD.md'],
    })
  })

  test('rejects an unknown completed check without changing the source snapshot', () => {
    const snapshot = frozenVersion11ComprehensiveSnapshot()
    ;(
      snapshot.documentReviewState.activeCycle.completedCheckIds as string[]
    ).push(RETIRED_PENDING_CHECK_ID)
    const sourceBytes = JSON.stringify(snapshot)

    expect(() => migrateWorkflowSnapshot(snapshot)).toThrow(
      expect.objectContaining({ code: 'ambiguous_completed_unit' }),
    )
    expect(JSON.stringify(snapshot)).toBe(sourceBytes)
  })

  test('rejects a version-11 repair group that mixes historical and current shapes', () => {
    const snapshot = frozenVersion11RepairPlanSnapshot()
    Object.assign(
      snapshot.documentReviewState.activeCycle.repairPlan.groups[0]!,
      {
        groupDecision: 'Conflicting current-shape decision.',
        pathDecisions: [
          {
            path: 'docs/GDD.md',
            decision: 'Conflicting current-shape path decision.',
          },
        ],
      },
    )

    expect(() => migrateWorkflowSnapshot(snapshot)).toThrow(
      expect.objectContaining({ code: 'invalid_migrated_snapshot' }),
    )
  })
})
