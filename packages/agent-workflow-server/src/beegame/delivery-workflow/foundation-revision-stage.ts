import { createHash } from 'node:crypto'
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { normalizeServiceOwnedDocumentMetadata } from '../authored-document-receipt'
import { getGameDocumentContract } from './game-document-contracts'
import {
  buildFoundationSectionIndex,
  canonicalFoundationBlockIds,
} from './foundation-section-index'
import type { RevisionBatch } from './foundation-revision-batches'
import type { AuditIssue } from './foundation-issue-registry'
import { foundationFactPacketDigest, type FoundationFactPacket } from './foundation-fact-extraction'
import { FOUNDATION_FACT_CATALOG } from './foundation-fact-definitions'
import { digestFoundationSemanticRecheckResult, type FoundationSemanticRecheckResult } from './foundation-patch-validation'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationRevisionRound,
  type FoundationRevisionDocumentTask,
  type FoundationDocumentPath,
} from './types'

export type RevisionTaskReceipt = {
  taskId: string
  round: FoundationRevisionRound
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

export type FoundationRevisionStage = {
  revision: string
  documentPath: FoundationDocumentPath
  baseDocumentDigest: string
  stagedDocumentDigest: string
  stagedPath: string
}

export type FoundationRevisionSectionSlice = {
  documentPath: FoundationDocumentPath
  sectionId: string
  heading: string
  startLine: number
  endLine: number
  digest: string
  text: string
}

export type FoundationRevisionAuthority = {
  baseDocumentDigest: string
  stagedPath: string
  packetPath: string
  packet: Record<string, unknown>
  packetDigest: string
}

export function foundationRevisionDocumentReceiptMatches(task: FoundationRevisionDocumentTask): boolean {
  const receipt = task.receipt
  return task.status === 'completed' && !!receipt && !!task.terminalDigest &&
    receipt.taskId === task.taskId &&
    receipt.round === task.round &&
    receipt.documentPath === task.documentPath &&
    JSON.stringify(receipt.issueIds) === JSON.stringify(task.issueIds) &&
    receipt.baseDocumentDigest === task.baseDocumentDigest &&
    receipt.stagedPath === task.stagedPath &&
    receipt.terminalDigest === task.terminalDigest
}

export function foundationRevisionTasksComplete(tasks: readonly import('./types').FoundationRevisionTask[]): boolean {
  return tasks.length > 0 && tasks.every(task => task.kind === 'document-revision' && foundationRevisionDocumentReceiptMatches(task))
}

type RevisionTaskReceiptCore = {
  taskId: string
  round: FoundationRevisionRound
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

function assertTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(taskId))
    throw new Error('foundation revision task is not a safe project-local identifier')
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

export function foundationRevisionPacketDigest(packet: Record<string, unknown>): string {
  return sha256(stableJson(packet))
}

export function foundationRevisionPacketPath(
  revision: string,
  round: FoundationRevisionRound,
  taskId: string,
): string {
  assertRevision(revision)
  if (!Number.isSafeInteger(round) || round < 1)
    throw new Error('foundation revision round must be a positive safe integer')
  assertTaskId(taskId)
  return `.beegame/audit/foundation/${revision}/round-${round}/tasks/${taskId}/packet.json`
}

export async function writeFoundationRevisionPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  documentPath: FoundationDocumentPath
  packet: Record<string, unknown>
  packetDigest: string
}): Promise<string> {
  if (foundationRevisionPacketDigest(input.packet) !== input.packetDigest)
    throw new Error('foundation revision packet digest does not match body')
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const absolute = resolveProjectPath(input.workspacePath, packetPath)
  await mkdir(resolve(absolute, '..'), { recursive: true })
  try {
    const existing = JSON.parse(await readFile(absolute, 'utf8')) as Record<string, unknown>
    if (foundationRevisionPacketDigest(existing) !== input.packetDigest)
      throw new Error('foundation revision packet artifact already exists with a different digest')
    return packetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(input.packet), { encoding: 'utf8', flag: 'wx' })
  try {
    await link(temporary, absolute)
    await unlink(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await unlink(temporary).catch(() => undefined)
    const existing = JSON.parse(await readFile(absolute, 'utf8')) as Record<string, unknown>
    if (foundationRevisionPacketDigest(existing) !== input.packetDigest)
      throw new Error('foundation revision packet artifact already exists with a different digest')
  }
  return packetPath
}

export async function loadFoundationRevisionPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  documentPath: FoundationDocumentPath
  packetDigest: string
}): Promise<Record<string, unknown>> {
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const absolute = resolveProjectPath(input.workspacePath, packetPath)
  const packet = JSON.parse(await readFile(absolute, 'utf8')) as unknown
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    throw new Error('foundation revision packet artifact is malformed')
  const value = packet as Record<string, unknown>
  if (foundationRevisionPacketDigest(value) !== input.packetDigest)
    throw new Error('foundation revision packet artifact digest is stale')
  if (value.revision !== input.revision || value.round !== input.round || value.taskId !== input.taskId || value.documentPath !== input.documentPath)
    throw new Error('foundation revision packet artifact identity is stale')
  return value
}

/** Persist a fact packet as its own immutable artifact.  The packet's native
 * packetDigest is the only identity; revision tasks merely point at it. */
export async function writeFoundationRevisionFactPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  packet: FoundationFactPacket
}): Promise<string> {
  if (input.packet.revision !== input.revision)
    throw new Error('foundation fact packet revision is stale')
  const identity = { revision: input.packet.revision, keys: [...input.packet.keys].sort(), sections: input.packet.sections }
  if (foundationFactPacketDigest(identity) !== input.packet.packetDigest)
    throw new Error('foundation fact packet digest is invalid')
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const absolute = resolveProjectPath(input.workspacePath, packetPath)
  await mkdir(resolve(absolute, '..'), { recursive: true })
  const content = `${JSON.stringify(input.packet)}\n`
  try {
    if ((await readFile(absolute, 'utf8')) !== content)
      throw new Error('foundation fact packet artifact already exists with a different digest')
    return packetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await link(temporary, absolute)
    await unlink(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await unlink(temporary).catch(() => undefined)
    if ((await readFile(absolute, 'utf8')) !== content)
      throw new Error('foundation fact packet artifact already exists with a different digest')
  }
  return packetPath
}

export async function loadFoundationRevisionFactPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  packetDigest: string
}): Promise<FoundationFactPacket> {
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const value = JSON.parse(await readFile(resolveProjectPath(input.workspacePath, packetPath), 'utf8')) as FoundationFactPacket
  if (!value || value.revision !== input.revision || value.packetDigest !== input.packetDigest)
    throw new Error('foundation fact packet artifact identity is stale')
  const identity = { revision: value.revision, keys: [...value.keys].sort(), sections: value.sections }
  if (foundationFactPacketDigest(identity) !== input.packetDigest)
    throw new Error('foundation fact packet artifact digest is stale')
  return value
}

/** Persist a targeted semantic packet using its native packetDigest as the
 * sole artifact identity.  The revision task owns only the derived path. */
export async function writeFoundationRevisionSemanticPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  packet: { packetDigest: string }
}): Promise<string> {
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const absolute = resolveProjectPath(input.workspacePath, packetPath)
  await mkdir(resolve(absolute, '..'), { recursive: true })
  const content = `${JSON.stringify(input.packet)}\n`
  try {
    if ((await readFile(absolute, 'utf8')) !== content)
      throw new Error('foundation semantic packet artifact already exists with a different digest')
    return packetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await link(temporary, absolute)
    await unlink(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await unlink(temporary).catch(() => undefined)
    if ((await readFile(absolute, 'utf8')) !== content)
      throw new Error('foundation semantic packet artifact already exists with a different digest')
  }
  return packetPath
}

export async function loadFoundationRevisionSemanticPacket(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  packetDigest: string
}): Promise<Record<string, unknown>> {
  const packetPath = foundationRevisionPacketPath(input.revision, input.round, input.taskId)
  const value = JSON.parse(await readFile(resolveProjectPath(input.workspacePath, packetPath), 'utf8')) as Record<string, unknown>
  if (!value || value.packetDigest !== input.packetDigest || typeof value.issueId !== 'string') throw new Error('foundation semantic packet artifact identity is stale')
  return value
}

export function foundationRevisionSemanticResultPath(revision: string, round: FoundationRevisionRound, taskId: string): string {
  return `${foundationRevisionPacketPath(revision, round, taskId).replace(/packet\.json$/, '')}result.json`
}

function assertSemanticResultIdentity(input: {
  revision: string
  round: FoundationRevisionRound
  taskId: string
  issueId: string
  packetDigest: string
  result: FoundationSemanticRecheckResult
  resultDigest: string
  resultPath?: string
}): string {
  const expectedPath = foundationRevisionSemanticResultPath(input.revision, input.round, input.taskId)
  if (input.resultPath !== undefined && input.resultPath !== expectedPath) throw new Error('foundation semantic result path is stale')
  const hasDiagnostic = input.result.status === 'FAIL'
  const expectedKeys = [
    'issueId',
    'packetDigest',
    'status',
    'taskId',
    ...(hasDiagnostic ? ['diagnostic'] : []),
  ]
  const actualKeys = Object.keys(input.result).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys.slice().sort()[index])) throw new Error('foundation semantic result shape is invalid')
  if (input.result.issueId !== input.issueId || input.result.packetDigest !== input.packetDigest) throw new Error('foundation semantic result identity is stale')
  if (input.result.taskId !== input.taskId) throw new Error('foundation semantic result task identity is stale')
  if (input.result.status !== 'PASS' && input.result.status !== 'FAIL') throw new Error('foundation semantic result status is invalid')
  if (input.result.status === 'FAIL' && !hasDiagnostic) throw new Error('foundation semantic FAIL requires a structured diagnostic before digest validation')
  if (input.result.status === 'PASS' && hasDiagnostic) throw new Error('foundation semantic PASS cannot contain a diagnostic')
  if (input.result.status === 'FAIL') {
    const diagnostic = input.result.diagnostic
    const diagnosticKeys = Object.keys(diagnostic).sort()
    if (JSON.stringify(diagnosticKeys) !== JSON.stringify(['dependencySections', 'evidence', 'failureReasonCode', 'observedActual', 'scopeAssessment', 'unmetExpected'])) throw new Error('foundation semantic diagnostic shape is invalid')
    if (!diagnostic.unmetExpected.trim() || !diagnostic.observedActual.trim()) throw new Error('foundation semantic diagnostic text is invalid')
    if (!['expected_not_met', 'actual_persists', 'contradictory_evidence', 'evidence_insufficient'].includes(diagnostic.failureReasonCode)) throw new Error('foundation semantic diagnostic failureReasonCode is invalid')
    if (diagnostic.scopeAssessment !== 'repairable_in_scope') throw new Error('foundation semantic diagnostic scopeAssessment is invalid')
    const assertSections = (sections: readonly unknown[], label: string): void => {
      if (!Array.isArray(sections) || sections.length === 0) throw new Error(`foundation semantic diagnostic ${label} is required`)
      const seen = new Set<string>()
      for (const raw of sections) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`foundation semantic diagnostic ${label} is invalid`)
        const section = raw as Record<string, unknown>
        if (JSON.stringify(Object.keys(section).sort()) !== JSON.stringify(['digest', 'documentPath', 'endLine', 'heading', 'sectionId', 'startLine'])) throw new Error(`foundation semantic diagnostic ${label} shape is invalid`)
        assertCanonicalDocument(String(section.documentPath))
        if (typeof section.sectionId !== 'string' || !section.sectionId || typeof section.heading !== 'string' || !section.heading || typeof section.startLine !== 'number' || !Number.isInteger(section.startLine) || typeof section.endLine !== 'number' || !Number.isInteger(section.endLine) || section.startLine < 1 || section.endLine < section.startLine || typeof section.digest !== 'string' || !DIGEST.test(section.digest)) throw new Error(`foundation semantic diagnostic ${label} reference is invalid`)
        const identity = `${section.documentPath}\0${section.sectionId}`
        if (seen.has(identity)) throw new Error(`foundation semantic diagnostic ${label} contains duplicates`)
        seen.add(identity)
      }
    }
    assertSections(diagnostic.evidence, 'evidence')
    assertSections(diagnostic.dependencySections, 'dependencySections')
  }
  if (digestFoundationSemanticRecheckResult(input.result) !== input.resultDigest) throw new Error('foundation semantic result digest is stale')
  return expectedPath
}

export async function writeFoundationRevisionSemanticResult(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  issueId: string
  packetDigest: string
  result: FoundationSemanticRecheckResult
  resultDigest: string
}): Promise<string> {
  const resultPath = assertSemanticResultIdentity(input)
  const absolute = resolveProjectPath(input.workspacePath, resultPath)
  await mkdir(resolve(absolute, '..'), { recursive: true })
  const content = JSON.stringify(input.result)
  try {
    if ((await readFile(absolute, 'utf8')) !== content) throw new Error('foundation semantic result artifact already exists with a different digest')
    return resultPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await link(temporary, absolute)
    await unlink(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    await unlink(temporary).catch(() => undefined)
    if ((await readFile(absolute, 'utf8')) !== content) throw new Error('foundation semantic result artifact already exists with a different digest')
  }
  return resultPath
}

export async function loadFoundationRevisionSemanticResult(input: {
  workspacePath: string
  revision: string
  round: FoundationRevisionRound
  taskId: string
  issueId: string
  packetDigest: string
  resultDigest: string
  resultPath: string
}): Promise<FoundationSemanticRecheckResult> {
  const expectedPath = foundationRevisionSemanticResultPath(input.revision, input.round, input.taskId)
  if (input.resultPath !== expectedPath) throw new Error('foundation semantic result path is stale')
  let result: FoundationSemanticRecheckResult
  try {
    result = JSON.parse(await readFile(resolveProjectPath(input.workspacePath, input.resultPath), 'utf8')) as FoundationSemanticRecheckResult
  } catch {
    throw new Error('foundation semantic result artifact digest is stale')
  }
  assertSemanticResultIdentity({ ...input, result, resultPath: input.resultPath })
  return result
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
  expectedBaseDocumentDigest?: string
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
  if (input.expectedBaseDocumentDigest && input.expectedBaseDocumentDigest !== baseDocumentDigest)
    throw new Error('foundation revision canonical document has a stale base digest')
  await mkdir(resolve(stagedAbsolute, '..'), { recursive: true })
  try {
    const existing = await readFile(stagedAbsolute)
    if (sha256(existing) !== baseDocumentDigest)
      throw new Error(
        'existing foundation revision stage does not match its canonical base',
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

/** Reset a retryable task's isolated stage to the current canonical base. */
export async function resetFoundationRevisionStage(input: {
  workspacePath: string
  revision: string
  documentPath: FoundationDocumentPath
  expectedBaseDocumentDigest: string
}): Promise<FoundationRevisionStage> {
  assertRevision(input.revision)
  assertCanonicalDocument(input.documentPath)
  const canonicalPath = resolveProjectPath(input.workspacePath, input.documentPath)
  const stagedPath = foundationRevisionStagePath(input.revision, input.documentPath)
  const stagedAbsolute = resolveProjectPath(input.workspacePath, stagedPath)
  const baseBytes = await readFile(canonicalPath)
  const baseDocumentDigest = sha256(baseBytes)
  if (baseDocumentDigest !== input.expectedBaseDocumentDigest)
    throw new Error('foundation revision canonical document has a stale base digest')
  await mkdir(resolve(stagedAbsolute, '..'), { recursive: true })
  const temporary = `${stagedAbsolute}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, baseBytes, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, stagedAbsolute).catch(error => {
    void unlink(temporary).catch(() => undefined)
    throw error
  })
  return {
    revision: input.revision,
    documentPath: input.documentPath,
    baseDocumentDigest,
    stagedDocumentDigest: baseDocumentDigest,
    stagedPath,
  }
}

function sectionSlices(
  documentPath: FoundationDocumentPath,
  markdown: string,
): FoundationRevisionSectionSlice[] {
  const index = buildFoundationSectionIndex({ documents: { [documentPath]: markdown } })
  const lines = markdown.split('\n')
  return index.map(section => ({
    ...section,
    text: lines.slice(section.startLine - 1, section.endLine).join('\n'),
  }))
}

export async function buildFoundationRevisionAuthority(input: {
  workspacePath: string
  revision: string
  taskId: string
  round: FoundationRevisionRound
  batch: RevisionBatch
  issues: readonly AuditIssue[]
  sourceAuthorityDigest: string
  sourceIssueRegistryDigest: string
  sourceDerivedDigests: { sectionIndex: string; factStore: string; manifest: string }
  sourceDocumentDigests: readonly { path: FoundationDocumentPath; digest: string }[]
  normalizedFacts: readonly unknown[]
  candidateDocuments?: ReadonlyMap<FoundationDocumentPath, string>
}): Promise<FoundationRevisionAuthority> {
  assertRevision(input.revision)
  assertBatch(input.batch)
  const canonicalPath = resolveProjectPath(input.workspacePath, input.batch.documentPath)
  const canonicalMarkdown = (await readFile(canonicalPath)).toString('utf8')
  const markdown = input.candidateDocuments?.get(input.batch.documentPath) ?? canonicalMarkdown
  const baseDocumentDigest = sha256(canonicalMarkdown)
  const requiredSectionIds = new Set<string>(input.batch.sectionIds)
  const issueRefs = new Set<string>()
  const evidenceDocumentPaths = new Set<FoundationDocumentPath>([
    input.batch.documentPath,
  ])
  for (const issue of input.issues) {
    issueRefs.add(`${issue.source.documentPath}\0${issue.source.sectionId}`)
    evidenceDocumentPaths.add(issue.source.documentPath)
    if (issue.target) {
      issueRefs.add(`${issue.target.documentPath}\0${issue.target.sectionId}`)
      evidenceDocumentPaths.add(issue.target.documentPath)
    }
    const remediation = issue.remediation
    if (remediation.kind === 'patch') {
      evidenceDocumentPaths.add(remediation.documentPath)
      for (const sectionId of remediation.sectionIds)
        issueRefs.add(`${remediation.documentPath}\0${sectionId}`)
    }
  }
  const evidenceDocuments = await Promise.all(
    [...evidenceDocumentPaths].map(async documentPath => [
      documentPath,
      input.candidateDocuments?.get(documentPath) ??
        (documentPath === input.batch.documentPath
          ? markdown
          : (await readFile(resolveProjectPath(input.workspacePath, documentPath))).toString('utf8')),
    ] as const),
  )
  const slices = evidenceDocuments.flatMap(([documentPath, document]) =>
    sectionSlices(documentPath, document),
  )
  const selectedSections = slices.filter(section =>
    (section.documentPath === input.batch.documentPath &&
      requiredSectionIds.has(section.sectionId)) ||
    issueRefs.has(`${section.documentPath}\0${section.sectionId}`),
  )
  const selectedFacts = input.normalizedFacts.filter(fact => {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false
    const source = (fact as { source?: { documentPath?: string; sectionId?: string } }).source
    return source && issueRefs.has(`${source.documentPath}\0${source.sectionId}`)
  })
  const factConstraints = FOUNDATION_FACT_CATALOG
    .filter(definition =>
      definition.owner.documentPath === input.batch.documentPath &&
      requiredSectionIds.has(definition.owner.sectionId),
    )
    .map(definition => ({
      key: definition.key,
      owner: definition.owner,
      valueType: definition.valueType,
      valueSpec: definition.valueSpec,
      presence: definition.presence,
      extractionInstruction: definition.extractionInstruction,
      sourceOfTruthDirection: definition.sourceOfTruthDirection,
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
  const packet: Record<string, unknown> = {
    schema: 'beegame-foundation-revision-packet-v1',
    revision: input.revision,
    round: input.round,
    taskId: input.taskId,
    documentPath: input.batch.documentPath,
    issueIds: [...input.batch.issueIds],
    sectionIds: [...input.batch.sectionIds],
    // Keep the admitted registry issue as-is. `problem` duplicated `actual`,
    // while `evidenceRefs` duplicated the immutable source/target/fix refs.
    issues: input.issues,
    sections: selectedSections,
    normalizedFacts: selectedFacts,
    factConstraints,
    immutableDigests: {
      sourceAuthorityDigest: input.sourceAuthorityDigest,
      sourceIssueRegistryDigest: input.sourceIssueRegistryDigest,
      sourceDerivedDigests: input.sourceDerivedDigests,
      sourceDocumentDigests: input.sourceDocumentDigests,
      baseDocumentDigest,
    },
  }
  return {
    baseDocumentDigest,
    stagedPath: foundationRevisionStagePath(input.revision, input.batch.documentPath),
    packetPath: foundationRevisionPacketPath(input.revision, input.round, input.taskId),
    packet,
    packetDigest: foundationRevisionPacketDigest(packet),
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

function comparePatchOperations(left: PatchOperation, right: PatchOperation): number {
  const document = left.documentPath.localeCompare(right.documentPath)
  if (document !== 0) return document
  const section = left.sectionId.localeCompare(right.sectionId)
  if (section !== 0) return section
  return stableJson(left).localeCompare(stableJson(right))
}

/** The mechanical, order-independent digest of validated patch operations. */
export function foundationPatchOperationsDigest(
  operations: readonly PatchOperation[],
): string {
  if (!Array.isArray(operations))
    throw new Error('foundation patch operations must be an array')
  return sha256(stableJson([...operations].sort(comparePatchOperations)))
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
  if (typeof value.round !== 'number' || !Number.isSafeInteger(value.round) || value.round < 1)
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
  const known = new Set(canonicalFoundationBlockIds(batch.documentPath))
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
  const contractSections = new Set(canonicalFoundationBlockIds(batch.documentPath))
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
    if (issue.remediation.kind !== 'patch' || issue.remediation.documentPath !== batch.documentPath)
      throw new Error('revision issue fix document is outside the batch')
    for (const sectionId of issue.remediation.sectionIds)
      if (!contractSections.has(sectionId) || !batch.sectionIds.includes(sectionId))
        throw new Error('revision issue fix section is outside the batch')
    seen.add(issue.id)
    for (const sectionId of issue.remediation.sectionIds) {
      const sectionIssues = grouped.get(sectionId) ?? []
      sectionIssues.push(issue.id)
      grouped.set(sectionId, sectionIssues)
    }
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
    return normalizeServiceOwnedDocumentMetadata(chunks.join('\n'))
  }
  const allowed = new Set(input.batch.sectionIds)
  if (
    outside(baseBytes.toString('utf8'), allowed) !==
    outside(stagedBytes.toString('utf8'), allowed)
  )
    throw new Error('revision changed bytes outside authorized sections')

  const contractOrder = new Map(
    canonicalFoundationBlockIds(input.batch.documentPath).map(
      (sectionId, index) => [sectionId, index],
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
  for (const issue of input.issues) {
    if (issue.remediation.kind !== 'patch' || issue.remediation.sectionIds.every(sectionId => !changedIds.includes(sectionId)))
      throw new Error('revision admitted issue target was not changed')
  }
  const boundIssueIds = [...new Set(operations.flatMap(operation => operation.issueIds))]
  const expectedIssueIds = [...input.batch.issueIds].sort(compareStable)
  const actualIssueIds = [...boundIssueIds].sort(compareStable)
  if (
    actualIssueIds.length !== expectedIssueIds.length ||
    actualIssueIds.some((id, index) => id !== expectedIssueIds[index])
  )
    throw new Error('revision issue coverage is not exact')
  return operations
}
