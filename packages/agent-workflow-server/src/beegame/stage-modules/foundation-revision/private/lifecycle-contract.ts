import { z } from 'zod/v4'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { prepareRevisionRequest } from './request-preparation'
import type { publishRevisionCompletedCandidate } from './completed-candidate'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const binding = z
  .object({
    ownerId: id,
    projectId: id,
    resultId: digest,
    resultDigest: digest,
  })
  .strict()
const inputSchema = z.object({ sourceResult: z.unknown(), sourceBinding: binding }).strict()
const digestInputSchema = z
  .object({ ownerId: id, projectId: id, input: inputSchema })
  .strict()
const startSchema = digestInputSchema
  .extend({ protocolVersion: z.literal(1), requestId: id, inputDigest: digest })
  .strict()
export const revisionHandleSchema = z
  .object({
    protocolVersion: z.literal(1),
    producer: z.literal('foundation-revision'),
    id: z.uuid(),
  })
  .strict()
export const revisionResumeInputSchema = z
  .object({ handle: revisionHandleSchema, requestId: id })
  .strict()
export const revisionStopInputSchema = revisionResumeInputSchema
  .extend({ reason: z.enum(['user_requested', 'shutdown']) })
  .strict()
export type RevisionStartInput = z.infer<typeof startSchema>
export type RevisionHandle = z.infer<typeof revisionHandleSchema>
export type RevisionResumeInput = z.infer<typeof revisionResumeInputSchema>
export type RevisionStopInput = z.infer<typeof revisionStopInputSchema>
export type RevisionResult = {
  handle: RevisionHandle
  inputDigest: string
  billingStatus: 'pending' | 'settled'
  progress?: { modelResponses: number; message: string }
} & (
  | { status: 'running' }
  | { status: 'stopped' }
  | { status: 'needs_action'; reason: string; resumable: boolean }
  | {
      status: 'completed'
      result: Awaited<
        ReturnType<typeof publishRevisionCompletedCandidate>
      >['result']
    }
)
export function captureRevisionPublicInput(value: unknown): unknown {
  return JSON.parse(revisionCanonicalJson(value))
}
export function foundationRevisionInputDigest(
  value: Pick<RevisionStartInput, 'ownerId' | 'projectId' | 'input'>,
): string {
  return revisionDigest(
    digestInputSchema.parse(captureRevisionPublicInput(value)),
  )
}
export function parseRevisionStart(value: unknown) {
  const start = startSchema.parse(captureRevisionPublicInput(value))
  if (
    foundationRevisionInputDigest({
      ownerId: start.ownerId,
      projectId: start.projectId,
      input: start.input,
    }) !== start.inputDigest
  )
    throw new Error('Revision public input digest mismatch')
  const prepared = prepareRevisionRequest({
    ...start.input,
    ownerId: start.ownerId,
    projectId: start.projectId,
    requestId: start.requestId,
  })
  return { start, prepared }
}
export function revisionRequestInputDigest(
  request: ReturnType<typeof prepareRevisionRequest>['request'],
) {
  const { ownerId, projectId, requestId: _requestId, ...input } = request
  return foundationRevisionInputDigest({ ownerId, projectId, input })
}
