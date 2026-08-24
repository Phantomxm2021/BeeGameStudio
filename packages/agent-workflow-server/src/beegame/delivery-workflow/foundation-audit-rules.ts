import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import {
  makeAuditIssue,
  type AuditIssue,
  type AuditSeverity,
} from './foundation-issue-registry'

export type NumericRuleRelation =
  | 'equal'
  | 'less-than-or-equal'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'greater-than'

export type NumericConsistencyRule = {
  id: string
  factKeys: readonly [string, string, ...string[]]
  relation: NumericRuleRelation
  sourceSectionId?: string
  targetSectionId?: string
  sourceDocumentPath?: SectionRef['documentPath']
  targetDocumentPath?: SectionRef['documentPath']
  severity?: AuditSeverity
}

export type EntityReferenceRule = {
  id: string
  sourceFactKey: string
  targetFactPrefix: string
  sourceSectionId?: string
  sourceDocumentPath?: SectionRef['documentPath']
  severity?: AuditSeverity
}

export type FoundationRuleCheckInput = {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  numericRules?: readonly NumericConsistencyRule[]
  entityRules?: readonly EntityReferenceRule[]
}

function findSection(
  input: FoundationRuleCheckInput,
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

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isNumber(value: FactValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function relationMatches(
  left: number,
  right: number,
  relation: NumericRuleRelation,
): boolean {
  switch (relation) {
    case 'equal':
      return left === right
    case 'less-than-or-equal':
      return left <= right
    case 'greater-than-or-equal':
      return left >= right
    case 'less-than':
      return left < right
    case 'greater-than':
      return left > right
  }
}

function relationText(relation: NumericRuleRelation): string {
  return {
    equal: 'equal',
    'less-than-or-equal': '<=',
    'greater-than-or-equal': '>=',
    'less-than': '<',
    'greater-than': '>',
  }[relation]
}

export function runFoundationRuleChecks(
  input: FoundationRuleCheckInput,
): AuditIssue[] {
  const issues: AuditIssue[] = []
  const facts = new Map(input.factStore.map(fact => [fact.key, fact]))

  for (const rule of input.numericRules ?? []) {
    const entries = rule.factKeys.map(key => facts.get(key))
    const first = entries[0]
    const source = findSection(
      input,
      rule.sourceDocumentPath,
      rule.sourceSectionId,
      first?.source,
    )
    const target = findSection(
      input,
      rule.targetDocumentPath,
      rule.targetSectionId,
      entries[1]?.source,
    )
    if (!source) continue
    const invalid = entries.find(entry => !entry || !isNumber(entry.value))
    if (invalid || !first || !isNumber(first.value)) {
      issues.push(
        makeAuditIssue({
          checkId: `rule.numeric-consistency.${rule.id}`,
          severity: rule.severity ?? 'HIGH',
          type: 'rule',
          source,
          ...(target ? { target } : {}),
          expected: `numeric facts ${rule.factKeys.join(', ')} must satisfy ${relationText(rule.relation)}`,
          actual: invalid
            ? `missing or non-numeric fact ${invalid?.key ?? rule.factKeys[0]}`
            : 'missing numeric fact',
          fixDocument: source.documentPath,
          fixSectionId: source.sectionId,
          conflictingFacts: Object.fromEntries(
            rule.factKeys.map((key, index) => [
              key,
              entries[index]?.value ?? null,
            ]),
          ),
        }),
      )
      continue
    }
    for (const entry of entries.slice(1)) {
      if (
        !entry ||
        !isNumber(entry.value) ||
        !relationMatches(first.value, entry.value, rule.relation)
      ) {
        issues.push(
          makeAuditIssue({
            checkId: `rule.numeric-consistency.${rule.id}`,
            severity: rule.severity ?? 'HIGH',
            type: 'rule',
            source,
            ...(target ? { target } : {}),
            expected: `${rule.factKeys[0]} ${relationText(rule.relation)} ${entry?.key ?? rule.factKeys[1]}`,
            actual: `${valueText(first.value)} ${relationText(rule.relation)} ${valueText(entry?.value ?? null)}`,
            fixDocument: (target ?? source).documentPath,
            fixSectionId: (target ?? source).sectionId,
            conflictingFacts: Object.fromEntries(
              rule.factKeys.map((key, index) => [
                key,
                entries[index]?.value ?? null,
              ]),
            ),
          }),
        )
        break
      }
    }
  }

  for (const rule of input.entityRules ?? []) {
    const sourceFact = facts.get(rule.sourceFactKey)
    const source = findSection(
      input,
      rule.sourceDocumentPath,
      rule.sourceSectionId,
      sourceFact?.source,
    )
    if (!source) continue
    if (!sourceFact) {
      issues.push(
        makeAuditIssue({
          checkId: `rule.referenced-entities.${rule.id}`,
          severity: rule.severity ?? 'HIGH',
          type: 'rule',
          source,
          expected: `fact ${rule.sourceFactKey} must reference a declared entity`,
          actual: `missing fact ${rule.sourceFactKey}`,
          fixDocument: source.documentPath,
          fixSectionId: source.sectionId,
          conflictingFacts: { sourceFactKey: rule.sourceFactKey },
        }),
      )
      continue
    }
    const values = Array.isArray(sourceFact.value)
      ? sourceFact.value
      : [sourceFact.value]
    const missing = values.filter(
      value => !facts.has(`${rule.targetFactPrefix}${String(value)}`),
    )
    if (missing.length === 0) continue
    issues.push(
      makeAuditIssue({
        checkId: `rule.referenced-entities.${rule.id}`,
        severity: rule.severity ?? 'HIGH',
        type: 'rule',
        source,
        expected: `each referenced entity must have a fact with prefix ${rule.targetFactPrefix}`,
        actual: `missing entities: ${missing.map(String).join(', ')}`,
        fixDocument: source.documentPath,
        fixSectionId: source.sectionId,
        conflictingFacts: {
          sourceFactKey: rule.sourceFactKey,
          sourceValue: sourceFact.value,
          targetFactPrefix: rule.targetFactPrefix,
          missing,
        },
      }),
    )
  }
  return issues
}

export const runRuleChecks = runFoundationRuleChecks
export const runFoundationAuditRules = runFoundationRuleChecks

export function checkNumericConsistency(
  input: FoundationRuleCheckInput,
): AuditIssue[] {
  return runFoundationRuleChecks({
    ...input,
    numericRules: input.numericRules,
    entityRules: [],
  })
}

export function checkReferencedEntities(
  input: FoundationRuleCheckInput,
): AuditIssue[] {
  return runFoundationRuleChecks({
    ...input,
    numericRules: [],
    entityRules: input.entityRules,
  })
}
