import { createHash } from 'node:crypto'
import {
  foundationFactDefinition,
  isFoundationFactKey,
} from './foundation-fact-definitions'
import type { SectionRef } from './foundation-section-index'
import type { FoundationFactEvidence } from './foundation-fact-extraction'

export type FactValue = string | number | boolean | string[] | number[]

export type FoundationFact = {
  key: string
  value: FactValue
  source: SectionRef
  evidence: FoundationFactEvidence
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
  if (!Array.isArray(value)) return false
  return value.every(
    item =>
      typeof item === 'string' ||
      (typeof item === 'number' && Number.isFinite(item)),
  )
}

function isEvidence(value: unknown): value is FoundationFactEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as Record<string, unknown>
  return (
    typeof evidence.documentPath === 'string' &&
    typeof evidence.sectionId === 'string' &&
    Number.isInteger(evidence.startLine) &&
    Number.isInteger(evidence.endLine) &&
    typeof evidence.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(evidence.digest)
  )
}

export function createFoundationFactStore(
  facts: readonly FoundationFact[],
): FoundationFactStore {
  const seen = new Set<string>()
  const normalized = facts.map(fact => {
    if (!fact.key.trim()) throw new Error('foundation fact key is required')
    if (!isFoundationFactKey(fact.key))
      throw new Error(`unknown foundation fact key: ${fact.key}`)
    if (seen.has(fact.key))
      throw new Error(`duplicate foundation fact key: ${fact.key}`)
    if (!isFactValue(fact.value))
      throw new Error(`foundation fact value is invalid: ${fact.key}`)
    if (!isEvidence(fact.evidence))
      throw new Error(`foundation fact evidence is required: ${fact.key}`)
    const definition = foundationFactDefinition(fact.key)!
    if (
      fact.source.documentPath !== definition.owner.documentPath ||
      fact.source.sectionId !== definition.owner.sectionId ||
      fact.evidence.documentPath !== fact.source.documentPath ||
      fact.evidence.sectionId !== fact.source.sectionId ||
      fact.evidence.startLine < fact.source.startLine ||
      fact.evidence.endLine < fact.evidence.startLine ||
      fact.evidence.endLine > fact.source.endLine
    )
      throw new Error(
        `foundation fact source is not the catalog owner: ${fact.key}`,
      )
    if (
      definition.valueType === 'number' &&
      (!Number.isInteger(fact.value) ||
        (fact.value as number) < (definition.valueSpec.min ?? -Infinity) ||
        (fact.value as number) > (definition.valueSpec.max ?? Infinity))
    )
      throw new Error(`foundation fact value is out of range: ${fact.key}`)
    if (
      definition.valueType === 'string' &&
      definition.valueSpec.enum &&
      !definition.valueSpec.enum.includes(fact.value as string)
    )
      throw new Error(`foundation fact enum value is invalid: ${fact.key}`)
    if (
      (definition.valueType === 'string[]' ||
        definition.valueType === 'number[]') &&
      ((fact.value as unknown[]).length <
        (definition.valueSpec.minItems ?? 0) ||
        (fact.value as unknown[]).length >
          (definition.valueSpec.maxItems ?? Infinity))
    )
      throw new Error(`foundation fact list length is invalid: ${fact.key}`)
    if (
      definition.valueType === 'number[]' &&
      !(fact.value as unknown[]).every(
        item => typeof item === 'number' && Number.isFinite(item),
      )
    )
      throw new Error(`foundation fact number list is invalid: ${fact.key}`)
    if (
      definition.valueType === 'string[]' &&
      !(fact.value as unknown[]).every(
        item =>
          typeof item === 'string' &&
          (!definition.valueSpec.itemPattern ||
            new RegExp(definition.valueSpec.itemPattern).test(item)),
      )
    )
      throw new Error(`foundation fact string list is invalid: ${fact.key}`)
    seen.add(fact.key)
    return {
      key: fact.key,
      value: fact.value,
      source: { ...fact.source },
      evidence: { ...fact.evidence },
    }
  })
  return normalized.sort((left, right) => left.key.localeCompare(right.key))
}

export function digestFactStore(store: readonly FoundationFact[]): string {
  const canonical = [...store]
    .map(fact => ({ ...fact, source: { ...fact.source } }))
    .sort((left, right) => left.key.localeCompare(right.key))
  return digest(JSON.stringify(canonical))
}
