import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import { getGameDocumentContract } from './game-document-contracts'
import {
  createFoundationIssueRegistry,
  makeAuditIssue,
  type AuditIssue,
  type AuditSeverity,
} from './foundation-issue-registry'
import {
  runFoundationContractChecks,
  type ContractBinding,
} from './foundation-audit-contracts'
import {
  runFoundationRuleChecks,
  type EntityReferenceRule,
  type NumericConsistencyRule,
} from './foundation-audit-rules'

export type FoundationFactType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'

export type RequiredFactDefinition = {
  key: string
  source: SectionRef
  expectedType: FoundationFactType
  severity?: AuditSeverity
}

export type FoundationSchemaInput = {
  requiredFacts?: readonly RequiredFactDefinition[]
  factTypes?: readonly RequiredFactDefinition[]
}

export type FoundationAuditCheckInput = {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  schema?: FoundationSchemaInput
  numericRules?: readonly NumericConsistencyRule[]
  entityRules?: readonly EntityReferenceRule[]
  contractBindings?: readonly ContractBinding[]
  includeDocumentContracts?: boolean
}

export type FoundationAuditCheckDefinition = {
  id: string
  type: 'schema' | 'rule' | 'contract'
  deterministic: true
}

export const FOUNDATION_AUDIT_CHECK_DEFINITIONS: readonly FoundationAuditCheckDefinition[] =
  Object.freeze([
    Object.freeze({
      id: 'schema.required-section-facts',
      type: 'schema',
      deterministic: true as const,
    }),
    Object.freeze({
      id: 'schema.fact-types',
      type: 'schema',
      deterministic: true as const,
    }),
    Object.freeze({
      id: 'rule.numeric-consistency',
      type: 'rule',
      deterministic: true as const,
    }),
    Object.freeze({
      id: 'rule.referenced-entities',
      type: 'rule',
      deterministic: true as const,
    }),
    Object.freeze({
      id: 'contract.upstream-sections',
      type: 'contract',
      deterministic: true as const,
    }),
  ])

function factType(
  value: FactValue | undefined,
): FoundationFactType | 'missing' | 'invalid' {
  if (value === undefined) return 'missing'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string')) return 'string[]'
    if (value.every(item => typeof item === 'number')) return 'number[]'
    return 'invalid'
  }
  return 'invalid'
}

function sourceFor(
  input: FoundationAuditCheckInput,
  definition: RequiredFactDefinition,
  fact?: FoundationFact,
): SectionRef | undefined {
  return (
    fact?.source ??
    input.sectionIndex.find(
      section =>
        section.documentPath === definition.source.documentPath &&
        section.sectionId === definition.source.sectionId,
    ) ??
    input.sectionIndex[0]
  )
}

export function runFoundationSchemaChecks(
  input: FoundationAuditCheckInput,
): AuditIssue[] {
  const facts = new Map(input.factStore.map(fact => [fact.key, fact]))
  const issues: AuditIssue[] = []
  const requiredByKey = new Map<string, RequiredFactDefinition>()
  for (const definition of input.schema?.requiredFacts ?? [])
    requiredByKey.set(definition.key, definition)
  for (const section of input.sectionIndex) {
    let contract: ReturnType<typeof getGameDocumentContract>
    try {
      contract = getGameDocumentContract(section.documentPath)
    } catch {
      continue
    }
    if (!contract) continue
    if (
      !contract.sections.some(
        candidate => candidate.sectionId === section.sectionId,
      )
    )
      continue
    const documentId = section.documentPath.slice(
      section.documentPath.lastIndexOf('/') + 1,
      -3,
    )
    const key = `${documentId}.${section.sectionId}`
    if (!requiredByKey.has(key))
      requiredByKey.set(key, { key, source: section, expectedType: 'string' })
  }
  const required = [...requiredByKey.values()]
  for (const definition of required) {
    const fact = facts.get(definition.key)
    const source = sourceFor(input, definition, fact)
    if (!source) continue
    if (!fact) {
      issues.push(
        makeAuditIssue({
          checkId: `schema.required-section-facts.${definition.key}`,
          severity: definition.severity ?? 'BLOCKER',
          type: 'schema',
          source,
          expected: `required fact ${definition.key} must exist with type ${definition.expectedType}`,
          actual: `missing fact ${definition.key}`,
          fixDocument: source.documentPath,
          fixSectionId: source.sectionId,
          conflictingFacts: {
            key: definition.key,
            expectedType: definition.expectedType,
          },
        }),
      )
    }
  }
  const typedByKey = new Map<string, RequiredFactDefinition>()
  for (const definition of input.schema?.factTypes ?? [])
    typedByKey.set(definition.key, definition)
  for (const definition of required) {
    if (!typedByKey.has(definition.key))
      typedByKey.set(definition.key, definition)
  }
  for (const definition of typedByKey.values()) {
    const fact = facts.get(definition.key)
    const source = sourceFor(input, definition, fact)
    if (!source) continue
    if (!fact) continue
    const actualType = factType(fact?.value)
    if (actualType === definition.expectedType) continue
    issues.push(
      makeAuditIssue({
        checkId: `schema.fact-types.${definition.key}`,
        severity: definition.severity ?? 'BLOCKER',
        type: 'schema',
        source,
        expected: `fact ${definition.key} must have type ${definition.expectedType}`,
        actual: `fact ${definition.key} has type ${actualType}`,
        fixDocument: source.documentPath,
        fixSectionId: source.sectionId,
        conflictingFacts: {
          key: definition.key,
          expectedType: definition.expectedType,
          actualType,
          value: fact?.value ?? null,
        },
      }),
    )
  }
  return issues
}

/** Runs every deterministic check and admits results through one registry. */
export function runFoundationAuditChecks(
  input: FoundationAuditCheckInput,
): AuditIssue[] {
  const issues = [
    ...runFoundationSchemaChecks(input),
    ...runFoundationRuleChecks(input),
    ...runFoundationContractChecks({
      ...input,
      includeDocumentContracts: input.includeDocumentContracts ?? true,
    }),
  ]
  return createFoundationIssueRegistry({
    issues,
    sectionIndex: input.sectionIndex,
  })
}

export const runDeterministicFoundationChecks = runFoundationAuditChecks
export const runSchemaChecks = runFoundationSchemaChecks
export const runAuditChecks = runFoundationAuditChecks
