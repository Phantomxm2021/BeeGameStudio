import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { BgsClient, type BgsClientOptions } from './client'

const command = [process.execPath, fileURLToPath(new URL('./fixtures/client-cancellation-app-server.mjs', import.meta.url))]
function gate<T = void>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) }
}
const request = (id: string | number, threadId = 'child', turnId: string | null = 'turn-1') =>
  ({ id, method: 'item/tool/call', params: { threadId, turnId } })
async function connect(options: Pick<BgsClientOptions, 'onRequest' | 'onNotification'>) {
  return BgsClient.connect({ command, cwd: '/private/tmp', env: {}, ...options })
}
const emit = (client: BgsClient, ...messages: unknown[]) => client.request('fixture/emit', { messages })

// A request is registered before this intentionally held notification finishes.
test('resolved before handler registration cancels only the matching typed request ID', async () => {
  const barrier = gate(), handled: Array<string | number> = []
  const client = await connect({ onNotification: method => method === 'fixture/block' ? barrier.promise : undefined,
    onRequest: (_method, _params, id) => { handled.push(id); return { ok: true } } })
  try {
    await emit(client, { method: 'fixture/block' }, request(7), request('7'),
      { method: 'serverRequest/resolved', params: { threadId: 'other', requestId: '7' } },
      { method: 'serverRequest/resolved', params: { threadId: 'child', requestId: 7 } })
    expect(handled).toEqual([])
    barrier.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    const { responses } = await client.request('fixture/responses', {})
    expect(handled).toEqual(['7'])
    expect(responses).toEqual([{ id: '7', result: { ok: true } }])
  } finally { barrier.resolve(); await client.close() }
})

test.each(['resolved', 'completed', 'next-turn', 'close'] as const)(
  'in-flight request cancellation suppresses a late reply: %s', async mode => {
    const answer = gate<unknown>(), entered = gate<AbortSignal>()
    const client = await connect({ onRequest: (_method, _params, _id, signal) => {
      entered.resolve(signal); return answer.promise
    } })
    try {
      await emit(client, request('old'))
      const signal = await entered.promise
      expect(signal.aborted).toBe(false)
      if (mode === 'resolved') await emit(client, { method: 'serverRequest/resolved', params: { threadId: 'child', requestId: 'old' } })
      if (mode === 'completed') await emit(client, { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'turn-1' } } })
      if (mode === 'next-turn') await emit(client, { method: 'turn/started', params: { threadId: 'child', turn: { id: 'turn-2' } } })
      if (mode === 'close') await client.close()
      expect(signal.aborted).toBe(true)
      answer.resolve({ success: true })
      await new Promise(resolve => setTimeout(resolve, 0))
      if (mode !== 'close') expect((await client.request('fixture/responses', {})).responses).toEqual([])
    } finally { answer.resolve({}); await client.close() }
  })

test('a turn completion cancels its uncorrelated MCP wait without cancelling another thread', async () => {
  const signals = new Map<string | number, AbortSignal>(), answers = gate<unknown>()
  const client = await connect({ onRequest: (_method, _params, id, signal) => { signals.set(id, signal); return answers.promise } })
  try {
    await emit(client, request('uncorrelated', 'child', null), request('other', 'other'))
    await new Promise(resolve => setTimeout(resolve, 0))
    await emit(client, { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'turn-1' } } })
    expect(signals.get('uncorrelated')?.aborted).toBe(true)
    expect(signals.get('other')?.aborted).toBe(false)
    answers.resolve({ ok: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await client.request('fixture/responses', {})).responses).toEqual([{ id: 'other', result: { ok: true } }])
  } finally { answers.resolve({}); await client.close() }
})
