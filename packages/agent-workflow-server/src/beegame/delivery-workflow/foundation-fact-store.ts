import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'
import type {
  FoundationSectionIndex,
  SectionRef,
} from './foundation-section-index'

export type FactValue = string | number | boolean | string[] | number[]

export type FoundationFact = {
  key: string
  value: FactValue
  source: SectionRef
}

export type FoundationFactStore = FoundationFact[]

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isFactValue(value: unknown): value is FactValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return true
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(
    item => typeof item === 'string' || typeof item === 'number',
  )
}

export function createFoundationFactStore(
  facts: readonly FoundationFact[],
): FoundationFactStore {
  const seen = new Set<string>()
  const normalized = facts.map(fact => {
    if (!fact.key.trim()) throw new Error('foundation fact key is required')
    if (seen.has(fact.key))
      throw new Error(`duplicate foundation fact key: ${fact.key}`)
    if (!isFactValue(fact.value))
      throw new Error(`foundation fact value is invalid: ${fact.key}`)
    seen.add(fact.key)
    return { key: fact.key, value: fact.value, source: { ...fact.source } }
  })
  return normalized.sort((left, right) => left.key.localeCompare(right.key))
}

/**
 * Extracts one exact, section-owned fact per contract section. The value is
 * the authored section body; no model, summary, normalization, or prose is
 * generated. Numeric/array facts can be supplied by later deterministic
 * contract checks through createFoundationFactStore.
 */
export function extractFoundationFacts(input: {
  documents: ReadonlyMap<string, string> | Record<string, string>
  sectionIndex: readonly SectionRef[]
}): FoundationFactStore {
  const documents =
    input.documents instanceof Map
      ? input.documents
      : new Map(Object.entries(input.documents))
  const facts: FoundationFact[] = []
  for (const source of input.sectionIndex) {
    const contract = getGameDocumentContract(
      source.documentPath as FoundationDocumentPath,
    )
    if (
      !contract.sections.some(section => section.sectionId === source.sectionId)
    )
      continue
    const markdown = documents.get(source.documentPath)
    if (markdown === undefined)
      throw new Error(`foundation document is missing: ${source.documentPath}`)
    const lines = markdown.split('\n')
    const body = lines.slice(source.startLine, source.endLine).join('\n').trim()
    const documentId = source.documentPath.slice(
      source.documentPath.lastIndexOf('/') + 1,
      -3,
    )
    facts.push({
      key: `${documentId}.${source.sectionId}`,
      value: body,
      source,
    })
  }
  return createFoundationFactStore(facts)
}

export function digestFactStore(store: readonly FoundationFact[]): string {
  const canonical = [...store]
    .map(fact => ({ ...fact, source: { ...fact.source } }))
    .sort((left, right) => left.key.localeCompare(right.key))
  return digest(JSON.stringify(canonical))
}
