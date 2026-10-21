import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUsageRecorder, generateBeeGameModelWithUsage } from '../app'
import { BeeGameModelRuntimeError } from '../beegame/model-runtime-host'
import { BeeGameSessionManager, type BeeGameSessionUsageBillingBackend } from '../beegame/session-manager'
import { UsageOutboxPersistenceError } from '../beegame/session-usage-outbox'
import { BeeGameUsageBillingError } from '@bee-game-studio/beegame-billing-core/usage-control-client'

const usage = (tokens: number) => ({ input_tokens: tokens, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: tokens })
type Receipt = Awaited<ReturnType<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>>
async function fixture(admission = false) {
  const root = await mkdtemp('/private/tmp/bgs-auxiliary-usage-')
  const rows = new Map<string, Receipt>(), debits = new Set<string>()
  const state = { failRecord: false, failDebit: false, loseDebitResponse: false, rejectCredits: false, available: true, charged: 0,
    keys: [] as string[], settled: [] as number[], failures: [] as unknown[] }
  const backend: BeeGameSessionUsageBillingBackend = {
    ...(admission ? { assertUsageAvailable: async () => {
      if (!state.available) throw new BeeGameUsageBillingError('Insufficient realtime usage credits', false)
    } } : {}),
    recordUsage(owner, input) {
      state.keys.push(input.idempotencyKey)
      if (state.failRecord) throw Error('Synthetic record unavailable')
      if (rows.has(input.idempotencyKey)) return { ...rows.get(input.idempotencyKey)!, duplicate: true }
      expect(input.usageSource).toBe('model_runtime_host')
      const total = [...rows.values()].reduce((sum, row) => sum + row.event.usage.total_tokens, 0) + input.usage.total_tokens
      const row: Receipt = { duplicate: false, cumulativeUsage: { ...input.usage, total_tokens: total }, cumulativeWeightedTokens: total, creditsMicro: total,
        event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner, sessionId: input.sessionId,
          pricingVersion: 'fixture', usageSource: 'model_runtime_host', usage: input.usage, delta: input.usage,
          weightedTokens: input.usage.total_tokens, weightedTokensDelta: input.usage.total_tokens,
          creditsMicro: input.usage.total_tokens, createdAt: new Date().toISOString(), metadata: input.metadata ?? {} } }
      rows.set(input.idempotencyKey, row)
      return row
    },
    debitRealtimeUsage(_owner, input) {
      if (state.rejectCredits) throw new BeeGameUsageBillingError('Insufficient realtime usage credits', false)
      if (state.failDebit) throw Error('Synthetic debit unavailable')
      const receipt = rows.get(input.idempotencyKey)!
      if (debits.has(input.idempotencyKey)) return { ...receipt, duplicate: true }
      debits.add(input.idempotencyKey); state.charged += receipt.event.creditsMicro
      if (state.loseDebitResponse) throw Error('Synthetic lost debit response')
      return receipt
    },
  }
  const create = () => new BeeGameSessionManager({ async start() { throw Error('No model should run') } }, root, () => ({}), backend)
  const manager = create()
  const recorder = createUsageRecorder({ sessionId: 'logical-job', submit: input => manager.recordExternalUsage('owner', input),
    onSettled: result => { state.settled.push(result.creditsMicro) }, onDebitFailed: failure => { state.failures.push(failure) } })
  return { root, manager, recorder, create, state, rows,
    files: () => readdir(join(root, 'session-usage-outbox')),
    async close() { await manager.dispose(); await rm(root, { recursive: true, force: true }) } }
}

describe('model runtime usage recorder', () => {
  test('completed calls retain incomplete accounting without replay or loss of content', async () => {
    const f = await fixture()
    let calls = 0
    try {
      for (const tokens of [0, 100]) {
        const receipt = { ...usage(tokens), incomplete: true as const }
        const content = await generateBeeGameModelWithUsage({
          async generate() { throw Error('Unexpected legacy call') },
          async generateWithUsage() { calls++; return { content: 'Completed result', usage: receipt } },
        }, { cwd: f.root, runtimeEnv: {}, systemPrompt: 'Offline', messages: [], querySource: 'intake' }, f.recorder, true)
        expect(content).toBe('Completed result')
      }
      expect(calls).toBe(2)
      expect(f.rows.size).toBe(2)
      expect([...f.rows.values()].every(row => row.event.metadata.providerUsageIncomplete === true)).toBe(true)
      expect(f.state.charged).toBe(100)
      await expect(generateBeeGameModelWithUsage({ async generate() { return 'Unaccounted result' } },
        { cwd: f.root, runtimeEnv: {}, systemPrompt: 'Offline', messages: [], querySource: 'intake' }, f.recorder, true))
        .rejects.toThrow('Realtime usage billing requires provider token usage')
    } finally { await f.close() }
  })

  test('zero balance and unsettled owner debt block new physical calls, including after restart; top-up recovers billing only', async () => {
    const f = await fixture(true)
    let modelCalls = 0
    const host = { async generate() { throw Error('Unexpected legacy call') }, async generateWithUsage() { modelCalls++; return { content: 'Offline result', usage: usage(100) } } }
    const input = { cwd: f.root, runtimeEnv: {}, systemPrompt: 'Offline', messages: [], querySource: 'intake' }
    try {
      f.state.available = false
      await expect(generateBeeGameModelWithUsage(host, input, f.recorder, true, () => f.manager.assertModelRequestAllowed('owner'))).rejects.toThrow('Insufficient')
      expect(modelCalls).toBe(0)
      f.state.available = true; f.state.rejectCredits = true
      expect(await generateBeeGameModelWithUsage(host, input, f.recorder, true, () => f.manager.assertModelRequestAllowed('owner'))).toBe('Offline result')
      expect(f.state.failures[0]).toMatchObject({ retryable: false })
      await f.manager.dispose()
      const restarted = f.create()
      try {
        await expect(generateBeeGameModelWithUsage(host, { ...input, querySource: 'another-job' }, f.recorder, true,
          () => restarted.assertModelRequestAllowed('owner'))).rejects.toThrow('Insufficient')
        expect(modelCalls).toBe(1)
        await restarted.assertModelRequestAllowed('another-owner')
        f.state.rejectCredits = false
        await restarted.assertModelRequestAllowed('owner')
        expect(f.state.charged).toBe(100)
        expect(modelCalls).toBe(1)
        expect(await f.files()).toEqual([])
      } finally { await restarted.dispose() }
    } finally { await f.close() }
  })
  test('each physical request is charged in full, including equal usage in the same logical job', async () => {
    const f = await fixture()
    try {
      await f.recorder(usage(100), 'intake')
      await f.recorder(usage(150), 'intake-repair')
      await f.recorder(usage(150), 'intake-repair')
      expect(f.state.charged).toBe(400)
      expect(f.rows.size).toBe(3)
      expect(new Set(f.state.keys).size).toBe(3)
      expect(f.state.settled).toEqual([100, 150, 150])
      expect(await f.files()).toEqual([])
    } finally { await f.close() }
  })

  test.each(['failRecord', 'failDebit', 'loseDebitResponse'] as const)('restart settles %s with the original request identity and no model replay', async failure => {
    const f = await fixture()
    try {
      f.state[failure] = true
      await f.recorder(usage(100), 'intake')
      expect(f.state.settled).toEqual([])
      const files = await f.files()
      expect(files).toHaveLength(1)
      const [pending] = JSON.parse(await readFile(join(f.root, 'session-usage-outbox', files[0]!), 'utf8'))
      expect(pending.input.usageSource).toBe('model_runtime_host')
      await f.manager.dispose()
      f.state[failure] = false
      const restarted = f.create()
      await restarted.dispose()
      expect(f.state.charged).toBe(100)
      expect(new Set(f.state.keys)).toEqual(new Set([pending.input.idempotencyKey]))
      expect(await f.files()).toEqual([])
    } finally { await f.close() }
  })

  test('failed model calls retain acknowledged tokens and unknown receipts before returning the original failure', async () => {
    const f = await fixture()
    try {
      for (const total of [100, 0]) {
        const error = new BeeGameModelRuntimeError('Synthetic disconnect', 'model_request', { usage: { ...usage(total), incomplete: true } })
        await expect(generateBeeGameModelWithUsage({ async generate() { throw error }, async generateWithUsage() { throw error } }, {
          cwd: f.root, runtimeEnv: {}, systemPrompt: 'Offline', messages: [], querySource: 'intake',
        }, f.recorder, true)).rejects.toBe(error)
      }
      expect(f.rows.size).toBe(2)
      expect([...f.rows.values()].every(row => row.event.metadata.providerUsageIncomplete === true)).toBe(true)
      expect(f.state.charged).toBe(100)
    } finally { await f.close() }
  })

  test('failure to persist a bill is visible and never described as retained', async () => {
    const f = await fixture()
    try {
      const path = join(f.root, 'session-usage-outbox')
      await rm(path, { recursive: true }); await writeFile(path, 'Synthetic unavailable storage')
      await expect(f.recorder(usage(100), 'intake')).rejects.toBeInstanceOf(UsageOutboxPersistenceError)
      expect(f.state.keys).toEqual([])
      expect(f.state.failures).toEqual([])
    } finally { await f.close() }
  })
})
