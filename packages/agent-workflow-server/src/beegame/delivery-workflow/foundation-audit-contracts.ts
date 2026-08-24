import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import {
  makeAuditIssue,
  type AuditIssue,
  type AuditSeverity,
} from './foundation-issue-registry'

export type ContractBindingRelation = 'exists' | 'equal' | 'numeric-equal'

export type ContractBinding = {
  id: string
  sourceFactKey: string
  targetFactKey: string
  relation: ContractBindingRelation
  sourceDocumentPath?: SectionRef['documentPath']
  sourceSectionId?: string
  targetDocumentPath?: SectionRef['documentPath']
  targetSectionId?: string
  severity?: AuditSeverity
}

export type FoundationContractCheckInput = {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  contractBindings?: readonly ContractBinding[]
  /** Validate immutable game-document upstream projections when enabled. */
  includeDocumentContracts?: boolean
}

function findSection(
  input: FoundationContractCheckInput,
  documentPath: SectionRef['documentPath'] | undefined,
  sectionId: string | undefined,
  fallback?: SectionRef,
): SectionRef | undefined {
  if (documentPath && sectionId) {
    const exact = input.sectionIndex.find(
      section =>
        section.documentPath === documentPath &&
        section.sectionId === sectionId,
    )
    if (exact) return exact
  }
  if (sectionId) {
    const byId = input.sectionIndex.find(
      section => section.sectionId === sectionId,
    )
    if (byId) return byId
  }
  return fallback ?? input.sectionIndex[0]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function equalValues(
  left: FactValue,
  right: FactValue,
  numeric: boolean,
): boolean {
  if (numeric)
    return (
      typeof left === 'number' && typeof right === 'number' && left === right
    )
  return JSON.stringify(left) === JSON.stringify(right)
}

function bindingIssue(input: {
  checkId: string
  severity: AuditSeverity
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  fix: SectionRef
  conflicts: Record<string, unknown>
}): AuditIssue {
  return makeAuditIssue({
    checkId: input.checkId,
    severity: input.severity,
    type: 'contract',
    source: input.source,
    ...(input.target ? { target: input.target } : {}),
    expected: input.expected,
    actual: input.actual,
    fixDocument: input.fix.documentPath,
    fixSectionId: input.fix.sectionId,
    conflictingFacts: input.conflicts,
  })
}

function runBindingChecks(input: FoundationContractCheckInput): AuditIssue[] {
  const facts = new Map(input.factStore.map(fact => [fact.key, fact]))
  const issues: AuditIssue[] = []
  for (const binding of input.contractBindings ?? []) {
    const sourceFact = facts.get(binding.sourceFactKey)
    const targetFact = facts.get(binding.targetFactKey)
    const source = findSection(
      input,
      binding.sourceDocumentPath,
      binding.sourceSectionId,
      sourceFact?.source,
    )
    const target = findSection(
      input,
      binding.targetDocumentPath,
      binding.targetSectionId,
      targetFact?.source,
    )
    if (!source) continue
    if (!sourceFact) {
      issues.push(
        bindingIssue({
          checkId: `contract.${binding.id}`,
          severity: binding.severity ?? 'HIGH',
          source,
          ...(target ? { target } : {}),
          expected: `source fact ${binding.sourceFactKey} must exist`,
          actual: `missing fact ${binding.sourceFactKey}`,
          fix: source,
          conflicts: {
            sourceFactKey: binding.sourceFactKey,
            targetFactKey: binding.targetFactKey,
          },
        }),
      )
      continue
    }
    if (!targetFact) {
      issues.push(
        bindingIssue({
          checkId: `contract.${binding.id}`,
          severity: binding.severity ?? 'HIGH',
          source,
          ...(target ? { target } : {}),
          expected: `target fact ${binding.targetFactKey} must exist`,
          actual: `missing fact ${binding.targetFactKey}`,
          fix: target ?? source,
          conflicts: {
            sourceFactKey: binding.sourceFactKey,
            targetFactKey: binding.targetFactKey,
          },
        }),
      )
      continue
    }
    if (
      binding.relation !== 'exists' &&
      !equalValues(
        sourceFact.value,
        targetFact.value,
        binding.relation === 'numeric-equal',
      )
    ) {
      issues.push(
        bindingIssue({
          checkId: `contract.${binding.id}`,
          severity: binding.severity ?? 'HIGH',
          source,
          ...(target ? { target } : {}),
          expected: `${binding.sourceFactKey} and ${binding.targetFactKey} must match`,
          actual: `${text(sourceFact.value)} != ${text(targetFact.value)}`,
          fix: target ?? source,
          conflicts: {
            sourceFactKey: binding.sourceFactKey,
            targetFactKey: binding.targetFactKey,
            sourceValue: sourceFact.value,
            targetValue: targetFact.value,
          },
        }),
      )
    }
  }
  return issues
}

function runDocumentContractChecks(
  input: FoundationContractCheckInput,
): AuditIssue[] {
  const issues: AuditIssue[] = []
  const paths = new Set(input.sectionIndex.map(section => section.documentPath))
  for (const path of paths) {
    let contract: ReturnType<typeof getGameDocumentContract>
    try {
      contract = getGameDocumentContract(path)
    } catch {
      continue
    }
    if (!contract) continue
    const localSections = input.sectionIndex.filter(
      section => section.documentPath === path,
    )
    const source = localSections[0]
    if (!source) continue
    for (const projection of contract.upstreamSections) {
      const upstreamSections = input.sectionIndex.filter(
        section => section.documentPath === projection.path,
      )
      for (const sectionId of projection.sectionIds) {
        const target = upstreamSections.find(
          section => section.sectionId === sectionId,
        )
        if (target) continue
        issues.push(
          makeAuditIssue({
            checkId: `contract.upstream-sections.${path}.${projection.path}.${sectionId}`,
            severity: 'HIGH',
            type: 'contract',
            source,
            expected: `${path} must reference ${projection.path}#${sectionId}`,
            actual: `referenced section is absent: ${projection.path}#${sectionId}`,
            fixDocument: source.documentPath,
            fixSectionId: source.sectionId,
            conflictingFacts: {
              sourceDocumentPath: path,
              targetDocumentPath: projection.path,
              targetSectionId: sectionId,
            },
          }),
        )
      }
    }
  }
  return issues
}

export function runFoundationContractChecks(
  input: FoundationContractCheckInput,
): AuditIssue[] {
  return [
    ...runBindingChecks(input),
    ...(input.includeDocumentContracts ? runDocumentContractChecks(input) : []),
  ]
}

export const runContractChecks = runFoundationContractChecks
export const runFoundationAuditContracts = runFoundationContractChecks
