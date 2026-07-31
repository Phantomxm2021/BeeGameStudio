import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import type { NativeResourceLibraryEvidenceState } from './native-resource-library-evidence'
import { auditAssetContract } from './asset-contract-audit'

export type ResourceDeliveryReadiness = {
  /** The resource plan is structurally usable for document review. */
  valid: boolean
  issues: string[]
  /** Runtime integration is complete enough for implementation audit. */
  integrationReady: boolean
  integrationIssues: string[]
  confirmedPolicy?: ResourceLibraryUsage
  manifestPolicy?: ResourceLibraryUsage
  targetFormats: string[]
  importCount: number
  referencedImportCount: number
  requirementCount: number
  pendingRequirementCount: number
  blockedRequiredRequirementCount: number
  compositionCount: number
  pendingCompositionCount: number
  integratedCompositionCount: number
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

/**
 * Audits only deterministic resource-contract facts. It never selects a Pack,
 * imports a file, advances an Agent phase, or interprets game semantics.
 */
export function auditResourceDeliveryReadiness(input: {
  workspacePath: string
  confirmedPolicy?: ResourceLibraryUsage
  resourceEvidence?: NativeResourceLibraryEvidenceState
}): ResourceDeliveryReadiness {
  const issues: string[] = []
  const assetContract = auditAssetContract(input.workspacePath)
  if (!assetContract.valid) {
    issues.push(...assetContract.issues.map(issue =>
      `assets/asset-manifest.json: ${issue}`
    ))
  }
  const manifest = readManifest(input.workspacePath)
  const projectTarget = isRecord(manifest?.project_target)
    ? manifest.project_target
    : undefined
  const manifestPolicy = parsePolicy(projectTarget?.resource_library_usage)
  const targetFormats = stringArray(projectTarget?.asset_format_capabilities)
  const importCount = Array.isArray(manifest?.imports)
    ? manifest.imports.length
    : 0
  const imports = Array.isArray(manifest?.imports)
    ? manifest.imports.filter(isRecord)
    : []
  const requirements = Array.isArray(manifest?.requirements)
    ? manifest.requirements.filter(isRecord)
    : []
  const requiredRequirements = requirements.filter(
    requirement => requirement.required !== false,
  )
  const requiredSourceDecisionsComplete =
    requiredRequirements.length > 0 &&
    requiredRequirements.every(
      requirement =>
        !isRecord(requirement.resource_requirement) &&
        isRecord(requirement.source_decision),
    )
  const zeroImportDecisionsAuditable = requiredRequirements.every(
    requirement => {
      const decision = isRecord(requirement.source_decision)
        ? requirement.source_decision
        : undefined
      if (!decision) return false
      if (decision.basis === 'approved-project-plan') return true
      if (decision.basis !== 'catalog-no-match') return false
      const receipt = isRecord(decision.discovery_receipt)
        ? decision.discovery_receipt
        : undefined
      if (
        !receipt ||
        receipt.version !== 1 ||
        receipt.decision_ready !== true ||
        !Number.isInteger(receipt.structured_constraint_count) ||
        Number(receipt.structured_constraint_count) < 2 ||
        !Array.isArray(receipt.inspected_pack_ids) ||
        !Array.isArray(receipt.represented_pack_ids) ||
        !Array.isArray(receipt.candidate_ids) ||
        receipt.inspected_pack_ids.length !==
          receipt.represented_pack_ids.length ||
        receipt.candidate_ids.length !== Number(receipt.candidate_count) ||
        Number(receipt.total_compatible) !== Number(receipt.candidate_count)
      )
        return false
      return true
    },
  )
  const compositions = Array.isArray(manifest?.compositions)
    ? manifest.compositions.filter(isRecord)
    : []
  const referencedImportCount = imports.filter(item => item.status === 'referenced').length
  const pendingRequirementCount = requirements.filter(item => item.status === 'planned').length
  const blockedRequiredRequirementCount = requirements.filter(item =>
    item.status === 'blocked' && item.required !== false
  ).length
  const pendingCompositionCount = compositions.filter(item =>
    item.status === 'planned' || item.status === 'assembled'
  ).length
  const integratedCompositionCount = compositions.filter(item => item.status === 'integrated').length
  const resourceEvidence = input.resourceEvidence ?? {
    state: 'missing' as const,
  }
  const failedActions =
    resourceEvidence.state === 'missing'
      ? []
      : resourceEvidence.failedActions.filter(action =>
          [
            'import_elements',
            'record_no_match',
            'refresh_import_metadata',
          ].includes(action),
        )
  const failedImportCount =
    resourceEvidence.state === 'missing' ? 0 : resourceEvidence.failedImportCount
  const integrationIssues: string[] = []

  if (input.confirmedPolicy && manifestPolicy !== input.confirmedPolicy) {
    issues.push(
      `assets/asset-manifest.json: project_target.resource_library_usage (${manifestPolicy ?? 'missing'}) does not preserve the user-confirmed policy (${input.confirmedPolicy}).`,
    )
  }

  const effectivePolicy = input.confirmedPolicy ?? manifestPolicy
  if (effectivePolicy === 'preferred' || effectivePolicy === 'required') {
    if (targetFormats.length === 0) {
      issues.push(
        'assets/asset-manifest.json: project_target.asset_format_capabilities must declare the actual formats accepted by the target runtime before Resource Library import.',
      )
    }
    if (importCount === 0 && !requiredSourceDecisionsComplete) {
      issues.push(
        `assets/asset-manifest.json: ${effectivePolicy} Resource Library usage has no imported resource artifacts in the current manifest.`,
      )
    }
    if (
      effectivePolicy === 'preferred' &&
      importCount === 0 &&
      requiredSourceDecisionsComplete &&
      !zeroImportDecisionsAuditable
    ) {
      issues.push(
        'assets/asset-manifest.json: preferred Resource Library usage has zero imports without complete structured no-match receipts or an explicitly approved project plan.',
      )
    }
    if (importCount > 0 && resourceEvidence.state === 'missing') {
      integrationIssues.push(
        'Resource Library: imported artifacts exist, but no current native ResourceLibrary provenance was observed for this session.',
      )
    }
    if (importCount > 0 && resourceEvidence.state === 'stale') {
      integrationIssues.push(
        'Resource Library: the latest native ResourceLibrary provenance belongs to an older art or target context.',
      )
    }
    if (failedImportCount > 0) {
      integrationIssues.push(
        `Resource Library: ${failedImportCount} explicitly requested imports remain unresolved after the latest native operations.`,
      )
    }
    if (failedActions.length > 0) {
      issues.push(
        `Resource Library: unresolved failed native actions for the current resource context: ${failedActions.join(', ')}.`,
      )
    }
  }

  if (pendingRequirementCount > 0) {
    integrationIssues.push(
      `assets/asset-manifest.json: ${pendingRequirementCount} resource requirements are still planned. Before implementation audit, each declared responsibility must be satisfied or explicitly blocked.`,
    )
  }
  if (blockedRequiredRequirementCount > 0) {
    integrationIssues.push(
      `assets/asset-manifest.json: ${blockedRequiredRequirementCount} required resource requirements are blocked.`,
    )
  }
  if (pendingCompositionCount > 0) {
    integrationIssues.push(
      `assets/asset-manifest.json: ${pendingCompositionCount} target-native compositions are not integrated.`,
    )
  }
  if (
    (effectivePolicy === 'preferred' || effectivePolicy === 'required') &&
    importCount > 0 &&
    referencedImportCount === 0 &&
    integratedCompositionCount === 0
  ) {
    integrationIssues.push(
      'assets/asset-manifest.json: Resource Library files were copied, but no import or composition has target-runtime integration evidence.',
    )
  }

  return {
    valid: issues.length === 0,
    issues,
    integrationReady: issues.length === 0 && integrationIssues.length === 0,
    integrationIssues,
    ...(input.confirmedPolicy
      ? { confirmedPolicy: input.confirmedPolicy }
      : {}),
    ...(manifestPolicy ? { manifestPolicy } : {}),
    targetFormats,
    importCount,
    referencedImportCount,
    requirementCount: requirements.length,
    pendingRequirementCount,
    blockedRequiredRequirementCount,
    compositionCount: compositions.length,
    pendingCompositionCount,
    integratedCompositionCount,
    resourceEvidenceState: resourceEvidence.state,
    failedActions,
  }
}

function readManifest(
  workspacePath: string,
): Record<string, unknown> | undefined {
  const path = join(resolve(workspacePath), 'assets', 'asset-manifest.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parsePolicy(value: unknown): ResourceLibraryUsage | undefined {
  return value === 'optional' || value === 'preferred' || value === 'required'
    ? value
    : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.flatMap(item =>
        typeof item === 'string' && item.trim() ? [item.trim()] : [],
      ),
    ),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
