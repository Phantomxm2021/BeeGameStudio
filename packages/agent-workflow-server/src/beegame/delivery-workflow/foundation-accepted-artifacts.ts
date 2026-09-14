import { createHash } from 'node:crypto'
import { publishProjectArtifacts, type ProjectWorkspaceDigest } from '../project-artifact-store'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationResultBinding, type FoundationHandoffIdentity } from './foundation-public-handoff'

/** Publish only the exact document set that an independent Reviewer passed. */
export async function publishFoundationAcceptedArtifacts(input: FoundationHandoffIdentity & {
  workspacePath: string
  review: ReviewerReviewResult
  expectedDocuments: readonly { path: string; content: string }[]
  expectedWorkspaceDigests?: readonly ProjectWorkspaceDigest[]
}): Promise<string> {
  const { review, expectedDocuments } = structuredClone(input)
  foundationResultBinding(input, review)
  if (review.protocolVersion !== 6 || review.producer !== 'foundation-reviewer' ||
      review.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length ||
      expectedDocuments.length !== review.documents.length)
    throw new Error('Current foundation artifacts require a passed Reviewer result')
  for (const [index, document] of review.documents.entries()) {
    const expected = expectedDocuments[index]!
    if (document.path !== CANONICAL_FOUNDATION_DOCUMENTS[index] || document.path !== expected.path ||
        document.content !== expected.content || document.byteLength !== Buffer.byteLength(document.content, 'utf8') ||
        document.digest !== createHash('sha256').update(document.content).digest('hex'))
      throw new Error('Accepted foundation artifacts differ from the reviewed input')
  }
  const revision = createHash('sha256').update(JSON.stringify(review.documents.map(({ path, digest }) => [path, digest]))).digest('hex')
  if (revision !== review.documentSetDigest) throw new Error('Accepted foundation document set digest mismatch')
  await publishProjectArtifacts({ workspacePath: input.workspacePath, ownerId: input.ownerId, projectId: input.projectId,
    publicationId: review.resultId, documents: review.documents,
    ...(input.expectedWorkspaceDigests ? { expectedWorkspaceDigests: input.expectedWorkspaceDigests } : {}) })
  return revision
}

/** Baseline canonical preimages from an accepted public Author result. */
export function foundationAuthorWorkspaceBaseline(
  result: AuthorDocumentsResult,
): readonly ProjectWorkspaceDigest[] {
  return result.documents.map(document => ({ path: document.path, digest: document.digest }))
}
