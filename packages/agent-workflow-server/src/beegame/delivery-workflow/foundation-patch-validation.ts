import {
  buildFoundationFactPackets,
  extractSelectedFoundationFacts,
  validateFoundationFactResults,
  type FoundationFactPacket,
  type FoundationFactReceipt,
  type NormalizedFoundationExtraction,
} from './foundation-fact-extraction'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
  type FoundationFactStore,
} from './foundation-fact-store'
import {
  isFoundationFactKey,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import type { FoundationImpactAnalysis } from './foundation-impact-analysis'
import type { SectionRef } from './foundation-section-index'

type DocumentInput = ReadonlyMap<string, string> | Record<string, string>

export type FoundationImpactedFactRebuild = {
  factStore: FoundationFactStore
  packets: FoundationFactPacket[]
  extraction: NormalizedFoundationExtraction
  receipts: FoundationFactReceipt[]
}

type RebuildInputBase = {
  committedFactStore: readonly FoundationFact[]
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
  impact: FoundationImpactAnalysis
  revision: string
}

type RebuildInput =
  | (RebuildInputBase & { phase: 'plan'; results?: never })
  | (RebuildInputBase & {
      phase: 'admit'
      results: readonly FoundationFactReceipt[]
    })

function assertImpactKeys(
  value: FoundationImpactAnalysis['factKeys'],
): FoundationFactKey[] {
  if (!Array.isArray(value))
    throw new Error('foundation impact fact keys must be an array')
  if (new Set(value).size !== value.length)
    throw new Error('foundation impact fact keys must be unique')
  return value.map(key => {
    if (!isFoundationFactKey(key))
      throw new Error(`foundation impact contains an unknown fact key: ${String(key)}`)
    return key
  })
}

function validateResultScope(
  results: readonly FoundationFactReceipt[],
  impactedKeys: readonly FoundationFactKey[],
  mechanicalKeys: ReadonlySet<FoundationFactKey>,
): void {
  const impacted = new Set(impactedKeys)
  const seen = new Set<string>()
  for (const result of results) {
    if (!result || typeof result !== 'object' || !isFoundationFactKey(result.key))
      throw new Error(`foundation impacted result is outside the requested impact: ${String(result?.key)}`)
    if (!impacted.has(result.key))
      throw new Error(`foundation impacted result is outside the requested impact: ${result.key}`)
    if (mechanicalKeys.has(result.key))
      throw new Error(`foundation impacted result is extra for mechanically resolved key: ${result.key}`)
    if (seen.has(result.key))
      throw new Error(`duplicate foundation impacted result: ${result.key}`)
    seen.add(result.key)
  }
}

/**
 * Rebuilds exactly the facts named by a validated impact. Mechanical facts are
 * extracted from staged owner sections first; unresolved keys are admitted
 * only through the existing packet/result validator. The returned store is a
 * canonical replacement of impacted keys plus untouched committed facts.
 */
export function rebuildFoundationImpactedFacts(
  input: RebuildInput,
): FoundationImpactedFactRebuild {
  const request = input
  if (request.phase !== 'plan' && request.phase !== 'admit')
    throw new Error('foundation impacted fact rebuild phase is invalid')
  if (request.phase === 'plan' && request.results !== undefined)
    throw new Error('foundation fact planning does not accept results')
  if (request.phase === 'admit' && request.results === undefined)
    throw new Error('foundation fact admission requires results')
  const committed = createFoundationFactStore(input.committedFactStore)
  const impactedKeys = assertImpactKeys(input.impact.factKeys)
  const results = request.phase === 'admit' ? request.results : []
  if (request.phase === 'admit')
    validateResultScope(results, impactedKeys, new Set())

  // An empty impact is a real no-op. Do not inspect staged documents or create
  // packets, but still reject an attempted result outside the empty scope.
  if (impactedKeys.length === 0) {
    const extraction: NormalizedFoundationExtraction = {
      facts: [],
      receipts: [],
      unresolvedKeys: [],
      normalizedFactDigest: digestFactStore([]),
    }
    return {
      factStore: committed,
      packets: [],
      extraction,
      receipts: [],
    }
  }

  const extraction = extractSelectedFoundationFacts({
    keys: impactedKeys,
    documents: input.documents,
    sectionIndex: input.sectionIndex,
  })
  const mechanicalKeys = new Set(
    extraction.facts.map(fact => fact.key as FoundationFactKey),
  )
  validateResultScope(results, impactedKeys, mechanicalKeys)

  const packets = buildFoundationFactPackets({
    revision: input.revision,
    documents: input.documents,
    sectionIndex: input.sectionIndex,
    unresolvedKeys: extraction.unresolvedKeys,
  })
  if (request.phase === 'plan')
    return {
      factStore: committed,
      packets,
      extraction,
      receipts: [...extraction.receipts],
    }
  const admitted: FoundationFact[] = []
  const receipts = [...extraction.receipts]
  for (const packet of packets) {
    const packetResults = results.filter(result => packet.keys.includes(result.key))
    const validated = validateFoundationFactResults({
      packet,
      expectedRevision: input.revision,
      documents: input.documents,
      sectionIndex: input.sectionIndex,
      results: packetResults,
    })
    admitted.push(...validated.facts)
    receipts.push(...validated.receipts)
  }

  const rebuiltKeys = new Set(impactedKeys)
  const untouched = committed.filter(fact => !rebuiltKeys.has(fact.key as FoundationFactKey))
  const factStore = createFoundationFactStore([
    ...untouched,
    ...extraction.facts,
    ...admitted,
  ])
  return { factStore, packets, extraction, receipts }
}
