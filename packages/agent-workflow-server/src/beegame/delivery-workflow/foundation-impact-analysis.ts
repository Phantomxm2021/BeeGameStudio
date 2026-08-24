import {
  FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
  type FoundationDeterministicContractDeclaration,
} from './foundation-audit-authority'
import {
  FOUNDATION_FACT_CATALOG,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import { getGameDocumentContract } from './game-document-contracts'
import type { PatchOperation } from './foundation-revision-stage'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

export type FoundationSectionIdentity = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
}>

export type FoundationImpactAnalysis = Readonly<{
  changedSections: readonly FoundationSectionIdentity[]
  factKeys: readonly FoundationFactKey[]
  contractIds: readonly string[]
  checkIds: readonly string[]
  issueIds: readonly string[]
}>

const DIGEST = /^[a-f0-9]{64}$/
const CANONICAL_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const OPERATION_KEYS = new Set([
  'kind',
  'documentPath',
  'sectionId',
  'issueIds',
  'beforeDigest',
  'afterDigest',
])

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sectionIdentityKey(section: FoundationSectionIdentity): string {
  return `${section.documentPath}\0${section.sectionId}`
}

function assertExactOperationKeys(
  operation: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(operation).sort(compareStable)
  const keys = [...expected].sort(compareStable)
  if (
    actual.length !== keys.length ||
    actual.some((key, index) => key !== keys[index]) ||
    actual.some(key => !OPERATION_KEYS.has(key))
  )
    throw new Error('foundation impact PatchOperation shape is invalid')
}

function assertIssueIds(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(item => typeof item !== 'string' || item.trim().length === 0) ||
    new Set(value).size !== value.length
  )
    throw new Error('foundation impact operation issueIds must be unique and non-empty')
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`foundation impact ${label} must be a lowercase SHA-256 digest`)
}

function canonicalSection(
  documentPath: unknown,
  sectionId: unknown,
): FoundationSectionIdentity {
  if (
    typeof documentPath !== 'string' ||
    !CANONICAL_DOCUMENTS.has(documentPath)
  )
    throw new Error('foundation impact operation document is not canonical')
  if (typeof sectionId !== 'string' || sectionId.trim().length === 0)
    throw new Error('foundation impact operation section is invalid')
  const contract = getGameDocumentContract(documentPath as FoundationDocumentPath)
  if (!contract.sections.some(section => section.sectionId === sectionId))
    throw new Error(
      `foundation impact operation section is not canonical: ${documentPath}#${sectionId}`,
    )
  return Object.freeze({
    documentPath: documentPath as FoundationDocumentPath,
    sectionId,
  })
}

function validateOperation(value: unknown): PatchOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('foundation impact PatchOperation must be an object')
  const operation = value as Record<string, unknown>
  if (operation.kind === 'INSERT') {
    assertExactOperationKeys(operation, [
      'afterDigest',
      'documentPath',
      'issueIds',
      'kind',
      'sectionId',
    ])
    assertDigest(operation.afterDigest, 'afterDigest')
  } else if (operation.kind === 'DELETE') {
    assertExactOperationKeys(operation, [
      'beforeDigest',
      'documentPath',
      'issueIds',
      'kind',
      'sectionId',
    ])
    assertDigest(operation.beforeDigest, 'beforeDigest')
  } else if (operation.kind === 'REPLACE') {
    assertExactOperationKeys(operation, [
      'afterDigest',
      'beforeDigest',
      'documentPath',
      'issueIds',
      'kind',
      'sectionId',
    ])
    assertDigest(operation.beforeDigest, 'beforeDigest')
    assertDigest(operation.afterDigest, 'afterDigest')
  } else {
    throw new Error('foundation impact PatchOperation kind is invalid')
  }
  canonicalSection(operation.documentPath, operation.sectionId)
  assertIssueIds(operation.issueIds)
  return operation as unknown as PatchOperation
}

function validateServiceAuthority(): Readonly<{
  factByOwner: ReadonlyMap<string, readonly FoundationFactKey[]>
  factsByKey: ReadonlyMap<FoundationFactKey, (typeof FOUNDATION_FACT_CATALOG)[number]>
  contracts: readonly FoundationDeterministicContractDeclaration[]
}> {
  const factByOwner = new Map<string, FoundationFactKey[]>()
  const factsByKey = new Map<
    FoundationFactKey,
    (typeof FOUNDATION_FACT_CATALOG)[number]
  >()
  for (const definition of FOUNDATION_FACT_CATALOG) {
    if (factsByKey.has(definition.key))
      throw new Error(`foundation impact catalog has duplicate fact key: ${definition.key}`)
    canonicalSection(definition.owner.documentPath, definition.owner.sectionId)
    if (
      definition.consumers.some(
        consumer => typeof consumer !== 'string' || consumer.trim().length === 0,
      ) || new Set(definition.consumers).size !== definition.consumers.length
    )
      throw new Error(`foundation impact catalog has invalid consumer IDs: ${definition.key}`)
    factsByKey.set(definition.key, definition)
    const ownerKey = `${definition.owner.documentPath}\0${definition.owner.sectionId}`
    const owned = factByOwner.get(ownerKey) ?? []
    owned.push(definition.key)
    factByOwner.set(ownerKey, owned)
  }

  const contractIds = new Set<string>()
  for (const declaration of FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS) {
    if (!declaration.id || contractIds.has(declaration.id))
      throw new Error('foundation impact contract IDs are duplicate or empty')
    contractIds.add(declaration.id)
    const source = factsByKey.get(declaration.sourceFactKey)
    const target = factsByKey.get(declaration.targetFactKey)
    if (!source || !target)
      throw new Error(`foundation impact contract references an unknown fact: ${declaration.id}`)
    if (
      source.owner.documentPath !== declaration.source.documentPath ||
      source.owner.sectionId !== declaration.source.sectionId ||
      target.owner.documentPath !== declaration.target.documentPath ||
      target.owner.sectionId !== declaration.target.sectionId
    )
      throw new Error(`foundation impact contract references an orphan owner: ${declaration.id}`)
    canonicalSection(declaration.source.documentPath, declaration.source.sectionId)
    canonicalSection(declaration.target.documentPath, declaration.target.sectionId)
  }
  return {
    factByOwner,
    factsByKey,
    contracts: FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS,
  }
}

/**
 * Calculates revision impact only from service-validated PatchOperations and
 * immutable Foundation catalog/contract declarations. No caller graph or
 * semantic inference is accepted here.
 */
export function analyzeFoundationImpact(
  operations: readonly PatchOperation[],
): FoundationImpactAnalysis {
  if (!Array.isArray(operations) || operations.length === 0)
    throw new Error('foundation impact requires a non-empty PatchOperation array')

  const authority = validateServiceAuthority()
  const changedSections = new Map<string, FoundationSectionIdentity>()
  const issueTargets = new Map<string, string>()
  for (const rawOperation of operations) {
    const operation = validateOperation(rawOperation)
    const section = canonicalSection(operation.documentPath, operation.sectionId)
    const sectionKey = sectionIdentityKey(section)
    if (changedSections.has(sectionKey))
      throw new Error(`foundation impact contains duplicate PatchOperation identity: ${sectionKey}`)
    changedSections.set(sectionKey, section)
    for (const issueId of operation.issueIds) {
      const previousTarget = issueTargets.get(issueId)
      if (previousTarget !== undefined)
        throw new Error(
          `foundation impact issue coverage repeats issue or changes target: ${issueId}`,
        )
      issueTargets.set(issueId, sectionKey)
    }
  }
  if (issueTargets.size === 0)
    throw new Error('foundation impact issue coverage is empty')

  const changed = [...changedSections.values()].sort((left, right) =>
    compareStable(sectionIdentityKey(left), sectionIdentityKey(right)),
  )
  const factKeys = new Set<FoundationFactKey>()
  for (const section of changed)
    for (const key of authority.factByOwner.get(sectionIdentityKey(section)) ?? [])
      if (authority.factsByKey.has(key)) factKeys.add(key)

  const contractIds = new Set<string>()
  for (const declaration of authority.contracts)
    if (
      factKeys.has(declaration.sourceFactKey) ||
      factKeys.has(declaration.targetFactKey)
    )
      contractIds.add(declaration.id)

  const checkIds = new Set<string>()
  for (const key of factKeys)
    for (const consumer of authority.factsByKey.get(key)!.consumers)
      checkIds.add(consumer)

  return Object.freeze({
    changedSections: Object.freeze(changed),
    factKeys: Object.freeze([...factKeys].sort(compareStable)),
    contractIds: Object.freeze([...contractIds].sort(compareStable)),
    checkIds: Object.freeze([...checkIds].sort(compareStable)),
    issueIds: Object.freeze([...issueTargets.keys()].sort(compareStable)),
  })
}
