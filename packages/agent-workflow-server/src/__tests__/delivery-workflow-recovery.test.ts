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
import { createDeliveryDispatcher } from '../beegame/delivery-workflow/dispatch'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import {
  computeDocumentRevision,
  computeResourceContentDigest,
  computeWorkspaceRevision,
} from '../beegame/delivery-workflow/revision'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from './delivery-workflow-test-helpers'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  DELIVERY_RUN_SCHEMA_VERSION,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type AcceptedWorkflowUnit,
  type AtomicTask,
  type DeliveryRun,
  type DispatchWorkerType,
  type DocumentReviewCheck,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import { WORKER_TYPES } from '../beegame/delivery-workflow/schema'
import { commitCanonicalDocument } from '../beegame/native-canonical-document-tool'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'
import {
  artifactsForDocumentReviewCheck,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
} from '../beegame/delivery-workflow/document-review-input'

const RECOVERY_OWNER_ID = 'recovery-owner'
const RECOVERY_PROJECT_ID = 'recovery-project'
const RECOVERY_RUN_ID = 'recovery-run'
const RECOVERY_BRIEF = JSON.stringify({
  goal: 'Exercise durable exact-resume authority.',
})
const RECOVERY_ACCEPTED_AT = '2026-08-05T00:00:00.000Z'
const RETIRED_PENDING_CHECK_ID = 'retired-pending-check'

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

function matrixPassingChecks(
  ids: string[],
  request: WorkerDispatchRequest,
): DocumentReviewCheck[] {
  const available = createAcceptedComprehensiveReview().checks
  const referenceIndex = request.contract.referenceIndex as
    | {
        artifacts?: Array<{ artifactId?: unknown; path?: unknown }>
        references?: Array<{ artifactId?: unknown; anchor?: unknown }>
      }
    | undefined
  const pathByArtifactId = new Map(
    (referenceIndex?.artifacts ?? []).flatMap(artifact =>
      typeof artifact.artifactId === 'string' &&
      typeof artifact.path === 'string'
        ? [[artifact.artifactId, artifact.path] as const]
        : [],
    ),
  )
  const references = (referenceIndex?.references ?? []).flatMap(reference => {
    const path =
      typeof reference.artifactId === 'string'
        ? pathByArtifactId.get(reference.artifactId)
        : undefined
    return path && typeof reference.anchor === 'string'
      ? [{ path, anchor: reference.anchor }]
      : []
  })
  const artifactPathsByCheck = request.contract.artifactPathsByCheck as
    | Record<string, unknown>
    | undefined
  return ids.map(id => {
    const existing = available.find(check => check.id === id)!
    const allowedPaths = new Set(
      matrixStringArray(artifactPathsByCheck?.[id]),
    )
    const availableEvidence = references.filter(reference =>
      allowedPaths.has(reference.path),
    )
    const systemContractEvidence = availableEvidence.find(
      evidence => evidence.path === 'systemDeliveryContract',
    )
    const documentEvidence = availableEvidence.find(
      evidence => evidence.path !== 'systemDeliveryContract',
    )
    const evidence = [documentEvidence, systemContractEvidence].filter(
      (value): value is { path: string; anchor: string } => Boolean(value),
    )
    return {
      ...existing,
      evidence,
      assessments:
        id in GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
          ? GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
              id as keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
            ].map(criterion => ({
              criterion,
              status: 'pass' as const,
              evidence,
              derivation: 'Compared the synthetic authority records.',
              conclusion: 'The synthetic invariant is satisfied.',
            }))
          : [],
    }
  })
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
    const targetPath = request.taskId!
    const baseline = await readFile(join(workspacePath, targetPath), 'utf8')
    const baselineVersion = matrixFrontmatterValue(baseline, 'version')
    const baselineUpdatedAt = matrixFrontmatterValue(baseline, 'updated_at')
    await commitCanonicalDocument({
      workspacePath,
      contract: {
        dispatchId: request.dispatchId!,
        targetPath,
        documentId:
          CANONICAL_PROJECT_DOCUMENT_IDS[
            targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
          ],
        operation: 'revise',
        baselineDigest: sha256(baseline),
        baselineVersion,
        baselineUpdatedAt,
      },
      body: '# Spec\nSynthetic revision.',
    })
    return {
      workerType: request.workerType,
      status: 'completed' as const,
      writtenPaths: [targetPath],
      resolvedFindingIds: [],
    }
  }
  if (request.workerType === 'document-reviewer') {
    const currentCheckIds = matrixStringArray(
      request.contract.currentCheckIds,
    )
    return {
      workerType: request.workerType,
      revision: request.revision,
      verdict: 'READY' as const,
      checks: matrixPassingChecks(currentCheckIds, request),
      checklistIds: matrixStringArray(request.contract.checklistIds),
      findings: [],
      evidencePath,
      rejectedSubmissionCount: 0,
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
      requirements: [{ id: 'matrix-requirement', required: true }],
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
      writtenPaths: [
        'assets/asset-manifest.json',
        'assets/runtime/matrix.dat',
      ],
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
          protectedPaths: request.protectedPaths ?? [],
        },
        assertMutationAuthority: () => undefined,
      }) as { call(value: unknown): Promise<unknown> }
      await tool.call({
        action: 'commit',
        documents: [matrixContentDocument()],
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
  for (const [index, path] of CANONICAL_PROJECT_DOCUMENTS.entries())
    await commitCanonicalDocument({
      workspacePath: input.workspacePath,
      contract: {
        dispatchId: `matrix-document-${index}`,
        targetPath: path,
        documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
        operation: 'create',
        baselineDigest: null,
      },
      body: path.endsWith('gameplay-checklist.md')
        ? '# Acceptance\n- [ ] CHECK-001 source: docs/GDD.md implement: Execute the synthetic action expected: observable result evidence: runtime\n'
        : '# Spec\nSynthetic authority.',
    })

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
          ? [{ id: 'matrix-requirement', required: true }]
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
  const checklistApproval = initial.documentReviewState.checklistApproval!
  const comprehensiveChecks = createAcceptedComprehensiveReview().checks
  const comprehensiveApproval = resourceRevision
    ? {
        scope: 'complete' as const,
        revision: resourceRevision,
        checks: comprehensiveChecks,
        checkEvidenceDigests: {},
        evidencePath: '.beegame/workflow/evidence/comprehensive.json',
        approvedAt: RECOVERY_ACCEPTED_AT,
      }
    : undefined
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
    documentReviewState: {
      ...initial.documentReviewState,
      checklistApproval,
      ...(comprehensiveApproval ? { comprehensiveApproval } : {}),
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
      documentReviewState: {
        repairPasses: common.documentReviewState.repairPasses,
      },
      evidence: {},
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
  if (input.workerType === 'document-reviewer')
    return {
      ...common,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      documentReviewState: {
        repairPasses: common.documentReviewState.repairPasses,
      },
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
  for (const [index, path] of CANONICAL_PROJECT_DOCUMENTS.entries())
    await commitCanonicalDocument({
      workspacePath,
      contract: {
        dispatchId: `fixture-document-${index}`,
        targetPath: path,
        documentId: CANONICAL_PROJECT_DOCUMENT_IDS[path],
        operation: 'create',
        baselineDigest: null,
      },
      body: path === 'docs/GDD.md' ? '# Recovery authority' : '# Fixture',
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
    requirements: [{ id: 'fixture-requirement', required: true }],
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
      protectedPaths: [],
    },
    assertMutationAuthority: () => undefined,
  }) as { call(value: unknown): Promise<unknown> }
  await resourceContentTool.call({
    action: 'commit',
    documents: [
      {
        path: 'assets/content/resource-registry.json',
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
    ],
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
  const authority = {
    confirmedBriefContext: RECOVERY_BRIEF,
    confirmedBriefDigest,
  }
  const allChecks = createAcceptedComprehensiveReview().checks
  const foundationChecks = allChecks.slice(
    0,
    FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.length,
  )
  const checklistCheck: DocumentReviewCheck = {
    id: 'checklist_traceability',
    status: 'pass',
    conclusion: 'The Checklist is traceable.',
    evidence: [{ path: 'docs/acceptance/gameplay-checklist.md', anchor: '$' }],
    findingIds: [],
    assessments: [],
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
  const dependencyDigests = new Map<string, Record<string, string>>()
  for (const check of [...foundationChecks, checklistCheck]) {
    const artifacts =
      check.id === 'checklist_traceability'
        ? checklistArtifacts
        : foundationArtifacts
    dependencyDigests.set(
      check.id,
      documentReviewArtifactDigests(
        artifactsForDocumentReviewCheck(artifacts, check.id),
      ),
    )
  }
  for (const check of allChecks)
    if (!dependencyDigests.has(check.id))
      dependencyDigests.set(
        check.id,
        documentReviewArtifactDigests(
          artifactsForDocumentReviewCheck(comprehensiveArtifacts, check.id),
        ),
      )

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
    ...foundationChecks.map((check, index) => ({
      eventSchemaVersion: 1 as const,
      unitId: `review:${check.id}`,
      kind: 'review-check' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      predecessorUnitIds:
        index === 0 ? [] : [`review:${foundationChecks[index - 1]!.id}`],
      inputRevision: documentRevision,
      dependencyDigests: dependencyDigests.get(check.id)!,
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: {
        check,
        findings: [],
        dependencyDigests: {
          [check.id]: dependencyDigests.get(check.id)!,
        },
      },
    })),
    {
      eventSchemaVersion: 1,
      unitId: 'review:checklist_traceability',
      kind: 'review-check',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: [],
      inputRevision: documentRevision,
      dependencyDigests: dependencyDigests.get(checklistCheck.id)!,
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: {
        check: checklistCheck,
        findings: [],
        dependencyDigests: {
          checklist_traceability: dependencyDigests.get(checklistCheck.id)!,
        },
      },
    },
    {
      eventSchemaVersion: 1,
      unitId: 'checklist:docs/acceptance/gameplay-checklist.md',
      kind: 'checklist',
      phase: 'DOCUMENT_REVIEW',
      predecessorUnitIds: ['review:checklist_traceability'],
      inputRevision: documentRevision,
      dependencyDigests: dependencyDigests.get(checklistCheck.id)!,
      receiptRef: '.beegame/workflow/evidence/checklist.json',
      acceptedAt: RECOVERY_ACCEPTED_AT,
      payload: {
        revision: documentRevision,
        evidencePath: '.beegame/workflow/evidence/checklist.json',
        checkIds: ['checklist_traceability'],
      },
    },
    {
      eventSchemaVersion: 1,
      unitId: 'resource:inventory',
      kind: 'resource-inventory',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: ['checklist:docs/acceptance/gameplay-checklist.md'],
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
  const checklistApproval = {
    scope: 'checklist' as const,
    revision: documentRevision,
    checks: [checklistCheck],
    checkEvidenceDigests: {
      checklist_traceability: dependencyDigests.get(checklistCheck.id)!,
    },
    evidencePath: '.beegame/workflow/evidence/checklist.json',
    approvedAt: RECOVERY_ACCEPTED_AT,
  }
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
    documentReviewState: { ...base.documentReviewState, checklistApproval },
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
    schemaVersion: 11,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'COMPREHENSIVE_REVIEW' as const,
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
    documentReviewState: {
      ...journalRun.documentReviewState,
      checklistApproval,
      activeCycle: {
        cycleId: 'stale-review-cycle',
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
            dependencyDigests.get(check.id)!,
          ]),
        ),
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
    activeDispatch: {
      dispatchId: 'stale-reviewer-dispatch',
      workerType: 'document-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: resourceRevision,
      status: 'running' as const,
      startedAt: RECOVERY_ACCEPTED_AT,
      request: {
        dispatchId: 'stale-reviewer-dispatch',
        runId: RECOVERY_RUN_ID,
        ownerId: RECOVERY_OWNER_ID,
        projectId: RECOVERY_PROJECT_ID,
        workspacePath,
        workerType: 'document-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        revision: resourceRevision,
        contract: {
          requiredCheckIds: [
            ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
            RETIRED_PENDING_CHECK_ID,
          ],
          currentCheckIds: ['resource_semantic_fitness' as const],
        },
      },
    },
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
    dependencyDigests,
    allChecks,
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
  await commitCanonicalDocument({
    workspacePath,
    contract: {
      dispatchId,
      targetPath: firstPath,
      documentId: CANONICAL_PROJECT_DOCUMENT_IDS[firstPath],
      operation: 'create',
      baselineDigest: null,
    },
    body: '# Synthetic authority',
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
    schemaVersion: 12,
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
      WORKER_TYPES.flatMap(workerType =>
        exactResumeCheckpointsForWorker(workerType),
      ),
    ).toHaveLength(46)
    expect(CANONICAL_RECEIPT_WORKERS).toEqual([
      'document-author',
      'resource-content-author',
    ])
  })

  for (const workerType of WORKER_TYPES) {
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
    await commitCanonicalDocument({
      workspacePath: workspace,
      contract: {
        dispatchId: request.dispatchId!,
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'create',
        baselineDigest: null,
      },
      body: '# Game Design\n\nRepaired rules.',
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

  test('reconciles an obsolete snapshots active Resource Content receipt before projection', async () => {
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
      protectedPaths: [],
    }
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: commitContract,
      assertMutationAuthority: () => undefined,
    }) as { call(input: unknown): Promise<unknown> }
    await tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
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
      ],
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
        preservedPaths: [],
      },
    }
    await writeFile(
      fixture.store.paths.snapshot,
      `${JSON.stringify(
        {
          ...fixture.snapshot,
          schemaVersion: 12,
          phase: 'RESOURCE_PREPARATION',
          documentStep: undefined,
          currentItemId: undefined,
          evidence: {},
          documentReviewState: {
            ...fixture.snapshot.documentReviewState,
            activeCycle: undefined,
          },
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
      requirements: [{ id: 'world.visual', required: true }],
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
      protectedPaths: [],
    }
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: commitContract,
      assertMutationAuthority: () => undefined,
    }) as { call(input: unknown): Promise<unknown> }
    await tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
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
      ],
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
        preservedPaths: [],
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

  test('records NEEDS_REVISION as a completed reviewer execution', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-status-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      documentRevision: 'revision-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const evidencePath = '.beegame/workflow/evidence/review.json'
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
      async onTerminal(_record, result) {
        if (result.workerType !== 'document-reviewer') return
        await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
          recursive: true,
        })
        await writeFile(join(workspace, result.evidencePath), '{}\n')
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
      contract: {
        reviewScope: 'foundation',
        currentCheckIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
        reviewArtifacts: [{ path: 'docs/GDD.md', content: 'abc' }],
        referenceIndex: { references: [{ referenceId: 'ref-1' }] },
        priorFindings: [{ findingId: 'prior-1' }],
      },
    })
    await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 20,
        cache_read_tokens: 10,
        cache_creation_tokens: 5,
        completion_tokens: 4,
        total_tokens: 39,
      },
      dispatch.dispatchId,
    )
    const completed = await dispatcher.completeDispatch(dispatch.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'NEEDS_REVISION',
      checks: [
        {
          id: 'brief_alignment',
          status: 'block',
          conclusion: 'A required behavior is missing.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: ['missing-behavior'],
          assessments: [],
        },
        {
          id: 'cross_document_consistency',
          status: 'pass',
          conclusion: 'The documents are consistent.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
        {
          id: 'gameplay_completeness',
          status: 'pass',
          conclusion: 'The gameplay contract is complete.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
      checklistIds: [],
      findings: [
        {
          findingId: 'missing-behavior',
          checkId: 'brief_alignment',
          severity: 'blocking',
          owner: 'foundation',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          observation: 'A required behavior is missing.',
          blockingImpact: 'The behavior cannot be implemented uniquely.',
          requiredOutcome: 'The required behavior is observable and complete.',
        },
      ],
      evidencePath,
      rejectedSubmissionCount: 2,
    })

    expect(completed.record.status).toBe('completed')
    expect((await store.load())?.activeDispatch).toMatchObject({
      workerType: 'document-reviewer',
      status: 'completed',
    })
    expect(await readFile(join(workspace, evidencePath), 'utf8')).toBe('{}\n')
    expect(
      (await store.readEvents()).find(
        event => event.type === 'dispatch.completed',
      ),
    ).toMatchObject({
      reviewerPerformance: {
        checkIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
        usage: {
          input_tokens: 20,
          cache_read_tokens: 10,
          cache_creation_tokens: 5,
          completion_tokens: 4,
          total_tokens: 39,
        },
        artifactCount: 1,
        artifactBytes: 3,
        referenceCount: 1,
        priorFindingCount: 1,
        rejectedSubmissionCount: 2,
      },
    })
  })

  test('explicit retry resumes an accepted repair handoff regardless of prior pass count', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-lock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-review-lock',
      projectId: 'project-review-lock',
      ownerId: 'owner-1',
    })
    const revision = await computeDocumentRevision(
      workspace,
      initial.confirmedBriefDigest,
    )
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      revision: { ...initial.revision, document: revision },
      blockedReason: 'review repair is exhausted',
      documentReviewState: {
        ...initial.documentReviewState,
        checklistApproval: {
          scope: 'checklist',
          revision: initial.revision.document,
          checks: [
            {
              id: 'checklist_traceability',
              status: 'pass',
              conclusion: 'Checklist is approved.',
              evidence: [
                {
                  path: 'docs/acceptance/gameplay-checklist.md',
                  anchor: 'Acceptance',
                },
              ],
              findingIds: [],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          evidencePath: '.beegame/workflow/evidence/checklist.json',
          approvedAt: new Date().toISOString(),
        },
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          foundation: 2,
        },
        activeCycle: {
          cycleId: 'cycle-1',
          parentCycleId: 'initial-cycle',
          originScope: 'foundation',
          scope: 'foundation',
          mode: 'closure',
          sourceRevision: revision,
          requiredCheckIds: ['brief_alignment'],
          completedCheckIds: ['brief_alignment'],
          checks: [
            {
              id: 'brief_alignment' as const,
              status: 'block' as const,
              conclusion: 'Foundation remediation is required.',
              evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              findingIds: ['MISSING-RULE'],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'MISSING-RULE',
              checkId: 'brief_alignment',
              severity: 'blocking',
              owner: 'foundation',
              evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              observation: 'A required rule is missing.',
              blockingImpact: 'The behavior cannot be implemented uniquely.',
              requiredOutcome: 'The required rule is defined.',
            },
          ],
          activeTarget: 'foundation',
          acceptedSemanticResult: true,
          changedPaths: ['docs/GDD.md'],
          sourceArtifactDigests: {},
        },
      },
    })

    const retried = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })
    expect(retried).toMatchObject({
      status: 'running',
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      documentReviewState: {
        repairPasses: { foundation: 2 },
        activeCycle: {
          cycleId: 'cycle-1',
          acceptedSemanticResult: true,
        },
      },
    })
  })

  test('restores an interrupted accepted resource remediation handoff', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-resource-review-handoff-'),
    )
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-resource-review-handoff',
      projectId: 'project-resource-review-handoff',
      ownerId: 'owner-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'COMPREHENSIVE_REVIEW',
      status: 'needs_action',
      blockedReason:
        'document review cycle has already accepted its unique semantic result',
      documentReviewState: {
        ...initial.documentReviewState,
        checklistApproval: {
          scope: 'checklist',
          revision: initial.revision.document,
          checks: [
            {
              id: 'checklist_traceability',
              status: 'pass',
              conclusion: 'Checklist is approved.',
              evidence: [
                {
                  path: 'docs/acceptance/gameplay-checklist.md',
                  anchor: 'Acceptance',
                },
              ],
              findingIds: [],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          evidencePath: '.beegame/workflow/evidence/checklist.json',
          approvedAt: new Date().toISOString(),
        },
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          resource: 1,
        },
        activeCycle: {
          cycleId: 'resource-cycle',
          originScope: 'complete',
          scope: 'complete',
          mode: 'initial',
          sourceRevision: 'resources',
          ...createAcceptedComprehensiveReview({
            blockingCheckId: 'resource_content_consistency',
            findingIds: ['resource-finding'],
          }),
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'resource-finding',
              checkId: 'resource_content_consistency',
              severity: 'blocking',
              owner: 'resource',
              evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
              subjects: [
                {
                  path: 'assets/asset-manifest.json',
                  anchor: '$',
                  resourceId: 'resource-1',
                },
              ],
              observation: 'The resource contract is inconsistent.',
              blockingImpact: 'Implementation cannot resolve the resource.',
              requiredOutcome: 'The resource contract is consistent.',
            },
          ],
          activeTarget: 'resource',
          acceptedSemanticResult: true,
          changedPaths: [],
          sourceArtifactDigests: {},
        },
      },
    })

    const retried = await retryRun({ store, runId: initial.runId })

    expect(retried).toMatchObject({
      status: 'running',
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      blockedReason: undefined,
      documentReviewState: {
        repairPasses: { resource: 1 },
        activeCycle: {
          cycleId: 'resource-cycle',
          acceptedSemanticResult: true,
          activeTarget: 'resource',
        },
      },
    })
  })

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
    const obsoleteSnapshot = JSON.stringify({
      ...initial,
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1,
      activeDispatch: {
        retiredStateMarker: true,
      },
    })
    await writeFile(store.paths.snapshot, obsoleteSnapshot, 'utf8')

    await expect(store.load()).rejects.toMatchObject({
      code: 'obsolete',
      message: `unsupported workflow snapshot schema version ${DELIVERY_RUN_SCHEMA_VERSION - 1}; current version is ${DELIVERY_RUN_SCHEMA_VERSION}`,
    })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(obsoleteSnapshot)
  })

  test('only replaces an obsolete snapshot after explicit migration', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-migrate-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-migrate',
      projectId: 'project-migrate',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const obsoleteSnapshot = JSON.stringify({ ...initial, schemaVersion: 11 })
    await writeFile(store.paths.snapshot, obsoleteSnapshot, 'utf8')

    await expect(store.load()).rejects.toMatchObject({ code: 'obsolete' })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(obsoleteSnapshot)

    await expect(store.load({ migrate: true })).resolves.toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      runId: initial.runId,
    })
    expect(
      JSON.parse(await readFile(store.paths.snapshot, 'utf8')),
    ).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      runId: initial.runId,
    })
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

    const stopped = await stopRun({
      store,
      runId: initial.runId,
      reason: 'user stopped workflow',
      sessionIsOpen: async () => true,
      stopDispatch: async () => undefined,
    })

    expect(stopped).toMatchObject({
      status: 'stopped',
      activeDispatch: { status: 'interrupted' },
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(stopped.activeTaskId).toBeUndefined()

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

  test('rejects usage from a stopped or superseded dispatch', async () => {
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
    expect((await store.load())?.usage?.total_tokens).toBe(35)
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
          cycleId: 'cycle-1',
          reviewScope: 'foundation',
          reviewMode: 'initial',
          currentCheckIds: ['brief_alignment'],
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
    const comprehensiveReviewer = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-reviewer',
        contract: { reviewScope: 'complete' },
      },
      1,
    )

    expect(checklistAuthor).not.toBe(reviewer)
    expect(comprehensiveReviewer).not.toBe(reviewer)
    expect(
      dispatcher.idempotencyKey(
        {
          ...shared,
          workerType: 'document-reviewer',
          contract: {
            cycleId: 'cycle-1',
            reviewScope: 'foundation',
            reviewMode: 'initial',
            currentCheckIds: ['cross_document_consistency'],
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

  test('hands the next reviewer packet through the dispatcher without stopping the cycle session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-packet-handoff-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      documentRevision: 'revision-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const started: WorkerDispatchRequest[] = []
    const stopped: string[] = []
    let dispatcher!: ReturnType<typeof createDeliveryDispatcher>
    const commonContract = {
      cycleId: 'cycle-1',
      reviewScope: 'foundation',
      reviewMode: 'initial',
      requiredCheckIds: ['brief_alignment', 'cross_document_consistency'],
    }
    dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: 'cycle-session',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop(_dispatchId, reason) {
          stopped.push(reason)
        },
        async close() {},
        async status() {
          throw new Error('not used')
        },
      },
      async onTerminal(_record, result) {
        if (result.workerType !== 'document-reviewer') return
        const current = await store.load()
        await store.save({ ...current!, activeDispatch: undefined })
        await dispatcher.dispatch({
          runId: initial.runId,
          ownerId: initial.ownerId,
          projectId: initial.projectId,
          workspacePath: workspace,
          workerType: 'document-reviewer',
          phase: 'DOCUMENT_REVIEW',
          revision: initial.revision.document,
          contract: {
            ...commonContract,
            currentCheckIds: ['cross_document_consistency'],
          },
        })
      },
    })
    const first = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { ...commonContract, currentCheckIds: ['brief_alignment'] },
    })
    await dispatcher.completeDispatch(first.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'READY',
      checks: [
        {
          id: 'brief_alignment',
          status: 'pass',
          conclusion: 'The brief is aligned.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
      checklistIds: [],
      findings: [],
      evidencePath: '.beegame/workflow/evidence/packet-1.json',
      rejectedSubmissionCount: 0,
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(started).toHaveLength(2)
    expect(stopped).toEqual([])
  })

  test('starts a checklist author after a reviewer completes at the same phase and revision', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-author-handoff-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      documentRevision: 'revision-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const evidencePath = '.beegame/workflow/evidence/foundation-review.md'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '# Ready\n')
    const started: WorkerDispatchRequest[] = []
    let dispatcher!: ReturnType<typeof createDeliveryDispatcher>
    dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: request.dispatchId ?? 'missing-dispatch-id',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
      async onTerminal(_record, result) {
        if (result.workerType !== 'document-reviewer') return
        const reviewed = await store.load()
        await store.save({
          ...reviewed!,
          activeDispatch: undefined,
          documentStep: 'CHECKLIST_DRAFTING',
        })
        await dispatcher.dispatch({
          runId: initial.runId,
          ownerId: initial.ownerId,
          projectId: initial.projectId,
          workspacePath: workspace,
          workerType: 'document-author',
          phase: 'DOCUMENT_REVIEW',
          revision: initial.revision.document,
          allowedPaths: ['docs/acceptance/'],
          contract: { documentSet: 'checklist' },
        })
      },
    })
    const review = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })

    await dispatcher.completeDispatch(review.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'READY',
      checks: [
        {
          id: 'brief_alignment',
          status: 'pass',
          conclusion: 'The authority is aligned.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
      checklistIds: [],
      findings: [],
      evidencePath,
      rejectedSubmissionCount: 0,
    })

    expect(started.map(request => request.workerType)).toEqual([
      'document-reviewer',
      'document-author',
    ])
    expect((await store.load())?.activeDispatch).toMatchObject({
      workerType: 'document-author',
      status: 'running',
    })
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

    await expect(store.unlock(first)).rejects.toMatchObject({
      code: 'ownership',
    })
    expect(JSON.parse(await readFile(store.paths.lock, 'utf8'))).toEqual(
      successor,
    )
    await expect(store.unlock(successor)).resolves.toBeUndefined()
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

  test('uses the RunStore expected-digest CAS for the final reconstruction write', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    const competingStore = createRunStore(
      fixture.workspacePath,
      RECOVERY_OWNER_ID,
    )
    let casCalls = 0
    const racedStore: typeof fixture.store = {
      ...fixture.store,
      replaceSnapshotIfDigest: async input => {
        casCalls += 1
        await competingStore.replaceSnapshotIfDigest({
          expectedDigest: input.expectedDigest,
          run: fixture.journalRun,
          event: {
            eventId: 'competing-workflow-commit',
            runId: fixture.journalRun.runId,
            type: 'workflow.progress',
            phase: fixture.journalRun.phase,
            status: fixture.journalRun.status,
            revision: fixture.journalRun.revision,
            createdAt: new Date().toISOString(),
            durableProgress: true,
          },
        })
        return fixture.store.replaceSnapshotIfDigest(input)
      },
    }

    await expect(
      recoverAndResumeRun({
        store: racedStore,
        workspacePath: fixture.workspacePath,
        ownerId: RECOVERY_OWNER_ID,
        projectId: RECOVERY_PROJECT_ID,
        confirmedBriefContext: RECOVERY_BRIEF,
        stopWorkspaceWorkers: async () => undefined,
        resumeCurrentRun: async () => {
          throw new Error('CAS conflict must not resume')
        },
      }),
    ).rejects.toMatchObject({ code: 'recovery_snapshot_changed' })

    expect(casCalls).toBe(1)
    expect(await competingStore.load()).toMatchObject({
      runId: fixture.journalRun.runId,
      phase: fixture.journalRun.phase,
    })
    expect(
      (await competingStore.readEvents()).some(
        event => event.type === 'workflow.run.reconstructed',
      ),
    ).toBe(false)
  })

  test('serializes simultaneous exact-resume recovery and dispatches only the active review unit', async () => {
    const fixture = await createStaleReviewerRecoveryFixture()
    workspace = fixture.workspacePath
    let stopCalls = 0
    const started: WorkerDispatchRequest[] = []
    let releaseSubmit!: () => void
    const submitGate = new Promise<void>(resolve => {
      releaseSubmit = resolve
    })
    let markSubmitStarted!: () => void
    const submitStarted = new Promise<void>(resolve => {
      markSubmitStarted = resolve
    })
    const controller = createDeliveryWorkflowController({
      workspacePath: fixture.workspacePath,
      ownerId: RECOVERY_OWNER_ID,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: request.dispatchId!,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {
          markSubmitStarted()
          await submitGate
        },
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const recover = () =>
      recoverAndResumeRun({
        store: fixture.store,
        workspacePath: fixture.workspacePath,
        ownerId: RECOVERY_OWNER_ID,
        projectId: RECOVERY_PROJECT_ID,
        confirmedBriefContext: RECOVERY_BRIEF,
        stopWorkspaceWorkers: async () => {
          stopCalls += 1
          const duringStop = JSON.parse(
            await readFile(fixture.store.paths.snapshot, 'utf8'),
          ) as { schemaVersion: number }
          expect(duringStop.schemaVersion).toBe(11)
        },
        resumeCurrentRun: run => controller.resume(run),
      })
    const pending = Promise.all([recover(), recover()])

    await submitStarted
    await Promise.resolve()
    releaseSubmit()
    const results = await pending

    expect(results.map(run => run.runId)).toEqual([
      RECOVERY_RUN_ID,
      RECOVERY_RUN_ID,
    ])
    expect(stopCalls).toBe(1)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      workerType: 'document-reviewer',
      contract: { currentCheckIds: ['resource_semantic_fitness'] },
    })
    expect(
      started.some(request =>
        FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.includes(request.taskId as never),
      ),
    ).toBe(false)
    expect(await fixture.store.load()).toMatchObject({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
      runId: RECOVERY_RUN_ID,
      activeDispatch: {
        workerType: 'document-reviewer',
        status: 'running',
      },
    })
    expect(
      (await fixture.store.readEvents()).filter(
        event => event.type === 'workflow.run.reconstructed',
      ),
    ).toHaveLength(1)
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
          schemaVersion: 12,
          phase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          status: 'running',
          currentItemId: activePath,
          foundationDraftState: { completedPaths: [] },
          documentReviewState: {
            repairPasses: { foundation: 0, checklist: 0, resource: 0 },
          },
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
