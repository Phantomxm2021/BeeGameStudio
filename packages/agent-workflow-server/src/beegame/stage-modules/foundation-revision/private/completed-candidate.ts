import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, link, unlink } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { acceptRevisionRequest, commitRevisionRequestCandidate } from './request-store'
import { openRevisionAttemptStore } from './attempt-store'
import { constructRevisionCandidate } from './candidate-construction'
import { verifyRevisionCandidateAuthority } from './candidate-authority'
import { publishRevisionDerivedCandidate } from './candidate-publication'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { readRevisionDocumentMetadata } from './document-metadata'

const MAX_MANIFEST_BYTES = 1024 * 1024

async function assertDirectories(path: string): Promise<void> {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const stat = await lstat(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Revision receipt manifest requires real directories')
    cursor = dirname(cursor)
  }
}

async function commitManifest(path: string, value: unknown): Promise<void> {
  const body = `${revisionCanonicalJson(value)}\n`
  if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) throw new Error('Revision receipt manifest too large')
  await assertDirectories(dirname(path))
  const temporary = join(dirname(path), `.pending-${randomUUID()}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await assertDirectories(dirname(path))
    try { await link(temporary, path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES)
        throw new Error('Revision receipt manifest invalid size or kind')
      const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const metadata = await existing.stat()
        if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES || await existing.readFile('utf8') !== body)
          throw new Error('Revision immutable receipt manifest conflict')
      } finally { await existing.close() }
    }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    try { await unlink(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Owner-only completion path. Caller supplies the accepted request, never a
 * replacement document set, receipt list, completion status or publication ID.
 * Only all-completed dispatches are currently supported. Retained predecessor
 * bytes/unresolved issues come from admitted public recheck evidence, not a
 * skip decision inferred from pending, stopped or failed local attempts.
 * The request-wide journal seals publication before any result artifact IO;
 * a winning earlier stop prevents authorization, a later stop cannot undo it.
 */
export async function publishRevisionCompletedCandidate(workspacePath: string, requestValue: unknown) {
  const request = JSON.parse(revisionCanonicalJson(requestValue)) as unknown
  const accepted = await acceptRevisionRequest(workspacePath, request)
  const { record, prepared } = accepted
  const store = await openRevisionAttemptStore(workspacePath, request)
  const receipts = []
  for (const batch of prepared.batches) {
    const state = await store.read(batch.documentPath)
    if (!state.completed || state.completed.settlement.status !== 'completed')
      throw new Error('Revision candidate requires completed receipts for every dispatch')
    // Re-synchronize the immutable terminal before authorizing downstream IO,
    // including after an earlier owner lost its directory-sync acknowledgement.
    const receipt = await store.settle(batch.documentPath, state.completed.settlement)
    if (receipt.handle !== record.handle || receipt.requestDigest !== record.requestDigest)
      throw new Error('Revision candidate receipt identity mismatch')
    receipts.push(receipt)
  }
  const outputs = new Map(receipts.map(receipt => [receipt.documentPath,
    receipt.output as NonNullable<Awaited<ReturnType<typeof store.read>>['output']>]))
  const documents = prepared.staging.documents.map(document => ({ path: document.path,
    content: outputs.get(document.path)?.markdown ?? document.content }))
  const updatedAtByPath = Object.fromEntries([...outputs.entries()].flatMap(([path, output]) => {
    try { return [[path, readRevisionDocumentMetadata(output.markdown).updatedAt]] }
    catch { return [] }
  }))
  const expected = constructRevisionCandidate({ source: prepared.source, requestId: prepared.request.requestId,
    candidateDocuments: documents, unresolvedIssues: prepared.unresolvedIssues, round: prepared.round,
    candidateId: record.candidateId, ...(prepared.previous ? { previous: prepared.previous } : {}),
    ...(prepared.previousCandidateDocuments ? { previousCandidateDocuments: prepared.previousCandidateDocuments } : {}),
    ...(Object.keys(updatedAtByPath).length ? { updatedAtByPath } : {}) })
  verifyRevisionCandidateAuthority(prepared.source, expected)
  for (const [path, output] of outputs) {
    const sorted = (values: readonly unknown[]) => values.map(revisionCanonicalJson).sort()
    if (revisionCanonicalJson(sorted(expected.changes.filter(change => change.documentPath === path))) !==
      revisionCanonicalJson(sorted(output.operations)))
      throw new Error('Revision candidate operations disagree with completed worker evidence')
  }
  const authorization = await store.preparePublication()
  if (revisionCanonicalJson(authorization.candidate) !== revisionCanonicalJson(expected) ||
    revisionCanonicalJson(authorization.receipts.map(revisionDigest)) !== revisionCanonicalJson(receipts.map(revisionDigest)))
    throw new Error('Revision publication authorization disagrees with completed evidence')
  const manifest = { protocolVersion: 1, producer: 'foundation-revision', kind: 'candidate_receipts_accepted',
    authorizationDigest: authorization.authorizationDigest,
    handle: record.handle, candidateId: record.candidateId, requestDigest: record.requestDigest,
    candidateResultId: expected.resultId, candidateResultDigest: revisionDigest(expected), documentSetDigest: expected.documentSetDigest,
    previous: prepared.previous, retainedDocumentPaths: prepared.retainedDocumentPaths,
    receipts: receipts.map(receipt => ({ documentPath: receipt.documentPath, attemptId: receipt.settlement.attemptId,
      receiptDigest: revisionDigest(receipt), packetDigest: receipt.packetDigest,
      documentDigest: outputs.get(receipt.documentPath)!.documentDigest })) }
  const relativeRoot = dirname(accepted.artifactPath)
  const receiptManifestPath = `${relativeRoot}/candidate-receipts.json`
  await commitManifest(join(resolve(workspacePath), receiptManifestPath), manifest)
  const committed = await commitRevisionRequestCandidate(workspacePath, { request,
    candidateDocuments: documents, unresolvedIssues: prepared.unresolvedIssues,
    ...(Object.keys(updatedAtByPath).length ? { updatedAtByPath } : {}) })
  if (revisionCanonicalJson(committed.candidate) !== revisionCanonicalJson(expected))
    throw new Error('Revision receipt-bound candidate snapshot mismatch')
  const published = await publishRevisionDerivedCandidate(workspacePath, committed.candidate)
  await store.markPublished(authorization.authorizationDigest)
  // Manifest path is private owner bookkeeping, not part of the candidate's
  // public contract. Public consumers receive only the self-contained result.
  return { ...published, receiptManifestPath }
}
