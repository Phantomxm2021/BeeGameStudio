import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from '../../__tests__/delivery-workflow-test-helpers'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../asset-contracts'
import { commitCanonicalDocument } from '../native-canonical-document-tool'
import { createNativeResourceContentTool } from '../native-resource-content-tool'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import {
  artifactsForDocumentReviewCheck,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
} from './document-review-input'
import {
  computeDocumentRevision,
  computeResourceContentDigest,
  computeResourceInventoryRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
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
  type DeliveryRun,
  type DocumentReviewCheck,
  type WorkflowEvent,
  type WorkflowUnitAcceptedEvent,
} from './types'

const OWNER_ID = 'owner-recovery'
const TEST_ACQUISITION_PROFILE = { dimensions: ['agnostic'] as const, asset_kinds: ['data'] as const, usage_tags: [], capabilities: [], styles: [] }
const PROJECT_ID = 'project-recovery'
const RUN_ID = 'run-recovery'
const BRIEF = 'Confirmed synthetic delivery authority.'
const ACCEPTED_AT = '2026-08-05T00:00:00.000Z'
const RETIRED_PENDING_CHECK_ID = 'retired-pending-check'
const CHECKLIST_UNIT_ID = 'checklist:docs/acceptance/gameplay-checklist.md'

type ProjectionFixture = Awaited<ReturnType<typeof createProjectionFixture>>

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function createProjectionFixture(
  acceptedThrough:
    | 'resource-gate'
    | 'plan'
    | 'implementation'
    | 'audit'
    | 'acceptance' = 'resource-gate',
) {
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
  await writeBeeGameAssetManifest(workspacePath, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'requirement-id', required: true, acquisition_profile: TEST_ACQUISITION_PROFILE }],
    resources: [],
  })
  await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
  await writeFile(
    join(workspacePath, 'assets/runtime/resource.dat'),
    'synthetic resource',
  )
  await registerBeeGameAuthoredResources(workspacePath, [
    {
      id: 'resource-id',
      root_path: 'assets/runtime/resource.dat',
      file_paths: ['assets/runtime/resource.dat'],
      provisional: true,
      reason: 'Synthetic recovery evidence.',
      selection_reason: ['Covers the synthetic requirement.'],
      asset_kind: 'data',
    },
  ])
  const resourceContentTool = createNativeResourceContentTool({
    buildTool: definition => definition,
    workspacePath,
    contract: {
      dispatchId: 'resource-content-dispatch',
      inventoryRevision: await computeResourceInventoryRevision(workspacePath),
      baselineResourceRevision: await computeResourceRevision(
        workspacePath,
        '',
      ),
      requiredRequirementIds: ['requirement-id'],
      verifiedResourceIds: ['resource-id'],
      inventoryBindings: [
        { requirementId: 'requirement-id', resourceIds: ['resource-id'] },
      ],
      protectedPaths: [],
    },
    assertMutationAuthority: () => undefined,
  }) as { call(value: unknown): Promise<unknown> }
  await resourceContentTool.call({
    action: 'commit',
    documents: [
      {
        path: 'assets/content/resource.json',
        schema: 'beegame-content-v1',
        id: 'content-id',
        kind: 'resource-registry',
        fulfills: ['requirement-id'],
        resources: ['resource-id'],
        data: {
          bindings: [
            { requirementId: 'requirement-id', resourceIds: ['resource-id'] },
          ],
        },
      },
    ],
  })
  const sourceContent = await readFile(
    join(workspacePath, 'docs', 'GDD.md'),
    'utf8',
  )

  const documentRevision = await computeDocumentRevision(
    workspacePath,
    digest(BRIEF),
  )
  const workspaceRevision = await computeWorkspaceRevision(workspacePath)
  const contentDigest = await computeResourceContentDigest(workspacePath)
  const inventoryRevision =
    await computeResourceInventoryRevision(workspacePath)
  const resourceRevision = await computeResourceRevision(
    workspacePath,
    documentRevision,
  )
  const revision = {
    document: documentRevision,
    resource: resourceRevision,
    workspace: workspaceRevision,
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
  const comprehensiveArtifacts = await readDocumentReviewArtifacts(
    workspacePath,
    'complete',
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
  const comprehensiveDependencyDigestsByCheckId = Object.fromEntries(
    allReviewChecks.map(check => [
      check.id,
      documentReviewArtifactDigests(
        artifactsForDocumentReviewCheck(comprehensiveArtifacts, check.id),
      ),
    ]),
  )

  const journalBase = {
    ...createTestDeliveryRun({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      confirmedBriefContext: BRIEF,
      foundationDraftComplete: false,
    }),
    revision,
    createdAt: '2026-08-04T00:00:00.000Z',
    lastProgressAt: ACCEPTED_AT,
    updatedAt: ACCEPTED_AT,
  }
  const beforeDocuments = {
    ...journalBase,
    phase: 'DOCUMENT_DRAFTING' as const,
    documentStep: 'FOUNDATION_DRAFTING' as const,
  }
  const acceptedDocumentUnits = []
  let afterDocuments: DeliveryRun = beforeDocuments
  for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
    const beforeDocument: DeliveryRun = {
      ...afterDocuments,
      activeDispatch: {
        dispatchId: `canonical-document-${index}`,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: path,
        revision: documentRevision,
        status: 'completed',
        startedAt: ACCEPTED_AT,
        finishedAt: ACCEPTED_AT,
        request: {
          dispatchId: `canonical-document-${index}`,
          runId: RUN_ID,
          ownerId: OWNER_ID,
          projectId: PROJECT_ID,
          workspacePath,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: path,
          revision: documentRevision,
          allowedPaths: [path],
          contract: {
            authoringMode: 'initial',
            foundationDocumentPath: path,
          },
        },
      },
    }
    const afterDocument: DeliveryRun = {
      ...beforeDocument,
      activeDispatch: undefined,
      foundationDraftState: {
        completedPaths: CANONICAL_FOUNDATION_DOCUMENTS.slice(0, index + 1),
      },
    }
    acceptedDocumentUnits.push(
      ...deriveAcceptedWorkflowUnits(beforeDocument, afterDocument),
    )
    afterDocuments = afterDocument
  }
  const beforeFoundationReview = {
    ...afterDocuments,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'FOUNDATION_REVIEW' as const,
    documentReviewState: {
      ...afterDocuments.documentReviewState,
      activeCycle: {
        cycleId: 'foundation-cycle',
        originScope: 'foundation' as const,
        scope: 'foundation' as const,
        mode: 'initial' as const,
        sourceRevision: documentRevision,
        requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        completedCheckIds: [],
        checks: [],
        checkEvidenceDigests: {},
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
  }
  const afterFoundationReview = {
    ...beforeFoundationReview,
    documentReviewState: {
      ...beforeFoundationReview.documentReviewState,
      activeCycle: {
        ...beforeFoundationReview.documentReviewState.activeCycle,
        completedCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        checks: foundationChecks,
        checkEvidenceDigests: Object.fromEntries(
          foundationChecks.map(check => [
            check.id,
            dependencyDigestsByCheckId[check.id],
          ]),
        ),
        acceptedSemanticResult: true,
      },
    },
  }
  const checklistApproval = {
    scope: 'checklist' as const,
    revision: documentRevision,
    checks: [checklistCheck],
    checkEvidenceDigests: {
      checklist_traceability: dependencyDigestsByCheckId.checklist_traceability,
    },
    evidencePath: '.beegame/workflow/evidence/checklist.json',
    approvedAt: ACCEPTED_AT,
  }
  const afterChecklist = {
    ...afterFoundationReview,
    documentStep: 'CHECKLIST_REVIEW' as const,
    documentReviewState: {
      ...afterFoundationReview.documentReviewState,
      checklistApproval,
      activeCycle: {
        cycleId: 'checklist-cycle',
        originScope: 'checklist' as const,
        scope: 'checklist' as const,
        mode: 'initial' as const,
        sourceRevision: documentRevision,
        requiredCheckIds: ['checklist_traceability' as const],
        completedCheckIds: ['checklist_traceability' as const],
        checks: [checklistCheck],
        checkEvidenceDigests: checklistApproval.checkEvidenceDigests,
        findings: [],
        acceptedSemanticResult: true,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
  }
  const afterInventory = {
    ...afterChecklist,
    phase: 'RESOURCE_PREPARATION' as const,
    resourceProductionState: {
      currentTask: 'RESOURCE_CONTENT' as const,
      inventoryReceipt: {
        revision: inventoryRevision,
        bindings: [
          { requirementId: 'requirement-id', resourceIds: ['resource-id'] },
        ],
        catalogObserved: true,
        acceptedAt: ACCEPTED_AT,
      },
    },
  }
  const beforeContent = {
    ...afterInventory,
    activeDispatch: {
      dispatchId: 'resource-content-dispatch',
      workerType: 'resource-content-author' as const,
      phase: 'RESOURCE_PREPARATION' as const,
      taskId: 'RESOURCE_CONTENT',
      revision: documentRevision,
      status: 'completed' as const,
      startedAt: ACCEPTED_AT,
      finishedAt: ACCEPTED_AT,
      request: {
        dispatchId: 'resource-content-dispatch',
        runId: RUN_ID,
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        workspacePath,
        workerType: 'resource-content-author' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        taskId: 'RESOURCE_CONTENT',
        revision: documentRevision,
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
      contentReceipt: { contentDigest, acceptedAt: ACCEPTED_AT },
    },
  }
  const afterGate = {
    ...afterContent,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'COMPREHENSIVE_REVIEW' as const,
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: resourceRevision,
        status: 'passed' as const,
        observedAt: ACCEPTED_AT,
      },
    },
  }
  const beforeComprehensive = {
    ...afterGate,
    documentReviewState: {
      ...afterGate.documentReviewState,
      activeCycle: {
        cycleId: 'comprehensive-cycle',
        originScope: 'complete' as const,
        scope: 'complete' as const,
        mode: 'initial' as const,
        sourceRevision: resourceRevision,
        requiredCheckIds: [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS],
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
  }
  const afterComprehensive = {
    ...beforeComprehensive,
    documentReviewState: {
      ...beforeComprehensive.documentReviewState,
      activeCycle: {
        ...beforeComprehensive.documentReviewState.activeCycle,
        completedCheckIds: [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS],
        checks: allReviewChecks,
        checkEvidenceDigests: Object.fromEntries(
          allReviewChecks.map(check => [
            check.id,
            FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.includes(check.id as never)
              ? dependencyDigestsByCheckId[check.id]
              : comprehensiveDependencyDigestsByCheckId[check.id],
          ]),
        ),
        acceptedSemanticResult: true,
      },
    },
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
  const planned = {
    ...afterComprehensive,
    phase: 'IMPLEMENTATION' as const,
    tasks: [task],
  }
  const implemented = {
    ...planned,
    revision: { ...revision, implementation: workspaceRevision },
    tasks: [
      {
        ...task,
        status: 'completed' as const,
        completedRevision: workspaceRevision,
        evidenceRefs: ['.beegame/workflow/evidence/task.json'],
      },
    ],
  }
  const audited = {
    ...implemented,
    phase: 'ACCEPTANCE' as const,
    evidence: {
      ...implemented.evidence,
      implementationAudit: {
        path: '.beegame/workflow/evidence/audit.json',
        kind: 'implementation_audit' as const,
        revision: workspaceRevision,
        status: 'passed' as const,
        observedAt: ACCEPTED_AT,
      },
    },
  }
  const accepted = {
    ...audited,
    phase: 'DELIVERY' as const,
    evidence: {
      ...audited.evidence,
      acceptance: {
        path: '.beegame/workflow/evidence/acceptance.json',
        kind: 'acceptance' as const,
        revision: workspaceRevision,
        status: 'passed' as const,
        observedAt: ACCEPTED_AT,
      },
    },
  }
  const acceptedUnits = [
    ...acceptedDocumentUnits,
    ...deriveAcceptedWorkflowUnits(
      beforeFoundationReview as DeliveryRun,
      afterFoundationReview as DeliveryRun,
    ),
    ...deriveAcceptedWorkflowUnits(
      afterFoundationReview as DeliveryRun,
      afterChecklist as DeliveryRun,
    ),
    ...deriveAcceptedWorkflowUnits(
      afterChecklist as DeliveryRun,
      afterInventory as DeliveryRun,
    ),
    ...deriveAcceptedWorkflowUnits(
      beforeContent as DeliveryRun,
      afterContent as DeliveryRun,
    ),
    ...deriveAcceptedWorkflowUnits(
      afterContent as DeliveryRun,
      afterGate as DeliveryRun,
    ),
  ]
  const acceptedRank = [
    'resource-gate',
    'plan',
    'implementation',
    'audit',
    'acceptance',
  ].indexOf(acceptedThrough)
  if (acceptedRank >= 1)
    acceptedUnits.push(
      ...deriveAcceptedWorkflowUnits(
        beforeComprehensive as DeliveryRun,
        afterComprehensive as DeliveryRun,
      ),
      ...deriveAcceptedWorkflowUnits(
        afterComprehensive as DeliveryRun,
        planned as DeliveryRun,
      ),
    )
  if (acceptedRank >= 2)
    acceptedUnits.push(
      ...deriveAcceptedWorkflowUnits(
        planned as DeliveryRun,
        implemented as DeliveryRun,
      ),
    )
  if (acceptedRank >= 3)
    acceptedUnits.push(
      ...deriveAcceptedWorkflowUnits(
        implemented as DeliveryRun,
        audited as DeliveryRun,
      ),
    )
  if (acceptedRank >= 4)
    acceptedUnits.push(
      ...deriveAcceptedWorkflowUnits(
        audited as DeliveryRun,
        accepted as DeliveryRun,
      ),
    )
  const usage = {
    input_tokens: 101,
    cache_read_tokens: 20,
    cache_creation_tokens: 10,
    completion_tokens: 30,
    total_tokens: 161,
  }
  const store = createRunStore(workspacePath, OWNER_ID)
  await store.commit(journalBase, {
    runId: RUN_ID,
    type: 'run.created',
    phase: journalBase.phase,
    status: journalBase.status,
    revision,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    createdAt: journalBase.createdAt,
  })
  await store.commit(
    { ...journalBase, usage },
    {
      runId: RUN_ID,
      type: 'usage.updated',
      phase: journalBase.phase,
      status: journalBase.status,
      revision,
      usage,
      createdAt: ACCEPTED_AT,
    },
    acceptedUnits,
  )
  if (acceptedRank >= 1)
    await store.appendEvent({
      runId: RUN_ID,
      type: 'tasks.planned',
      phase: 'IMPLEMENTATION',
      status: 'running',
      revision,
      taskGraph: [task],
      createdAt: ACCEPTED_AT,
    })
  const journalEvents = await store.readEvents()
  const events = journalEvents.filter(
    (event): event is WorkflowUnitAcceptedEvent =>
      event.type === 'workflow.unit.accepted',
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
        ...checklistApproval,
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
    usage,
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
    journalEvents,
    snapshot,
    contentDigest,
    inventoryRevision,
    resourceRevision,
    task,
    implementedTask: implemented.tasks[0],
    completedComprehensiveCycle:
      afterComprehensive.documentReviewState.activeCycle,
    implementationAudit: audited.evidence.implementationAudit,
    acceptance: accepted.evidence.acceptance,
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
  events: WorkflowEvent[] = fixture.journalEvents,
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

  for (const unitId of [
    'review:brief_alignment',
    CHECKLIST_UNIT_ID,
    'resource:inventory',
    'resource:gate',
  ])
    test(`does not synthesize accepted proof for ${unitId} from snapshot completion fields`, async () => {
      const fixture = await createProjectionFixture()
      const inspection = await inspect(fixture)
      const events = fixture.journalEvents.filter(
        event =>
          event.type !== 'workflow.unit.accepted' ||
          (event as WorkflowUnitAcceptedEvent).unit.unitId !== unitId,
      )

      await expectRecoveryError(
        projectExactResumeRun(projectInput(fixture, inspection, events)),
        'recovery_checkpoint_missing',
      )
    })

  test('does not infer Document Drafting from an empty accepted prefix without durable active-unit proof', async () => {
    const fixture = await createProjectionFixture()
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: undefined,
      activeDispatch: undefined,
      foundationDraftState: { completedPaths: [] },
      documentReviewState: {
        repairPasses: { foundation: 0, checklist: 0, resource: 0 },
      },
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' as const },
      evidence: {},
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const metadataEvents = fixture.journalEvents.filter(
      event => event.type !== 'workflow.unit.accepted',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, metadataEvents)),
      'recovery_checkpoint_missing',
    )
  })

  test('continues Document Drafting only when the exact unfinished document is durably identified', async () => {
    const fixture = await createProjectionFixture()
    const activePath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const dispatchId = 'active-foundation-draft'
    const request = {
      dispatchId,
      runId: fixture.snapshot.runId,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      workspacePath: fixture.workspacePath,
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: activePath,
      revision: fixture.snapshot.revision.document,
      allowedPaths: [activePath],
      contract: {
        confirmedBriefDigest: fixture.snapshot.confirmedBriefDigest,
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: activePath,
        upstreamDocumentPaths: [],
      },
    }
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: activePath,
      activeDispatch: {
        dispatchId,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: activePath,
        revision: fixture.snapshot.revision.document,
        status: 'running' as const,
        startedAt: fixture.snapshot.updatedAt,
        request,
      },
      foundationDraftState: { completedPaths: [] },
      documentReviewState: {
        repairPasses: { foundation: 0, checklist: 0, resource: 0 },
      },
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' as const },
      evidence: {},
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const metadataEvents = fixture.journalEvents.filter(
      event => event.type !== 'workflow.unit.accepted',
    )

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection, metadataEvents),
    )

    expect(projection.activeUnitId).toBe(`document:${activePath}`)
    expect(projection.run).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      currentItemId: activePath,
    })
  })

  test('rejects a stale canonical document current item after the drafting phase', async () => {
    const fixture = await createProjectionFixture()
    const activePath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const dispatchId = 'stale-foundation-draft'
    const request = {
      dispatchId,
      runId: fixture.snapshot.runId,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      workspacePath: fixture.workspacePath,
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: activePath,
      revision: fixture.snapshot.revision.document,
      allowedPaths: [activePath],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: activePath,
      },
    }
    const snapshot = {
      ...fixture.snapshot,
      phase: 'RESOURCE_PREPARATION' as const,
      documentStep: undefined,
      currentItemId: activePath,
      activeDispatch: {
        dispatchId,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: activePath,
        revision: fixture.snapshot.revision.document,
        status: 'running' as const,
        startedAt: fixture.snapshot.updatedAt,
        request,
      },
      foundationDraftState: { completedPaths: [] },
      documentReviewState: {
        repairPasses: { foundation: 0, checklist: 0, resource: 0 },
      },
      resourceProductionState: { currentTask: 'RESOURCE_CONTENT' as const },
      evidence: {},
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const metadataEvents = fixture.journalEvents.filter(
      event => event.type !== 'workflow.unit.accepted',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, metadataEvents)),
      'recovery_checkpoint_conflict',
    )
  })

  test('rejects a drafting hint whose current item and active dispatch identities differ', async () => {
    const fixture = await createProjectionFixture()
    const activePath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const dispatchedPath = CANONICAL_FOUNDATION_DOCUMENTS[1]
    const dispatchId = 'conflicting-foundation-draft'
    const request = {
      dispatchId,
      runId: fixture.snapshot.runId,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      workspacePath: fixture.workspacePath,
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: dispatchedPath,
      revision: fixture.snapshot.revision.document,
      allowedPaths: [dispatchedPath],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: dispatchedPath,
      },
    }
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: activePath,
      activeDispatch: {
        dispatchId,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: dispatchedPath,
        revision: fixture.snapshot.revision.document,
        status: 'running' as const,
        startedAt: fixture.snapshot.updatedAt,
        request,
      },
      foundationDraftState: { completedPaths: [] },
      documentReviewState: {
        repairPasses: { foundation: 0, checklist: 0, resource: 0 },
      },
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' as const },
      evidence: {},
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const metadataEvents = fixture.journalEvents.filter(
      event => event.type !== 'workflow.unit.accepted',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, metadataEvents)),
      'recovery_checkpoint_conflict',
    )
  })

  test('does not promote matching directory receipts into accepted journal facts', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.filter(
      event =>
        event.type !== 'workflow.unit.accepted' ||
        !(event as WorkflowUnitAcceptedEvent).unit.unitId.startsWith(
          'document:',
        ),
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a stale unrelated document receipt when the exact journal receipt is missing', async () => {
    const fixture = await createProjectionFixture()
    const unitId = `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`
    const accepted = fixture.journalEvents.find(
      event =>
        event.type === 'workflow.unit.accepted' &&
        (event as WorkflowUnitAcceptedEvent).unit.unitId === unitId,
    ) as WorkflowUnitAcceptedEvent
    const dispatchId = 'canonical-document-0'
    expect(accepted.unit.unitId).toBe(unitId)
    const receiptPath = join(
      fixture.workspacePath,
      '.beegame',
      'workflow',
      'document-commits',
      `${dispatchId}.json`,
    )
    const exactReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeFile(
      join(
        fixture.workspacePath,
        '.beegame',
        'workflow',
        'document-commits',
        'stale-unrelated-dispatch.json',
      ),
      `${JSON.stringify({
        ...exactReceipt,
        dispatchId: 'stale-unrelated-dispatch',
      })}\n`,
    )
    await unlink(receiptPath)
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a stale unrelated Resource Content receipt when the exact journal receipt is missing', async () => {
    const fixture = await createProjectionFixture()
    const dispatchId = 'resource-content-dispatch'
    const events = fixture.journalEvents.map(event => {
      if (
        event.type !== 'workflow.unit.accepted' ||
        (event as WorkflowUnitAcceptedEvent).unit.unitId !== 'resource:content'
      )
        return event
      const accepted = event as WorkflowUnitAcceptedEvent
      return {
        ...accepted,
        unit: {
          ...accepted.unit,
          dispatchId,
          receiptRef: `.beegame/workflow/resource-content-commits/${dispatchId}.json`,
        },
      } as WorkflowEvent
    })
    const receiptDirectory = join(
      fixture.workspacePath,
      '.beegame',
      'workflow',
      'resource-content-commits',
    )
    await unlink(join(receiptDirectory, `${dispatchId}.json`))
    await mkdir(receiptDirectory, { recursive: true })
    await writeFile(
      join(receiptDirectory, 'stale-resource-content-dispatch.json'),
      `${JSON.stringify({
        schema: 'beegame-resource-content-commit-v1',
        dispatchId: 'stale-resource-content-dispatch',
        status: 'committed',
        baselineResourceRevision: 'baseline-resource-revision',
        finalRootDigest: 'stale-root-digest',
        stagingRoot: 'staging',
        backupRoot: 'backup',
        writtenPaths: [],
      })}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a Resource Content receipt identity outside the canonical dispatch alphabet', async () => {
    const fixture = await createProjectionFixture()
    const events = fixture.journalEvents.map(event => {
      if (
        event.type !== 'workflow.unit.accepted' ||
        (event as WorkflowUnitAcceptedEvent).unit.unitId !== 'resource:content'
      )
        return event
      const accepted = event as WorkflowUnitAcceptedEvent
      return {
        ...accepted,
        unit: {
          ...accepted.unit,
          dispatchId: '../unowned-receipt',
          receiptRef:
            '.beegame/workflow/resource-content-commits/../unowned-receipt.json',
        },
      } as WorkflowEvent
    })
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_conflict',
    )
  })

  test('fails closed when a snapshot-completed document has no canonical receipt', async () => {
    const fixture = await createProjectionFixture()
    const completedPath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const receiptDirectory = join(
      fixture.workspacePath,
      '.beegame',
      'workflow',
      'document-commits',
    )
    for (const name of await readdir(receiptDirectory)) {
      const receiptPath = join(receiptDirectory, name)
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
        targetPath?: string
      }
      if (receipt.targetPath === completedPath) await unlink(receiptPath)
    }
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: undefined,
      activeDispatch: undefined,
      foundationDraftState: { completedPaths: [completedPath] },
      documentReviewState: {
        repairPasses: { foundation: 0, checklist: 0, resource: 0 },
      },
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' as const },
      evidence: {},
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const ordinaryEvents = fixture.journalEvents.filter(
      event => event.type !== 'workflow.unit.accepted',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, ordinaryEvents)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a snapshot-completed document whose canonical receipt digest conflicts', async () => {
    const fixture = await createProjectionFixture()
    const completedPath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const receiptDirectory = join(
      fixture.workspacePath,
      '.beegame',
      'workflow',
      'document-commits',
    )
    for (const name of await readdir(receiptDirectory)) {
      const receiptPath = join(receiptDirectory, name)
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
        targetPath?: string
        finalDigest?: string
      }
      if (receipt.targetPath !== completedPath) continue
      await writeFile(
        receiptPath,
        `${JSON.stringify({
          ...receipt,
          finalDigest: digest('different synthetic document'),
        })}\n`,
      )
    }
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_artifact_digest_mismatch',
    )
  })

  test('rejects a snapshot-completed implementation task without its accepted event', async () => {
    const fixture = await createProjectionFixture('plan')
    const snapshot = {
      ...fixture.snapshot,
      phase: 'IMPLEMENTATION' as const,
      documentStep: undefined,
      activeDispatch: undefined,
      activeTaskId: undefined,
      revision: {
        ...fixture.snapshot.revision,
        implementation: fixture.snapshot.revision.workspace,
      },
      tasks: [fixture.implementedTask],
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a raw completed task before any atomic plan was accepted', async () => {
    const fixture = await createProjectionFixture()
    expect(
      fixture.events.some(
        event =>
          (event as WorkflowUnitAcceptedEvent).unit.unitId === 'plan:atomic',
      ),
    ).toBe(false)
    const snapshot = {
      ...fixture.snapshot,
      phase: 'IMPLEMENTATION' as const,
      documentStep: undefined,
      activeDispatch: undefined,
      activeTaskId: undefined,
      revision: {
        ...fixture.snapshot.revision,
        implementation: fixture.snapshot.revision.workspace,
      },
      tasks: [fixture.implementedTask],
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
        activeCycle: fixture.completedComprehensiveCycle,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a snapshot-passed implementation audit without its accepted event', async () => {
    const fixture = await createProjectionFixture('implementation')
    const snapshot = {
      ...fixture.snapshot,
      phase: 'IMPLEMENTATION_AUDIT' as const,
      documentStep: undefined,
      activeDispatch: undefined,
      activeTaskId: undefined,
      revision: {
        ...fixture.snapshot.revision,
        implementation: fixture.snapshot.revision.workspace,
      },
      tasks: [fixture.implementedTask],
      evidence: {
        ...fixture.snapshot.evidence,
        implementationAudit: fixture.implementationAudit,
      },
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects snapshot-passed acceptance without its accepted event', async () => {
    const fixture = await createProjectionFixture('audit')
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DELIVERY' as const,
      documentStep: undefined,
      activeDispatch: undefined,
      activeTaskId: undefined,
      revision: {
        ...fixture.snapshot.revision,
        implementation: fixture.snapshot.revision.workspace,
      },
      tasks: [fixture.implementedTask],
      evidence: {
        ...fixture.snapshot.evidence,
        implementationAudit: fixture.implementationAudit,
        acceptance: fixture.acceptance,
      },
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )
  })

  test('projects accepted implementation task audit and acceptance without redispatch', async () => {
    const fixture = await createProjectionFixture('acceptance')
    const snapshot = {
      ...fixture.snapshot,
      phase: 'DELIVERY' as const,
      documentStep: undefined,
      activeDispatch: undefined,
      activeTaskId: undefined,
      revision: {
        ...fixture.snapshot.revision,
        implementation: fixture.snapshot.revision.workspace,
      },
      tasks: [fixture.implementedTask],
      evidence: {
        ...fixture.snapshot.evidence,
        implementationAudit: fixture.implementationAudit,
        acceptance: fixture.acceptance,
      },
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection),
    )

    expect(projection.activeUnitId).toBeUndefined()
    expect(projection.run.tasks[0]?.status).toBe('completed')
    expect(projection.run.evidence.implementationAudit).toEqual(
      fixture.implementationAudit,
    )
    expect(projection.run.evidence.acceptance).toEqual(fixture.acceptance)
  })

  test('projects truncated JSON when the accepted journal proves the complete run', async () => {
    const fixture = await createProjectionFixture('acceptance')
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)

    const projection = await projectExactResumeRun(
      projectInput(fixture, inspection),
    )

    expect(inspection.parsedValue).toBeUndefined()
    expect(projection.activeUnitId).toBeUndefined()
    expect(projection.run).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      phase: 'DELIVERY',
      status: 'completed',
    })
    expect(projection.run.tasks[0]?.status).toBe('completed')
    expect(projection.run.evidence.implementationAudit).toEqual(
      fixture.implementationAudit,
    )
    expect(projection.run.evidence.acceptance).toEqual(fixture.acceptance)
  })

  test('rejects a malformed task graph receipt instead of treating it as absent', async () => {
    const fixture = await createProjectionFixture('plan')
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.map(event =>
      event.type === 'tasks.planned'
        ? { ...event, taskGraph: 'invalid-task-graph' }
        : event,
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_conflict',
    )
  })

  test('rejects an accepted atomic plan when its task graph journal event is missing', async () => {
    const fixture = await createProjectionFixture('plan')
    const snapshot = {
      ...fixture.snapshot,
      phase: 'IMPLEMENTATION' as const,
      documentStep: undefined,
      activeTaskId: fixture.task.id,
      activeDispatch: undefined,
      tasks: [fixture.task],
      documentReviewState: {
        repairPasses: fixture.snapshot.documentReviewState.repairPasses,
        checklistApproval:
          fixture.snapshot.documentReviewState.checklistApproval,
        activeCycle: fixture.completedComprehensiveCycle,
      },
    }
    await writeFile(
      fixture.snapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.filter(
      event => event.type !== 'tasks.planned',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects a snapshot task graph that conflicts with the journal task graph', async () => {
    const fixture = await createProjectionFixture('plan')
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.tasks[0] = {
      ...snapshot.tasks[0],
      title: 'Conflicting snapshot task title',
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
    const events = fixture.journalEvents.filter(
      event =>
        event.type !== 'workflow.unit.accepted' ||
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

  test('rejects conflicting snapshot and journal review terminals', async () => {
    const fixture = await createProjectionFixture()
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.documentReviewState.activeCycle.checks[0] = {
      ...snapshot.documentReviewState.activeCycle.checks[0],
      conclusion: 'Contradictory synthetic terminal.',
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

  test('rejects a raw workspace revision that contradicts journal and current artifacts', async () => {
    const fixture = await createProjectionFixture()
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.revision.workspace = 'contradictory-workspace-revision'
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

  test('rejects a journal workspace revision that contradicts snapshot and current artifacts', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.map(event =>
      event.type === 'workflow.unit.accepted'
        ? {
            ...event,
            revision: {
              ...event.revision,
              workspace: 'contradictory-journal-workspace-revision',
            },
          }
        : event,
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_conflict',
    )
  })

  test('rejects a current workspace revision that no longer matches durable sources', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    await mkdir(join(fixture.workspacePath, 'src'), { recursive: true })
    await writeFile(
      join(fixture.workspacePath, 'src', 'artifact.ts'),
      'export const syntheticValue = 1\n',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_artifact_digest_mismatch',
    )
  })

  test('rejects a placeholder document revision in an accepted document proof', async () => {
    const fixture = await createProjectionFixture()
    const inspection = await inspect(fixture)
    const finalDocumentUnitId = `document:${CANONICAL_FOUNDATION_DOCUMENTS.at(-1)}`
    const events = fixture.journalEvents.map(event => {
      if (event.type !== 'workflow.unit.accepted') return event
      const accepted = event as WorkflowUnitAcceptedEvent
      if (accepted.unit.unitId !== finalDocumentUnitId) return event
      return {
        ...accepted,
        unit: {
          ...accepted.unit,
          inputRevision: 'placeholder-document-revision',
          payload: {
            ...(accepted.unit.payload as Record<string, unknown>),
            revision: 'placeholder-document-revision',
          },
        },
      } as WorkflowEvent
    })

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_artifact_digest_mismatch',
    )
  })

  test('rejects a review checkpoint that carries no dependency proof', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.map(event => {
      if (event.type !== 'workflow.unit.accepted') return event
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

  test('rejects a review checkpoint with only a nonempty dependency subset', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.map(event => {
      if (event.type !== 'workflow.unit.accepted') return event
      const accepted = event as WorkflowUnitAcceptedEvent
      if (accepted.unit.unitId !== 'review:brief_alignment') return event
      const entries = Object.entries(accepted.unit.dependencyDigests)
      expect(entries.length).toBeGreaterThan(1)
      const dependencyDigests = Object.fromEntries(entries.slice(1))
      return {
        ...accepted,
        unit: {
          ...accepted.unit,
          dependencyDigests,
          payload: {
            ...(accepted.unit.payload as Record<string, unknown>),
            dependencyDigests: { brief_alignment: dependencyDigests },
          },
        },
      } as WorkflowEvent
    })

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_artifact_digest_mismatch',
    )
  })

  test('rejects malformed JSON without durable active-unit proof even when the accepted journal is contiguous', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection)),
      'recovery_checkpoint_missing',
    )

    expect(inspection.parsedValue).toBeUndefined()
    expect(inspection.error?.code).toBe('invalid')
  })

  test('rejects raw start and usage that contradict the event journal', async () => {
    const fixture = await createProjectionFixture()
    const snapshot = {
      ...fixture.snapshot,
      createdAt: '2026-08-03T00:00:00.000Z',
      usage: {
        ...fixture.snapshot.usage,
        input_tokens: fixture.snapshot.usage.input_tokens + 1,
      },
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

  test('rejects malformed JSON without a run-created journal proof', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.filter(
      event => event.type !== 'run.created',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects malformed JSON without a cumulative usage journal proof', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.filter(
      event => event.type !== 'usage.updated',
    )

    await expectRecoveryError(
      projectExactResumeRun(projectInput(fixture, inspection, events)),
      'recovery_checkpoint_missing',
    )
  })

  test('rejects malformed JSON when a later accepted event exposes a journal gap', async () => {
    const fixture = await createProjectionFixture()
    await writeFile(fixture.snapshotPath, '{"schemaVersion":')
    const inspection = await inspect(fixture)
    const events = fixture.journalEvents.filter(
      event =>
        event.type !== 'workflow.unit.accepted' ||
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
        projectInput(fixture, inspection, [
          ...fixture.journalEvents,
          duplicate,
        ]),
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
