import { foundationFactDefinition, isFoundationFactKey } from './domain/foundation-fact-definitions'
import { validateFoundationFactResults, type FoundationFactPacket } from './domain/foundation-fact-extraction'
import type { SectionRef } from './domain/foundation-section-index'
import type { FactValue } from './domain/foundation-fact-store'
import { admitFoundationSemanticResult, buildFoundationSemanticPacket, type FoundationSemanticPacketInput } from './domain/foundation-semantic-audit'
import { prepareFoundationReview, type ReviewDocumentInput } from './prepare-review'
import { buildPacketWorkerPrompt } from './worker-prompt'
import { buildFoundationFactStructuredOutputJsonSchema, foundationFactModelPayloadSchema, foundationSemanticModelPayloadSchema, foundationSemanticReviewerStructuredOutputJsonSchema } from './worker-schemas'

export const REVIEW_WORKER_OUTPUT_MAX_BYTES = 2 * 1024 * 1024

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function boundedOutput(value: unknown): unknown {
  const bytes = JSON.stringify(value)
  if (bytes === undefined || Buffer.byteLength(bytes, 'utf8') > REVIEW_WORKER_OUTPUT_MAX_BYTES)
    throw new Error('review structured output exceeds infrastructure boundary or is not serializable')
  return JSON.parse(bytes)
}

function factValue(value: unknown): FactValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value
  if (Array.isArray(value) && value.every(item => typeof item === 'number')) return value
  throw new Error('fact value has invalid primitive shape')
}

/** Non-completed worker payloads never become accepted review evidence. */
export class ReviewWorkerIncompleteError extends Error {
  constructor(readonly status: 'failed' | 'blocked') {
    super(`review worker returned ${status}`)
  }
}

/** Private executable task: closures retain the original authority, not model data. */
export function createFactWorkerTask(documents: readonly ReviewDocumentInput[], packetIndex: number) {
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('fact work requires format-valid documents')
  if (!Number.isInteger(packetIndex) || packetIndex < 0 || packetIndex >= prepared.factPackets.length)
    throw new Error('fact packet index is invalid')
  return createReviewerPacketFactTask({ packet: prepared.factPackets[packetIndex]!, documents,
    sectionIndex: prepared.sectionIndex, revision: prepared.snapshot.digest })
}

/** Shared only inside Reviewer; the owner selects and binds the packet first. */
export function createReviewerPacketFactTask(input: { packet: FoundationFactPacket; documents: readonly ReviewDocumentInput[];
  sectionIndex: readonly SectionRef[]; revision: string }) {
  const captured = structuredClone(input)
  const packet = captured.packet
  return freeze({
    packetDigest: packet.packetDigest,
    revision: packet.revision,
    prompt: buildPacketWorkerPrompt({ workerType: 'foundation-fact-extractor', contract: { packet } }),
    schema: buildFoundationFactStructuredOutputJsonSchema(packet),
    admit(value: unknown) {
      const payload = foundationFactModelPayloadSchema.parse(boundedOutput(value))
      if (payload.status !== 'completed') throw new ReviewWorkerIncompleteError(payload.status)
      const results = payload.results.map(result => {
        const key = result.key
        if (!isFoundationFactKey(key) || !packet.keys.includes(key)) throw new Error('fact key is not assigned')
        if (result.status === 'absent') return { key, status: result.status }
        const definition = foundationFactDefinition(key)
        const section = packet.sections.find(item => item.documentPath === definition?.owner.documentPath && item.sectionId === definition?.owner.sectionId)
        if (!section) throw new Error('fact owner section is missing')
        const { documentPath, sectionId, startLine, endLine, digest } = section
        const evidence = { documentPath, sectionId, startLine, endLine, digest }
        return result.status === 'present'
          ? { key, status: result.status, value: factValue(result.value), evidence }
          : { key, status: result.status, reason: result.reason, evidence }
      })
      return validateFoundationFactResults({
        packet, expectedRevision: captured.revision,
        documents: new Map(captured.documents.map(item => [item.path, item.content])),
        sectionIndex: captured.sectionIndex, results,
      })
    },
  })
}

/** Source and strong confirmation use the exact same frozen packet identity. */
export function createSemanticWorkerTask(input: FoundationSemanticPacketInput, kind: 'source' | 'confirmation' = 'source') {
  if (kind !== 'source' && kind !== 'confirmation') throw new Error('semantic task kind is invalid')
  const packet = buildFoundationSemanticPacket(structuredClone(input))
  return freeze({
    packetDigest: packet.identity,
    revision: packet.revision,
    prompt: buildPacketWorkerPrompt({ workerType: 'foundation-semantic-reviewer', contract: { packet, kind, checkId: packet.checkId } }),
    schema: structuredClone(foundationSemanticReviewerStructuredOutputJsonSchema),
    admit(value: unknown) {
      const payload = foundationSemanticModelPayloadSchema.parse(boundedOutput(value))
      if (payload.status !== 'completed') throw new ReviewWorkerIncompleteError(payload.status)
      const { status: _status, ...result } = payload
      return admitFoundationSemanticResult(packet, { ...result, checkId: packet.checkId, packetIdentity: packet.identity })
    },
  })
}
