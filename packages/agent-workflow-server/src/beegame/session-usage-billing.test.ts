import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendChatTranscript } from './project-records'
import { BeeGameSessionManager, getLatestRuntimeUsage, getRuntimeUsageForTurn, type BeeGameSessionRunner, type BeeGameSessionRuntime,
  type BeeGameSessionUsageBillingBackend } from './session-manager'

test('cumulative live and saved usage retains an earlier missing receipt after a complete response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-partial-history-'))
  let calls = 0
  const manager = new BeeGameSessionManager({ async start(input) { return { stop() {}, async submit() {
    const incomplete = calls++ === 0
    input.onNativeUsage?.({ prompt_tokens: incomplete ? 0 : 100, completion_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: incomplete ? 0 : 100 }, 'fixture', { incomplete })
  } } } }, root, () => ({}))
  try {
    const session = manager.start({ workspacePath: root, userId: 'fixture' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    await manager.sendWithDisplay(session.id, 'Second'); await manager.waitForSessionIdle(session.id)
    const last = manager.transcript(session.id).filter(event => event.type === 'usage').at(-1)!
    expect(last.payload).toMatchObject({ providerUsageIncomplete: true, sessionUsage: { total_tokens: 100 } })
    expect(manager.transcriptFacts(session.id).filter(event => event.type === 'usage').at(-1)?.payload)
      .toMatchObject({ providerUsageIncomplete: true })
    expect(manager.runtimeSnapshot(session.id).providerUsageIncomplete).toBe(true)
    await manager.dispose()
    const recovered = new BeeGameSessionManager({ async start() { throw Error('Recovery must not start a model') } }, root, () => ({}))
    try {
      expect(recovered.runtimeSnapshot(session.id, root)).toMatchObject({
        providerUsageIncomplete: true, usage: { total_tokens: 100 },
      })
    } finally { await recovered.dispose() }
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('incomplete provider usage persists known tokens and retains unknown zero receipts for reconciliation', async () => {
  for (const knownTokens of [100, 0]) {
    const root = await mkdtemp(join(tmpdir(), 'bgs-partial-provider-bill-'))
    const writes: Array<Parameters<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>[1]> = []
    const manager = new BeeGameSessionManager({ async start(input) { return { stop() {}, async submit() {
      input.onNativeUsage?.({ prompt_tokens: knownTokens, completion_tokens: 0, cache_read_tokens: 0,
        cache_creation_tokens: 0, total_tokens: knownTokens }, 'synthetic-provider', { incomplete: true })
      throw Error('Synthetic provider disconnected')
    } } } }, root, () => ({}), {
      recordUsage(owner, input) {
        writes.push(input)
        return { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: knownTokens, creditsMicro: knownTokens,
          event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
            pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage, delta: input.usage,
            weightedTokens: knownTokens, weightedTokensDelta: knownTokens, creditsMicro: knownTokens,
            createdAt: new Date().toISOString(), metadata: input.metadata ?? {} } }
      },
    })
    try {
      const session = manager.start({ workspacePath: root, userId: 'fixture' })
      await manager.sendWithDisplay(session.id, 'Offline failure fixture')
      await manager.waitForSessionIdle(session.id)
      await manager.dispose()
      expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(knownTokens)
      expect(writes).toHaveLength(2) // Receipt checkpoint and terminal reconciliation.
      for (const write of writes) {
        expect(write.usage.total_tokens).toBe(knownTokens)
        expect(write.metadata?.providerUsageIncomplete).toBe(true)
        expect(write.metadata?.billableFinalUsage).toBeUndefined()
      }
      expect(manager.transcriptFacts(session.id).some(event => event.type === 'usage' &&
        event.payload?.providerUsageIncomplete === true)).toBe(true)
    } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
  }
})

test('failed terminal debit is retained and settled before the next turn bill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-pending-session-bill-'))
  type Receipt = Awaited<ReturnType<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>>
  const recorded = new Map<string, Receipt>(), debited = new Set<string>()
  let turn = 0, previous = 0, charged = 0, attempts = 0, available = false
  const manager = new BeeGameSessionManager({ async start(runtime) { return { stop() {}, async submit(input) {
    const total = ++turn === 1 ? 100 : 150
    runtime.onNativeUsage?.({ prompt_tokens: total, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: total })
    await input.onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Offline fixture' })
  } } } }, root, () => ({}), {
    recordUsage(owner, input) {
      const existing = recorded.get(input.idempotencyKey)
      if (existing) return { ...existing, duplicate: true }
      const total = input.usage.total_tokens, delta = total - previous
      previous = total
      const receipt: Receipt = { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: total, creditsMicro: total,
        event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
          pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage,
          delta: { ...input.usage, total_tokens: delta }, weightedTokens: total, weightedTokensDelta: delta,
          creditsMicro: delta, createdAt: new Date().toISOString(), metadata: {} } }
      recorded.set(input.idempotencyKey, receipt)
      return receipt
    },
    debitRealtimeUsage(_owner, input) {
      attempts++
      if (!available) throw new Error('Offline debit unavailable')
      const receipt = recorded.get(input.idempotencyKey)!
      if (debited.has(input.idempotencyKey)) return { ...receipt, duplicate: true }
      debited.add(input.idempotencyKey)
      charged += receipt.event.weightedTokensDelta
      return receipt
    },
  })
  try {
    const session = manager.start({ workspacePath: root, userId: 'fixture' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    for (let i = 0; i < 100 && attempts < 3; i++) await Bun.sleep(5)
    expect(attempts).toBeGreaterThanOrEqual(3)
    expect(charged).toBe(0)
    expect((await readdir(join(root, 'session-usage-outbox'))).length).toBeGreaterThan(0)
    available = true
    await manager.sendWithDisplay(session.id, 'Second'); await manager.waitForSessionIdle(session.id)
    await manager.dispose()
    expect(previous).toBe(150)
    expect(charged).toBe(150)
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('native receipts debit during a tool-only turn and settle a later failure without double charging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-live-session-bill-'))
  let release!: () => void, checkpoint!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const observed = new Promise<void>(resolve => { checkpoint = resolve })
  let charged = 0, previous = 0
  const deltas: number[] = []
  const receipts = new Map<string, any>(), debited = new Set<string>()
  const manager = new BeeGameSessionManager({ async start(input) { return { stop() {}, async submit(turn) {
    const receipt = { prompt_tokens: 100, completion_tokens: 20, cache_read_tokens: 400, cache_creation_tokens: 0, total_tokens: 520 }
    input.onNativeUsage?.(receipt, 'fixture-provider')
    input.onNativeUsage?.(receipt, 'fixture-provider') // Duplicate receipt.
    input.onNativeUsage?.({ ...receipt, prompt_tokens: 90, total_tokens: 510 }, 'fixture-provider') // Older receipt.
    await turn.onMessage({ type: 'runtime_event', eventType: 'tool.completed', text: 'Working' })
    checkpoint()
    await gate
    input.onNativeUsage?.({ prompt_tokens: 150, completion_tokens: 30, cache_read_tokens: 500, cache_creation_tokens: 0, total_tokens: 680 }, 'fixture-provider')
    throw new Error('Synthetic transport failure after acknowledged usage')
  } } } }, root, () => ({}), { recordUsage(owner, input) {
    const existing = receipts.get(input.idempotencyKey)
    if (existing) return { ...existing, duplicate: true }
    const delta = input.usage.total_tokens - previous
    previous = input.usage.total_tokens
    const receipt = { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: previous, creditsMicro: previous,
      event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
        pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage,
        delta: { ...input.usage, total_tokens: delta }, weightedTokens: previous, weightedTokensDelta: delta,
        creditsMicro: delta, createdAt: new Date().toISOString(), metadata: {} } }
    receipts.set(input.idempotencyKey, receipt)
    return receipt
  }, debitRealtimeUsage(owner, input) {
    const receipt = receipts.get(input.idempotencyKey)
    if (debited.has(input.idempotencyKey)) return { ...receipt, duplicate: true }
    debited.add(input.idempotencyKey)
    const delta = receipt.event.weightedTokensDelta
    charged += delta
    if (delta) deltas.push(delta)
    return { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: charged, creditsMicro: charged,
      event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
        pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage,
        delta: { ...input.usage, total_tokens: delta }, weightedTokens: charged, weightedTokensDelta: delta,
        creditsMicro: delta, createdAt: new Date().toISOString(), metadata: {} } }
  } })
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Work')
    await observed
    for (let i = 0; i < 100 && charged < 520; i++) await Bun.sleep(5)
    expect(charged).toBe(520)
    expect(manager.get(session.id)?.status).toBe('running')
    expect(manager.runtimeSnapshot(session.id).usage.cache_read_tokens).toBe(400)
    release()
    await manager.waitForSessionIdle(session.id)
    await manager.dispose()
    expect(charged).toBe(680)
    expect(deltas).toEqual([520, 160])
    expect(manager.transcriptFacts(session.id).some(event => event.type === 'turn.failed')).toBe(true)
  } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('saved SDK child progress remains readable without assigning unknown usage to the main agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-usage-history-'))
  const runner = { async start(): Promise<never> { throw Error('History must not start a model') } }
  const manager = new BeeGameSessionManager(runner, root, () => ({}))
  const recovered = new BeeGameSessionManager(runner, root, () => ({}))
  try {
    const session = manager.start({ workspacePath: root, userId: 'fixture' })
    const path = manager.metadata(session.id)!.transcriptPath
    await manager.dispose()
    let id = 100
    const append = (type: string, payload: Record<string, unknown>) => appendChatTranscript(path, {
      id: id++, sessionId: session.id, turnId: 'historical-turn', type, payload, text: '', createdAt: new Date(),
    })
    append('usage', { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: 'historical',
      usage: { prompt_tokens: 100, completion_tokens: 100, cache_read_tokens: 800, cache_creation_tokens: 0, total_tokens: 1000 } })
    for (const [subtype, tokens] of [['task_progress', 700], ['task_progress', 600], ['task_notification', 700]] as const)
      append('system.status', { type: 'system', subtype, task_id: 'child', tool_use_id: 'agent-call', usage: { total_tokens: tokens } })
    append('system.status', { type: 'system', subtype: 'task_progress', task_id: 'unfinished', tool_use_id: 'other-call', usage: { total_tokens: 100 } })
    const snapshot = recovered.runtimeSnapshot(session.id, root)
    expect(snapshot.usage.total_tokens).toBe(1000)
    expect(snapshot.roleTokens).toEqual({ mainAgent: 0, otherSubagents: 800, unattributed: 200 })
  } finally { await manager.dispose(); await recovered.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('receipts survive interruption, larger fresh counters and late BGS output without double billing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-interrupted-usage-'))
  const recorded: number[] = []
  let call = 0, starts = 0
  let ready!: () => void
  const interruptedUsageArrived = new Promise<void>(resolve => { ready = resolve })
  const usage = (input: number, output: number, cache: number) => ({ prompt_tokens: input,
    completion_tokens: output, cache_read_tokens: cache, cache_creation_tokens: 0, total_tokens: input + output + cache })
  const manager = new BeeGameSessionManager({ async start(input) {
    starts++
    const processNumber = starts
    let disposal: Promise<void> | undefined
    return { stop() {}, async submit(turn) {
      const n = ++call
      const current = n === 1 ? usage(10, 2, 100) : n === 2 ? usage(30, 5, 300) : n === 3 ? usage(50, 7, 500) : usage(60, 8, 600)
      input.onNativeUsage?.(current)
      input.onNativeUsage?.(current) // Repeated checkpoint.
      if (n === 2) {
        input.onNativeUsage?.(usage(20, 4, 200)) // Out-of-order stderr.
        ready()
        await new Promise<void>(resolve => turn.signal.addEventListener('abort', () => resolve(), { once: true }))
        await turn.onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Late cancelled output' })
        return
      }
      if (n === 4) input.onNativeUsage?.(usage(50, 7, 500)) // An older receipt arrives late.
      await turn.onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Fixture only' })
    }, dispose() {
      return disposal ??= (async () => {
        if (processNumber === 1 && call === 2) {
          // The last stderr accounting frame is delivered during shutdown,
          // after interruptTurn has already cleared record.runner.
          await Bun.sleep(10)
          input.onNativeUsage?.(usage(40, 6, 400))
        }
      })()
    } }
  } }, root, () => ({}), { recordUsage(owner, input) {
    const current = input.usage.total_tokens, previous = recorded.at(-1) ?? 0
    recorded.push(current)
    return { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: current, creditsMicro: current,
      event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
        turnId: input.turnId, pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage,
        delta: { ...input.usage, total_tokens: current - previous }, weightedTokens: current, weightedTokensDelta: current - previous,
        creditsMicro: current - previous, createdAt: new Date().toISOString(), metadata: input.metadata ?? {} } }
  } })
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    await manager.sendWithDisplay(session.id, 'Interrupted'); await interruptedUsageArrived
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(335)
    manager.interruptTurn(session.id); await manager.waitForSessionIdle(session.id)
    for (const label of ['New process', 'Same process']) {
      await manager.sendWithDisplay(session.id, label); await manager.waitForSessionIdle(session.id)
    }
    await manager.dispose()
    expect(starts).toBe(2)
    expect(manager.transcriptFacts(session.id).some(event => event.text === 'Late cancelled output')).toBe(false)
    expect(recorded.filter((total, index) => index === 0 || total !== recorded[index - 1])).toEqual([112, 335, 446, 1003, 1114])
    expect(manager.runtimeSnapshot(session.id, root).usage).toEqual(usage(100, 14, 1000))
    const receipt = manager.transcriptFacts(session.id).findLast(event =>
      event.type === 'usage' && event.payload?.subtype === 'native_accounting')
    expect(receipt?.payload?.usage).toEqual(usage(50, 7, 500)) // Raw late receipt remains diagnostic data.
    expect(receipt?.payload?.sessionUsage).toEqual(usage(100, 14, 1000))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('terminal runtime_snapshot submissions stay cumulative across large, small and reset native turns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-cumulative-billing-'))
  // BGS receipts are cumulative within an epoch. A new provider epoch may start lower.
  const nativeTotals = [100, 1_000, 1_200, 50]
  const recorded: number[] = [], debited: number[] = [], keys: string[] = []
  let index = 0, previous = 0, charged = 0
  const receipts = new Map<string, any>()
  const recordUsage: NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']> = (owner, input) => {
    const cached = receipts.get(input.idempotencyKey)
    if (cached) return { ...cached, duplicate: true }
    // Same cumulative-minus-previous contract as beegame_record_usage SQL.
    const current = input.usage.total_tokens
    const delta = current < previous ? current : current - previous
    previous = current; charged += delta; recorded.push(current); keys.push(input.idempotencyKey)
    expect(input.metadata?.providerCumulativeUsage).toEqual(input.usage)
    const receipt = { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: charged, creditsMicro: charged * 100,
      event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner,
        sessionId: input.sessionId, turnId: input.turnId, pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot',
        usage: input.usage, delta: { ...input.usage, total_tokens: delta }, weightedTokens: current,
        weightedTokensDelta: delta, creditsMicro: delta * 100, createdAt: new Date().toISOString(), metadata: input.metadata ?? {} } }
    receipts.set(input.idempotencyKey, receipt)
    return receipt
  }
  const manager = new BeeGameSessionManager({ async start(runtime) { return { stop() {}, async submit(turn) {
    const total = nativeTotals[index]!
    runtime.onNativeUsage?.({ prompt_tokens: total, completion_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: total }, index++ < 3 ? 'original-provider' : 'reset-provider')
    await turn.onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Synthetic usage only' })
  } } } }, root, () => ({}), { recordUsage, debitRealtimeUsage(owner, input) {
    debited.push(input.usage.total_tokens)
    return recordUsage(owner, input)
  } })
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    for (let count = 0; count < nativeTotals.length; count++) {
      await manager.sendWithDisplay(session.id, 'Synthetic turn')
      await manager.waitForSessionIdle(session.id)
    }
    await manager.dispose() // Also await pending billing writes.
    expect([...new Set(recorded)]).toEqual([100, 1_000, 1_200, 1_250])
    expect(debited).toEqual(recorded)
    expect(charged).toBe(1_250)
    expect(new Set(keys).size).toBe(keys.length) // Checkpoint and terminal writes have independent keys.
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

type SessionUsageBillingInput = Parameters<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>[1]
type SessionUsageBillingReceipt = Awaited<ReturnType<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>>
type SessionModelBillingSource = 'platform' | 'byok' | 'chatgpt-subscription'

const sessionUsage = (total_tokens: number) => ({
  prompt_tokens: total_tokens, completion_tokens: 0, cache_read_tokens: 0,
  cache_creation_tokens: 0, total_tokens,
})

function createSessionUsageBillingFixture() {
  const authorized: string[] = [], recorded: SessionUsageBillingInput[] = [], debited: SessionUsageBillingInput[] = []
  const receipts = new Map<string, SessionUsageBillingReceipt>()
  let cumulative = 0
  const receipt = (owner: string, input: SessionUsageBillingInput, delta: number): SessionUsageBillingReceipt => ({
    duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: cumulative,
    creditsMicro: cumulative,
    event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner,
      sessionId: input.sessionId, turnId: input.turnId, pricingVersion: 'fixture', usageSource: 'runtime_snapshot',
      usage: input.usage, delta: { ...input.usage, total_tokens: delta }, weightedTokens: cumulative,
      weightedTokensDelta: delta, creditsMicro: delta, createdAt: new Date().toISOString(), metadata: input.metadata ?? {} },
  })
  const recordUsage: NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']> = (owner, input) => {
    // SQL uses this metadata field as the next cumulative billing baseline.
    expect(input.metadata?.providerCumulativeUsage).toEqual(input.usage)
    const existing = receipts.get(input.idempotencyKey)
    if (existing) return { ...existing, duplicate: true }
    const delta = Math.max(0, input.usage.total_tokens - cumulative)
    cumulative = input.usage.total_tokens
    const result = receipt(owner, input, delta)
    receipts.set(input.idempotencyKey, result)
    recorded.push(input)
    return result
  }
  const debitRealtimeUsage: NonNullable<BeeGameSessionUsageBillingBackend['debitRealtimeUsage']> = (owner, input) => {
    const result = receipts.get(input.idempotencyKey)
    if (!result) throw Error(`Missing fixture receipt for ${input.idempotencyKey}`)
    debited.push(input)
    return { ...result, duplicate: false }
  }
  return { backend: { assertUsageAvailable: async (owner: string) => { authorized.push(owner) }, recordUsage, debitRealtimeUsage },
    authorized, recorded, debited }
}

test('platform and personal turns share a native epoch while only platform deltas bill across refresh and resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-personal-session-bill-'))
  const billing = createSessionUsageBillingFixture()
  let source: SessionModelBillingSource = 'platform'
  const sourceCalls: SessionModelBillingSource[] = []
  let starts = 0
  const nativeTotals = [100, 250, 400, 550, 600]
  const runner = { async start(input: Parameters<BeeGameSessionRunner['start']>[0]) {
    const total = nativeTotals[starts++]!
    return { stop() {}, async submit(turn: Parameters<BeeGameSessionRuntime['submit']>[0]) {
      const current = sessionUsage(total)
      input.onNativeUsage?.(current, 'bgs:thread')
      input.onNativeUsage?.(current, 'bgs:thread')
      await turn.onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: 'Fixture turn complete' })
    } }
  } }
  const getAdditionalRuntimeEnv = () => {
    sourceCalls.push(source)
    return { BEEGAME_MODEL_BILLING_SOURCE: source }
  }
  const manager = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Platform turn')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(100)

    source = 'byok'
    const recordsBeforePersonal = billing.recorded.length, debitsBeforePersonal = billing.debited.length
    await manager.sendWithDisplay(session.id, 'Personal turn')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(250)
    expect(billing.recorded.length).toBe(recordsBeforePersonal)
    expect(billing.debited.length).toBe(debitsBeforePersonal)
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])

    source = 'chatgpt-subscription'
    expect(manager.refreshIdleRunners()).toBe(1)
    const recordsBeforeSubscription = billing.recorded.length, debitsBeforeSubscription = billing.debited.length
    await manager.sendWithDisplay(session.id, 'Subscription turn')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(400)
    expect(billing.recorded.length).toBe(recordsBeforeSubscription)
    expect(billing.debited.length).toBe(debitsBeforeSubscription)
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])

    source = 'platform'
    expect(manager.refreshIdleRunners()).toBe(1)
    await manager.sendWithDisplay(session.id, 'Platform turn after personal')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(550)
    await manager.dispose()

    const resumed = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
    try {
      const recovered = resumed.start({ workspacePath: root, userId: 'owner', transcriptSessionId: session.id })
      await resumed.sendWithDisplay(recovered.id, 'Platform turn after restart')
      await resumed.waitForSessionIdle(recovered.id)
      await resumed.dispose()
      expect(resumed.runtimeSnapshot(session.id, root).usage.total_tokens).toBe(600)
    } finally { await resumed.dispose() }

    expect(starts).toBe(5)
    expect(sourceCalls).toEqual(['platform', 'byok', 'chatgpt-subscription', 'platform', 'platform'])
    expect(billing.authorized).toEqual(['owner', 'owner', 'owner'])
    expect([...new Set(billing.recorded.map(input => input.usage.total_tokens))]).toEqual([100, 250, 300])
    expect([...new Set(billing.debited.map(input => input.usage.total_tokens))]).toEqual([100, 250, 300])
    const finalBill = billing.recorded.findLast(input => input.metadata?.billableFinalUsage)
    expect((finalBill?.metadata?.billableFinalUsage as { total_tokens?: number } | undefined)?.total_tokens).toBe(300)
    const usageEvents = resumed.transcriptFacts(session.id).filter(event =>
      event.type === 'usage' && event.payload?.subtype === 'native_accounting')
    expect(new Set(usageEvents.map(event => event.payload?.billingSource))).toEqual(new Set(['platform', 'byok', 'chatgpt-subscription']))
    expect(usageEvents.every(event => event.payload?.nativeAccountingEpoch === 'bgs:thread')).toBe(true)
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('incomplete or failed personal receipts remain nonbillable and do not poison the next platform bill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-personal-incomplete-bill-'))
  const billing = createSessionUsageBillingFixture()
  let source: SessionModelBillingSource = 'chatgpt-subscription'
  let turn = 0
  const runner = { async start(input: Parameters<BeeGameSessionRunner['start']>[0]) {
    return { stop() {}, async submit(turnInput: Parameters<BeeGameSessionRuntime['submit']>[0]) {
      const total = ++turn * 100
      if (turn <= 2) input.onNativeUsage?.(sessionUsage(total), 'bgs:thread', { incomplete: true })
      else input.onNativeUsage?.(sessionUsage(total), 'bgs:thread')
      if (turn === 2) throw Error('Synthetic personal transport failure')
      if (turn === 1) await turnInput.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Personal completed' })
      if (turn === 3) await turnInput.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Platform recovery' })
    } }
  } }
  billing.backend.assertUsageAvailable = async (owner: string) => {
    billing.authorized.push(owner)
    if (source !== 'platform') throw Error('No platform Credits available')
  }
  const manager = new BeeGameSessionManager(runner, root, () => ({ BEEGAME_MODEL_BILLING_SOURCE: source }), billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Personal incomplete')
    await manager.waitForSessionIdle(session.id)
    expect(billing.authorized).toEqual([])
    expect(manager.transcriptFacts(session.id).some(event => event.type === 'turn.completed')).toBe(true)
    await manager.sendWithDisplay(session.id, 'Personal failed')
    await manager.waitForSessionIdle(session.id)
    expect(billing.recorded).toEqual([])
    expect(billing.debited).toEqual([])
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])

    source = 'platform'
    manager.refreshIdleRunners()
    await manager.sendWithDisplay(session.id, 'Platform recovery')
    await manager.waitForSessionIdle(session.id)
    await manager.dispose()

    expect(billing.authorized).toEqual(['owner'])
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(300)
    expect([...new Set(billing.recorded.map(input => input.usage.total_tokens))]).toEqual([100])
    expect([...new Set(billing.debited.map(input => input.usage.total_tokens))]).toEqual([100])
    const platformWrites = billing.recorded.filter(input => input.usage.total_tokens === 100)
    expect(platformWrites.length).toBeGreaterThan(0)
    expect(platformWrites.every(input => input.metadata?.providerUsageIncomplete === undefined)).toBe(true)
    expect(platformWrites.every(input =>
      (input.metadata?.billableFinalUsage as { total_tokens?: number } | undefined)?.total_tokens === 100)).toBe(true)
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('baseline-only bridge replay advances a shared epoch without charging or double-counting personal usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-baseline-replay-bill-'))
  const billing = createSessionUsageBillingFixture()
  let source: SessionModelBillingSource = 'byok'
  const sourceCalls: SessionModelBillingSource[] = []
  let starts = 0
  const runner = { async start(input: Parameters<BeeGameSessionRunner['start']>[0]) {
    const turn = ++starts
    return { stop() {}, async submit(turnInput: Parameters<BeeGameSessionRuntime['submit']>[0]) {
      if (turn === 1) {
        input.onNativeUsage?.(sessionUsage(100), 'provider:epoch')
        input.onNativeUsage?.(sessionUsage(100), 'bgs:thread', { baselineOnly: true })
      } else {
        input.onNativeUsage?.(sessionUsage(200), 'bgs:thread')
      }
      await turnInput.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Baseline replay fixture' })
    } }
  } }
  const getAdditionalRuntimeEnv = () => {
    sourceCalls.push(source)
    return { BEEGAME_MODEL_BILLING_SOURCE: source }
  }
  const manager = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Personal converted provider')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(100)
    expect(billing.authorized).toEqual([])
    expect(billing.recorded).toEqual([])
    expect(billing.debited).toEqual([])
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])

    source = 'platform'
    await manager.sendWithDisplay(session.id, 'Platform native continuation')
    await manager.waitForSessionIdle(session.id)
    await manager.dispose()

    expect(starts).toBe(2)
    expect(sourceCalls).toEqual(['byok', 'platform'])
    expect(billing.authorized).toEqual(['owner'])
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(200)
    expect([...new Set(billing.recorded.map(input => input.usage.total_tokens))]).toEqual([100])
    expect([...new Set(billing.debited.map(input => input.usage.total_tokens))]).toEqual([100])
    const platformBill = billing.recorded.findLast(input => input.metadata?.billableFinalUsage)
    expect((platformBill?.metadata?.sessionCumulativeUsage as { total_tokens?: number } | undefined)?.total_tokens).toBe(200)
    expect((platformBill?.metadata?.billableFinalUsage as { total_tokens?: number } | undefined)?.total_tokens).toBe(100)
    const usageEvents = manager.transcriptFacts(session.id).filter(event =>
      event.type === 'usage' && event.payload?.subtype === 'native_accounting')
    expect(usageEvents.some(event => event.payload?.nativeAccountingEpoch === 'provider:epoch' &&
      event.payload?.billingSource === 'byok' && event.payload?.usageBaselineOnly !== true)).toBe(true)
    expect(usageEvents.some(event => event.payload?.nativeAccountingEpoch === 'bgs:thread' &&
      event.payload?.billingSource === 'byok' && event.payload?.usageBaselineOnly === true)).toBe(true)
    expect(usageEvents.some(event => event.payload?.nativeAccountingEpoch === 'bgs:thread' &&
      event.payload?.billingSource === 'platform' && event.payload?.usageBaselineOnly !== true)).toBe(true)

    const resumed = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
    try {
      resumed.start({ workspacePath: root, userId: 'owner', transcriptSessionId: session.id })
      expect(resumed.runtimeSnapshot(session.id, root).usage.total_tokens).toBe(200)
      expect(starts).toBe(2)
    } finally { await resumed.dispose() }
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('cold resume keeps a lost personal receipt nonbillable while billing the live platform increment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-replayed-personal-bill-'))
  const billing = createSessionUsageBillingFixture()
  let source: SessionModelBillingSource = 'byok'
  const sourceCalls: SessionModelBillingSource[] = []
  let starts = 0
  const runner = { async start(input: Parameters<BeeGameSessionRunner['start']>[0]) {
    starts++
    if (input.resumeSessionId) input.onNativeUsage?.(sessionUsage(100), 'bgs:thread', { replayed: true })
    return { stop() {}, async submit(turnInput: Parameters<BeeGameSessionRuntime['submit']>[0]) {
      if (input.resumeSessionId) input.onNativeUsage?.(sessionUsage(150), 'bgs:thread')
      await turnInput.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Cold resume fixture' })
    } }
  } }
  const getAdditionalRuntimeEnv = () => {
    sourceCalls.push(source)
    return { BEEGAME_MODEL_BILLING_SOURCE: source }
  }
  const manager = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Personal turn with lost usage receipt')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id).usage.total_tokens).toBe(0)
    expect(billing.recorded).toEqual([])
    expect(billing.debited).toEqual([])
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
    await manager.dispose()

    source = 'platform'
    const resumed = new BeeGameSessionManager(runner, root, getAdditionalRuntimeEnv, billing.backend)
    try {
      const recovered = resumed.start({ workspacePath: root, userId: 'owner', transcriptSessionId: session.id,
        resumeNativeSessionId: 'native-session' })
      await resumed.sendWithDisplay(recovered.id, 'Platform turn after cold resume')
      await resumed.waitForSessionIdle(recovered.id)
      await resumed.dispose()
      expect(resumed.runtimeSnapshot(session.id, root).usage.total_tokens).toBe(150)

      expect(starts).toBe(2)
      expect(sourceCalls).toEqual(['byok', 'platform'])
      expect(billing.authorized).toEqual(['owner'])
      expect([...new Set(billing.recorded.map(input => input.usage.total_tokens))]).toEqual([50])
      expect([...new Set(billing.debited.map(input => input.usage.total_tokens))]).toEqual([50])
      const platformBill = billing.recorded.findLast(input => input.metadata?.billableFinalUsage)
      expect((platformBill?.metadata?.sessionCumulativeUsage as { total_tokens?: number } | undefined)?.total_tokens).toBe(150)
      expect((platformBill?.metadata?.billableFinalUsage as { total_tokens?: number } | undefined)?.total_tokens).toBe(50)
      const usageEvents = resumed.transcriptFacts(session.id).filter(event =>
        event.type === 'usage' && event.payload?.subtype === 'native_accounting')
      expect(usageEvents.filter(event => event.payload?.billingSource === 'byok').map(event => event.payload?.usage))
        .toContainEqual(expect.objectContaining({ total_tokens: 100 }))
      expect(usageEvents.filter(event => event.payload?.billingSource === 'platform').map(event => event.payload?.usage))
        .toContainEqual(expect.objectContaining({ total_tokens: 150 }))
      expect(usageEvents.every(event => event.payload?.nativeAccountingEpoch === 'bgs:thread')).toBe(true)
    } finally { await resumed.dispose() }
    expect(await readdir(join(root, 'session-usage-outbox'))).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})


for (const source of ['platform', 'byok'] as const) test(`recovered ${source} usage belongs to the original turn after cold resume`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-usage-attribution-'))
  const billing = createSessionUsageBillingFixture()
  const runner: BeeGameSessionRunner = { async start(input) {
    input.onNativeSessionId?.('native-fixture')
    if (input.resumeSessionId) {
      // Both duplicate replay and a smaller out-of-order checkpoint remain
      // historical; neither creates another charge or a new-turn increment.
      for (const total of [150, 150, 140]) input.onNativeUsage?.(sessionUsage(total), 'bgs:native-fixture',
        { replayed: true, nativeTurnId: 'native-old' })
    }
    return { stop() {}, async submit(turn) {
      input.onNativeUsage?.(sessionUsage(input.resumeSessionId ? 180 : 100), 'bgs:native-fixture',
        { nativeTurnId: input.resumeSessionId ? 'native-new' : 'native-old' })
      if (!input.resumeSessionId) throw Error('Synthetic interrupted turn')
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Fixture completed' })
    } }
  } }
  const env = () => ({ BEEGAME_MODEL_BILLING_SOURCE: source })
  let manager = new BeeGameSessionManager(runner, root, env, billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    const oldTurn = manager.transcriptFacts(session.id).find(event => event.type === 'turn.started')!.turnId!
    expect(getRuntimeUsageForTurn(manager.transcriptFacts(session.id), oldTurn).total_tokens).toBe(100)
    await manager.dispose()
    const originalEvents = manager.transcriptFacts(session.id)
    const originalPrefix = JSON.stringify(originalEvents)
    manager = new BeeGameSessionManager(runner, root, env, billing.backend)
    manager.start({ workspacePath: root, userId: 'owner', transcriptSessionId: session.id })
    await manager.sendWithDisplay(session.id, 'Continue'); await manager.waitForSessionIdle(session.id)
    const events = manager.transcriptFacts(session.id)
    const newTurn = events.findLast(event => event.type === 'turn.started')!.turnId!
    expect(JSON.stringify(events.slice(0, originalEvents.length))).toBe(originalPrefix)
    expect(getRuntimeUsageForTurn(events, oldTurn).total_tokens).toBe(150)
    expect(getRuntimeUsageForTurn(events, newTurn).total_tokens).toBe(30)
    expect(manager.runtimeSnapshot(session.id)).toMatchObject({ usage: { total_tokens: 180 },
      turnDiagnostics: { turnId: newTurn, usage: { total_tokens: 30 } } })
    expect(events.filter(event => event.payload?.usageReplayed === true)).toHaveLength(3)
    expect(events.filter(event => event.payload?.usageReplayed === true).every(event =>
      event.payload?.usageAttributedTurnId === oldTurn && event.turnId === newTurn)).toBe(true)
    if (source === 'platform') {
      expect(billing.recorded.some(entry => entry.usage.total_tokens === 150 && entry.turnId === oldTurn)).toBe(true)
      expect(billing.recorded.filter(entry => entry.usage.total_tokens === 150).every(entry => entry.turnId === oldTurn)).toBe(true)
      expect(billing.recorded.filter(entry => entry.turnId === newTurn).every(entry =>
        (entry.metadata?.turnDeltaUsage as { total_tokens: number }).total_tokens === 30)).toBe(true)
      expect(billing.debited.at(-1)?.usage.total_tokens).toBe(180)
    } else expect(billing.recorded).toEqual([])
    await manager.dispose()
    manager = new BeeGameSessionManager(runner, root, env, billing.backend)
    expect(manager.runtimeSnapshot(session.id, root)).toMatchObject({ usage: { total_tokens: 180 },
      turnDiagnostics: { turnId: newTurn, usage: { total_tokens: 30 } } })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('recovered converted-provider counters retain attribution without fabricating missing receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-baseline-attribution-'))
  const billing = createSessionUsageBillingFixture()
  let starts = 0
  const runner: BeeGameSessionRunner = { async start(input) {
    const current = ++starts
    input.onNativeSessionId?.('converted-native')
    if (current > 1) input.onNativeUsage?.(sessionUsage(150), 'bgs:converted-native',
      { replayed: true, baselineOnly: true, nativeTurnId: 'old-native' })
    return { reusable: false, stop() {}, async submit(turn) {
      input.onNativeUsage?.(sessionUsage(current === 1 ? 100 : 30), `provider:${current}`)
      input.onNativeUsage?.(sessionUsage(current === 1 ? 100 : 180), 'bgs:converted-native',
        { baselineOnly: true, nativeTurnId: current === 1 ? 'old-native' : 'new-native' })
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Fixture' })
    } }
  } }
  const manager = new BeeGameSessionManager(runner, root, () => ({ BEEGAME_MODEL_BILLING_SOURCE: 'byok' }), billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    const oldTurn = manager.transcriptFacts(session.id).find(event => event.type === 'turn.started')!.turnId!
    await manager.sendWithDisplay(session.id, 'Continue'); await manager.waitForSessionIdle(session.id)
    const events = manager.transcriptFacts(session.id), newTurn = events.findLast(event => event.type === 'turn.started')!.turnId!
    expect(events.find(event => event.payload?.usageReplayed)?.payload).toMatchObject({
      usageAttributedTurnId: oldTurn, usageBaselineOnly: true, usage: { total_tokens: 150 } })
    expect(getRuntimeUsageForTurn(events, oldTurn).total_tokens).toBe(100)
    expect(getRuntimeUsageForTurn(events, newTurn).total_tokens).toBe(30)
    expect(getLatestRuntimeUsage(events).total_tokens).toBe(130)
    expect(billing.recorded).toEqual([])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a replay with no matching native turn remains unattributed and cannot charge the new request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-unknown-attribution-'))
  const billing = createSessionUsageBillingFixture()
  const runner: BeeGameSessionRunner = { async start(input) {
    input.onNativeUsage?.(sessionUsage(100), 'bgs:unknown', { replayed: true, nativeTurnId: 'unavailable-native-turn' })
    return { stop() {}, async submit(turn) {
      input.onNativeUsage?.(sessionUsage(150), 'bgs:unknown', { nativeTurnId: 'current-native-turn' })
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Fixture' })
    } }
  } }
  const manager = new BeeGameSessionManager(runner, root, () => ({}), billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner', resumeNativeSessionId: 'unknown' })
    await manager.sendWithDisplay(session.id, 'Continue'); await manager.waitForSessionIdle(session.id)
    const events = manager.transcriptFacts(session.id), turnId = events.find(event => event.type === 'turn.started')!.turnId!
    expect(events.find(event => event.payload?.usageReplayed)?.payload?.usageAttributedTurnId).toBeNull()
    expect(getLatestRuntimeUsage(events).total_tokens).toBe(150)
    expect(getRuntimeUsageForTurn(events, turnId).total_tokens).toBe(50)
    expect(billing.recorded.every(entry => entry.usage.total_tokens === 50)).toBe(true)
    expect(billing.debited.at(-1)?.usage.total_tokens).toBe(50)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})


for (const oldConverted of [false, true]) test(`replay preserves historical baseline semantics when switching from ${oldConverted ? 'converted BYOK' : 'platform Responses'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-protocol-attribution-'))
  const billing = createSessionUsageBillingFixture()
  let starts = 0
  const runner: BeeGameSessionRunner = { async start(input) {
    const second = ++starts > 1, converted = second ? !oldConverted : oldConverted
    input.onNativeSessionId?.('switch-native')
    if (second) input.onNativeUsage?.(sessionUsage(150), 'bgs:switch-native',
      { replayed: true, baselineOnly: converted, nativeTurnId: 'native-old' })
    return { reusable: false, stop() {}, async submit(turn) {
      if (converted) input.onNativeUsage?.(sessionUsage(second ? 30 : 100), `provider:${starts}`)
      input.onNativeUsage?.(sessionUsage(second ? 180 : 100), 'bgs:switch-native',
        { baselineOnly: converted, nativeTurnId: second ? 'native-new' : 'native-old' })
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Fixture' })
    } }
  } }
  const manager = new BeeGameSessionManager(runner, root, () => ({
    BEEGAME_MODEL_BILLING_SOURCE: (starts === 0 ? oldConverted : !oldConverted) ? 'byok' : 'platform',
  }), billing.backend)
  try {
    const session = manager.start({ workspacePath: root, userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    const oldTurn = manager.transcriptFacts(session.id).find(event => event.type === 'turn.started')!.turnId!
    await manager.sendWithDisplay(session.id, 'Continue'); await manager.waitForSessionIdle(session.id)
    const events = manager.transcriptFacts(session.id), replay = events.find(event => event.payload?.usageReplayed)!
    const newTurn = events.findLast(event => event.type === 'turn.started')!.turnId!
    expect(replay.payload?.usageBaselineOnly === true).toBe(oldConverted)
    expect(replay.payload?.usageAttributedTurnId).toBe(oldTurn)
    expect(getRuntimeUsageForTurn(events, oldTurn).total_tokens).toBe(oldConverted ? 100 : 150)
    expect(getRuntimeUsageForTurn(events, newTurn).total_tokens).toBe(30)
    expect(getLatestRuntimeUsage(events).total_tokens).toBe(oldConverted ? 130 : 180)
    expect(billing.debited.at(-1)?.usage.total_tokens).toBe(oldConverted ? 30 : 150)
    expect(billing.recorded.at(-1)?.turnId).toBe(oldConverted ? newTurn : oldTurn)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})


test('chapter context switch sums distinct native usage and resumed chapter counts only its increment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chapter-usage-'))
  const billing = createSessionUsageBillingFixture()
  const starts: Array<string | undefined> = []
  let nativeCount = 0, requestCount = 0
  const runner: BeeGameSessionRunner = { async start(input) {
    starts.push(input.resumeSessionId)
    const id = input.resumeSessionId ?? 'chapter-' + ++nativeCount
    input.onNativeSessionId?.(id)
    if (input.resumeSessionId) input.onNativeUsage?.(sessionUsage(100), 'bgs:' + id,
      { replayed: true, nativeTurnId: 'request-1' })
    return { stop() {}, async submit(turn) {
      const total = ++requestCount === 1 ? 100 : requestCount === 2 ? 150 : 20
      input.onNativeUsage?.(sessionUsage(total), 'bgs:' + id, { nativeTurnId: 'request-' + requestCount })
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Offline chapter usage' })
    } }
  } }
  const managers: BeeGameSessionManager[] = []
  let sessionId = ''
  try {
    for (const action of ['initial', 'resume', 'next-chapter'] as const) {
      const manager = new BeeGameSessionManager(runner, root, () => ({}), billing.backend)
      managers.push(manager)
      const session = manager.start({ workspacePath: root, userId: 'owner',
        ...(sessionId ? { transcriptSessionId: sessionId } : {}),
        ...(action === 'resume' ? { resumeNativeSessionId: 'chapter-1' } : {}),
        ...(action === 'next-chapter' ? { freshNativeContext: true } : {}),
      })
      sessionId = session.id
      await manager.sendWithDisplay(sessionId, action)
      await manager.waitForSessionIdle(sessionId)
      await manager.dispose() // Cold restore exercises the persisted usage and native ID.
    }
    const latest = managers.at(-1)!
    expect(starts).toEqual([undefined, 'chapter-1', undefined])
    expect(latest.runtimeSnapshot(sessionId)).toMatchObject({ nativeSessionId: 'chapter-2', usage: { total_tokens: 170 } })
    const transcript = latest.transcriptFacts(sessionId)
    const turns = transcript.filter(event => event.type === 'turn.started')
    expect(turns).toHaveLength(3)
    expect(turns.map(turn => getRuntimeUsageForTurn(transcript, turn.turnId!).total_tokens)).toEqual([100, 50, 20])
    expect(billing.recorded.at(-1)?.usage.total_tokens).toBe(170)
    expect(billing.debited.at(-1)?.usage.total_tokens).toBe(170)
    expect(transcript.filter(event => event.type === 'assistant.message')).toHaveLength(3)
  } finally {
    await Promise.all(managers.map(manager => manager.dispose()))
    await rm(root, { recursive: true, force: true })
  }
})
