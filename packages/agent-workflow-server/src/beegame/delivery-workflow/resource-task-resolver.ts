import { auditAssetContract } from '../asset-contract-audit'
import { readBeeGameAssetManifest } from '../asset-contracts'
import { computeResourceInventoryRevision } from './revision'
import type {
  DocumentReviewCycle,
  DocumentReviewFinding,
  DeliveryRun,
  ResourceInventoryReceipt,
  ResourceProductionTask,
} from './types'

export type ResourceTaskResolution = {
  task: ResourceProductionTask
  inventoryRevision?: string
  inventoryReceiptValid: boolean
}

export async function resolveResourceProductionTask(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<ResourceTaskResolution> {
  const audit = auditAssetContract(input.workspacePath)
  if (!audit.present || !(await manifestPlanIsEstablished(input.workspacePath)))
    return { task: 'RESOURCE_PLAN', inventoryReceiptValid: false }

  const remediationTask = resourceRemediationTask(input.run)
  if (remediationTask)
    return {
      task: remediationTask,
      inventoryReceiptValid: Boolean(
        input.run.resourceProductionState.inventoryReceipt,
      ),
    }

  const inventoryRevision = await computeResourceInventoryRevision(
    input.workspacePath,
  )
  const receipt = input.run.resourceProductionState.inventoryReceipt
  const inventoryReceiptValid = Boolean(
    receipt &&
      receipt.revision === inventoryRevision &&
      inventoryReceiptMatchesAudit(receipt, audit),
  )
  if (!inventoryReceiptValid)
    return {
      task: 'RESOURCE_INVENTORY',
      inventoryRevision,
      inventoryReceiptValid: false,
    }

  if (!audit.content.valid)
    return {
      task: 'RESOURCE_CONTENT',
      inventoryRevision,
      inventoryReceiptValid: true,
    }

  return {
    task: 'RESOURCE_GATE',
    inventoryRevision,
    inventoryReceiptValid: true,
  }
}

const RESOURCE_TASK_ORDER: readonly ResourceProductionTask[] = [
  'RESOURCE_PLAN',
  'RESOURCE_INVENTORY',
  'RESOURCE_CONTENT',
  'RESOURCE_GATE',
]

export function resourceFindingTargetTask(
  finding: DocumentReviewFinding,
): Exclude<ResourceProductionTask, 'RESOURCE_GATE'> {
  let hasContentSubject = false
  let hasInventorySubject = false
  let hasPlanSubject = false
  for (const subject of finding.subjects) {
    const path = subject.path.replaceAll('\\', '/')
    if (subject.contentId || path.startsWith('assets/content/')) {
      hasContentSubject = true
      continue
    }
    if (
      subject.resourceId ||
      path.startsWith('assets/runtime/') ||
      path.startsWith('assets/generated/')
    ) {
      hasInventorySubject = true
      continue
    }
    if (path === 'assets/asset-manifest.json') {
      hasPlanSubject = true
    }
  }
  if (hasInventorySubject) return 'RESOURCE_INVENTORY'
  if (hasPlanSubject) return 'RESOURCE_PLAN'
  if (hasContentSubject) return 'RESOURCE_CONTENT'
  throw new Error(
    `accepted resource finding ${finding.findingId} does not identify a canonical resource subject`,
  )
}

export function resourceRemediationFindingsForTask(
  cycle: DocumentReviewCycle | undefined,
  task: Exclude<ResourceProductionTask, 'RESOURCE_GATE'>,
): DocumentReviewFinding[] {
  return (cycle?.findings ?? []).filter(
    finding => finding.owner === 'resource' && resourceFindingTargetTask(finding) === task,
  )
}

function resourceRemediationTask(
  run: DeliveryRun,
): ResourceProductionTask | undefined {
  const cycle = run.documentReviewState.activeCycle
  if (
    !cycle?.acceptedSemanticResult ||
    cycle.activeTarget !== 'resource' ||
    run.resourceProductionState.currentTask === 'RESOURCE_GATE'
  )
    return undefined
  const cursor = run.resourceProductionState.currentTask
  const targetTasks = new Set(
    cycle.findings
      .filter(finding => finding.owner === 'resource')
      .map(resourceFindingTargetTask),
  )
  const cursorIndex = RESOURCE_TASK_ORDER.indexOf(cursor)
  if (cursorIndex < 0) throw new Error(`unknown resource task cursor: ${cursor}`)
  for (const task of RESOURCE_TASK_ORDER.slice(cursorIndex)) {
    if (task === 'RESOURCE_GATE') continue
    if (targetTasks.has(task)) return task
  }
  return undefined
}

async function manifestPlanIsEstablished(
  workspacePath: string,
): Promise<boolean> {
  try {
    const value = await readBeeGameAssetManifest(workspacePath)
    if (!isRecord(value.project_target)) return false
    const target = value.project_target
    if (
      !nonEmptyStrings(target.asset_format_capabilities) ||
      typeof target.runtime_asset_root !== 'string' ||
      typeof target.content_root !== 'string' ||
      typeof target.generated_asset_root !== 'string' ||
      !Array.isArray(value.requirements) ||
      value.requirements.length === 0
    )
      return false
    const ids = value.requirements.flatMap(requirement =>
      isRecord(requirement) &&
      typeof requirement.id === 'string' &&
      requirement.id.trim()
        ? [requirement.id]
        : [],
    )
    return (
      ids.length === value.requirements.length &&
      new Set(ids).size === ids.length
    )
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(item => typeof item === 'string' && item.trim())
  )
}

function inventoryReceiptMatchesAudit(
  receipt: ResourceInventoryReceipt,
  audit: ReturnType<typeof auditAssetContract>,
): boolean {
  if (audit.resources.length === 0) return false
  if (
    audit.resources.some(
      resource => resource.status !== 'verified' || resource.issues.length > 0,
    )
  )
    return false
  const requirementIds = new Set(
    audit.requirements.filter(item => item.required).map(item => item.id),
  )
  const resourceIds = new Set(audit.resources.map(item => item.id))
  const boundRequirements = new Set<string>()
  for (const binding of receipt.bindings) {
    if (!requirementIds.has(binding.requirementId)) return false
    if (binding.resourceIds.some(id => !resourceIds.has(id))) return false
    boundRequirements.add(binding.requirementId)
  }
  return [...requirementIds].every(id => boundRequirements.has(id))
}
