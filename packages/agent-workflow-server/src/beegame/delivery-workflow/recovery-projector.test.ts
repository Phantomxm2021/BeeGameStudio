import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from '../../__tests__/delivery-workflow-test-helpers'
import { commitCanonicalDocument } from '../native-canonical-document-tool'
import {
  artifactsForDocumentReviewCheck,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
} from './document-review-input'
import {
  computeResourceContentDigest,
  computeResourceInventoryRevision,
  computeResourceRevision,
} from './revision'
import { projectExactResumeRun } from './recovery-projector'
import { createRunStore, WorkflowStoreError } from './run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  DELIVERY_RUN_SCHEMA_VERSION,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type AcceptedWorkflowUnit,
  type DeliveryRun,
  type DocumentReviewCheck,
  type WorkflowEvent,
  type WorkflowUnitAcceptedEvent,
} from './types'

const OWNER_ID = 'owner-recovery'
const PROJECT_ID = 'project-recovery'
const RUN_ID = 'run-recovery'
const BRIEF = 'Confirmed synthetic delivery authority.'
const DOCUMENT_REVISION = 'document-revision'
const WORKSPACE_REVISION = 'workspace-revision'
const ACCEPTED_AT = '2026-08-05T00:00:00.000Z'
const RETIRED_PENDING_CHECK_ID = 'retired-pending-check'
const CHECKLIST_UNIT_ID = 'checklist:docs/acceptance/gameplay-checklist.md'

type ProjectionFixture = Awaited<ReturnType<typeof createProjectionFixture>>

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function acceptedEvent(
  unit: AcceptedWorkflowUnit,
  index: number,
  revision: DeliveryRun['revision'],
): WorkflowUnitAcceptedEvent {
  return {
    eventId: `accepted-event-${index}`,
    runId: RUN_ID,
    type: 'workflow.unit.accepted',
    phase: unit.phase,
    status: 'running',
    revision,
    createdAt: unit.acceptedAt,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    unit,
  }
}

function unit(
  value: Omit<AcceptedWorkflowUnit, 'eventSchemaVersion' | 'acceptedAt'>,
): AcceptedWorkflowUnit {
  return {
    eventSchemaVersion: 1,
    acceptedAt: ACCEPTED_AT,
    ...value,
  }
}

function reviewUnit(input: {
  check: DocumentReviewCheck
  predecessorUnitIds: string[]
  inputRevision: string
  dependencyDigests?: Record<string, string>
}): AcceptedWorkflowUnit {
  const dependencyDigests = input.dependencyDigests ?? {}
  return unit({
    unitId: `review:${input.check.id}`,
    kind: 'review-check',
    phase: 'DOCUMENT_REVIEW',
    predecessorUnitIds: input.predecessorUnitIds,
    inputRevision: input.inputRevision,
    dependencyDigests,
    payload: {
      check: input.check,
      findings: [],
      dependencyDigests: { [input.check.id]: dependencyDigests },
    },
  })
}

async function createProjectionFixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'workflow-projector-'))
  for (const [index, path] of CANONICAL_PROJECT_DOCUMENTS.entries())
    await commitCanonicalDocument({
      workspacePath,
      contract: {
        dispatchId: `canonical-document-${index}`,
        targetPath: path,
        documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
        operation: 'create',
        baselineDigest: null,
      },
      body:
        path === 'docs/GDD.md'
          ? '# Synthetic authority'
          : '# Synthetic artifact',
    })
  const sourceContent = await readFile(
    join(workspacePath, 'docs', 'GDD.md'),
    'utf8',
  )

  const contentDigest = await computeResourceContentDigest(workspacePath)
  const inventoryRevision =
    await computeResourceInventoryRevision(workspacePath)
  const resourceRevision = await computeResourceRevision(
    workspacePath,
    DOCUMENT_REVISION,
  )
  const revision = {
    document: DOCUMENT_REVISION,
    resource: resourceRevision,
    workspace: WORKSPACE_REVISION,
  }
  const allReviewChecks = createAcceptedComprehensiveReview().checks
  const foundationChecks = allReviewChecks.slice(
    0,
    FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.length,
  )
  const checklistCheck: DocumentReviewCheck = {
    id: 'checklist_traceability',
    status: 'pass',
    conclusion: 'The synthetic checklist is traceable.',
    evidence: [{ path: 'docs/acceptance/gameplay-checklist.md', anchor: '$' }],
    findingIds: [],
    assessments: [],
  }
  const authority = {
    confirmedBriefContext: BRIEF,
    confirmedBriefDigest: digest(BRIEF),
  }
  const foundationArtifacts = await readDocumentReviewArtifacts(
    workspacePath,
    'foundation',
    authority,
  )
  const checklistArtifacts = await readDocumentReviewArtifacts(
    workspacePath,
    'checklist',
    authority,
  )
  const dependencyDigestsByCheckId = Object.fromEntries([
    ...foundationChecks.map(check => [
      check.id,
      documentReviewArtifactDigests(
        artifactsForDocumentReviewCheck(foundationArtifacts, check.id),
      ),
    ]),
    [
      checklistCheck.id,
      documentReviewArtifactDigests(
        artifactsForDocumentReviewCheck(checklistArtifacts, checklistCheck.id),
      ),
    ],
  ])

  const acceptedUnits: AcceptedWorkflowUnit[] = []
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries())
    acceptedUnits.push(
      unit({
        unitId: `document:${path}`,
        kind: 'document',
        phase: 'DOCUMENT_DRAFTING',
        predecessorUnitIds:
          index === 0
            ? []
            : [`document:${CANONICAL_FOUNDATION_DOCUMENTS[index - 1]}`],
        inputRevision: DOCUMENT_REVISION,
        dependencyDigests: {},
        payload: { path, revision: DOCUMENT_REVISION },
      }),
    )
  for (const [index, check] of foundationChecks.entries())
    acceptedUnits.push(
      reviewUnit({
        check,
        predecessorUnitIds:
          index === 0
            ? []
            : [`review:${FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS[index - 1]}`],
        inputRevision: DOCUMENT_REVISION,
        dependencyDigests: dependencyDigestsByCheckId[check.id],
      }),
    )
  acceptedUnits.push(
    reviewUnit({
      check: checklistCheck,
      predecessorUnitIds: [],
      inputRevision: DOCUMENT_REVISION,
      dependencyDigests: dependencyDigestsByCheckId.checklist_traceability,
    }),
    unit({
      unitId: CHECKLIST_UNIT_ID,
      kind: 'checklist',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: ['review:checklist_traceability'],
      inputRevision: DOCUMENT_REVISION,
      dependencyDigests: {},
      receiptRef: '.beegame/workflow/evidence/checklist.json',
      payload: {
        revision: DOCUMENT_REVISION,
        evidencePath: '.beegame/workflow/evidence/checklist.json',
        checkIds: ['checklist_traceability'],
      },
    }),
    unit({
      unitId: 'resource:inventory',
      kind: 'resource-inventory',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: [CHECKLIST_UNIT_ID],
      inputRevision: inventoryRevision,
      dependencyDigests: {},
      payload: {
        bindings: [
          { requirementId: 'requirement-id', resourceIds: ['resource-id'] },
        ],
        catalogObserved: true,
      },
    }),
    unit({
      unitId: 'resource:content',
      kind: 'resource-content',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: ['resource:inventory'],
      inputRevision: contentDigest,
      dependencyDigests: { content: contentDigest },
      payload: { contentDigest },
    }),
    unit({
      unitId: 'resource:gate',
      kind: 'resource-gate',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: ['resource:content'],
      inputRevision: resourceRevision,
      dependencyDigests: {},
      receiptRef: '.beegame/workflow/evidence/resource-gate.json',
      payload: {
        receiptRef: '.beegame/workflow/evidence/resource-gate.json',
      },
    }),
  )
  const events = acceptedUnits.map((acceptedUnit, index) =>
    acceptedEvent(acceptedUnit, index, revision),
  )

  const base = createTestDeliveryRun({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    confirmedBriefContext: BRIEF,
    checklistApproved: true,
  })
  const snapshot = {
    ...base,
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'COMPREHENSIVE_REVIEW' as const,
    revision,
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: resourceRevision,
        status: 'passed' as const,
        observedAt: ACCEPTED_AT,
      },
    },
    resourceProductionState: {
      currentTask: 'RESOURCE_GATE' as const,
      inventoryReceipt: {
        revision: inventoryRevision,
        bindings: [
          { requirementId: 'requirement-id', resourceIds: ['resource-id'] },
        ],
        catalogObserved: true,
        acceptedAt: ACCEPTED_AT,
      },
      contentReceipt: { contentDigest, acceptedAt: ACCEPTED_AT },
    },
    documentReviewState: {
      ...base.documentReviewState,
      checklistApproval: {
        ...base.documentReviewState.checklistApproval!,
        revision: DOCUMENT_REVISION,
      },
      activeCycle: {
        cycleId: 'active-comprehensive-cycle',
        originScope: 'complete' as const,
        scope: 'complete' as const,
        mode: 'initial' as const,
        sourceRevision: resourceRevision,
        requiredCheckIds: [
          ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
          RETIRED_PENDING_CHECK_ID,
        ],
        completedCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        checks: foundationChecks,
        checkEvidenceDigests: Object.fromEntries(
          foundationChecks.map(check => [
            check.id,
            dependencyDigestsByCheckId[check.id],
          ]),
        ),
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
    activeDispatch: {
      dispatchId: 'stale-dispatch',
      workerType: 'document-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: resourceRevision,
      status: 'running' as const,
      startedAt: ACCEPTED_AT,
      request: {
        dispatchId: 'stale-dispatch',
        runId: RUN_ID,
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        workspacePath,
        workerType: 'document-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        revision: resourceRevision,
        contract: {
          requiredCheckIds: [
            ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
            RETIRED_PENDING_CHECK_ID,
          ],
          currentCheckIds: ['resource_semantic_fitness'],
        },
      },
    },
    usage: {
      input_tokens: 101,
      cache_read_tokens: 20,
      cache_creation_tokens: 10,
      completion_tokens: 30,
      total_tokens: 161,
    },
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  }
  const snapshotPath = join(workspacePath, '.beegame', 'workflow', 'run.json')
  await mkdir(join(workspacePath, '.beegame', 'workflow'), {
    recursive: true,
  })
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`)

  return {
    workspacePath,
    snapshotPath,
    sourceContent,
    events: events as WorkflowEvent[],
    snapshot,
    contentDigest,
    inventoryRevision,
    resourceRevision,
  }
}

async function inspect(fixture: ProjectionFixture) {
  return createRunStore(
    fixture.workspacePath,
    OWNER_ID,
  ).inspectWorkflowSnapshot()
}

function projectInput(
  fixture: ProjectionFixture,
  inspection: Awaited<ReturnType<typeof inspect>>,
  events: WorkflowEvent[] = fixture.events,
) {
  return {
    inspection,
    events,
    workspacePath: fixture.workspacePath,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    confirmedBriefContext: BRIEF,
  }
}

async function expectRecoveryError(
  promise: Promise<unknown>,
  code:
    | 'recovery_checkpoint_missing'
    | 'recovery_checkpoint_conflict'
    | 'recovery_artifact_digest_mismatch'
    | 'recovery_snapshot_changed',
) {
  try {
    await promise
    throw new Error('expected recovery projection to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowStoreError)
    expect((error as WorkflowStoreError).code).toBe(code)
  }
}

describe('workflow exact-resume recovery projector', () => {
  test('inspects and hashes an invalid snapshot without rewriting it', async () => {
    const fixture = await createProjectionFixture()
    const before = await readFile(fixture.snapshotPath, 'utf8')

    const inspection = await inspect(fixture)

    expect(inspection.rawText).toBe(before)
    expect(inspection.digest).toBe(digest(before))
    expect(inspection.parsedValue).toBeDefined()
    expect(inspection.currentRun).toBeUndefined()
    expect(inspection.error).toEqual(
      expect.objectContaining({ code: 'invalid' }),
    )
    expect(await readFile(fixture.snapshotPath, 'utf8')).toBe(before)
  })

  test('projects the exact current run and never includes its active unit in the accepted replay', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection),
    )

    expect(projection.run.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(projection.activeUnitId).toBe('review:resource_semantic_fitness')
    expect(projection.run.activeDispatch).toBeUndefined()
    expect(projection.run.documentReviewState.activeCycle).toMatchObject({
      requiredCheckIds: [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS],
      completedCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
    })
    expect(projection.run.evidence.resourcePreparation?.status).toBe('passed')
    expect(
      projection.run.resourceProductionState.contentReceipt?.contentDigest,
    ).toBe(fixture.contentDigest)
    expect(projection.run.createdAt).toBe(fixture.snapshot.createdAt)
    expect(projection.run.usage).toEqual(fixture.snapshot.usage)
    expect(projection.replayedUnitIds).toEqual(
      fixture.events.map(
        event => (event as WorkflowUnitAcceptedEvent).unit.unitId,
      ),
    )
    expect(projection.replayedUnitIds).not.toContain(projection.activeUnitId)
    expect(projection.sourceSnapshotDigest).toBe(inspection.digest)
  })

  test('uses matching canonical document receipts to recover historical completed paths', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const events = fixture.events.filter(
      event =>
        !(event as WorkflowUnitAcceptedEvent).unit.unitId.startsWith(
          'document:',
        ),
    )

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection, events),
    )

    expect(projection.run.foundationDraftState.completedPaths).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ])
    expect(projection.activeUnitId).toBe('review:resource_semantic_fitness')
  })

  test('reports a missing checkpoint when historical resource content has no v13 digest receipt', async () => {
    const fixture = await createProjectionFixture()
    const sourceSnapshot = structuredClone(fixture.snapshot)
    const { contentReceipt: _contentReceipt, ...resourceProductionState } =
      sourceSnapshot.resourceProductionState
    const snapshot = { ...sourceSnapshot, resourceProductionState }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const events = fixture.events.filter(
      event =>
        (event as WorkflowUnitAcceptedEvent).unit.unitId !== 'resource:content',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects conflicting snapshot and journal checkpoints', async () => {
    const fixture = await createProjectionFixture()
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.resourceProductionState.contentReceipt = {
      contentDigest: 'conflicting-content-digest',
      acceptedAt: ACCEPTED_AT,
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_conflict',
    )
  })

  test('rejects accepted dependency digests that no longer match artifacts', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    await writeFile(
      join(fixture.workspacePath, 'docs', 'GDD.md'),
      '# Changed synthetic authority\n',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_artifact_digest_mismatch',
    )
  })

  test('rejects a review checkpoint that carries no dependency proof', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const events = fixture.events.map(event => {
      const accepted = event as WorkflowUnitAcceptedEvent
      if (accepted.unit.unitId !== 'review:brief_alignment') return event
      return {
        ...accepted,
        unit: {
          ...accepted.unit,
          dependencyDigests: {},
          payload: {
            ...(accepted.unit.payload as Record<string, unknown>),
            dependencyDigests: { brief_alignment: {} },
          },
        },
      } as WorkflowEvent
    })

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('projects malformed JSON when the accepted journal is complete', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection),
    )

    expect(inspection.parsedValue).toBeUndefined()
    expect(inspection.error?.code).toBe('invalid')
    expect(projection.activeUnitId).toBe('review:resource_semantic_fitness')
    expect(projection.run.activeDispatch).toBeUndefined()
  })

  test('rejects malformed JSON when a later accepted event exposes a journal gap', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.events.filter(
      event =>
        (event as WorkflowUnitAcceptedEvent).unit.unitId !== 'resource:content',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects duplicate accepted units even when their payloads agree', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const duplicate = {
      ...fixture.events[0],
      eventId: 'duplicate-accepted-event',
    } as WorkflowEvent

    await expectRecoveryError(
      projectExactResumeRun(
        projectInput(fixture, inspection, [...fixture.events, duplicate]),
      ),
      'recovery_checkpoint_conflict',
    )
  })

  test('rejects projection when run.json changed after inspection', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    await writeFile(
      fixture.snapshotPath,
      `${await readFile(fixture.snapshotPath, 'utf8')}\n`,
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_snapshot_changed',
    )
  })
})
