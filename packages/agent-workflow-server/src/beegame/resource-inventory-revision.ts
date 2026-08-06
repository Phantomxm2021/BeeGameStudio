import { createHash } from 'node:crypto'
import type { BeeGameAssetManifest } from './asset-contracts'

export function resourceInventoryPlanRevision(
  manifest: Pick<BeeGameAssetManifest, 'project_target' | 'requirements'>,
): string {
  return canonicalResourceInventoryRevision({
    projectTarget: manifest.project_target,
    requirements: manifest.requirements,
  })
}

export function canonicalResourceInventoryRevision(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}
