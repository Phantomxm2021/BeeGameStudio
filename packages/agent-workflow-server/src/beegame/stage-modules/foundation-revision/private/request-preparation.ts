import { z } from 'zod/v4'
import { parseSingleRevisionSource } from './single-review-source'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const binding = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
const requestSchema = z.object({ ownerId: id, projectId: id, requestId: id,
  sourceResult: z.unknown(), sourceBinding: binding }).strict()

/** One request, one agent, all eight documents. No repair planning protocol. */
export function prepareRevisionRequest(value: unknown) {
  const request = requestSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  const source = parseSingleRevisionSource(request.sourceResult, request.sourceBinding)
  if (source.ownerId !== request.ownerId || source.projectId !== request.projectId)
    throw new Error('Revision source identity mismatch')
  const round = source.subject.kind === 'initial' ? 1 : source.subject.round + 1
  if (!Number.isSafeInteger(round)) throw new Error('Revision round exceeds safe integer boundary')
  return { request, requestDigest: revisionDigest(request), source, round }
}
