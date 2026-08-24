import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { getGameDocumentContract } from './game-document-contracts'
import { buildFoundationSectionIndex } from './foundation-section-index'
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

/** Derives bounded operations from bytes; it never accepts a worker-supplied patch body. */
export async function deriveFoundationPatchOperations(input: {
  workspacePath: string
  revision: string
  taskId?: string
  batch: RevisionBatch
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
  const operations = changed.map((before, index) => {
    const after = stagedMap.get(before.sectionId)!
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
      issueIds: input.batch.issueIds.filter(
        (_, issueIndex) => issueIndex % changed.length === index,
      ),
      ...(kind === 'INSERT' || kind === 'REPLACE'
        ? { afterDigest: sha256(after.text) }
        : {}),
      ...(kind === 'DELETE' || kind === 'REPLACE'
        ? { beforeDigest: sha256(before.text) }
        : {}),
    } satisfies PatchOperation
  })
  const boundIssueIds = operations.flatMap(operation => operation.issueIds)
  if (
    boundIssueIds.length !== input.batch.issueIds.length ||
    boundIssueIds.some((id, index) => id !== input.batch.issueIds[index])
  )
    throw new Error('revision issue coverage is not exact')
  return operations
}
