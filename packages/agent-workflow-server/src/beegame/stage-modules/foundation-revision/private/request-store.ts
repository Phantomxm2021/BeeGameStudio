import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { lstat, mkdir, open, link, unlink } from 'node:fs/promises'
import { z } from 'zod/v4'
import { prepareRevisionRequest } from './request-preparation'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { constructRevisionCandidate } from './candidate-construction'
import { verifyRevisionCandidateAuthority } from './candidate-authority'
import { bindRevisionDocuments, type RevisionDocumentInput } from './document-snapshot'

const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const relativeRequestsRoot = '.beegame/workflow/foundation-revision/requests'
const relativeHandlesRoot = '.beegame/workflow/foundation-revision/handles'
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
const recordSchema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('foundation-revision'), kind: z.literal('request_accepted'),
  handle: uuid, candidateId: uuid, request: z.unknown(), requestDigest: digest,
}).strict()

export type RevisionAcceptedRequestRecord = z.infer<typeof recordSchema>

async function assertDirectories(path: string): Promise<void> {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const entry = await lstat(cursor)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Revision request parent must be a real directory')
    cursor = dirname(cursor)
  }
}

async function workspaceRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Revision request workspace must be absolute')
  const workspace = resolve(path)
  await assertDirectories(workspace)
  return workspace
}

async function ensureRequestDirectory(workspace: string, root: string): Promise<void> {
  await assertDirectories(workspace)
  let cursor = workspace
  for (const segment of relative(workspace, root).split('/')) {
    cursor = join(cursor, segment)
    try { await mkdir(cursor, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await assertDirectories(cursor)
    // Persist every namespace edge, including when a concurrent creator won.
    // Syncing only the leaf would not make newly created parent names durable.
    const parent = await open(dirname(cursor), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
  }
}

async function readRecord(path: string): Promise<RevisionAcceptedRequestRecord> {
  await assertDirectories(dirname(path))
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_REQUEST_BYTES)
    throw new Error('Revision request record has invalid size or kind')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_REQUEST_BYTES)
      throw new Error('Revision request record has invalid size or kind')
    const body = await file.readFile('utf8')
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES)
      throw new Error('Revision request record has invalid size')
    let value: unknown
    try { value = JSON.parse(body) } catch { throw new Error('Revision request record is not valid JSON') }
    const record = recordSchema.parse(JSON.parse(revisionCanonicalJson(value)))
    if (body !== `${revisionCanonicalJson(record)}\n`)
      throw new Error('Revision request record is not canonical')
    return structuredClone(record)
  } finally { await file.close() }
}

function requestKey(request: { ownerId: string; projectId: string; requestId: string }): string {
  return createHash('sha256').update(revisionCanonicalJson({
    ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId,
  })).digest('hex')
}

function capture(value: unknown) {
  // This is deliberately the first operation in the public function. The
  // request and its complete deterministic plan are admitted before IO.
  const prepared = prepareRevisionRequest(value)
  const requestBytes = Buffer.byteLength(revisionCanonicalJson(prepared.request), 'utf8')
  if (requestBytes > MAX_REQUEST_BYTES) throw new Error('Revision request is too large')
  const requestDigest = revisionDigest(prepared.request)
  if (prepared.requestDigest !== requestDigest) throw new Error('Revision request digest mismatch')
  const key = requestKey(prepared.request)
  const record: RevisionAcceptedRequestRecord = {
    protocolVersion: 1, producer: 'foundation-revision', kind: 'request_accepted',
    handle: randomUUID(), candidateId: randomUUID(), request: structuredClone(prepared.request), requestDigest,
  }
  const recordBytes = Buffer.byteLength(`${revisionCanonicalJson(record)}\n`, 'utf8')
  if (recordBytes > MAX_REQUEST_BYTES) throw new Error('Revision request record is too large')
  return { prepared, record, key }
}

function validateStoredRecord(record: RevisionAcceptedRequestRecord, expected: ReturnType<typeof capture>, key: string) {
  if (requestKey(record.request as { ownerId: string; projectId: string; requestId: string }) !== key ||
    revisionCanonicalJson(record.request) !== revisionCanonicalJson(expected.prepared.request) ||
    record.requestDigest !== revisionDigest(record.request))
    throw new Error('Revision request immutable conflict')
  const prepared = prepareRevisionRequest(record.request)
  if (prepared.requestDigest !== record.requestDigest ||
    revisionCanonicalJson(prepared.request) !== revisionCanonicalJson(record.request))
    throw new Error('Revision request record binding mismatch')
  return { record: structuredClone(record), prepared: structuredClone(prepared) }
}

async function publishRecord(path: string, record: RevisionAcceptedRequestRecord, expected: ReturnType<typeof capture>, key: string) {
  const body = `${revisionCanonicalJson(record)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error('Revision request record is too large')
  await assertDirectories(dirname(path))
  const temporary = join(dirname(path), `.pending-${randomUUID()}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await assertDirectories(dirname(path))
    try {
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const winner = validateStoredRecord(await readRecord(path), expected, key)
      const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
      try { await directory.sync() } finally { await directory.close() }
      return winner
    }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    return { record: structuredClone(record), prepared: structuredClone(expected.prepared) }
  } finally {
    try { await unlink(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function publishHandle(sourcePath: string, path: string, record: RevisionAcceptedRequestRecord,
  expected: ReturnType<typeof capture>, key: string) {
  const canonical = validateStoredRecord(await readRecord(sourcePath), expected, key)
  if (revisionCanonicalJson(canonical.record) !== revisionCanonicalJson(record))
    throw new Error('Revision request handle immutable conflict')
  await assertDirectories(dirname(path))
  const source = await lstat(sourcePath)
  if (!source.isFile() || source.isSymbolicLink())
    throw new Error('Revision request record has invalid size or kind')
  try {
    // The handle is a hardlink to the accepted request record, not a second
    // independently-written copy. Its creation is itself compare-and-create.
    await link(sourcePath, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = validateStoredRecord(await readRecord(path), expected, key)
    if (revisionCanonicalJson(existing.record) !== revisionCanonicalJson(record))
      throw new Error('Revision request handle immutable conflict')
  }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
}

/** Persist an accepted request and its owner-assigned identities.
 *
 * The request is synchronously captured and fully prepared before the first
 * filesystem await. The hardlink is the create-if-absent commit point; an
 * existing winner is validated and returned without replacement.
 */
export async function acceptRevisionRequest(workspacePath: string, value: unknown) {
  const captured = capture(value)
  const workspace = await workspaceRoot(workspacePath)
  const root = join(workspace, relativeRequestsRoot, captured.key)
  const artifactPath = `${relativeRequestsRoot}/${captured.key}/request.json`
  await ensureRequestDirectory(workspace, root)
  const result = await publishRecord(join(root, 'request.json'), captured.record, captured, captured.key)
  const handlesRoot = join(workspace, relativeHandlesRoot)
  await ensureRequestDirectory(workspace, handlesRoot)
  await publishHandle(join(root, 'request.json'), join(handlesRoot, `${result.record.handle}.json`),
    result.record, captured, captured.key)
  return { record: structuredClone(result.record), prepared: structuredClone(result.prepared), artifactPath }
}

/** Read one accepted request through its opaque owner-facing handle. */
export async function readRevisionRequestByHandle(
  workspacePath: string,
  handleValue: unknown,
  ownerId: string,
) {
  const handle = uuid.parse(JSON.parse(revisionCanonicalJson(handleValue)))
  const owner = z.string().min(1).max(200).parse(ownerId)
  const workspace = await workspaceRoot(workspacePath)
  const handlePath = join(workspace, relativeHandlesRoot, `${handle}.json`)
  const handleRecord = await readRecord(handlePath)
  if (handleRecord.handle !== handle) throw new Error('Revision request handle identity mismatch')
  const prepared = prepareRevisionRequest(handleRecord.request)
  if (handleRecord.requestDigest !== revisionDigest(handleRecord.request) ||
    prepared.requestDigest !== handleRecord.requestDigest || prepared.request.ownerId !== owner)
    throw new Error('Revision request handle binding mismatch')
  const key = requestKey(prepared.request)
  const artifactPath = `${relativeRequestsRoot}/${key}/request.json`
  const canonicalRecord = await readRecord(join(workspace, artifactPath))
  if (revisionCanonicalJson(canonicalRecord) !== revisionCanonicalJson(handleRecord))
    throw new Error('Revision request handle does not match canonical request record')
  return { record: structuredClone(canonicalRecord), prepared: structuredClone(prepared), artifactPath }
}

const candidateInputSchema = z.object({ request: z.unknown(), candidateDocuments: z.unknown(),
  unresolvedIssues: z.array(z.object({ issueId: z.string().min(1).max(200), reason: z.string().min(1) }).strict()),
  updatedAtByPath: z.record(z.string(), z.string()).optional() }).strict()

/** Owner-only final snapshot, before publication. No worker or audit verdict is manufactured here. */
export async function commitRevisionRequestCandidate(workspacePath: string, input: {
  request: unknown
  candidateDocuments: readonly RevisionDocumentInput[]
  unresolvedIssues: readonly { issueId: string; reason: string }[]
}) {
  const captured = candidateInputSchema.parse(JSON.parse(revisionCanonicalJson(input)))
  const accepted = await acceptRevisionRequest(workspacePath, captured.request)
  const { prepared, record } = accepted
  if (prepared.request.kind === 'retry_same_round' &&
    revisionCanonicalJson(captured.unresolvedIssues) !== revisionCanonicalJson(prepared.unresolvedIssues))
    throw new Error('Revision retry unresolved issue authority mismatch')
  const documents = bindRevisionDocuments(captured.candidateDocuments as RevisionDocumentInput[])
  for (const path of prepared.retainedDocumentPaths) {
    if (documents.documents.find(doc => doc.path === path)?.content !== prepared.staging.documents.find(doc => doc.path === path)?.content)
      throw new Error('Revision retry changed retained document bytes')
  }
  const candidate = constructRevisionCandidate({ source: prepared.source, requestId: prepared.request.requestId,
    candidateDocuments: captured.candidateDocuments as RevisionDocumentInput[], unresolvedIssues: captured.unresolvedIssues,
    round: prepared.round, candidateId: record.candidateId, ...(prepared.previous ? { previous: prepared.previous } : {}),
    ...(prepared.previousCandidateDocuments ? { previousCandidateDocuments: prepared.previousCandidateDocuments } : {}),
    ...(captured.updatedAtByPath ? { updatedAtByPath: captured.updatedAtByPath } : {}),
    allowAlreadyAdvanced: !captured.updatedAtByPath })
  verifyRevisionCandidateAuthority(prepared.source, candidate)
  if (candidate.candidateId === prepared.previous?.candidateId) throw new Error('Revision retry candidate identity was reused')
  const body = revisionCanonicalJson(candidate) + '\n'
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('Revision candidate snapshot is too large')
  const workspace = await workspaceRoot(workspacePath)
  const root = join(workspace, relativeRequestsRoot, requestKey(prepared.request))
  await assertDirectories(root)
  const path = join(root, 'candidate.json')
  const temporary = join(root, `.pending-${randomUUID()}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await assertDirectories(root)
    try { await link(temporary, path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const metadata = await existing.stat()
        if (!metadata.isFile() || metadata.size > MAX_REQUEST_BYTES) throw new Error('Revision candidate snapshot has invalid size or kind')
        if (await existing.readFile('utf8') !== body) throw new Error('Revision candidate immutable snapshot conflict')
      } finally { await existing.close() }
    }
    const directory = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    try { await unlink(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return { record: structuredClone(record), candidate: structuredClone(candidate),
    artifactPath: `${relativeRequestsRoot}/${requestKey(prepared.request)}/candidate.json` }
}
