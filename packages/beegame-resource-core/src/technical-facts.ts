import type { ResourceTechnicalFacts } from './types'

/** Derives objective assembly facts from the canonical inspected bounds. */
export function normalizeResourceTechnicalFacts(
  source: ResourceTechnicalFacts,
): ResourceTechnicalFacts {
  const facts: ResourceTechnicalFacts = { ...source }
  deriveCenter(facts, 'X')
  deriveCenter(facts, 'Y')
  deriveCenter(facts, 'Z')
  deriveNegated(facts, 'groundOffsetY', 'boundsMinY')
  deriveNegated(facts, 'centeringOffsetX', 'boundsCenterX')
  deriveNegated(facts, 'centeringOffsetZ', 'boundsCenterZ')
  return facts
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
