import type { ReviewerInfrastructure } from '../initial-lifecycle'
type Input = Parameters<ReviewerInfrastructure['billing']['submitUsage']>[0]
export function offlineReviewerBilling(ownerId: string) {
  const recorded = new Map<string, Input>()
  let available = true
  return {
    recorded, setAvailable(value: boolean) { available = value },
    client: { protocolVersion: 1 as const, ownerId, async submitUsage(input: Input) {
      if (!available) throw new Error('offline billing unavailable')
      const previous = recorded.get(input.eventId)
      if (previous && JSON.stringify(previous) !== JSON.stringify(input)) throw new Error('conflicting billing fact')
      recorded.set(input.eventId, structuredClone(input))
      const common = { protocolVersion: 1 as const, ownerId, eventId: input.eventId, idempotencyKey: input.eventId,
        pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: { ...input.usage } }
      if (input.usage.total_tokens === 0) return { ...common, skipped: true as const, duplicate: false as const }
      const record = { eventId: input.eventId, duplicate: Boolean(previous), weightedTokensDelta: 1, creditsMicro: 1 }
      return { ...common, duplicate: Boolean(previous), recorded: record, debited: { ...record } }
    } },
  }
}
