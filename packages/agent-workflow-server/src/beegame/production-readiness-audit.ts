import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import {
  GAME_PRODUCTION_DOCUMENT_PATHS,
  GAME_PRODUCTION_PLAN_INDEX_PATH,
  GAME_PRODUCTION_PLAN_DIRECTORY,
} from './production-planning-contract'
import { auditProjectDeliveryContract } from './project-delivery-contract-audit'
import { PRODUCTION_REVIEWER_AGENT_TYPE } from './delivery-validation-agents'
import type { DeliveryEvidenceKind } from './delivery-contract'

export type GameProductionReadinessAudit = {
  valid: boolean
  issues: string[]
  planPaths: string[]
}

export type GameProductionDocumentBundleAudit = Omit<
  GameProductionReadinessAudit,
  'planPaths'
>

export type ProductionMutationGateResult = {
  allowed: boolean
  message?: string
}

const PLANNING_WRITE_ROOTS = ['docs/'] as const
const PLANNING_WRITE_FILES = new Set(['assets/asset-manifest.json'])
const HOST_OWNED_PRODUCTION_FILES = new Set(['docs/production-brief.json'])
const STRUCTURED_MUTATION_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])
const TOOL_PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const
const PLAN_EVIDENCE_KINDS = new Set<DeliveryEvidenceKind>([
  'implementation', 'build', 'test', 'runtime', 'asset', 'skill', 'document',
])

export function auditGameProductionReadiness(
  workspacePath: string,
): GameProductionReadinessAudit {
  const bundle = auditGameProductionDocumentBundle(workspacePath)
  const workspace = resolve(workspacePath)
  const issues = [...bundle.issues]
  const planPaths = listImplementationPlans(workspace)
  if (planPaths.length !== 1) {
    issues.push(`Exactly one persisted implementation plan is required under ${GAME_PRODUCTION_PLAN_DIRECTORY}; found ${planPaths.length}.`)
  } else {
    issues.push(...auditImplementationPlan(workspace, planPaths[0]))
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)], planPaths }
}

export function auditGameProductionDocumentBundle(
  workspacePath: string,
): GameProductionDocumentBundleAudit {
  const workspace = resolve(workspacePath)
  const issues: string[] = []

  for (const documentPath of GAME_PRODUCTION_DOCUMENT_PATHS) {
    const absolutePath = resolve(workspace, documentPath)
    if (!isWorkspacePath(workspace, absolutePath) || !isNonEmptyFile(absolutePath)) {
      issues.push(`Required production artifact is missing or empty: ${documentPath}`)
    }
  }

  const delivery = auditProjectDeliveryContract(workspace)
  if (!delivery.valid) issues.push(...delivery.issues.map(issue => `Delivery contract: ${issue}`))

  const assets = auditAssetContract(workspace)
  if (!assets.valid) issues.push(...assets.issues.map(issue => `Asset contract: ${issue}`))

  return { valid: issues.length === 0, issues: [...new Set(issues)] }
}

export function evaluateProductionMutationGate(input: {
  workspacePath: string
  productionContractRequired: boolean
  toolName: string
  toolInput: Record<string, unknown>
  toolReadOnly: boolean
}): ProductionMutationGateResult {
  if (
    input.productionContractRequired &&
    input.toolName === 'Agent' &&
    input.toolInput.subagent_type === PRODUCTION_REVIEWER_AGENT_TYPE
  ) {
    const bundle = auditGameProductionDocumentBundle(input.workspacePath)
    if (!bundle.valid) {
      return {
        allowed: false,
        message: [
          'Production document review is blocked until the deterministic document, delivery-contract, and asset-contract checks pass.',
          ...formatIssuesForTool(bundle.issues),
        ].join('\n'),
      }
    }
  }

  if (!input.productionContractRequired || input.toolReadOnly) return { allowed: true }

  if (!STRUCTURED_MUTATION_TOOLS.has(input.toolName)) {
    if (!input.productionContractRequired || input.toolName !== 'Bash') {
      return { allowed: true }
    }
    const audit = auditGameProductionReadiness(input.workspacePath)
    return audit.valid ? { allowed: true } : blockedDecision(audit)
  }

  const targetPaths = TOOL_PATH_FIELDS
    .map(field => input.toolInput[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (targetPaths.length === 0) return { allowed: true }

  const workspace = resolve(input.workspacePath)
  const normalizedTargets = targetPaths.map(targetPath => workspaceRelativePath(workspace, targetPath))
  if (normalizedTargets.some(path => path && HOST_OWNED_PRODUCTION_FILES.has(path))) {
    return {
      allowed: false,
      message: 'docs/production-brief.json is immutable host-materialized user input and cannot be modified by the Agent.',
    }
  }
  const writesOnlyPlanningArtifacts = targetPaths.every(targetPath => {
    const normalized = workspaceRelativePath(workspace, targetPath)
    return normalized !== null && (
      PLANNING_WRITE_FILES.has(normalized) ||
      PLANNING_WRITE_ROOTS.some(root => normalized.startsWith(root))
    )
  })
  if (writesOnlyPlanningArtifacts) return { allowed: true }

  const audit = auditGameProductionReadiness(workspace)
  if (audit.valid) return { allowed: true }
  return blockedDecision(audit)
}

function blockedDecision(audit: GameProductionReadinessAudit): ProductionMutationGateResult {
  return {
    allowed: false,
    message: [
      'Game implementation is blocked until the production bundle, canonical asset manifest, delivery contract, and one persisted implementation plan are valid.',
      ...formatIssuesForTool(audit.issues),
    ].join('\n'),
  }
}

function formatIssuesForTool(issues: readonly string[], limit = 40): string[] {
  const visible = issues.slice(0, limit).map(issue => `- ${issue}`)
  const remaining = issues.length - visible.length
  return remaining > 0
    ? [...visible, `- ${remaining} additional issue(s) omitted from this tool response; rerun the deterministic check after fixing the reported contract pattern.`]
    : visible
}

function listImplementationPlans(workspace: string): string[] {
  const directory = resolve(workspace, GAME_PRODUCTION_PLAN_DIRECTORY)
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => `${GAME_PRODUCTION_PLAN_DIRECTORY}${entry.name}`)
    .filter(path => isNonEmptyFile(resolve(workspace, path)))
    .sort()
}

function auditImplementationPlan(workspace: string, planPath: string): string[] {
  const issues: string[] = []
  const indexPath = resolve(workspace, GAME_PRODUCTION_PLAN_INDEX_PATH)
  if (!isNonEmptyFile(indexPath)) {
    return [`Machine-readable implementation plan index is missing or empty: ${GAME_PRODUCTION_PLAN_INDEX_PATH}`]
  }

  const delivery = auditProjectDeliveryContract(workspace)
  if (!delivery.valid) return []

  try {
    const value = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
    if (!isRecord(value) || value.version !== 1) {
      return [`${GAME_PRODUCTION_PLAN_INDEX_PATH} version must be 1.`]
    }
    if (normalizedString(value.planPath) !== planPath) {
      issues.push(`${GAME_PRODUCTION_PLAN_INDEX_PATH} planPath must reference the single persisted markdown plan.`)
    }
    if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
      issues.push(`${GAME_PRODUCTION_PLAN_INDEX_PATH} tasks must be a non-empty array.`)
      return issues
    }

    const knownRequirementIds = new Set(delivery.requirements.map(requirement => requirement.id))
    const mvpRequirementIds = delivery.requirements
      .filter(requirement => requirement.scope === 'mvp')
      .map(requirement => requirement.id)
    const knownPlayerPathIds = new Set(delivery.playerPathIds)
    const coveredRequirementIds = new Set<string>()
    const coveredPlayerPathIds = new Set<string>()
    const plannedEvidenceByRequirement = new Map<string, Set<DeliveryEvidenceKind>>()
    const runtimeCheckedPlayerPathIds = new Set<string>()
    const taskIds = new Set<string>()

    for (const [index, task] of value.tasks.entries()) {
      if (!isRecord(task)) {
        issues.push(`Implementation plan task ${index} must be an object.`)
        continue
      }
      const id = normalizedString(task.id)
      if (!id || taskIds.has(id)) {
        issues.push(`Implementation plan task ${index} must have a unique stable id.`)
      } else {
        taskIds.add(id)
      }
      const requirementIds = stringArray(task.requirementIds)
      const playerPathIds = stringArray(task.playerPathIds)
      if (requirementIds.length === 0 || requirementIds.some(item => !knownRequirementIds.has(item))) {
        issues.push(`Implementation plan task ${id || index} must reference existing requirement ids.`)
      }
      if (playerPathIds.some(item => !knownPlayerPathIds.has(item))) {
        issues.push(`Implementation plan task ${id || index} references an unknown player path id.`)
      }
      requirementIds.forEach(item => coveredRequirementIds.add(item))
      playerPathIds.forEach(item => coveredPlayerPathIds.add(item))

      if (!isProjectPathArray(workspace, task.files, false)) {
        issues.push(`Implementation plan task ${id || index} must declare non-empty project-relative files.`)
      }
      if (!isProjectPathArray(workspace, task.assetSlotIds, true, false)) {
        issues.push(`Implementation plan task ${id || index} assetSlotIds must be an array of unique non-empty ids.`)
      }
      for (const field of ['preconditions', 'actions', 'assertions'] as const) {
        if (!isStructuredList(task[field])) {
          issues.push(`Implementation plan task ${id || index} must declare structured ${field}.`)
        }
      }
      if (!isRecord(task.check) || !normalizedString(task.check.command) || !isStructuredList(task.check.assertions)) {
        issues.push(`Implementation plan task ${id || index} must declare a focused command and observable check assertions.`)
      } else {
        const evidenceKinds = evidenceKindArray(task.check.evidenceKinds)
        if (
          !Array.isArray(task.check.evidenceKinds) ||
          evidenceKinds.length === 0 ||
          evidenceKinds.length !== task.check.evidenceKinds.length
        ) {
          issues.push(`Implementation plan task ${id || index} check must declare unique supported evidenceKinds.`)
        }
        for (const requirementId of requirementIds) {
          const planned = plannedEvidenceByRequirement.get(requirementId) ?? new Set<DeliveryEvidenceKind>()
          evidenceKinds.forEach(kind => planned.add(kind))
          plannedEvidenceByRequirement.set(requirementId, planned)
        }
        if (evidenceKinds.includes('runtime')) {
          playerPathIds.forEach(item => runtimeCheckedPlayerPathIds.add(item))
        }
      }
    }

    const firstTask = value.tasks[0]
    if (!isRecord(firstTask) || stringArray(firstTask.playerPathIds).length === 0) {
      issues.push('The first implementation plan task must reference at least one player path for the smallest playable vertical slice.')
    }
    const uncoveredRequirements = mvpRequirementIds.filter(id => !coveredRequirementIds.has(id))
    if (uncoveredRequirements.length > 0) {
      issues.push(`Implementation plan must cover every MVP requirement: ${uncoveredRequirements.join(', ')}`)
    }
    const uncoveredPlayerPaths = delivery.playerPathIds.filter(id => !coveredPlayerPathIds.has(id))
    if (uncoveredPlayerPaths.length > 0) {
      issues.push(`Implementation plan must cover every player path: ${uncoveredPlayerPaths.join(', ')}`)
    }
    for (const requirement of delivery.requirements.filter(item => item.scope === 'mvp')) {
      const planned = plannedEvidenceByRequirement.get(requirement.id) ?? new Set<DeliveryEvidenceKind>()
      const missing = requirement.evidenceRequired.filter(kind => !planned.has(kind))
      if (missing.length > 0) {
        issues.push(`Implementation plan checks for ${requirement.id} do not cover required evidence kinds: ${missing.join(', ')}`)
      }
    }
    const playerPathsWithoutRuntimeCheck = delivery.playerPathIds.filter(id => !runtimeCheckedPlayerPathIds.has(id))
    if (playerPathsWithoutRuntimeCheck.length > 0) {
      issues.push(`Every player path must be covered by a plan check that declares runtime evidence: ${playerPathsWithoutRuntimeCheck.join(', ')}`)
    }
  } catch (error) {
    issues.push(`${GAME_PRODUCTION_PLAN_INDEX_PATH} could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }

  issues.push(...auditPlanMarkdown(resolve(workspace, planPath)))
  return issues
}

function auditPlanMarkdown(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  const issues: string[] = []
  let inFence = false
  let currentFenceLines = 0
  let totalFenceLines = 0
  let largestFenceLines = 0
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inFence) largestFenceLines = Math.max(largestFenceLines, currentFenceLines)
      inFence = !inFence
      currentFenceLines = 0
      continue
    }
    if (!inFence) continue
    currentFenceLines += 1
    totalFenceLines += 1
  }
  if (inFence) {
    largestFenceLines = Math.max(largestFenceLines, currentFenceLines)
    issues.push('Implementation plan contains an unclosed fenced block.')
  }
  if (largestFenceLines > 40) {
    issues.push('Implementation plan contains a fenced code block longer than 40 lines; move complete source into implementation tasks.')
  }
  if (totalFenceLines > 200) {
    issues.push('Implementation plan contains more than 200 fenced code lines; it must remain a concise requirement-to-evidence index.')
  }
  return issues
}

function isProjectPathArray(
  workspace: string,
  value: unknown,
  allowEmpty: boolean,
  validatePaths = true,
): boolean {
  const values = stringArray(value)
  if (!Array.isArray(value) || values.length !== value.length || (!allowEmpty && values.length === 0)) return false
  if (!validatePaths) return true
  return values.every(item => {
    if (isAbsolute(item)) return false
    const absolute = resolve(workspace, item)
    return isWorkspacePath(workspace, absolute)
  })
}

function isStructuredList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(item => (
    isRecord(item) && normalizedString(item.description).length > 0
  ))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(normalizedString).filter(Boolean))]
    : []
}

function evidenceKindArray(value: unknown): DeliveryEvidenceKind[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is DeliveryEvidenceKind => PLAN_EVIDENCE_KINDS.has(item as DeliveryEvidenceKind)))]
    : []
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyFile(path: string): boolean {
  try {
    return statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}

function workspaceRelativePath(workspace: string, value: string): string | null {
  const absolutePath = isAbsolute(value) ? resolve(value) : resolve(workspace, value)
  if (!isWorkspacePath(workspace, absolutePath)) return null
  return relative(workspace, absolutePath).split('\\').join('/')
}

function isWorkspacePath(workspace: string, target: string): boolean {
  const pathFromWorkspace = relative(workspace, target)
  return pathFromWorkspace !== '' &&
    pathFromWorkspace !== '..' &&
    !pathFromWorkspace.startsWith('../') &&
    !pathFromWorkspace.startsWith('..\\') &&
    !isAbsolute(pathFromWorkspace)
}
