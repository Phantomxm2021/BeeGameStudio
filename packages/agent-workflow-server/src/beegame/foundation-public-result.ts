import { createHash } from 'node:crypto'
import type { ReviewerReviewResult } from './stage-modules/foundation-reviewer/public'
export type FoundationHandoffIdentity = { ownerId: string; projectId: string }

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

/** Bindings are created only after accepting an outcome from its public port.
 * A digest detects changed bytes; it does not itself authenticate a producer. */
export function foundationResultBinding(identity: FoundationHandoffIdentity,
  result: ReviewerReviewResult) {
  if (result.producer !== 'foundation-reviewer' || result.protocolVersion !== 6)
    throw new Error('Foundation public result producer or protocol version is unsupported')
  if (result.ownerId !== identity.ownerId || result.projectId !== identity.projectId)
    throw new Error('Foundation public result owner or project mismatch')
  const { resultId, ...body } = result
  if (resultId !== foundationPublicDigest(body)) throw new Error('Foundation public result digest mismatch')
  return { ...identity, resultId, resultDigest: foundationPublicDigest(result) }
}
