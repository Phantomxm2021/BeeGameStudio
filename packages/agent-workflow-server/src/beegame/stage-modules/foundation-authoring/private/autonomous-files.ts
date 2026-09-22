import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { authorDigest, type AuthorDocumentsResult, type AuthorStartInput } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'
import { canonicalizeAuthoredDocument } from './domain/authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './domain/revision'
import { readConfirmedReferenceFiles } from '../../../confirmed-reference-files'

export const autonomousDocumentLimit = 2 * 1024 * 1024
export const authorBytesDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export type AuthorBaseline = Record<FoundationDocumentPath, string | null>
export const authorBaselineSchema = z.record(z.enum(CANONICAL_FOUNDATION_DOCUMENTS), z.string().regex(/^[a-f0-9]{64}$/).nullable())
export const autonomousAuthorReadOnlyPaths = Object.freeze(['requirements.md', '.beegame-attachments'])
export const autonomousPreparedSchema = z.strictObject({
  version: z.literal('autonomous-author-bundle.v1'),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.string().datetime({ offset: true }),
  baseline: authorBaselineSchema,
  documents: z.array(z.strictObject({ path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS), content: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive() })).length(8),
  receiptSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type AutonomousPrepared = z.infer<typeof autonomousPreparedSchema>

async function ensureRealDirectory(path: string): Promise<void> {
  // Validate existing ancestors before creating anything: recursive mkdir can
  // otherwise create directories beyond a symlink before the post-check fails.
  try { await lstat(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await ensureRealDirectory(dirname(path))
    try { await mkdir(path, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  if (await realpath(path) !== resolve(path)) throw new Error('Author directory contains a symbolic link')
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Author directory is not a real directory')
}

/** Never follow links, including parent-directory links and hard-linked files. */
export async function readAutonomousFile(root: string, path: string, optional = false): Promise<Buffer | undefined> {
  if (![...CANONICAL_FOUNDATION_DOCUMENTS, ...autonomousAuthorReadOnlyPaths].includes(path)) throw new Error('Author file is outside the document boundary')
  const target = join(root, path)
  try {
    if (await realpath(dirname(target)) !== dirname(target)) throw new Error('Author file parent contains a symbolic link')
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > autonomousDocumentLimit) throw new Error('Author file is not a bounded regular file')
      const bytes = await file.readFile()
      if (bytes.byteLength !== info.size || bytes.byteLength > autonomousDocumentLimit) throw new Error('Author file changed while reading')
      return bytes
    } finally { await file.close() }
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function captureAuthorBaseline(workspacePath: string): Promise<AuthorBaseline> {
  const baseline = {} as AuthorBaseline
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const bytes = await readAutonomousFile(workspacePath, path, true)
    baseline[path] = bytes === undefined ? null : authorBytesDigest(bytes)
  }
  return baseline
}

export async function initializeAutonomousFiles(input: {
  candidatePath: string; workspacePath: string; start: AuthorStartInput; baseline: AuthorBaseline
}): Promise<void> {
  await ensureRealDirectory(input.candidatePath)
  await ensureRealDirectory(join(input.candidatePath, 'docs'))
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const bytes = await readAutonomousFile(input.workspacePath, path, true)
    if ((bytes === undefined ? null : authorBytesDigest(bytes)) !== input.baseline[path]) throw new Error('Author input changed before candidate preparation')
    if (bytes !== undefined) await writeOnce(join(input.candidatePath, path), bytes)
  }
  const requirements = input.start.input.confirmedBrief + (input.start.input.changeRequest
    ? `\n\nAdditional confirmed change request:\n${input.start.input.changeRequest}` : '')
  await writeOnce(join(input.candidatePath, 'requirements.md'), Buffer.from(requirements))
  const references = await readConfirmedReferenceFiles(input.workspacePath, input.start.input.confirmedBrief)
  if (references.length) await ensureRealDirectory(join(input.candidatePath, '.beegame-attachments'))
  for (const reference of references) await writeOnce(join(input.candidatePath, reference.path), reference.bytes)
}

export async function validateAutonomousEvidence(candidatePath: string, start: AuthorStartInput): Promise<void> {
  const expected = start.input.confirmedBrief + (start.input.changeRequest ? `\n\nAdditional confirmed change request:\n${start.input.changeRequest}` : '')
  if ((await readAutonomousFile(candidatePath, 'requirements.md'))!.toString('utf8') !== expected)
    throw new Error('Author read-only input was changed')
}

export async function captureAutonomousDocuments(input: {
  candidatePath: string; start: AuthorStartInput; baseline: AuthorBaseline; updatedAt: string
}): Promise<AutonomousPrepared> {
  await validateAutonomousEvidence(input.candidatePath, input.start)
  const documents = []
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const bytes = (await readAutonomousFile(input.candidatePath, path))!
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const content = canonicalizeAuthoredDocument(path, markdown, input.updatedAt)
    // Structural transport admission only. No semantic scoring or host repair.
    if (Buffer.byteLength(content) > autonomousDocumentLimit) throw new Error('Author document exceeds artifact size limit')
    documents.push({ path, content, digest: authorBytesDigest(content), byteLength: Buffer.byteLength(content) })
  }
  const value = { version: 'autonomous-author-bundle.v1' as const, inputDigest: input.start.inputDigest,
    updatedAt: input.updatedAt, baseline: { ...input.baseline }, documents }
  return validateAutonomousPrepared({ ...value, receiptSetDigest: authorDigest(value) })
}

export function validateAutonomousPrepared(value: unknown): AutonomousPrepared {
  const parsed = autonomousPreparedSchema.parse(value)
  const { receiptSetDigest, ...body } = parsed
  if (authorDigest(body) !== receiptSetDigest || Object.keys(parsed.baseline).sort().join() !== [...CANONICAL_FOUNDATION_DOCUMENTS].sort().join() ||
      parsed.documents.some((doc, index) => doc.path !== CANONICAL_FOUNDATION_DOCUMENTS[index] ||
        authorBytesDigest(doc.content) !== doc.digest || Buffer.byteLength(doc.content) !== doc.byteLength || doc.byteLength > autonomousDocumentLimit))
    throw new Error('Author prepared bundle binding mismatch')
  return parsed
}

/** The prepared package is durable before any canonical write. A recovery may
 * finish only these exact bytes; mixed old/new preimages are never accepted as
 * a new model result. Public completion is written after all eight files. */
export async function publishAutonomousDocuments(input: {
  workspacePath: string; start: AuthorStartInput; prepared: AutonomousPrepared
}, hooks?: { afterCanonicalWrite?(index: number): Promise<void> }): Promise<AuthorDocumentsResult> {
  const prepared = validateAutonomousPrepared(input.prepared)
  if (prepared.inputDigest !== input.start.inputDigest) throw new Error('Author prepared bundle has another input')
  const workspace = await realpath(input.workspacePath)
  const resultId = authorDigest({ producer: 'foundation-authoring', inputDigest: input.start.inputDigest, receiptSetDigest: prepared.receiptSetDigest })
  // Validate every preimage before writing any file. Equal final bytes permit
  // an interrupted publication to resume without overwriting unrelated edits.
  for (const doc of prepared.documents) {
    const bytes = await readAutonomousFile(workspace, doc.path, true)
    const digest = bytes === undefined ? null : authorBytesDigest(bytes)
    if (digest !== prepared.baseline[doc.path] && digest !== doc.digest) throw new Error('Author publication conflicts with edited project documents')
  }
  const documents = []
  for (const doc of prepared.documents) {
    const artifactPath = `.beegame/workflow/foundation-authoring/artifacts/${resultId}/${doc.path}`
    await writeOnce(join(workspace, artifactPath), Buffer.from(doc.content))
    documents.push({ path: doc.path, digest: doc.digest, byteLength: doc.byteLength, artifactPath })
  }
  await ensureRealDirectory(join(workspace, 'docs'))
  for (const [index, doc] of prepared.documents.entries()) {
    const bytes = await readAutonomousFile(workspace, doc.path, true)
    const digest = bytes === undefined ? null : authorBytesDigest(bytes)
    if (digest !== doc.digest) {
      if (digest !== prepared.baseline[doc.path]) throw new Error('Author publication preimage changed')
      await atomicWrite(join(workspace, doc.path), Buffer.from(doc.content))
    }
    await hooks?.afterCanonicalWrite?.(index)
  }
  for (const doc of prepared.documents)
    if (authorBytesDigest((await readAutonomousFile(workspace, doc.path))!) !== doc.digest) throw new Error('Author document changed during publication')
  return { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents',
    resultId, inputDigest: input.start.inputDigest, ownerId: input.start.ownerId, projectId: input.start.projectId,
    confirmedBriefDigest: input.start.input.confirmedBriefDigest, documents,
    receiptSetDigest: prepared.receiptSetDigest,
    documentRevision: await computeDocumentRevision(workspace, input.start.input.confirmedBriefDigest),
    workspaceRevision: await computeWorkspaceRevision(workspace) }
}

export async function validateAutonomousResult(workspacePath: string, start: AuthorStartInput, prepared: AutonomousPrepared,
  result: AuthorDocumentsResult): Promise<void> {
  validateAutonomousPrepared(prepared)
  if (result.protocolVersion !== 1 || result.producer !== 'foundation-authoring' || result.kind !== 'foundation_documents' ||
      result.inputDigest !== start.inputDigest || result.ownerId !== start.ownerId || result.projectId !== start.projectId ||
      result.confirmedBriefDigest !== start.input.confirmedBriefDigest || result.receiptSetDigest !== prepared.receiptSetDigest ||
      result.resultId !== authorDigest({ producer: 'foundation-authoring', inputDigest: start.inputDigest, receiptSetDigest: prepared.receiptSetDigest }) ||
      !/^[a-f0-9]{64}$/.test(result.documentRevision) || !/^[a-f0-9]{64}$/.test(result.workspaceRevision) || result.documents.length !== 8)
    throw new Error('Author result binding mismatch')
  for (const [index, doc] of prepared.documents.entries()) {
    const expected = { path: doc.path, digest: doc.digest, byteLength: doc.byteLength,
      artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${result.resultId}/${doc.path}` }
    if (authorDigest(result.documents[index]) !== authorDigest(expected)) throw new Error('Author artifact descriptor mismatch')
    const path = join(workspacePath, expected.artifactPath)
    if (await realpath(dirname(path)) !== dirname(path)) throw new Error('Author artifact parent contains a link')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== expected.byteLength || stat.size > autonomousDocumentLimit)
        throw new Error('Author immutable artifact changed')
      const bytes = await file.readFile()
      if (bytes.byteLength !== expected.byteLength || authorBytesDigest(bytes) !== expected.digest)
        throw new Error('Author immutable artifact changed')
    } finally { await file.close() }
  }
}

async function writeOnce(path: string, bytes: Buffer): Promise<void> {
  await ensureRealDirectory(dirname(path))
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeSynced(temporary, bytes)
    try { await link(temporary, path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !(await readFile(path)).equals(bytes)) throw new Error('Author immutable file collision')
    }
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  await syncDirectory(dirname(path))
}
async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  await ensureRealDirectory(dirname(path))
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeSynced(temporary, bytes); await rename(temporary, path); await syncDirectory(dirname(path)) }
  finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
}
async function writeSynced(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}
async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, 'r')
  try { await file.sync() } finally { await file.close() }
}
