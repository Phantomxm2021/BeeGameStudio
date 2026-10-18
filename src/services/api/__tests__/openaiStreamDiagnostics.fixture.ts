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
let useResponses = false
mock.module('../openai/chatgptAuth.js', () => ({ ...chatgptAuth, isChatGPTAuthEnabled: () => useResponses,
  getValidChatGPTAuth: async () => useResponses ? { accessToken: 'PRIVATE_TOKEN' } : null }))
const { getOpenAIClient } = await import('../openai/client.js')
const { queryModelOpenAI } = await import('../openai/index.js')
const { createUserMessage } = await import('../../../utils/messages.js')
const { asSystemPrompt } = await import('../../../utils/systemPromptType.js')
const { FileWriteTool } = await import('@bee-game-studio/builtin-tools/tools/FileWriteTool/FileWriteTool.js')
const { getTotalInputTokens, getTotalOutputTokens, getTotalCacheReadInputTokens } = await import('../../../cost-tracker.js')
const { isModelRequestFailure } = await import('../../../../apps/frontend/src/utils/modelRequestFailure.js')
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
  const bareCall = '<tool_call_offline><function=Write><parameter=file_path>/tmp/PRIVATE.js</parameter>'
    + '<parameter=content>PRIVATE_CONTENT</parameter></function></tool_call>'
  const toolCases = {
    bareCall,
    mixedBareCall: bareCall,
    orphanToolFinish: '',
    structuredWrite: '',
    lateHeader: '',
    invalidJson: '',
    arrayArguments: '',
    nullArguments: '',
    missingId: '',
    missingName: '',
    missingIndex: '',
    changedId: '',
    contentFiltered: 'Partial answer',
    unknownFinish: 'Partial answer',
    contentAfterFinish: 'Initial answer',
    truncatedTool: '',
    fencedExample: 'Example:\n```xml\n' + bareCall + '\n```',
    tildeExample: 'Example:\n~~~xml\n' + bareCall + '\n~~~',
    inlineExample: 'Example: `' + bareCall + '`',
    quotedExample: '> ' + bareCall,
    plainText: 'Write is available; no file was requested.',
    usageCorrection: 'Final usage is authoritative.',
    otherXml: '<example><function=Write><parameter=file_path>sample</parameter></function></example>',
  }
  for (const [kind, answer] of Object.entries(toolCases)) {
    let calls = 0
    const offset = captured.length
    const before = [getTotalInputTokens(), getTotalOutputTokens(), getTotalCacheReadInputTokens()]
    const chunk = (delta: unknown, finish_reason: string | null = null) => encode({ choices: [{ index: 0, delta, finish_reason }] })
    const args = { file_path: '/tmp/PRIVATE.js', content: 'PRIVATE_CONTENT' }
    const structured = ['structuredWrite', 'mixedBareCall', 'lateHeader', 'invalidJson', 'arrayArguments',
      'nullArguments', 'missingId', 'missingName', 'missingIndex', 'changedId', 'truncatedTool'].includes(kind)
    const toolCall: any = { index: 0, id: 'offline-write', type: 'function',
      function: { name: 'Write', arguments: kind === 'mixedBareCall' ? '{}' : JSON.stringify(args) } }
    if (kind === 'invalidJson' || kind === 'truncatedTool') toolCall.function.arguments = '{"file_path":"PRIVATE"'
    if (kind === 'arrayArguments') toolCall.function.arguments = '[]'
    if (kind === 'nullArguments') toolCall.function.arguments = 'null'
    if (kind === 'missingId') delete toolCall.id
    if (kind === 'missingName') delete toolCall.function.name
    if (kind === 'missingIndex') delete toolCall.index
    const body = (kind === 'usageCorrection' ? encode({ choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
      usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12, prompt_tokens_details: { cached_tokens: 8 } } }) : '')
      + (kind === 'lateHeader' ? chunk({ tool_calls: [{ index: 0, function: { arguments: '' } }] }) : '')
      + (structured ? chunk({ tool_calls: [toolCall] }) : '')
      + (kind === 'changedId' ? chunk({ tool_calls: [{ index: 0, id: 'different-id' }] }) : '')
      // Split inside the envelope so validation cannot depend on SSE boundaries.
      + chunk({ content: answer.slice(0, 8) }) + chunk({ content: answer.slice(8) },
        kind === 'orphanToolFinish' ? 'tool_calls' : kind === 'contentFiltered' ? 'content_filter'
          : kind === 'unknownFinish' ? 'unknown' : kind === 'truncatedTool' ? 'length' : 'stop')
      + (kind === 'contentAfterFinish' ? chunk({ content: 'PRIVATE_LATE' }) : '')
      + encode({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15,
        prompt_tokens_details: { cached_tokens: kind === 'usageCorrection' ? 0 : 8 } } }) + 'data: [DONE]\n\n'
    const fetchOverride = (async (_input, init) => {
      calls++
      const request = JSON.parse(String(init?.body))
      assert.equal(request.stream, true)
      const write = request.tools.find((tool: any) => tool.function?.name === 'Write')
      assert(write, 'Write must be offered as a structured function tool')
      assert(write.function.parameters.required.includes('file_path'))
      assert(write.function.parameters.required.includes('content'))
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const output: any[] = []
    for await (const message of queryModelOpenAI([createUserMessage({ content: 'PRIVATE_PROMPT' })],
      asSystemPrompt(['PRIVATE_SYSTEM']), [FileWriteTool], new AbortController().signal,
      { model: 'mimo-v2.6-flash', querySource: 'main', maxOutputTokensOverride: 8, fetchOverride } as any)) output.push(message)
    const truncated = kind === 'truncatedTool'
    const failed = ['bareCall', 'mixedBareCall', 'orphanToolFinish', 'invalidJson', 'arrayArguments', 'nullArguments',
      'missingId', 'missingName', 'missingIndex', 'changedId', 'contentFiltered', 'unknownFinish', 'contentAfterFinish', 'truncatedTool'].includes(kind)
    const errors = output.filter(message => message.isApiErrorMessage)
    const assistants = output.filter(message => message.type === 'assistant' && !message.isApiErrorMessage)
    assert.equal(calls, 1, 'Malformed tool output must not trigger retries')
    assert.equal(errors.length, failed ? 1 : 0, kind)
    assert.equal(assistants.length, failed ? 0 : 1, kind)
    assert.equal(output.some(message => message.type === 'stream_event' && message.event.type === 'message_stop'), !failed || truncated, kind)
    if (failed) {
      assert(!JSON.stringify(errors).includes('PRIVATE'), 'Protocol errors must not echo tool arguments')
      const errorText = errors[0].message.content.map((block: any) => block.text ?? '').join('')
      if (!truncated) {
        assert(errorText.startsWith('OpenAI protocol error:'))
        assert.equal(isModelRequestFailure(errorText), false, 'Existing UI must not schedule an automatic retry')
      } else assert.equal(errors[0].apiError, 'max_output_tokens')
    }
    else if (kind === 'structuredWrite' || kind === 'lateHeader') {
      assert.equal(assistants[0].message.stop_reason, 'tool_use')
      assert.deepEqual(assistants[0].message.content.find((block: any) => block.type === 'tool_use'), {
        type: 'tool_use', id: 'offline-write', name: 'Write', input: args,
      })
    } else assert.deepEqual(assistants[0].message.content, [{ type: 'text', text: answer }])
    const after = [getTotalInputTokens(), getTotalOutputTokens(), getTotalCacheReadInputTokens()]
    assert.deepEqual(after.map((n, i) => n - before[i]!), kind === 'usageCorrection' ? [12, 3, 0] : [4, 3, 8], 'Keep authoritative final usage even when rejecting tool text')
    const lines = captured.slice(offset).join('').split('\n').filter(line => line.startsWith(NATIVE_DIAGNOSTIC_PREFIX))
    assert.equal(lines.length, 1)
    const diagnostic = JSON.parse(lines[0]!.slice(NATIVE_DIAGNOSTIC_PREFIX.length))
    assert.equal(diagnostic.outcome, failed && !truncated ? 'failed' : 'completed', kind)
    if (failed && !truncated) assert.equal(diagnostic.streamFailure, 'adapter')
    results[kind] = { calls, errors: errors.length, outcome: diagnostic.outcome, usageRetained: true }
  }
  useResponses = true
  const responseArgs = JSON.stringify({ file_path: '/tmp/PRIVATE.js', content: 'PRIVATE_CONTENT' })
  const item = { type: 'function_call', call_id: 'response-call', name: 'Write', arguments: '' }
  const added = { type: 'response.output_item.added', output_index: 0, item }
  const argumentDelta = { type: 'response.function_call_arguments.delta', output_index: 0, delta: responseArgs }
  const argumentDone = { type: 'response.function_call_arguments.done', output_index: 0, arguments: responseArgs }
  const itemDone = { type: 'response.output_item.done', output_index: 0, item: { ...item, arguments: responseArgs } }
  const completed = { type: 'response.completed', response: { status: 'completed', usage: {
    input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 8 },
  } } }
  const responseCases: Record<string, unknown[]> = {
    responsesNormal: [added, argumentDelta, argumentDone, itemDone, completed],
    responsesDoneArguments: [added, itemDone, completed],
    responsesPrefilledArguments: [{ ...added, item: { ...item, arguments: responseArgs } }, itemDone, completed],
    responsesInvalidJson: [added, { ...argumentDelta, delta: '{"PRIVATE":' }, completed],
    responsesArgumentMismatch: [added, argumentDelta, { ...argumentDone, arguments: '{}' }, completed],
    responsesNoCallId: [{ ...added, item: { ...item, call_id: undefined, id: 'item-is-not-call-id' } }, argumentDelta, completed],
    responsesDuplicateId: [added, argumentDelta, { ...added, output_index: 1 }, { ...argumentDelta, output_index: 1 }, completed],
    responsesOrphanArguments: [argumentDelta, completed],
    responsesFiltered: [{ type: 'response.incomplete', response: { ...completed.response,
      status: 'incomplete', incomplete_details: { reason: 'content_filter' } } }],
    responsesLength: [added, argumentDelta, { type: 'response.incomplete', response: { ...completed.response,
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }],
    responsesBadSse: [],
    responsesText: [{ type: 'response.output_text.delta', delta: 'Plain response' }, completed],
  }
  for (const [kind, events] of Object.entries(responseCases)) {
    let calls = 0
    const failed = !['responsesNormal', 'responsesDoneArguments', 'responsesPrefilledArguments', 'responsesText'].includes(kind)
    const limit = kind === 'responsesLength'
    const before = [getTotalInputTokens(), getTotalOutputTokens(), getTotalCacheReadInputTokens()]
    const fetchOverride = (async (_input, init) => {
      calls++
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer PRIVATE_TOKEN')
      const request = JSON.parse(String(init?.body))
      assert(request.tools.some((tool: any) => tool.type === 'function' && tool.name === 'Write'))
      return new Response(kind === 'responsesBadSse' ? 'data: PRIVATE_INVALID_JSON\n\n' : events.map(encode).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch
    const output: any[] = []
    for await (const message of queryModelOpenAI([createUserMessage({ content: 'PRIVATE_PROMPT' })],
      asSystemPrompt(['PRIVATE_SYSTEM']), [FileWriteTool], new AbortController().signal,
      { model: 'gpt-test', querySource: 'main', fetchOverride } as any)) output.push(message)
    const errors = output.filter(message => message.isApiErrorMessage)
    const assistants = output.filter(message => message.type === 'assistant' && !message.isApiErrorMessage)
    assert.equal(calls, 1, kind)
    assert.equal(errors.length, failed ? 1 : 0, kind)
    assert.equal(assistants.length, failed ? 0 : 1, kind)
    if (failed && !limit) {
      const errorText = errors[0].message.content.map((block: any) => block.text ?? '').join('')
      assert(errorText.startsWith('OpenAI protocol error:'), kind)
      assert.equal(isModelRequestFailure(errorText), false, kind)
      assert(!JSON.stringify(errors).includes('PRIVATE'), kind)
    } else if (limit) assert.equal(errors[0].apiError, 'max_output_tokens')
    else if (kind !== 'responsesText') {
      assert.equal(assistants[0].message.stop_reason, 'tool_use')
      assert.deepEqual(assistants[0].message.content.find((block: any) => block.type === 'tool_use').input, JSON.parse(responseArgs))
    }
    if (kind !== 'responsesBadSse') {
      const after = [getTotalInputTokens(), getTotalOutputTokens(), getTotalCacheReadInputTokens()]
      assert.deepEqual(after.map((n, i) => n - before[i]!), [4, 3, 8], kind)
    }
    results[kind] = { calls, errors: errors.length, successfulReplies: assistants.length }
  }
  assert(!captured.join('').includes('PRIVATE'), 'SDK and diagnostic logs must not contain credentials or payloads')
} finally { process.stderr.write = originalWrite }
console.log(JSON.stringify(results))
