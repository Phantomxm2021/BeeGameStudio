/**
 * Provider-independent admission measurement for structured worker output.
 *
 * Provider usage is retained as cost telemetry, but it is not a property of
 * the terminal business payload: one native session may emit several repair
 * attempts before producing the single structured value that we admit.
 */

export type FoundationFactBusinessPayload = Readonly<{
  status: string
  results: readonly unknown[]
}>

export type FoundationSemanticBusinessPayload = Readonly<{
  status: string
  outcome: string
  issues?: unknown
  reason?: unknown
}>

/**
 * Estimate structured-output tokens conservatively from its final JSON bytes.
 * Two UTF-8 bytes per estimated token is deliberately provider-independent
 * and conservative for multilingual content; JSON punctuation/field names
 * are included, while transport/session metadata is excluded by callers.
 */
export function estimateStructuredPayloadTokens(value: unknown): number {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('structured output payload is not serializable')
  return Math.ceil(Buffer.byteLength(serialized, 'utf8') / 2)
}

export function foundationFactBusinessPayload(input: {
  status: string
  results: readonly unknown[]
}): FoundationFactBusinessPayload {
  return { status: input.status, results: input.results }
}

export function foundationSemanticBusinessPayload(input: {
  status: string
  outcome: string
  issues?: unknown
  reason?: unknown
}): FoundationSemanticBusinessPayload {
  return {
    status: input.status,
    outcome: input.outcome,
    ...(input.issues !== undefined ? { issues: input.issues } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }
}
