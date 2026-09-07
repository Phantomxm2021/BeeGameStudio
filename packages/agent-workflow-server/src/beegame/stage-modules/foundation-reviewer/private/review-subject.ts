import { z } from 'zod/v4'
const identity = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const reviewerSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial'), sourceResultId: identity, sourceDocumentRevision: digest, confirmedBriefDigest: digest }).strict(),
  z.object({ kind: z.literal('candidate'), candidateId: identity, candidateResultId: identity, baseDocumentSetDigest: digest,
    sourceReviewResultId: digest, sourceReviewResultDigest: digest, previousCandidateId: identity.optional() }).strict(),
])
export type ReviewerSubject = z.infer<typeof reviewerSubjectSchema>
export const reviewerRequestBindingSchema = z.object({ inputDigest: digest, subject: reviewerSubjectSchema }).strict()
