import { getGameDocumentContract } from './game-document-contracts'
import { FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS } from './foundation-audit-authority'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import type {
  AuditIssueDraft,
  AuditSeverity,
} from './foundation-issue-registry'
import type { FoundationAuditContext } from './foundation-audit-rules'

export type ContractBindingRelation =
  | 'exists'
  | 'equal'
  | 'numeric-equal'
  | 'contains-all'

export type ContractBinding = {
  id: string
  sourceFactKey: string
  targetFactKey: string
  relation: ContractBindingRelation
  source: SectionRef
  target: SectionRef
  severity?: AuditSeverity
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function identityPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function sameSection(left: SectionRef, right: SectionRef): boolean {
  return (
    left.documentPath === right.documentPath &&
    left.sectionId === right.sectionId &&
    left.heading === right.heading &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.digest === right.digest
  )
}

function equal(left: unknown, right: unknown, numeric: boolean): boolean {
  if (numeric)
    return (
      typeof left === 'number' && typeof right === 'number' && left === right
    )
  return JSON.stringify(left) === JSON.stringify(right)
}

function satisfiesRelation(
  left: unknown,
  right: unknown,
  relation: ContractBindingRelation,
): boolean {
  if (relation === 'contains-all')
    return Array.isArray(left) && Array.isArray(right) && right.every(item => left.some(candidate => JSON.stringify(candidate) === JSON.stringify(item)))
  return equal(left, right, relation === 'numeric-equal')
}

function permittedEdge(binding: ContractBinding): boolean {
  const contract = getGameDocumentContract(binding.source.documentPath as never)
  if (!contract) return false
  const direct = (
    contract.allowedUpstreamPaths.includes(
      binding.target.documentPath as never,
    ) &&
    contract.upstreamSections.some(
      projection =>
        projection.path === binding.target.documentPath &&
        projection.sectionIds.includes(binding.target.sectionId),
    )
  )
  if (direct) return true
  return FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS.some(edge =>
    edge.sourceFactKey === binding.sourceFactKey &&
    edge.targetFactKey === binding.targetFactKey &&
    edge.source.documentPath === binding.source.documentPath &&
    edge.source.sectionId === binding.source.sectionId &&
    edge.target.documentPath === binding.target.documentPath &&
    edge.target.sectionId === binding.target.sectionId,
  )
}

function bindingDrafts(
  context: FoundationAuditContext,
  bindings: readonly ContractBinding[],
): AuditIssueDraft[] {
  const drafts: AuditIssueDraft[] = []
  for (const binding of bindings) {
    const source = context.section(
      binding.source.documentPath,
      binding.source.sectionId,
    )
    const target = context.section(
      binding.target.documentPath,
      binding.target.sectionId,
    )
    if (
      !source ||
      !target ||
      !sameSection(source, binding.source) ||
      !sameSection(target, binding.target)
    )
      throw new Error('contract binding must use exact indexed SectionRefs')
    if (!permittedEdge(binding))
      throw new Error(
        'contract binding is outside the immutable contract graph',
      )
    const sourceFact = context.fact(binding.sourceFactKey)
    const targetFact = context.fact(binding.targetFactKey)
    const conflict = {
      sourceFactKey: binding.sourceFactKey,
      targetFactKey: binding.targetFactKey,
      sourceValue: sourceFact?.value ?? null,
      targetValue: targetFact?.value ?? null,
    }
    if (!sourceFact || !targetFact) {
      const fix = !targetFact ? target : source
      drafts.push({
        checkId: `contract.${identityPart(binding.id)}`,
        severity: binding.severity ?? 'HIGH',
        type: 'contract',
        source,
        target,
        expected: 'both contract facts must exist',
        actual: `missing ${!sourceFact ? binding.sourceFactKey : binding.targetFactKey}`,
        fixDocument: fix.documentPath,
        fixSectionId: fix.sectionId,
        conflictIdentity: conflict,
      })
      continue
    }
    if (
      binding.relation !== 'exists' &&
      !satisfiesRelation(sourceFact.value, targetFact.value, binding.relation)
    ) {
      drafts.push({
        checkId: `contract.${identityPart(binding.id)}`,
        severity: binding.severity ?? 'HIGH',
        type: 'contract',
        source,
        target,
        expected: `${binding.sourceFactKey} and ${binding.targetFactKey} must match`,
        actual: `${text(sourceFact.value)} != ${text(targetFact.value)}`,
        fixDocument: target.documentPath,
        fixSectionId: target.sectionId,
        conflictIdentity: conflict,
      })
    }
  }
  return drafts
}

function documentGraphDrafts(
  context: FoundationAuditContext,
): AuditIssueDraft[] {
  const drafts: AuditIssueDraft[] = []
  const paths = [
    ...new Set(context.sectionIndex.map(section => section.documentPath)),
  ].sort()
  for (const path of paths) {
    const contract = getGameDocumentContract(path as never)
    if (!contract) continue
    for (const projection of contract.upstreamSections) {
      for (const sectionId of projection.sectionIds) {
        if (context.section(projection.path, sectionId)) continue
        throw new Error(
          `immutable contract graph does not provide exact local source section for ${path} -> ${projection.path}#${sectionId}`,
        )
      }
    }
  }
  return drafts
}

export function collectContractDrafts(
  context: FoundationAuditContext,
  bindings: readonly ContractBinding[] = [],
): AuditIssueDraft[] {
  return [...bindingDrafts(context, bindings), ...documentGraphDrafts(context)]
}
