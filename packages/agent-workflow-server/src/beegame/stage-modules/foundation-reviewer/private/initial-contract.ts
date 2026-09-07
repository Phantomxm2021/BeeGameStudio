import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { bindReviewDocuments } from './prepare-review'
import { reviewerSubjectSchema } from './review-subject'
import { reviewerInputDigest, type ReviewerPublishedResult } from './review-publication'

const id = z.string().min(1).max(200)
export const reviewerHandleSchema = z.object({ protocolVersion: z.literal(1), producer: z.literal('foundation-reviewer'), id: z.string().uuid() }).strict()
export const reviewerInitialStartSchema = z.object({ protocolVersion: z.literal(1), requestId: id, ownerId: id, projectId: id,
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/), input: z.object({ subject: reviewerSubjectSchema,
    documents: z.array(z.object({ path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS), content: z.string() }).strict()).length(8) }).strict() }).strict()
export const reviewerResumeSchema = z.object({ handle: reviewerHandleSchema, requestId: id }).strict()
export const reviewerStopSchema = reviewerResumeSchema.extend({ reason: z.string().min(1).max(2000) })
export type ReviewerHandle = z.infer<typeof reviewerHandleSchema>
export type ReviewerInitialStart = z.infer<typeof reviewerInitialStartSchema>
export type ReviewerResume = z.infer<typeof reviewerResumeSchema>
export type ReviewerStop = z.infer<typeof reviewerStopSchema>
export type ReviewerResult = (
  | { status: 'running'; handle: ReviewerHandle }
  | { status: 'stopped'; handle: ReviewerHandle }
  | { status: 'needs_action'; handle: ReviewerHandle; reason: string; resumable: boolean }
  | { status: 'failed'; handle: ReviewerHandle; code: string; reason: string }
  | { status: 'completed'; handle: ReviewerHandle; result: ReviewerPublishedResult }
) & { billingStatus: 'pending' | 'settled' }
export function parseReviewerInitialStart(value: unknown): ReviewerInitialStart {
  const start = reviewerInitialStartSchema.parse(value)
  if (start.input.subject.kind !== 'initial') throw new Error('initial review cannot accept candidate repair claims')
  start.input.documents = bindReviewDocuments(start.input.documents).documents.map(({ path, content }) => ({ path, content }))
  if (reviewerInputDigest({ ownerId: start.ownerId, projectId: start.projectId, ...start.input }) !== start.inputDigest) throw new Error('review input digest mismatch')
  return start
}
