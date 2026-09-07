import { lstat } from 'node:fs/promises'
import { isAbsolute, join, dirname, parse, resolve } from 'node:path'
import { z } from 'zod/v4'
import { bindReviewDocuments, type ReviewDocumentInput } from './prepare-review'
import { reviewerImmutableFiles } from './fact-journal'
import { summarizeReviewer, reviewerDigest, reviewerCanonicalJson, type ReviewerIssueEvidence } from './review-summary'
import type { ReviewerJournalState } from './review-state'
import { reviewerSubjectSchema, type ReviewerSubject } from './review-subject'
import type { ReviewerRecheckPublicEvidence } from './recheck-contract'
export { reviewerSubjectSchema, type ReviewerSubject } from './review-subject'

const identity = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export type ReviewerPublishedResult = {
  protocolVersion: 1
  producer: 'foundation-reviewer'
  resultId: string
  inputDigest: string
  ownerId: string
  projectId: string
  requestId: string
  subject: ReviewerSubject
  kind: 'passed' | 'issues_found'
  documentSetDigest: string
  documents: { path: ReviewDocumentInput['path']; content: string; digest: string; byteLength: number }[]
  policyDigest: string
  issueRegistryDigest: string
  evidenceDigest: string
  issues: ReviewerIssueEvidence[]
  recheck?: ReviewerRecheckPublicEvidence
}
export function reviewerInputDigest(input: { ownerId: string; projectId: string; subject: ReviewerSubject; documents: readonly ReviewDocumentInput[] }) {
  return reviewerDigest({ ownerId: input.ownerId, projectId: input.projectId, subject: reviewerSubjectSchema.parse(input.subject), documentSetDigest: bindReviewDocuments(input.documents).digest })
}
export function buildReviewerPublishedResult(input: { identity: { ownerId: string; projectId: string; requestId: string }; subject: ReviewerSubject;
  documents: readonly ReviewDocumentInput[]; state: ReviewerJournalState }): ReviewerPublishedResult {
  const capturedIdentity = z.object({ ownerId: identity, projectId: identity, requestId: identity }).strict().parse(input.identity)
  const subject = reviewerSubjectSchema.parse(input.subject)
  const snapshot = bindReviewDocuments(input.documents)
  const summary = summarizeReviewer(input.documents, input.state)
  const body = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, ...capturedIdentity, subject,
    inputDigest: reviewerInputDigest({ ...capturedIdentity, subject, documents: input.documents }),
    kind: summary.kind, documentSetDigest: snapshot.digest,
    documents: snapshot.documents.map(document => ({ ...document, byteLength: Buffer.byteLength(document.content, 'utf8') })),
    policyDigest: summary.policyDigest, issueRegistryDigest: summary.issueRegistryDigest, evidenceDigest: summary.evidenceDigest, issues: summary.issues }
  return { ...body, resultId: reviewerDigest(body) }
}
async function workspaceRoot(path: string) {
  if (!isAbsolute(path)) throw new Error('review publication workspace must be absolute')
  const absolute = resolve(path)
  let cursor = absolute
  while (cursor !== parse(cursor).root) {
    const entry = await lstat(cursor)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('review publication parent must be a real directory')
    cursor = dirname(cursor)
  }
  return absolute
}

/** Publishes self-contained public data. No canonical document path is written. */
export async function publishReviewerResult(input: { workspacePath: string } & Parameters<typeof buildReviewerPublishedResult>[0]) {
  // Capture and validate before any await; mutable callers cannot change what is signed.
  const result = buildReviewerPublishedResult(structuredClone(input))
  return publishReviewerDerivedResult(input.workspacePath, result)
}

/** Private storage boundary: callers must derive the value from their own replayed state. */
export async function publishReviewerDerivedResult(workspacePath: string, value: ReviewerPublishedResult) {
  const result = structuredClone(value)
  digest.parse(result.resultId)
  const { resultId, ...body } = result
  if (reviewerDigest(body) !== resultId) throw new Error('review derived result digest mismatch')
  const workspace = await workspaceRoot(workspacePath)
  const relativeRoot = `.beegame/workflow/foundation-reviewer/results/${result.resultId}`
  const root = join(workspace, relativeRoot)
  await reviewerImmutableFiles.ensureDirectories(root)
  await reviewerImmutableFiles.publishJson(join(root, 'result.json'), result)
  const marker = { protocolVersion: 1, producer: 'foundation-reviewer', resultId: result.resultId, inputDigest: result.inputDigest, resultDigest: reviewerDigest(result) }
  await reviewerImmutableFiles.publishJson(join(root, 'COMMITTED.json'), marker)
  // Publication is visible only once the complete marker and data agree.
  if (!await readReviewerPublishedResult(workspace, result)) throw new Error('review publication marker disappeared')
  return { result, artifactPath: `${relativeRoot}/result.json`, commitPath: `${relativeRoot}/COMMITTED.json` }
}

/** Expected data is derived by the owner from its immutable request and journal. */
export async function readReviewerPublishedResult(workspacePath: string, expected: ReviewerPublishedResult): Promise<ReviewerPublishedResult | undefined> {
  const captured = structuredClone(expected)
  digest.parse(captured.resultId)
  const workspace = await workspaceRoot(workspacePath)
  const root = join(workspace, '.beegame/workflow/foundation-reviewer/results', captured.resultId)
  try {
    await workspaceRoot(root)
    const marker = await reviewerImmutableFiles.readJson(join(root, 'COMMITTED.json'))
    const expectedMarker = { protocolVersion: 1, producer: 'foundation-reviewer', resultId: captured.resultId, inputDigest: captured.inputDigest, resultDigest: reviewerDigest(captured) }
    if (reviewerCanonicalJson(marker) !== reviewerCanonicalJson(expectedMarker)) throw new Error('review publication marker binding mismatch')
    const result = await reviewerImmutableFiles.readJson(join(root, 'result.json'))
    if (reviewerCanonicalJson(result) !== reviewerCanonicalJson(captured)) throw new Error('review published result binding mismatch')
    return structuredClone(captured)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // A missing marker is an incomplete publication, not a completed result.
      // A missing body under an existing marker is corruption, not a retry.
      try { await lstat(join(root, 'COMMITTED.json')) } catch (markerError) {
        if ((markerError as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw markerError
      }
      throw new Error('committed review publication is incomplete')
    }
    throw error
  }
}
