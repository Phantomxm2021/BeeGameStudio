import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import type { NativeResourceLibraryEvidenceState } from './native-resource-library-evidence'

export type ResourceDeliveryReadiness = {
  valid: boolean
  issues: string[]
  confirmedPolicy?: ResourceLibraryUsage
  manifestPolicy?: ResourceLibraryUsage
  targetFormats: string[]
  importCount: number
  resourceEvidenceState: NativeResourceLibraryEvidenceState['state']
  failedActions: string[]
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
  const manifest = readManifest(input.workspacePath)
  const projectTarget = isRecord(manifest?.project_target)
    ? manifest.project_target
    : undefined
  const manifestPolicy = parsePolicy(projectTarget?.resource_library_usage)
  const targetFormats = stringArray(projectTarget?.asset_format_capabilities)
  const importCount = Array.isArray(manifest?.imports)
    ? manifest.imports.length
    : 0
  const resourceEvidence = input.resourceEvidence ?? {
    state: 'missing' as const,
  }
  const failedActions =
    resourceEvidence.state === 'missing' ? [] : resourceEvidence.failedActions

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
    if (importCount === 0) {
      issues.push(
        `assets/asset-manifest.json: ${effectivePolicy} Resource Library usage has no imported resource artifacts in the current manifest.`,
      )
    }
    if (failedActions.length > 0) {
      issues.push(
        `Resource Library: unresolved failed native actions for the current resource context: ${failedActions.join(', ')}.`,
      )
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    ...(input.confirmedPolicy
      ? { confirmedPolicy: input.confirmedPolicy }
      : {}),
    ...(manifestPolicy ? { manifestPolicy } : {}),
    targetFormats,
    importCount,
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
