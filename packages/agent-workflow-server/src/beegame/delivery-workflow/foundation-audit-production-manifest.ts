import { createHash } from 'node:crypto'
import {
  FOUNDATION_FACT_CATALOG,
  FOUNDATION_FACT_CATALOG_VERSION,
  foundationFactDefinition,
  isFoundationFactKey,
  type FoundationFactValueType,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import {
  type ContractBinding,
} from './foundation-audit-contracts'
import {
  compileFoundationIssueRegistry,
  runDeterministicFoundationAudit,
  type FoundationSchemaInput,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import type { AuditIssue, AuditIssueDraft } from './foundation-issue-registry'
import {
  applyFoundationFixAuthority,
  FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
  type FoundationDeterministicContractDeclaration,
} from './foundation-audit-authority'
import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationImpactAnalysis } from './foundation-impact-analysis'
import type { FoundationDocumentPath } from './types'
import {
  collectFoundationProjectDeterministicDrafts,
  type FoundationProjectDeterministicInput,
} from './foundation-project-deterministic-rules'

export type FoundationAuditProductionManifest = {
  version: 'foundation-deterministic.v1'
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  schemaKeys: readonly FoundationFactKey[]
  contracts: readonly FoundationDeterministicContractDeclaration[]
  deferredSemanticKeys: readonly FoundationFactKey[]
  digest: string
  contractGraphDigest: string
}

const DEFERRED_SEMANTIC_KEYS = Object.freeze([
  'technical.target_fps',
  'level.complexity_budget',
  'asset.art_constraint_refs',
] as FoundationFactKey[])

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function contractGraphDigest(): string {
  const graph = Object.fromEntries(
    [...new Set(FOUNDATION_FACT_CATALOG.map(item => item.owner.documentPath))]
      .sort()
      .map(path => {
        const current = getGameDocumentContract(path)
        return [
          path,
          {
            allowedUpstreamPaths: current.allowedUpstreamPaths,
            upstreamSections: current.upstreamSections,
          },
        ]
      }),
  )
  return digest(graph)
}

export const FOUNDATION_AUDIT_PRODUCTION_MANIFEST: FoundationAuditProductionManifest =
  Object.freeze({
    version: 'foundation-deterministic.v1',
    catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
    schemaKeys: Object.freeze(
      FOUNDATION_FACT_CATALOG.map(item => item.key),
    ),
    contracts: FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
    deferredSemanticKeys: DEFERRED_SEMANTIC_KEYS,
    digest: digest({
      version: 'foundation-deterministic.v1',
      catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
      schemaKeys: FOUNDATION_FACT_CATALOG.map(item => item.key),
      contracts: FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
      deferredSemanticKeys: DEFERRED_SEMANTIC_KEYS,
    }),
    contractGraphDigest: contractGraphDigest(),
  })

function resolveSection(
  index: readonly SectionRef[],
  owner: { documentPath: FoundationDocumentPath; sectionId: string },
): SectionRef {
  const section = index.find(
    item =>
      item.documentPath === owner.documentPath && item.sectionId === owner.sectionId,
  )
  if (!section)
    throw new Error(`production audit owner section is missing: ${owner.documentPath}#${owner.sectionId}`)
  return section
}

function productionSchema(
  sectionIndex: readonly SectionRef[],
  selectedFactKeys?: ReadonlySet<FoundationFactKey>,
): FoundationSchemaInput {
  const declarations = FOUNDATION_FACT_CATALOG
    .filter(definition => selectedFactKeys === undefined || selectedFactKeys.has(definition.key))
    .map(definition => ({
      key: definition.key,
      source: resolveSection(sectionIndex, definition.owner),
      expectedType: definition.valueType,
      severity: 'BLOCKER' as const,
    }))
  const deferred = new Set(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.deferredSemanticKeys)
  return {
    // Deferred semantic facts remain in the closed type catalog, but absence
    // is resolved by their owner semantic packet rather than schema BLOCKER.
    requiredFacts: declarations.filter(declaration => !deferred.has(declaration.key)),
    factTypes: declarations,
  }
}

function productionContracts(
  sectionIndex: readonly SectionRef[],
  selectedContractIds?: ReadonlySet<string>,
): ContractBinding[] {
  return FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS
    .filter(declaration => selectedContractIds === undefined || selectedContractIds.has(declaration.id))
    .map(declaration => ({
      ...declaration,
      source: resolveSection(sectionIndex, declaration.source),
      target: resolveSection(sectionIndex, declaration.target),
    }))
}

function valueType(value: unknown): FoundationFactValueType | undefined {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (value.every(item => typeof item === 'string')) return 'string[]'
  if (value.every(item => typeof item === 'number' && Number.isFinite(item))) return 'number[]'
  return undefined
}

function catalogValueValid(
  value: unknown,
  definition: NonNullable<ReturnType<typeof foundationFactDefinition>>,
): boolean {
  if (valueType(value) !== definition.valueType) return true
  if (definition.valueType === 'number') {
    const number = value as number
    return Number.isInteger(number) &&
      number >= (definition.valueSpec.min ?? -Infinity) &&
      number <= (definition.valueSpec.max ?? Infinity)
  }
  if (definition.valueType === 'string')
    return !definition.valueSpec.enum || definition.valueSpec.enum.includes(value as string)
  const list = value as unknown[]
  if (
    list.length < (definition.valueSpec.minItems ?? 0) ||
    list.length > (definition.valueSpec.maxItems ?? Infinity)
  ) return false
  if (!definition.valueSpec.itemPattern) return true
  const pattern = new RegExp(definition.valueSpec.itemPattern)
  return list.every(item => typeof item === 'string' && pattern.test(item))
}

function catalogValueIssueDrafts(
  factStore: readonly FoundationFact[],
  selectedFactKeys?: ReadonlySet<FoundationFactKey>,
): AuditIssueDraft[] {
  return factStore.flatMap(fact => {
    if (selectedFactKeys !== undefined && !selectedFactKeys.has(fact.key as FoundationFactKey)) return []
    const definition = foundationFactDefinition(fact.key)
    if (!definition || valueType(fact.value) !== definition.valueType || catalogValueValid(fact.value, definition)) return []
    return [{
      checkId: `schema.fact-values.${fact.key}`,
      severity: 'BLOCKER' as const,
      type: 'schema' as const,
      source: fact.source,
      expected: `fact ${fact.key} must satisfy its catalog value constraints`,
      actual: `fact ${fact.key} has invalid value ${JSON.stringify(fact.value)}`,
      remediation: { kind: 'patch', documentPath: fact.source.documentPath, sectionIds: [fact.source.sectionId] },
      conflictIdentity: {
        key: fact.key,
        expectedType: definition.valueType,
        value: fact.value,
      },
    }]
  })
}

function validContractFacts(
  bindings: readonly ContractBinding[],
  factStore: readonly FoundationFact[],
): ContractBinding[] {
  const facts = new Map(factStore.map(fact => [fact.key, fact]))
  return bindings.filter(binding => {
    const source = facts.get(binding.sourceFactKey)
    const target = facts.get(binding.targetFactKey)
    const sourceDefinition = foundationFactDefinition(binding.sourceFactKey)
    const targetDefinition = foundationFactDefinition(binding.targetFactKey)
    return Boolean(
      source && target && sourceDefinition && targetDefinition &&
      valueType(source.value) === sourceDefinition.valueType &&
      valueType(target.value) === targetDefinition.valueType,
    )
  })
}

export function runProductionDeterministicFoundationAudit(input: {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  documents?: FoundationProjectDeterministicInput['documents']
}): AuditIssue[] {
  if (!input || typeof input !== 'object' || !Array.isArray(input.sectionIndex) || !Array.isArray(input.factStore))
    throw new Error('production deterministic audit input is invalid')
  const candidate = input as Record<string, unknown>
  if (Object.keys(candidate).some(key => !['sectionIndex', 'factStore', 'documents'].includes(key)))
    throw new Error('caller production audit rules are not accepted')
  const auditInput: DeterministicFoundationAuditInput = {
    sectionIndex: input.sectionIndex,
    factStore: input.factStore,
    schema: productionSchema(input.sectionIndex),
    // Catalog-backed schema checks own completeness and type validity. A
    // contract only evaluates once both sides are admitted; otherwise its
    // missing/invalid fact is represented by the single schema issue.
    contractBindings: validContractFacts(
      productionContracts(input.sectionIndex),
      input.factStore,
    ),
  }
  const deterministicIssues = applyFoundationFixAuthority(
    runDeterministicFoundationAudit(auditInput),
  )
  const valueIssues = applyFoundationFixAuthority(
    // FactStore admission normally enforces these constraints; this audit
    // boundary repeats them for present deferred facts supplied to the audit.
    compileFoundationIssueRegistry({
      sectionIndex: input.sectionIndex,
      factStore: input.factStore,
      drafts: catalogValueIssueDrafts(input.factStore),
    }),
  )
  const projectIssues = input.documents
    ? applyFoundationFixAuthority(
      compileFoundationIssueRegistry({
        sectionIndex: input.sectionIndex,
        factStore: input.factStore,
        drafts: collectFoundationProjectDeterministicDrafts({
          documents: input.documents,
          sectionIndex: input.sectionIndex,
        }),
      }),
    )
    : []
  return [...deterministicIssues, ...valueIssues, ...projectIssues].sort((left, right) => left.id.localeCompare(right.id))
}

function assertImpactIdentities(impact: FoundationImpactAnalysis): {
  factKeys: ReadonlySet<FoundationFactKey>
  contractIds: ReadonlySet<string>
} {
  if (!impact || typeof impact !== 'object' || Array.isArray(impact))
    throw new Error('production deterministic impact is invalid')
  const candidate = impact as unknown as Record<string, unknown>
  const keys = ['changedSections', 'checkIds', 'contractIds', 'factKeys', 'issueIds']
  if (Object.keys(candidate).sort().join('\0') !== keys.join('\0'))
    throw new Error('production deterministic impact shape is invalid')
  for (const [name, value] of [
    ['checkIds', impact.checkIds],
    ['contractIds', impact.contractIds],
    ['factKeys', impact.factKeys],
    ['issueIds', impact.issueIds],
  ] as const) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0) || new Set(value).size !== value.length)
      throw new Error(`production deterministic impact ${name} is invalid`)
  }
  if (impact.changedSections.length === 0 || impact.issueIds.length === 0)
    throw new Error('production deterministic impact must identify changed sections and issues')
  const changedSectionKeys = new Set<string>()
  for (const section of impact.changedSections) {
    if (!section || typeof section !== 'object' || Object.keys(section).sort().join('\0') !== 'documentPath\0sectionId')
      throw new Error('production deterministic impact changedSections is invalid')
    const path = section.documentPath
    const sectionId = section.sectionId
    if (typeof path !== 'string' || typeof sectionId !== 'string')
      throw new Error('production deterministic impact changedSections is invalid')
    const contract = getGameDocumentContract(path as FoundationDocumentPath)
    if (!contract || !contract.sections.some(candidate => candidate.sectionId === sectionId))
      throw new Error(`production deterministic impact contains unknown section: ${path}#${sectionId}`)
    const key = `${path}\0${sectionId}`
    if (changedSectionKeys.has(key)) throw new Error(`production deterministic impact changedSections is duplicate: ${key}`)
    changedSectionKeys.add(key)
  }
  const factKeys = new Set<FoundationFactKey>()
  for (const key of impact.factKeys) {
    if (!isFoundationFactKey(key)) throw new Error(`production deterministic impact contains unknown fact key: ${key}`)
    factKeys.add(key)
  }
  const contractById = new Map(FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS.map(declaration => [declaration.id, declaration]))
  const contractIds = new Set<string>()
  for (const id of impact.contractIds) {
    if (!contractById.has(id)) throw new Error(`production deterministic impact contains unknown contract ID: ${id}`)
    contractIds.add(id)
  }
  const expectedContractIds = new Set(
    FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS
      .filter(declaration => factKeys.has(declaration.sourceFactKey) || factKeys.has(declaration.targetFactKey))
      .map(declaration => declaration.id),
  )
  if (expectedContractIds.size !== contractIds.size || [...expectedContractIds].some(id => !contractIds.has(id)))
    throw new Error('production deterministic impact contract IDs do not match impacted facts')
  const expectedCheckIds = new Set(
    FOUNDATION_FACT_CATALOG
      .filter(definition => factKeys.has(definition.key))
      .flatMap(definition => definition.consumers),
  )
  const actualCheckIds = new Set(impact.checkIds)
  if (expectedCheckIds.size !== actualCheckIds.size || [...expectedCheckIds].some(id => !actualCheckIds.has(id)))
    throw new Error('production deterministic impact check IDs do not match impacted facts')
  return { factKeys, contractIds }
}

/**
 * Runs only service-owned deterministic checks selected by a validated impact.
 * This is intentionally a separate evaluator: patch validation must not run a
 * full audit and filter its results after the fact.
 */
export function runProductionDeterministicFoundationImpactAudit(input: {
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
  impact: FoundationImpactAnalysis
}): AuditIssue[] {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('production deterministic impact audit input is invalid')
  const candidate = input as unknown as Record<string, unknown>
  if (Object.keys(candidate).sort().join('\0') !== 'factStore\0impact\0sectionIndex')
    throw new Error('caller production impact audit rules are not accepted')
  if (!Array.isArray(input.sectionIndex) || !Array.isArray(input.factStore))
    throw new Error('production deterministic impact audit input is invalid')
  const { factKeys, contractIds } = assertImpactIdentities(input.impact)
  const auditInput: DeterministicFoundationAuditInput = {
    sectionIndex: input.sectionIndex,
    factStore: input.factStore,
    schema: productionSchema(input.sectionIndex, factKeys),
    contractBindings: validContractFacts(
      productionContracts(input.sectionIndex, contractIds),
      input.factStore,
    ),
  }
  const deterministicIssues = applyFoundationFixAuthority(
    runDeterministicFoundationAudit(auditInput),
  )
  const valueIssues = applyFoundationFixAuthority(
    compileFoundationIssueRegistry({
      sectionIndex: input.sectionIndex,
      factStore: input.factStore,
      drafts: catalogValueIssueDrafts(input.factStore, factKeys),
    }),
  )
  return [...deterministicIssues, ...valueIssues].sort((left, right) => left.id.localeCompare(right.id))
}

export function productionManifestForAudit(): FoundationAuditProductionManifest {
  return FOUNDATION_AUDIT_PRODUCTION_MANIFEST
}
