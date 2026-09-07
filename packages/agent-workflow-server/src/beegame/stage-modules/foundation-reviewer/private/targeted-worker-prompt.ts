import type { FoundationSemanticRecheckPacket } from './domain/foundation-patch-validation'
import { buildPacketWorkerPrompt } from './worker-prompt'

const MODEL_PACKET_LINE_MARKER = '\nModel packet contract: '

/**
 * Targeted semantic rechecks need the bound section digest to report FAIL
 * evidence. The shared packet prompt deliberately omits that private field,
 * so add it only to this targeted model projection.
 */
export function buildTargetedSemanticWorkerPrompt(packet: FoundationSemanticRecheckPacket): string {
  const prompt = buildPacketWorkerPrompt({
    workerType: 'foundation-semantic-reviewer',
    // issueId is an internal routing discriminator. The frozen prompt
    // projection intentionally omits it from the model-facing contract.
    contract: { packet, issueId: packet.issueId },
  })
  const markerIndex = prompt.lastIndexOf(MODEL_PACKET_LINE_MARKER)
  if (markerIndex < 0) throw new Error('targeted semantic prompt packet marker is missing')

  const prefix = prompt.slice(0, markerIndex)
  const rawContract = prompt.slice(markerIndex + MODEL_PACKET_LINE_MARKER.length)
  let contract: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawContract)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('contract is not an object')
    contract = parsed as Record<string, unknown>
  } catch {
    throw new Error('targeted semantic prompt packet contract is invalid')
  }

  const modelPacket = contract.packet
  if (!modelPacket || typeof modelPacket !== 'object' || Array.isArray(modelPacket))
    throw new Error('targeted semantic prompt packet is missing')
  const modelSections = (modelPacket as Record<string, unknown>).sections
  if (!Array.isArray(modelSections) || modelSections.length !== packet.sections.length)
    throw new Error('targeted semantic prompt sections are not bound')

  const boundDigests = new Map<string, string>(packet.sections.map(section =>
    [`${section.ref.documentPath}\0${section.ref.sectionId}`, section.ref.digest] as const))
  const projectedSections = modelSections.map((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section))
      throw new Error(`targeted semantic prompt section ${index} is invalid`)
    const value = section as Record<string, unknown>
    if (typeof value.documentPath !== 'string' || typeof value.sectionId !== 'string')
      throw new Error(`targeted semantic prompt section ${index} has no reference`)
    const digest = boundDigests.get(`${value.documentPath}\0${value.sectionId}`)
    if (digest === undefined) throw new Error(`targeted semantic prompt section ${index} is outside packet authority`)
    return { ...value, digest }
  })

  ;(modelPacket as Record<string, unknown>).sections = projectedSections
  return `${prefix}\nFor a targeted FAIL diagnostic, copy each evidence reference and its exact bound SHA-256 digest from the assigned packet sections; never infer or invent a digest.${MODEL_PACKET_LINE_MARKER}${JSON.stringify(contract)}`
}
