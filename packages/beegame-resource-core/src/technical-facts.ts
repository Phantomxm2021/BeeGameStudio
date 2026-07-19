import type { ResourceTechnicalFacts } from './types'

/**
 * Normalizes objective inspection facts written by earlier BeeGame versions.
 * This is deliberately limited to schema aliases and values derivable from
 * existing bounds; it never guesses target-engine scale, pivot, or semantics.
 */
export function normalizeResourceTechnicalFacts(
  source: ResourceTechnicalFacts,
): ResourceTechnicalFacts {
  const facts: ResourceTechnicalFacts = { ...source }
  copyFiniteAlias(facts, 'boundsSizeX', 'boundsWidth')
  copyFiniteAlias(facts, 'boundsSizeY', 'boundsHeight')
  copyFiniteAlias(facts, 'boundsSizeZ', 'boundsDepth')

  deriveCenter(facts, 'X')
  deriveCenter(facts, 'Y')
  deriveCenter(facts, 'Z')
  deriveNegated(facts, 'groundOffsetY', 'boundsMinY')
  deriveNegated(facts, 'centeringOffsetX', 'boundsCenterX')
  deriveNegated(facts, 'centeringOffsetZ', 'boundsCenterZ')
  return facts
}

function copyFiniteAlias(
  facts: ResourceTechnicalFacts,
  target: string,
  legacy: string,
): void {
  if (finiteNumber(facts[target]) !== undefined) return
  const value = finiteNumber(facts[legacy])
  if (value !== undefined) facts[target] = value
}

function deriveCenter(
  facts: ResourceTechnicalFacts,
  axis: 'X' | 'Y' | 'Z',
): void {
  const target = `boundsCenter${axis}`
  if (finiteNumber(facts[target]) !== undefined) return
  const minimum = finiteNumber(facts[`boundsMin${axis}`])
  const maximum = finiteNumber(facts[`boundsMax${axis}`])
  if (minimum !== undefined && maximum !== undefined) facts[target] = (minimum + maximum) / 2
}

function deriveNegated(
  facts: ResourceTechnicalFacts,
  target: string,
  source: string,
): void {
  if (finiteNumber(facts[target]) !== undefined) return
  const value = finiteNumber(facts[source])
  if (value !== undefined) facts[target] = -value
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
