import { createReviewerPacketFactTask, REVIEW_WORKER_OUTPUT_MAX_BYTES } from './worker-task'
import { prepareReviewerTargetedAudit, validateReviewerTargetedFacts, type ReviewerPreparedCandidate } from './targeted-preparation'
import type { FoundationFactReceipt } from './domain/foundation-fact-extraction'
import { admitFoundationSemanticRecheckWorkerResult } from './domain/foundation-patch-validation'
import { foundationSemanticRecheckStructuredOutputJsonSchema, foundationSemanticRecheckWorkerPayloadSchema } from './targeted-worker-schema'
import { buildTargetedSemanticWorkerPrompt } from './targeted-worker-prompt'

export function createReviewerTargetedFactWorker(input: ReviewerPreparedCandidate, index: number) {
  const prepared = prepareReviewerTargetedAudit(input)
  if (!Number.isInteger(index) || index < 0 || index >= prepared.planned.packets.length) throw new Error('targeted fact packet index is invalid')
  return createReviewerPacketFactTask({ packet: prepared.planned.packets[index]!, documents: prepared.input.documents,
    sectionIndex: prepared.sectionIndex, revision: prepared.input.source.documentSetDigest })
}

export function createReviewerTargetedSemanticWorker(input: ReviewerPreparedCandidate, facts: readonly FoundationFactReceipt[], index: number) {
  const validation = validateReviewerTargetedFacts(input, facts)
  if (!Number.isInteger(index) || index < 0 || index >= validation.semantic.length) throw new Error('targeted semantic packet index is invalid')
  const { issue, packet } = validation.semantic[index]!
  const taskId = `targeted-semantic-${index}`
  return Object.freeze({ taskId, packetDigest: packet.packetDigest, revision: validation.prepared.input.source.documentSetDigest,
    prompt: buildTargetedSemanticWorkerPrompt(packet),
    schema: structuredClone(foundationSemanticRecheckStructuredOutputJsonSchema),
    admit(value: unknown) {
      const serialized = JSON.stringify(value)
      if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > REVIEW_WORKER_OUTPUT_MAX_BYTES)
        throw new Error('targeted semantic output exceeds infrastructure boundary')
      const payload = foundationSemanticRecheckWorkerPayloadSchema.parse(JSON.parse(serialized))
      return admitFoundationSemanticRecheckWorkerResult(packet, payload, { taskId, issue })
    },
  })
}
