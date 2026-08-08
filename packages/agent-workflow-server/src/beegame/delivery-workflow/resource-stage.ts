import { auditAssetContract } from '../asset-contract-audit'
import {
  BEEGAME_RESOURCE_ROOTS,
  readBeeGameAssetManifest,
} from '../asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from '../content-contracts'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
  type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import {
  computeResourceInventoryRevision,
  computeResourceContentDigest,
  computeResourceRevision,
} from './revision'
import {
  resourceRemediationFindingsForTask,
  resolveResourceProductionTask,
} from './resource-task-resolver'
import { transitionDeliveryRun } from './transition'
import {
  type DeliveryRun,
  type ResourceContentReceipt,
  type ResourceProductionTask,
  type WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }
type ResourceAudit = ResourceDeliveryReadiness

const RESOURCE_CONTENT_AUTHORITY_PATHS = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
] as const

export function resourceContentAuthorityPaths(
  findings:
    | Pick<
        NonNullable<
          NonNullable<
            DeliveryRun['documentReviewState']['activeCycle']
          >['findings']
        >[number],
        'evidence'
      >[]
    | undefined,
): string[] {
  if (!findings) return [...RESOURCE_CONTENT_AUTHORITY_PATHS]
  const citedPaths = new Set(
    findings.flatMap(finding =>
      finding.evidence.map(reference => reference.path),
    ),
  )
  return RESOURCE_CONTENT_AUTHORITY_PATHS.filter(path => citedPaths.has(path))
}

export async function resourceContentReceiptMatchesWorkspace(
  workspacePath: string,
  receipt: ResourceContentReceipt,
): Promise<boolean> {
  return (
    receipt.contentDigest ===
    (await computeResourceContentDigest(workspacePath))
  )
}

export function resourcePreparationAllowedPaths(
  task: ResourceProductionTask,
): string[] {
  if (task === 'RESOURCE_PLAN') return ['assets/asset-manifest.json']
  if (task === 'RESOURCE_INVENTORY')
    return [
      'assets/asset-manifest.json',
      directoryScope(BEEGAME_RESOURCE_ROOTS.runtime),
      directoryScope(BEEGAME_RESOURCE_ROOTS.generated),
    ]
  if (task === 'RESOURCE_CONTENT')
    return [directoryScope(BEEGAME_RESOURCE_ROOTS.content)]
  return []
}

function directoryScope(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return `${normalized}/`
}

export async function startResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error(
      `resource production requires RESOURCE_PREPARATION, got ${input.run.phase}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch

  const resolution = await resolveResourceProductionTask(input)
  if (resolution.task === 'RESOURCE_GATE')
    throw new Error(
      'resource gate is deterministic and cannot dispatch a worker',
    )

  const reviewCycle = input.run.documentReviewState.activeCycle
  const remediation =
    reviewCycle?.acceptedSemanticResult &&
    reviewCycle.activeTarget === 'resource'
      ? {
          kind: 'document_review',
          cycleId: reviewCycle.cycleId,
          findings: resourceRemediationFindingsForTask(
            reviewCycle,
            resolution.task,
          ),
        }
      : undefined
  const common = {
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    phase: 'RESOURCE_PREPARATION' as const,
    taskId: resolution.task,
    revision: input.run.revision.document,
    allowedPaths: resourcePreparationAllowedPaths(resolution.task),
  }
  if (resolution.task === 'RESOURCE_PLAN')
    return input.dispatcher.dispatch({
      ...common,
      workerType: 'resource-planner',
      contract: {
        task: resolution.task,
        resourceLibraryUsage: confirmedResourceLibraryUsage(
          input.run.confirmedBriefContext,
        ),
        authorityPaths: [
          'docs/ASSET_PLAN.md',
          'docs/ART_DIRECTION.md',
          'docs/TECHNICAL_DESIGN.md',
        ],
        ...(remediation ? { remediation } : {}),
      },
    })
  if (resolution.task === 'RESOURCE_INVENTORY')
    return input.dispatcher.dispatch({
      ...common,
      workerType: 'resource-curator',
      contract: {
        task: resolution.task,
        resourceLibraryUsage: confirmedResourceLibraryUsage(
          input.run.confirmedBriefContext,
        ),
        authorityPaths: [
          'docs/ASSET_PLAN.md',
          'docs/ART_DIRECTION.md',
          'docs/TECHNICAL_DESIGN.md',
        ],
        ...(remediation ? { remediation } : {}),
      },
    })
  const assetAudit = auditAssetContract(input.workspacePath)
  const contentAudit = assetAudit.content
  const repairPaths = new Set(
    remediation?.findings.flatMap(finding =>
      finding.subjects.map(subject => subject.path.replaceAll('\\', '/')),
    ) ?? [],
  )
  for (const path of contentAudit.invalidPaths) repairPaths.add(path)
  if (contentAudit.hasGlobalIssues) {
    for (const file of contentAudit.files) {
      if (file.kind === 'resource-registry') repairPaths.add(file.path)
    }
    if (!contentAudit.files.length && !contentAudit.invalidPaths.length)
      repairPaths.add(`${BEEGAME_RESOURCE_ROOTS.content}/resource-registry.json`)
  }
  return input.dispatcher.dispatch({
    ...common,
    workerType: 'resource-content-author',
    contract: {
      task: resolution.task,
      contentRoot: BEEGAME_RESOURCE_ROOTS.content,
      schema: BEEGAME_CONTENT_SCHEMA,
      jsonKinds: BEEGAME_JSON_CONTENT_KINDS,
      yamlKinds: BEEGAME_YAML_CONTENT_KINDS,
      requiredRequirementIds: assetAudit.requirements
        .filter(requirement => requirement.required)
        .map(requirement => requirement.id),
      verifiedResourceIds: assetAudit.resources
        .filter(resource => resource.status === 'verified')
        .map(resource => resource.id),
      inventoryBindings:
        input.run.resourceProductionState.inventoryReceipt?.bindings ?? [],
      inventoryRevision:
        input.run.resourceProductionState.inventoryReceipt?.revision,
      baselineResourceRevision: await computeResourceRevision(
        input.workspacePath,
        '',
      ),
      authorityPaths: [...resourceContentAuthorityPaths(remediation?.findings)],
      repairPaths: [...repairPaths],
      currentContentIssues: contentAudit.issues,
      ...(remediation ? { remediation } : {}),
    },
  })
}

export async function completeResourceTask(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<
    WorkerTerminalResult,
    {
      workerType:
        | 'resource-planner'
        | 'resource-curator'
        | 'resource-content-author'
    }
  >
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error('resource production is not the active phase')
  const expectedWorker = {
    RESOURCE_PLAN: 'resource-planner',
    RESOURCE_INVENTORY: 'resource-curator',
    RESOURCE_CONTENT: 'resource-content-author',
    RESOURCE_GATE: undefined,
  } as const
  if (
    expectedWorker[input.run.resourceProductionState.currentTask] !==
    input.terminal.workerType
  )
    throw new Error(
      `resource terminal does not own ${input.run.resourceProductionState.currentTask}`,
    )
  if (input.terminal.workerType === 'resource-planner') {
    const next: DeliveryRun = {
      ...input.run,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    }
    const resolution = await resolveResourceProductionTask({
      run: next,
      workspacePath: input.workspacePath,
    })
    if (resolution.task === 'RESOURCE_PLAN')
      throw new Error('resource planner terminal has no canonical plan')
    return next
  }
  if (input.terminal.workerType === 'resource-curator') {
    const revision = await computeResourceInventoryRevision(input.workspacePath)
    const next: DeliveryRun = {
      ...input.run,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT',
        inventoryReceipt: {
          revision,
          bindings: input.terminal.bindings,
          catalogObserved: input.terminal.catalogObserved,
          acceptedAt: new Date().toISOString(),
        },
      },
    }
    const resolution = await resolveResourceProductionTask({
      run: next,
      workspacePath: input.workspacePath,
    })
    if (resolution.task === 'RESOURCE_INVENTORY')
      throw new Error(
        'resource curator terminal has no valid inventory checkpoint',
      )
    return next
  }
  if (input.terminal.status === 'needs_inventory') {
    const manifest = await readBeeGameAssetManifest(input.workspacePath)
    const requirementIds = new Set(
      manifest.requirements.map(requirement => requirement.id),
    )
    if (
      input.terminal.missingRequirementIds.length === 0 ||
      input.terminal.missingRequirementIds.some(id => !requirementIds.has(id))
    )
      throw new Error(
        'resource content inventory request must contain exact current Manifest requirement IDs',
      )
    const audit = auditAssetContract(input.workspacePath)
    const verifiedResourceIds = new Set(
      audit.resources
        .filter(
          resource =>
            resource.status === 'verified' && resource.issues.length === 0,
        )
        .map(resource => resource.id),
    )
    const bindings = new Map(
      (input.run.resourceProductionState.inventoryReceipt?.bindings ?? []).map(
        binding => [binding.requirementId, binding.resourceIds] as const,
      ),
    )
    const stillSatisfied = input.terminal.missingRequirementIds.filter(id =>
      (bindings.get(id) ?? []).some(resourceId =>
        verifiedResourceIds.has(resourceId),
      ),
    )
    if (stillSatisfied.length)
      throw new Error(
        `resource content inventory request does not identify a real inventory gap: ${stillSatisfied.join(', ')}`,
      )
    return {
      ...input.run,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    }
  }
  const next: DeliveryRun = {
    ...input.run,
    activeDispatch: undefined,
    blockedReason: undefined,
    resourceProductionState: {
      ...input.run.resourceProductionState,
      currentTask: 'RESOURCE_GATE',
      contentReceipt: {
        contentDigest: await computeResourceContentDigest(input.workspacePath),
        acceptedAt: new Date().toISOString(),
      },
    },
  }
  const resolution = await resolveResourceProductionTask({
    run: next,
    workspacePath: input.workspacePath,
  })
  if (resolution.task !== 'RESOURCE_GATE')
    throw new Error(
      'resource content terminal has no complete canonical content',
    )
  return next
}

export async function reconcileCurrentResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<DeliveryRun | undefined> {
  if (
    input.run.phase !== 'RESOURCE_PREPARATION' ||
    input.run.activeDispatch?.status === 'running'
  )
    return undefined
  const resolution = await resolveResourceProductionTask(input)
  if (resolution.task !== 'RESOURCE_GATE') {
    if (input.run.resourceProductionState.currentTask === resolution.task)
      return undefined
    return {
      ...input.run,
      resourceProductionState: {
        ...input.run.resourceProductionState,
        currentTask: resolution.task,
        ...(resolution.inventoryReceiptValid
          ? {}
          : { inventoryReceipt: undefined, contentReceipt: undefined }),
      },
    }
  }

  const contentReceipt = input.run.resourceProductionState.contentReceipt
  if (
    !contentReceipt ||
    !(await resourceContentReceiptMatchesWorkspace(
      input.workspacePath,
      contentReceipt,
    ))
  )
    return {
      ...input.run,
      status: 'needs_action',
      blockedReason:
        'resource content receipt is missing or its canonical content digest changed before the resource gate',
    }

  const readiness = auditResourcesForPreparation({
    workspacePath: input.workspacePath,
    confirmedBriefContext: input.run.confirmedBriefContext,
    catalogObserved:
      input.run.resourceProductionState.inventoryReceipt?.catalogObserved ??
      false,
  })
  if (!readiness.ready)
    return {
      ...input.run,
      status: 'needs_action',
      blockedReason: [...readiness.issues, ...readiness.readinessIssues].join(
        '; ',
      ),
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    }

  const resourceRevision = await computeResourceRevision(
    input.workspacePath,
    input.run.revision.document,
  )
  const evidence = {
    path: 'assets/asset-manifest.json',
    kind: 'resource_preparation' as const,
    revision: resourceRevision,
    status: 'passed' as const,
    observedAt: new Date().toISOString(),
  }
  return transitionDeliveryRun(
    { ...input.run, activeDispatch: undefined },
    { type: 'resource_preparation_ready', resourceRevision, evidence },
  )
}

export async function auditResourceInventoryPolicy(
  workspacePath: string,
): Promise<string[]> {
  const audit = auditResourceDeliveryReadiness({ workspacePath })
  return [...audit.issues, ...audit.readinessIssues]
}

export function auditResourcesForPreparation(input: {
  workspacePath: string
  confirmedBriefContext?: string
  catalogObserved?: boolean
}): ResourceAudit {
  return auditResourceDeliveryReadiness({
    workspacePath: input.workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(input.confirmedBriefContext),
    catalogObserved: input.catalogObserved ?? false,
  })
}
