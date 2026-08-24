import { createHash } from 'node:crypto'
import type { FoundationFact, FactValue } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import {
  collectContractDrafts,
  type ContractBinding,
} from './foundation-audit-contracts'
import {
  collectRuleDrafts,
  type EntityReferenceRule,
  type FoundationAuditContext,
  type NumericConsistencyRule,
  type RuleFactDefinition,
} from './foundation-audit-rules'
import {
  type AuditIssue,
  type AuditIssueDraft,
  type AuditSeverity,
  type AuditIssueType,
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
const NUMERIC_KEYS = ['facts', 'id', 'relation', 'severity']
const ENTITY_KEYS = ['id', 'severity', 'source', 'targetFactPrefix']
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
      validateSection(definition.source, `schema fact[${index}].source`)
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

function validateRuleFact(
  context: FoundationAuditContext,
  definition: unknown,
  label: string,
): asserts definition is RuleFactDefinition {
  exactKeys(definition, ['expectedType', 'key', 'source'], label)
  const candidate = definition as RuleFactDefinition
  if (
    typeof candidate.key !== 'string' ||
    !candidate.key.trim() ||
    !['string', 'number', 'boolean', 'string[]', 'number[]'].includes(
      candidate.expectedType,
    )
  )
    throw new Error(`${label} is invalid`)
  validateSection(candidate.source, `${label}.source`)
  const indexed = context.section(
    candidate.source.documentPath,
    candidate.source.sectionId,
  )
  if (!indexed || !sameSection(indexed, candidate.source))
    throw new Error(`${label} source must be the exact indexed SectionRef`)
}

function validateRules(
  context: FoundationAuditContext,
  input: DeterministicFoundationAuditInput,
): void {
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
      !Array.isArray(rule.facts) ||
      rule.facts.length < 2 ||
      ![
        'equal',
        'less-than-or-equal',
        'greater-than-or-equal',
        'less-than',
        'greater-than',
      ].includes(rule.relation)
    )
      throw new Error('numeric rule is invalid')
    rule.facts.forEach((definition, factIndex) => {
      validateRuleFact(
        context,
        definition,
        `numeric rule[${index}].facts[${factIndex}]`,
      )
      if (definition.expectedType !== 'number')
        throw new Error('numeric rule facts must declare expectedType number')
    })
    if (
      rule.severity !== undefined &&
      !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(rule.severity)
    )
      throw new Error('numeric rule severity is invalid')
  }
  for (const [index, rule] of (input.entityRules ?? []).entries()) {
    exactKeys(rule, ENTITY_KEYS, `entity rule[${index}]`, ['severity'])
    if (
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      typeof rule.targetFactPrefix !== 'string' ||
      !rule.targetFactPrefix
    )
      throw new Error('entity rule is invalid')
    validateRuleFact(context, rule.source, `entity rule[${index}].source`)
    if (
      rule.severity !== undefined &&
      !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(rule.severity)
    )
      throw new Error('entity rule severity is invalid')
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
    if (
      binding.severity !== undefined &&
      !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(binding.severity)
    )
      throw new Error('contract binding severity is invalid')
  }
}

function typeOf(value: FactValue): FoundationFactType {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return value.every(item => typeof item === 'string') ? 'string[]' : 'number[]'
}

function validDeclaredFact(
  context: FoundationAuditContext,
  definition: RuleFactDefinition,
): boolean {
  const fact = context.fact(definition.key)
  return fact !== undefined && typeOf(fact.value) === definition.expectedType
}

function schemaDrafts(
  context: FoundationAuditContext,
  schema: FoundationSchemaInput | undefined,
  numericRules: readonly NumericConsistencyRule[],
  entityRules: readonly EntityReferenceRule[],
): AuditIssueDraft[] {
  const required = [...(schema?.requiredFacts ?? [])]
  const declaredRuleFacts = [
    ...numericRules.flatMap(rule => rule.facts),
    ...entityRules.map(rule => rule.source),
  ]
  for (const definition of declaredRuleFacts) {
    const existing = required.find(
      candidate => candidate.key === definition.key,
    )
    if (existing) {
      if (
        existing.expectedType !== definition.expectedType ||
        !sameSection(existing.source, definition.source)
      )
        throw new Error(
          `conflicting schema declaration for fact ${definition.key}`,
        )
      continue
    }
    required.push(definition)
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
    const declaredSource = context.section(
      definition.source.documentPath,
      definition.source.sectionId,
    )!
    drafts.push({
      checkId: `schema.fact-types.${definition.key}`,
      severity: definition.severity ?? 'BLOCKER',
      type: 'schema',
      source: declaredSource,
      expected: `fact ${definition.key} must have type ${definition.expectedType}`,
      actual: `fact ${definition.key} has type ${actualType}`,
      fixDocument: declaredSource.documentPath,
      fixSectionId: declaredSource.sectionId,
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

const DRAFT_KEYS = [
  'actual',
  'checkId',
  'conflictIdentity',
  'expected',
  'fixDocument',
  'fixSectionId',
  'severity',
  'source',
  'target',
  'type',
]

function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    )
  return value
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function canonicalIdentityString(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function issueDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function identitySection(section: SectionRef | undefined): unknown {
  return section
    ? { documentPath: section.documentPath, sectionId: section.sectionId }
    : null
}

function exactIssueSection(
  context: FoundationAuditContext,
  section: unknown,
  label: string,
): SectionRef {
  if (!section || typeof section !== 'object' || Array.isArray(section))
    throw new Error(`audit issue ${label} is invalid`)
  const candidate = section as SectionRef
  const resolved = context.section(candidate.documentPath, candidate.sectionId)
  if (
    !resolved ||
    resolved.heading !== candidate.heading ||
    resolved.startLine !== candidate.startLine ||
    resolved.endLine !== candidate.endLine ||
    resolved.digest !== candidate.digest
  )
    throw new Error(`audit issue ${label} is not the validated SectionRef`)
  return resolved
}

function validateIssueDraft(
  draft: unknown,
  context: FoundationAuditContext,
): AuditIssueDraft {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft))
    throw new Error('audit issue draft must be an object')
  const candidate = draft as Record<string, unknown>
  const actualKeys = Object.keys(candidate).sort()
  const expectedKeys = DRAFT_KEYS.filter(
    key => key !== 'target' || candidate.target !== undefined,
  ).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
    throw new Error(
      'audit issue draft must not contain caller id or unknown fields',
    )
  if (typeof candidate.checkId !== 'string')
    throw new Error('audit issue check identity is required')
  const checkId = canonicalIdentityString(candidate.checkId)
  if (!checkId) throw new Error('audit issue check identity is required')
  if (
    !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(String(candidate.severity))
  )
    throw new Error('audit issue severity is invalid')
  if (
    !['schema', 'rule', 'contract', 'semantic'].includes(String(candidate.type))
  )
    throw new Error('audit issue type is invalid')
  if (typeof candidate.expected !== 'string' || !candidate.expected.trim())
    throw new Error('audit issue expected text is required')
  if (typeof candidate.actual !== 'string' || !candidate.actual.trim())
    throw new Error('audit issue actual text is required')
  if (
    !candidate.conflictIdentity ||
    typeof candidate.conflictIdentity !== 'object' ||
    Array.isArray(candidate.conflictIdentity) ||
    Object.keys(candidate.conflictIdentity).length === 0 ||
    Object.keys(candidate.conflictIdentity).some(key => !key.trim())
  )
    throw new Error('audit issue conflict identity is required')
  const source = exactIssueSection(context, candidate.source, 'source')
  const target =
    candidate.target === undefined
      ? undefined
      : exactIssueSection(context, candidate.target, 'target')
  if (
    typeof candidate.fixDocument !== 'string' ||
    typeof candidate.fixSectionId !== 'string'
  )
    throw new Error('audit issue fix identity is invalid')
  const fix = context.section(candidate.fixDocument, candidate.fixSectionId)
  if (!fix) throw new Error('audit issue fix is not the validated SectionRef')
  return {
    checkId,
    severity: candidate.severity as AuditSeverity,
    type: candidate.type as AuditIssueType,
    source,
    ...(target ? { target } : {}),
    expected: candidate.expected,
    actual: candidate.actual,
    fixDocument: fix.documentPath as FoundationDocumentPath,
    fixSectionId: fix.sectionId,
    conflictIdentity: candidate.conflictIdentity as Readonly<
      Record<string, unknown>
    >,
  }
}

function compileIssueRegistry(
  context: FoundationAuditContext,
  drafts: readonly AuditIssueDraft[],
): AuditIssue[] {
  if (context.validated !== true)
    throw new Error('issue registry requires a validated audit context')
  if (!Array.isArray(drafts))
    throw new Error('issue registry drafts must be an array')
  const identities = new Set<string>()
  const ids = new Set<string>()
  const issues: AuditIssue[] = []
  for (const rawDraft of drafts) {
    const draft = validateIssueDraft(rawDraft, context)
    const identity = normalizedJson({
      checkId: draft.checkId,
      source: identitySection(draft.source),
      target: identitySection(draft.target),
      conflict: draft.conflictIdentity,
    })
    if (identities.has(identity))
      throw new Error('duplicate audit issue identity')
    identities.add(identity)
    const id = `AUD-${issueDigest(identity).slice(0, 24).toUpperCase()}`
    if (ids.has(id)) throw new Error('duplicate audit issue id')
    ids.add(id)
    issues.push({
      id,
      severity: draft.severity,
      type: draft.type,
      source: { ...draft.source },
      ...(draft.target ? { target: { ...draft.target } } : {}),
      expected: draft.expected,
      actual: draft.actual,
      fixDocument: draft.fixDocument,
      fixSectionId: draft.fixSectionId,
    })
  }
  return issues.sort((left, right) => left.id.localeCompare(right.id))
}

export function runDeterministicFoundationAudit(
  input: DeterministicFoundationAuditInput,
): AuditIssue[] {
  const context = contextFrom(input)
  validateSchema(context, input.schema)
  validateRules(context, input)
  const schemaIssues = schemaDrafts(
    context,
    input.schema,
    input.numericRules ?? [],
    input.entityRules ?? [],
  )
  const numericRules = (input.numericRules ?? []).filter(rule =>
    rule.facts.every(definition => validDeclaredFact(context, definition)),
  )
  const entityRules = (input.entityRules ?? []).filter(rule =>
    validDeclaredFact(context, rule.source),
  )
  const drafts = [
    ...schemaIssues,
    ...collectRuleDrafts(context, { numericRules, entityRules }),
    ...collectContractDrafts(context, input.contractBindings ?? []),
  ]
  return compileIssueRegistry(context, drafts)
}
