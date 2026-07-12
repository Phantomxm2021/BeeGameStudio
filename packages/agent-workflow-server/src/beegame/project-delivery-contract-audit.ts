import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DeliveryEvidenceKind } from './delivery-contract'

export type ProjectDeliveryContractRequirement = {
  id: string
  title: string
  scope: 'mvp' | 'roadmap'
  evidenceRequired: DeliveryEvidenceKind[]
}

export type ProjectDeliveryContractAudit = {
  present: boolean
  valid: boolean
  path: string
  requirements: ProjectDeliveryContractRequirement[]
  requiredCapabilities: string[]
  playerPathIds: string[]
  issues: string[]
}

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
      issues: ['docs/delivery-contract.json is required before implementation can be accepted.'],
    }
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value) || value.version !== 1) return invalid(path, ['Delivery contract version must be 1.'])
    const issues: string[] = []
    const requirements = parseRequirements(value.requirements, issues)
    const playerPathIds = parsePlayerPaths(value.playerPaths, requirements, issues)
    const requiredCapabilities = stringArray(value.requiredCapabilities)
    if (requirements.filter(item => item.scope === 'mvp').length === 0) issues.push('At least one MVP requirement is required.')
    if (playerPathIds.length === 0) issues.push('At least one structured player path is required.')
    return {
      present: true,
      valid: issues.length === 0,
      path,
      requirements,
      requiredCapabilities,
      playerPathIds,
      issues,
    }
  } catch (error) {
    return invalid(path, [`Delivery contract could not be parsed: ${error instanceof Error ? error.message : String(error)}`])
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
    const id = normalizedString(item.id)
    const title = normalizedString(item.title)
    const scope = item.scope
    const evidenceRequired = Array.isArray(item.evidenceRequired)
      ? item.evidenceRequired.filter(isEvidenceKind)
      : []
    if (!id || !title || (scope !== 'mvp' && scope !== 'roadmap')) {
      issues.push(`Requirement ${index} must declare id, title, and mvp/roadmap scope.`)
      continue
    }
    if (ids.has(id)) issues.push(`Requirement id is duplicated: ${id}`)
    if (!Array.isArray(item.evidenceRequired) || evidenceRequired.length !== item.evidenceRequired.length || evidenceRequired.length === 0) {
      issues.push(`Requirement ${id} must declare supported evidenceRequired values.`)
    }
    ids.add(id)
    requirements.push({ id, title, scope, evidenceRequired })
  }
  return requirements
}

function parsePlayerPaths(
  value: unknown,
  requirements: ProjectDeliveryContractRequirement[],
  issues: string[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push('playerPaths must be an array.')
    return []
  }
  const requirementIds = new Set(requirements.map(item => item.id))
  const ids = new Set<string>()
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
    if (coveredRequirements.length === 0 || coveredRequirements.some(requirementId => !requirementIds.has(requirementId))) {
      issues.push(`Player path ${id} must reference existing requirement ids.`)
    }
    const phases = isRecord(item.phases) ? item.phases : {}
    for (const phase of PLAYER_PATH_PHASES) {
      const entries = phases[phase]
      if (!Array.isArray(entries) || entries.length === 0 || entries.some(entry => !isRecord(entry))) {
        issues.push(`Player path ${id} must declare structured ${phase} actions/assertions.`)
      }
    }
  }
  return [...ids]
}

function invalid(path: string, issues: string[]): ProjectDeliveryContractAudit {
  return { present: true, valid: false, path, requirements: [], requiredCapabilities: [], playerPathIds: [], issues }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(normalizedString).filter(Boolean))] : []
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
