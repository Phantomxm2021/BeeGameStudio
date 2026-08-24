import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  collectContractDrafts,
  type ContractBinding,
} from './foundation-audit-contracts'
import {
  collectRuleDrafts,
  type EntityReferenceRule,
  type FoundationAuditContext,
  type NumericConsistencyRule,
} from './foundation-audit-rules'
import {
  compileIssueRegistry,
  type AuditIssue,
  type AuditIssueDraft,
  type AuditSeverity,
} from './foundation-issue-registry'

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

export type DeterministicFoundationAuditInput = {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  schema?: FoundationSchemaInput
  numericRules?: readonly NumericConsistencyRule[]
  entityRules?: readonly EntityReferenceRule[]
  contractBindings?: readonly ContractBinding[]
}

const SECTION_KEYS = [
  'digest',
  'documentPath',
  'endLine',
  'heading',
  'sectionId',
  'startLine',
]
const FACT_KEYS = ['key', 'source', 'value']
const SCHEMA_KEYS = ['factTypes', 'requiredFacts']
const REQUIRED_KEYS = ['expectedType', 'key', 'severity', 'source']
const NUMERIC_KEYS = ['factKeys', 'id', 'relation', 'severity']
const ENTITY_KEYS = ['id', 'severity', 'sourceFactKey', 'targetFactPrefix']
const BINDING_KEYS = [
  'id',
  'relation',
  'severity',
  'source',
  'sourceFactKey',
  'target',
  'targetFactKey',
]

function exactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  const actual = Object.keys(value as object).sort()
  const allowed = [...keys]
    .filter(key => !optional.includes(key) || Object.hasOwn(value, key))
    .sort()
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    const unknown = actual.filter(key => !keys.includes(key))
    throw new Error(
      `${label} has unknown or missing fields${unknown.length ? `: ${unknown.join(', ')}` : ''}`,
    )
  }
}

function validateSection(value: unknown, label: string): SectionRef {
  exactKeys(value, SECTION_KEYS, label)
  const section = value as SectionRef
  if (
    typeof section.documentPath !== 'string' ||
    !/^docs\/[A-Za-z0-9_./-]+\.md$/.test(section.documentPath) ||
    section.documentPath.includes('..')
  )
    throw new Error(`${label} documentPath is invalid`)
  if (
    typeof section.sectionId !== 'string' ||
    !/^[a-z0-9._-]+$/.test(section.sectionId)
  )
    throw new Error(`${label} sectionId is invalid`)
  if (typeof section.heading !== 'string' || !section.heading.trim())
    throw new Error(`${label} heading is invalid`)
  if (
    !Number.isInteger(section.startLine) ||
    section.startLine < 1 ||
    !Number.isInteger(section.endLine) ||
    section.endLine < section.startLine
  )
    throw new Error(`${label} line bounds are invalid`)
  if (
    typeof section.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(section.digest)
  )
    throw new Error(`${label} digest is invalid`)
  return { ...section }
}

function validValue(value: unknown): value is FactValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!Array.isArray(value) || value.length === 0) return false
  return (
    value.every(item => typeof item === 'string') ||
    value.every(item => typeof item === 'number' && Number.isFinite(item))
  )
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

function contextFrom(
  input: DeterministicFoundationAuditInput,
): FoundationAuditContext {
  if (!input || typeof input !== 'object')
    throw new Error('audit input is invalid')
  if (!Object.hasOwn(input, 'sectionIndex'))
    throw new Error('section index is mandatory')
  if (!Array.isArray(input.sectionIndex) || input.sectionIndex.length === 0)
    throw new Error('section index is mandatory and must not be empty')
  if (!Array.isArray(input.factStore))
    throw new Error('fact store is mandatory')
  exactKeys(
    input,
    [
      'contractBindings',
      'entityRules',
      'factStore',
      'numericRules',
      'schema',
      'sectionIndex',
    ],
    'audit input',
    ['contractBindings', 'entityRules', 'numericRules', 'schema'],
  )

  const sections = input.sectionIndex
    .map((section, index) => validateSection(section, `SectionRef[${index}]`))
    .sort((a, b) =>
      `${a.documentPath}\0${a.sectionId}`.localeCompare(
        `${b.documentPath}\0${b.sectionId}`,
      ),
    )
  const sectionMap = new Map<string, SectionRef>()
  for (const section of sections) {
    const key = `${section.documentPath}\0${section.sectionId}`
    if (sectionMap.has(key))
      throw new Error(
        `duplicate SectionRef identity: ${section.documentPath}#${section.sectionId}`,
      )
    sectionMap.set(key, section)
  }
  const canonicalPresent = CANONICAL_FOUNDATION_DOCUMENTS.some(path =>
    sections.some(section => section.documentPath === path),
  )
  if (
    canonicalPresent &&
    !CANONICAL_FOUNDATION_DOCUMENTS.every(path =>
      sections.some(section => section.documentPath === path),
    )
  )
    throw new Error(
      'validated foundation SectionRef index must contain all eight canonical documents',
    )

  const facts = input.factStore
    .map((fact, index) => {
      exactKeys(fact, FACT_KEYS, `FoundationFact[${index}]`)
      if (typeof fact.key !== 'string' || !fact.key.trim())
        throw new Error(`FoundationFact[${index}] key is invalid`)
      if (!validValue(fact.value))
        throw new Error(`FoundationFact[${index}] value is invalid`)
      const source = validateSection(
        fact.source,
        `FoundationFact[${index}].source`,
      )
      const indexed = sectionMap.get(
        `${source.documentPath}\0${source.sectionId}`,
      )
      if (!indexed || !sameSection(indexed, source))
        throw new Error(
          `FoundationFact[${index}] fact source is not the indexed SectionRef`,
        )
      return { key: fact.key, value: fact.value, source: indexed }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
  const factMap = new Map<string, FoundationFact>()
  for (const fact of facts) {
    if (factMap.has(fact.key))
      throw new Error(`duplicate fact key: ${fact.key}`)
    factMap.set(fact.key, fact)
  }
  return {
    validated: true,
    sectionIndex: sections,
    factStore: facts,
    section: (documentPath, sectionId) =>
      sectionMap.get(`${documentPath}\0${sectionId}`),
    fact: key => factMap.get(key),
  }
}

function validateSchema(
  context: FoundationAuditContext,
  schema: FoundationSchemaInput | undefined,
): void {
  if (!schema) return
  exactKeys(schema, SCHEMA_KEYS, 'schema', ['factTypes', 'requiredFacts'])
  for (const group of [schema.requiredFacts ?? [], schema.factTypes ?? []]) {
    for (const [index, definition] of group.entries()) {
      exactKeys(definition, REQUIRED_KEYS, `schema fact[${index}]`, [
        'severity',
      ])
      if (
        typeof definition.key !== 'string' ||
        !definition.key.trim() ||
        !context.section(
          definition.source.documentPath,
          definition.source.sectionId,
        ) ||
        !sameSection(
          context.section(
            definition.source.documentPath,
            definition.source.sectionId,
          )!,
          definition.source,
        )
      )
        throw new Error(
          'schema fact source must be the exact indexed SectionRef',
        )
      if (
        !['string', 'number', 'boolean', 'string[]', 'number[]'].includes(
          definition.expectedType,
        )
      )
        throw new Error('schema fact expectedType is invalid')
      if (
        definition.severity !== undefined &&
        !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(definition.severity)
      )
        throw new Error('schema fact severity is invalid')
    }
  }
}

function validateRules(input: DeterministicFoundationAuditInput): void {
  for (const [name, value] of [
    ['numericRules', input.numericRules],
    ['entityRules', input.entityRules],
    ['contractBindings', input.contractBindings],
  ] as const)
    if (value !== undefined && !Array.isArray(value))
      throw new Error(`${name} must be an array`)
  for (const [index, rule] of (input.numericRules ?? []).entries()) {
    exactKeys(rule, NUMERIC_KEYS, `numeric rule[${index}]`, ['severity'])
    if (
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      !Array.isArray(rule.factKeys) ||
      rule.factKeys.length < 2 ||
      rule.factKeys.some(key => typeof key !== 'string' || !key.trim()) ||
      ![
        'equal',
        'less-than-or-equal',
        'greater-than-or-equal',
        'less-than',
        'greater-than',
      ].includes(rule.relation)
    )
      throw new Error('numeric rule is invalid')
  }
  for (const [index, rule] of (input.entityRules ?? []).entries()) {
    exactKeys(rule, ENTITY_KEYS, `entity rule[${index}]`, ['severity'])
    if (
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      typeof rule.sourceFactKey !== 'string' ||
      !rule.sourceFactKey.trim() ||
      typeof rule.targetFactPrefix !== 'string' ||
      !rule.targetFactPrefix
    )
      throw new Error('entity rule is invalid')
  }
  for (const [index, binding] of (input.contractBindings ?? []).entries()) {
    exactKeys(binding, BINDING_KEYS, `contract binding[${index}]`, ['severity'])
    validateSection(binding.source, `contract binding[${index}].source`)
    validateSection(binding.target, `contract binding[${index}].target`)
    if (
      typeof binding.id !== 'string' ||
      !binding.id.trim() ||
      typeof binding.sourceFactKey !== 'string' ||
      !binding.sourceFactKey.trim() ||
      typeof binding.targetFactKey !== 'string' ||
      !binding.targetFactKey.trim() ||
      !['exists', 'equal', 'numeric-equal'].includes(binding.relation)
    )
      throw new Error('contract binding is invalid')
  }
}

function typeOf(value: FactValue): FoundationFactType {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return value.every(item => typeof item === 'string') ? 'string[]' : 'number[]'
}

function schemaDrafts(
  context: FoundationAuditContext,
  schema: FoundationSchemaInput | undefined,
): AuditIssueDraft[] {
  const required = [...(schema?.requiredFacts ?? [])]
  for (const section of context.sectionIndex) {
    const contract = getGameDocumentContract(section.documentPath as never)
    if (
      !contract ||
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
    if (!required.some(definition => definition.key === key))
      required.push({ key, source: section, expectedType: 'string' })
  }
  const drafts: AuditIssueDraft[] = []
  for (const definition of required) {
    const source = context.section(
      definition.source.documentPath,
      definition.source.sectionId,
    )!
    const fact = context.fact(definition.key)
    if (!fact)
      drafts.push({
        checkId: `schema.required-section-facts.${definition.key}`,
        severity: definition.severity ?? 'BLOCKER',
        type: 'schema',
        source,
        expected: `required fact ${definition.key} must exist with type ${definition.expectedType}`,
        actual: `missing fact ${definition.key}`,
        fixDocument: source.documentPath,
        fixSectionId: source.sectionId,
        conflictIdentity: {
          key: definition.key,
          expectedType: definition.expectedType,
        },
      })
  }
  const typed = [...(schema?.factTypes ?? [])]
  for (const definition of required)
    if (!typed.some(candidate => candidate.key === definition.key))
      typed.push(definition)
  for (const definition of typed) {
    const fact = context.fact(definition.key)
    if (!fact) continue
    const actualType = typeOf(fact.value)
    if (actualType === definition.expectedType) continue
    drafts.push({
      checkId: `schema.fact-types.${definition.key}`,
      severity: definition.severity ?? 'BLOCKER',
      type: 'schema',
      source: fact.source,
      expected: `fact ${definition.key} must have type ${definition.expectedType}`,
      actual: `fact ${definition.key} has type ${actualType}`,
      fixDocument: fact.source.documentPath,
      fixSectionId: fact.source.sectionId,
      conflictIdentity: {
        key: definition.key,
        expectedType: definition.expectedType,
        actualType,
        value: fact.value,
      },
    })
  }
  return drafts
}

export function runDeterministicFoundationAudit(
  input: DeterministicFoundationAuditInput,
): AuditIssue[] {
  const context = contextFrom(input)
  validateSchema(context, input.schema)
  validateRules(input)
  const drafts = [
    ...schemaDrafts(context, input.schema),
    ...collectRuleDrafts(context, input),
    ...collectContractDrafts(context, input.contractBindings ?? []),
  ]
  return compileIssueRegistry(context, drafts)
}
