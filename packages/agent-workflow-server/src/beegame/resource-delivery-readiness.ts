import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import { auditAssetContract } from './asset-contract-audit'
import {
  parseCanonicalBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './asset-contracts'
import type { NativeResourceLibraryEvidenceState } from './native-resource-library-evidence'

export type ResourceDeliveryReadiness = {
  valid: boolean
  issues: string[]
  ready: boolean
  readinessIssues: string[]
  confirmedPolicy?: ResourceLibraryUsage
  manifestPolicy?: ResourceLibraryUsage
  targetFormats: string[]
  requirementCount: number
  coveredRequirementCount: number
  resourceCount: number
  libraryResourceCount: number
  authoredResourceCount: number
  provisionalResourceCount: number
  failedResourceCount: number
  contentFileCount: number
  resourceEvidenceState: NativeResourceLibraryEvidenceState['state']
  failedActions: string[]
}

export function confirmedResourceLibraryUsage(
  confirmedBriefContext?: string,
): ResourceLibraryUsage | undefined {
  if (!confirmedBriefContext?.trim()) return undefined
  try {
    const parsed = JSON.parse(confirmedBriefContext) as unknown
    if (!isRecord(parsed)) return undefined
    return parsePolicy(parsed.resource_library_usage)
  } catch {
    return undefined
  }
}

export function auditResourceDeliveryReadiness(input: {
  workspacePath: string
  confirmedPolicy?: ResourceLibraryUsage
  resourceEvidence?: NativeResourceLibraryEvidenceState
}): ResourceDeliveryReadiness {
  const issues: string[] = []
  const readinessIssues: string[] = []
  const contract = auditAssetContract(input.workspacePath)
  if (!contract.present) issues.push('assets/asset-manifest.json is missing.')
  else if (!contract.valid)
    issues.push(...contract.issues.map(issue => `resource-content contract: ${issue}`))
  const manifest = readManifest(input.workspacePath)
  const policy = manifest?.project_target?.resource_library_usage
  const targetFormats = manifest?.project_target?.asset_format_capabilities ?? []
  const requirements = manifest?.requirements ?? []
  const resources = manifest?.resources ?? []
  const libraryResourceCount = resources.filter(item => item.source.type === 'resource-library').length
  const authoredResourceCount = resources.filter(item => item.source.type === 'agent-authored').length
  const provisionalResourceCount = resources.filter(item => item.provisional).length
  const failedResourceCount = resources.filter(item => item.status === 'failed').length
  const evidence = input.resourceEvidence ?? { state: 'missing' as const }
  const failedActions = evidence.state === 'missing' ? [] : evidence.failedActions

  if (input.confirmedPolicy && policy !== input.confirmedPolicy)
    issues.push(`project_target.resource_library_usage (${policy ?? 'missing'}) does not preserve the confirmed policy (${input.confirmedPolicy}).`)
  if (!targetFormats.length)
    issues.push('project_target.asset_format_capabilities must describe the target runtime.')
  if (failedResourceCount) readinessIssues.push(`${failedResourceCount} resources are failed.`)

  const effectivePolicy = input.confirmedPolicy ?? policy
  if (effectivePolicy === 'required' && libraryResourceCount === 0)
    readinessIssues.push('Required Resource Library usage has no verified library resource.')
  if (
    effectivePolicy === 'preferred' &&
    libraryResourceCount === 0 &&
    (evidence.state !== 'current' || !evidence.actions.includes('browse_catalog'))
  )
    readinessIssues.push('Preferred Resource Library usage requires current catalog exploration before an authored-only inventory can be accepted.')

  return {
    valid: issues.length === 0,
    issues,
    ready: issues.length === 0 && readinessIssues.length === 0,
    readinessIssues,
    ...(input.confirmedPolicy ? { confirmedPolicy: input.confirmedPolicy } : {}),
    ...(policy ? { manifestPolicy: policy } : {}),
    targetFormats,
    requirementCount: requirements.length,
    coveredRequirementCount: contract.content.coveredRequirementIds.length,
    resourceCount: resources.length,
    libraryResourceCount,
    authoredResourceCount,
    provisionalResourceCount,
    failedResourceCount,
    contentFileCount: contract.content.files.length,
    resourceEvidenceState: evidence.state,
    failedActions,
  }
}

function readManifest(workspacePath: string): BeeGameAssetManifest | undefined {
  const path = join(resolve(workspacePath), 'assets', 'asset-manifest.json')
  if (!existsSync(path)) return undefined
  try {
    return parseCanonicalBeeGameAssetManifest(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

function parsePolicy(value: unknown): ResourceLibraryUsage | undefined {
  return value === 'optional' || value === 'preferred' || value === 'required' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
