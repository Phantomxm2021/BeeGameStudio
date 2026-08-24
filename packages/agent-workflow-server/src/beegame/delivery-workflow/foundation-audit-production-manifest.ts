import { createHash } from 'node:crypto'
import {
  FOUNDATION_FACT_CATALOG,
  FOUNDATION_FACT_CATALOG_VERSION,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import {
  collectContractDrafts,
  type ContractBinding,
  type ContractBindingRelation,
} from './foundation-audit-contracts'
import {
  runDeterministicFoundationAudit,
  type FoundationSchemaInput,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import type { AuditIssue } from './foundation-issue-registry'
import { applyFoundationFixAuthority } from './foundation-audit-authority'
import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'

type ProductionContractDeclaration = {
  id: string
  sourceFactKey: FoundationFactKey
  targetFactKey: FoundationFactKey
  relation: ContractBindingRelation
  source: { documentPath: FoundationDocumentPath; sectionId: string }
  target: { documentPath: FoundationDocumentPath; sectionId: string }
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
}

export type FoundationAuditProductionManifest = {
  version: 'foundation-deterministic.v1'
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  schemaKeys: readonly FoundationFactKey[]
  contracts: readonly ProductionContractDeclaration[]
  deferredSemanticKeys: readonly FoundationFactKey[]
  digest: string
  contractGraphDigest: string
}

const contract = (
  id: string,
  sourceFactKey: FoundationFactKey,
  targetFactKey: FoundationFactKey,
  relation: ContractBindingRelation,
  source: ProductionContractDeclaration['source'],
  target: ProductionContractDeclaration['target'],
): ProductionContractDeclaration => ({
  id,
  sourceFactKey,
  targetFactKey,
  relation,
  source,
  target,
  severity: 'HIGH',
})

const PRODUCTION_CONTRACTS: readonly ProductionContractDeclaration[] = [
  contract(
    'technical-actions-authority',
    'technical.supported_actions',
    'game.mechanics',
    'contains-all',
    { documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'input_interaction' },
    { documentPath: 'docs/GDD.md', sectionId: 'player_actions' },
  ),
  contract(
    'asset-boss-count-authority',
    'asset.boss.count',
    'game.boss.count',
    'numeric-equal',
    { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' },
    { documentPath: 'docs/GDD.md', sectionId: 'rules_systems' },
  ),
  contract(
    'ui-resources-authority',
    'ui.displayed_resources',
    'game.resources',
    'contains-all',
    { documentPath: 'docs/UI_UX_SPEC.md', sectionId: 'hud' },
    { documentPath: 'docs/GDD.md', sectionId: 'rules_systems' },
  ),
  contract(
    'asset-inventory-authority',
    'asset.inventory_ids',
    'level.required_assets',
    'contains-all',
    { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' },
    { documentPath: 'docs/LEVEL_SCENE_DESIGN.md', sectionId: 'content_matrix' },
  ),
  contract(
    'asset-art-constraints-authority',
    'asset.art_constraint_refs',
    'art.style_constraints',
    'contains-all',
    { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'dependencies' },
    { documentPath: 'docs/ART_DIRECTION.md', sectionId: 'visual_pillars' },
  ),
]

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
    contracts: Object.freeze(PRODUCTION_CONTRACTS.map(item => Object.freeze({ ...item }))),
    deferredSemanticKeys: Object.freeze(['technical.target_fps', 'level.complexity_budget'] as FoundationFactKey[]),
    digest: digest({
      version: 'foundation-deterministic.v1',
      catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
      schemaKeys: FOUNDATION_FACT_CATALOG.map(item => item.key),
      contracts: PRODUCTION_CONTRACTS,
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
  return PRODUCTION_CONTRACTS.map(declaration => ({
    ...declaration,
    source: resolveSection(sectionIndex, declaration.source),
    target: resolveSection(sectionIndex, declaration.target),
  }))
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
    contractBindings: productionContracts(input.sectionIndex),
  }
  return applyFoundationFixAuthority(runDeterministicFoundationAudit(auditInput))
}

export function productionManifestForAudit(): FoundationAuditProductionManifest {
  return FOUNDATION_AUDIT_PRODUCTION_MANIFEST
}
