import { createHash } from 'node:crypto'
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
  runProductionDeterministicFoundationImpactAudit,
} from './foundation-audit-production-manifest'
import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationImpactAnalysis } from './foundation-impact-analysis'
import { analyzeFoundationImpact } from './foundation-impact-analysis'
import {
  foundationPatchOperationsDigest,
  type PatchOperation,
} from './foundation-revision-stage'
import type { SectionRef } from './foundation-section-index'
import type { FoundationDocumentPath, FoundationRevisionRound } from './types'

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
  round: FoundationRevisionRound
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
  round: FoundationRevisionRound
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

export type FoundationSemanticRecheckPacketSection = Readonly<{
  ref: Readonly<SectionRef>
  text: string
}>

export type FoundationSemanticRecheckPacket = Readonly<{
  issueId: string
  expected: string
  actual: string
  sections: readonly FoundationSemanticRecheckPacketSection[]
  patchOperation: Readonly<{
    kind: PatchOperation['kind']
    documentPath: FoundationDocumentPath
    sectionId: string
    beforeDigest?: string
    afterDigest?: string
  }>
  facts: readonly FoundationFact[]
  packetDigest: string
}>

/** The only failure reasons admitted for targeted semantic rechecks. */
export const FOUNDATION_SEMANTIC_FAILURE_REASON_CODES = Object.freeze([
  'expected_not_met',
  'actual_persists',
  'contradictory_evidence',
  'evidence_insufficient',
] as const)

export type FoundationSemanticFailureReasonCode = typeof FOUNDATION_SEMANTIC_FAILURE_REASON_CODES[number]
export type FoundationSemanticScopeAssessment =
  | 'repairable_in_scope'

/** Minimal evidence a worker may report. The service resolves it to an exact SectionRef. */
export type FoundationSemanticFailureEvidenceInput = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
  digest: string
}>

/** Durable, non-authoritative diagnostic admitted by the service after a FAIL. */
export type FoundationSemanticFailureDiagnostic = Readonly<{
  unmetExpected: string
  observedActual: string
  evidence: readonly SectionRef[]
  /** Service-pinned source/target dependencies used to invalidate stale PASS results. */
  dependencySections: readonly SectionRef[]
  failureReasonCode: FoundationSemanticFailureReasonCode
  scopeAssessment: FoundationSemanticScopeAssessment
}>

export type FoundationSemanticFailureDiagnosticInput = Readonly<{
  observedActual: string
  evidence: readonly FoundationSemanticFailureEvidenceInput[]
  failureReasonCode: FoundationSemanticFailureReasonCode
}>

export type FoundationSemanticRecheckServiceBinding = Readonly<{
  taskId: string
  issue: AuditIssue
}>

export type FoundationSemanticRecheckResult = Readonly<
  | {
      taskId: string
      issueId: string
      packetDigest: string
      status: 'PASS'
    }
  | {
      taskId: string
      issueId: string
      packetDigest: string
      status: 'FAIL'
      diagnostic: FoundationSemanticFailureDiagnostic
    }
>

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

function rebaseUntouchedFact(
  fact: FoundationFact,
  sectionIndex: readonly SectionRef[],
  documents: DocumentInput,
): FoundationFact {
  const document = documents instanceof Map
    ? documents.get(fact.source.documentPath)
    : (documents as Record<string, string>)[fact.source.documentPath]
  const next = sectionIndex.find(section =>
    section.documentPath === fact.source.documentPath && section.sectionId === fact.source.sectionId)
  if (!document || !next) throw new Error(`foundation fact source is not indexed: ${fact.key}`)
  const startDelta = next.startLine - fact.source.startLine
  const endDelta = next.endLine - fact.source.endLine
  if (fact.source.digest !== next.digest || fact.source.heading !== next.heading || startDelta !== endDelta)
    throw new Error(`foundation untouched fact section drift: ${fact.key}`)
  const evidence = {
    ...fact.evidence,
    startLine: fact.evidence.startLine + startDelta,
    endLine: fact.evidence.endLine + startDelta,
  }
  if (evidence.startLine < next.startLine || evidence.endLine > next.endLine || evidence.endLine < evidence.startLine)
    throw new Error(`foundation untouched fact evidence bounds drift: ${fact.key}`)
  const bytes = Buffer.from(document.split('\n').slice(evidence.startLine - 1, evidence.endLine).join('\n'), 'utf8')
  if (createHash('sha256').update(bytes).digest('hex') !== fact.evidence.digest)
    throw new Error(`foundation untouched fact evidence bytes drift: ${fact.key}`)
  return { ...fact, source: next, evidence }
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
  const impactedKeys = assertImpactKeys(input.impact.factKeys)
  const committed = createFoundationFactStore(input.committedFactStore)
  const impactedSet = new Set(impactedKeys)
  const rebasedCommitted = createFoundationFactStore(committed.map(fact =>
    impactedSet.has(fact.key as FoundationFactKey) ? fact : rebaseUntouchedFact(fact, input.sectionIndex, input.documents)))
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
      factStore: rebasedCommitted,
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
      factStore: rebasedCommitted,
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
  const untouched = rebasedCommitted.filter(fact => !rebuiltKeys.has(fact.key as FoundationFactKey))
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
  operations: readonly Extract<PatchOperation, { scope: 'section' }>[],
): void {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue))
    throw new Error('foundation admitted issue is invalid')
  const issueKeys = Object.keys(issue).sort(compareStable)
  const expectedKeys = [
    'actual',
    'expected',
    'remediation',
    'id',
    'reasonCode',
    'severity',
    'source',
    'target',
    'type',
  ].filter(key => key === 'target'
    ? issue.target !== undefined
    : key === 'reasonCode'
      ? issue.reasonCode !== undefined
      : true).sort(compareStable)
  if (issueKeys.length !== expectedKeys.length || issueKeys.some((key, index) => key !== expectedKeys[index]))
    throw new Error('foundation admitted issue shape is invalid')
  const indexed = new Map(sectionIndex.map(section => [sectionKey(section), section]))
  if (
    typeof issue.id !== 'string' || issue.id.trim().length === 0 ||
    !['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(issue.severity) ||
    !VALID_ISSUE_TYPES.has(issue.type) ||
    typeof issue.expected !== 'string' || issue.expected.trim().length === 0 ||
    typeof issue.actual !== 'string' || issue.actual.trim().length === 0 ||
    issue.remediation.kind !== 'patch' ||
    issue.remediation.documentPath !== documentPath ||
    issue.remediation.sectionIds.length === 0 ||
    issue.remediation.sectionIds.some(sectionId => !indexed.has(`${documentPath}\0${sectionId}`))
  )
    throw new Error('foundation admitted issue fix target is outside the rebuilt SectionIndex')
  const bound = operations.some(operation =>
    operation.issueIds.includes(issue.id) &&
    operation.documentPath === issue.remediation.documentPath &&
    issue.remediation.sectionIds.includes(operation.sectionId),
  )
  if (!bound)
    throw new Error('foundation admitted issue has no PatchOperation bound to its remediation')
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
  const remediation = issue.remediation
  if (
    changed.has(sectionKey(issue.source)) ||
    (issue.target !== undefined && changed.has(sectionKey(issue.target))) ||
    (remediation.kind === 'patch' && remediation.sectionIds.some(sectionId => changed.has(`${remediation.documentPath}\0${sectionId}`)))
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

function targetedCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(targetedCanonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStable(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${targetedCanonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function targetedDigest(value: unknown): string {
  return createHash('sha256').update(targetedCanonical(value)).digest('hex')
}

function rawTargetedDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function deepFreezeTargeted<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeTargeted(child)
  }
  return value
}

function documentValue(input: DocumentInput, path: string): string | undefined {
  return input instanceof Map ? input.get(path) : (input as Record<string, string>)[path]
}

function sectionText(input: DocumentInput, ref: SectionRef): string {
  const document = documentValue(input, ref.documentPath)
  if (typeof document !== 'string') throw new Error(`targeted semantic packet document is missing: ${ref.documentPath}`)
  if (!Number.isInteger(ref.startLine) || !Number.isInteger(ref.endLine) || ref.startLine < 1 || ref.endLine < ref.startLine)
    throw new Error(`targeted semantic packet section line bounds are invalid: ${sectionKey(ref)}`)
  const lines = document.split('\n')
  if (ref.endLine > lines.length + 1) throw new Error(`targeted semantic packet section line bounds are invalid: ${sectionKey(ref)}`)
  return lines.slice(ref.startLine - 1, ref.endLine).join('\n')
}

function validateTargetedIssue(issue: AuditIssue): void {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error('targeted semantic issue is invalid')
  const expected = ['actual', 'expected', 'id', 'reasonCode', 'remediation', 'severity', 'source', 'target', 'type']
    .filter(key => key === 'target'
      ? issue.target !== undefined
      : key === 'reasonCode'
        ? issue.reasonCode !== undefined
        : true)
    .sort(compareStable)
  assertExactKeys(issue as unknown as Record<string, unknown>, expected, 'targeted semantic issue')
  if (
    issue.type !== 'semantic' || typeof issue.id !== 'string' || !issue.id.trim() ||
    typeof issue.expected !== 'string' || !issue.expected.trim() ||
    typeof issue.actual !== 'string' || !issue.actual.trim() ||
    issue.remediation.kind !== 'patch' || issue.remediation.sectionIds.length === 0
  ) throw new Error('targeted semantic issue fields are invalid')
  if (issue.reasonCode !== undefined && (typeof issue.reasonCode !== 'string' || !issue.reasonCode.trim()))
    throw new Error('targeted semantic issue reasonCode is invalid')
}

function issueFixTargets(issue: AuditIssue): { documentPath: FoundationDocumentPath; sectionIds: readonly string[] } {
  if (!issue.remediation || issue.remediation.kind !== 'patch' || issue.remediation.sectionIds.length === 0)
    throw new Error('targeted semantic Issue remediation must name one or more patch sections')
  return { documentPath: issue.remediation.documentPath, sectionIds: issue.remediation.sectionIds }
}

function currentTargetedSection(
  sectionIndex: readonly SectionRef[],
  issueRef: SectionRef,
  changedKey: string,
  documents: DocumentInput,
): FoundationSemanticRecheckPacketSection {
  const current = sectionIndex.find(ref => sectionKey(ref) === sectionKey(issueRef))
  if (!current) throw new Error(`targeted semantic packet section is unknown: ${sectionKey(issueRef)}`)
  const text = sectionText(documents, current)
  assertDigest(current.digest, `targeted semantic packet section digest: ${sectionKey(current)}`)
  if (rawTargetedDigest(text) !== current.digest) throw new Error(`targeted semantic packet section bytes do not match digest: ${sectionKey(current)}`)
  if (sectionKey(current) !== changedKey && current.digest !== issueRef.digest)
    throw new Error(`targeted semantic packet unchanged section digest drift: ${sectionKey(current)}`)
  return Object.freeze({ ref: { ...current }, text })
}

/** Builds the sole packet authority for one admitted semantic issue and its bound operation. */
export function buildFoundationSemanticRecheckPacket(input: {
  issue: AuditIssue
  patchOperation: PatchOperation
  sectionIndex: readonly SectionRef[]
  documents: DocumentInput
  impact: FoundationImpactAnalysis
  factStore: readonly FoundationFact[]
}): FoundationSemanticRecheckPacket {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('targeted semantic packet input is invalid')
  assertExactKeys(input as unknown as Record<string, unknown>, ['documents', 'factStore', 'impact', 'issue', 'patchOperation', 'sectionIndex'], 'targeted semantic packet input')
  validateTargetedIssue(input.issue)
  if (input.patchOperation.scope !== 'section')
    throw new Error('targeted semantic packet requires a section PatchOperation')
  const operationImpact = validateImpact(input.impact, [input.patchOperation])
  if (!input.patchOperation.issueIds.includes(input.issue.id)) throw new Error('targeted semantic packet issue is not bound to PatchOperation')
  if (input.issue.remediation.kind !== 'patch' || input.patchOperation.documentPath !== input.issue.remediation.documentPath || !input.issue.remediation.sectionIds.includes(input.patchOperation.sectionId))
    throw new Error('targeted semantic packet PatchOperation does not bind the issue fix target')
  if (!Array.isArray(input.sectionIndex) || input.sectionIndex.length === 0) throw new Error('targeted semantic packet requires a full SectionIndex')
  const indexKeys = new Set<string>()
  for (const ref of input.sectionIndex) {
    if (!ref || typeof ref !== 'object' || typeof ref.documentPath !== 'string' || typeof ref.sectionId !== 'string' || typeof ref.heading !== 'string' || !Number.isInteger(ref.startLine) || !Number.isInteger(ref.endLine))
      throw new Error('targeted semantic packet SectionIndex contains an invalid section')
    const key = sectionKey(ref)
    if (indexKeys.has(key)) throw new Error(`targeted semantic packet SectionIndex contains duplicate section: ${key}`)
    indexKeys.add(key)
  }
  const changedKey = sectionKey(input.patchOperation)
  const changed = input.sectionIndex.find(ref => sectionKey(ref) === changedKey)
  if (!changed) throw new Error('targeted semantic packet changed section is not in the rebuilt SectionIndex')
  if (input.patchOperation.kind !== 'DELETE' && input.patchOperation.afterDigest !== changed.digest)
    throw new Error('targeted semantic packet PatchOperation afterDigest is stale')

  const sectionRefs: SectionRef[] = [
    input.issue.source,
    ...(input.issue.target ? [input.issue.target] : []),
  ]
  const fixTargets = issueFixTargets(input.issue)
  for (const sectionId of fixTargets.sectionIds) {
    const fixRef = input.sectionIndex.find(ref => ref.documentPath === fixTargets.documentPath && ref.sectionId === sectionId)
    if (!fixRef) throw new Error('targeted semantic packet patch section is not in the rebuilt SectionIndex')
    sectionRefs.push(fixRef)
  }
  const uniqueRefs = new Map<string, SectionRef>()
  for (const ref of sectionRefs) {
    const key = sectionKey(ref)
    if (!uniqueRefs.has(key)) uniqueRefs.set(key, ref)
  }
  const sections = [...uniqueRefs.values()]
    .map(ref => currentTargetedSection(input.sectionIndex, ref, changedKey, input.documents))
    .sort((left, right) => compareStable(sectionKey(left.ref), sectionKey(right.ref)))

  const normalizedFacts = createFoundationFactStore(input.factStore)
  const factKeys = new Set(operationImpact.factKeys)
  const facts = normalizedFacts
    .filter(fact => factKeys.has(fact.key as FoundationFactKey))
    .map(fact => ({ ...fact, source: { ...fact.source }, evidence: { ...fact.evidence } }))
    .sort((left, right) => compareStable(left.key, right.key))
  const patchOperation = {
    kind: input.patchOperation.kind,
    documentPath: input.patchOperation.documentPath,
    sectionId: input.patchOperation.sectionId,
    ...(input.patchOperation.beforeDigest ? { beforeDigest: input.patchOperation.beforeDigest } : {}),
    ...(input.patchOperation.afterDigest ? { afterDigest: input.patchOperation.afterDigest } : {}),
  }
  const body = {
    issueId: input.issue.id,
    expected: input.issue.expected,
    actual: input.issue.actual,
    sections,
    patchOperation,
    facts,
  }
  const packetDigest = targetedDigest(body)
  const packet = { ...body, packetDigest }
  return deepFreezeTargeted(packet)
}

/** Admits exactly one PASS/FAIL result for the packet; no issue compilation occurs here. */
export function admitFoundationSemanticRecheckResult(
  packet: FoundationSemanticRecheckPacket,
  input: unknown,
  serviceBinding: FoundationSemanticRecheckServiceBinding,
): FoundationSemanticRecheckResult {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('targeted semantic packet is invalid')
  const packetValue = packet as unknown as Record<string, unknown>
  assertExactKeys(packetValue, ['actual', 'expected', 'facts', 'issueId', 'packetDigest', 'patchOperation', 'sections'], 'targeted semantic packet')
  const { packetDigest: suppliedDigest, ...packetBody } = packetValue
  if (suppliedDigest !== targetedDigest(packetBody)) throw new Error('targeted semantic packet digest is invalid')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('targeted semantic result is invalid')
  const value = input as Record<string, unknown>
  if (typeof serviceBinding.taskId !== 'string' || !TASK_ID.test(serviceBinding.taskId))
    throw new Error('targeted semantic service task identity is invalid')
  validateTargetedIssue(serviceBinding.issue)
  if (serviceBinding.issue.id !== packet.issueId) throw new Error('targeted semantic service Issue identity does not match packet')
  if (serviceBinding.issue.expected !== packet.expected || serviceBinding.issue.actual !== packet.actual)
    throw new Error('targeted semantic service Issue authority does not match packet')
  const packetSource = packet.sections.find(item => item.ref.documentPath === serviceBinding.issue.source.documentPath && item.ref.sectionId === serviceBinding.issue.source.sectionId)
  if (!packetSource)
    throw new Error('targeted semantic service Issue source is outside packet authority')
  const fixTargets = issueFixTargets(serviceBinding.issue)
  if (fixTargets.documentPath !== packet.patchOperation.documentPath || !fixTargets.sectionIds.includes(packet.patchOperation.sectionId))
    throw new Error('targeted semantic service Issue fix target does not match packet authority')

  if (value.status === 'PASS') assertExactKeys(value, ['status'], 'targeted semantic worker PASS result')
  else assertExactKeys(value, ['diagnostic', 'status'], 'targeted semantic worker result (structured diagnostic required)')
  if (value.status === 'PASS') {
    if (value.diagnostic !== undefined) throw new Error('targeted semantic PASS cannot contain a diagnostic')
    return deepFreezeTargeted({ taskId: serviceBinding.taskId, issueId: packet.issueId, packetDigest: packet.packetDigest, status: 'PASS' })
  }
  if (value.status !== 'FAIL') throw new Error('targeted semantic result status must be PASS or FAIL')
  const diagnostic = value.diagnostic
  if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) throw new Error('targeted semantic FAIL requires a structured diagnostic')
  const diagnosticValue = diagnostic as Record<string, unknown>
  assertExactKeys(diagnosticValue, ['evidence', 'failureReasonCode', 'observedActual'], 'targeted semantic diagnostic (worker cannot submit expected or identity)')
  if (typeof diagnosticValue.observedActual !== 'string' || !diagnosticValue.observedActual.trim()) throw new Error('targeted semantic observedActual is required')
  if (!FOUNDATION_SEMANTIC_FAILURE_REASON_CODES.includes(diagnosticValue.failureReasonCode as FoundationSemanticFailureReasonCode)) throw new Error('targeted semantic failureReasonCode is not stable or supported')
  const rawEvidence = diagnosticValue.evidence
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) throw new Error('targeted semantic diagnostic evidence is required')
  const packetSections = new Map(packet.sections.map(item => [sectionKey(item.ref), item.ref]))
  const evidenceKeys = new Set<string>()
  const evidence: SectionRef[] = []
  for (const item of rawEvidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('targeted semantic diagnostic evidence is invalid')
    const candidate = item as Record<string, unknown>
    assertExactKeys(candidate, ['digest', 'documentPath', 'sectionId'], 'targeted semantic diagnostic evidence')
    if (typeof candidate.documentPath !== 'string' || typeof candidate.sectionId !== 'string' || typeof candidate.digest !== 'string' || !DIGEST.test(candidate.digest)) throw new Error('targeted semantic diagnostic evidence reference is invalid')
    const key = `${candidate.documentPath}\0${candidate.sectionId}`
    const ref = packetSections.get(key)
    if (!ref) throw new Error('targeted semantic diagnostic evidence references an unassigned Section')
    if (ref.digest !== candidate.digest) throw new Error('targeted semantic diagnostic evidence digest is stale')
    if (evidenceKeys.has(key)) throw new Error('targeted semantic diagnostic evidence contains duplicate Sections')
    evidenceKeys.add(key)
    evidence.push({ ...ref })
  }
  const dependencySections = packet.sections
    .filter(item => sectionKey(item.ref) === sectionKey(serviceBinding.issue.source) || (serviceBinding.issue.target !== undefined && sectionKey(item.ref) === sectionKey(serviceBinding.issue.target)))
    .map(item => ({ ...item.ref }))
  if (!dependencySections.length) throw new Error('targeted semantic diagnostic has no source/target dependency evidence')
  return deepFreezeTargeted({
    taskId: serviceBinding.taskId,
    issueId: packet.issueId,
    packetDigest: packet.packetDigest,
    status: 'FAIL',
    diagnostic: {
      unmetExpected: serviceBinding.issue.expected,
      observedActual: diagnosticValue.observedActual as string,
      evidence,
      dependencySections,
      failureReasonCode: diagnosticValue.failureReasonCode as FoundationSemanticFailureReasonCode,
      scopeAssessment: 'repairable_in_scope',
    },
  })
}

/** Explicit controller integration entry point. Worker payload contains no
 * task/packet/Issue identity; the service binding supplies all of them. */
export function admitFoundationSemanticRecheckWorkerResult(
  packet: FoundationSemanticRecheckPacket,
  workerResult: unknown,
  serviceBinding: FoundationSemanticRecheckServiceBinding,
): FoundationSemanticRecheckResult {
  return admitFoundationSemanticRecheckResult(packet, workerResult, serviceBinding)
}

export function digestFoundationSemanticRecheckResult(value: FoundationSemanticRecheckResult): string {
  return targetedDigest(value)
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
  if (!Number.isSafeInteger(input.round) || input.round < 1)
    throw new Error('foundation patch validation round is invalid')
  assertDigest(input.baseDocumentDigest, 'foundation patch baseDocumentDigest')
  assertDigest(input.postPatchDocumentDigest, 'foundation patch postPatchDocumentDigest')
  if (!Array.isArray(input.patchOperations) || input.patchOperations.length === 0)
    throw new Error('foundation patch validation requires PatchOperations')
  if (input.patchOperations.some(operation => operation.scope !== 'section'))
    throw new Error('foundation patch validation only accepts section PatchOperations')
  const patchOperations = input.patchOperations as readonly Extract<PatchOperation, { scope: 'section' }>[]
  if (!Array.isArray(input.admittedIssues) || input.admittedIssues.length === 0)
    throw new Error('foundation patch validation requires admitted issues')
  if (!Array.isArray(input.sectionIndex) || input.sectionIndex.length === 0)
    throw new Error('foundation patch validation requires a rebuilt SectionIndex')
  if (!Array.isArray(input.factStore))
    throw new Error('foundation patch validation requires a rebuilt FactStore')

  const operationDocuments = new Set(patchOperations.map(operation => operation.documentPath))
  if (operationDocuments.size !== 1 || !operationDocuments.has(input.documentPath))
    throw new Error('foundation patch operations must belong to one requested document')
  const validatedDocumentPath = [...operationDocuments][0]!
  const impact = validateImpact(input.impact, patchOperations)
  const issueIds = new Set<string>()
  for (const issue of input.admittedIssues) {
    if (issueIds.has(issue.id)) throw new Error(`duplicate admitted issue ID: ${issue.id}`)
    issueIds.add(issue.id)
    validateAdmittedIssue(issue, input.sectionIndex, input.documentPath, patchOperations)
  }
  if (
    issueIds.size !== impact.issueIds.length ||
    impact.issueIds.some(id => !issueIds.has(id))
  )
    throw new Error('foundation admitted issue coverage does not match impact.issueIds')
  const admittedById = new Map(input.admittedIssues.map(issue => [issue.id, issue]))
  for (const operation of patchOperations) {
    for (const issueId of operation.issueIds) {
      const admitted = admittedById.get(issueId)
      if (!admitted || admitted.remediation.documentPath !== operation.documentPath || !admitted.remediation.sectionIds.includes(operation.sectionId))
        throw new Error('foundation PatchOperation is outside admitted issue remediation')
    }
  }
  const operationIssueIds = new Set(patchOperations.flatMap(operation => operation.issueIds))
  if (
    operationIssueIds.size !== impact.issueIds.length ||
    impact.issueIds.some(id => !operationIssueIds.has(id))
  )
    throw new Error('foundation PatchOperation issue coverage is not exact')

  // This is deliberately the only targeted audit call in the validation
  // boundary. No caller rules, contracts, or post-issue collection are accepted.
  const postIssues = runProductionDeterministicFoundationImpactAudit({
    sectionIndex: input.sectionIndex,
    factStore: input.factStore,
    impact,
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
  const patchDigest = foundationPatchOperationsDigest(patchOperations)
  const changedSectionIds = [...new Set(patchOperations.map(operation => operation.sectionId))].sort(compareStable)
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
