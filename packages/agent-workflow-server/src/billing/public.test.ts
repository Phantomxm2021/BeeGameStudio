import { describe, expect, test } from 'bun:test'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
  BeeGameUsageBillingUsage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import {
  createUsageBillingClient,
  USAGE_BILLING_PRICING_VERSION,
  USAGE_BILLING_PROTOCOL_VERSION,
  USAGE_BILLING_SOURCE,
  type UsageBillingInput,
} from './public'

const usage: BeeGameUsageBillingUsage = {
  prompt_tokens: 10,
  completion_tokens: 20,
  cache_read_tokens: 3,
  cache_creation_tokens: 4,
  total_tokens: 37,
}

function result(
  input: BeeGameUsageBillingRecordInput,
  id: string,
  duplicate = false,
): BeeGameUsageBillingRecordResult {
  return {
    duplicate,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: 'owner-1',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? USAGE_BILLING_PRICING_VERSION,
      usageSource: input.usageSource ?? USAGE_BILLING_SOURCE,
      usage: input.usage,
      delta: input.usage,
      weightedTokens: 7,
      weightedTokensDelta: 7,
      creditsMicro: 700,
      createdAt: '2026-09-05T00:00:00.000Z',
      metadata: input.metadata ?? {},
    },
    cumulativeUsage: input.usage,
    cumulativeWeightedTokens: 7,
    creditsMicro: 700,
  }
}

function input(overrides: Partial<UsageBillingInput> = {}): UsageBillingInput {
  return {
    ownerId: 'owner-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    eventId: 'event-1',
    usage: { ...usage },
    metadata: { terminal: { kind: 'turn.completed' } },
    ...overrides,
  }
}

function fakeClient(
  calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }>,
  debit: () => Promise<BeeGameUsageBillingRecordResult>,
): BeeGameUsageBillingClient {
  return {
    async recordUsage(ownerId, recordInput) {
      calls.push({ method: 'record', ownerId, input: recordInput })
      return result(recordInput, 'record-event')
    },
    async debitRealTimeUsage(ownerId, recordInput) {
      calls.push({ method: 'debit', ownerId, input: recordInput })
      return debit()
    },
  }
}

describe('public bounded usage billing client', () => {
  test('binds owner and submits canonical record then debit facts', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const client = createUsageBillingClient({
      ownerId: 'owner-1',
      billingClient: fakeClient(calls, async () => result(calls[1].input, 'debit-event')),
    })

    expect(client.protocolVersion).toBe(USAGE_BILLING_PROTOCOL_VERSION)
    expect(client.ownerId).toBe('owner-1')
    const receipt = await client.submitUsage(input())

    expect(calls.map(call => call.method)).toEqual(['record', 'debit'])
    expect(calls.map(call => call.ownerId)).toEqual(['owner-1', 'owner-1'])
    expect(calls[0].input).toMatchObject({
      sessionId: 'session-1',
      projectId: 'project-1',
      turnId: 'turn-1',
      idempotencyKey: 'event-1',
      pricingVersion: 'weighted-v1',
      usageSource: 'runtime_snapshot',
      usage,
    })
    expect(calls[1].input).toEqual(calls[0].input)
    expect(receipt).toMatchObject({
      protocolVersion: 1,
      ownerId: 'owner-1',
      eventId: 'event-1',
      idempotencyKey: 'event-1',
      duplicate: false,
      recorded: { eventId: 'record-event', duplicate: false },
      debited: { eventId: 'debit-event', duplicate: false },
    })
  })

  test('deep-copies public usage and metadata before calling the authority', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: fakeClient(calls, async () => result(calls[1].input, 'debit-event')) })
    const original = input()
    const pending = client.submitUsage(original)

    original.eventId = 'mutated-event'
    original.sessionId = 'mutated-session'
    original.usage.total_tokens = 999
    ;(original.metadata as { terminal: { kind: string } }).terminal.kind = 'mutated'
    await pending

    expect(calls.map(call => call.input.idempotencyKey)).toEqual(['event-1', 'event-1'])
    expect(calls.map(call => call.input.sessionId)).toEqual(['session-1', 'session-1'])
    expect(calls[0].input.usage.total_tokens).toBe(37)
    expect(calls[0].input.metadata).toEqual({ terminal: { kind: 'turn.completed' } })
  })

  test('gives debit a fresh copy when record backend mutates its request', async () => {
    let debitInput: BeeGameUsageBillingRecordInput | undefined
    const authority: BeeGameUsageBillingClient = {
      async recordUsage(_ownerId, recordInput) {
        recordInput.usage.total_tokens = 999
        ;(recordInput.metadata as { terminal: { kind: string } }).terminal.kind = 'backend-mutated'
        return result(recordInput, 'record-event')
      },
      async debitRealTimeUsage(_ownerId, recordInput) {
        debitInput = recordInput
        return result(recordInput, 'debit-event')
      },
    }
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: authority })
    const receipt = await client.submitUsage(input())

    expect(debitInput?.usage).toEqual(usage)
    expect(debitInput?.metadata).toEqual({ terminal: { kind: 'turn.completed' } })
    expect(receipt.usage).toEqual(usage)
  })

  test('same eventId is replay-safe after a partial record/debit failure', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    let debitAttempt = 0
    const authority: BeeGameUsageBillingClient = fakeClient(calls, async () => {
      debitAttempt += 1
      if (debitAttempt === 1) throw new Error('temporary debit failure')
      return result(calls[calls.length - 1].input, 'debit-event', true)
    })
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: authority })

    await expect(client.submitUsage(input())).rejects.toThrow('Usage billing submission failed')
    const second = await client.submitUsage(input())

    expect(calls.map(call => call.method)).toEqual(['record', 'debit', 'record', 'debit'])
    expect(calls.map(call => call.input.idempotencyKey)).toEqual([
      'event-1', 'event-1', 'event-1', 'event-1',
    ])
    expect(second).toMatchObject({
      duplicate: true,
      recorded: { duplicate: false },
      debited: { duplicate: true },
    })
  })

  test('rejects a foreign owner before invoking billing authority', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: fakeClient(calls, async () => result(calls[1].input, 'debit-event')) })
    await expect(client.submitUsage(input({ ownerId: 'owner-2' }))).rejects.toThrow('ownerId')
    expect(calls).toHaveLength(0)
  })

  test('rejects extra factory and request fields', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const billingClient = fakeClient(calls, async () => result(calls[1].input, 'debit-event'))
    expect(() => createUsageBillingClient({
      ownerId: 'owner-1',
      billingClient,
      unexpected: true,
    } as never)).toThrow('Unexpected factory options field: unexpected')
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient })
    await expect(client.submitUsage({ ...input(), unexpected: true } as never)).rejects.toThrow(
      'Unexpected usage input field: unexpected',
    )
    expect(calls).toHaveLength(0)
  })

  test('preserves the legacy zero-token no-submit rule', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: fakeClient(calls, async () => result(calls[1].input, 'debit-event')) })
    const skipped = await client.submitUsage(input({ usage: { ...usage, total_tokens: 0 } }))

    expect(calls).toHaveLength(0)
    expect(skipped).toMatchObject({ skipped: true, duplicate: false, eventId: 'event-1' })
  })

  test('rejects non-JSON metadata rather than passing mutable authority input through', async () => {
    const calls: Array<{ method: string; ownerId: string; input: BeeGameUsageBillingRecordInput }> = []
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: fakeClient(calls, async () => result(calls[1].input, 'debit-event')) })
    await expect(client.submitUsage(input({ metadata: { bad: new Date() } }))).rejects.toThrow('plain JSON')
    expect(calls).toHaveLength(0)
  })

  test('redacts backend errors with a stable public message', async () => {
    const secret = 'supabase token and internal SQL detail'
    const authority: BeeGameUsageBillingClient = {
      async recordUsage() {
        throw new Error(secret)
      },
      async debitRealTimeUsage() {
        throw new Error(secret)
      },
    }
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: authority })
    let error: Error | undefined
    try {
      await client.submitUsage(input())
    } catch (value) {
      error = value as Error
    }
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('Usage billing submission failed')
    expect(error?.message).not.toContain(secret)
  })

  test('redacts a debit error after record succeeds without retrying', async () => {
    const calls: string[] = []
    const authority: BeeGameUsageBillingClient = {
      async recordUsage(_ownerId, recordInput) {
        calls.push('record')
        return result(recordInput, 'record-event')
      },
      async debitRealTimeUsage() {
        calls.push('debit')
        throw new Error('private debit failure')
      },
    }
    const client = createUsageBillingClient({ ownerId: 'owner-1', billingClient: authority })
    await expect(client.submitUsage(input())).rejects.toThrow('Usage billing submission failed')
    expect(calls).toEqual(['record', 'debit'])
  })
})
