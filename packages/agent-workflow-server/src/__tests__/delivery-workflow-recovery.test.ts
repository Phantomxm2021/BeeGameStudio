import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  recoverAndResumeRun,
  reconcileRunOnStartup,
  resumeRun,
  retryRun,
  stopRun,
} from '../beegame/delivery-workflow/recovery'
import {
  completeDocumentDraft,
  completeFoundationRemediationLane,
} from '../beegame/delivery-workflow/document-stage'
import { createFoundationReviewState } from '../beegame/delivery-workflow/foundation-review-state'
import { createDeliveryDispatcher } from '../beegame/delivery-workflow/dispatch'
import {
  beginParallelFoundationAuthoring,
  recordFoundationDispatch,
} from '../beegame/delivery-workflow/foundation-authoring-batch'
import {
  createFoundationRemediationStateFromAuthority,
  FOUNDATION_REMEDIATION_LANES,
  recordFoundationRemediationDispatch,
} from '../beegame/delivery-workflow/foundation-remediation'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import { createBeeGameDeliveryWorkerPort } from '../beegame/delivery-worker-session-port'
import {
  computeDocumentRevision,
  computeResourceContentDigest,
  computeWorkspaceRevision,
} from '../beegame/delivery-workflow/revision'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { transitionDeliveryRun } from '../beegame/delivery-workflow/transition'
import { proveExactRawActiveUnitId } from '../beegame/delivery-workflow/recovery-projector'
import {
  createTestDeliveryRun,
  withTestDocumentMetadata,
} from './delivery-workflow-test-helpers'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  CANONICAL_PROJECT_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  type AcceptedWorkflowUnit,
  type AtomicTask,
  type DeliveryRun,
  type DispatchWorkerType,
  type FoundationDocumentPath,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import { WORKER_TYPES } from '../beegame/delivery-workflow/schema'
import {
  commitAuthoredFoundationDocument,
  readAuthoredDocumentReceipt,
} from '../beegame/authored-document-receipt'
import { getGameDocumentContract } from '../beegame/delivery-workflow/game-document-contracts'
import { renderTestCompleteGameDocument } from './complete-game-document-fixture'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'

const RECOVERY_OWNER_ID = 'recovery-owner'
function foundationRecoveryReviewJson(input: {
  revision: string
  priorReviewDigest?: string
}): string {
  return `${JSON.stringify({
    version: 2,
    scope: 'foundation',
    revision: input.revision,
    verdict: 'NEEDS_REVISION',
    ...(input.priorReviewDigest
      ? { priorReviewDigest: input.priorReviewDigest }
      : {}),
    priorConflictStatus: [],
    conflicts: [
      {
        id: 'B1',
        title: 'Recovery conflict',
        problem: 'The accepted outcome still needs one document change.',
        evidence: [
          {
            path: 'docs/GDD.md',
            location: 'Core loop',
            observed: 'The observable outcome is absent.',
          },
        ],
        requiredOutcome: 'Define one observable outcome.',
        changes: [
          {
            path: 'docs/GDD.md',
            action: 'Define the observable outcome.',
          },
        ],
        acceptance: ['The outcome is observable.'],
      },
    ],
  })}\n`
}
const TEST_ACQUISITION_PROFILE = {
  dimensions: ['agnostic'] as const,
  asset_kinds: ['data'] as const,
  usage_tags: [],
  capabilities: [],
  styles: [],
}
const RECOVERY_PROJECT_ID = 'recovery-project'
const RECOVERY_RUN_ID = 'recovery-run'
const RECOVERY_BRIEF = JSON.stringify({
  goal: 'Exercise durable exact-resume authority.',
})
const RECOVERY_ACCEPTED_AT = '2026-08-05T00:00:00.000Z'
const EXACT_RESUME_WORKER_CHECKPOINTS = [
  'before-dispatch',
  'open',
  'terminal-accepted',
  'canonical-receipt',
  'unit-accepted',
] as const

const CANONICAL_RECEIPT_WORKERS: readonly DispatchWorkerType[] = [
  'document-author',
  'resource-content-author',
]

type ExactResumeWorkerCheckpoint =
  (typeof EXACT_RESUME_WORKER_CHECKPOINTS)[number]

function exactResumeCheckpointsForWorker(
  workerType: DispatchWorkerType,
): ExactResumeWorkerCheckpoint[] {
  return EXACT_RESUME_WORKER_CHECKPOINTS.filter(
    checkpoint =>
      checkpoint !== 'canonical-receipt' ||
      CANONICAL_RECEIPT_WORKERS.includes(workerType),
  )
}

function matrixAtomicTask(): AtomicTask {
  return {
    id: 'matrix-task',
    title: 'Synthetic task',
    checklistIds: ['CHECK-001'],
    resourceIds: [],
    contentIds: ['matrix-content'],
    dependsOn: [],
    allowedPaths: ['src/'],
    expectedArtifacts: ['src/output.ts'],
    verification: [
      {
        kind: 'test',
        commandOrAction: 'synthetic verification',
        expectedResult: 'synthetic success',
      },
    ],
    status: 'pending',
    attempt: 0,
    evidenceRefs: [],
  }
}

function matrixCompleteDocument(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
) {
  const contract = getGameDocumentContract(path)
  return withTestDocumentMetadata(
    path,
    renderTestCompleteGameDocument(path, {
      title: contract.discipline,
      executiveSummary: 'Synthetic complete recovery authority.',
      sections: contract.sections.map(section => ({
        sectionId: section.sectionId,
        title: section.title,
        body: `Synthetic production authority for ${section.sectionId}.`,
      })),
      productionMaterials: contract.productionMaterials.map(material =>
        material.format === 'evidence_register'
          ? {
              materialId: material.materialId,
              title: material.title,
              format: material.format,
              entries: [
                {
                  evidenceId: `${material.materialId}.pending`,
                  category: 'search_direction' as const,
                  displayName: 'Pending reference direction',
                  purpose: 'Record a production need before source selection.',
                  state: 'source_not_selected' as const,
                  evidenceRefs: [],
                },
              ],
            }
          : {
              materialId: material.materialId,
              title: material.title,
              format: material.format,
              body:
                material.format === 'markdown_table'
                  ? '| Field | Value |\n| --- | --- |\n| Owner | Synthetic |'
                  : material.format === 'mermaid'
                    ? '```mermaid\ngraph TD\n  A --> B\n```'
                    : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
            },
      ),
      auditAppendix: {
        acceptanceCriteria: ['Synthetic recovery authority is inspectable.'],
        upstreamReferences: [],
        risks: [],
        openDecisions: [],
      },
    }),
  )
}

async function commitMatrixFoundationDocument(input: {
  workspacePath: string
  dispatchId: string
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
  body?: string
}): Promise<void> {
  await mkdir(join(input.workspacePath, 'docs'), { recursive: true })
  await writeFile(
    join(input.workspacePath, input.path),
    input.body ?? matrixCompleteDocument(input.path),
  )
  await commitAuthoredFoundationDocument({
    workspacePath: input.workspacePath,
    dispatchId: input.dispatchId,
    targetPath: input.path,
  })
}

function matrixContentDocument() {
  return {
    path: 'assets/content/matrix.json',
    schema: 'beegame-content-v1' as const,
    id: 'matrix-content',
    kind: 'resource-registry' as const,
    fulfills: ['matrix-requirement'],
    resources: ['matrix-resource'],
    data: {
      bindings: [
        {
          requirementId: 'matrix-requirement',
          resourceIds: ['matrix-resource'],
        },
      ],
    },
  }
}

function resourceContentDocumentMap(
  document: ReturnType<typeof matrixContentDocument>,
) {
  const { path, ...value } = document
  return { [path]: value }
}

async function writeMatrixContent(workspacePath: string): Promise<void> {
  await mkdir(join(workspacePath, 'assets/content'), { recursive: true })
  const { path: _path, ...document } = matrixContentDocument()
  await writeFile(
    join(workspacePath, 'assets/content/matrix.json'),
    JSON.stringify(document),
  )
}

async function writeMatrixEvidence(
  workspacePath: string,
  name: string,
): Promise<string> {
  const path = `.beegame/workflow/evidence/${name}.json`
  await mkdir(join(workspacePath, '.beegame/workflow/evidence'), {
    recursive: true,
  })
  await writeFile(join(workspacePath, path), '{}')
  return path
}

function matrixStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : []
}

function matrixFrontmatterValue(
  content: string,
  field: string,
): string | undefined {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return undefined
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') return undefined
    const separator = line.indexOf(':')
    if (separator < 1 || line.slice(0, separator).trim() !== field) continue
    const raw = line.slice(separator + 1).trim()
    if (!raw) return undefined
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    return quoted ? raw.slice(1, -1).trim() : raw
  }
  return undefined
}

async function matrixTerminal(input: {
  workspacePath: string
  request: WorkerDispatchRequest
  persistCanonicalReceipt?: boolean
}) {
  const { request, workspacePath } = input
  const evidencePath = await writeMatrixEvidence(
    workspacePath,
    `${request.workerType}-${request.dispatchId}`,
  )
  const taskMetrics = {
    catalogPayloadBytes: 0,
    catalogCallTypes: [],
    canonicalMutationCount: 1,
  }
  if (request.workerType === 'document-author') {
    const targetPath =
      request.taskId! as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
    await commitMatrixFoundationDocument({
      workspacePath,
      dispatchId: request.dispatchId!,
      path: targetPath,
    })
    return {
      workerType: request.workerType,
      status: 'completed' as const,
      writtenPaths: [targetPath],
      resolvedFindingIds: [],
    }
  }
  if (request.workerType === 'resource-planner') {
    await writeBeeGameAssetManifest(workspacePath, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['dat', 'json'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [
        {
          id: 'matrix-requirement',
          required: true,
          acquisition_profile: TEST_ACQUISITION_PROFILE,
        },
      ],
      resources: [],
    })
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'completed' as const,
      writtenPaths: ['assets/asset-manifest.json'],
      taskMetrics,
    }
  }
  if (request.workerType === 'resource-curator') {
    await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspacePath, 'assets/runtime/matrix.dat'), 'data')
    await registerBeeGameAuthoredResources(workspacePath, [
      {
        id: 'matrix-resource',
        root_path: 'assets/runtime/matrix.dat',
        file_paths: ['assets/runtime/matrix.dat'],
        provisional: true,
        reason: 'Synthetic matrix authority.',
        selection_reason: ['Covers the synthetic requirement.'],
        asset_kind: 'data',
      },
    ])
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'completed' as const,
      catalogObserved: true,
      resourceIds: ['matrix-resource'],
      bindings: [
        {
          requirementId: 'matrix-requirement',
          resourceIds: ['matrix-resource'],
        },
      ],
      writtenPaths: ['assets/asset-manifest.json', 'assets/runtime/matrix.dat'],
      taskMetrics,
    }
  }
  if (request.workerType === 'resource-content-author') {
    if (input.persistCanonicalReceipt) {
      const tool = createNativeResourceContentTool({
        buildTool: definition => definition,
        workspacePath,
        contract: {
          dispatchId: request.dispatchId!,
          inventoryRevision: String(request.contract.inventoryRevision),
          baselineResourceRevision: String(
            request.contract.baselineResourceRevision,
          ),
          requiredRequirementIds: matrixStringArray(
            request.contract.requiredRequirementIds,
          ),
          verifiedResourceIds: matrixStringArray(
            request.contract.verifiedResourceIds,
          ),
          inventoryBindings: request.contract.inventoryBindings as Array<{
            requirementId: string
            resourceIds: string[]
          }>,
          writablePaths: ['assets/content/matrix.json'],
        },
        assertMutationAuthority: () => undefined,
      }) as { call(value: unknown): Promise<unknown> }
      await tool.call({
        action: 'commit',
        documents: resourceContentDocumentMap(matrixContentDocument()),
      })
    } else await writeMatrixContent(workspacePath)
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'completed' as const,
      contentIds: ['matrix-content'],
      writtenPaths: ['assets/content/matrix.json'],
      missingRequirementIds: [],
      taskMetrics,
    }
  }
  if (request.workerType === 'atomic-task-planner')
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'completed' as const,
      tasks: [matrixAtomicTask()],
      evidencePath,
    }
  if (request.workerType === 'implementation-worker') {
    await mkdir(join(workspacePath, 'src'), { recursive: true })
    await writeFile(join(workspacePath, 'src/output.ts'), 'export {}\n')
    return {
      workerType: request.workerType,
      revision: request.revision,
      taskId: request.taskId!,
      status: 'completed' as const,
      changedPaths: ['src/output.ts'],
      verifiedArtifacts: ['src/output.ts'],
      verificationResults: [
        {
          verificationIndex: 0,
          status: 'passed' as const,
          observations: ['Synthetic verification passed.'],
        },
      ],
      evidenceRefs: [evidencePath],
      evidencePath,
    }
  }
  const checklistIds = matrixStringArray(request.contract.checklistIds)
  const resourceIds = matrixStringArray(request.contract.resourceIds)
  const contentIds = matrixStringArray(request.contract.contentIds)
  if (request.workerType === 'implementation-auditor')
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'passed' as const,
      auditedTaskIds: ['matrix-task'],
      checklistIds,
      resourceIds,
      contentIds,
      findings: [],
      evidencePath,
    }
  if (request.workerType === 'acceptance-validator')
    return {
      workerType: request.workerType,
      revision: request.revision,
      status: 'passed' as const,
      validatedTaskIds: ['matrix-task'],
      checklistIds,
      resourceIds,
      contentIds,
      findings: [],
      evidencePath,
    }
  if (request.workerType === 'change-impact-analyzer')
    return {
      workerType: request.workerType,
      classification: 'question' as const,
      affectedRequirementIds: [],
      affectedChecklistIds: [],
      rationale: 'The synthetic request is informational.',
      evidencePath,
    }
  return {
    workerType: request.workerType,
    answer: 'Synthetic answer.',
    evidencePath,
  }
}

function matrixWorkerUnitKey(request: WorkerDispatchRequest): string {
  return stableMatrixValue({
    workerType: request.workerType,
    taskId: request.taskId,
    currentCheckIds: request.contract.currentCheckIds,
  })
}

function stableMatrixValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(item => stableMatrixValue(item)).join(',')}]`
  if (!value || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null'
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableMatrixValue(record[key])}`)
    .join(',')}}`
}

async function createWorkerRecoveryRun(input: {
  workspacePath: string
  workerType: DispatchWorkerType
}): Promise<DeliveryRun> {
  for (const [index, path] of CANONICAL_PROJECT_DOCUMENTS.entries()) {
    if (CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never))
      await commitMatrixFoundationDocument({
        workspacePath: input.workspacePath,
        dispatchId: `matrix-document-${index}`,
        path: path as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
      })
    else {
      await mkdir(join(input.workspacePath, 'docs/acceptance'), {
        recursive: true,
      })
      await writeFile(
        join(input.workspacePath, path),
        '# Acceptance\n- [ ] CHECK-001 source: docs/GDD.md implement: Execute the synthetic action expected: observable result evidence: runtime\n',
      )
    }
  }

  const confirmedBriefDigest = sha256(RECOVERY_BRIEF)
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    confirmedBriefDigest,
  )
  let workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const needsManifest = ![
    'document-author',
    'document-reviewer',
    'resource-planner',
  ].includes(input.workerType)
  const needsInventoryGap = input.workerType === 'resource-curator'
  const needsDeliveryArtifacts = [
    'atomic-task-planner',
    'implementation-worker',
    'implementation-auditor',
    'acceptance-validator',
  ].includes(input.workerType)
  const needsVerifiedInventory =
    input.workerType === 'resource-content-author' || needsDeliveryArtifacts
  if (needsManifest) {
    await writeBeeGameAssetManifest(input.workspacePath, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['dat', 'json'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements:
        needsInventoryGap || needsVerifiedInventory
          ? [
              {
                id: 'matrix-requirement',
                required: true,
                acquisition_profile: TEST_ACQUISITION_PROFILE,
              },
            ]
          : [],
      resources: [],
    })
  }
  if (needsVerifiedInventory) {
    await mkdir(join(input.workspacePath, 'assets/runtime'), {
      recursive: true,
    })
    await writeFile(
      join(input.workspacePath, 'assets/runtime/matrix.dat'),
      'synthetic',
    )
    await registerBeeGameAuthoredResources(input.workspacePath, [
      {
        id: 'matrix-resource',
        root_path: 'assets/runtime/matrix.dat',
        file_paths: ['assets/runtime/matrix.dat'],
        provisional: true,
        reason: 'Synthetic matrix authority.',
        selection_reason: ['Covers the synthetic requirement.'],
        asset_kind: 'data',
      },
    ])
  }
  if (needsDeliveryArtifacts) await writeMatrixContent(input.workspacePath)
  workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const inventoryRevision = needsManifest
    ? await computeResourceInventoryRevision(input.workspacePath)
    : undefined
  const contentDigest = needsManifest
    ? await computeResourceContentDigest(input.workspacePath)
    : undefined
  const resourceRevision = needsManifest
    ? await computeResourceRevision(input.workspacePath, documentRevision)
    : undefined
  const initial = createTestDeliveryRun({
    runId: `matrix-run-${input.workerType}`,
    projectId: 'synthetic-matrix-project',
    ownerId: 'synthetic-matrix-owner',
    confirmedBriefContext: RECOVERY_BRIEF,
    documentRevision,
    workspaceRevision,
    checklistApproved: true,
  })
  const task = matrixAtomicTask()
  const resourcePreparation = resourceRevision
    ? {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: resourceRevision,
        status: 'passed' as const,
        observedAt: RECOVERY_ACCEPTED_AT,
      }
    : undefined
  const common: DeliveryRun = {
    ...initial,
    revision: {
      document: documentRevision,
      workspace: workspaceRevision,
      ...(resourceRevision ? { resource: resourceRevision } : {}),
    },
    evidence: resourcePreparation ? { resourcePreparation } : {},
    resourceProductionState: {
      currentTask: 'RESOURCE_GATE',
      ...(inventoryRevision
        ? {
            inventoryReceipt: {
              revision: inventoryRevision,
              bindings: needsVerifiedInventory
                ? [
                    {
                      requirementId: 'matrix-requirement',
                      resourceIds: ['matrix-resource'],
                    },
                  ]
                : [],
              catalogObserved: true,
              acceptedAt: RECOVERY_ACCEPTED_AT,
            },
          }
        : {}),
      ...(contentDigest
        ? {
            contentReceipt: {
              contentDigest,
              acceptedAt: RECOVERY_ACCEPTED_AT,
            },
          }
        : {}),
    },
  }

  if (input.workerType === 'document-author')
    return {
      ...common,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      foundationDraftState: { completedPaths: [] },
      evidence: {},
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
  if (input.workerType === 'document-reviewer')
    return {
      ...common,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      foundationReviewState: createFoundationReviewState({
        mode: 'initial',
        revision: documentRevision,
        attempt: 1,
      }),
      evidence: {},
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
  if (input.workerType === 'resource-planner')
    return {
      ...common,
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      evidence: {},
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
  if (input.workerType === 'resource-curator')
    return {
      ...common,
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      evidence: {},
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    }
  if (input.workerType === 'resource-content-author')
    return {
      ...common,
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      evidence: {},
      resourceProductionState: {
        ...common.resourceProductionState,
        currentTask: 'RESOURCE_CONTENT',
        contentReceipt: undefined,
      },
    }
  if (input.workerType === 'atomic-task-planner')
    return { ...common, phase: 'ATOMIC_TASK_PLANNING', tasks: [] }
  if (input.workerType === 'implementation-worker')
    return { ...common, phase: 'IMPLEMENTATION', tasks: [task] }
  const completedTask: AtomicTask = {
    ...task,
    status: 'completed',
    completedRevision: workspaceRevision,
    evidenceRefs: ['.beegame/workflow/evidence/matrix-task.json'],
  }
  if (input.workerType === 'implementation-auditor')
    return {
      ...common,
      phase: 'IMPLEMENTATION_AUDIT',
      tasks: [completedTask],
      revision: { ...common.revision, implementation: workspaceRevision },
    }
  if (input.workerType === 'acceptance-validator')
    return {
      ...common,
      phase: 'ACCEPTANCE',
      tasks: [completedTask],
      revision: { ...common.revision, implementation: workspaceRevision },
      evidence: {
        ...common.evidence,
        implementationAudit: {
          path: '.beegame/workflow/evidence/implementation-audit.json',
          kind: 'implementation_audit',
          revision: workspaceRevision,
          status: 'passed',
          observedAt: RECOVERY_ACCEPTED_AT,
        },
      },
    }
  if (input.workerType === 'change-impact-analyzer')
    return {
      ...common,
      phase: 'DELIVERY',
      changeRequest: 'Synthetic change request.',
    }
  return {
    ...common,
    phase: 'DELIVERY',
    changeRequest: 'Synthetic question.',
    changeRoute: 'question',
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function createStaleReviewerRecoveryFixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-exact-resume-'))
  for (const [index, path] of CANONICAL_PROJECT_DOCUMENTS.entries()) {
    if (CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never))
      await commitMatrixFoundationDocument({
        workspacePath,
        dispatchId: `fixture-document-${index}`,
        path: path as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
      })
    else {
      await mkdir(join(workspacePath, 'docs/acceptance'), { recursive: true })
      await writeFile(join(workspacePath, path), '# Fixture')
    }
  }
  await writeBeeGameAssetManifest(workspacePath, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      {
        id: 'fixture-requirement',
        required: true,
        acquisition_profile: TEST_ACQUISITION_PROFILE,
      },
    ],
    resources: [],
  })
  await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspacePath, 'assets/runtime/fixture.dat'), 'fixture')
  await registerBeeGameAuthoredResources(workspacePath, [
    {
      id: 'fixture-resource',
      root_path: 'assets/runtime/fixture.dat',
      file_paths: ['assets/runtime/fixture.dat'],
      provisional: true,
      reason: 'Synthetic recovery authority.',
      selection_reason: ['Provides deterministic inventory coverage.'],
      asset_kind: 'data',
    },
  ])

  const confirmedBriefDigest = sha256(RECOVERY_BRIEF)
  const documentRevision = await computeDocumentRevision(
    workspacePath,
    confirmedBriefDigest,
  )
  const inventoryRevision =
    await computeResourceInventoryRevision(workspacePath)
  const resourceContentDispatchId = 'fixture-resource-content'
  const resourceContentTool = createNativeResourceContentTool({
    buildTool: definition => definition,
    workspacePath,
    contract: {
      dispatchId: resourceContentDispatchId,
      inventoryRevision,
      baselineResourceRevision: await computeResourceRevision(
        workspacePath,
        '',
      ),
      requiredRequirementIds: ['fixture-requirement'],
      verifiedResourceIds: ['fixture-resource'],
      inventoryBindings: [
        {
          requirementId: 'fixture-requirement',
          resourceIds: ['fixture-resource'],
        },
      ],
      writablePaths: ['assets/content/resource-registry.json'],
    },
    assertMutationAuthority: () => undefined,
  }) as { call(value: unknown): Promise<unknown> }
  await resourceContentTool.call({
    action: 'commit',
    documents: {
      'assets/content/resource-registry.json': {
        schema: 'beegame-content-v1',
        id: 'fixture-resource-registry',
        kind: 'resource-registry',
        fulfills: ['fixture-requirement'],
        resources: ['fixture-resource'],
        data: {
          bindings: [
            {
              requirementId: 'fixture-requirement',
              resourceIds: ['fixture-resource'],
            },
          ],
        },
      },
    },
  })
  const workspaceRevision = await computeWorkspaceRevision(workspacePath)
  const contentDigest = await computeResourceContentDigest(workspacePath)
  const resourceRevision = await computeResourceRevision(
    workspacePath,
    documentRevision,
  )
  const revision = {
    document: documentRevision,
    resource: resourceRevision,
    workspace: workspaceRevision,
  }
  const acceptedUnits: AcceptedWorkflowUnit[] = [
    ...CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
      eventSchemaVersion: 1 as const,
      unitId: `document:${path}`,
      kind: 'document' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      predecessorUnitIds:
        index === 0
          ? []
          : [`document:${CANONICAL_FOUNDATION_DOCUMENTS[index - 1]}`],
      inputRevision: documentRevision,
      dependencyDigests: {},
      dispatchId: `fixture-document-${index}`,
      receiptRef: `.beegame/workflow/document-commits/fixture-document-${index}.json`,
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: { path, revision: documentRevision },
    })),
    {
      eventSchemaVersion: 1,
      unitId: 'resource:inventory',
      kind: 'resource-inventory',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: [
        `document:${CANONICAL_FOUNDATION_DOCUMENTS.at(-1)!}`,
      ],
      inputRevision: inventoryRevision,
      dependencyDigests: {},
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: {
        bindings: [
          {
            requirementId: 'fixture-requirement',
            resourceIds: ['fixture-resource'],
          },
        ],
        catalogObserved: true,
      },
    },
    {
      eventSchemaVersion: 1,
      unitId: 'resource:content',
      kind: 'resource-content',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: ['resource:inventory'],
      inputRevision: contentDigest,
      dependencyDigests: { content: contentDigest },
      dispatchId: resourceContentDispatchId,
      receiptRef: `.beegame/workflow/resource-content-commits/${resourceContentDispatchId}.json`,
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: { contentDigest },
    },
    {
      eventSchemaVersion: 1,
      unitId: 'resource:gate',
      kind: 'resource-gate',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: ['resource:content'],
      inputRevision: resourceRevision,
      dependencyDigests: {},
      receiptRef: '.beegame/workflow/evidence/resource-gate.json',
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: { receiptRef: '.beegame/workflow/evidence/resource-gate.json' },
    },
  ]
  const base = createTestDeliveryRun({
    runId: RECOVERY_RUN_ID,
    projectId: RECOVERY_PROJECT_ID,
    ownerId: RECOVERY_OWNER_ID,
    confirmedBriefContext: RECOVERY_BRIEF,
    checklistApproved: true,
  })
  const usage = {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  const journalRun: DeliveryRun = {
    ...base,
    revision,
    usage,
  }
  const store = createRunStore(workspacePath, RECOVERY_OWNER_ID)
  await store.commit(journalRun, {
    runId: journalRun.runId,
    type: 'run.created',
    phase: journalRun.phase,
    status: journalRun.status,
    revision,
    projectId: journalRun.projectId,
    ownerId: journalRun.ownerId,
    createdAt: journalRun.createdAt,
  })
  await store.commit(
    journalRun,
    {
      runId: journalRun.runId,
      type: 'usage.updated',
      phase: journalRun.phase,
      status: journalRun.status,
      revision,
      usage,
      createdAt: RECOVERY_ACCEPTED_AT,
    },
    acceptedUnits,
  )

  const snapshot = {
    ...journalRun,
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    invalidRecoveryMarker: true,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'FOUNDATION_REVIEW' as const,
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: resourceRevision,
        status: 'passed' as const,
        observedAt: RECOVERY_ACCEPTED_AT,
      },
    },
    resourceProductionState: {
      currentTask: 'RESOURCE_GATE' as const,
      inventoryReceipt: {
        revision: inventoryRevision,
        bindings: [
          {
            requirementId: 'fixture-requirement',
            resourceIds: ['fixture-resource'],
          },
        ],
        catalogObserved: true,
        acceptedAt: RECOVERY_ACCEPTED_AT,
      },
      contentReceipt: { contentDigest, acceptedAt: RECOVERY_ACCEPTED_AT },
    },
    foundationReviewState: createFoundationReviewState({
      mode: 'initial',
      revision: documentRevision,
      attempt: 1,
    }),
  }
  await writeFile(
    store.paths.snapshot,
    `${JSON.stringify(snapshot, null, 2)}\n`,
  )
  return {
    workspacePath,
    store,
    snapshot,
    journalRun,
    resourceRevision,
  }
}

async function createCanonicalReceiptRecoveryFixture(input?: {
  mutateSnapshot?: (
    snapshot: Record<string, unknown>,
  ) => Record<string, unknown>
}) {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'beegame-invalid-document-receipt-'),
  )
  const ownerId = 'owner-1'
  const projectId = 'project-1'
  const runId = 'run-1'
  const store = createRunStore(workspacePath, ownerId)
  const firstPath = CANONICAL_FOUNDATION_DOCUMENTS[0]
  const nextPath = CANONICAL_FOUNDATION_DOCUMENTS[1]
  const dispatchId = 'committed-document-dispatch'
  await commitMatrixFoundationDocument({
    workspacePath,
    dispatchId,
    path: firstPath,
  })
  const confirmedBriefDigest = sha256(RECOVERY_BRIEF)
  const revision = {
    document: await computeDocumentRevision(
      workspacePath,
      confirmedBriefDigest,
    ),
    workspace: await computeWorkspaceRevision(workspacePath),
  }
  const usage = {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  const journalRun = {
    ...createTestDeliveryRun({
      runId,
      projectId,
      ownerId,
      confirmedBriefContext: RECOVERY_BRIEF,
      foundationDraftComplete: false,
    }),
    revision,
    usage,
  }
  await store.commit(journalRun, {
    runId,
    type: 'run.created',
    phase: journalRun.phase,
    status: journalRun.status,
    revision,
    projectId,
    ownerId,
    createdAt: journalRun.createdAt,
  })
  await store.commit(journalRun, {
    runId,
    type: 'usage.updated',
    phase: journalRun.phase,
    status: journalRun.status,
    revision,
    usage,
    createdAt: journalRun.updatedAt,
  })
  const request: WorkerDispatchRequest = {
    dispatchId,
    runId,
    ownerId,
    projectId,
    workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: firstPath,
    revision: revision.document,
    allowedPaths: [firstPath],
    contract: {
      confirmedBriefDigest,
      documentSet: 'foundation',
      authoringMode: 'initial',
      foundationDocumentPath: firstPath,
      upstreamDocumentPaths: [],
    },
  }
  const rawSnapshot: Record<string, unknown> = {
    ...journalRun,
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    invalidRecoveryMarker: true,
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    currentItemId: firstPath,
    activeDispatch: {
      dispatchId,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: firstPath,
      revision: revision.document,
      status: 'running',
      startedAt: journalRun.updatedAt,
      request,
    },
  }
  const snapshot = input?.mutateSnapshot
    ? input.mutateSnapshot(rawSnapshot)
    : rawSnapshot
  await writeFile(
    store.paths.snapshot,
    `${JSON.stringify(snapshot, null, 2)}\n`,
  )
  const started: WorkerDispatchRequest[] = []
  const controller = createDeliveryWorkflowController({
    workspacePath,
    ownerId,
    workerPort: {
      async start(nextRequest) {
        started.push(nextRequest)
        return {
          sessionId: nextRequest.dispatchId!,
          dispatchId: nextRequest.dispatchId!,
        }
      },
      async submit() {},
      async stop() {},
      async status() {
        throw new Error('not used')
      },
    },
  })
  return {
    workspacePath,
    store,
    ownerId,
    projectId,
    firstPath,
    nextPath,
    started,
    recover: () =>
      recoverAndResumeRun({
        store,
        workspacePath,
        ownerId,
        projectId,
        confirmedBriefContext: RECOVERY_BRIEF,
        stopWorkspaceWorkers: async () => undefined,
        resumeCurrentRun: run => controller.resume(run),
      }),
  }
}

describe('delivery workflow recovery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('defines every exact-resume checkpoint for every persisted worker type', () => {
    expect(WORKER_TYPES).toHaveLength(11)
    expect(EXACT_RESUME_WORKER_CHECKPOINTS).toEqual([
      'before-dispatch',
      'open',
      'terminal-accepted',
      'canonical-receipt',
      'unit-accepted',
    ])
    expect(
      WORKER_TYPES.filter(
        workerType => workerType !== 'document-reviewer',
      ).flatMap(workerType => exactResumeCheckpointsForWorker(workerType)),
    ).toHaveLength(42)
    expect(CANONICAL_RECEIPT_WORKERS).toEqual([
      'document-author',
      'resource-content-author',
    ])
  })

  for (const workerType of WORKER_TYPES.filter(
    workerType => workerType !== 'document-reviewer',
  )) {
    for (const checkpoint of exactResumeCheckpointsForWorker(workerType)) {
      test(`${workerType} keeps semantic dispatch count stable at ${checkpoint}`, async () => {
        workspace = await mkdtemp(join(tmpdir(), 'beegame-worker-matrix-'))
        const run = await createWorkerRecoveryRun({
          workspacePath: workspace,
          workerType,
        })
        const store = createRunStore(workspace, run.ownerId)
        await store.save(run)
        const started: WorkerDispatchRequest[] = []
        const workerPort = {
          async start(startedRequest: WorkerDispatchRequest) {
            started.push(startedRequest)
            return {
              sessionId: startedRequest.dispatchId!,
              dispatchId: startedRequest.dispatchId!,
            }
          },
          async submit() {},
          async stop() {},
          async status() {
            throw new Error('not used')
          },
        }
        const resumeFromDisk = async (sessionOpen: boolean) => {
          const restartedStore = createRunStore(workspace, run.ownerId)
          const controller = createDeliveryWorkflowController({
            workspacePath: workspace,
            ownerId: run.ownerId,
            workerPort,
          })
          const resumed = await resumeRun({
            store: restartedStore,
            runId: run.runId,
            workspacePath: workspace,
            sessionIsOpen: async () => sessionOpen,
          })
          await controller.resume(resumed)
          return restartedStore
        }

        if (checkpoint === 'before-dispatch') {
          await resumeFromDisk(false)
          expect(started.map(request => request.workerType)).toEqual([
            workerType,
          ])
          return
        }

        const firstController = createDeliveryWorkflowController({
          workspacePath: workspace,
          ownerId: run.ownerId,
          workerPort,
        })
        await firstController.resume(run)
        const active = (await store.load())?.activeDispatch
        expect(active?.request?.workerType).toBe(workerType)
        const originalRequest = active!.request!

        if (checkpoint === 'open') {
          await resumeFromDisk(true)
        } else {
          const terminal = await matrixTerminal({
            workspacePath: workspace,
            request: originalRequest,
            persistCanonicalReceipt: checkpoint === 'canonical-receipt',
          })
          if (checkpoint !== 'canonical-receipt') {
            const terminalOnlyDispatcher = createDeliveryDispatcher({
              store,
              workerPort,
            })
            await terminalOnlyDispatcher.completeDispatch(
              active!.dispatchId,
              terminal,
            )
          }
          const recoveredStore = await resumeFromDisk(false)
          if (
            workerType === 'document-author' &&
            checkpoint === 'terminal-accepted'
          ) {
            const completedEvent = (await recoveredStore.readEvents()).find(
              event =>
                event.type === 'dispatch.completed' &&
                event.dispatchId === active!.dispatchId,
            )
            expect(completedEvent?.documentPerformance).toMatchObject({
              targetPath: originalRequest.taskId,
              usage: {
                input_tokens: 0,
                cache_read_tokens: 0,
                completion_tokens: 0,
              },
              retryReason: null,
            })
            expect(
              (completedEvent?.documentPerformance as { markdownBytes: number })
                .markdownBytes,
            ).toBeGreaterThan(0)
          }
          if (checkpoint === 'canonical-receipt') {
            const acceptedUnitId =
              workerType === 'document-author'
                ? `document:${originalRequest.taskId}`
                : 'resource:content'
            expect(
              (await recoveredStore.readEvents()).filter(
                event =>
                  event.type === 'workflow.unit.accepted' &&
                  (event.unit as AcceptedWorkflowUnit).unitId ===
                    acceptedUnitId,
              ),
            ).toHaveLength(1)
          }
          if (checkpoint === 'unit-accepted') await resumeFromDisk(false)
        }

        expect(
          started.filter(
            request =>
              matrixWorkerUnitKey(request) ===
              matrixWorkerUnitKey(originalRequest),
          ),
        ).toHaveLength(1)
      })
    }
  }

  test('recovers a committed canonical document without redispatching its semantic repair', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-receipt-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'document-repair-dispatch',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: initial.revision.document,
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'remediation',
        foundationDocumentPath: 'docs/GDD.md',
      },
    }
    await commitMatrixFoundationDocument({
      workspacePath: workspace,
      dispatchId: request.dispatchId!,
      path: 'docs/GDD.md',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      status: 'needs_action',
      activeDispatch: {
        dispatchId: request.dispatchId!,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'interrupted',
        startedAt: new Date().toISOString(),
        request,
      },
      blockedReason: 'worker transport was interrupted',
    })

    const resumed = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(resumed.status).toBe('running')
    expect(resumed.activeDispatch).toMatchObject({
      dispatchId: request.dispatchId,
      status: 'completed',
      terminalResult: {
        workerType: 'document-author',
        writtenPaths: ['docs/GDD.md'],
      },
    })
  })

  test('replays local document validation after a completed author handoff without redispatching that document', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-local-retry-'))
    await mkdir(join(workspace, 'docs'), { recursive: true })
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const initial = {
      ...createTestDeliveryRun({
        runId: 'run-local-document-retry',
        projectId: 'project-local-document-retry',
        ownerId: 'owner-1',
        foundationDraftComplete: false,
      }),
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
    }
    const request: WorkerDispatchRequest = {
      dispatchId: 'completed-gdd-author',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: initial.revision.document,
      allowedPaths: [path],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: path,
      },
    }
    const terminal = {
      workerType: 'document-author' as const,
      status: 'completed' as const,
      writtenPaths: [path],
      resolvedFindingIds: [],
    }
    const completedDispatch = {
      dispatchId: request.dispatchId!,
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: path,
      revision: initial.revision.document,
      status: 'completed' as const,
      request,
      terminalResult: terminal,
      startedAt: '2026-08-12T00:00:00.000Z',
      finishedAt: '2026-08-12T00:01:00.000Z',
    }
    await writeFile(
      join(workspace, path),
      matrixCompleteDocument(path).replace(
        '## Executive Summary',
        '## Invalid Executive Summary',
      ),
    )

    const rejected = await completeDocumentDraft({
      run: { ...initial, activeDispatch: completedDispatch },
      workspacePath: workspace,
      terminal,
      documentSet: 'foundation',
      audit: () => ({ valid: true, issues: [] }),
    })

    expect(rejected.blockedReason).toContain(
      'complete game document executive summary heading is invalid',
    )
    expect(rejected.activeDispatch).toMatchObject({
      dispatchId: request.dispatchId,
      status: 'completed',
      terminalResult: terminal,
    })

    const started: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: initial.ownerId,
      workerPort: {
        async start(nextRequest) {
          started.push(nextRequest)
          return {
            sessionId: `session-${nextRequest.taskId}`,
            dispatchId: nextRequest.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    await controller.store.save({
      ...rejected,
      status: 'needs_action',
    })
    const stillInvalid = await retryRun({
      store: controller.store,
      runId: initial.runId,
      workspacePath: workspace,
    })
    await controller.resume(stillInvalid)

    expect(started).toHaveLength(0)
    expect(await controller.store.load()).toMatchObject({
      status: 'needs_action',
      activeDispatch: {
        dispatchId: request.dispatchId,
        status: 'completed',
        terminalResult: terminal,
      },
    })

    await writeFile(join(workspace, path), matrixCompleteDocument(path))
    const retried = await retryRun({
      store: controller.store,
      runId: initial.runId,
      workspacePath: workspace,
    })
    await controller.resume(retried)

    const resumed = await controller.store.load()
    expect(resumed?.foundationDraftState.completedPaths).toEqual([path])
    expect(started.map(candidate => candidate.taskId)).toEqual([
      'docs/LEVEL_SCENE_DESIGN.md',
    ])
    await expect(
      readAuthoredDocumentReceipt(workspace, request.dispatchId!),
    ).resolves.toMatchObject({
      dispatchId: request.dispatchId,
      targetPath: path,
      status: 'committed',
    })
  })

  test('reconciles an invalid snapshots active canonical document receipt before projection', async () => {
    const fixture = await createCanonicalReceiptRecoveryFixture()
    workspace = fixture.workspacePath

    const recovered = await fixture.recover()

    expect(recovered.foundationDraftState.completedPaths).toEqual([
      fixture.firstPath,
    ])
    expect(fixture.started).toHaveLength(1)
    expect(fixture.started[0]).toMatchObject({
      workerType: 'document-author',
      taskId: fixture.nextPath,
      contract: { foundationDocumentPath: fixture.nextPath },
    })
    expect(
      fixture.started.some(candidate => candidate.taskId === fixture.firstPath),
    ).toBe(false)
    const accepted = (await fixture.store.readEvents()).filter(
      event =>
        event.type === 'workflow.unit.accepted' &&
        (event.unit as AcceptedWorkflowUnit).unitId ===
          `document:${fixture.firstPath}`,
    )
    expect(accepted).toHaveLength(1)
  })

  test('rejects a later-phase stale canonical drafting hint even with its matching receipt', async () => {
    const fixture = await createCanonicalReceiptRecoveryFixture({
      mutateSnapshot(snapshot) {
        return {
          ...snapshot,
          schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
          phase: 'RESOURCE_PREPARATION',
          documentStep: undefined,
        }
      },
    })
    workspace = fixture.workspacePath

    await expect(fixture.recover()).rejects.toMatchObject({
      code: 'recovery_checkpoint_conflict',
    })

    expect(fixture.started).toHaveLength(0)
    expect(
      (await fixture.store.readEvents()).filter(
        event => event.type === 'workflow.unit.accepted',
      ),
    ).toHaveLength(0)
  })

  test('rejects a matching canonical receipt when the raw dispatch identity is incomplete', async () => {
    const fixture = await createCanonicalReceiptRecoveryFixture({
      mutateSnapshot(snapshot) {
        const activeDispatch = snapshot.activeDispatch as Record<
          string,
          unknown
        >
        return {
          ...snapshot,
          activeDispatch: { ...activeDispatch, taskId: undefined },
        }
      },
    })
    workspace = fixture.workspacePath

    await expect(fixture.recover()).rejects.toMatchObject({
      code: 'recovery_checkpoint_conflict',
    })

    expect(fixture.started).toHaveLength(0)
    expect(
      (await fixture.store.readEvents()).filter(
        event => event.type === 'workflow.unit.accepted',
      ),
    ).toHaveLength(0)
  })

  test('reconciles an invalid current snapshots active Resource Content receipt before projection', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    const dispatchId = 'committed-resource-content-dispatch'
    const inventoryReceipt =
      fixture.snapshot.resourceProductionState.inventoryReceipt
    const commitContract = {
      dispatchId,
      inventoryRevision: inventoryReceipt.revision,
      baselineResourceRevision: await computeResourceRevision(workspace, ''),
      requiredRequirementIds: ['fixture-requirement'],
      verifiedResourceIds: ['fixture-resource'],
      inventoryBindings: inventoryReceipt.bindings,
      writablePaths: ['assets/content/resource-registry.json'],
    }
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: commitContract,
      assertMutationAuthority: () => undefined,
    }) as { call(input: unknown): Promise<unknown> }
    await tool.call({
      action: 'commit',
      documents: {
        'assets/content/resource-registry.json': {
          schema: 'beegame-content-v1',
          id: 'resource-registry',
          kind: 'resource-registry',
          fulfills: ['fixture-requirement'],
          resources: ['fixture-resource'],
          data: {
            bindings: [
              {
                requirementId: 'fixture-requirement',
                resourceIds: ['fixture-resource'],
              },
            ],
          },
        },
      },
    })
    const retainedEvents = (await fixture.store.readEvents()).filter(
      event =>
        event.type !== 'workflow.unit.accepted' ||
        !['resource:content', 'resource:gate'].includes(
          (event.unit as AcceptedWorkflowUnit).unitId,
        ),
    )
    await writeFile(
      fixture.store.paths.events,
      `${retainedEvents.map(event => JSON.stringify(event)).join('\n')}\n`,
    )
    const request: WorkerDispatchRequest = {
      dispatchId,
      runId: RECOVERY_RUN_ID,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      workspacePath: workspace,
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      taskId: 'RESOURCE_CONTENT',
      revision: fixture.snapshot.revision.document,
      contract: {
        ...commitContract,
        task: 'RESOURCE_CONTENT',
      },
    }
    await writeFile(
      fixture.store.paths.snapshot,
      `${JSON.stringify(
        {
          ...fixture.snapshot,
          schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
          invalidRecoveryMarker: true,
          phase: 'RESOURCE_PREPARATION',
          documentStep: undefined,
          currentItemId: undefined,
          evidence: {},
          resourceProductionState: {
            currentTask: 'RESOURCE_CONTENT',
            inventoryReceipt,
          },
          activeDispatch: {
            dispatchId,
            workerType: 'resource-content-author',
            phase: 'RESOURCE_PREPARATION',
            taskId: 'RESOURCE_CONTENT',
            revision: request.revision,
            status: 'running',
            startedAt: RECOVERY_ACCEPTED_AT,
            request,
          },
        },
        null,
        2,
      )}\n`,
    )
    const started: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: RECOVERY_OWNER_ID,
      workerPort: {
        async start(nextRequest) {
          started.push(nextRequest)
          return {
            sessionId: nextRequest.dispatchId!,
            dispatchId: nextRequest.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    const recovered = await recoverAndResumeRun({
      store: fixture.store,
      workspacePath: workspace,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      confirmedBriefContext: RECOVERY_BRIEF,
      stopWorkspaceWorkers: async () => undefined,
      resumeCurrentRun: run => controller.resume(run),
    })

    expect(
      recovered.resourceProductionState.contentReceipt?.contentDigest,
    ).toBe(await computeResourceContentDigest(workspace))
    expect(
      started.some(request => request.workerType === 'resource-content-author'),
    ).toBe(false)
    expect(
      (await fixture.store.readEvents()).filter(
        event =>
          event.type === 'workflow.unit.accepted' &&
          (event.unit as AcceptedWorkflowUnit).unitId === 'resource:content',
      ),
    ).toHaveLength(1)
  })

  test('recovers and consumes a committed resource content dispatch without redispatching the author', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-receipt-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-resource-receipt',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['dat', 'json'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [
        {
          id: 'world.visual',
          required: true,
          acquisition_profile: TEST_ACQUISITION_PROFILE,
        },
      ],
      resources: [],
    })
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/world.dat'), 'world')
    await registerBeeGameAuthoredResources(workspace, [
      {
        id: 'world-resource',
        root_path: 'assets/runtime/world.dat',
        file_paths: ['assets/runtime/world.dat'],
        provisional: true,
        reason: 'Durable recovery fixture.',
        selection_reason: ['Exercises retry reconciliation.'],
        asset_kind: 'data',
      },
    ])
    const commitContract = {
      dispatchId: 'resource-content-dispatch',
      inventoryRevision: await computeResourceInventoryRevision(workspace),
      baselineResourceRevision: await computeResourceRevision(workspace, ''),
      requiredRequirementIds: ['world.visual'],
      verifiedResourceIds: ['world-resource'],
      inventoryBindings: [
        {
          requirementId: 'world.visual',
          resourceIds: ['world-resource'],
        },
      ],
      writablePaths: ['assets/content/resource-registry.json'],
    }
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: commitContract,
      assertMutationAuthority: () => undefined,
    }) as { call(input: unknown): Promise<unknown> }
    await tool.call({
      action: 'commit',
      documents: {
        'assets/content/resource-registry.json': {
          schema: 'beegame-content-v1',
          id: 'resource-registry',
          kind: 'resource-registry',
          fulfills: ['world.visual'],
          resources: ['world-resource'],
          data: {
            bindings: [
              {
                requirementId: 'world.visual',
                resourceIds: ['world-resource'],
              },
            ],
          },
        },
      },
    })
    const request: WorkerDispatchRequest = {
      dispatchId: commitContract.dispatchId,
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {
        ...commitContract,
      },
    }
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      status: 'failed',
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT',
      },
      activeDispatch: {
        dispatchId: commitContract.dispatchId,
        workerType: 'resource-content-author',
        phase: 'RESOURCE_PREPARATION',
        revision: request.revision,
        status: 'failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        failureReason: 'transport result mapping failed',
        request,
      },
      blockedReason: 'transport result mapping failed',
    })

    const retried = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(retried.status).toBe('running')
    expect(retried.activeDispatch).toMatchObject({
      dispatchId: commitContract.dispatchId,
      status: 'completed',
      terminalResult: {
        workerType: 'resource-content-author',
        status: 'completed',
        contentIds: ['resource-registry'],
        writtenPaths: ['assets/content/resource-registry.json'],
      },
    })

    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: initial.ownerId,
      workerPort: {
        async start(nextRequest) {
          return {
            sessionId: 'recovery-next-session',
            dispatchId: nextRequest.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.resume(retried)

    const progressed = await store.load()
    expect(progressed?.activeDispatch?.dispatchId).not.toBe(
      commitContract.dispatchId,
    )
    expect(progressed?.activeDispatch?.failureReason).toBeUndefined()
  }, 2_000)

  test('treats a duplicate retry for an already resumed run as idempotent', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-retry-idempotent-'))
    const store = createRunStore(workspace, 'owner-1')
    const running = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save(running)

    const duplicate = await retryRun({ store, runId: running.runId })

    expect(duplicate).toMatchObject({
      runId: running.runId,
      phase: running.phase,
      status: 'running',
      revision: running.revision,
      createdAt: running.createdAt,
    })
    expect(
      (await store.readEvents()).some(
        event => event.type === 'run.retry_requested',
      ),
    ).toBe(false)
  })

  test('rejects late progress from a terminal dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-terminal-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const terminalAt = '2026-01-01T00:30:00.000Z'
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'needs_action',
      thinking: 'idle',
      lastProgressAt: terminalAt,
      activeDispatch: {
        dispatchId: 'author-dispatch',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'interrupted',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: terminalAt,
        failureReason: 'worker transport was interrupted',
      },
    })

    await store.updateProgress(initial.runId, {
      dispatchId: 'author-dispatch',
      thinking: 'working',
      message: 'late thinking event',
      durable: true,
    })

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      thinking: 'idle',
      lastProgressAt: terminalAt,
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('rejects an obsolete snapshot version before nested schema validation', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-obsolete-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-obsolete',
      projectId: 'project-obsolete',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const obsoleteVersion = 21
    const obsoleteSnapshot = JSON.stringify({
      ...initial,
      schemaVersion: obsoleteVersion,
      activeDispatch: {
        retiredStateMarker: true,
      },
    })
    await writeFile(store.paths.snapshot, obsoleteSnapshot, 'utf8')

    await expect(store.load()).rejects.toMatchObject({
      code: 'obsolete',
      message: `unsupported workflow snapshot schema version ${obsoleteVersion}; current version is ${DELIVERY_RUN_SCHEMA_VERSION}`,
    })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(obsoleteSnapshot)
  })

  test('migrates schema 22 without retaining executable specialist roles', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-schema-22-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-22',
      projectId: 'project-schema-22',
      ownerId: 'owner-1',
    })
    const preservedEvidence = {
      implementationAudit: {
        path: '.beegame/evidence/implementation.json',
        kind: 'implementation_audit' as const,
        revision: 'a'.repeat(64),
        status: 'passed' as const,
        observedAt: '2026-08-17T00:00:00.000Z',
      },
    }
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...initial,
          schemaVersion: 22,
          phase: 'DOCUMENT_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          status: 'running',
          evidence: preservedEvidence,
          foundationReviewState: {
            revision: 'a'.repeat(64),
            mode: 'initial',
            attempt: 1,
            status: 'running',
            reports: [
              { role: 'contract-specialist', status: 'running' },
              { role: 'integration-specialist', status: 'pending' },
              { role: 'final', status: 'pending' },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      evidence: preservedEvidence,
      tasks: initial.tasks,
      foundationDraftState: initial.foundationDraftState,
      resourceProductionState: initial.resourceProductionState,
    })
    expect(migrated).not.toHaveProperty('foundationReviewState')
    expect(
      JSON.parse(await readFile(store.paths.snapshot, 'utf8')),
    ).toMatchObject({ schemaVersion: DELIVERY_RUN_SCHEMA_VERSION })
  })

  test('migrates the schema 23 single verification worker into three lanes and synthesis', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-storage-schema-23-review-'),
    )
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-23-review',
      projectId: 'project-schema-23-review',
      ownerId: 'owner-1',
    })
    const revision = 'a'.repeat(64)
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...initial,
          schemaVersion: 23,
          phase: 'DOCUMENT_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          status: 'needs_action',
          blockedReason: 'single verification failed after context compaction',
          foundationReviewState: {
            revision,
            mode: 'verification',
            attempt: 2,
            status: 'failed',
            priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
            priorReviewDigest: 'b'.repeat(64),
            reports: [
              {
                role: 'verification',
                path: `.beegame/reviews/foundation/${revision}/review.json`,
                status: 'failed',
                failureReason: 'schema drift',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      status: 'running',
      foundationReviewState: {
        mode: 'verification',
        status: 'running',
        reports: [
          { role: 'core-design', status: 'pending' },
          { role: 'technical-assets', status: 'pending' },
          { role: 'presentation', status: 'pending' },
          { role: 'synthesis', status: 'pending' },
        ],
      },
    })
    expect(migrated?.blockedReason).toBeUndefined()
  })

  test('migrates schema 24 remediation state without inventing a mutation baseline', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-schema-24-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-24',
      projectId: 'project-schema-24',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify({ ...initial, schemaVersion: 24 }, null, 2)}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated?.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(
      JSON.parse(await readFile(store.paths.snapshot, 'utf8')),
    ).toMatchObject({ schemaVersion: DELIVERY_RUN_SCHEMA_VERSION })
  })

  test('migrates schema 25 role remediation into single-document writers', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-schema-25-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-25',
      projectId: 'project-schema-25',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...initial,
          schemaVersion: 25,
          phase: 'DOCUMENT_DRAFTING',
          foundationRemediationState: {
            reviewPath: '.beegame/reviews/foundation/revision/review.json',
            reviewDigest: 'b'.repeat(64),
            sourceRevision: 'a'.repeat(64),
            lanes: [
              {
                id: 'core-design',
                ownedPaths: [
                  'docs/GDD.md',
                  'docs/LEVEL_SCENE_DESIGN.md',
                  'docs/BALANCE_DESIGN.md',
                ],
                affectedPaths: ['docs/GDD.md'],
                status: 'pending',
              },
              {
                id: 'technical-assets',
                ownedPaths: ['docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
                affectedPaths: ['docs/TECHNICAL_DESIGN.md'],
                status: 'pending',
              },
              {
                id: 'presentation',
                ownedPaths: [
                  'docs/ART_DIRECTION.md',
                  'docs/UI_UX_SPEC.md',
                  'docs/AUDIO_DESIGN.md',
                ],
                affectedPaths: ['docs/UI_UX_SPEC.md'],
                status: 'pending',
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated?.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(
      migrated?.foundationRemediationState?.lanes.map(lane => [
        lane.id,
        lane.status,
      ]),
    ).toEqual([
      ['gdd', 'pending'],
      ['level-scene-design', 'not_required'],
      ['balance-design', 'not_required'],
      ['technical-design', 'pending'],
      ['art-direction', 'not_required'],
      ['ui-ux-spec', 'pending'],
      ['audio-design', 'not_required'],
      ['asset-plan', 'not_required'],
    ])
  })

  test('fails closed when schema 26 remediation receipts cannot prove body-unit transactions', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-schema-26-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-26',
      projectId: 'project-schema-26',
      ownerId: 'owner-1',
    })
    const dispatch = (laneId: string, path: string, failureReason?: string) => ({
      dispatchId: `dispatch-${laneId}`,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: `foundation-remediation:${laneId}`,
      revision: 'a'.repeat(64),
      status: failureReason ? 'failed' : 'completed',
      startedAt: '2026-08-16T00:00:00.000Z',
      ...(failureReason ? { failureReason } : {}),
      request: {
        dispatchId: `dispatch-${laneId}`,
        runId: initial.runId,
        ownerId: initial.ownerId,
        projectId: initial.projectId,
        workspacePath: workspace,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: `foundation-remediation:${laneId}`,
        revision: 'a'.repeat(64),
        allowedPaths: [path],
        contract: {
          authoringMode: 'remediation',
          previousDocumentDigests: { [path]: 'c'.repeat(64) },
        },
      },
    })
    const legacyLanes = FOUNDATION_REMEDIATION_LANES.map(lane => {
      if (lane.id !== 'gdd' && lane.id !== 'ui-ux-spec')
        return {
          id: lane.id,
          ownedPaths: [...lane.ownedPaths],
          affectedPaths: [],
          status: 'not_required',
        }
      const path = lane.ownedPaths[0]
      const failed = lane.id === 'ui-ux-spec'
      return {
        id: lane.id,
        ownedPaths: [...lane.ownedPaths],
        affectedPaths: [path],
        status: failed ? 'failed' : 'completed',
        baselineDigests: { [path]: 'c'.repeat(64) },
        dispatch: dispatch(
          lane.id,
          path,
          failed ? 'provider disconnected' : undefined,
        ),
        ...(failed
          ? { failureReason: 'provider disconnected' }
          : {
              receipt: {
                reviewDigest: 'b'.repeat(64),
                sourceRevision: 'a'.repeat(64),
                ownedPaths: [path],
                beforeDigests: { [path]: 'c'.repeat(64) },
                afterDigests: { [path]: 'd'.repeat(64) },
                committedAt: '2026-08-16T00:01:00.000Z',
              },
            }),
      }
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...initial,
          schemaVersion: 26,
          phase: 'DOCUMENT_DRAFTING',
          activeDispatch: dispatch('gdd', 'docs/GDD.md'),
          foundationRemediationState: {
            reviewPath: '.beegame/reviews/foundation/revision/review.json',
            reviewDigest: 'b'.repeat(64),
            sourceRevision: 'a'.repeat(64),
            lanes: legacyLanes,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated?.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(migrated?.activeDispatch).toBeUndefined()
    expect(migrated?.foundationRemediationState?.lanes[0]).toMatchObject({
      status: 'failed',
      sourceDigest: 'c'.repeat(64),
      failureReason: 'legacy remediation transaction must be restarted',
    })
    expect(migrated?.foundationRemediationState?.lanes[5]).toMatchObject({
      status: 'failed',
      sourceDigest: 'c'.repeat(64),
      failureReason: 'provider disconnected',
    })
    expect(migrated?.foundationRemediationState?.lanes[0]?.receipt).toBeUndefined()
  })

  test('drops historical schema 26 remediation state after Foundation review', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-schema-26-late-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-26-late',
      projectId: 'project-schema-26-late',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify({
        ...initial,
        schemaVersion: 26,
        phase: 'RESOURCE_PREPARATION',
        foundationRemediationState: { legacy: true },
      })}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated?.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(migrated?.foundationRemediationState).toBeUndefined()
  })

  test('preserves a completed schema 22 delivery without retaining old review roles', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-storage-schema-22-complete-'),
    )
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-schema-22-complete',
      projectId: 'project-schema-22-complete',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...initial,
          schemaVersion: 22,
          phase: 'DELIVERY',
          documentStep: undefined,
          status: 'completed',
          completedAt: '2026-08-17T00:00:00.000Z',
          foundationReviewState: {
            revision: 'a'.repeat(64),
            mode: 'initial',
            attempt: 1,
            status: 'completed',
            reports: [
              { role: 'contract-specialist', status: 'completed' },
              { role: 'integration-specialist', status: 'completed' },
              { role: 'final', status: 'completed' },
            ],
            verdict: 'READY',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const migrated = await store.load()

    expect(migrated).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      phase: 'DELIVERY',
      status: 'completed',
      completedAt: '2026-08-17T00:00:00.000Z',
    })
    expect(migrated).not.toHaveProperty('foundationReviewState')
  })

  test.each([
    ['missing', undefined],
    ['string', String(DELIVERY_RUN_SCHEMA_VERSION)],
    ['non-integer', DELIVERY_RUN_SCHEMA_VERSION + 0.5],
  ])('rejects a %s schema version before exact recovery', async (_label, schemaVersion) => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    const snapshot = JSON.parse(
      await readFile(fixture.store.paths.snapshot, 'utf8'),
    ) as Record<string, unknown>
    if (schemaVersion === undefined) delete snapshot.schemaVersion
    else snapshot.schemaVersion = schemaVersion
    await writeFile(
      fixture.store.paths.snapshot,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )

    let resumed = false
    await expect(
      recoverAndResumeRun({
        store: fixture.store,
        workspacePath: fixture.workspacePath,
        ownerId: RECOVERY_OWNER_ID,
        projectId: RECOVERY_PROJECT_ID,
        confirmedBriefContext: RECOVERY_BRIEF,
        stopWorkspaceWorkers: async () => undefined,
        resumeCurrentRun: async () => {
          resumed = true
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(resumed).toBe(false)
  })

  test('stale worker usage does not migrate or rewrite a version-11 snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stale-usage-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'stale-usage-run',
      projectId: 'stale-usage-project',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const snapshot = JSON.stringify({
      ...initial,
      schemaVersion: 11,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      activeDispatch: {
        dispatchId: 'stale-usage-dispatch',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'running',
        startedAt: '2026-08-05T00:00:00.000Z',
      },
    })
    await writeFile(store.paths.snapshot, snapshot, 'utf8')

    await expect(
      store.addWorkflowUsage(
        initial.runId,
        {
          input_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          completion_tokens: 0,
          total_tokens: 1,
        },
        'stale-usage-dispatch',
      ),
    ).rejects.toMatchObject({ code: 'obsolete' })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
  })

  test('stale worker progress does not migrate or rewrite a version-11 snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stale-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'stale-progress-run',
      projectId: 'stale-progress-project',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const snapshot = JSON.stringify({
      ...initial,
      schemaVersion: 11,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      activeDispatch: {
        dispatchId: 'stale-progress-dispatch',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'running',
        startedAt: '2026-08-05T00:00:00.000Z',
      },
    })
    await writeFile(store.paths.snapshot, snapshot, 'utf8')

    await expect(
      store.updateProgress(initial.runId, {
        dispatchId: 'stale-progress-dispatch',
        message: 'stale worker progress',
        durable: true,
      }),
    ).rejects.toMatchObject({ code: 'obsolete' })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
  })

  test('ordinary workflow commits do not migrate or rewrite a version-11 snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stale-commit-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'stale-commit-run',
      projectId: 'stale-commit-project',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const snapshot = JSON.stringify({ ...initial, schemaVersion: 11 })
    await writeFile(store.paths.snapshot, snapshot, 'utf8')

    await expect(
      store.commit(initial, {
        runId: initial.runId,
        type: 'workflow.progress',
        phase: initial.phase,
        status: initial.status,
        revision: initial.revision,
      }),
    ).rejects.toMatchObject({ code: 'obsolete' })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshot)
  })

  test('does not allow an older server to load a newer snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-newer-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-newer',
      projectId: 'project-newer',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      JSON.stringify({
        ...initial,
        schemaVersion: DELIVERY_RUN_SCHEMA_VERSION + 1,
      }),
      'utf8',
    )

    await expect(store.load()).rejects.toMatchObject({ code: 'invalid' })
  })

  test('does not overwrite a genuinely invalid workflow snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-invalid-'))
    const store = createRunStore(workspace, 'owner-1')
    await mkdir(store.paths.directory, { recursive: true })
    const invalidSnapshot = '{"schemaVersion":1'
    await writeFile(store.paths.snapshot, invalidSnapshot, 'utf8')

    await expect(store.load()).rejects.toThrow(
      'workflow snapshot JSON is invalid',
    )
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(invalidSnapshot)
    expect(await store.readEvents()).toEqual([])
  })

  test('marks an orphaned running worker interrupted and makes the run retryable', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-restart-recovery-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    const interrupted = await reconcileRunOnStartup({
      store,
      sessionIsOpen: async () => false,
    })
    expect(interrupted).toMatchObject({
      status: 'stopped',
      thinking: 'idle',
      activeDispatch: { status: 'interrupted' },
    })

    const retried = await retryRun({ store, runId: initial.runId })
    expect(retried).toMatchObject({
      status: 'running',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    expect(retried.activeDispatch).toBeUndefined()
  })

  test('stopping implementation releases the interrupted task so continue can dispatch it again', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stop-implementation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/main.ts'],
      verification: [
        {
          kind: 'build' as const,
          commandOrAction: 'bun run build',
          expectedResult: 'Build exits successfully',
        },
      ],
      status: 'running' as const,
      attempt: 1,
      startedRevision: initial.revision.workspace,
      evidenceRefs: [],
    }
    await store.save({
      ...initial,
      phase: 'IMPLEMENTATION',
      currentMessage: 'Preparing a file edit…',
      activeTaskId: task.id,
      tasks: [task],
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'implementation-worker',
        phase: 'IMPLEMENTATION',
        taskId: task.id,
        revision: initial.revision.workspace,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    let lateUsageResult: DeliveryRun | null | undefined
    const stoppedTailUsage = {
      input_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      completion_tokens: 0,
      total_tokens: 1,
    }
    const stopped = await stopRun({
      store,
      runId: initial.runId,
      reason: 'user stopped workflow',
      sessionIsOpen: async () => true,
      stopDispatch: async () => {
        lateUsageResult = await store.addWorkflowUsage(
          initial.runId,
          stoppedTailUsage,
          'dispatch-1',
        )
      },
    })

    expect(stopped).toMatchObject({
      status: 'stopped',
      activeDispatch: { status: 'interrupted' },
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(stopped.currentMessage).toBeUndefined()
    expect(stopped.activeTaskId).toBeUndefined()
    expect(lateUsageResult).toMatchObject({
      status: 'stopped',
      usage: { total_tokens: 1 },
    })
    expect(
      await store.addWorkflowUsage(
        initial.runId,
        stoppedTailUsage,
        'dispatch-stale',
      ),
    ).toBeNull()

    const continued = await retryRun({ store, runId: initial.runId })
    expect(continued).toMatchObject({
      status: 'running',
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(continued.activeTaskId).toBeUndefined()
    expect(continued.activeDispatch).toBeUndefined()
  })

  test('continue repairs an implementation snapshot stopped before active-task release was persisted', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-continue-repair-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/main.ts'],
      verification: [
        {
          kind: 'build' as const,
          commandOrAction: 'bun run build',
          expectedResult: 'Build exits successfully',
        },
      ],
      status: 'running' as const,
      attempt: 1,
      startedRevision: initial.revision.workspace,
      evidenceRefs: [],
    }
    await store.save({
      ...initial,
      phase: 'IMPLEMENTATION',
      status: 'stopped',
      activeTaskId: task.id,
      tasks: [task],
      blockedReason: 'user stopped workflow',
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'implementation-worker',
        phase: 'IMPLEMENTATION',
        taskId: task.id,
        revision: initial.revision.workspace,
        status: 'interrupted',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    })

    const continued = await retryRun({ store, runId: initial.runId })

    expect(continued).toMatchObject({
      status: 'running',
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(continued.activeTaskId).toBeUndefined()
    expect(continued.activeDispatch).toBeUndefined()
  })

  test('resumes failed Resource Production without creating a repair contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    const failed = {
      ...initial,
      phase: 'RESOURCE_PREPARATION' as const,
      status: 'needs_action' as const,
      blockedReason: 'canonical resource contract failed',
      evidence: {
        resourcePreparation: {
          path: '.beegame/workflow/evidence/resource.md',
          kind: 'resource_preparation' as const,
          revision: 'resource-revision',
          status: 'failed' as const,
          observedAt: new Date().toISOString(),
        },
      },
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'resource-curator' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        revision: initial.revision.document,
        status: 'failed' as const,
        terminalResult: {
          resourceIds: ['resource-1'],
          contentIds: ['content-1'],
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    }
    await store.save(failed)

    const retried = await retryRun({ store, runId: failed.runId })

    expect(retried).toMatchObject({ status: 'running' })
  })

  test('retries a failed Resource Inventory from its durable cursor', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-inventory-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      status: 'failed',
      blockedReason: 'resource inventory worker failed before commit',
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
      activeDispatch: {
        dispatchId: 'dispatch-inventory',
        workerType: 'resource-curator',
        phase: 'RESOURCE_PREPARATION',
        taskId: 'RESOURCE_INVENTORY',
        revision: initial.revision.document,
        status: 'failed',
        failureReason: 'resource inventory worker failed before commit',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    })

    const retried = await retryRun({ store, runId: initial.runId })

    expect(retried).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    })
    expect(retried.activeDispatch).toBeUndefined()
  })

  test('starts retry idle timing from the new dispatch instead of stale run progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      lastProgressAt: '2020-01-01T00:00:00.000Z',
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    const dispatch = await dispatcher.dispatch({
      dispatchId: 'request-placeholder',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    const running = await store.load()

    expect(running?.status).toBe('running')
    expect(running?.activeDispatch?.dispatchId).toBe(dispatch.dispatchId)
    expect(running?.lastProgressAt).toBe(dispatch.startedAt)
  })

  test('keeps one durable dispatch slot per parallel foundation document', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-parallel-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-foundation-parallel',
      projectId: 'project-foundation-parallel',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      foundationDraftComplete: false,
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      foundationDraftState: beginParallelFoundationAuthoring(['docs/GDD.md']),
    })
    const started: string[] = []
    const closed: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request.taskId!)
          return {
            sessionId: `session:${request.taskId}`,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async close(dispatchId) {
          closed.push(dispatchId)
        },
        async status() {
          throw new Error('not used')
        },
      },
    })
    const paths = CANONICAL_FOUNDATION_DOCUMENTS.slice(1)
    const records = []
    for (const path of paths) {
      records.push(
        await dispatcher.dispatch({
          runId: initial.runId,
          ownerId: initial.ownerId,
          projectId: initial.projectId,
          workspacePath: workspace,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: path,
          revision: initial.revision.document,
          allowedPaths: [path],
          contract: {
            authoringMode: 'parallel-draft',
            documentSet: 'foundation',
            foundationDocumentPath: path,
          },
        }),
      )
    }

    expect(started).toEqual(paths)
    expect((await store.load())?.activeDispatch).toBeUndefined()
    expect(
      (await store.load())?.foundationDraftState.documents
        ?.slice(1)
        .map(document => document.dispatch?.status),
    ).toEqual(paths.map(() => 'running'))

    const parallelUsage = {
      input_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      completion_tokens: 0,
      total_tokens: 1,
    }
    expect(
      await store.addWorkflowUsage(
        initial.runId,
        parallelUsage,
        records[0]!.dispatchId,
      ),
    ).not.toBeNull()
    expect(
      await store.addWorkflowUsage(
        initial.runId,
        parallelUsage,
        records[1]!.dispatchId,
      ),
    ).not.toBeNull()
    expect((await store.load())?.usage?.total_tokens).toBe(2)

    const duplicate = await dispatcher.dispatch({
      ...records[0]!.request!,
      dispatchId: undefined,
    })
    expect(duplicate.dispatchId).toBe(records[0]!.dispatchId)
    await expect(
      dispatcher.dispatch({
        runId: initial.runId,
        ownerId: initial.ownerId,
        projectId: initial.projectId,
        workspacePath: workspace,
        workerType: 'question-answerer',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        contract: {},
      }),
    ).rejects.toThrow('foundation document authoring batch is active')

    for (const [index, record] of [...records].reverse().entries()) {
      const path = record.taskId as (typeof paths)[number]
      await dispatcher.completeDispatch(record.dispatchId, {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [path],
        resolvedFindingIds: [],
      })
      if (index === 0)
        await expect(
          dispatcher.completeDispatch(record.dispatchId, {
            workerType: 'document-author',
            status: 'completed',
            writtenPaths: [path],
            resolvedFindingIds: [],
          }),
        ).rejects.toThrow('dispatch is not active')
    }
    expect(closed).toHaveLength(paths.length)
  })

  test('keeps one durable dispatch slot per Foundation remediation lane', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-remediation-parallel-'))
    const store = createRunStore(workspace, 'owner-1')
    const revision = 'a'.repeat(64)
    const initial = createTestDeliveryRun({
      runId: 'run-remediation-parallel',
      projectId: 'project-remediation-parallel',
      ownerId: 'owner-1',
      documentRevision: revision,
    })
    const foundationRemediationState =
      createFoundationRemediationStateFromAuthority({
        reviewPath: `.beegame/reviews/foundation/${revision}/review.json`,
        reviewDigest: 'b'.repeat(64),
        sourceRevision: revision,
        affectedPaths: [
          'docs/GDD.md',
          'docs/TECHNICAL_DESIGN.md',
          'docs/UI_UX_SPEC.md',
        ],
      })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: undefined,
      foundationRemediationState,
    })
    const started: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request.taskId!)
          return {
            sessionId: `session:${request.taskId}`,
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

    for (const lane of foundationRemediationState.lanes.filter(
      candidate => candidate.status === 'pending',
    ))
      await dispatcher.dispatch({
        runId: initial.runId,
        ownerId: initial.ownerId,
        projectId: initial.projectId,
        workspacePath: workspace,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: `foundation-remediation:${lane.id}`,
        revision,
        allowedPaths: [...lane.affectedPaths],
        contract: {
          authoringMode: 'remediation',
          documentSet: 'foundation',
          remediation: {
            laneId: lane.id,
            reviewPath: foundationRemediationState.reviewPath,
            reviewDigest: foundationRemediationState.reviewDigest,
            sourceRevision: revision,
            affectedPaths: [...lane.affectedPaths],
            sourceDigest: 'c'.repeat(64),
          },
        },
      })

    expect(started).toEqual([
      'foundation-remediation:gdd',
      'foundation-remediation:technical-design',
      'foundation-remediation:ui-ux-spec',
    ])
    expect((await store.load())?.activeDispatch).toBeUndefined()
    expect(
      (await store.load())?.foundationRemediationState?.lanes.map(
        lane => lane.status,
      ),
    ).toEqual([
      'running',
      'not_required',
      'not_required',
      'running',
      'not_required',
      'running',
      'not_required',
      'not_required',
    ])

    const runningCoreLane = (await store.load())?.foundationRemediationState
      ?.lanes[0]
    const usageResult = await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 10,
        cache_read_tokens: 20,
        cache_creation_tokens: 0,
        completion_tokens: 5,
        total_tokens: 35,
      },
      runningCoreLane!.dispatch!.dispatchId,
    )
    expect(usageResult?.usage?.total_tokens).toBe(35)
    expect(
      usageResult?.foundationRemediationState?.lanes[0]?.dispatch?.usage
        ?.total_tokens,
    ).toBe(35)
  })

  test('does not discard an interrupted remediation when its owned documents changed', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-remediation-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const reviewRevision = 'a'.repeat(64)
    const initial = createTestDeliveryRun({
      runId: 'run-remediation-retry',
      projectId: 'project-remediation-retry',
      ownerId: 'owner-1',
      documentRevision: reviewRevision,
    })
    const remediation = createFoundationRemediationStateFromAuthority({
      reviewPath: `.beegame/reviews/foundation/${reviewRevision}/review.json`,
      reviewDigest: 'b'.repeat(64),
      sourceRevision: reviewRevision,
      affectedPaths: ['docs/GDD.md'],
    })
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs/GDD.md'), '# partially repaired\n')
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: undefined,
      status: 'stopped',
      blockedReason: 'user stopped workflow',
      foundationReviewState: createFoundationReviewState({
        mode: 'initial',
        revision: reviewRevision,
      }),
      foundationRemediationState: remediation,
    })

    const resumed = await resumeRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(resumed.phase).toBe('DOCUMENT_DRAFTING')
    expect(resumed.foundationRemediationState?.reviewDigest).toBe(
      remediation.reviewDigest,
    )
    expect(resumed.foundationReviewState?.revision).toBe(reviewRevision)
  })

  test('waits for every required remediation receipt before Foundation verification', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-remediation-barrier-'))
    await mkdir(join(workspace, 'docs'), { recursive: true })
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
      await writeFile(join(workspace, path), matrixCompleteDocument(path))
    const revision = 'a'.repeat(64)
    const reviewPath = `.beegame/reviews/foundation/${revision}/review.json`
    const reviewBytes = `${JSON.stringify({
      version: 2,
      scope: 'foundation',
      revision,
      verdict: 'NEEDS_REVISION',
      priorConflictStatus: [],
      conflicts: [
        {
          id: 'B1',
          title: 'Lane authority mismatch',
          problem: 'Core design and presentation disagree.',
          evidence: [
            {
              path: 'docs/GDD.md',
              location: 'Core loop',
              observed: 'The terms differ.',
            },
          ],
          requiredOutcome: 'Use one term.',
          changes: [
            { path: 'docs/GDD.md', action: 'Use the shared term.' },
            { path: 'docs/UI_UX_SPEC.md', action: 'Use the shared term.' },
          ],
          acceptance: ['Both documents use the shared term.'],
        },
      ],
    })}\n`
    await mkdir(join(workspace, '.beegame/reviews/foundation', revision), {
      recursive: true,
    })
    await writeFile(join(workspace, reviewPath), reviewBytes)
    const reviewDigest = createHash('sha256').update(reviewBytes).digest('hex')
    let run: DeliveryRun = {
      ...createTestDeliveryRun({
        runId: 'run-remediation-barrier',
        projectId: 'project-remediation-barrier',
        ownerId: 'owner-1',
        documentRevision: revision,
      }),
      phase: 'DOCUMENT_DRAFTING',
      foundationRemediationState: createFoundationRemediationStateFromAuthority(
        {
          reviewPath,
          reviewDigest,
          sourceRevision: revision,
          affectedPaths: ['docs/GDD.md', 'docs/UI_UX_SPEC.md'],
        },
      ),
    }

    for (const laneId of ['gdd', 'ui-ux-spec'] as const) {
      const lane = run.foundationRemediationState!.lanes.find(
        candidate => candidate.id === laneId,
      )!
      const targetPath = lane.affectedPaths[0]!
      const sourceDigest = createHash('sha256')
        .update(await readFile(join(workspace, targetPath)))
        .digest('hex')
      const dispatch = {
        dispatchId: `dispatch-${laneId}`,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: `foundation-remediation:${laneId}`,
        revision,
        status: 'running' as const,
        startedAt: '2026-08-16T00:00:00.000Z',
        request: {
          runId: run.runId,
          ownerId: run.ownerId,
          projectId: run.projectId,
          workspacePath: workspace,
          workerType: 'document-author' as const,
          phase: 'DOCUMENT_DRAFTING' as const,
          taskId: `foundation-remediation:${laneId}`,
          revision,
          allowedPaths: [...lane.affectedPaths],
          contract: {
            authoringMode: 'remediation',
            remediation: {
              laneId,
              affectedPaths: [...lane.affectedPaths],
              sourceDigest,
            },
          },
        },
      }
      run = {
        ...run,
        activeDispatch: dispatch,
        foundationRemediationState: recordFoundationRemediationDispatch(
          run.foundationRemediationState!,
          laneId,
          dispatch,
        ),
      }
      for (const path of lane.affectedPaths)
        await writeFile(
          join(workspace, path),
          `${await readFile(join(workspace, path), 'utf8')}\n`,
        )
      const finalDigest = createHash('sha256')
        .update(await readFile(join(workspace, targetPath)))
        .digest('hex')
      const remediationReceipt = {
        reviewDigest,
        sourceRevision: revision,
        targetPath,
        sourceDigest,
        patchedUnitIds: ['section:authority'],
        finalDigest,
        committedAt: '2026-08-16T00:01:00.000Z',
      }
      if (laneId === 'ui-ux-spec') {
        const siblingPath = join(workspace, 'docs/GDD.md')
        const stableSibling = await readFile(siblingPath)
        await writeFile(
          siblingPath,
          Buffer.concat([stableSibling, Buffer.from('\n')]),
        )
        await expect(
          completeFoundationRemediationLane({
            run,
            workspacePath: workspace,
            audit: () => ({ valid: true, issues: [] }),
            terminal: {
              workerType: 'document-author',
              status: 'completed',
              writtenPaths: [...lane.affectedPaths],
              remediationReceipt,
            },
          }),
        ).rejects.toThrow(
          'foundation remediation receipt no longer matches current bytes',
        )
        await writeFile(siblingPath, stableSibling)
      }
      run = await completeFoundationRemediationLane({
        run,
        workspacePath: workspace,
        audit: () => ({ valid: true, issues: [] }),
        terminal: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: [...lane.affectedPaths],
          remediationReceipt,
        },
      })
      if (laneId === 'gdd') {
        expect(run.phase).toBe('DOCUMENT_DRAFTING')
        expect(run.foundationRemediationState?.lanes[0]?.status).toBe(
          'completed',
        )
      }
    }

    expect(run.phase).toBe('DOCUMENT_REVIEW')
    expect(run.documentStep).toBe('FOUNDATION_REVIEW')
    expect(run.foundationRemediationState?.resultingRevision).toBe(
      run.revision.document,
    )
  })

  test('fails closed instead of dropping remediation lanes during damaged snapshot projection', () => {
    expect(() =>
      proveExactRawActiveUnitId({
        inspection: {
          rawText: '{}',
          digest: 'a'.repeat(64),
          parsedValue: {
            phase: 'DOCUMENT_DRAFTING',
            foundationRemediationState: { lanes: [] },
          },
        },
        workspacePath: '/workspace',
        ownerId: 'owner-1',
        projectId: 'project-1',
        confirmedBriefContext: 'confirmed brief',
      }),
    ).toThrow(
      'parallel Foundation remediation requires its intact persisted snapshot',
    )
  })

  test('isolates one invalid foundation terminal while another author keeps running', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-isolation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-foundation-isolation',
      projectId: 'project-foundation-isolation',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      foundationDraftComplete: false,
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      foundationDraftState: beginParallelFoundationAuthoring(['docs/GDD.md']),
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: `session:${request.taskId}`,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async close() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const dispatchFor = (path: FoundationDocumentPath) =>
      dispatcher.dispatch({
        runId: initial.runId,
        ownerId: initial.ownerId,
        projectId: initial.projectId,
        workspacePath: workspace,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: path,
        revision: initial.revision.document,
        allowedPaths: [path],
        contract: {
          authoringMode: 'parallel-draft',
          documentSet: 'foundation',
          foundationDocumentPath: path,
        },
      })
    const failed = await dispatchFor('docs/LEVEL_SCENE_DESIGN.md')
    const running = await dispatchFor('docs/BALANCE_DESIGN.md')

    await expect(
      dispatcher.completeDispatch(failed.dispatchId, {}),
    ).rejects.toThrow('invalid worker terminal result')
    const saved = await store.load()
    expect(saved?.status).toBe('running')
    expect(
      saved?.foundationDraftState.documents?.find(
        document => document.path === 'docs/LEVEL_SCENE_DESIGN.md',
      ),
    ).toMatchObject({
      status: 'needs_action',
      failureReason: expect.any(String),
    })
    expect(
      saved?.foundationDraftState.documents?.find(
        document => document.path === 'docs/BALANCE_DESIGN.md',
      )?.dispatch?.dispatchId,
    ).toBe(running.dispatchId)
  })

  test('pauses an orphaned parallel author instead of silently restarting it', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-foundation-orphan-'))
    const initial = createTestDeliveryRun({
      runId: 'run-foundation-orphan',
      projectId: 'project-foundation-orphan',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      foundationDraftComplete: false,
    })
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const request: WorkerDispatchRequest = {
      dispatchId: 'orphan-level',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: initial.revision.document,
      allowedPaths: [path],
      contract: {
        authoringMode: 'parallel-draft',
        foundationDocumentPath: path,
      },
    }
    const dispatch = {
      dispatchId: request.dispatchId!,
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: path,
      revision: request.revision,
      status: 'running' as const,
      request,
      startedAt: new Date().toISOString(),
    }
    const foundationDraftState = recordFoundationDispatch(
      beginParallelFoundationAuthoring(['docs/GDD.md']),
      path,
      'drafting',
      dispatch,
    )
    const run: DeliveryRun = {
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      foundationDraftState,
    }
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: initial.ownerId,
      workerPort: {
        async start() {
          throw new Error('must not silently start a replacement author')
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('native session is unavailable')
        },
      },
    })
    await controller.store.save(run)

    await controller.resume(run)

    expect(await controller.store.load()).toMatchObject({
      status: 'needs_action',
      foundationDraftState: {
        documents: expect.arrayContaining([
          expect.objectContaining({
            path,
            status: 'needs_action',
            failureReason: 'preserved native document session is unavailable',
          }),
        ]),
      },
    })
  })

  test('claims the first dispatch durably across independent dispatcher instances', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-cross-process-'))
    const firstStore = createRunStore(workspace, 'owner-1')
    const secondStore = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await firstStore.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const started: string[] = []
    const workerPort = {
      async start(request: WorkerDispatchRequest) {
        started.push(request.dispatchId!)
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
    }
    const first = createDeliveryDispatcher({ store: firstStore, workerPort })
    const second = createDeliveryDispatcher({ store: secondStore, workerPort })
    const request: WorkerDispatchRequest = {
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      allowedPaths: ['assets/', '.beegame/workflow/evidence/'],
      contract: {},
    }

    const [left, right] = await Promise.all([
      first.dispatch(request),
      second.dispatch(request),
    ])

    expect(right.dispatchId).toBe(left.dispatchId)
    expect(started).toEqual([left.dispatchId])
    expect((await firstStore.load())?.activeDispatch?.dispatchId).toBe(
      left.dispatchId,
    )
  })

  test('starts a fresh retry dispatch even while an explicitly stopped transport is still closing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-stale-key-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
    })
    const started: string[] = []
    let closeCalls = 0
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          const dispatchId = request.dispatchId ?? 'missing-dispatch-id'
          started.push(dispatchId)
          return { sessionId: dispatchId, dispatchId }
        },
        async submit() {},
        async stop() {},
        async close() {
          closeCalls += 1
          await new Promise<void>(() => undefined)
        },
        async status() {
          throw new Error('not used')
        },
      },
    })
    const request: WorkerDispatchRequest = {
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      allowedPaths: ['assets/', '.beegame/workflow/evidence/'],
      contract: {},
    }
    const first = await dispatcher.dispatch(request)

    await dispatcher.stop(first.dispatchId, 'operator stopped workflow')
    expect((await store.load())?.status).toBe('stopped')
    expect(closeCalls).toBe(1)

    const retried = await retryRun({ store, runId: initial.runId })
    expect(retried.activeDispatch).toBeUndefined()
    const second = await dispatcher.dispatch(request)

    expect(second.dispatchId).not.toBe(first.dispatchId)
    expect(started).toEqual([first.dispatchId, second.dispatchId])
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: {
        dispatchId: second.dispatchId,
        status: 'running',
      },
    })
  })

  test('does not submit a worker after its durable dispatch loses authority during start', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-start-fence-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    let submitCount = 0
    const stopped: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          const current = await store.load()
          await store.save({
            ...current!,
            status: 'stopped',
            blockedReason: 'operator stopped workflow',
            activeDispatch: {
              ...current!.activeDispatch!,
              status: 'interrupted',
              finishedAt: new Date().toISOString(),
            },
          })
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {
          submitCount += 1
        },
        async stop(dispatchId) {
          stopped.push(dispatchId)
        },
        async close() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    const dispatch = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })

    expect(dispatch.status).toBe('interrupted')
    expect(submitCount).toBe(0)
    expect(stopped).toEqual([dispatch.dispatchId])
  })

  test('accepts matching stopped tail usage and rejects superseded dispatches', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-usage-fence-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const startedAt = new Date().toISOString()
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      activeDispatch: {
        dispatchId: 'dispatch-current',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt,
      },
    })
    const delta = {
      input_tokens: 10,
      cache_read_tokens: 20,
      cache_creation_tokens: 0,
      completion_tokens: 5,
      total_tokens: 35,
    }

    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-stale')
    expect((await store.load())?.usage?.total_tokens ?? 0).toBe(0)

    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-current')
    expect((await store.load())?.usage?.total_tokens).toBe(35)

    const running = await store.load()
    await store.save({
      ...running!,
      status: 'stopped',
      activeDispatch: {
        ...running!.activeDispatch!,
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
      },
    })
    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-current')
    expect((await store.load())?.usage?.total_tokens).toBe(70)
  })

  test('persists usage for a running nested Reviewer role dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-usage-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-review-usage',
      projectId: 'project-review-usage',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      documentRevision: 'a'.repeat(64),
    })
    const reviewRun = createFoundationReviewState({
      mode: 'initial',
      revision: initial.revision.document,
      attempt: 1,
    })
    reviewRun.reports[0].status = 'running'
    reviewRun.reports[0].dispatch = {
      dispatchId: 'dispatch-review-role',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      foundationReviewState: reviewRun,
    })

    const persisted = await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 10,
        cache_read_tokens: 20,
        cache_creation_tokens: 0,
        completion_tokens: 5,
        total_tokens: 35,
      },
      'dispatch-review-role',
    )

    expect(persisted?.usage?.total_tokens).toBe(35)
  })

  test('explicit retry cannot reopen a completed Foundation verification', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-limit-retry-'))
    const ownerId = 'owner-review-limit-retry'
    const store = createRunStore(workspace, ownerId)
    const initial = createTestDeliveryRun({
      runId: 'run-review-limit-retry',
      projectId: 'project-review-limit-retry',
      ownerId,
    })
    const documentRevision = await computeDocumentRevision(
      workspace,
      initial.confirmedBriefDigest,
    )
    const priorReviewPath = `.beegame/reviews/foundation/${documentRevision}/prior-review.json`
    const review = createFoundationReviewState({
      mode: 'verification',
      revision: documentRevision,
      attempt: 3,
      priorReviewPath,
      priorReviewDigest: 'e'.repeat(64),
    })
    for (const report of review.reports.slice(0, 3)) {
      report.status = 'completed'
      report.digest = createHash('sha256').update(report.role).digest('hex')
    }
    const final = review.reports.find(report => report.role === 'synthesis')!
    const priorReviewDigest = 'e'.repeat(64)
    const finalBytes = foundationRecoveryReviewJson({
      revision: documentRevision,
      priorReviewDigest,
    })
    const finalDigest = createHash('sha256').update(finalBytes).digest('hex')
    await mkdir(join(workspace, final.path, '..'), { recursive: true })
    await writeFile(join(workspace, final.path), finalBytes)
    final.status = 'completed'
    final.digest = finalDigest
    review.status = 'completed'
    review.finalReportPath = final.path
    review.finalReportDigest = finalDigest
    review.verdict = 'NEEDS_REVISION'
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      revision: { ...initial.revision, document: documentRevision },
      blockedReason: 'Foundation verification still requires revision',
      foundationReviewState: review,
    })

    const retried = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(retried).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      status: 'needs_action',
      blockedReason: 'Foundation verification still requires revision',
    })
    expect(retried.foundationReviewState).toMatchObject({
      status: 'completed',
      verdict: 'NEEDS_REVISION',
      priorReviewDigest,
      attempt: 3,
    })
  })

  test('explicit retry resets only failed Foundation review work', () => {
    const initial = createTestDeliveryRun({
      runId: 'run-review-role-retry',
      projectId: 'project-review-role-retry',
      ownerId: 'owner-review-role-retry',
      documentRevision: 'a'.repeat(64),
    })
    const review = createFoundationReviewState({
      mode: 'initial',
      revision: 'a'.repeat(64),
    })
    review.status = 'failed'
    review.failureReason = 'technical-assets review failed'
    review.reports[0] = {
      ...review.reports[0],
      status: 'completed',
      digest: 'b'.repeat(64),
    }
    review.reports[1] = {
      ...review.reports[1],
      status: 'failed',
      failureReason: 'technical-assets review failed',
      dispatch: {
        dispatchId: 'technical-assets-failed',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        taskId: 'review:foundation:technical-assets:1',
        revision: 'a'.repeat(64),
        status: 'failed',
        startedAt: '2026-08-17T00:00:00.000Z',
        finishedAt: '2026-08-17T00:01:00.000Z',
        failureReason: 'technical-assets review failed',
      },
    }
    const retried = transitionDeliveryRun(
      {
        ...initial,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'needs_action',
        blockedReason: 'technical-assets review failed',
        foundationReviewState: review,
      },
      { type: 'retry' },
    )

    expect(retried.foundationReviewState?.reports).toEqual([
      expect.objectContaining({
        role: 'core-design',
        status: 'completed',
        digest: 'b'.repeat(64),
      }),
      expect.objectContaining({
        role: 'technical-assets',
        status: 'pending',
        dispatch: undefined,
        failureReason: undefined,
      }),
      expect.objectContaining({ role: 'presentation', status: 'pending' }),
      expect.objectContaining({ role: 'synthesis', status: 'pending' }),
    ])
  })

  test('does not let a stale snapshot move cumulative usage below the journal high water mark', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-usage-high-water-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const startedAt = new Date().toISOString()
    const running = await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      activeDispatch: {
        dispatchId: 'dispatch-current',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt,
      },
    })
    const highWater = {
      input_tokens: 100,
      cache_read_tokens: 200,
      cache_creation_tokens: 0,
      completion_tokens: 50,
      total_tokens: 350,
    }
    await store.addWorkflowUsage(initial.runId, highWater, 'dispatch-current')

    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify(
        {
          ...running,
          usage: {
            input_tokens: 10,
            cache_read_tokens: 20,
            cache_creation_tokens: 0,
            completion_tokens: 5,
            total_tokens: 35,
          },
        },
        null,
        2,
      )}\n`,
    )

    await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 1,
        cache_read_tokens: 2,
        cache_creation_tokens: 0,
        completion_tokens: 3,
        total_tokens: 6,
      },
      'dispatch-current',
    )

    expect((await store.load())?.usage).toEqual({
      input_tokens: 101,
      cache_read_tokens: 202,
      cache_creation_tokens: 0,
      completion_tokens: 53,
      total_tokens: 356,
    })
  })

  test('does not let display-only activity refresh durable progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-durable-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const durableAt = '2025-01-01T00:00:00.000Z'
    await store.save({ ...initial, lastProgressAt: durableAt })

    await store.updateProgress(initial.runId, {
      message: 'working',
      thinking: 'working',
      durable: false,
    })
    expect((await store.load())?.lastProgressAt).toBe(durableAt)

    await store.updateProgress(initial.runId, { durable: true })
    expect((await store.load())?.lastProgressAt).not.toBe(durableAt)
  })

  test('does not stop resource work because wall-clock time elapsed', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-wall-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    const dispatch = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
  })

  test('does not stop document work while a model turn remains active', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-submit-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'DOCUMENT_DRAFTING' })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: initial.revision.document,
      contract: { documentSet: 'foundation' },
    })

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
  })

  test('does not stop resource work because no mutation has occurred yet', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-no-mutation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
  })

  test('does not stop an active reviewer because wall-clock time elapsed', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-no-wall-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-review',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect((await store.load())?.status).toBe('running')
    expect((await store.load())?.blockedReason).toBeUndefined()
  })

  test('does not stop reviewer work when cumulative token usage increases', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-token-growth-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const baselineUsage = {
      input_tokens: 40,
      cache_read_tokens: 30,
      cache_creation_tokens: 20,
      completion_tokens: 10,
      total_tokens: 100,
    }
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      usage: baselineUsage,
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-review',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const dispatch = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })
    await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 0,
        cache_read_tokens: 50,
        cache_creation_tokens: 0,
        completion_tokens: 0,
        total_tokens: 50,
      },
      dispatch.dispatchId,
    )
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
    expect((await store.load())?.blockedReason).toBeUndefined()
  })

  test('uses worker and document lane identity in dispatch idempotency keys', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-identity-'))
    const store = createRunStore(workspace, 'owner-1')
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const shared = {
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: workspace,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: 'revision-1',
    }
    const reviewer = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-reviewer',
        contract: {
          reviewScope: 'foundation',
          reviewRole: 'core-design',
          attempt: 1,
        },
      },
      1,
    )
    const checklistAuthor = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-author',
        contract: { documentSet: 'checklist' },
      },
      1,
    )
    const finalReviewer = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-reviewer',
        contract: {
          reviewScope: 'foundation',
          reviewRole: 'synthesis',
          attempt: 1,
        },
      },
      1,
    )

    expect(checklistAuthor).not.toBe(reviewer)
    expect(finalReviewer).not.toBe(reviewer)
    expect(
      dispatcher.idempotencyKey(
        {
          ...shared,
          workerType: 'document-reviewer',
          contract: {
            reviewScope: 'foundation',
            reviewRole: 'technical-assets',
            attempt: 1,
          },
        },
        1,
      ),
    ).not.toBe(reviewer)
  })

  test('terminal emitted during transport stop drains through the real dispatcher commit and handler', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-terminal-drain-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-terminal-drain',
      projectId: 'project-1',
      ownerId: 'owner-1',
      foundationDraftComplete: false,
    })
    const path = CANONICAL_FOUNDATION_DOCUMENTS[0]
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      currentItemId: path,
    })
    let releaseTerminal!: () => void
    const terminalGate = new Promise<void>(resolve => {
      releaseTerminal = resolve
    })
    let terminalHandlerStarted!: () => void
    const handlerStarted = new Promise<void>(resolve => {
      terminalHandlerStarted = resolve
    })
    let releaseHandler!: () => void
    const handlerGate = new Promise<void>(resolve => {
      releaseHandler = resolve
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
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
        async waitForTerminal() {
          await terminalGate
          return {
            workerType: 'document-author',
            status: 'completed',
            writtenPaths: [path],
            resolvedFindingIds: [],
          }
        },
      },
      async onTerminal() {
        terminalHandlerStarted()
        await handlerGate
      },
    })
    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: initial.revision.document,
      allowedPaths: [path],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: path,
      },
    })
    let drained = false
    const drain = dispatcher.waitForTerminalReconciliation().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    const stopTransport = () => releaseTerminal()
    stopTransport()
    await handlerStarted
    expect((await store.load())?.activeDispatch?.status).toBe('completed')
    expect(drained).toBe(false)
    releaseHandler()
    await drain
    expect(drained).toBe(true)
  })

  test('converges identical reconstructed replacements on the committed winner', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-cas-'))
    const firstStore = createRunStore(workspace, 'owner-1')
    const secondStore = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await firstStore.save(initial)
    const expectedDigest = (await firstStore.inspectWorkflowSnapshot()).digest
    const replacement = {
      ...initial,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[0],
    }
    const replace = (store: typeof firstStore, eventId: string) =>
      store.replaceSnapshotIfDigest({
        expectedDigest,
        run: replacement,
        event: {
          eventId,
          runId: replacement.runId,
          type: 'workflow.run.reconstructed',
          phase: replacement.phase,
          status: replacement.status,
          revision: replacement.revision,
          createdAt: new Date().toISOString(),
          projectId: replacement.projectId,
          ownerId: replacement.ownerId,
          sourceSnapshotDigest: expectedDigest,
          replayedUnitIds: [],
          activeUnitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
        },
      })

    const results = await Promise.allSettled([
      replace(firstStore, 'reconstructed-a'),
      replace(secondStore, 'reconstructed-b'),
    ])

    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(
      0,
    )
    expect(
      (await firstStore.readEvents()).filter(
        event => event.type === 'workflow.run.reconstructed',
      ),
    ).toHaveLength(1)
  })

  test('requires the exact lock lease to release a successor lock', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-lock-lease-'))
    const store = createRunStore(workspace, 'owner-1')
    await store.save(
      createTestDeliveryRun({
        runId: 'run-1',
        projectId: 'project-1',
        ownerId: 'owner-1',
      }),
    )
    const first = await store.lock('run-1', async () => false)
    const successor = { ...first, leaseId: 'successor-lease' }
    await writeFile(store.paths.lock, `${JSON.stringify(successor)}\n`)

    await expect(store.lock('run-1', async () => false)).rejects.toMatchObject({
      code: 'locked',
    })
    await expect(store.unlock(first)).rejects.toMatchObject({
      code: 'ownership',
    })
    expect(JSON.parse(await readFile(store.paths.lock, 'utf8'))).toEqual(
      successor,
    )
    await expect(store.unlock(successor)).resolves.toBeUndefined()
  })

  test('reclaims a recovery lease only after its owner process is dead', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-dead-lease-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
    })
    await store.save(initial)
    await writeFile(
      store.paths.lock,
      `${JSON.stringify({
        ownerId: initial.ownerId,
        runId: initial.runId,
        leaseId: 'dead-process-lease',
        processId: 2_147_483_647,
        purpose: 'recovery',
        acquiredAt: initial.createdAt,
        heartbeatAt: initial.createdAt,
      })}\n`,
    )

    const lease = await store.lock(initial.runId, async () => false)
    expect(lease.processId).toBe(process.pid)
    await store.unlock(lease)
  })

  test('reclaims a dead recovery lease before a normal workflow read', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-dead-read-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
    })
    await store.save(initial)
    await writeFile(
      store.paths.lock,
      `${JSON.stringify({
        ownerId: initial.ownerId,
        runId: initial.runId,
        leaseId: 'dead-process-lease',
        processId: 2_147_483_647,
        purpose: 'recovery',
        acquiredAt: initial.createdAt,
        heartbeatAt: initial.createdAt,
      })}\n`,
    )

    await expect(store.load()).resolves.toMatchObject({ runId: initial.runId })
  })

  test('reloads the winner after acquiring the mutation lease', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-lock-reload-'))
    const store = createRunStore(workspace, 'owner-1')
    const competingStore = createRunStore(workspace, 'owner-1')
    const stopped = {
      ...createTestDeliveryRun({
        runId: 'run-1',
        projectId: 'project-1',
        ownerId: 'owner-1',
      }),
      status: 'stopped' as const,
      blockedReason: 'interrupted',
    }
    await store.save(stopped)
    let winnerCommitted = false
    const winner = {
      ...stopped,
      status: 'running' as const,
      blockedReason: undefined,
      currentMessage: 'winner already resumed',
    }
    const racedStore: typeof store = {
      ...store,
      lock: async (...args) => {
        if (!winnerCommitted) {
          winnerCommitted = true
          await competingStore.commit(winner, {
            runId: winner.runId,
            type: 'winner.resumed',
            phase: winner.phase,
            status: winner.status,
            revision: winner.revision,
          })
        }
        return store.lock(...args)
      },
    }

    await expect(
      retryRun({ store: racedStore, runId: stopped.runId }),
    ).resolves.toMatchObject({
      status: 'running',
      currentMessage: 'winner already resumed',
    })
    expect(
      (await store.readEvents()).filter(
        event => event.type === 'run.retry_requested',
      ),
    ).toHaveLength(0)
  })

  test('fences terminal snapshot writes for the complete recovery lease', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-write-fence-'))
    const store = createRunStore(workspace, 'owner-1')
    const competingStore = createRunStore(workspace, 'owner-1')
    const stopped = {
      ...createTestDeliveryRun({
        runId: 'run-1',
        projectId: 'project-1',
        ownerId: 'owner-1',
      }),
      status: 'stopped' as const,
      blockedReason: 'interrupted',
    }
    await store.save(stopped)
    let competingWrite: Promise<DeliveryRun> | undefined
    const racedStore: typeof store = {
      ...store,
      commit: async (...args) => {
        competingWrite ??= competingStore.commit(
          {
            ...stopped,
            status: 'failed',
            blockedReason: 'late terminal result',
          },
          {
            runId: stopped.runId,
            type: 'run.failed',
            phase: stopped.phase,
            status: 'failed',
            revision: stopped.revision,
            reason: 'late terminal result',
          },
        )
        await expect(competingWrite).rejects.toMatchObject({ code: 'locked' })
        return store.commit(...args)
      },
    }

    await expect(
      retryRun({ store: racedStore, runId: stopped.runId }),
    ).resolves.toMatchObject({ status: 'running' })
    await expect(store.load()).resolves.toMatchObject({ status: 'running' })
  })

  test('fences every snapshot mutation entry point while recovery owns the lease', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-all-writes-'))
    const store = createRunStore(workspace, 'owner-1')
    const competingStore = createRunStore(workspace, 'owner-1')
    const stopped = {
      ...createTestDeliveryRun({
        runId: 'run-1',
        projectId: 'project-1',
        ownerId: 'owner-1',
      }),
      status: 'stopped' as const,
      blockedReason: 'interrupted',
    }
    await store.save(stopped)
    const digest = (await store.inspectWorkflowSnapshot()).digest
    const lease = await store.lock(stopped.runId, async () => false)
    const progressEvent = {
      runId: stopped.runId,
      type: 'workflow.progress' as const,
      phase: stopped.phase,
      status: stopped.status,
      revision: stopped.revision,
    }
    const pendingLoad = competingStore.load()
    const mutations = [
      () => competingStore.save(stopped),
      () => competingStore.appendEvent(progressEvent),
      () => competingStore.commit(stopped, progressEvent),
      () =>
        competingStore.replaceSnapshotIfDigest({
          expectedDigest: digest,
          run: stopped,
          event: progressEvent,
        }),
      () =>
        competingStore.addWorkflowUsage(
          stopped.runId,
          {
            input_tokens: 1,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            completion_tokens: 0,
            total_tokens: 1,
          },
          'late-dispatch',
        ),
      () =>
        competingStore.updateProgress(stopped.runId, {
          dispatchId: 'late-dispatch',
          message: 'late progress',
        }),
    ]

    for (const mutate of mutations)
      await expect(mutate()).rejects.toMatchObject({ code: 'locked' })
    await store.unlock(lease)
    await expect(pendingLoad).resolves.toMatchObject({ status: 'stopped' })
  })

  test('does not let reconstructed replacement overwrite a terminal commit that won the storage lane', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-recovery-terminal-cas-'))
    const terminalStore = createRunStore(workspace, 'owner-1')
    const recoveryStore = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const startedAt = new Date().toISOString()
    const running = {
      ...initial,
      phase: 'DOCUMENT_DRAFTING' as const,
      documentStep: 'FOUNDATION_DRAFTING' as const,
      currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[0],
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        revision: initial.revision.document,
        status: 'running' as const,
        startedAt,
      },
    }
    await terminalStore.save(running)
    const expectedDigest = (await recoveryStore.inspectWorkflowSnapshot())
      .digest
    const completed = {
      ...running,
      activeDispatch: {
        ...running.activeDispatch,
        status: 'completed' as const,
        finishedAt: new Date().toISOString(),
        terminalResult: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
          resolvedFindingIds: [],
        },
      },
    }

    const terminalCommit = terminalStore.commit(completed, {
      eventId: 'terminal-commit',
      runId: completed.runId,
      type: 'dispatch.completed',
      phase: completed.phase,
      status: completed.status,
      revision: completed.revision,
      dispatchId: completed.activeDispatch.dispatchId,
      createdAt: new Date().toISOString(),
    })
    const reconstruction = recoveryStore.replaceSnapshotIfDigest({
      expectedDigest,
      run: { ...running, activeDispatch: undefined },
      event: {
        eventId: 'late-reconstruction',
        runId: running.runId,
        type: 'workflow.run.reconstructed',
        phase: running.phase,
        status: running.status,
        revision: running.revision,
        createdAt: new Date().toISOString(),
        projectId: running.projectId,
        ownerId: running.ownerId,
        sourceSnapshotDigest: expectedDigest,
        replayedUnitIds: [],
        activeUnitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
      },
    })

    await terminalCommit
    await expect(reconstruction).rejects.toMatchObject({
      code: 'recovery_snapshot_changed',
    })
    expect(await terminalStore.load()).toMatchObject({
      activeDispatch: {
        dispatchId: 'dispatch-1',
        status: 'completed',
      },
    })
    expect(
      (await terminalStore.readEvents()).some(
        event => event.type === 'workflow.run.reconstructed',
      ),
    ).toBe(false)
  })

  test('holds one exact lease from journal read through reconstruction commit', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    let journalLeaseId: string | undefined
    let casCalls = 0
    const racedStore: typeof fixture.store = {
      ...fixture.store,
      readEvents: async (...args) => {
        const lease = JSON.parse(
          await readFile(fixture.store.paths.lock, 'utf8'),
        ) as { leaseId: string; runId: string; processId: number }
        expect(lease.runId).toBe(RECOVERY_RUN_ID)
        expect(lease.processId).toBe(process.pid)
        journalLeaseId = lease.leaseId
        return fixture.store.readEvents(...args)
      },
      replaceSnapshotIfDigest: async input => {
        casCalls += 1
        expect(input.lease?.leaseId).toBe(journalLeaseId)
        return fixture.store.replaceSnapshotIfDigest(input)
      },
    }

    await recoverAndResumeRun({
      store: racedStore,
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      confirmedBriefContext: RECOVERY_BRIEF,
      stopWorkspaceWorkers: async () => undefined,
      resumeCurrentRun: async () => undefined,
    })

    expect(casCalls).toBe(1)
    expect(journalLeaseId).toBeTruthy()
    await expect(
      readFile(fixture.store.paths.lock, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('restarts projection from source bytes changed while workers stop', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    const before = await readFile(fixture.store.paths.snapshot, 'utf8')
    const changed = `${before}\n`

    let resumeCalls = 0
    const recovered = await recoverAndResumeRun({
      store: fixture.store,
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      confirmedBriefContext: RECOVERY_BRIEF,
      stopWorkspaceWorkers: async () => {
        await writeFile(fixture.store.paths.snapshot, changed)
      },
      resumeCurrentRun: async () => {
        resumeCalls += 1
      },
    })
    expect(recovered.runId).toBe(RECOVERY_RUN_ID)
    expect(resumeCalls).toBe(1)
    expect(await readFile(fixture.store.paths.snapshot, 'utf8')).not.toBe(
      changed,
    )
    expect(
      (await fixture.store.readEvents()).filter(
        event => event.type === 'workflow.run.reconstructed',
      ),
    ).toHaveLength(1)
  })

  test('restarts a persisted reconstruction marker with fresh store and dispatcher instances', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    const journalEvents = await fixture.store.readEvents()
    await writeFile(
      fixture.store.paths.events,
      `${journalEvents
        .filter(event => event.type !== 'workflow.unit.accepted')
        .map(event => JSON.stringify(event))
        .join('\n')}\n`,
    )
    const activePath = CANONICAL_FOUNDATION_DOCUMENTS[0]
    const nextPath = CANONICAL_FOUNDATION_DOCUMENTS[1]
    const dispatchId = 'fixture-document-0'
    const request: WorkerDispatchRequest = {
      dispatchId,
      runId: RECOVERY_RUN_ID,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      workspacePath: fixture.workspacePath,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: activePath,
      revision: fixture.journalRun.revision.document,
      allowedPaths: [activePath],
      contract: {
        confirmedBriefDigest: fixture.journalRun.confirmedBriefDigest,
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: activePath,
        upstreamDocumentPaths: [],
      },
    }
    await writeFile(
      fixture.store.paths.snapshot,
      `${JSON.stringify(
        {
          ...fixture.journalRun,
          schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
          invalidRecoveryMarker: true,
          phase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          status: 'running',
          currentItemId: activePath,
          foundationDraftState: { completedPaths: [] },
          resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
          evidence: {},
          activeDispatch: {
            dispatchId,
            workerType: 'document-author',
            phase: 'DOCUMENT_DRAFTING',
            taskId: activePath,
            revision: fixture.journalRun.revision.document,
            status: 'running',
            startedAt: fixture.journalRun.updatedAt,
            request,
          },
        },
        null,
        2,
      )}\n`,
    )
    const firstStarted: WorkerDispatchRequest[] = []
    const firstController = createDeliveryWorkflowController({
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      workerPort: {
        async start(request) {
          firstStarted.push(request)
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
      },
    })
    await chmod(fixture.store.paths.events, 0o444)
    try {
      await expect(
        recoverAndResumeRun({
          store: fixture.store,
          workspacePath: fixture.workspacePath,
          ownerId: RECOVERY_OWNER_ID,
          projectId: RECOVERY_PROJECT_ID,
          confirmedBriefContext: RECOVERY_BRIEF,
          stopWorkspaceWorkers: async () => undefined,
          resumeCurrentRun: run => firstController.resume(run),
        }),
      ).rejects.toBeInstanceOf(Error)
    } finally {
      await chmod(fixture.store.paths.events, 0o644)
    }
    const interruptedSnapshot = JSON.parse(
      await readFile(fixture.store.paths.snapshot, 'utf8'),
    ) as DeliveryRun
    expect(interruptedSnapshot.pendingEvents).toEqual([
      expect.objectContaining({ type: 'workflow.run.reconstructed' }),
      expect.objectContaining({
        type: 'workflow.unit.accepted',
        unit: expect.objectContaining({ unitId: `document:${activePath}` }),
      }),
    ])
    expect(firstStarted).toHaveLength(0)

    const restartedStore = createRunStore(
      fixture.workspacePath,
      RECOVERY_OWNER_ID,
    )
    const restarted: WorkerDispatchRequest[] = []
    const restartedController = createDeliveryWorkflowController({
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      workerPort: {
        async start(request) {
          restarted.push(request)
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
      },
    })
    await recoverAndResumeRun({
      store: restartedStore,
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      projectId: RECOVERY_PROJECT_ID,
      confirmedBriefContext: RECOVERY_BRIEF,
      stopWorkspaceWorkers: async () => undefined,
      resumeCurrentRun: run => restartedController.resume(run),
    })
    const events = await restartedStore.readEvents()
    expect(
      events.filter(event => event.type === 'workflow.run.reconstructed'),
    ).toHaveLength(1)
    const accepted = events.filter(
      event => event.type === 'workflow.unit.accepted',
    )
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({
      unit: { unitId: `document:${activePath}` },
    })
    expect(restarted).toHaveLength(1)
    expect(restarted[0]).toMatchObject({
      workerType: 'document-author',
      taskId: nextPath,
      contract: { foundationDocumentPath: nextPath },
    })
    const durable = await restartedStore.load()
    expect(durable).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      activeDispatch: {
        workerType: 'document-author',
        status: 'running',
      },
    })
    expect(durable?.pendingEvents).toBeUndefined()
  })
})
