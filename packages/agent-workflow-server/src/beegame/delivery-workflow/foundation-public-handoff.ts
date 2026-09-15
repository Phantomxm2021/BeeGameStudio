import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

import { type FoundationHandoffIdentity } from '../foundation-public-result'
export { foundationPublicJson, foundationPublicDigest, foundationResultBinding, type FoundationHandoffIdentity } from '../foundation-public-result'
const bytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Read only artifacts explicitly exported by the accepted Author result.
 * Never read canonical working documents, receipts, journals or checkpoints. */
export async function createFoundationInitialReviewRequest(value: {
  workspacePath: string
  requestId: string
  confirmedBriefContext: string
  expected: FoundationHandoffIdentity & { inputDigest: string; confirmedBriefDigest: string }
  result: AuthorDocumentsResult
}): Promise<ReviewerStartInput> {
  const captured = structuredClone(value)
  const { expected, result } = captured
  if (result.protocolVersion !== 1 || result.producer !== 'foundation-authoring' || result.kind !== 'foundation_documents' ||
      result.ownerId !== expected.ownerId || result.projectId !== expected.projectId ||
      result.inputDigest !== expected.inputDigest || result.confirmedBriefDigest !== expected.confirmedBriefDigest)
    throw new Error('Author public result does not match the accepted invocation')
  if (!/^[a-f0-9]{64}$/.test(result.resultId) || !/^[a-f0-9]{64}$/.test(result.documentRevision) ||
      result.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length ||
      result.documents.some((document, index) => document.path !== CANONICAL_FOUNDATION_DOCUMENTS[index]))
    throw new Error('Author public document manifest is invalid')
  if (!isAbsolute(captured.workspacePath)) throw new Error('Foundation handoff workspace must be absolute')
  const root = await realpath(captured.workspacePath)
  const documents: Array<{ path: typeof CANONICAL_FOUNDATION_DOCUMENTS[number]; content: string }> = []
  for (const document of result.documents) {
    const parts = document.artifactPath.split('/')
    if (!document.artifactPath || isAbsolute(document.artifactPath) || document.artifactPath.includes('\\') ||
        parts.some(part => part === '' || part === '.' || part === '..') ||
        !/^[a-f0-9]{64}$/.test(document.digest) || !Number.isSafeInteger(document.byteLength) || document.byteLength < 0)
      throw new Error('Author exported artifact descriptor is invalid')
    const destination = resolve(root, document.artifactPath)
    const rel = relative(root, destination)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('Author exported artifact escapes workspace')
    let cursor = root
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part)
      const metadata = await lstat(cursor)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Author artifact parent must be a real directory')
    }
    const file = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW)
    let bytes: Buffer
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size !== document.byteLength) throw new Error('Author artifact size or kind mismatch')
      bytes = await file.readFile()
    } finally { await file.close() }
    if (bytes.byteLength !== document.byteLength || bytesDigest(bytes) !== document.digest)
      throw new Error('Author artifact digest mismatch')
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    documents.push({ path: document.path as typeof CANONICAL_FOUNDATION_DOCUMENTS[number], content })
  }
  if (!captured.confirmedBriefContext.trim() || bytesDigest(Buffer.from(captured.confirmedBriefContext)) !== expected.confirmedBriefDigest)
    throw new Error('Confirmed brief content does not match the accepted digest')
  const input = { subject: { kind: 'initial' as const, sourceResultId: result.resultId,
    sourceDocumentRevision: result.documentRevision, confirmedBriefDigest: result.confirmedBriefDigest }, documents,
    requirements: { status: 'available' as const, content: captured.confirmedBriefContext, digest: expected.confirmedBriefDigest } }
  return { protocolVersion: 1, ...expectedIdentity(expected), requestId: captured.requestId, input,
    inputDigest: foundationReviewerInputDigest({ ...expectedIdentity(expected), input }) }
}

function expectedIdentity(value: FoundationHandoffIdentity): FoundationHandoffIdentity {
  return { ownerId: value.ownerId, projectId: value.projectId }
}
