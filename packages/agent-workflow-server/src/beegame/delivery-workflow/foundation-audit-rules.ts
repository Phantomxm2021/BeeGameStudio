import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import type {
  AuditIssueDraft,
  AuditSeverity,
} from './foundation-issue-registry'

export type FoundationAuditContext = {
  validated: true
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  section(documentPath: string, sectionId: string): SectionRef | undefined
  fact(key: string): FoundationFact | undefined
}

export type NumericRuleRelation =
  | 'equal'
  | 'less-than-or-equal'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'greater-than'

export type NumericConsistencyRule = {
  id: string
  facts: readonly RuleFactDefinition[]
  relation: NumericRuleRelation
  severity?: AuditSeverity
}

export type RuleFactDefinition = {
  key: string
  source: SectionRef
  expectedType: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]'
}

export type EntityReferenceRule = {
  id: string
  source: RuleFactDefinition
  targetFactPrefix: string
  severity?: AuditSeverity
}

function numeric(value: FactValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function relation(
  left: number,
  right: number,
  operator: NumericRuleRelation,
): boolean {
  switch (operator) {
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

function symbol(operator: NumericRuleRelation): string {
  return {
    equal: '=',
    'less-than-or-equal': '<=',
    'greater-than-or-equal': '>=',
    'less-than': '<',
    'greater-than': '>',
  }[operator]
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function numericDrafts(
  context: FoundationAuditContext,
  rules: readonly NumericConsistencyRule[],
): AuditIssueDraft[] {
  const drafts: AuditIssueDraft[] = []
  for (const rule of rules) {
    const entries = rule.facts.map(definition => context.fact(definition.key))
    const first = entries[0]
    if (!first) continue
    if (!numeric(first.value)) {
      drafts.push({
        checkId: `rule.numeric-consistency.${rule.id}`,
        severity: rule.severity ?? 'HIGH',
        type: 'rule',
        source: first.source,
        expected: `all facts must be numeric and satisfy ${symbol(rule.relation)}`,
        actual: `non-numeric fact ${rule.facts[0].key}`,
        fixDocument: first.source.documentPath,
        fixSectionId: first.source.sectionId,
        conflictIdentity: {
          relation: rule.relation,
          facts: Object.fromEntries(
            rule.facts.map((definition, index) => [
              definition.key,
              entries[index]?.value ?? null,
            ]),
          ),
        },
      })
      continue
    }
    for (let index = 1; index < entries.length; index += 1) {
      const entry = entries[index]
      if (
        !entry ||
        !numeric(entry.value) ||
        relation(first.value, entry.value, rule.relation)
      )
        continue
      drafts.push({
        checkId: `rule.numeric-consistency.${rule.id}`,
        severity: rule.severity ?? 'HIGH',
        type: 'rule',
        source: first.source,
        target: entry.source,
        expected: `${rule.facts[0].key} ${symbol(rule.relation)} ${rule.facts[index].key}`,
        actual: `${display(first.value)} ${symbol(rule.relation)} ${display(entry.value)}`,
        fixDocument: entry.source.documentPath,
        fixSectionId: entry.source.sectionId,
        conflictIdentity: {
          relation: rule.relation,
          facts: Object.fromEntries(
            rule.facts.map((definition, candidate) => [
              definition.key,
              entries[candidate]?.value ?? null,
            ]),
          ),
        },
      })
    }
  }
  return drafts
}

function entityDrafts(
  context: FoundationAuditContext,
  rules: readonly EntityReferenceRule[],
): AuditIssueDraft[] {
  const drafts: AuditIssueDraft[] = []
  for (const rule of rules) {
    const source = context.fact(rule.source.key)
    if (!source) continue
    const values = Array.isArray(source.value) ? source.value : [source.value]
    const missing = values.filter(
      value => !context.fact(`${rule.targetFactPrefix}${String(value)}`),
    )
    if (!missing.length) continue
    drafts.push({
      checkId: `rule.referenced-entities.${rule.id}`,
      severity: rule.severity ?? 'HIGH',
      type: 'rule',
      source: source.source,
      expected: `each referenced entity must have a fact with prefix ${rule.targetFactPrefix}`,
      actual: `missing entities: ${missing.map(String).join(', ')}`,
      fixDocument: source.source.documentPath,
      fixSectionId: source.source.sectionId,
      conflictIdentity: {
        sourceFactKey: rule.source.key,
        sourceValue: source.value,
        targetFactPrefix: rule.targetFactPrefix,
        missing,
      },
    })
  }
  return drafts
}

export function collectRuleDrafts(
  context: FoundationAuditContext,
  input: {
    numericRules?: readonly NumericConsistencyRule[]
    entityRules?: readonly EntityReferenceRule[]
  },
): AuditIssueDraft[] {
  return [
    ...numericDrafts(context, input.numericRules ?? []),
    ...entityDrafts(context, input.entityRules ?? []),
  ]
}
