import type { RevisionInitialSource } from './initial-source'
import {
  REVISION_DETERMINISTIC_CONTRACT_ENDPOINTS,
  REVISION_FACT_HANDOFF_CONSTRAINTS_BY_KEY,
  type RevisionFactHandoffConstraint,
} from './domain/fact-handoff-constraints'

export type RevisionFact = RevisionInitialSource['issues'][number]['facts'][number]
export type RevisionFactIssue = RevisionInitialSource['issues'][number]['issue']

const digest = /^[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function refMatchesOwner(ref: unknown, owner: { documentPath: string; sectionId: string }): boolean {
  if (!isRecord(ref) || ref.documentPath !== owner.documentPath) return false
  return !('sectionId' in ref) || ref.sectionId === owner.sectionId
}

/** Exact non-recursive evidence closure used by the frozen Reviewer handoff. */
export function revisionRepairEvidenceKeys(issue: RevisionFactIssue): string[] {
  const repair = issue.remediation
  const changedKeys = new Set<string>()
  for (const constraint of REVISION_FACT_HANDOFF_CONSTRAINTS_BY_KEY.values()) {
    if (constraint.owner.documentPath !== repair.documentPath) continue
    if (repair.scope === 'document' || repair.sectionIds.includes(constraint.owner.sectionId))
      changedKeys.add(constraint.key)
  }
  const selected = new Set(changedKeys)
  const refs: unknown[] = [issue.source]
  if ('target' in issue && issue.target) refs.push(issue.target)
  if ('supportingSections' in issue && issue.supportingSections)
    refs.push(...issue.supportingSections)
  for (const constraint of REVISION_FACT_HANDOFF_CONSTRAINTS_BY_KEY.values())
    if (refs.some(ref => refMatchesOwner(ref, constraint.owner))) selected.add(constraint.key)
  for (const endpoint of REVISION_DETERMINISTIC_CONTRACT_ENDPOINTS) {
    if (changedKeys.has(endpoint.sourceFactKey) || changedKeys.has(endpoint.targetFactKey)) {
      selected.add(endpoint.sourceFactKey)
      selected.add(endpoint.targetFactKey)
    }
  }
  return [...selected].sort()
}

function invalidFact(message: string): never {
  throw new Error(`Revision fact evidence constraint is invalid: ${message}`)
}

function assertValue(value: unknown, constraint: RevisionFactHandoffConstraint): void {
  const spec = constraint.valueSpec
  switch (constraint.valueType) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) invalidFact(`${constraint.key} value type`)
      if (spec.min !== undefined && value < spec.min) invalidFact(`${constraint.key} value range`)
      if (spec.max !== undefined && value > spec.max) invalidFact(`${constraint.key} value range`)
      return
    case 'string':
      if (typeof value !== 'string') invalidFact(`${constraint.key} value type`)
      if (spec.enum && !spec.enum.includes(value)) invalidFact(`${constraint.key} enum value`)
      return
    case 'boolean':
      if (typeof value !== 'boolean') invalidFact(`${constraint.key} value type`)
      return
    case 'string[]':
    case 'number[]': {
      if (!Array.isArray(value)) invalidFact(`${constraint.key} list type`)
      const minItems = spec.minItems ?? 0
      const maxItems = spec.maxItems ?? Infinity
      if (value.length < minItems || value.length > maxItems) invalidFact(`${constraint.key} list length`)
      if (constraint.valueType === 'string[]') {
        const pattern = spec.itemPattern ? new RegExp(spec.itemPattern) : undefined
        if (!value.every(item => typeof item === 'string' && (!pattern || pattern.test(item)))) invalidFact(`${constraint.key} list item`)
      } else if (!value.every(item => typeof item === 'number' && Number.isFinite(item))) invalidFact(`${constraint.key} list item`)
      return
    }
    default: {
      const exhaustive: never = constraint.valueType
      invalidFact(`unknown value type ${String(exhaustive)}`)
    }
  }
}

/**
 * Validates only the copied fact's catalog owner, value contract and local
 * evidence shape. It does not extract facts, evaluate contracts or issue a
 * Reviewer conclusion.
 */
export function assertRevisionFactConstraint(fact: RevisionFact): void {
  if (!isRecord(fact) || typeof fact.key !== 'string') invalidFact('fact shape')
  const constraint = REVISION_FACT_HANDOFF_CONSTRAINTS_BY_KEY.get(fact.key)
  if (!constraint) invalidFact(`unknown fact key ${fact.key}`)
  if (!isRecord(fact.source) || fact.source.documentPath !== constraint.owner.documentPath || fact.source.sectionId !== constraint.owner.sectionId)
    invalidFact(`${fact.key} owner`)
  if (!isRecord(fact.evidence) || fact.evidence.documentPath !== constraint.owner.documentPath || fact.evidence.sectionId !== constraint.owner.sectionId)
    invalidFact(`${fact.key} evidence owner`)
  if (typeof fact.source.startLine !== 'number' || !Number.isSafeInteger(fact.source.startLine) || fact.source.startLine < 1 ||
    typeof fact.source.endLine !== 'number' || !Number.isSafeInteger(fact.source.endLine) || fact.source.endLine < fact.source.startLine ||
    typeof fact.evidence.startLine !== 'number' || !Number.isSafeInteger(fact.evidence.startLine) || fact.evidence.startLine < fact.source.startLine ||
    typeof fact.evidence.endLine !== 'number' || !Number.isSafeInteger(fact.evidence.endLine) || fact.evidence.endLine < fact.evidence.startLine || fact.evidence.endLine > fact.source.endLine ||
    typeof fact.evidence.digest !== 'string' || !digest.test(fact.evidence.digest)) invalidFact(`${fact.key} evidence bounds`)
  assertValue(fact.value, constraint)
}
