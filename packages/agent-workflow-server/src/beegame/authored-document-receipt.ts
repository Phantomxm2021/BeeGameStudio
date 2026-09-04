import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  parseFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
} from './foundation-authority-projection'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'
import { appendDocumentReceiptObservation } from './runtime-observability'
import { injectFoundationProtocolMarkers } from './foundation-protocol-markers'

const authoredDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(5),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    finalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().positive(),
    documentId: z.string().min(1),
    version: z.literal('1.0.0'),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['package_prepared', 'committed']),
  })
  .strict()

export type AuthoredDocumentReceipt = {
  schemaVersion: 5
  dispatchId: string
  targetPath: string
  finalDigest: string
  byteLength: number
  documentId: string
  version: '1.0.0'
  updatedAt: string
  status: 'package_prepared' | 'committed'
}

/**
 * Record the result of a complete Markdown file written through Bee Game
 * Studio's native file tools. The authored body is the only human document
 * authority; this function only enforces the authoring transport boundary,
 * injects deterministic service-owned metadata, and commits the resulting
 * bytes. Document format and quality belong to Review and Revision.
 */
export async function commitAuthoredFoundationDocument(input: {
  workspacePath: string
  dispatchId: string
  targetPath: FoundationDocumentPath
  updatedAt?: string
  authoredBody?: string
  expectedOriginalDigest?: string | null
}): Promise<AuthoredDocumentReceipt> {
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[input.targetPath]
  const existing = await readAuthoredDocumentReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (existing?.status === 'committed') {
    if (
      existing.targetPath !== input.targetPath ||
      existing.documentId !== documentId
    )
      throw new Error('authored document receipt does not match dispatch')
    return existing
  }
  if (existing)
    throw new Error('authored document receipt is not safely replayable')

  const target = resolve(input.workspacePath, input.targetPath)
  if (input.expectedOriginalDigest !== undefined) {
    const current = await readOptionalFile(target)
    const currentDigest = current === undefined ? null : digest(current)
    if (currentDigest !== input.expectedOriginalDigest)
      throw new Error('authored document target changed during generation')
  }
  const authored = input.authoredBody ?? await readFile(target, 'utf8')
  const updatedAt = input.updatedAt ?? new Date().toISOString()
  z.string().datetime({ offset: true }).parse(updatedAt)
  const canonical = canonicalizeAuthoredDocument(
    input.targetPath,
    authored,
    updatedAt,
  )
  await assertCommittedFoundationAuthority({
    workspacePath: input.workspacePath,
    dispatchId: input.dispatchId,
    targetPath: input.targetPath,
  })
  await durableWrite(target, canonical)
  const documentDigest = digest(canonical)
  const prepared: AuthoredDocumentReceipt = {
    schemaVersion: 5,
    dispatchId: input.dispatchId,
    targetPath: input.targetPath,
    finalDigest: documentDigest,
    byteLength: Buffer.byteLength(canonical),
    documentId,
    version: '1.0.0',
    updatedAt,
    status: 'package_prepared',
  }
  await syncFile(target)
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(prepared, null, 2)}\n`,
  )
  const committed: AuthoredDocumentReceipt = {
    ...prepared,
    status: 'committed',
  }
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  await appendDocumentReceiptObservation({
    workspacePath: input.workspacePath,
    sessionId: input.dispatchId,
    dispatchId: input.dispatchId,
    targetPath: committed.targetPath,
    digest: committed.finalDigest,
  })
  return committed
}

async function assertCommittedFoundationAuthority(input: {
  workspacePath: string
  dispatchId: string
  targetPath: FoundationDocumentPath
}): Promise<void> {
  const contract = getGameDocumentContract(input.targetPath)
  const projectionPath = resolve(
    input.workspacePath,
    foundationProjectionRelativePath(input.dispatchId),
  )
  const rawProjection = await readFile(projectionPath, 'utf8')
  const expectedPaths = contract.upstreamSections.map(source => source.path)
  const documents = new Map(await Promise.all(
    expectedPaths.map(async path => [
      path,
      await readFile(resolve(input.workspacePath, path), 'utf8'),
    ] as const),
  ))
  const expectedProjection = projectFoundationAuthority({
    targetPath: input.targetPath,
    availableUpstreamPaths: expectedPaths,
    documents,
  })
  if (canonicalFoundationAuthorityProjectionBytes(expectedProjection) !== rawProjection)
    throw new Error(`committed upstream projection does not match current committed authority: ${input.targetPath}`)
  parseFoundationAuthorityProjectionBytes(rawProjection)
}

export async function readAuthoredDocumentReceipt(
  workspacePath: string,
  dispatchId: string,
): Promise<AuthoredDocumentReceipt | undefined> {
  const raw = await readOptionalFile(
    authoredDocumentReceiptPath(workspacePath, dispatchId),
  )
  if (raw === undefined) return undefined
  const parsed = authoredDocumentReceiptSchema.parse(
    JSON.parse(raw),
  ) as AuthoredDocumentReceipt
  if (parsed.dispatchId !== dispatchId)
    throw new Error('authored document receipt is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      parsed.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== parsed.documentId
  )
    throw new Error('authored document receipt identity is invalid')
  return parsed
}

/**
 * Commit only the service-owned metadata of an accepted remediation. The
 * document author owns the Markdown body; BGS owns version and updated_at.
 */
export async function commitRemediatedDocumentMetadata(input: {
  workspacePath: string
  targetPath: string
  previousVersion: string
  previousUpdatedAt: string
  updatedAt?: string
}): Promise<void> {
  const previousParts = input.previousVersion.split('.').map(Number)
  if (
    previousParts.length !== 3 ||
    previousParts.some((part, index) =>
      !Number.isInteger(part) ||
      part < 0 ||
      String(part) !== input.previousVersion.split('.')[index]
    )
  )
    throw new Error('remediated document previous version is invalid')
  const previousTimestamp = Date.parse(input.previousUpdatedAt)
  if (!Number.isFinite(previousTimestamp))
    throw new Error('remediated document previous updated_at is invalid')
  const updatedAt =
    input.updatedAt ??
    new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString()
  if (
    !Number.isFinite(Date.parse(updatedAt)) ||
    Date.parse(updatedAt) <= previousTimestamp
  )
    throw new Error('remediated document updated_at must advance')

  const target = resolve(input.workspacePath, input.targetPath)
  const workspaceRoot = `${resolve(input.workspacePath)}/`
  if (!target.startsWith(workspaceRoot))
    throw new Error('remediated document path escapes the workspace')
  const lines = (await readFile(target, 'utf8')).split('\n')
  if (lines[0]?.trim() !== '---')
    throw new Error('remediated document front matter is missing')
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1)
    throw new Error('remediated document front matter is invalid')
  let versionCount = 0
  let updatedAtCount = 0
  const nextVersion = `${previousParts[0]}.${previousParts[1]}.${previousParts[2]! + 1}`
  for (let index = 1; index < closingIndex; index += 1) {
    const field = lines[index]!.slice(0, lines[index]!.indexOf(':')).trim()
    if (field === 'version') {
      lines[index] = `version: ${nextVersion}`
      versionCount += 1
    }
    if (field === 'updated_at') {
      lines[index] = `updated_at: ${updatedAt}`
      updatedAtCount += 1
    }
  }
  if (versionCount !== 1 || updatedAtCount !== 1)
    throw new Error('remediated document service metadata is invalid')
  await durableWrite(target, lines.join('\n'))
}

type RemediatedDocumentMetadata = {
  version: string
  updatedAt: string
}

const remediatedUpdatedAtSchema = z.string().datetime({ offset: true })

/**
 * Commit service-owned metadata for a staged foundation revision. The
 * canonical document is the only previous-version authority; an already
 * advanced staged pair is accepted as an idempotent replay.
 */
export async function commitFoundationRevisionDocumentMetadata(input: {
  workspacePath: string
  canonicalPath: FoundationDocumentPath
  stagedPath: string
  expectedCanonicalDigest: string
}): Promise<void> {
  await assertWorkspaceFilePath(input.workspacePath, input.canonicalPath)
  await assertWorkspaceFilePath(input.workspacePath, input.stagedPath)
  const canonical = await readFile(
    resolve(input.workspacePath, input.canonicalPath),
    'utf8',
  )
  if (digest(canonical) !== input.expectedCanonicalDigest)
    throw new Error('remediated document canonical bytes changed during commit')
  const previous = parseRemediatedDocumentMetadata(canonical)
  const stagedAbsolute = resolve(input.workspacePath, input.stagedPath)
  const staged = await readFile(stagedAbsolute, 'utf8')
  const current = parseRemediatedDocumentMetadata(staged)
  const previousParts = parseRemediatedVersion(previous.version)
  const nextVersion = `${previousParts[0]}.${previousParts[1]}.${previousParts[2]! + 1}`
  const expectedUpdatedAt = nextRemediatedUpdatedAt(previous.updatedAt)
  if (
    current.version === nextVersion &&
    current.updatedAt === expectedUpdatedAt
  )
    return
  if (
    current.version !== previous.version ||
    current.updatedAt !== previous.updatedAt
  )
    throw new Error('remediated document staged service metadata is invalid')
  await commitRemediatedDocumentMetadata({
    workspacePath: input.workspacePath,
    targetPath: input.stagedPath,
    previousVersion: previous.version,
    previousUpdatedAt: previous.updatedAt,
    updatedAt: expectedUpdatedAt,
  })
}

/** Validate the exact service-owned metadata transition in final document bytes. */
export function validateFoundationRevisionDocumentMetadataTransition(
  previousMarkdown: string,
  revisedMarkdown: string,
): void {
  const previous = parseRemediatedDocumentMetadata(previousMarkdown)
  const revised = parseRemediatedDocumentMetadata(revisedMarkdown)
  const previousParts = parseRemediatedVersion(previous.version)
  const expectedVersion = `${previousParts[0]}.${previousParts[1]}.${previousParts[2]! + 1}`
  const expectedUpdatedAt = nextRemediatedUpdatedAt(previous.updatedAt)
  if (
    revised.version !== expectedVersion ||
    revised.updatedAt !== expectedUpdatedAt
  )
    throw new Error('remediated document service metadata transition is invalid')
}

function nextRemediatedUpdatedAt(previousUpdatedAt: string): string {
  return new Date(Date.parse(previousUpdatedAt) + 1).toISOString()
}

async function assertWorkspaceFilePath(
  workspacePath: string,
  filePath: string,
): Promise<void> {
  const root = `${await realpath(resolve(workspacePath))}/`
  const candidate = await realpath(resolve(workspacePath, filePath))
  if (!candidate.startsWith(root))
    throw new Error('remediated document path escapes the workspace')
}

export async function reconcileAuthoredDocumentReceipt(input: {
  workspacePath: string
  dispatchId: string
}): Promise<AuthoredDocumentReceipt | undefined> {
  const receipt = await readAuthoredDocumentReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (!receipt) return undefined
  const target = await readOptionalFile(
    resolve(input.workspacePath, receipt.targetPath),
  )
  if (target === undefined || digest(target) !== receipt.finalDigest)
    return undefined
  try {
    if (
      canonicalizeAuthoredDocument(
        receipt.targetPath as FoundationDocumentPath,
        target,
        receipt.updatedAt,
      ) !== target
    )
      return undefined
  } catch {
    return undefined
  }
  if (receipt.status === 'committed') return receipt
  const committed: AuthoredDocumentReceipt = {
    ...receipt,
    status: 'committed',
  }
  await durableWrite(
    authoredDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

function authoredDocumentReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  validateDispatchId(dispatchId)
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
    `${dispatchId}.json`,
  )
}

function validateDispatchId(dispatchId: string): void {
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('authored document dispatch identity is invalid')
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    await syncDirectories([dirname(path)])
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function syncFile(target: string): Promise<void> {
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectories([dirname(target)])
}

async function syncDirectories(paths: readonly string[]): Promise<void> {
  for (const path of [...new Set(paths)].sort()) {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function parseRemediatedVersion(value: string): [number, number, number] {
  const parts = value.split('.').map(Number)
  if (
    parts.length !== 3 ||
    parts.some((part, index) =>
      !Number.isSafeInteger(part) ||
      part < 0 ||
      String(part) !== value.split('.')[index],
    )
  )
    throw new Error('remediated document version is invalid')
  return [parts[0]!, parts[1]!, parts[2]!]
}

function parseRemediatedDocumentMetadata(
  markdown: string,
): RemediatedDocumentMetadata {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---')
    throw new Error('remediated document front matter is missing')
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1)
    throw new Error('remediated document front matter is invalid')
  const values = new Map<string, string>()
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? ''
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const field = line.slice(0, separator).trim()
    if (field !== 'version' && field !== 'updated_at') continue
    if (values.has(field))
      throw new Error('remediated document service metadata is invalid')
    const raw = line.slice(separator + 1).trim()
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    const value = quoted ? raw.slice(1, -1).trim() : raw
    if (!value)
      throw new Error('remediated document service metadata is invalid')
    values.set(field, value)
  }
  const version = values.get('version')
  const updatedAt = values.get('updated_at')
  if (!version || !updatedAt)
    throw new Error('remediated document service metadata is invalid')
  parseRemediatedVersion(version)
  if (!remediatedUpdatedAtSchema.safeParse(updatedAt).success)
    throw new Error('remediated document updated_at is invalid')
  return { version, updatedAt }
}

export function normalizeServiceOwnedDocumentMetadata(markdown: string): string {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return markdown
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1) return markdown
  for (let index = 1; index < closingIndex; index += 1) {
    const separator = lines[index]!.indexOf(':')
    if (separator < 1) continue
    const field = lines[index]!.slice(0, separator).trim()
    if (field === 'version' || field === 'updated_at')
      lines[index] = `${field}: <service-owned>`
  }
  return lines.join('\n')
}

function canonicalizeAuthoredDocument(
  path: FoundationDocumentPath,
  markdown: string,
  updatedAt: string,
): string {
  const expectedDocumentId = CANONICAL_PROJECT_DOCUMENT_IDS[path]
  const lines = markdown.split('\n')
  const closingIndex = lines[0]?.trim() === '---'
    ? lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    : -1
  const authoredBody = closingIndex > 0
    ? lines.slice(closingIndex + 1).join('\n')
    : markdown
  const body = injectFoundationProtocolMarkers(path, authoredBody)
  if (!body.trim()) throw new Error('authored document body is empty')
  return [
    '---',
    `document_id: ${expectedDocumentId}`,
    'version: 1.0.0',
    `updated_at: ${updatedAt}`,
    '---',
    body.trimStart(),
  ].join('\n')
}
