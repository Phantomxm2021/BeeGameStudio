import type { PackSummary, ResourceDimension, ResourcePackPrimaryCategory, ResourcePackStatus } from './types'

export type ResourcePackStructuredQuery = {
  dimensions?: readonly ResourceDimension[]
  primaryCategories?: readonly ResourcePackPrimaryCategory[]
  statuses?: readonly ResourcePackStatus[]
  tags?: readonly string[]
  gameTypes?: readonly string[]
}

/**
 * Structured metadata is an exact filter for administrative library browsing.
 * It never infers intent, scores Packs, or chooses one for Claude Code.
 */
export function searchResourcePacks(
  packs: readonly PackSummary[],
  query: ResourcePackStructuredQuery,
): PackSummary[] {
  return packs.filter(pack =>
    matchesOne(query.dimensions, pack.dimension) &&
    matchesOne(query.primaryCategories, pack.primaryCategory) &&
    matchesOne(query.statuses, pack.status) &&
    matchesAny(query.tags, pack.tags ?? []) &&
    matchesAny(query.gameTypes, pack.gameTypes),
  )
}

function matchesOne<T extends string>(expected: readonly T[] | undefined, actual: T | undefined): boolean {
  return !expected?.length || Boolean(actual && expected.includes(actual))
}

function matchesAny(expected: readonly string[] | undefined, actual: readonly string[]): boolean {
  if (!expected?.length) return true
  const normalized = new Set(actual.map(normalize))
  return expected.some(value => normalized.has(normalize(value)))
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}
