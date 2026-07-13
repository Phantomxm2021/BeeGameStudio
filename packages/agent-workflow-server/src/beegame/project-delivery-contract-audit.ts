import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { DeliveryEvidenceKind } from './delivery-contract'

export type ProjectDeliveryContractRequirement = {
  id: string
  title: string
  scope: 'mvp' | 'roadmap'
  evidenceRequired: DeliveryEvidenceKind[]
  sourceRefs: Array<{ path: string; locator: string }>
}

export type ProjectDeliveryContractAudit = {
  present: boolean
  valid: boolean
  path: string
  requirements: ProjectDeliveryContractRequirement[]
  requiredCapabilities: string[]
  playerPathIds: string[]
  playerPathRequirementIds: string[]
  playerPathRequirements: Record<string, string[]>
  issues: string[]
}

const CAPABILITY_PREFIXES = ['skill:', 'adapter:'] as const

const EVIDENCE_KINDS = new Set<DeliveryEvidenceKind>([
  'implementation', 'build', 'test', 'runtime', 'asset', 'skill', 'document',
])

const PLAYER_PATH_PHASES = [
  'entry',
  'core_action',
  'state_change',
  'completion',
  'recovery',
] as const

export function auditProjectDeliveryContract(workspacePath: string): ProjectDeliveryContractAudit {
  const path = resolve(workspacePath, 'docs', 'delivery-contract.json')
  if (!existsSync(path)) {
    return {
      present: false,
      valid: false,
      path,
      requirements: [],
      requiredCapabilities: [],
      playerPathIds: [],
      playerPathRequirementIds: [],
      playerPathRequirements: {},
      issues: ['docs/delivery-contract.json is required before implementation can be accepted.'],
    }
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value) || value.version !== 1) return invalid(path, ['Delivery contract version must be 1.'])
    const issues: string[] = []
    rejectValidationOutcomes(value, 'Delivery contract', issues)
    const requirements = parseRequirements(value.requirements, issues)
    validateRequirementSources(workspacePath, requirements, issues)
    const playerPaths = parsePlayerPaths(value.playerPaths, requirements, issues)
    const requiredCapabilities = parseRequiredCapabilities(value.requiredCapabilities, issues)
    if (requirements.filter(item => item.scope === 'mvp').length === 0) issues.push('At least one MVP requirement is required.')
    if (playerPaths.ids.length === 0) issues.push('At least one structured player path is required.')
    const runtimeRequirementIds = requirements
      .filter(item => item.scope === 'mvp' && item.evidenceRequired.includes('runtime'))
      .map(item => item.id)
    const uncoveredRuntimeRequirements = runtimeRequirementIds.filter(id => !playerPaths.requirementIds.includes(id))
    if (uncoveredRuntimeRequirements.length > 0) {
      issues.push(`Every runtime MVP requirement must be covered by a player path: ${uncoveredRuntimeRequirements.join(', ')}`)
    }
    return {
      present: true,
      valid: issues.length === 0,
      path,
      requirements,
      requiredCapabilities,
      playerPathIds: playerPaths.ids,
      playerPathRequirementIds: playerPaths.requirementIds,
      playerPathRequirements: playerPaths.requirements,
      issues,
    }
  } catch (error) {
    return invalid(path, [`Delivery contract could not be parsed: ${error instanceof Error ? error.message : String(error)}`])
  }
}

function validateRequirementSources(
  workspacePath: string,
  requirements: ProjectDeliveryContractRequirement[],
  issues: string[],
): void {
  const root = resolve(workspacePath)
  for (const requirement of requirements) {
    for (const sourceRef of requirement.sourceRefs) {
      const sourcePath = resolve(root, sourceRef.path)
      const relativePath = relative(root, sourcePath)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        issues.push(`Requirement ${requirement.id} sourceRef escapes the project workspace: ${sourceRef.path}`)
      } else if (!existsSync(sourcePath)) {
        issues.push(`Requirement ${requirement.id} sourceRef does not exist: ${sourceRef.path}`)
      } else if (relativePath.split('\\').join('/') === 'docs/delivery-contract.json') {
        issues.push(`Requirement ${requirement.id} sourceRef must not reference the delivery contract itself.`)
      } else {
        const source = readFileSync(sourcePath, 'utf8')
        if (!source.includes(sourceRef.locator)) {
          issues.push(`Requirement ${requirement.id} sourceRef locator does not exist in ${sourceRef.path}: ${sourceRef.locator}`)
        }
      }
    }
  }
}

function parseRequirements(value: unknown, issues: string[]): ProjectDeliveryContractRequirement[] {
  if (!Array.isArray(value)) {
    issues.push('requirements must be an array.')
    return []
  }
  const ids = new Set<string>()
  const requirements: ProjectDeliveryContractRequirement[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`Requirement ${index} must be an object.`)
      continue
    }
    rejectValidationOutcomes(item, `Requirement ${index}`, issues)
    const id = normalizedString(item.id)
    const title = normalizedString(item.title)
    const scope = item.scope
    const evidenceRequired = Array.isArray(item.evidenceRequired)
      ? item.evidenceRequired.filter(isEvidenceKind)
      : []
    const sourceRefs = parseSourceRefs(item.sourceRefs, id || String(index), issues)
    if (!id || !title || (scope !== 'mvp' && scope !== 'roadmap')) {
      issues.push(`Requirement ${index} must declare id, title, and mvp/roadmap scope.`)
      continue
    }
    if (ids.has(id)) issues.push(`Requirement id is duplicated: ${id}`)
    if (!Array.isArray(item.evidenceRequired) || evidenceRequired.length !== item.evidenceRequired.length || evidenceRequired.length === 0) {
      issues.push(`Requirement ${id} must declare supported evidenceRequired values.`)
    }
    ids.add(id)
    requirements.push({ id, title, scope, evidenceRequired, sourceRefs })
  }
  return requirements
}

function parseSourceRefs(
  value: unknown,
  requirementId: string,
  issues: string[],
): Array<{ path: string; locator: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`Requirement ${requirementId} must declare at least one sourceRefs entry.`)
    return []
  }
  const refs: Array<{ path: string; locator: string }> = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`Requirement ${requirementId} sourceRefs[${index}] must be an object.`)
      continue
    }
    const path = normalizedString(item.path)
    const locator = normalizedString(item.locator)
    if (!path || !locator || isAbsolute(path)) {
      issues.push(`Requirement ${requirementId} sourceRefs[${index}] must declare a relative path and locator.`)
      continue
    }
    if (path.split('\\').join('/') === 'docs/delivery-contract.json') {
      issues.push(`Requirement ${requirementId} sourceRefs[${index}] must reference an approved source document, not the delivery contract itself.`)
      continue
    }
    refs.push({ path, locator })
  }
  return refs
}

const VALIDATION_OUTCOME_FIELDS = [
  'status',
  'evidence',
  'verifiedCapabilities',
  'acceptedAt',
  'validatedAt',
] as const

function rejectValidationOutcomes(value: Record<string, unknown>, label: string, issues: string[]): void {
  const fields = VALIDATION_OUTCOME_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(value, field))
  if (fields.length > 0) {
    issues.push(`${label} must not declare validator-owned outcome fields: ${fields.join(', ')}.`)
  }
}

function parsePlayerPaths(
  value: unknown,
  requirements: ProjectDeliveryContractRequirement[],
  issues: string[],
): { ids: string[]; requirementIds: string[]; requirements: Record<string, string[]> } {
  if (!Array.isArray(value)) {
    issues.push('playerPaths must be an array.')
    return { ids: [], requirementIds: [], requirements: {} }
  }
  const requirementIds = new Set(requirements.map(item => item.id))
  const ids = new Set<string>()
  const referencedRequirementIds = new Set<string>()
  const playerPathRequirements: Record<string, string[]> = {}
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`Player path ${index} must be an object.`)
      continue
    }
    const id = normalizedString(item.id)
    if (!id || ids.has(id)) {
      issues.push(`Player path ${index} must have a unique stable id.`)
      continue
    }
    ids.add(id)
    const coveredRequirements = stringArray(item.requirementIds)
    playerPathRequirements[id] = coveredRequirements
    if (coveredRequirements.length === 0 || coveredRequirements.some(requirementId => !requirementIds.has(requirementId))) {
      issues.push(`Player path ${id} must reference existing requirement ids.`)
    }
    for (const requirementId of coveredRequirements) referencedRequirementIds.add(requirementId)
    const phases = isRecord(item.phases) ? item.phases : {}
    for (const phase of PLAYER_PATH_PHASES) {
      const entries = phases[phase]
      if (!Array.isArray(entries) || entries.length === 0 || entries.some(entry => !isPlayerPathStep(entry))) {
        issues.push(`Player path ${id} must declare structured ${phase} actions/assertions.`)
      }
    }
  }
  return { ids: [...ids], requirementIds: [...referencedRequirementIds], requirements: playerPathRequirements }
}

function isPlayerPathStep(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.action) || Object.keys(value.action).length === 0) return false
  return Array.isArray(value.assertions) &&
    value.assertions.length > 0 &&
    value.assertions.every(assertion => isRecord(assertion) && Object.keys(assertion).length > 0)
}

function invalid(path: string, issues: string[]): ProjectDeliveryContractAudit {
  return { present: true, valid: false, path, requirements: [], requiredCapabilities: [], playerPathIds: [], playerPathRequirementIds: [], playerPathRequirements: {}, issues }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(normalizedString).filter(Boolean))] : []
}

function parseRequiredCapabilities(value: unknown, issues: string[]): string[] {
  const capabilities = stringArray(value)
  if (!Array.isArray(value) || capabilities.length !== value.length) {
    issues.push('requiredCapabilities must be an array of unique non-empty capability ids.')
  }
  const unsupported = capabilities.filter(capability => (
    !CAPABILITY_PREFIXES.some(prefix => capability.startsWith(prefix)) ||
    capability.endsWith(':')
  ))
  if (unsupported.length > 0) {
    issues.push(`requiredCapabilities may reference only registered skill:* or adapter:* ids: ${unsupported.join(', ')}`)
  }
  return capabilities
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isEvidenceKind(value: unknown): value is DeliveryEvidenceKind {
  return EVIDENCE_KINDS.has(value as DeliveryEvidenceKind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
