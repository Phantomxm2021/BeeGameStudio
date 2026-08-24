import { createHash } from 'node:crypto'
import {
  FOUNDATION_FACT_CATALOG,
  FOUNDATION_FACT_CATALOG_VERSION,
  foundationFactDefinition,
  type FoundationFactValueType,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import {
  type ContractBinding,
} from './foundation-audit-contracts'
import {
  runDeterministicFoundationAudit,
  type FoundationSchemaInput,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import type { AuditIssue } from './foundation-issue-registry'
import {
  applyFoundationFixAuthority,
  FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
  type FoundationDeterministicContractDeclaration,
} from './foundation-audit-authority'
import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'

export type FoundationAuditProductionManifest = {
  version: 'foundation-deterministic.v1'
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  schemaKeys: readonly FoundationFactKey[]
  contracts: readonly FoundationDeterministicContractDeclaration[]
  deferredSemanticKeys: readonly FoundationFactKey[]
  digest: string
  contractGraphDigest: string
}

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
    deferredSemanticKeys: Object.freeze(['technical.target_fps', 'level.complexity_budget'] as FoundationFactKey[]),
    digest: digest({
      version: 'foundation-deterministic.v1',
      catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
      schemaKeys: FOUNDATION_FACT_CATALOG.map(item => item.key),
      contracts: FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
      deferredSemanticKeys: ['technical.target_fps', 'level.complexity_budget'],
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

function productionSchema(sectionIndex: readonly SectionRef[]): FoundationSchemaInput {
  const declarations = FOUNDATION_FACT_CATALOG.map(definition => ({
    key: definition.key,
    source: resolveSection(sectionIndex, definition.owner),
    expectedType: definition.valueType,
    severity: 'BLOCKER' as const,
  }))
  return { requiredFacts: declarations, factTypes: declarations }
}

function productionContracts(sectionIndex: readonly SectionRef[]): ContractBinding[] {
  return FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS.map(declaration => ({
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
}): AuditIssue[] {
  if (!input || typeof input !== 'object' || !Array.isArray(input.sectionIndex) || !Array.isArray(input.factStore))
    throw new Error('production deterministic audit input is invalid')
  const candidate = input as Record<string, unknown>
  if (Object.keys(candidate).some(key => !['sectionIndex', 'factStore'].includes(key)))
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
  return applyFoundationFixAuthority(runDeterministicFoundationAudit(auditInput))
}

export function productionManifestForAudit(): FoundationAuditProductionManifest {
  return FOUNDATION_AUDIT_PRODUCTION_MANIFEST
}
