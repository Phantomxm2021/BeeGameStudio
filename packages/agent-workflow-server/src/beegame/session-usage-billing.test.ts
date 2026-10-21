import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type BeeGameSessionUsageBillingBackend } from './session-manager'

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
  const recorded = new Map<string, Receipt>()
  let turn = 0, previous = 0, charged = 0, attempts = 0, available = false
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(input) {
    await input.onMessage({ type: 'result', subtype: 'success', result: 'Offline fixture', modelUsage: {
      fixture: { inputTokens: ++turn === 1 ? 100 : 150, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    } })
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
      charged += receipt.event.weightedTokensDelta
      return receipt
    },
  })
  try {
    const session = manager.start({ workspacePath: root, userId: 'fixture' })
    await manager.sendWithDisplay(session.id, 'First'); await manager.waitForSessionIdle(session.id)
    for (let i = 0; i < 100 && attempts < 3; i++) await Bun.sleep(5)
    expect(attempts).toBe(3)
    expect(charged).toBe(0)
    expect(await readdir(join(root, 'session-usage-outbox'))).toHaveLength(1)
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

test('child progress survives missing terminal receipt without assigning unknown usage to the main agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-usage-attribution-'))
  const manager = new BeeGameSessionManager({ async start(input) { return { stop() {}, async submit(turn) {
    input.onNativeUsage?.({ prompt_tokens: 100, completion_tokens: 100, cache_read_tokens: 800, cache_creation_tokens: 0, total_tokens: 1000 })
    for (const [subtype, tokens] of [['task_progress', 700], ['task_progress', 600], ['task_notification', 700]] as const)
      await turn.onMessage({ type: 'system', subtype, task_id: 'child', tool_use_id: 'agent-call', usage: { total_tokens: tokens } })
    await turn.onMessage({ type: 'system', subtype: 'task_progress', task_id: 'unfinished', tool_use_id: 'other-call', usage: { total_tokens: 100 } })
  } } } }, root, () => ({}))
  try {
    const session = manager.start({ workspacePath: root, userId: 'fixture' })
    await manager.sendWithDisplay(session.id, 'Offline usage fixture'); await manager.waitForSessionIdle(session.id)
    const snapshot = manager.runtimeSnapshot(session.id)
    expect(snapshot.usage.total_tokens).toBe(1000)
    expect(snapshot.roleTokens).toEqual({ mainAgent: 0, otherSubagents: 800, unattributed: 200 })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('completed child usage survives interruption, larger fresh counters and late SDK results without double billing', async () => {
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
        await turn.onMessage({ type: 'system', subtype: 'task_progress', task_id: 'child', usage: { total_tokens: 123_000, tool_uses: 2, duration_ms: 1 } })
        ready()
        await new Promise<void>(resolve => turn.signal.addEventListener('abort', () => resolve(), { once: true }))
        return // No parent result after interruption.
      }
      const sdk = n === 4 ? usage(50, 7, 500) : current // A late older stdout result.
      await turn.onMessage({ type: 'result', result: 'Fixture only', modelUsage: { fixture: {
        inputTokens: sdk.prompt_tokens, outputTokens: sdk.completion_tokens, cacheReadInputTokens: sdk.cache_read_tokens, cacheCreationInputTokens: 0,
      } } })
      // An SSE frame for the already-accounted request may arrive afterwards.
      await turn.onMessage({ type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: 5, output_tokens: 3 } } })
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
    expect(recorded.filter((total, index) => index === 0 || total !== recorded[index - 1])).toEqual([112, 335, 446, 1003, 1114])
    expect(manager.runtimeSnapshot(session.id, root).usage).toEqual(usage(100, 14, 1000))
    const receipt = manager.transcriptFacts(session.id).findLast(event =>
      event.type === 'usage' && event.payload?.subtype === 'native_accounting')
    expect(receipt?.payload?.usage).toEqual(usage(60, 8, 600))
    expect(receipt?.payload?.sessionUsage).toEqual(usage(100, 14, 1000))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('terminal runtime_snapshot submissions stay cumulative across large, small and reset native turns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-cumulative-billing-'))
  // Native modelUsage is cumulative within an epoch. A reset starts a new epoch.
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
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Synthetic usage only',
      modelUsage: { synthetic: { inputTokens: nativeTotals[index++]!, outputTokens: 0,
        cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 } } })
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
    expect(recorded).toEqual([100, 1_000, 1_200, 1_250])
    expect(debited).toEqual(recorded)
    expect(charged).toBe(1_250)
    expect(new Set(keys).size).toBe(nativeTotals.length)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
