import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { getGameDocumentContract } from './game-document-contracts'
import { buildFoundationSectionIndex } from './foundation-section-index'
import type { AuditIssue } from './foundation-issue-registry'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

export type RevisionTaskReceipt = {
  taskId: string
  round: 1 | 2 | 3
  documentPath: FoundationDocumentPath
  issueIds: string[]
  baseDocumentDigest: string
  stagedDocumentDigest: string
  changedSectionIds: string[]
  stagedPath: string
  terminalDigest: string
}

export type PatchOperation = {
  kind: 'INSERT' | 'REPLACE' | 'DELETE'
  documentPath: FoundationDocumentPath
  sectionId: string
  issueIds: string[]
  beforeDigest?: string
  afterDigest?: string
}

export type RevisionBatch = {
  documentPath: FoundationDocumentPath
  sectionIds: string[]
  issueIds: string[]
}

export type FoundationRevisionStage = {
  revision: string
  documentPath: FoundationDocumentPath
  baseDocumentDigest: string
  stagedDocumentDigest: string
  stagedPath: string
}

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
  patchDigest: string
  patchOperations: PatchOperation[]
}

export type FoundationRevisionPrepared = {
  schema: 'beegame-foundation-revision-publish-v1'
  status: 'prepared'
  revision: string
  round: 1 | 2 | 3
  documents: FoundationRevisionPreparedDocument[]
  authorityDigest: string
}

export type FoundationRevisionPublishResult = {
  status: 'prepared' | 'committed'
  revision: string
  preparedPath: string
  committedPath?: string
  authorityDigest: string
}

type FoundationRevisionJournalEntry = {
  documentPath: FoundationDocumentPath
  status: 'pending' | 'published'
  stagedDocumentDigest: string
  canonicalDocumentDigest?: string
  patchDigest: string
}

type FoundationRevisionJournal = {
  schema: 'beegame-foundation-revision-publish-journal-v1'
  revision: string
  authorityDigest: string
  entries: FoundationRevisionJournalEntry[]
}

type FoundationRevisionCommitted = {
  schema: 'beegame-foundation-revision-commit-v1'
  status: 'committed'
  revision: string
  round: 1 | 2 | 3
  authorityDigest: string
  documentDigests: Record<string, string>
}

type RevisionTaskReceiptCore = {
  taskId: string
  round: 1 | 2 | 3
  documentPath: FoundationDocumentPath
  issueIds: readonly string[]
  baseDocumentDigest: string
  stagedDocumentDigest: string
  changedSectionIds: readonly string[]
  stagedPath: string
}

const DIGEST = /^[a-f0-9]{64}$/

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function assertRevision(revision: string): void {
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(revision))
    throw new Error(
      'foundation revision is not a safe project-local identifier',
    )
}

function assertCanonicalDocument(
  documentPath: string,
): asserts documentPath is FoundationDocumentPath {
  if (
    !(CANONICAL_FOUNDATION_DOCUMENTS as readonly string[]).includes(
      documentPath,
    )
  )
    throw new Error(
      `foundation revision document is outside canonical authority: ${documentPath}`,
    )
}

function stageRelativePath(
  revision: string,
  documentPath: FoundationDocumentPath,
): string {
  assertRevision(revision)
  return `.beegame/audit/foundation/${revision}/revision/${documentPath}`
}

export function foundationRevisionStagePath(
  revision: string,
  documentPath: FoundationDocumentPath,
): string {
  assertCanonicalDocument(documentPath)
  return stageRelativePath(revision, documentPath)
}

function resolveProjectPath(
  workspacePath: string,
  projectPath: string,
): string {
  const root = resolve(workspacePath)
  const candidate = resolve(root, projectPath)
  const escaped = relative(root, candidate)
  if (
    !escaped ||
    escaped === '..' ||
    escaped.startsWith(`..${sep}`) ||
    escaped.startsWith('/') ||
    escaped.startsWith('\\')
  )
    throw new Error('foundation revision path escaped the project workspace')
  return candidate
}

export async function createFoundationRevisionStage(input: {
  workspacePath: string
  revision: string
  documentPath: FoundationDocumentPath
}): Promise<FoundationRevisionStage> {
  assertRevision(input.revision)
  assertCanonicalDocument(input.documentPath)
  const canonicalPath = resolveProjectPath(
    input.workspacePath,
    input.documentPath,
  )
  const stagedPath = foundationRevisionStagePath(
    input.revision,
    input.documentPath,
  )
  const stagedAbsolute = resolveProjectPath(input.workspacePath, stagedPath)
  const baseBytes = await readFile(canonicalPath)
  const baseDocumentDigest = sha256(baseBytes)
  await mkdir(resolve(stagedAbsolute, '..'), { recursive: true })
  try {
    const existing = await readFile(stagedAbsolute)
    if (existing.length === 0 && baseBytes.length > 0)
      throw new Error(
        'existing foundation revision stage is not a valid Markdown copy',
      )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(stagedAbsolute, baseBytes, { flag: 'wx' })
  }
  const stagedBytes = await readFile(stagedAbsolute)
  return {
    revision: input.revision,
    documentPath: input.documentPath,
    baseDocumentDigest,
    stagedDocumentDigest: sha256(stagedBytes),
    stagedPath,
  }
}

type ParsedSection = {
  sectionId: string
  text: string
  body: string
}

function parseSections(
  documentPath: FoundationDocumentPath,
  markdown: string,
): ParsedSection[] {
  // The existing contract-grounded index is deliberately the structural parser:
  // it rejects marker loss, duplicate markers, wrong headings and unknown markers.
  const index = buildFoundationSectionIndex({
    documents: { [documentPath]: markdown },
  })
  const lines = markdown.split('\n')
  return index
    .filter(section => section.documentPath === documentPath)
    .map(section => {
      const text = lines
        .slice(section.startLine - 1, section.endLine)
        .join('\n')
      const body = text.split('\n').slice(1).join('\n').trim()
      return { sectionId: section.sectionId, text, body }
    })
}

function sectionMap(
  sections: readonly ParsedSection[],
): Map<string, ParsedSection> {
  const output = new Map<string, ParsedSection>()
  for (const section of sections) {
    if (output.has(section.sectionId))
      throw new Error(`duplicate revision section: ${section.sectionId}`)
    output.set(section.sectionId, section)
  }
  return output
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} shape contains extra or missing keys`)
}

function assertUniqueStrings(
  values: unknown,
  label: string,
  nonEmpty = true,
): asserts values is string[] {
  if (
    !Array.isArray(values) ||
    (nonEmpty && values.length === 0) ||
    values.some(value => typeof value !== 'string' || value.length === 0) ||
    new Set(values).size !== values.length
  )
    throw new Error(`${label} must contain unique non-empty strings`)
}

export function revisionTaskReceiptTerminalDigest(
  receipt: RevisionTaskReceiptCore,
): string {
  return sha256(stableJson(receipt))
}

function validateReceipt(
  receipt: unknown,
  input: {
    revision: string
    documentPath: FoundationDocumentPath
    taskId?: string
    issueIds: readonly string[]
    sectionIds: readonly string[]
    workspacePath: string
  },
): RevisionTaskReceipt {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    throw new Error('revision receipt must be an object')
  const value = receipt as Record<string, unknown>
  assertExactKeys(
    value,
    [
      'taskId',
      'round',
      'documentPath',
      'issueIds',
      'baseDocumentDigest',
      'stagedDocumentDigest',
      'changedSectionIds',
      'stagedPath',
      'terminalDigest',
    ],
    'revision receipt',
  )
  if (
    typeof value.taskId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.taskId)
  )
    throw new Error('revision receipt taskId is invalid')
  if (input.taskId !== undefined && value.taskId !== input.taskId)
    throw new Error('revision receipt taskId mismatch')
  if (value.round !== 1 && value.round !== 2 && value.round !== 3)
    throw new Error('revision receipt round is invalid')
  if (value.documentPath !== input.documentPath)
    throw new Error('revision receipt document path mismatch')
  assertUniqueStrings(value.issueIds, 'revision receipt issueIds')
  if (
    value.issueIds.length !== input.issueIds.length ||
    value.issueIds.some((id, index) => id !== input.issueIds[index])
  )
    throw new Error('revision receipt issueIds mismatch')
  assertUniqueStrings(
    value.changedSectionIds,
    'revision receipt changedSectionIds',
  )
  if (value.changedSectionIds.some(id => !input.sectionIds.includes(id)))
    throw new Error('revision receipt changed section is unauthorized')
  for (const key of [
    'baseDocumentDigest',
    'stagedDocumentDigest',
    'terminalDigest',
  ])
    if (typeof value[key] !== 'string' || !DIGEST.test(value[key]))
      throw new Error(`revision receipt ${key} is invalid`)
  if (
    value.stagedPath !==
    foundationRevisionStagePath(input.revision, input.documentPath)
  )
    throw new Error('revision receipt staged path is not task-bound')
  const absoluteStage = resolveProjectPath(
    input.workspacePath,
    value.stagedPath as string,
  )
  void absoluteStage
  const { terminalDigest: _terminalDigest, ...withoutTerminal } = value
  if (
    revisionTaskReceiptTerminalDigest(
      withoutTerminal as Omit<RevisionTaskReceipt, 'terminalDigest'>,
    ) !== value.terminalDigest
  )
    throw new Error('revision receipt terminal digest mismatch')
  return value as unknown as RevisionTaskReceipt
}

function assertBatch(batch: RevisionBatch): void {
  if (!batch || typeof batch !== 'object')
    throw new Error('revision batch is invalid')
  assertCanonicalDocument(batch.documentPath)
  assertUniqueStrings(batch.sectionIds, 'revision batch sectionIds')
  assertUniqueStrings(batch.issueIds, 'revision batch issueIds')
  const contract = getGameDocumentContract(batch.documentPath)
  const known = new Set(contract.sections.map(section => section.sectionId))
  if (batch.sectionIds.some(sectionId => !known.has(sectionId)))
    throw new Error('revision batch section is not canonical')
}

function issueAuthority(
  batch: RevisionBatch,
  issues: readonly AuditIssue[],
): Map<string, string[]> {
  if (!Array.isArray(issues) || issues.length !== batch.issueIds.length)
    throw new Error('revision requires the exact admitted issue authority')
  const batchIds = new Set(batch.issueIds)
  const seen = new Set<string>()
  const grouped = new Map<string, string[]>()
  const contractSections = new Set(
    getGameDocumentContract(batch.documentPath).sections.map(
      section => section.sectionId,
    ),
  )
  for (const issue of issues) {
    if (
      !issue ||
      typeof issue.id !== 'string' ||
      !issue.id ||
      seen.has(issue.id)
    )
      throw new Error('revision admitted issue IDs must be unique')
    if (!batchIds.has(issue.id))
      throw new Error('revision admitted issue IDs disagree with the batch')
    if (issue.fixDocument !== batch.documentPath)
      throw new Error('revision issue fix document is outside the batch')
    if (
      !contractSections.has(issue.fixSectionId) ||
      !batch.sectionIds.includes(issue.fixSectionId)
    )
      throw new Error('revision issue fix section is outside the batch')
    seen.add(issue.id)
    const sectionIssues = grouped.get(issue.fixSectionId) ?? []
    sectionIssues.push(issue.id)
    grouped.set(issue.fixSectionId, sectionIssues)
  }
  if (seen.size !== batchIds.size)
    throw new Error('revision admitted issue coverage is incomplete')
  for (const ids of grouped.values()) ids.sort(compareStable)
  return grouped
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Derives bounded operations from bytes; it never accepts a worker-supplied patch body. */
export async function deriveFoundationPatchOperations(input: {
  workspacePath: string
  revision: string
  taskId?: string
  batch: RevisionBatch
  issues: readonly AuditIssue[]
  receipt: RevisionTaskReceipt
}): Promise<PatchOperation[]> {
  assertRevision(input.revision)
  assertBatch(input.batch)
  const receipt = validateReceipt(input.receipt, {
    revision: input.revision,
    documentPath: input.batch.documentPath,
    taskId: input.taskId,
    issueIds: input.batch.issueIds,
    sectionIds: input.batch.sectionIds,
    workspacePath: input.workspacePath,
  })
  const issueIdsBySection = issueAuthority(input.batch, input.issues)
  const canonicalPath = resolveProjectPath(
    input.workspacePath,
    input.batch.documentPath,
  )
  const stagedPath = resolveProjectPath(input.workspacePath, receipt.stagedPath)
  const baseBytes = await readFile(canonicalPath)
  const stagedBytes = await readFile(stagedPath)
  if (sha256(baseBytes) !== receipt.baseDocumentDigest)
    throw new Error('revision receipt has stale base document digest')
  if (sha256(stagedBytes) !== receipt.stagedDocumentDigest)
    throw new Error('revision receipt staged document digest mismatch')
  const base = parseSections(
    input.batch.documentPath,
    baseBytes.toString('utf8'),
  )
  const staged = parseSections(
    input.batch.documentPath,
    stagedBytes.toString('utf8'),
  )
  sectionMap(base)
  const stagedMap = sectionMap(staged)
  if (
    base.length !== staged.length ||
    base.some(
      (section, index) => section.sectionId !== staged[index]?.sectionId,
    )
  )
    throw new Error('revision changed section markers or section order')

  const changed = base.filter(
    (section, index) => section.text !== staged[index]!.text,
  )
  if (
    changed.some(section => !input.batch.sectionIds.includes(section.sectionId))
  )
    throw new Error('revision changed an unauthorized section')
  const changedIds = changed.map(section => section.sectionId)
  if (changedIds.length === 0)
    throw new Error('revision contains no section progress')
  if (
    changedIds.length !== receipt.changedSectionIds.length ||
    changedIds.some((id, index) => id !== receipt.changedSectionIds[index])
  )
    throw new Error('revision receipt changedSectionIds mismatch')

  // Replace each authorized section with a sentinel and compare the rest byte-for-byte.
  const outside = (markdown: string, allowed: ReadonlySet<string>) => {
    const lines = markdown.split('\n')
    const index = buildFoundationSectionIndex({
      documents: { [input.batch.documentPath]: markdown },
    })
    const chunks: string[] = []
    let cursor = 0
    for (const section of index) {
      const start = section.startLine - 1
      const end = section.endLine
      chunks.push(lines.slice(cursor, start).join('\n'))
      if (allowed.has(section.sectionId))
        chunks.push(`\0${section.sectionId}\0`)
      else chunks.push(lines.slice(start, end).join('\n'))
      cursor = end
    }
    chunks.push(lines.slice(cursor).join('\n'))
    return chunks.join('\n')
  }
  const allowed = new Set(input.batch.sectionIds)
  if (
    outside(baseBytes.toString('utf8'), allowed) !==
    outside(stagedBytes.toString('utf8'), allowed)
  )
    throw new Error('revision changed bytes outside authorized sections')

  const contractOrder = new Map(
    getGameDocumentContract(input.batch.documentPath).sections.map(
      (section, index) => [section.sectionId, index],
    ),
  )
  changed.sort(
    (left, right) =>
      (contractOrder.get(left.sectionId) ?? Number.MAX_SAFE_INTEGER) -
      (contractOrder.get(right.sectionId) ?? Number.MAX_SAFE_INTEGER),
  )
  const operations = changed.map(before => {
    const after = stagedMap.get(before.sectionId)!
    const issueIds = issueIdsBySection.get(before.sectionId)
    if (!issueIds || issueIds.length === 0)
      throw new Error('revision changed a section without an admitted issue')
    const kind: PatchOperation['kind'] =
      !before.body && after.body
        ? 'INSERT'
        : before.body && !after.body
          ? 'DELETE'
          : 'REPLACE'
    return {
      kind,
      documentPath: input.batch.documentPath,
      sectionId: before.sectionId,
      issueIds,
      ...(kind === 'INSERT' || kind === 'REPLACE'
        ? { afterDigest: sha256(after.text) }
        : {}),
      ...(kind === 'DELETE' || kind === 'REPLACE'
        ? { beforeDigest: sha256(before.text) }
        : {}),
    } satisfies PatchOperation
  })
  for (const issue of input.issues)
    if (!changedIds.includes(issue.fixSectionId))
      throw new Error('revision admitted issue target was not changed')
  const boundIssueIds = operations.flatMap(operation => operation.issueIds)
  const expectedIssueIds = [...input.batch.issueIds].sort(compareStable)
  const actualIssueIds = [...boundIssueIds].sort(compareStable)
  if (
    actualIssueIds.length !== expectedIssueIds.length ||
    actualIssueIds.some((id, index) => id !== expectedIssueIds[index])
  )
    throw new Error('revision issue coverage is not exact')
  return operations
}

export function foundationPatchOperationsDigest(
  operations: readonly PatchOperation[],
): string {
  return sha256(stableJson([...operations].sort(comparePatchOperations)))
}

function comparePatchOperations(
  left: PatchOperation,
  right: PatchOperation,
): number {
  const document = left.documentPath.localeCompare(right.documentPath)
  if (document !== 0) return document
  const section = left.sectionId.localeCompare(right.sectionId)
  if (section !== 0) return section
  return stableJson(left).localeCompare(stableJson(right))
}

function revisionPublishRoot(revision: string): string {
  assertRevision(revision)
  return `.beegame/audit/foundation/${revision}/revision`
}

export function foundationRevisionPreparedPath(revision: string): string {
  return `${revisionPublishRoot(revision)}/PREPARED.json`
}

export function foundationRevisionJournalPath(revision: string): string {
  return `${revisionPublishRoot(revision)}/JOURNAL.json`
}

export function foundationRevisionCommittedPath(revision: string): string {
  return `${revisionPublishRoot(revision)}/COMMITTED.json`
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${label} is invalid`)
}

function assertJsonObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
}

async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function publicationIssue(
  id: string,
  documentPath: FoundationDocumentPath,
  sectionId: string,
): AuditIssue {
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source: {
      documentPath,
      sectionId,
      heading: sectionId,
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    },
    expected: 'revision authority',
    actual: 'revision authority',
    fixDocument: documentPath,
    fixSectionId: sectionId,
  }
}

function validatePatchOperationShape(operation: unknown): PatchOperation {
  assertJsonObject(operation, 'foundation revision patch operation')
  const keys = Object.keys(operation).sort()
  if (
    !['INSERT', 'REPLACE', 'DELETE'].includes(String(operation.kind)) ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(
      operation.documentPath as FoundationDocumentPath,
    ) ||
    typeof operation.sectionId !== 'string' ||
    !Array.isArray(operation.issueIds) ||
    operation.issueIds.length === 0 ||
    operation.issueIds.some(
      value => typeof value !== 'string' || value.length === 0,
    ) ||
    new Set(operation.issueIds).size !== operation.issueIds.length
  )
    throw new Error('foundation revision patch operation is invalid')
  const expected =
    operation.kind === 'INSERT'
      ? ['afterDigest', 'documentPath', 'issueIds', 'kind', 'sectionId']
      : operation.kind === 'DELETE'
        ? ['beforeDigest', 'documentPath', 'issueIds', 'kind', 'sectionId']
        : [
            'afterDigest',
            'beforeDigest',
            'documentPath',
            'issueIds',
            'kind',
            'sectionId',
          ]
  if (keys.join('|') !== expected.join('|'))
    throw new Error('foundation revision patch operation shape is invalid')
  if (operation.kind !== 'INSERT')
    assertDigest(operation.beforeDigest, 'patch beforeDigest')
  if (operation.kind !== 'DELETE')
    assertDigest(operation.afterDigest, 'patch afterDigest')
  return {
    kind: operation.kind as PatchOperation['kind'],
    documentPath: operation.documentPath as FoundationDocumentPath,
    sectionId: operation.sectionId as string,
    issueIds: [...(operation.issueIds as string[])],
    ...(operation.beforeDigest
      ? { beforeDigest: operation.beforeDigest as string }
      : {}),
    ...(operation.afterDigest
      ? { afterDigest: operation.afterDigest as string }
      : {}),
  }
}

function validatePreparedShape(value: unknown): FoundationRevisionPrepared {
  assertJsonObject(value, 'foundation revision PREPARED authority')
  if (
    value.schema !== 'beegame-foundation-revision-publish-v1' ||
    value.status !== 'prepared' ||
    typeof value.revision !== 'string' ||
    ![1, 2, 3].includes(value.round as number) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0
  )
    throw new Error('foundation revision PREPARED authority is invalid')
  assertDigest(value.authorityDigest, 'foundation revision authorityDigest')
  const documents = value.documents.map(document => {
    assertJsonObject(document, 'foundation revision prepared document')
    if (
      !CANONICAL_FOUNDATION_DOCUMENTS.includes(
        document.documentPath as FoundationDocumentPath,
      ) ||
      ![1, 2, 3].includes(document.round as number) ||
      document.round !== value.round ||
      typeof document.taskId !== 'string' ||
      !Array.isArray(document.issueIds) ||
      !Array.isArray(document.changedSectionIds) ||
      !Array.isArray(document.patchOperations) ||
      typeof document.stagedPath !== 'string'
    )
      throw new Error('foundation revision prepared document is invalid')
    assertUniqueStrings(document.issueIds, 'prepared document issueIds')
    assertUniqueStrings(
      document.changedSectionIds,
      'prepared document changedSectionIds',
    )
    assertDigest(document.baseDocumentDigest, 'prepared baseDocumentDigest')
    assertDigest(document.stagedDocumentDigest, 'prepared stagedDocumentDigest')
    assertDigest(document.terminalDigest, 'prepared terminalDigest')
    assertDigest(document.patchDigest, 'prepared patchDigest')
    const operations = document.patchOperations.map(validatePatchOperationShape)
    if (foundationPatchOperationsDigest(operations) !== document.patchDigest)
      throw new Error('foundation revision prepared patch digest mismatch')
    const operationIssueIds = operations
      .flatMap(operation => operation.issueIds)
      .sort(compareStable)
    const documentIssueIds = [...(document.issueIds as string[])].sort(
      compareStable,
    )
    if (
      operationIssueIds.length !== documentIssueIds.length ||
      operationIssueIds.some((id, index) => id !== documentIssueIds[index])
    )
      throw new Error(
        'foundation revision prepared issue coverage is incomplete',
      )
    return {
      documentPath: document.documentPath as FoundationDocumentPath,
      round: document.round as 1 | 2 | 3,
      taskId: document.taskId as string,
      issueIds: [...(document.issueIds as string[])],
      changedSectionIds: [...(document.changedSectionIds as string[])],
      baseDocumentDigest: document.baseDocumentDigest as string,
      stagedDocumentDigest: document.stagedDocumentDigest as string,
      stagedPath: document.stagedPath as string,
      terminalDigest: document.terminalDigest as string,
      patchDigest: document.patchDigest as string,
      patchOperations: operations,
    }
  })
  const paths = documents.map(document => document.documentPath)
  if (new Set(paths).size !== paths.length)
    throw new Error(
      'foundation revision PREPARED authority contains duplicate paths',
    )
  const withoutDigest: Record<string, unknown> = { ...value, documents }
  delete withoutDigest.authorityDigest
  if (sha256(stableJson(withoutDigest)) !== value.authorityDigest)
    throw new Error('foundation revision PREPARED authority digest mismatch')
  return {
    schema: value.schema,
    status: value.status,
    revision: value.revision,
    round: value.round as 1 | 2 | 3,
    documents,
    authorityDigest: value.authorityDigest as string,
  }
}

async function buildPreparedAuthority(input: {
  workspacePath: string
  revision: string
  round: 1 | 2 | 3
  receipts: readonly RevisionTaskReceipt[]
  patchOperations: readonly PatchOperation[]
}): Promise<FoundationRevisionPrepared> {
  if (!Array.isArray(input.receipts) || input.receipts.length === 0)
    throw new Error('foundation revision publish requires document receipts')
  const receipts = [...input.receipts]
  const seenPaths = new Set<string>()
  const documents: FoundationRevisionPreparedDocument[] = []
  const operations = input.patchOperations.map(validatePatchOperationShape)
  const seenIssueIds = new Set<string>()
  for (const receipt of receipts) {
    assertCanonicalDocument(receipt.documentPath)
    if (receipt.round !== input.round)
      throw new Error('foundation revision receipts must belong to one round')
    if (seenPaths.has(receipt.documentPath))
      throw new Error(
        'foundation revision receipts contain duplicate document paths',
      )
    seenPaths.add(receipt.documentPath)
    const receiptValue = validateReceipt(receipt, {
      revision: input.revision,
      documentPath: receipt.documentPath,
      issueIds: receipt.issueIds,
      sectionIds: receipt.changedSectionIds,
      workspacePath: input.workspacePath,
    })
    for (const issueId of receiptValue.issueIds) {
      if (seenIssueIds.has(issueId))
        throw new Error(
          'foundation revision issue coverage contains duplicate IDs',
        )
      seenIssueIds.add(issueId)
    }
    const documentOperations = operations.filter(
      operation => operation.documentPath === receipt.documentPath,
    )
    const opIssueIds = documentOperations.flatMap(
      operation => operation.issueIds,
    )
    if (
      opIssueIds.length !== receipt.issueIds.length ||
      [...opIssueIds]
        .sort(compareStable)
        .some(
          (id, index) =>
            id !== [...receipt.issueIds].sort(compareStable)[index],
        )
    )
      throw new Error('foundation revision issue/path coverage is incomplete')
    const issues = documentOperations.flatMap(operation =>
      operation.issueIds.map(issueId =>
        publicationIssue(issueId, receipt.documentPath, operation.sectionId),
      ),
    )
    const derived = await deriveFoundationPatchOperations({
      workspacePath: input.workspacePath,
      revision: input.revision,
      batch: {
        documentPath: receipt.documentPath,
        sectionIds: receipt.changedSectionIds,
        issueIds: receipt.issueIds,
      },
      issues,
      receipt: receiptValue,
    })
    const providedCanonical = [...documentOperations].sort(
      comparePatchOperations,
    )
    const derivedCanonical = [...derived].sort(comparePatchOperations)
    if (stableJson(providedCanonical) !== stableJson(derivedCanonical))
      throw new Error(
        'foundation revision patch operations do not match staged bytes',
      )
    documents.push({
      documentPath: receipt.documentPath,
      round: receipt.round,
      taskId: receipt.taskId,
      issueIds: [...receipt.issueIds],
      changedSectionIds: [...receipt.changedSectionIds],
      baseDocumentDigest: receipt.baseDocumentDigest,
      stagedDocumentDigest: receipt.stagedDocumentDigest,
      stagedPath: receipt.stagedPath,
      terminalDigest: receipt.terminalDigest,
      patchDigest: foundationPatchOperationsDigest(documentOperations),
      patchOperations: providedCanonical,
    })
  }
  if (operations.some(operation => !seenPaths.has(operation.documentPath)))
    throw new Error(
      'foundation revision patch operation has no matching receipt path',
    )
  documents.sort((left, right) =>
    left.documentPath.localeCompare(right.documentPath),
  )
  const withoutDigest = {
    schema: 'beegame-foundation-revision-publish-v1' as const,
    status: 'prepared' as const,
    revision: input.revision,
    round: input.round,
    documents,
  }
  return {
    ...withoutDigest,
    authorityDigest: sha256(stableJson(withoutDigest)),
  }
}

async function readPreparedAuthority(
  workspacePath: string,
  revision: string,
): Promise<FoundationRevisionPrepared> {
  const path = resolveProjectPath(
    workspacePath,
    foundationRevisionPreparedPath(revision),
  )
  return validatePreparedShape(JSON.parse(await readFile(path, 'utf8')))
}

function assertPublicationInputMatchesPrepared(
  input: {
    revision: string
    round: 1 | 2 | 3
    receipts: readonly RevisionTaskReceipt[]
    patchOperations: readonly PatchOperation[]
  },
  prepared: FoundationRevisionPrepared,
): void {
  if (
    input.round !== prepared.round ||
    input.receipts.length !== prepared.documents.length
  )
    throw new Error(
      'foundation revision replay authority does not match PREPARED',
    )
  const preparedByPath = new Map(
    prepared.documents.map(document => [document.documentPath, document]),
  )
  const seen = new Set<string>()
  for (const receipt of input.receipts) {
    if (seen.has(receipt.documentPath))
      throw new Error(
        'foundation revision replay contains duplicate receipt paths',
      )
    seen.add(receipt.documentPath)
    const document = preparedByPath.get(receipt.documentPath)
    if (!document || receipt.round !== document.round)
      throw new Error(
        'foundation revision replay receipt disagrees with PREPARED',
      )
    validateReceipt(receipt, {
      revision: input.revision,
      documentPath: receipt.documentPath,
      issueIds: document.issueIds,
      sectionIds: document.changedSectionIds,
      workspacePath: '',
    })
    if (
      receipt.taskId !== document.taskId ||
      receipt.issueIds.join('|') !== document.issueIds.join('|') ||
      receipt.baseDocumentDigest !== document.baseDocumentDigest ||
      receipt.stagedDocumentDigest !== document.stagedDocumentDigest ||
      receipt.stagedPath !== document.stagedPath ||
      receipt.terminalDigest !== document.terminalDigest ||
      receipt.changedSectionIds.join('|') !==
        document.changedSectionIds.join('|')
    )
      throw new Error(
        'foundation revision replay receipt authority disagrees with PREPARED',
      )
  }
  if (seen.size !== prepared.documents.length)
    throw new Error('foundation revision replay receipt coverage is incomplete')
  const operations = input.patchOperations
    .map(validatePatchOperationShape)
    .sort(comparePatchOperations)
  const preparedOperations = prepared.documents
    .flatMap(document => document.patchOperations)
    .sort(comparePatchOperations)
  if (stableJson(operations) !== stableJson(preparedOperations))
    throw new Error(
      'foundation revision replay patch authority disagrees with PREPARED',
    )
}

function journalEntriesFor(
  prepared: FoundationRevisionPrepared,
): FoundationRevisionJournalEntry[] {
  return prepared.documents.map(document => ({
    documentPath: document.documentPath,
    status: 'pending',
    stagedDocumentDigest: document.stagedDocumentDigest,
    patchDigest: document.patchDigest,
  }))
}

async function readOrCreateJournal(
  workspacePath: string,
  prepared: FoundationRevisionPrepared,
): Promise<FoundationRevisionJournal> {
  const path = resolveProjectPath(
    workspacePath,
    foundationRevisionJournalPath(prepared.revision),
  )
  try {
    const value = JSON.parse(
      await readFile(path, 'utf8'),
    ) as FoundationRevisionJournal
    if (
      value.schema !== 'beegame-foundation-revision-publish-journal-v1' ||
      value.revision !== prepared.revision ||
      value.authorityDigest !== prepared.authorityDigest ||
      !Array.isArray(value.entries)
    )
      throw new Error('foundation revision publish journal is invalid')
    const expected = new Set(
      prepared.documents.map(document => document.documentPath),
    )
    if (
      value.entries.length !== expected.size ||
      new Set(value.entries.map(entry => entry.documentPath)).size !==
        value.entries.length ||
      value.entries.some(entry => {
        const document = prepared.documents.find(
          candidate => candidate.documentPath === entry.documentPath,
        )
        return (
          !document ||
          !['pending', 'published'].includes(entry.status) ||
          entry.stagedDocumentDigest !== document.stagedDocumentDigest ||
          entry.patchDigest !== document.patchDigest ||
          (entry.status === 'published' &&
            entry.canonicalDocumentDigest !== document.stagedDocumentDigest)
        )
      })
    )
      throw new Error('foundation revision publish journal coverage is invalid')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const journal: FoundationRevisionJournal = {
      schema: 'beegame-foundation-revision-publish-journal-v1',
      revision: prepared.revision,
      authorityDigest: prepared.authorityDigest,
      entries: journalEntriesFor(prepared),
    }
    await writeJsonAtomically(path, journal)
    return journal
  }
}

async function recoverPreparedAuthority(input: {
  workspacePath: string
  prepared: FoundationRevisionPrepared
  onDocumentPublished?: (
    documentPath: FoundationDocumentPath,
  ) => Promise<void> | void
}): Promise<FoundationRevisionPublishResult> {
  const preparedPath = foundationRevisionPreparedPath(input.prepared.revision)
  const committedPath = foundationRevisionCommittedPath(input.prepared.revision)
  const journalPath = resolveProjectPath(
    input.workspacePath,
    foundationRevisionJournalPath(input.prepared.revision),
  )
  const journal = await readOrCreateJournal(input.workspacePath, input.prepared)
  const committedAbsolute = resolveProjectPath(
    input.workspacePath,
    committedPath,
  )
  let priorCommitted: FoundationRevisionCommitted | undefined
  try {
    const existing = JSON.parse(
      await readFile(committedAbsolute, 'utf8'),
    ) as FoundationRevisionCommitted
    if (
      existing.schema !== 'beegame-foundation-revision-commit-v1' ||
      existing.status !== 'committed' ||
      existing.revision !== input.prepared.revision ||
      existing.round !== input.prepared.round ||
      existing.authorityDigest !== input.prepared.authorityDigest
    )
      throw new Error('foundation revision COMMITTED marker is invalid')
    if (
      !existing.documentDigests ||
      typeof existing.documentDigests !== 'object' ||
      Array.isArray(existing.documentDigests)
    )
      throw new Error(
        'foundation revision COMMITTED document digests are invalid',
      )
    priorCommitted = existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const documentDigests: Record<string, string> = {}
  for (const document of input.prepared.documents) {
    if (
      document.stagedPath !==
      foundationRevisionStagePath(
        input.prepared.revision,
        document.documentPath,
      )
    )
      throw new Error(
        `foundation revision staged path is not authority-bound for ${document.documentPath}`,
      )
    const canonicalPath = resolveProjectPath(
      input.workspacePath,
      document.documentPath,
    )
    const stagedPath = resolveProjectPath(
      input.workspacePath,
      document.stagedPath,
    )
    const stagedBytes = await readFile(stagedPath)
    if (sha256(stagedBytes) !== document.stagedDocumentDigest)
      throw new Error(
        `foundation revision staged bytes are corrupt for ${document.documentPath}`,
      )
    const canonicalBytes = await readFile(canonicalPath)
    const canonicalDigest = sha256(canonicalBytes)
    if (
      canonicalDigest !== document.baseDocumentDigest &&
      canonicalDigest !== document.stagedDocumentDigest
    )
      throw new Error(
        `foundation revision canonical bytes are neither base nor staged for ${document.documentPath}`,
      )
    const entry = journal.entries.find(
      candidate => candidate.documentPath === document.documentPath,
    )
    if (!entry)
      throw new Error(
        `foundation revision journal is missing ${document.documentPath}`,
      )
    if (canonicalDigest === document.baseDocumentDigest) {
      const temporary = `${canonicalPath}.foundation-${input.prepared.revision}.tmp`
      await writeFile(temporary, stagedBytes)
      try {
        await rename(temporary, canonicalPath)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    }
    const finalBytes = await readFile(canonicalPath)
    const finalDigest = sha256(finalBytes)
    if (finalDigest !== document.stagedDocumentDigest)
      throw new Error(
        `foundation revision canonical roll-forward digest mismatch for ${document.documentPath}`,
      )
    documentDigests[document.documentPath] = finalDigest
    if (
      entry.status !== 'published' ||
      entry.canonicalDocumentDigest !== finalDigest
    ) {
      entry.status = 'published'
      entry.canonicalDocumentDigest = finalDigest
      await writeJsonAtomically(journalPath, journal)
    }
    await input.onDocumentPublished?.(document.documentPath)
  }
  if (
    priorCommitted &&
    stableJson(priorCommitted.documentDigests) !== stableJson(documentDigests)
  )
    throw new Error(
      'foundation revision COMMITTED document digests contradict canonical bytes',
    )
  const committed: FoundationRevisionCommitted = {
    schema: 'beegame-foundation-revision-commit-v1',
    status: 'committed',
    revision: input.prepared.revision,
    round: input.prepared.round,
    authorityDigest: input.prepared.authorityDigest,
    documentDigests,
  }
  await writeJsonAtomically(
    resolveProjectPath(input.workspacePath, committedPath),
    committed,
  )
  return {
    status: 'committed',
    revision: input.prepared.revision,
    preparedPath,
    committedPath,
    authorityDigest: input.prepared.authorityDigest,
  }
}

export async function publishFoundationRevision(input: {
  workspacePath: string
  revision: string
  round: 1 | 2 | 3
  receipts: readonly RevisionTaskReceipt[]
  patchOperations: readonly PatchOperation[]
  onDocumentPublished?: (
    documentPath: FoundationDocumentPath,
  ) => Promise<void> | void
}): Promise<FoundationRevisionPublishResult> {
  assertRevision(input.revision)
  const root = resolveProjectPath(
    input.workspacePath,
    revisionPublishRoot(input.revision),
  )
  await mkdir(root, { recursive: true })
  const preparedPath = resolveProjectPath(
    input.workspacePath,
    foundationRevisionPreparedPath(input.revision),
  )
  let prepared: FoundationRevisionPrepared
  try {
    prepared = await readPreparedAuthority(input.workspacePath, input.revision)
    if (prepared.round !== input.round)
      throw new Error('foundation revision PREPARED authority round mismatch')
    assertPublicationInputMatchesPrepared(input, prepared)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    prepared = await buildPreparedAuthority(input)
    await writeJsonAtomically(preparedPath, prepared)
  }
  return recoverPreparedAuthority({
    workspacePath: input.workspacePath,
    prepared,
    onDocumentPublished: input.onDocumentPublished,
  })
}

/** Validate and durably write the complete authority without touching canonical Markdown. */
export async function prepareFoundationRevision(input: {
  workspacePath: string
  revision: string
  round: 1 | 2 | 3
  receipts: readonly RevisionTaskReceipt[]
  patchOperations: readonly PatchOperation[]
}): Promise<FoundationRevisionPublishResult> {
  assertRevision(input.revision)
  const root = resolveProjectPath(
    input.workspacePath,
    revisionPublishRoot(input.revision),
  )
  await mkdir(root, { recursive: true })
  const preparedPath = resolveProjectPath(
    input.workspacePath,
    foundationRevisionPreparedPath(input.revision),
  )
  let prepared: FoundationRevisionPrepared
  try {
    prepared = await readPreparedAuthority(input.workspacePath, input.revision)
    assertPublicationInputMatchesPrepared(input, prepared)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    prepared = await buildPreparedAuthority(input)
    await writeJsonAtomically(preparedPath, prepared)
  }
  return {
    status: 'prepared',
    revision: input.revision,
    preparedPath: foundationRevisionPreparedPath(input.revision),
    authorityDigest: prepared.authorityDigest,
  }
}

export async function recoverFoundationRevision(input: {
  workspacePath: string
  revision: string
  onDocumentPublished?: (
    documentPath: FoundationDocumentPath,
  ) => Promise<void> | void
}): Promise<FoundationRevisionPublishResult> {
  const prepared = await readPreparedAuthority(
    input.workspacePath,
    input.revision,
  )
  return recoverPreparedAuthority({
    workspacePath: input.workspacePath,
    prepared,
    onDocumentPublished: input.onDocumentPublished,
  })
}

export const publishPreparedFoundationRevision = publishFoundationRevision
export const recoverPreparedFoundationRevision = recoverFoundationRevision
