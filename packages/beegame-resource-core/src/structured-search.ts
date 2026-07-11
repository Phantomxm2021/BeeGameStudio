import type { PackSummary, ResourceDimension, ResourcePackPrimaryCategory, ResourcePackStatus } from './types'

export type ResourcePackStructuredQuery = {
  dimensions?: readonly ResourceDimension[]
  primaryCategories?: readonly ResourcePackPrimaryCategory[]
  statuses?: readonly ResourcePackStatus[]
  tags?: readonly string[]
  gameTypes?: readonly string[]
}

export type ResourcePackSemanticRanker = (
  query: ResourcePackStructuredQuery,
  candidates: readonly PackSummary[],
) => Promise<ReadonlyMap<string, number>> | ReadonlyMap<string, number>

/**
 * Structured metadata is the hard filter for library discovery. This does not
 * infer an asset's intent from a free-text prompt; a future semantic ranker may
 * reorder only the result set returned here.
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

/**
 * A semantic provider is deliberately post-filter only. It may improve the
 * order among compatible Packs, but cannot cause an incompatible Pack to be
 * returned. This keeps vector search an optional deployment capability.
 */
export async function rankStructuredResourcePacks(
  packs: readonly PackSummary[],
  query: ResourcePackStructuredQuery,
  semanticRanker?: ResourcePackSemanticRanker,
): Promise<PackSummary[]> {
  const candidates = searchResourcePacks(packs, query)
  if (!semanticRanker || candidates.length < 2) return candidates
  const scores = await semanticRanker(query, candidates)
  return [...candidates].sort((left, right) =>
    (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0) || left.name.localeCompare(right.name),
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
