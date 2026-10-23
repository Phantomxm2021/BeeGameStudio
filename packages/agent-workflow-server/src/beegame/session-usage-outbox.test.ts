import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionUsageOutbox, type PendingSessionUsage } from './session-usage-outbox'
import type { BeeGameSessionUsageBillingBackend } from './session-manager'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function ledger() {
  type Receipt = Awaited<ReturnType<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>>
  const recorded = new Map<string, Receipt>(), debited = new Set<string>()
  let previous = 0
  const state = { failRecord: false, failDebit: false, loseDebitResponse: false, charged: 0,
    recordCalls: [] as string[], debitCalls: [] as string[] }
  const backend: BeeGameSessionUsageBillingBackend = {
    recordUsage(owner, input) {
      state.recordCalls.push(input.idempotencyKey)
      if (state.failRecord) throw new Error('Offline record failure')
      if (recorded.has(input.idempotencyKey)) return { ...recorded.get(input.idempotencyKey)!, duplicate: true }
      const current = input.usage.total_tokens, delta = current - previous
      previous = current
      const receipt: Receipt = { duplicate: false, cumulativeUsage: input.usage, cumulativeWeightedTokens: current, creditsMicro: current,
        event: { id: input.idempotencyKey, idempotencyKey: input.idempotencyKey, userId: owner,
          sessionId: input.sessionId, pricingVersion: 'fixture', usageSource: 'runtime_snapshot', usage: input.usage,
          delta: { ...input.usage, total_tokens: delta }, weightedTokens: current, weightedTokensDelta: delta,
          creditsMicro: delta, createdAt: new Date().toISOString(), metadata: {} } }
      recorded.set(input.idempotencyKey, receipt)
      return receipt
    },
    debitRealtimeUsage(_owner, input) {
      state.debitCalls.push(input.idempotencyKey)
      if (state.failDebit) throw new Error('Offline debit failure')
      const receipt = recorded.get(input.idempotencyKey)!
      if (debited.has(input.idempotencyKey)) return { ...receipt, duplicate: true }
      state.charged += receipt.event.weightedTokensDelta
      debited.add(input.idempotencyKey)
      if (state.loseDebitResponse) throw new Error('Offline response lost after debit')
      return receipt
    },
  }
  return { state, backend }
}

function bill(total: number): PendingSessionUsage {
  return { userId: 'owner', input: { dataDir: 'fixture', sessionId: 'session', idempotencyKey: 'bill-' + total,
    usage: { prompt_tokens: total, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: total } } }
}

async function fixture(backend: BeeGameSessionUsageBillingBackend) {
  const root = await mkdtemp('/private/tmp/bgs-usage-outbox-test-')
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const create = () => {
    const outbox = new SessionUsageOutbox(root, backend, () => {}, () => {})
    cleanups.push(() => outbox.dispose())
    return outbox
  }
  return { root, outbox: create(), create, files: () => readdir(join(root, 'session-usage-outbox')) }
}

test('debit failure stays durable and the next turn settles old and new usage in order', async () => {
  const { backend, state } = ledger()
  const { outbox, root, files } = await fixture(backend)
  state.failDebit = true
  await expect(outbox.submit(bill(100))).rejects.toThrow('debit failure')
  const names = await files()
  expect(names).toHaveLength(1)
  expect(JSON.parse(await readFile(join(root, 'session-usage-outbox', names[0]!), 'utf8'))).toEqual([bill(100)])
  state.failDebit = false
  await outbox.submit(bill(150))
  expect(state.charged).toBe(150)
  expect(state.recordCalls).toEqual(['bill-100', 'bill-100', 'bill-150'])
  expect(await files()).toEqual([])
})

test.each(['failRecord', 'failDebit', 'loseDebitResponse'] as const)(
  'restart recovers %s with the original keys and no duplicate charge', async failure => {
    const { backend, state } = ledger()
    const { outbox, create, files } = await fixture(backend)
    state[failure] = true
    await expect(outbox.submit(bill(100))).rejects.toThrow()
    await outbox.dispose()
    state[failure] = false
    const restarted = create()
    await restarted.dispose() // Await startup reconciliation; no session/model is needed.
    expect(state.charged).toBe(100)
    expect(state.recordCalls).toEqual(['bill-100', 'bill-100'])
    expect(await files()).toEqual([])
  })

test('bills arriving during an in-flight request are persisted immediately and not lost', async () => {
  const { backend, state } = ledger()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const record = backend.recordUsage!
  backend.recordUsage = async (...args) => { await gate; return record(...args) }
  const { outbox, files, root } = await fixture(backend)
  const first = outbox.submit(bill(100))
  const second = outbox.submit(bill(150))
  try {
    const names = await files()
    expect(JSON.parse(await readFile(join(root, 'session-usage-outbox', names[0]!), 'utf8'))).toEqual([bill(100), bill(150)])
  } finally { release() }
  const receipts = await Promise.all([first, second])
  expect(receipts.map(receipt => receipt.event.idempotencyKey)).toEqual(['bill-100', 'bill-150'])
  expect(receipts.map(receipt => receipt.event.creditsMicro)).toEqual([100, 50])
  expect(state.charged).toBe(150)
  expect(await files()).toEqual([])
})

test('failed registration blocks later cumulative snapshots rather than charging them out of order', async () => {
  const { backend, state } = ledger()
  const { outbox } = await fixture(backend)
  state.failRecord = true
  await expect(outbox.submit(bill(100))).rejects.toThrow()
  await expect(outbox.submit(bill(150))).rejects.toThrow()
  expect(state.recordCalls).toEqual(['bill-100', 'bill-100'])
  state.failRecord = false
  await outbox.submit(bill(150))
  expect(state.charged).toBe(150)
})

test('a corrupt pending bill is not silently discarded', async () => {
  const { backend } = ledger()
  const { outbox, root } = await fixture(backend)
  await outbox.dispose()
  await writeFile(join(root, 'session-usage-outbox', 'bad.json'), '{}')
  expect(() => new SessionUsageOutbox(root, backend, () => {}, () => {})).toThrow('Invalid pending session usage file')
})

test('an unconfirmed billing response cannot remove the pending bill', async () => {
  const { backend } = ledger()
  const debit = backend.debitRealtimeUsage!
  backend.debitRealtimeUsage = async (...args) => {
    const result = await debit(...args)
    return { ...result, event: { ...result.event, idempotencyKey: 'wrong-key' } }
  }
  const { outbox, files } = await fixture(backend)
  await expect(outbox.submit(bill(100))).rejects.toThrow('did not confirm')
  expect(await files()).toHaveLength(1)
})
