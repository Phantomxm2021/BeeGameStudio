import { mock } from 'bun:test'
import { getMacroDefines } from '../../../../scripts/defines.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import type { AssistantMessage } from '../../../types/message.js'

Object.assign(globalThis, {
  MACRO: Object.fromEntries(
    Object.entries(getMacroDefines()).map(([key, value]) => [
      key.replace('MACRO.', ''),
      JSON.parse(value),
    ]),
  ),
})
process.env.NODE_ENV = 'test'
process.env.BGS_SIMPLE = '1'
process.env.BGS_DISABLE_NONESSENTIAL_TRAFFIC = '1'
process.env.BEEGAME_CONFIG_DIR = `/private/tmp/bgs-native-eof-${process.pid}`
delete process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK

// Test-mode VCR can replay an unrelated recording instead of running the
// stream. Bypass only recording, so this exercises the actual API generator
// without creating repository fixtures or making real network requests.
const vcr = await import('../../vcr.js')
mock.module('../../vcr.js', () => ({
  ...vcr,
  async *withStreamingVCR(
    _messages: unknown,
    operation: () => AsyncIterable<unknown>,
  ) {
    yield* operation()
  },
}))

const clientModule = await import('../client.js')
let events: Record<string, unknown>[] = []
let calls = 0
mock.module('../client.js', () => ({
  ...clientModule,
  getAnthropicClient: async () => ({
    beta: {
      messages: {
        create(params: { stream?: boolean }) {
          calls++
          if (!params.stream) {
            return Promise.resolve({
              id: 'recovered',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-6',
              content: [{ type: 'text', text: 'Recovered response' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          }
          const stream = {
            controller: new AbortController(),
            async *[Symbol.asyncIterator]() {
              yield* events
            },
          }
          return {
            withResponse: async () => ({
              data: stream,
              response: new Response(),
              request_id: 'fixture',
            }),
          }
        },
      },
    },
  }),
}))
const { queryModelWithStreaming } = await import('../claude.js')
const { createUserMessage } = await import('../../../utils/messages.js')
const { getEmptyToolPermissionContext } = await import('../../../Tool.js')

const start = {
  type: 'message_start',
  message: {
    id: 'fixture',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'claude-sonnet-4-6',
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  },
}
const text = [
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Partial plan' },
  },
  { type: 'content_block_stop', index: 0 },
]
const tool = [
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tool-1', name: 'Write', input: {} },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{}' },
  },
  { type: 'content_block_stop', index: 1 },
]
const partialTool = [
  {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'tool_use', id: 'tool-2', name: 'Write', input: {} },
  },
  {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '{"file_path":' },
  },
]
const terminal = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { output_tokens: 1 },
}
const scenarios = {
  completedTextThenTruncatedTool: [start, ...text, ...partialTool],
  completedToolThenTruncation: [start, ...tool, ...partialTool],
  terminalButUnclosedBlock: [start, ...text, ...partialTool, terminal],
  normal: [start, ...text, terminal, { type: 'message_stop' }],
  terminalWithoutMessageStop: [
    start,
    ...tool,
    { ...terminal, delta: { stop_reason: 'tool_use', stop_sequence: null } },
  ],
  emptyEndTurn: [start, terminal],
  emptyStream: [],
  messageStopWithoutReason: [start, ...text, { type: 'message_stop' }],
}
const results: Record<string, unknown> = {}
for (const [name, streamEvents] of Object.entries(scenarios)) {
  events = streamEvents
  calls = 0
  const output = []
  for await (const message of queryModelWithStreaming({
    messages: [createUserMessage({ content: 'fixture' })],
    systemPrompt: asSystemPrompt(['fixture']),
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal: new AbortController().signal,
    options: {
      model: 'claude-sonnet-4-6',
      isNonInteractiveSession: true,
      querySource: 'sdk',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      enablePromptCaching: false,
    },
  })) {
    output.push(message)
  }
  const assistants = output.filter(
    (message): message is AssistantMessage => message.type === 'assistant',
  )
  results[name] = {
    calls,
    errors: assistants.filter(message => message.isApiErrorMessage).length,
    recovered: assistants.some(message => message.message.id === 'recovered'),
    toolMessages: assistants.filter(
      message =>
        Array.isArray(message.message.content) &&
        message.message.content.some(block => block.type === 'tool_use'),
    ).length,
  }
}
console.log(JSON.stringify(results))
