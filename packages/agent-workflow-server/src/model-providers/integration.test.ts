import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBgsRunner } from '../bgs/runner'
import type { BeeGameSessionRunnerStartInput } from '../beegame/session-manager'
import type { Json } from './messages'
import type { ModelApiProtocol } from '@bee-game-studio/agent-workflow'

const nativeTest =
  process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
function sse(events: Json[]) {
  return new Response(
    events.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
for (const protocol of [
  'chat-completions',
  'anthropic-messages',
  'gemini',
] as ModelApiProtocol[]) {
  nativeTest(
    'official Bgs completes a native tool loop through ' +
      protocol +
      ' with signatures and usage',
    async () => {
      const root = await mkdtemp('/private/tmp/bgs-provider-native-'),
        game = join(root, 'game')
      await mkdir(game)
      const bodies: Json[] = [], events: Json[] = []
      type UsageObservation = Parameters<NonNullable<BeeGameSessionRunnerStartInput['onNativeUsage']>>
      const usage: UsageObservation[] = []
      const onNativeUsage: NonNullable<BeeGameSessionRunnerStartInput['onNativeUsage']> = (...observation) => {
        usage.push(observation)
      }
      let fixtureError: unknown
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
          try {
            const body = (await request.json()) as Json
            bodies.push(body)
            const first = bodies.length === 1
            const callId = 'fixture_call_' + bodies.length
            if (bodies.length > 3) throw Error('Unexpected extra model request')
            const definitions =
              protocol === 'chat-completions'
                ? body.tools.map((tool: Json) => tool.function)
                : protocol === 'anthropic-messages'
                  ? body.tools
                  : body.tools[0].functionDeclarations
            const tool = definitions.find(
              (tool: Json) =>
                (
                  tool.parameters ??
                  tool.input_schema ??
                  tool.parametersJsonSchema
                )?.properties?.cmd,
            )
            expect(tool).toBeDefined()
            const alias = tool.name,
              args = {
                cmd: "cat > fixture.txt <<'BGS_EOF'\nbgs-provider-fixture\nBGS_EOF",
                shell: process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
                login: protocol === 'chat-completions',
                max_output_tokens: 1000,
              }
            if (!first) {
              const history = JSON.stringify(body.messages ?? body.contents)
              expect(history).toContain('bgs-provider-fixture')
              if (protocol === 'chat-completions')
                expect(history).toContain('synthetic-private-reasoning')
              if (protocol === 'anthropic-messages')
                expect(history).toContain('synthetic-thinking-signature')
              if (protocol === 'gemini')
                expect(history).toContain('synthetic-thought-signature')
            }
            if (protocol === 'chat-completions')
              return sse([
                {
                  choices: [
                    {
                      index: 0,
                      delta: first
                        ? {
                            reasoning_content: 'synthetic-private-reasoning',
                            tool_calls: [
                              {
                                index: 0,
                                id: callId,
                                type: 'function',
                                function: {
                                  name: alias,
                                  arguments: JSON.stringify(args),
                                },
                              },
                            ],
                          }
                        : { content: 'Native fixture completed' },
                      finish_reason: null,
                    },
                  ],
                },
                {
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: first ? 'tool_calls' : 'stop',
                    },
                  ],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 3,
                    prompt_tokens_details: { cached_tokens: 2 },
                  },
                },
              ])
            if (protocol === 'anthropic-messages')
              return sse([
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_fixture',
                    usage: {
                      input_tokens: 6,
                      cache_read_input_tokens: 2,
                      cache_creation_input_tokens: 2,
                      output_tokens: 1,
                    },
                  },
                },
                ...(first
                  ? [
                      {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                          type: 'thinking',
                          thinking: '',
                          signature: '',
                        },
                      },
                      {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                          type: 'thinking_delta',
                          thinking: 'synthetic-private-reasoning',
                        },
                      },
                      {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                          type: 'signature_delta',
                          signature: 'synthetic-thinking-signature',
                        },
                      },
                      { type: 'content_block_stop', index: 0 },
                      {
                        type: 'content_block_start',
                        index: 1,
                        content_block: {
                          type: 'tool_use',
                          id: callId,
                          name: alias,
                          input: {},
                        },
                      },
                      {
                        type: 'content_block_delta',
                        index: 1,
                        delta: {
                          type: 'input_json_delta',
                          partial_json: JSON.stringify(args),
                        },
                      },
                      { type: 'content_block_stop', index: 1 },
                    ]
                  : [
                      {
                        type: 'content_block_start',
                        index: 0,
                        content_block: { type: 'text', text: '' },
                      },
                      {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                          type: 'text_delta',
                          text: 'Native fixture completed',
                        },
                      },
                      { type: 'content_block_stop', index: 0 },
                    ]),
                {
                  type: 'message_delta',
                  delta: { stop_reason: first ? 'tool_use' : 'end_turn' },
                  usage: { output_tokens: 3 },
                },
                { type: 'message_stop' },
              ])
            return sse([
              {
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: first
                        ? [
                            {
                              functionCall: {
                                id: callId,
                                name: alias,
                                args,
                              },
                              thoughtSignature: 'synthetic-thought-signature',
                            },
                          ]
                        : [{ text: 'Native fixture completed' }],
                    },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 10,
                  candidatesTokenCount: 2,
                  thoughtsTokenCount: 1,
                  cachedContentTokenCount: 2,
                  totalTokenCount: 13,
                },
              },
            ])
          } catch (error) {
            fixtureError = error
            return new Response('Synthetic fixture failed', { status: 500 })
          }
        },
      })
      let runtime,
        threadId = ''
      try {
        const type =
            protocol === 'anthropic-messages'
              ? 'anthropic'
              : protocol === 'gemini'
                ? 'gemini'
                : 'openai',
          prefix = type.toUpperCase()
        runtime = await createBgsRunner({
          resolveOutboundTarget: async value => ({
            url: new URL(value),
            addresses: ['127.0.0.1'],
            lookup: (_host, _options, callback) =>
              callback(null, '127.0.0.1', 4),
          }),
        }).start({
          sessionId: 'native-provider',
          cwd: game,
          env: {
            BEEGAME_CONFIG_DIR: join(root, 'private'),
            BEEGAME_MODEL_TYPE: type,
            BEEGAME_API_PROTOCOL: protocol,
            BEEGAME_MODEL: 'fixture-model',
            [prefix + '_BASE_URL']: server.url.toString().replace(/\/$/, ''),
            [prefix + '_API_KEY']: 'synthetic-provider-secret',
          },
          onNativeSessionId: id => {
            threadId = id
          },
          onNativeUsage,
          requestPermission: async () => ({ behavior: 'deny' }),
        })
        await runtime.submit({
          prompt:
            'Execute the synthetic fixture command then return the fixture response.',
          signal: AbortSignal.timeout(20000),
          onMessage: message => {
            events.push(message)
          },
          requestPermission: async () => ({ behavior: 'deny' }),
        })
        if (fixtureError) throw fixtureError
        expect(bodies).toHaveLength(2)
        expect((await readFile(join(game, 'fixture.txt'), 'utf8')).trim()).toBe(
          'bgs-provider-fixture',
        )
        expect(
          events
            .filter(event => event.eventType?.startsWith('assistant.'))
            .map(event => event.text)
            .join(''),
        ).toContain('Native fixture completed')
        expect(JSON.stringify(events)).not.toContain(
          'synthetic-private-reasoning',
        )
        // Provider receipts retain cache writes; native counters are cumulative
        // baselines and must not be mistaken for a second billable receipt.
        const firstReceipts = usage.filter(([, , accounting]) => !accounting?.baselineOnly)
        expect(firstReceipts).toHaveLength(2)
        expect(firstReceipts.map(([value]) => value.total_tokens)).toEqual([13, 26])
        expect(firstReceipts.at(-1)?.[0]).toEqual({
          prompt_tokens: protocol === 'anthropic-messages' ? 12 : 16,
          completion_tokens: 6, total_tokens: 26, cache_read_tokens: 4,
          cache_creation_tokens: protocol === 'anthropic-messages' ? 4 : 0,
        })
        const firstEpoch = firstReceipts[0]![1]
        expect(firstEpoch).toMatch(/^provider:/)
        expect(firstReceipts.every(([, epoch]) => epoch === firstEpoch)).toBe(true)
        expect(usage.filter(([, , accounting]) => accounting?.baselineOnly).at(-1)?.[0].total_tokens).toBe(26)
        await runtime.dispose?.()
        runtime = undefined
        runtime = await createBgsRunner({
          resolveOutboundTarget: async value => ({
            url: new URL(value),
            addresses: ['127.0.0.1'],
            lookup: (_host, _options, callback) =>
              callback(null, '127.0.0.1', 4),
          }),
        }).start({
          sessionId: 'native-provider',
          resumeSessionId: threadId,
          cwd: game,
          env: {
            BEEGAME_CONFIG_DIR: join(root, 'private'),
            BEEGAME_MODEL_TYPE: type,
            BEEGAME_API_PROTOCOL: protocol,
            BEEGAME_MODEL: 'fixture-model',
            [prefix + '_BASE_URL']: server.url.toString().replace(/\/$/, ''),
            [prefix + '_API_KEY']: 'synthetic-provider-secret',
          },
          onNativeUsage,
          requestPermission: async () => ({ behavior: 'deny' }),
        })
        await runtime.submit({
          prompt: 'Continue in the same project.',
          signal: AbortSignal.timeout(20000),
          onMessage: message => {
            events.push(message)
          },
          requestPermission: async () => ({ behavior: 'deny' }),
        })
        if (fixtureError) throw fixtureError
        expect(bodies).toHaveLength(3)
        const resumedReceipts = usage.filter(([, , accounting]) => !accounting?.baselineOnly)
        expect(resumedReceipts).toHaveLength(3)
        expect(resumedReceipts.at(-1)?.[0]).toEqual({
          prompt_tokens: protocol === 'anthropic-messages' ? 6 : 8,
          completion_tokens: 3, cache_read_tokens: 2,
          cache_creation_tokens: protocol === 'anthropic-messages' ? 2 : 0, total_tokens: 13,
        })
        expect(resumedReceipts.at(-1)?.[1]).toMatch(/^provider:/)
        expect(resumedReceipts.at(-1)?.[1]).not.toBe(firstEpoch)
        expect(usage.some(([value, , accounting]) => accounting?.baselineOnly && accounting.replayed && value.total_tokens === 26)).toBe(true)
        expect(usage.filter(([, , accounting]) => accounting?.baselineOnly).at(-1)?.[0].total_tokens).toBe(39)
      } catch (error) {
        throw fixtureError ?? error
      } finally {
        await runtime?.dispose?.()
        server.stop(true)
        await rm(root, { recursive: true, force: true })
      }
    },
    30000,
  )
}
