import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMacroDefines } from '../../../../scripts/defines.js'

Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })
Object.assign(process.env, { NODE_ENV: 'test', BGS_SIMPLE: '1', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  BEEGAME_CONFIG_DIR: `/private/tmp/bgs-stream-diagnostics-${process.pid}`,
  OPENAI_API_KEY: 'PRIVATE_KEY', OPENAI_BASE_URL: 'https://opencode.ai/zen/go/v1',
  OPENAI_LOG: 'debug', OPENAI_ENABLE_THINKING: '0' })
// This process cannot reach the network, including through a stale cached SDK.
globalThis.fetch = (async () => { throw new Error('Unexpected network access') }) as typeof fetch
const chatgptAuth = await import('../openai/chatgptAuth.js')
mock.module('../openai/chatgptAuth.js', () => ({ ...chatgptAuth, isChatGPTAuthEnabled: () => false, getValidChatGPTAuth: async () => null }))
const { getOpenAIClient } = await import('../openai/client.js')
const { queryModelOpenAI } = await import('../openai/index.js')
const { createUserMessage } = await import('../../../utils/messages.js')
const { asSystemPrompt } = await import('../../../utils/systemPromptType.js')
const { NATIVE_DIAGNOSTIC_PREFIX } = await import('@bee-game-studio/agent-workflow/native-diagnostics')

// A cached client must not bypass the per-request fetch observer or retry setting.
getOpenAIClient({ maxRetries: 2 })
const captured: string[] = []
const originalWrite = process.stderr.write
process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true }) as typeof process.stderr.write
const encode = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const text = encode({ choices: [{ index: 0, delta: { content: 'PRIVATE_REPLY' }, finish_reason: null }] })
const terminal = encode({ choices: [{ index: 0, finish_reason: 'stop' }] })
const emptyReasoningAnswer = [
  { delta: { reasoning_content: '', content: 'PRIVATE' }, finish_reason: null },
  { delta: { reasoning_content: '' }, finish_reason: null },
  { delta: { reasoning_content: '', content: '_REPLY' }, finish_reason: null },
  { delta: { reasoning_content: '' }, finish_reason: 'stop' },
].map(choice => encode({ choices: [{ index: 0, ...choice }] })).join('') + 'data: [DONE]\n\n'
const results: Record<string, unknown> = {}
try {
  for (const kind of ['normal', 'emptyReasoning', 'eof', 'invalid', 'http', 'cancelled'] as const) {
    let calls = 0
    const abort = new AbortController()
    const offset = captured.length
    const fetchOverride = (async (_input, init) => {
      calls++
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer PRIVATE_KEY')
      assert.equal(new Headers(init?.headers).has('x-opencode-session'), true)
      if (kind === 'cancelled') { abort.abort(); throw new DOMException('PRIVATE_KEY', 'AbortError') }
      if (kind === 'http') return new Response('{"error":{"message":"Offline service unavailable"}}', {
        status: 503, headers: { 'content-type': 'application/json' },
      })
      return new Response(kind === 'emptyReasoning' ? emptyReasoningAnswer : text + (kind === 'normal' ? terminal + 'data: [DONE]\n\n'
        : kind === 'invalid' ? 'data: PRIVATE_KEY_INVALID_JSON\n\n' : ''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch
    const output: any[] = []
    for await (const message of queryModelOpenAI([createUserMessage({ content: 'PRIVATE_PROMPT' })],
      asSystemPrompt(['PRIVATE_SYSTEM']), [], abort.signal,
      { model: 'mimo-v2.6-flash', querySource: 'main', maxOutputTokensOverride: 8, fetchOverride } as any)) output.push(message)
    assert.equal(calls, 1, 'No automatic retry or fallback')
    const lines = captured.slice(offset).join('').split('\n').filter(line => line.startsWith(NATIVE_DIAGNOSTIC_PREFIX))
    assert.equal(lines.length, 1)
    const diagnostic = JSON.parse(lines[0]!.slice(NATIVE_DIAGNOSTIC_PREFIX.length))
    const errors = output.filter(message => message.isApiErrorMessage || message.apiError)
    if (kind === 'normal' || kind === 'emptyReasoning') {
      assert.equal(diagnostic.outcome, 'completed')
      const final = output.find(message => message.type === 'assistant' && message.message.stop_reason === 'end_turn')
      assert(final)
      assert.deepEqual(final.message.content.at(-1), { type: 'text', text: 'PRIVATE_REPLY' })
      if (kind === 'emptyReasoning') {
        assert.equal(final.message.content.length, 2)
        assert.equal(final.message.content[0].type, 'thinking')
        assert.equal(final.message.content[0].thinking, '')
        assert.equal(final.message.content[0].text, undefined)
        const streamed = output.filter(message => message.type === 'stream_event' &&
          message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta')
          .map(message => message.event.delta.text).join('')
        assert.equal(streamed, final.message.content.at(-1).text)
      }
    } else if (kind === 'cancelled') {
      assert.equal(diagnostic.outcome, 'cancelled')
      assert.equal(errors.length, 0)
    } else {
      assert.equal(diagnostic.outcome, 'failed')
      assert.equal(diagnostic.streamFailure, kind === 'eof' ? 'upstream_incomplete' : kind === 'invalid' ? 'invalid_sse' : 'http')
      assert.equal(errors.length, 1)
      if (kind === 'invalid') assert(!JSON.stringify(errors).includes('PRIVATE'))
    }
    results[kind] = { calls, outcome: diagnostic.outcome, streamFailure: diagnostic.streamFailure }
  }
  const directory = await mkdtemp(join(tmpdir(), 'bgs-reasoning-roundtrip-'))
  try {
    for (const kind of ['lateText', 'lateTool', 'lateNonempty', 'absent', 'null'] as const) {
      const tool = kind !== 'lateText'
      const reasoning = kind === 'lateNonempty' ? 'PRIVATE_REASONING' : ''
      const chunk = (delta: unknown, finish_reason: string | null = null) => encode({ choices: [{ index: 0, delta, finish_reason }] })
      const body = chunk(tool ? { tool_calls: [{ index: 0, id: 'call_late', type: 'function',
        function: { name: 'test_sum', arguments: '{"a":17,' } }] } : { content: 'Full' })
        + chunk(kind === 'absent' ? {} : { reasoning_content: kind === 'null' ? null : reasoning })
        + chunk(tool ? { tool_calls: [{ index: 0, function: { arguments: '"b":25}' } }] } : { content: ' answer' })
        + chunk({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n'
      let calls = 0
      const output: any[] = []
      const prompt = createUserMessage({ content: 'PRIVATE_PROMPT' })
      const options = { model: 'deepseek-v4.1-flash', querySource: 'main', maxOutputTokensOverride: 8,
        fetchOverride: (async () => {
          calls++
          return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
        }) as typeof fetch } as any
      for await (const message of queryModelOpenAI([prompt], asSystemPrompt(['PRIVATE_SYSTEM']), [], new AbortController().signal, options)) output.push(message)
      const final = output.find(message => message.type === 'assistant' && !message.isApiErrorMessage)
      assert(final, 'The real query must assemble the simulated response')
      const thinking = final.message.content.filter((block: any) => block.type === 'thinking')
      const present = kind !== 'absent' && kind !== 'null'
      assert.equal(thinking.length, present ? 1 : 0)
      if (present) assert.equal(thinking[0].thinking, reasoning)
      const value = final.message.content.find((block: any) => block.type === (tool ? 'tool_use' : 'text'))
      assert.deepEqual(tool ? value.input : value.text, tool ? { a: 17, b: 25 } : 'Full answer')
      // Exercise a JSONL persistence boundary with synthetic messages only.
      const path = join(directory, kind + '.jsonl')
      await writeFile(path, JSON.stringify(final) + '\n', { flag: 'wx' })
      const restored = JSON.parse(await readFile(path, 'utf8'))
      assert.deepEqual(restored.message, final.message)
      assert.equal(restored.uuid, final.uuid)
      const next = createUserMessage({ content: tool
        ? [{ type: 'tool_result', tool_use_id: 'call_late', content: '42' }] : 'Next question' })
      options.fetchOverride = (async (_input: unknown, init: RequestInit) => {
        calls++
        const request = JSON.parse(String(init.body))
        const previous = request.messages.find((message: any) => message.role === 'assistant')
        assert(previous)
        assert.equal(Object.hasOwn(previous, 'reasoning_content'), present)
        if (present) assert.equal(previous.reasoning_content, reasoning)
        if (tool) assert.deepEqual(JSON.parse(previous.tool_calls[0].function.arguments), { a: 17, b: 25 })
        else assert.equal(previous.content, 'Full answer')
        return new Response(text + terminal + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }) as typeof fetch
      const followup: any[] = []
      for await (const message of queryModelOpenAI([prompt, restored, next], asSystemPrompt(['PRIVATE_SYSTEM']), [], new AbortController().signal, options)) followup.push(message)
      assert(followup.some(message => message.type === 'assistant' && !message.isApiErrorMessage))
      assert.equal(calls, 2, 'Exactly two mocked requests; no retry or real network')
      results[kind] = { calls, reasoningPresent: present, persistedAndReturned: true }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
  assert(!captured.join('').includes('PRIVATE'), 'SDK and diagnostic logs must not contain credentials or payloads')
} finally { process.stderr.write = originalWrite }
console.log(JSON.stringify(results))
