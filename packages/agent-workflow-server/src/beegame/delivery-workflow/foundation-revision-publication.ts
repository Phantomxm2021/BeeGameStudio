import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { getGameDocumentContract } from './game-document-contracts'
import { buildFoundationSectionIndex, type SectionRef } from './foundation-section-index'
import {
  foundationPatchOperationsDigest,
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  type PatchOperation,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'
import type { RevisionBatch } from './foundation-revision-batches'
import type { FoundationSemanticRecheckResult, PatchValidation } from './foundation-patch-validation'
import type { AuditIssue, AuditSeverity } from './foundation-issue-registry'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './types'
import { computeDocumentRevision } from './revision'

const DIGEST = /^[a-f0-9]{64}$/
const REVISION = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
const TASK = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const DOCS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const SEVERITIES = new Set<AuditSeverity>(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'])

export type FoundationRevisionPreparedDocument = {
  documentPath: FoundationDocumentPath
  round: 1 | 2 | 3
  taskId: string
  issueIds: string[]
  changedSectionIds: string[]
  baseDocumentDigest: string
  stagedDocumentDigest: string
  stagedPath: string
  terminalDigest: string
  receiptDigest: string
  operationDigest: string
  validationDigest: string
  semanticResultDigest: string
  resultDigest: string
  patchOperations: PatchOperation[]
}

export type FoundationRevisionPrepared = {
  schema: 'beegame-foundation-revision-publish-v2'
  status: 'prepared'
  revision: string
  confirmedBriefDigest: string
  round: 1 | 2 | 3
  documents: FoundationRevisionPreparedDocument[]
  resultingIssues: readonly AuditIssue[]
  resultingIssueRegistryDigest: string
  authorityDigest: string
}

export type FoundationRevisionPublicationResult = {
  status: 'committed'
  baseRevision: string
  resultingRevision: string
  confirmedBriefDigest: string
  authorityDigest: string
  resultingIssues: readonly AuditIssue[]
  resultingIssueRegistryDigest: string
  documentDigests: Record<string, string>
  preparedPath: string
  journalPath: string
  committedPath: string
}

type JournalEntry = {
  documentPath: FoundationDocumentPath
  status: 'pending' | 'published'
  stagedDocumentDigest: string
  operationDigest: string
  canonicalDocumentDigest?: string
}

type Journal = {
  schema: 'beegame-foundation-revision-publish-journal-v2'
  revision: string
  authorityDigest: string
  entries: JournalEntry[]
}

type Committed = {
  schema: 'beegame-foundation-revision-commit-v2'
  status: 'committed'
  baseRevision: string
  confirmedBriefDigest: string
  round: 1 | 2 | 3
  authorityDigest: string
  resultingRevision: string
  resultingIssueRegistryDigest: string
  documentDigests: Record<string, string>
}

export type FoundationRevisionPublicationInput = {
  workspacePath: string
  revision: string
  confirmedBriefDigest: string
  round: 1 | 2 | 3
  batches: readonly RevisionBatch[]
  receipts: readonly RevisionTaskReceipt[]
  patchOperations: readonly PatchOperation[]
  patchValidations: readonly PatchValidation[]
  semanticRecheckResults: readonly FoundationSemanticRecheckResult[]
  resultingIssues: readonly AuditIssue[]
  onPathPublished?: (documentPath: FoundationDocumentPath) => Promise<void> | void
}

export type FoundationRevisionRecoveryInput = {
  workspacePath: string
  revision: string
  onPathPublished?: (documentPath: FoundationDocumentPath) => Promise<void> | void
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

function assertRevision(revision: string): void {
  if (typeof revision !== 'string' || !REVISION.test(revision)) throw new Error('foundation revision is not a safe project-local identifier')
}

function assertCanonical(value: unknown, label = 'document path'): asserts value is FoundationDocumentPath {
  if (typeof value !== 'string' || !DOCS.has(value)) throw new Error(`${label} is outside canonical authority`)
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error(`${label} shape contains extra or missing keys`)
}

function strings(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some(item => typeof item !== 'string' || item.length === 0) || new Set(value).size !== value.length) throw new Error(`${label} must contain unique non-empty strings`)
  return [...value]
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneJsonValue(item)]))
  return value
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateResultingIssues(value: unknown): AuditIssue[] {
  if (!Array.isArray(value)) throw new Error('resultingIssues must be an array')
  const ids = new Set<string>()
  const issues = value.map(raw => {
    assertObject(raw, 'resulting AuditIssue')
    if (typeof raw.id !== 'string' || raw.id.length === 0) throw new Error('resulting AuditIssue ID must be non-empty')
    if (ids.has(raw.id)) throw new Error(`duplicate resulting AuditIssue ID: ${raw.id}`)
    ids.add(raw.id)
    if (typeof raw.severity !== 'string' || !SEVERITIES.has(raw.severity as AuditSeverity)) throw new Error(`resulting AuditIssue severity is unsupported: ${String(raw.severity)}`)
    return cloneJsonValue(raw) as AuditIssue
  })
  return issues.sort((left, right) => compareStableStrings(left.id, right.id))
}

function frozenResultingIssues(value: readonly AuditIssue[]): readonly AuditIssue[] {
  return Object.freeze(value.map(issue => freezeDeep(cloneJsonValue(issue) as AuditIssue)))
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every(item => right.includes(item))
}

function resolveProjectPath(workspacePath: string, projectPath: string): string {
  const root = resolve(workspacePath)
  const candidate = resolve(root, projectPath)
  const escaped = relative(root, candidate)
  if (!escaped || escaped === '..' || escaped.startsWith(`..${sep}`) || escaped.startsWith('/') || escaped.startsWith('\\')) throw new Error('foundation revision path escaped the project workspace')
  return candidate
}

function rootPath(revision: string): string {
  assertRevision(revision)
  return `.beegame/audit/foundation/${revision}/revision`
}

export function foundationRevisionPreparedPath(revision: string): string { return `${rootPath(revision)}/PREPARED.json` }
export function foundationRevisionJournalPath(revision: string): string { return `${rootPath(revision)}/JOURNAL.json` }
export function foundationRevisionCommittedPath(revision: string): string { return `${rootPath(revision)}/COMMITTED.json` }

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function compareOperations(left: PatchOperation, right: PatchOperation): number {
  return `${left.documentPath}\0${left.sectionId}\0${stable(left)}`.localeCompare(`${right.documentPath}\0${right.sectionId}\0${stable(right)}`)
}

function validateOperation(value: unknown): PatchOperation {
  assertObject(value, 'PatchOperation')
  if (value.kind !== 'INSERT' && value.kind !== 'REPLACE' && value.kind !== 'DELETE') throw new Error('PatchOperation kind is invalid')
  const expected = value.kind === 'INSERT' ? ['afterDigest', 'documentPath', 'issueIds', 'kind', 'sectionId'] : value.kind === 'DELETE' ? ['beforeDigest', 'documentPath', 'issueIds', 'kind', 'sectionId'] : ['afterDigest', 'beforeDigest', 'documentPath', 'issueIds', 'kind', 'sectionId']
  assertExactKeys(value, expected, 'PatchOperation')
  assertCanonical(value.documentPath, 'PatchOperation document path')
  if (typeof value.sectionId !== 'string' || !getGameDocumentContract(value.documentPath).sections.some(section => section.sectionId === value.sectionId)) throw new Error('PatchOperation section is not canonical')
  const issueIds = strings(value.issueIds, 'PatchOperation issueIds')
  if (value.kind !== 'INSERT') assertDigest(value.beforeDigest, 'PatchOperation beforeDigest')
  if (value.kind !== 'DELETE') assertDigest(value.afterDigest, 'PatchOperation afterDigest')
  return { kind: value.kind, documentPath: value.documentPath, sectionId: value.sectionId, issueIds, ...(value.beforeDigest ? { beforeDigest: value.beforeDigest } : {}), ...(value.afterDigest ? { afterDigest: value.afterDigest } : {}) } as PatchOperation
}

function receiptDigest(receipt: RevisionTaskReceipt): string {
  const { terminalDigest: _terminal, ...core } = receipt
  return sha256(stable(receipt))
}

function validateReceipt(value: unknown, revision: string): RevisionTaskReceipt {
  assertObject(value, 'revision receipt')
  assertExactKeys(value, ['baseDocumentDigest', 'changedSectionIds', 'documentPath', 'issueIds', 'round', 'stagedDocumentDigest', 'stagedPath', 'taskId', 'terminalDigest'], 'revision receipt')
  assertCanonical(value.documentPath, 'revision receipt document path')
  if (typeof value.taskId !== 'string' || !TASK.test(value.taskId)) throw new Error('revision receipt taskId is invalid')
  if (value.round !== 1 && value.round !== 2 && value.round !== 3) throw new Error('revision receipt round is invalid')
  const issueIds = strings(value.issueIds, 'revision receipt issueIds')
  const changedSectionIds = strings(value.changedSectionIds, 'revision receipt changedSectionIds')
  assertDigest(value.baseDocumentDigest, 'revision receipt baseDocumentDigest')
  assertDigest(value.stagedDocumentDigest, 'revision receipt stagedDocumentDigest')
  assertDigest(value.terminalDigest, 'revision receipt terminalDigest')
  if (value.stagedPath !== foundationRevisionStagePath(revision, value.documentPath)) throw new Error('revision receipt staged path is not authority-bound')
  const receipt = { taskId: value.taskId, round: value.round, documentPath: value.documentPath, issueIds, baseDocumentDigest: value.baseDocumentDigest, stagedDocumentDigest: value.stagedDocumentDigest, changedSectionIds, stagedPath: value.stagedPath, terminalDigest: value.terminalDigest } as RevisionTaskReceipt
  const { terminalDigest: _terminal, ...core } = receipt
  if (revisionTaskReceiptTerminalDigest(core) !== receipt.terminalDigest) throw new Error('revision receipt terminal digest mismatch')
  return receipt
}

function validateBatch(value: unknown): RevisionBatch {
  assertObject(value, 'revision batch')
  assertExactKeys(value, ['documentPath', 'issueIds', 'sectionIds'], 'revision batch')
  assertCanonical(value.documentPath, 'revision batch document path')
  const sectionIds = strings(value.sectionIds, 'revision batch sectionIds')
  const issueIds = strings(value.issueIds, 'revision batch issueIds')
  const known = new Set(getGameDocumentContract(value.documentPath).sections.map(section => section.sectionId))
  if (sectionIds.some(sectionId => !known.has(sectionId))) throw new Error('revision batch section is not canonical')
  return { documentPath: value.documentPath, sectionIds, issueIds }
}

function sectionMap(documentPath: FoundationDocumentPath, bytes: Buffer): Map<string, SectionRef> {
  const index = buildFoundationSectionIndex({ documents: { [documentPath]: bytes.toString('utf8') } })
  return new Map(index.map(section => [section.sectionId, section]))
}

function sectionBody(bytes: Buffer, section: SectionRef): string {
  return bytes.toString('utf8').split('\n').slice(section.startLine, section.endLine).join('\n').trim()
}

function outsideSections(bytes: Buffer, index: readonly SectionRef[], allowed: ReadonlySet<string>): string {
  const lines = bytes.toString('utf8').split('\n')
  const chunks: string[] = []
  let cursor = 0
  for (const section of index) {
    const start = section.startLine - 1
    const end = section.endLine
    chunks.push(lines.slice(cursor, start).join('\n'))
    chunks.push(allowed.has(section.sectionId) ? `\0${section.sectionId}\0` : lines.slice(start, end).join('\n'))
    cursor = end
  }
  chunks.push(lines.slice(cursor).join('\n'))
  return chunks.join('\n')
}

async function validateDocumentBytes(input: { workspacePath: string; revision: string; receipt: RevisionTaskReceipt; operations: readonly PatchOperation[]; initial: boolean }): Promise<void> {
  const canonicalPath = resolveProjectPath(input.workspacePath, input.receipt.documentPath)
  const stagedPath = resolveProjectPath(input.workspacePath, input.receipt.stagedPath)
  const [canonicalBytes, stagedBytes] = await Promise.all([readFile(canonicalPath), readFile(stagedPath)])
  const canonicalDigest = sha256(canonicalBytes)
  if (input.initial && canonicalDigest !== input.receipt.baseDocumentDigest) throw new Error(`canonical bytes are stale for ${input.receipt.documentPath}`)
  if (!input.initial && canonicalDigest !== input.receipt.baseDocumentDigest && canonicalDigest !== input.receipt.stagedDocumentDigest) throw new Error(`canonical bytes are neither base nor staged for ${input.receipt.documentPath}`)
  if (sha256(stagedBytes) !== input.receipt.stagedDocumentDigest) throw new Error(`staged bytes are stale for ${input.receipt.documentPath}`)
  const baseSections = sectionMap(input.receipt.documentPath, input.initial ? canonicalBytes : (canonicalDigest === input.receipt.baseDocumentDigest ? canonicalBytes : stagedBytes))
  const stagedSections = sectionMap(input.receipt.documentPath, stagedBytes)
  if (baseSections.size !== stagedSections.size || [...baseSections.keys()].some((sectionId, index) => sectionId !== [...stagedSections.keys()][index])) throw new Error(`section structure changed for ${input.receipt.documentPath}`)
  const changed = new Set<string>()
  for (const [sectionId, before] of baseSections) if (before.digest !== stagedSections.get(sectionId)?.digest) changed.add(sectionId)
  if (!sameSet([...changed], input.receipt.changedSectionIds)) throw new Error(`changed section authority does not match staged bytes for ${input.receipt.documentPath}`)
  if (outsideSections(input.initial ? canonicalBytes : (canonicalDigest === input.receipt.baseDocumentDigest ? canonicalBytes : stagedBytes), [...baseSections.values()], new Set(input.receipt.changedSectionIds)) !== outsideSections(stagedBytes, [...stagedSections.values()], new Set(input.receipt.changedSectionIds))) throw new Error(`bytes outside revision sections changed for ${input.receipt.documentPath}`)
  const seenSections = new Set<string>()
  const operationIssueIds: string[] = []
  for (const raw of input.operations) {
    const operation = validateOperation(raw)
    if (operation.documentPath !== input.receipt.documentPath || !input.receipt.changedSectionIds.includes(operation.sectionId)) throw new Error('PatchOperation is outside its receipt authority')
    if (seenSections.has(operation.sectionId)) throw new Error('PatchOperation contains duplicate section authority')
    seenSections.add(operation.sectionId)
    operationIssueIds.push(...operation.issueIds)
    const before = baseSections.get(operation.sectionId)
    const after = stagedSections.get(operation.sectionId)
    if (!before || !after) throw new Error('PatchOperation section is missing from canonical Markdown')
    if (operation.kind !== 'INSERT' && operation.beforeDigest !== before.digest) throw new Error('PatchOperation beforeDigest does not match canonical bytes')
    if (operation.kind !== 'DELETE' && operation.afterDigest !== after.digest) throw new Error('PatchOperation afterDigest does not match staged bytes')
    const expectedKind: PatchOperation['kind'] = !sectionBody(canonicalBytes, before) && sectionBody(stagedBytes, after) ? 'INSERT' : sectionBody(canonicalBytes, before) && !sectionBody(stagedBytes, after) ? 'DELETE' : 'REPLACE'
    if (operation.kind !== expectedKind) throw new Error('PatchOperation kind does not match canonical Markdown')
  }
  if (seenSections.size !== changed.size || [...changed].some(sectionId => !seenSections.has(sectionId))) throw new Error('PatchOperation coverage does not match changed sections')
  if (!sameSet(operationIssueIds, input.receipt.issueIds)) throw new Error('PatchOperation issue coverage does not match receipt authority')
}

function validateValidation(value: unknown): PatchValidation {
  assertObject(value, 'PatchValidation')
  assertExactKeys(value, ['baseDocumentDigest', 'changedSectionIds', 'checkedContractIds', 'checkedFactKeys', 'documentPath', 'issueId', 'patchDigest', 'postPatchDocumentDigest', 'round', 'status', 'validatorTaskId'], 'PatchValidation')
  assertCanonical(value.documentPath, 'PatchValidation document path')
  if (typeof value.validatorTaskId !== 'string' || !TASK.test(value.validatorTaskId) || typeof value.issueId !== 'string' || !value.issueId) throw new Error('PatchValidation identity is invalid')
  if (value.round !== 1 && value.round !== 2 && value.round !== 3) throw new Error('PatchValidation round is invalid')
  if (value.status !== 'PASS' && value.status !== 'FAIL') throw new Error('PatchValidation status is invalid')
  assertDigest(value.baseDocumentDigest, 'PatchValidation baseDocumentDigest')
  assertDigest(value.postPatchDocumentDigest, 'PatchValidation postPatchDocumentDigest')
  assertDigest(value.patchDigest, 'PatchValidation patchDigest')
  strings(value.changedSectionIds, 'PatchValidation changedSectionIds')
  strings(value.checkedFactKeys, 'PatchValidation checkedFactKeys', true)
  strings(value.checkedContractIds, 'PatchValidation checkedContractIds', true)
  return value as unknown as PatchValidation
}

function validateSemanticResult(value: unknown): FoundationSemanticRecheckResult {
  assertObject(value, 'semantic recheck result')
  const expected = ['issueId', 'packetDigest', 'reasonCode', 'status'].filter(key => key === 'reasonCode' ? value.reasonCode !== undefined : true)
  assertExactKeys(value, expected, 'semantic recheck result')
  if (typeof value.issueId !== 'string' || !value.issueId) throw new Error('semantic recheck issueId is invalid')
  assertDigest(value.packetDigest, 'semantic recheck packetDigest')
  if (value.status !== 'PASS' && value.status !== 'FAIL') throw new Error('semantic recheck status is invalid')
  return value as unknown as FoundationSemanticRecheckResult
}

function digestList(value: readonly unknown[]): string { return sha256(stable(value)) }

async function buildPrepared(input: FoundationRevisionPublicationInput): Promise<FoundationRevisionPrepared> {
  assertRevision(input.revision)
  if (!Array.isArray(input.batches) || input.batches.length === 0 || !Array.isArray(input.receipts) || input.receipts.length === 0) throw new Error('foundation revision publication requires revision batches and receipts')
  const batches = input.batches.map(validateBatch)
  const receipts = input.receipts.map(value => validateReceipt(value, input.revision))
  const operations = input.patchOperations.map(validateOperation)
  const validations = input.patchValidations.map(validateValidation)
  const semanticResults = input.semanticRecheckResults.map(validateSemanticResult)
  const resultingIssues = validateResultingIssues(input.resultingIssues)
  const batchByPath = new Map<FoundationDocumentPath, RevisionBatch>()
  for (const batch of batches) {
    if (batchByPath.has(batch.documentPath)) throw new Error('revision batches contain duplicate document paths')
    batchByPath.set(batch.documentPath, batch)
  }
  const receiptByPath = new Map<FoundationDocumentPath, RevisionTaskReceipt>()
  for (const receipt of receipts) {
    if (receipt.round !== input.round || receiptByPath.has(receipt.documentPath)) throw new Error('revision receipts contain duplicate or mismatched document paths')
    if (!batchByPath.has(receipt.documentPath)) throw new Error('revision receipt has no assigned revision batch')
    const batch = batchByPath.get(receipt.documentPath)!
    if (!sameSet(receipt.issueIds, batch.issueIds) || !receipt.changedSectionIds.every(sectionId => batch.sectionIds.includes(sectionId))) throw new Error('revision receipt disagrees with its revision batch')
    receiptByPath.set(receipt.documentPath, receipt)
  }
  if (receiptByPath.size !== batchByPath.size) throw new Error('revision batch coverage is incomplete')
  const allIssueIds = batches.flatMap(batch => batch.issueIds)
  if (new Set(allIssueIds).size !== allIssueIds.length) throw new Error('revision issue coverage contains duplicate IDs')
  const resolvedIssueIds = new Set(allIssueIds)
  if (resultingIssues.some(issue => resolvedIssueIds.has(issue.id))) throw new Error('resulting AuditIssue overlaps a resolved revision issue')
  const groupedOperations = new Map<FoundationDocumentPath, PatchOperation[]>()
  for (const operation of operations) groupedOperations.set(operation.documentPath, [...(groupedOperations.get(operation.documentPath) ?? []), operation])
  const groupedValidations = new Map<FoundationDocumentPath, PatchValidation[]>()
  for (const validation of validations) groupedValidations.set(validation.documentPath, [...(groupedValidations.get(validation.documentPath) ?? []), validation])
  const issueAuthority = new Map<string, FoundationDocumentPath>()
  for (const batch of batches) for (const issueId of batch.issueIds) issueAuthority.set(issueId, batch.documentPath)
  for (const validation of validations) if (!issueAuthority.has(validation.issueId)) throw new Error('validation is outside revision issue authority')
  for (const result of semanticResults) if (!issueAuthority.has(result.issueId)) throw new Error('semantic result is outside revision issue authority')
  const accounted = new Set<string>()
  const documents: FoundationRevisionPreparedDocument[] = []
  for (const batch of batches) {
    const receipt = receiptByPath.get(batch.documentPath)!
    const documentOperations = groupedOperations.get(batch.documentPath) ?? []
    if (documentOperations.length === 0 || documentOperations.some(operation => !batch.sectionIds.includes(operation.sectionId))) throw new Error('revision has extra or unassigned PatchOperations')
    const operationIssueIds = documentOperations.flatMap(operation => operation.issueIds)
    if (!sameSet(operationIssueIds, receipt.issueIds)) throw new Error('revision PatchOperation issue coverage is incomplete')
    await validateDocumentBytes({ workspacePath: input.workspacePath, revision: input.revision, receipt, operations: documentOperations, initial: true })
    const operationDigest = foundationPatchOperationsDigest(documentOperations)
    const documentValidations = groupedValidations.get(batch.documentPath) ?? []
    const documentSemantic = semanticResults.filter(result => issueAuthority.get(result.issueId) === batch.documentPath)
    for (const validation of documentValidations) {
      if (validation.round !== input.round || validation.baseDocumentDigest !== receipt.baseDocumentDigest || validation.postPatchDocumentDigest !== receipt.stagedDocumentDigest || validation.patchDigest !== operationDigest || !sameSet(validation.changedSectionIds, receipt.changedSectionIds) || issueAuthority.get(validation.issueId) !== batch.documentPath || accounted.has(validation.issueId)) throw new Error('PatchValidation is stale, unassigned, or duplicated')
      if (validation.status !== 'PASS') throw new Error('foundation revision publication rejects FAIL PatchValidation')
      accounted.add(validation.issueId)
    }
    for (const result of documentSemantic) {
      if (accounted.has(result.issueId)) throw new Error('issue has both PatchValidation and semantic recheck authority')
      if (result.status !== 'PASS') throw new Error('foundation revision publication rejects FAIL semantic recheck')
      accounted.add(result.issueId)
    }
    const validationDigest = digestList([...documentValidations].sort((a, b) => a.issueId.localeCompare(b.issueId)))
    const semanticResultDigest = digestList([...documentSemantic].sort((a, b) => a.issueId.localeCompare(b.issueId)))
    const resultDigest = sha256(stable({ validationDigest, semanticResultDigest }))
    documents.push({ documentPath: batch.documentPath, round: receipt.round, taskId: receipt.taskId, issueIds: [...receipt.issueIds], changedSectionIds: [...receipt.changedSectionIds], baseDocumentDigest: receipt.baseDocumentDigest, stagedDocumentDigest: receipt.stagedDocumentDigest, stagedPath: receipt.stagedPath, terminalDigest: receipt.terminalDigest, receiptDigest: receiptDigest(receipt), operationDigest, validationDigest, semanticResultDigest, resultDigest, patchOperations: [...documentOperations].sort(compareOperations) })
  }
  for (const issueId of allIssueIds) if (!accounted.has(issueId)) throw new Error(`revision issue ${issueId} is missing validated result coverage`)
  if (operations.some(operation => !receiptByPath.has(operation.documentPath))) throw new Error('revision has an unassigned document PatchOperation')
  documents.sort((a, b) => a.documentPath.localeCompare(b.documentPath))
  assertDigest(input.confirmedBriefDigest, 'confirmedBriefDigest')
  const resultingIssueRegistryDigest = digestList(resultingIssues)
  const withoutDigest = { schema: 'beegame-foundation-revision-publish-v2' as const, status: 'prepared' as const, revision: input.revision, confirmedBriefDigest: input.confirmedBriefDigest, round: input.round, documents, resultingIssues, resultingIssueRegistryDigest }
  return { ...withoutDigest, authorityDigest: sha256(stable(withoutDigest)) }
}

function validatePrepared(value: unknown): FoundationRevisionPrepared {
  assertObject(value, 'foundation revision PREPARED authority')
  assertExactKeys(value, ['authorityDigest', 'confirmedBriefDigest', 'documents', 'revision', 'resultingIssueRegistryDigest', 'resultingIssues', 'round', 'schema', 'status'], 'PREPARED authority')
  if (value.schema !== 'beegame-foundation-revision-publish-v2' || value.status !== 'prepared' || typeof value.revision !== 'string' || !REVISION.test(value.revision) || (value.round !== 1 && value.round !== 2 && value.round !== 3) || !Array.isArray(value.documents) || value.documents.length === 0) throw new Error('foundation revision PREPARED authority is invalid')
  assertDigest(value.confirmedBriefDigest, 'PREPARED confirmedBriefDigest')
  assertDigest(value.authorityDigest, 'PREPARED authorityDigest')
  const resultingIssues = validateResultingIssues(value.resultingIssues)
  assertDigest(value.resultingIssueRegistryDigest, 'PREPARED resultingIssueRegistryDigest')
  if (digestList(resultingIssues) !== value.resultingIssueRegistryDigest) throw new Error('PREPARED resulting issue registry digest mismatch')
  const documents = value.documents.map(raw => {
    assertObject(raw, 'PREPARED document')
    assertExactKeys(raw, ['baseDocumentDigest', 'changedSectionIds', 'documentPath', 'issueIds', 'operationDigest', 'patchOperations', 'receiptDigest', 'resultDigest', 'round', 'semanticResultDigest', 'stagedDocumentDigest', 'stagedPath', 'taskId', 'terminalDigest', 'validationDigest'], 'PREPARED document')
    const receipt = validateReceipt({ taskId: raw.taskId, round: raw.round, documentPath: raw.documentPath, issueIds: raw.issueIds, baseDocumentDigest: raw.baseDocumentDigest, stagedDocumentDigest: raw.stagedDocumentDigest, changedSectionIds: raw.changedSectionIds, stagedPath: raw.stagedPath, terminalDigest: raw.terminalDigest }, value.revision as string)
    assertDigest(raw.receiptDigest, 'PREPARED receiptDigest'); assertDigest(raw.operationDigest, 'PREPARED operationDigest'); assertDigest(raw.validationDigest, 'PREPARED validationDigest'); assertDigest(raw.semanticResultDigest, 'PREPARED semanticResultDigest'); assertDigest(raw.resultDigest, 'PREPARED resultDigest')
    if (raw.receiptDigest !== receiptDigest(receipt)) throw new Error('PREPARED receipt digest mismatch')
    if (!Array.isArray(raw.patchOperations)) throw new Error('PREPARED patchOperations must be an array')
    const patchOperations = raw.patchOperations.map(validateOperation)
    if (foundationPatchOperationsDigest(patchOperations) !== raw.operationDigest) throw new Error('PREPARED operation digest mismatch')
    if (!sameSet(patchOperations.flatMap(operation => operation.issueIds), receipt.issueIds)) throw new Error('PREPARED issue coverage is incomplete')
    if (raw.resultDigest !== sha256(stable({ validationDigest: raw.validationDigest, semanticResultDigest: raw.semanticResultDigest }))) throw new Error('PREPARED result digest mismatch')
    return { documentPath: receipt.documentPath, round: receipt.round, taskId: receipt.taskId, issueIds: receipt.issueIds, changedSectionIds: receipt.changedSectionIds, baseDocumentDigest: receipt.baseDocumentDigest, stagedDocumentDigest: receipt.stagedDocumentDigest, stagedPath: receipt.stagedPath, terminalDigest: receipt.terminalDigest, receiptDigest: raw.receiptDigest as string, operationDigest: raw.operationDigest as string, validationDigest: raw.validationDigest as string, semanticResultDigest: raw.semanticResultDigest as string, resultDigest: raw.resultDigest as string, patchOperations }
  })
  if (new Set(documents.map(document => document.documentPath)).size !== documents.length) throw new Error('PREPARED authority contains duplicate document paths')
  const withoutDigest = { schema: 'beegame-foundation-revision-publish-v2' as const, status: 'prepared' as const, revision: value.revision as string, confirmedBriefDigest: value.confirmedBriefDigest as string, round: value.round as 1 | 2 | 3, documents, resultingIssues, resultingIssueRegistryDigest: value.resultingIssueRegistryDigest as string }
  if (sha256(stable(withoutDigest)) !== value.authorityDigest) throw new Error('PREPARED authority digest mismatch')
  return { ...withoutDigest, authorityDigest: value.authorityDigest as string }
}

async function readPrepared(workspacePath: string, revision: string): Promise<FoundationRevisionPrepared> {
  return validatePrepared(JSON.parse(await readFile(resolveProjectPath(workspacePath, foundationRevisionPreparedPath(revision)), 'utf8')))
}

function assertReplayMatches(input: FoundationRevisionPublicationInput, prepared: FoundationRevisionPrepared): void {
  if (input.round !== prepared.round || input.confirmedBriefDigest !== prepared.confirmedBriefDigest || input.batches.length !== prepared.documents.length || input.receipts.length !== prepared.documents.length) throw new Error('publication input does not match PREPARED authority')
  const docs = new Map(prepared.documents.map(document => [document.documentPath, document]))
  const batches = input.batches.map(validateBatch)
  for (const batch of batches) {
    const preparedDocument = docs.get(batch.documentPath)
    if (!preparedDocument || !sameSet(batch.issueIds, preparedDocument.issueIds) || !sameSet(batch.sectionIds, preparedDocument.changedSectionIds)) throw new Error('publication batch does not match PREPARED authority')
  }
  const receipts = input.receipts.map(value => validateReceipt(value, input.revision))
  for (const receipt of receipts) {
    const preparedDocument = docs.get(receipt.documentPath)
    if (!preparedDocument || receiptDigest(receipt) !== preparedDocument.receiptDigest || receipt.taskId !== preparedDocument.taskId || receipt.terminalDigest !== preparedDocument.terminalDigest) throw new Error('publication receipt does not match PREPARED authority')
  }
  const operations = input.patchOperations.map(validateOperation).sort(compareOperations)
  const preparedOperations = prepared.documents.flatMap(document => document.patchOperations).sort(compareOperations)
  if (stable(operations) !== stable(preparedOperations)) throw new Error('publication PatchOperations do not match PREPARED authority')
  const validations = input.patchValidations.map(validateValidation)
  const semanticResults = input.semanticRecheckResults.map(validateSemanticResult)
  const resultingIssues = validateResultingIssues(input.resultingIssues)
  if (digestList(resultingIssues) !== prepared.resultingIssueRegistryDigest || stable(resultingIssues) !== stable(prepared.resultingIssues)) throw new Error('publication resulting issue authority does not match PREPARED')
  for (const document of prepared.documents) {
    const documentValidations = validations.filter(validation => validation.documentPath === document.documentPath).sort((a, b) => a.issueId.localeCompare(b.issueId))
    if (digestList(documentValidations) !== document.validationDigest) throw new Error('publication PatchValidation authority does not match PREPARED')
    const issueIds = new Set(document.issueIds)
    const documentSemantic = semanticResults.filter(result => issueIds.has(result.issueId)).sort((a, b) => a.issueId.localeCompare(b.issueId))
    if (digestList(documentSemantic) !== document.semanticResultDigest) throw new Error('publication semantic result authority does not match PREPARED')
  }
}

function journalFor(prepared: FoundationRevisionPrepared): Journal {
  return { schema: 'beegame-foundation-revision-publish-journal-v2', revision: prepared.revision, authorityDigest: prepared.authorityDigest, entries: prepared.documents.map(document => ({ documentPath: document.documentPath, status: 'pending', stagedDocumentDigest: document.stagedDocumentDigest, operationDigest: document.operationDigest })) }
}

function validateJournal(value: unknown, prepared: FoundationRevisionPrepared): Journal {
  assertObject(value, 'publication journal')
  assertExactKeys(value, ['authorityDigest', 'entries', 'revision', 'schema'], 'publication journal')
  if (value.schema !== 'beegame-foundation-revision-publish-journal-v2' || value.revision !== prepared.revision || value.authorityDigest !== prepared.authorityDigest || !Array.isArray(value.entries)) throw new Error('publication journal authority is invalid')
  const docs = new Map(prepared.documents.map(document => [document.documentPath, document]))
  const entries = value.entries.map(raw => {
    assertObject(raw, 'publication journal entry')
    const expectedKeys = raw.status === 'published' ? ['canonicalDocumentDigest', 'documentPath', 'operationDigest', 'stagedDocumentDigest', 'status'] : ['documentPath', 'operationDigest', 'stagedDocumentDigest', 'status']
    assertExactKeys(raw, expectedKeys, 'publication journal entry')
    assertCanonical(raw.documentPath, 'publication journal entry document path')
    if (raw.status !== 'pending' && raw.status !== 'published') throw new Error('publication journal entry status is invalid')
    const preparedDocument = docs.get(raw.documentPath)
    if (!preparedDocument || raw.stagedDocumentDigest !== preparedDocument.stagedDocumentDigest || raw.operationDigest !== preparedDocument.operationDigest) throw new Error('publication journal entry disagrees with PREPARED authority')
    if (raw.status === 'published') assertDigest(raw.canonicalDocumentDigest, 'publication journal canonicalDocumentDigest')
    return raw as unknown as JournalEntry
  })
  if (entries.length !== prepared.documents.length || new Set(entries.map(entry => entry.documentPath)).size !== entries.length) throw new Error('publication journal coverage is invalid')
  return { schema: value.schema, revision: value.revision, authorityDigest: value.authorityDigest, entries }
}

async function readOrCreateJournal(workspacePath: string, prepared: FoundationRevisionPrepared): Promise<Journal> {
  const path = resolveProjectPath(workspacePath, foundationRevisionJournalPath(prepared.revision))
  try { return validateJournal(JSON.parse(await readFile(path, 'utf8')), prepared) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const journal = journalFor(prepared); await atomicJson(path, journal); return journal
  }
}

async function recoverPrepared(input: FoundationRevisionRecoveryInput, prepared: FoundationRevisionPrepared): Promise<FoundationRevisionPublicationResult> {
  const journalPath = resolveProjectPath(input.workspacePath, foundationRevisionJournalPath(prepared.revision))
  const committedPath = resolveProjectPath(input.workspacePath, foundationRevisionCommittedPath(prepared.revision))
  const journal = await readOrCreateJournal(input.workspacePath, prepared)
  let priorCommitted: Committed | undefined
  try {
    const value = JSON.parse(await readFile(committedPath, 'utf8')) as unknown
    assertObject(value, 'COMMITTED marker')
    assertExactKeys(value, ['authorityDigest', 'baseRevision', 'confirmedBriefDigest', 'documentDigests', 'resultingIssueRegistryDigest', 'resultingRevision', 'round', 'schema', 'status'], 'COMMITTED marker')
    if (value.schema !== 'beegame-foundation-revision-commit-v2' || value.status !== 'committed' || value.baseRevision !== prepared.revision || value.confirmedBriefDigest !== prepared.confirmedBriefDigest || value.round !== prepared.round || value.authorityDigest !== prepared.authorityDigest) throw new Error('COMMITTED marker authority is invalid')
    assertDigest(value.resultingRevision, 'COMMITTED resultingRevision')
    assertDigest(value.resultingIssueRegistryDigest, 'COMMITTED resultingIssueRegistryDigest')
    if (value.resultingIssueRegistryDigest !== prepared.resultingIssueRegistryDigest) throw new Error('COMMITTED resulting issue registry authority is invalid')
    assertObject(value.documentDigests, 'COMMITTED documentDigests')
    priorCommitted = value as unknown as Committed
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const documentDigests: Record<string, string> = {}
  for (const document of prepared.documents) {
    if (document.stagedPath !== foundationRevisionStagePath(prepared.revision, document.documentPath)) throw new Error('PREPARED staged path is not project-local authority')
    const canonicalPath = resolveProjectPath(input.workspacePath, document.documentPath)
    const stagedPath = resolveProjectPath(input.workspacePath, document.stagedPath)
    const stagedBytes = await readFile(stagedPath)
    if (sha256(stagedBytes) !== document.stagedDocumentDigest) throw new Error(`staged bytes are corrupt for ${document.documentPath}`)
    const canonicalDigest = sha256(await readFile(canonicalPath))
    if (canonicalDigest !== document.baseDocumentDigest && canonicalDigest !== document.stagedDocumentDigest) throw new Error(`canonical bytes are neither base nor staged for ${document.documentPath}`)
    const entry = journal.entries.find(candidate => candidate.documentPath === document.documentPath)
    if (!entry) throw new Error(`publication journal is missing ${document.documentPath}`)
    const alreadyPublished = entry.status === 'published' && canonicalDigest === document.stagedDocumentDigest
    if (canonicalDigest === document.baseDocumentDigest) {
      const temporary = `${canonicalPath}.foundation-${prepared.revision}-${randomUUID()}.tmp`
      try { await writeFile(temporary, stagedBytes); await rename(temporary, canonicalPath) } catch (error) { await rm(temporary, { force: true }); throw error }
    }
    const finalDigest = sha256(await readFile(canonicalPath))
    if (finalDigest !== document.stagedDocumentDigest) throw new Error(`canonical roll-forward digest mismatch for ${document.documentPath}`)
    documentDigests[document.documentPath] = finalDigest
    if (entry.status !== 'published' || entry.canonicalDocumentDigest !== finalDigest) {
      entry.status = 'published'; entry.canonicalDocumentDigest = finalDigest; await atomicJson(journalPath, journal)
    }
    if (!alreadyPublished) await input.onPathPublished?.(document.documentPath)
  }
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    const bytes = await readFile(resolveProjectPath(input.workspacePath, documentPath))
    documentDigests[documentPath] = sha256(bytes)
  }
  const resultingRevision = await computeDocumentRevision(input.workspacePath, prepared.confirmedBriefDigest)
  if (priorCommitted && (priorCommitted.resultingRevision !== resultingRevision || stable(priorCommitted.documentDigests) !== stable(documentDigests))) throw new Error('COMMITTED marker contradicts canonical bytes')
  if (!priorCommitted) await atomicJson(committedPath, { schema: 'beegame-foundation-revision-commit-v2', status: 'committed', baseRevision: prepared.revision, confirmedBriefDigest: prepared.confirmedBriefDigest, round: prepared.round, authorityDigest: prepared.authorityDigest, resultingRevision, resultingIssueRegistryDigest: prepared.resultingIssueRegistryDigest, documentDigests } satisfies Committed)
  return { status: 'committed', baseRevision: prepared.revision, resultingRevision, confirmedBriefDigest: prepared.confirmedBriefDigest, authorityDigest: prepared.authorityDigest, resultingIssues: frozenResultingIssues(prepared.resultingIssues), resultingIssueRegistryDigest: prepared.resultingIssueRegistryDigest, documentDigests, preparedPath: foundationRevisionPreparedPath(prepared.revision), journalPath: foundationRevisionJournalPath(prepared.revision), committedPath: foundationRevisionCommittedPath(prepared.revision) }
}

/** Validates actual revision authority, durably writes PREPARED, and rolls forward staged Markdown. */
export async function publishFoundationRevision(input: FoundationRevisionPublicationInput): Promise<FoundationRevisionPublicationResult> {
  assertRevision(input.revision)
  await mkdir(resolveProjectPath(input.workspacePath, rootPath(input.revision)), { recursive: true })
  let prepared: FoundationRevisionPrepared
  try {
    prepared = await readPrepared(input.workspacePath, input.revision)
    assertReplayMatches(input, prepared)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    prepared = await buildPrepared(input)
    await atomicJson(resolveProjectPath(input.workspacePath, foundationRevisionPreparedPath(input.revision)), prepared)
  }
  return recoverPrepared({ workspacePath: input.workspacePath, revision: input.revision, onPathPublished: input.onPathPublished }, prepared)
}

/** Resumes only the exact durable PREPARED authority and its remaining paths. */
export async function recoverFoundationRevision(input: FoundationRevisionRecoveryInput): Promise<FoundationRevisionPublicationResult> {
  assertRevision(input.revision)
  const prepared = await readPrepared(input.workspacePath, input.revision)
  return recoverPrepared(input, prepared)
}
