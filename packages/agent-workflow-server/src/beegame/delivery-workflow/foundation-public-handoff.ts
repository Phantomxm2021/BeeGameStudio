import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { foundationRevisionInputDigest, type RevisionStartInput, type RevisionResult } from '../stage-modules/foundation-revision/public'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

export type FoundationCandidateResult = Extract<RevisionResult, { status: 'completed' }>['result']
export type FoundationHandoffIdentity = { ownerId: string; projectId: string }
export type FoundationPreviousReview = {
  candidate: FoundationCandidateResult
  recheck: ReviewerReviewResult
}

// Encoding of copied public contracts, not a stage parser or execution kernel.
export function foundationPublicJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(foundationPublicJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${foundationPublicJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  throw new Error('Foundation handoff requires plain JSON')
}
export const foundationPublicDigest = (value: unknown) => createHash('sha256').update(foundationPublicJson(value)).digest('hex')
const bytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Bindings are created only after accepting an outcome from its public port.
 * A digest detects changed bytes; it does not itself authenticate a producer. */
export function foundationResultBinding(identity: FoundationHandoffIdentity,
  result: ReviewerReviewResult | FoundationCandidateResult) {
  if (result.protocolVersion !== 1 || result.ownerId !== identity.ownerId || result.projectId !== identity.projectId)
    throw new Error('Foundation public result owner or project mismatch')
  const { resultId, ...body } = result
  if (resultId !== foundationPublicDigest(body)) throw new Error('Foundation public result digest mismatch')
  return { ...identity, resultId, resultDigest: foundationPublicDigest(result) }
}

/** Read only artifacts explicitly exported by the accepted Author result.
 * Never read canonical working documents, receipts, journals or checkpoints. */
export async function createFoundationInitialReviewRequest(value: {
  workspacePath: string
  requestId: string
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
  const input = { subject: { kind: 'initial' as const, sourceResultId: result.resultId,
    sourceDocumentRevision: result.documentRevision, confirmedBriefDigest: result.confirmedBriefDigest }, documents }
  return { protocolVersion: 1, ...expectedIdentity(expected), requestId: captured.requestId, input,
    inputDigest: foundationReviewerInputDigest({ ...expectedIdentity(expected), input }) }
}

function expectedIdentity(value: FoundationHandoffIdentity): FoundationHandoffIdentity {
  return { ownerId: value.ownerId, projectId: value.projectId }
}

export function createFoundationRepairRequest(value: FoundationHandoffIdentity & {
  requestId: string; source: ReviewerReviewResult; previous?: FoundationPreviousReview
}): RevisionStartInput {
  const captured = structuredClone(value)
  const identity = expectedIdentity(captured)
  if (captured.source.producer !== 'foundation-reviewer' || captured.source.kind !== 'issues_found')
    throw new Error('Revision requires an accepted Reviewer issue result')
  const source = { sourceResult: captured.source, sourceBinding: foundationResultBinding(identity, captured.source) }
  const input: RevisionStartInput['input'] = captured.previous ? {
    ...source, kind: 'retry_same_round',
    previousCandidateResult: captured.previous.candidate,
    previousCandidateBinding: foundationResultBinding(identity, captured.previous.candidate),
    previousRecheckResult: captured.previous.recheck,
    previousRecheckBinding: foundationResultBinding(identity, captured.previous.recheck),
  } : { ...source, kind: captured.source.subject.kind === 'initial' ? 'initial' : 'next_round' }
  return { protocolVersion: 1, ...identity, requestId: captured.requestId, input,
    inputDigest: foundationRevisionInputDigest({ ...identity, input }) }
}

export function createFoundationCandidateReviewRequest(value: FoundationHandoffIdentity & {
  requestId: string; source: ReviewerReviewResult; candidate: FoundationCandidateResult; previous?: FoundationPreviousReview
}): ReviewerStartInput {
  const captured = structuredClone(value)
  const identity = expectedIdentity(captured)
  if (captured.candidate.producer !== 'foundation-revision' || captured.candidate.kind !== 'candidate_ready')
    throw new Error('Reviewer requires an accepted Revision candidate')
  const source = { sourceResult: captured.source, sourceBinding: foundationResultBinding(identity, captured.source),
    candidateResult: captured.candidate, candidateBinding: foundationResultBinding(identity, captured.candidate) }
  const input: ReviewerStartInput['input'] = captured.previous ? {
    ...source, kind: 'retry', previousCandidateResult: captured.previous.candidate,
    previousCandidateBinding: foundationResultBinding(identity, captured.previous.candidate),
    previousRecheckResult: captured.previous.recheck,
    previousRecheckBinding: foundationResultBinding(identity, captured.previous.recheck),
  } : { ...source, kind: 'first' }
  return { protocolVersion: 1, ...identity, requestId: captured.requestId, input,
    inputDigest: foundationReviewerInputDigest({ ...identity, input }) }
}
