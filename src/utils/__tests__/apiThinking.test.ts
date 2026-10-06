import { expect, test } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { applyThinkingPolicy, thinkingParameterMode } from '../apiThinking.js'

test('explicit disable survives JSON serialization and conflicting extra body settings', () => {
  const input = { model: 'custom', thinking: { type: 'enabled', budget_tokens: 1000 } }
  const output = applyThinkingPolicy(input, { type: 'disabled' }, false)
  expect(JSON.parse(JSON.stringify(output)).thinking).toEqual({ type: 'disabled' })
  expect(input.thinking.type).toBe('enabled')
  expect(applyThinkingPolicy(input, { type: 'adaptive' }, true).thinking).toEqual({ type: 'disabled' })
})

test('enabled and adaptive policies preserve supported parameters or provider default', () => {
  const enabled = { thinking: { type: 'enabled', budget_tokens: 1000 } }
  const adaptive = { thinking: { type: 'adaptive' } }
  expect(applyThinkingPolicy(enabled, { type: 'enabled', budgetTokens: 1000 }, false)).toBe(enabled)
  expect(applyThinkingPolicy(adaptive, { type: 'adaptive' }, false)).toBe(adaptive)
  expect(thinkingParameterMode(applyThinkingPolicy({ thinking: undefined }, { type: 'adaptive' }, false).thinking)).toBe('default')
})

test('native delegates inherit caller thinking policy rather than imposing a cost downgrade', () => {
  const source = readFileSync(new URL('../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts', import.meta.url), 'utf8')
  expect(source).toMatch(/thinkingConfig:\s*toolUseContext\.options\.thinkingConfig,/)
  expect(source).not.toMatch(/thinkingConfig:\s*useExactTools/)
})

test.each([false, true])('real Anthropic SDK sends explicit disable with stream=%s to a captured fetch, without a provider call', async stream => {
  let body: Record<string, unknown> | undefined
  const client = new Anthropic({ apiKey: 'offline-fixture', baseURL: 'http://offline.invalid', maxRetries: 0,
    fetch: (async (url, init) => {
      body = JSON.parse(await new Request(url, init).text())
      const message = JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: 'custom',
        content: [], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
      return new Response(stream ? `event: message_start\ndata: {"type":"message_start","message":${message}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n` : message,
        { headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } })
    }) as typeof fetch })
  await client.beta.messages.create(applyThinkingPolicy({ model: 'custom', max_tokens: 10, stream,
    messages: [{ role: 'user' as const, content: 'Offline fixture' }], thinking: undefined }, { type: 'disabled' }, false))
  expect(body?.thinking).toEqual({ type: 'disabled' })
})
