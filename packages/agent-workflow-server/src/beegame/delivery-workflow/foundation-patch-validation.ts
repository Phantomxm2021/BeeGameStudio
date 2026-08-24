import {
  buildFoundationFactPackets,
  extractSelectedFoundationFacts,
  validateFoundationFactResults,
  type FoundationFactPacket,
  type FoundationFactReceipt,
  type NormalizedFoundationExtraction,
} from './foundation-fact-extraction'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
  type FoundationFactStore,
} from './foundation-fact-store'
import {
  FOUNDATION_FACT_CATALOG,
  isFoundationFactKey,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import { FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS } from './foundation-audit-authority'
import {
  runProductionDeterministicFoundationAudit,
} from './foundation-audit-production-manifest'
import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationImpactAnalysis } from './foundation-impact-analysis'
import { analyzeFoundationImpact } from './foundation-impact-analysis'
import {
  foundationPatchOperationsDigest,
  type PatchOperation,
} from './foundation-revision-stage'
import type { SectionRef } from './foundation-section-index'
import type { FoundationDocumentPath } from './types'

type DocumentInput = ReadonlyMap<string, string> | Record<string, string>

const DIGEST = /^[a-f0-9]{64}$/
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const VALID_ISSUE_TYPES = new Set<AuditIssue['type']>([
  'schema',
  'rule',
  'contract',
  'semantic',
])

/** One service-owned verdict for one original deterministic issue. */
export type PatchValidation = {
  validatorTaskId: string
  round: 1 | 2 | 3
  issueId: string
  documentPath: FoundationDocumentPath
  baseDocumentDigest: string
  postPatchDocumentDigest: string
  patchDigest: string
  changedSectionIds: string[]
  status: 'PASS' | 'FAIL'
  checkedFactKeys: string[]
  checkedContractIds: string[]
}

export type FoundationPatchValidationInput = {
  validatorTaskId: string
  round: 1 | 2 | 3
  documentPath: FoundationDocumentPath
  baseDocumentDigest: string
  postPatchDocumentDigest: string
  patchOperations: readonly PatchOperation[]
  impact: FoundationImpactAnalysis
  admittedIssues: readonly AuditIssue[]
  sectionIndex: readonly SectionRef[]
  factStore: readonly FoundationFact[]
}

type FoundationPatchValidationResult = {
  patchValidations: PatchValidation[]
  semanticRecheckIssueIds: string[]
  newImpactedIssues: AuditIssue[]
}

export type FoundationImpactedFactRebuild = {
  factStore: FoundationFactStore
  packets: FoundationFactPacket[]
  extraction: NormalizedFoundationExtraction
  receipts: FoundationFactReceipt[]
}

type RebuildInputBase = {
  committedFactStore: readonly FoundationFact[]
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
  impact: FoundationImpactAnalysis
  revision: string
}

type RebuildInput =
  | (RebuildInputBase & { phase: 'plan'; results?: never })
  | (RebuildInputBase & {
      phase: 'admit'
      results: readonly FoundationFactReceipt[]
    })

function assertImpactKeys(
  value: FoundationImpactAnalysis['factKeys'],
): FoundationFactKey[] {
  if (!Array.isArray(value))
    throw new Error('foundation impact fact keys must be an array')
  if (new Set(value).size !== value.length)
    throw new Error('foundation impact fact keys must be unique')
  return value.map(key => {
    if (!isFoundationFactKey(key))
      throw new Error(`foundation impact contains an unknown fact key: ${String(key)}`)
    return key
  })
}

function validateResultScope(
  results: readonly FoundationFactReceipt[],
  impactedKeys: readonly FoundationFactKey[],
  mechanicalKeys: ReadonlySet<FoundationFactKey>,
): void {
  const impacted = new Set(impactedKeys)
  const seen = new Set<string>()
  for (const result of results) {
    if (!result || typeof result !== 'object' || !isFoundationFactKey(result.key))
      throw new Error(`foundation impacted result is outside the requested impact: ${String(result?.key)}`)
    if (!impacted.has(result.key))
      throw new Error(`foundation impacted result is outside the requested impact: ${result.key}`)
    if (mechanicalKeys.has(result.key))
      throw new Error(`foundation impacted result is extra for mechanically resolved key: ${result.key}`)
    if (seen.has(result.key))
      throw new Error(`duplicate foundation impacted result: ${result.key}`)
    seen.add(result.key)
  }
}

/**
 * Rebuilds exactly the facts named by a validated impact. Mechanical facts are
 * extracted from staged owner sections first; unresolved keys are admitted
 * only through the existing packet/result validator. The returned store is a
 * canonical replacement of impacted keys plus untouched committed facts.
 */
export function rebuildFoundationImpactedFacts(
  input: RebuildInput,
): FoundationImpactedFactRebuild {
  const request = input
  if (request.phase !== 'plan' && request.phase !== 'admit')
    throw new Error('foundation impacted fact rebuild phase is invalid')
  if (request.phase === 'plan' && request.results !== undefined)
    throw new Error('foundation fact planning does not accept results')
  if (request.phase === 'admit' && request.results === undefined)
    throw new Error('foundation fact admission requires results')
  const committed = createFoundationFactStore(input.committedFactStore)
  const impactedKeys = assertImpactKeys(input.impact.factKeys)
  const results = request.phase === 'admit' ? request.results : []
  if (request.phase === 'admit')
    validateResultScope(results, impactedKeys, new Set())

  // An empty impact is a real no-op. Do not inspect staged documents or create
  // packets, but still reject an attempted result outside the empty scope.
  if (impactedKeys.length === 0) {
    const extraction: NormalizedFoundationExtraction = {
      facts: [],
      receipts: [],
      unresolvedKeys: [],
      normalizedFactDigest: digestFactStore([]),
    }
    return {
      factStore: committed,
      packets: [],
      extraction,
      receipts: [],
    }
  }

  const extraction = extractSelectedFoundationFacts({
    keys: impactedKeys,
    documents: input.documents,
    sectionIndex: input.sectionIndex,
  })
  const mechanicalKeys = new Set(
    extraction.facts.map(fact => fact.key as FoundationFactKey),
  )
  validateResultScope(results, impactedKeys, mechanicalKeys)

  const packets = buildFoundationFactPackets({
    revision: input.revision,
    documents: input.documents,
    sectionIndex: input.sectionIndex,
    unresolvedKeys: extraction.unresolvedKeys,
  })
  if (request.phase === 'plan')
    return {
      factStore: committed,
      packets,
      extraction,
      receipts: [...extraction.receipts],
    }
  const admitted: FoundationFact[] = []
  const receipts = [...extraction.receipts]
  for (const packet of packets) {
    const packetResults = results.filter(result => packet.keys.includes(result.key))
    const validated = validateFoundationFactResults({
      packet,
      expectedRevision: input.revision,
      documents: input.documents,
      sectionIndex: input.sectionIndex,
      results: packetResults,
    })
    admitted.push(...validated.facts)
    receipts.push(...validated.receipts)
  }

  const rebuiltKeys = new Set(impactedKeys)
  const untouched = committed.filter(fact => !rebuiltKeys.has(fact.key as FoundationFactKey))
  const factStore = createFoundationFactStore([
    ...untouched,
    ...extraction.facts,
    ...admitted,
  ])
  return { factStore, packets, extraction, receipts }
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareStable)
  const keys = [...expected].sort(compareStable)
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index]))
    throw new Error(`${label} shape contains extra or missing keys`)
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

function assertUniqueStrings(value: unknown, label: string, nonEmpty = true): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    (nonEmpty && value.length === 0) ||
    value.some(item => typeof item !== 'string' || item.trim().length === 0) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${label} must contain unique non-empty strings`)
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every(value => right.includes(value))
}

function sectionKey(section: Pick<SectionRef, 'documentPath' | 'sectionId'>): string {
  return `${section.documentPath}\0${section.sectionId}`
}

function validateImpact(
  impact: FoundationImpactAnalysis,
  operations: readonly PatchOperation[],
): FoundationImpactAnalysis {
  if (!impact || typeof impact !== 'object' || Array.isArray(impact))
    throw new Error('foundation patch impact is required')
  assertExactKeys(impact as unknown as Record<string, unknown>, [
    'changedSections',
    'factKeys',
    'contractIds',
    'checkIds',
    'issueIds',
  ], 'foundation patch impact')
  if (!Array.isArray(impact.changedSections))
    throw new Error('foundation patch impact changedSections must be an array')
  const changedKeys = impact.changedSections.map(section => {
    if (!section || typeof section !== 'object' || typeof section.documentPath !== 'string' || typeof section.sectionId !== 'string')
      throw new Error('foundation patch impact changed section is invalid')
    assertExactKeys(section as unknown as Record<string, unknown>, ['documentPath', 'sectionId'], 'foundation patch impact changed section')
    return sectionKey(section)
  })
  if (new Set(changedKeys).size !== changedKeys.length)
    throw new Error('foundation patch impact changedSections must be unique')
  assertUniqueStrings(impact.factKeys, 'foundation patch impact factKeys', false)
  assertUniqueStrings(impact.contractIds, 'foundation patch impact contractIds', false)
  assertUniqueStrings(impact.checkIds, 'foundation patch impact checkIds', false)
  assertUniqueStrings(impact.issueIds, 'foundation patch impact issueIds')
  const computed = analyzeFoundationImpact(operations)
  if (
    !sameStringSet(computed.issueIds, impact.issueIds) ||
    !sameStringSet(computed.factKeys, impact.factKeys) ||
    !sameStringSet(computed.contractIds, impact.contractIds) ||
    !sameStringSet(computed.checkIds, impact.checkIds) ||
    computed.changedSections.length !== impact.changedSections.length ||
    !sameStringSet(computed.changedSections.map(sectionKey), changedKeys)
  )
    throw new Error('foundation patch impact does not match validated PatchOperations')
  return computed
}

function validateAdmittedIssue(
  issue: AuditIssue,
  sectionIndex: readonly SectionRef[],
  documentPath: FoundationDocumentPath,
  allowedSections: ReadonlySet<string>,
): void {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue))
    throw new Error('foundation admitted issue is invalid')
  const issueKeys = Object.keys(issue).sort(compareStable)
  const expectedKeys = [
    'actual',
    'expected',
    'fixDocument',
    'fixSectionId',
    'id',
    'reasonCode',
    'severity',
    'source',
    'target',
    'type',
  ].filter(key => key === 'target' ? issue.target !== undefined : key === 'reasonCode' ? issue.reasonCode !== undefined : true).sort(compareStable)
  if (issueKeys.length !== expectedKeys.length || issueKeys.some((key, index) => key !== expectedKeys[index]))
    throw new Error('foundation admitted issue shape is invalid')
  if (
    typeof issue.id !== 'string' || issue.id.trim().length === 0 ||
    !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(issue.severity) ||
    !VALID_ISSUE_TYPES.has(issue.type) ||
    typeof issue.expected !== 'string' || issue.expected.trim().length === 0 ||
    typeof issue.actual !== 'string' || issue.actual.trim().length === 0 ||
    typeof issue.fixDocument !== 'string' || typeof issue.fixSectionId !== 'string' ||
    issue.fixDocument !== documentPath ||
    !allowedSections.has(`${documentPath}\0${issue.fixSectionId}`)
  )
    throw new Error('foundation admitted issue fix target is outside the patch')
  const indexed = new Map(sectionIndex.map(section => [sectionKey(section), section]))
  for (const candidate of [issue.source, issue.target].filter(Boolean)) {
    const exact = candidate && indexed.get(sectionKey(candidate))
    if (!candidate || !exact || exact.heading !== candidate.heading || exact.startLine !== candidate.startLine || exact.endLine !== candidate.endLine || exact.digest !== candidate.digest)
      throw new Error('foundation admitted issue section is not in the rebuilt SectionIndex')
  }
}

function issueTouchesImpact(
  issue: AuditIssue,
  impact: FoundationImpactAnalysis,
): boolean {
  const changed = new Set(impact.changedSections.map(sectionKey))
  if (
    changed.has(sectionKey(issue.source)) ||
    (issue.target !== undefined && changed.has(sectionKey(issue.target))) ||
    changed.has(`${issue.fixDocument}\0${issue.fixSectionId}`)
  )
    return true

  if (issue.type === 'schema' || issue.type === 'rule') {
    const owners = new Set(
      FOUNDATION_FACT_CATALOG
        .filter(definition => impact.factKeys.includes(definition.key))
        .map(definition => sectionKey(definition.owner)),
    )
    return [issue.source, issue.target]
      .filter((section): section is NonNullable<typeof section> => section !== undefined)
      .some(section => owners.has(sectionKey(section)))
  }

  if (issue.type === 'contract' && issue.target !== undefined) {
    const sourceKey = sectionKey(issue.source)
    const targetKey = sectionKey(issue.target)
    return FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS.some(declaration =>
      impact.contractIds.includes(declaration.id) &&
      sectionKey(declaration.source) === sourceKey &&
      sectionKey(declaration.target) === targetKey,
    )
  }
  return false
}

/**
 * Validates one bounded document patch against the service's production
 * deterministic audit. Semantic findings are deliberately returned only as
 * recheck IDs; this function never invents a semantic PASS or FAIL.
 */
export function validateFoundationPatch(
  input: FoundationPatchValidationInput,
): FoundationPatchValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('foundation patch validation input is invalid')
  assertExactKeys(input as unknown as Record<string, unknown>, [
    'validatorTaskId',
    'round',
    'documentPath',
    'baseDocumentDigest',
    'postPatchDocumentDigest',
    'patchOperations',
    'impact',
    'admittedIssues',
    'sectionIndex',
    'factStore',
  ], 'foundation patch validation input')
  if (typeof input.validatorTaskId !== 'string' || !TASK_ID.test(input.validatorTaskId))
    throw new Error('foundation patch validatorTaskId is invalid')
  if (input.round !== 1 && input.round !== 2 && input.round !== 3)
    throw new Error('foundation patch validation round is invalid')
  assertDigest(input.baseDocumentDigest, 'foundation patch baseDocumentDigest')
  assertDigest(input.postPatchDocumentDigest, 'foundation patch postPatchDocumentDigest')
  if (!Array.isArray(input.patchOperations) || input.patchOperations.length === 0)
    throw new Error('foundation patch validation requires PatchOperations')
  if (!Array.isArray(input.admittedIssues) || input.admittedIssues.length === 0)
    throw new Error('foundation patch validation requires admitted issues')
  if (!Array.isArray(input.sectionIndex) || input.sectionIndex.length === 0)
    throw new Error('foundation patch validation requires a rebuilt SectionIndex')
  if (!Array.isArray(input.factStore))
    throw new Error('foundation patch validation requires a rebuilt FactStore')

  const operationDocuments = new Set(input.patchOperations.map(operation => operation.documentPath))
  if (operationDocuments.size !== 1 || !operationDocuments.has(input.documentPath))
    throw new Error('foundation patch operations must belong to one requested document')
  const validatedDocumentPath = [...operationDocuments][0]!
  const operationSections = new Set(input.patchOperations.map(operation => `${operation.documentPath}\0${operation.sectionId}`))
  const impact = validateImpact(input.impact, input.patchOperations)
  const issueIds = new Set<string>()
  for (const issue of input.admittedIssues) {
    if (issueIds.has(issue.id)) throw new Error(`duplicate admitted issue ID: ${issue.id}`)
    issueIds.add(issue.id)
    validateAdmittedIssue(issue, input.sectionIndex, input.documentPath, operationSections)
  }
  if (
    issueIds.size !== impact.issueIds.length ||
    impact.issueIds.some(id => !issueIds.has(id))
  )
    throw new Error('foundation admitted issue coverage does not match impact.issueIds')
  const operationIssueIds = input.patchOperations.flatMap(operation => operation.issueIds)
  if (
    operationIssueIds.length !== impact.issueIds.length ||
    new Set(operationIssueIds).size !== operationIssueIds.length ||
    impact.issueIds.some(id => !operationIssueIds.includes(id))
  )
    throw new Error('foundation PatchOperation issue coverage is not exact')

  // This is deliberately the only audit call in the validation boundary. No
  // caller rules, contracts, or post-issue collection are accepted.
  const postIssues = runProductionDeterministicFoundationAudit({
    sectionIndex: input.sectionIndex,
    factStore: input.factStore,
  })
  const postById = new Map<string, AuditIssue>()
  for (const postIssue of postIssues) {
    if (postById.has(postIssue.id)) throw new Error(`production audit returned duplicate issue ID: ${postIssue.id}`)
    postById.set(postIssue.id, postIssue)
  }
  const deterministic = input.admittedIssues.filter(issue => issue.type !== 'semantic')
  const semanticRecheckIssueIds = input.admittedIssues
    .filter(issue => issue.type === 'semantic')
    .map(issue => issue.id)
    .sort(compareStable)
  const patchDigest = foundationPatchOperationsDigest(input.patchOperations)
  const changedSectionIds = [...new Set(input.patchOperations.map(operation => operation.sectionId))].sort(compareStable)
  const patchValidations = deterministic
    .map(issue => ({
      validatorTaskId: input.validatorTaskId,
      round: input.round,
      issueId: issue.id,
      documentPath: validatedDocumentPath,
      baseDocumentDigest: input.baseDocumentDigest,
      postPatchDocumentDigest: input.postPatchDocumentDigest,
      patchDigest,
      changedSectionIds: [...changedSectionIds],
      status: postById.has(issue.id) ? 'FAIL' as const : 'PASS' as const,
      checkedFactKeys: [...impact.factKeys],
      checkedContractIds: [...impact.contractIds],
    }))
    .sort((left, right) => compareStable(left.issueId, right.issueId))
  const originalIds = new Set(input.admittedIssues.map(issue => issue.id))
  const newImpactedIssues = postIssues
    .filter(issue => !originalIds.has(issue.id))
    .filter(issue => issue.type !== 'semantic')
    .filter(issue => issueTouchesImpact(issue, impact))
    .sort((left, right) => compareStable(left.id, right.id))
  return {
    patchValidations,
    semanticRecheckIssueIds,
    newImpactedIssues,
  }
}
