import { createInterface } from 'node:readline'
const mode = process.argv[2]
const reader = createInterface({ input: process.stdin })
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
for await (const line of reader) {
  if (JSON.parse(line).type !== 'user') continue
  const start = (id: string, input_tokens: number) => emit({ type: 'stream_event', event: { type: 'message_start',
    message: { id, usage: { input_tokens, output_tokens: 1 } } } })
  const delta = (output_tokens: number) => emit({ type: 'stream_event', event: { type: 'message_delta',
    delta: { stop_reason: 'tool_use' }, usage: { output_tokens } } })
  start('message-a', 100); delta(20)
  emit({ type: 'assistant', message: { id: 'message-a', usage: { input_tokens: 100, output_tokens: 20 },
    content: [{ type: 'tool_use', name: 'StructuredOutput', id: 'call-a', input: { private: 'PRIVATE_MODEL_TEXT' } }] } })
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-a', is_error: ['retry-limit', 'schema-retry'].includes(mode),
    content: mode === 'schema-retry' ? '<tool_use_error>PRIVATE_PROVIDER_TEXT\nSTRUCTURED_OUTPUT_DIAGNOSTIC:' + JSON.stringify({ issues: [
      { instancePath: '/calls/0/expression/args/0', keyword: 'type', params: { type: 'number' } },
      { instancePath: '/PRIVATE_FIELD', keyword: 'PRIVATE_RULE', params: { type: 'PRIVATE_TYPE' } },
    ] }) + '\nEND_STRUCTURED_OUTPUT_DIAGNOSTIC</tool_use_error>' : 'PRIVATE_PROVIDER_TEXT' }] } })
  start('message-b', 150); delta(30)
  emit({ type: 'assistant', message: { id: 'message-b', usage: { input_tokens: 150, output_tokens: 30 }, content: [] } })
  if (mode === 'wait') { await new Promise(resolve => setTimeout(resolve, 10000)); break }
  emit({ type: 'result', subtype: mode === 'turn-limit' ? 'error_max_turns' : mode === 'retry-limit' ? 'error_max_structured_output_retries' : 'success',
    ...(mode === 'missing' ? {} : { structured_output: { ok: true } }),
    ...(mode === 'usage-only' ? { usage: { input_tokens: 250, output_tokens: 50 } }
      : { modelUsage: { fake: { inputTokens: 250, outputTokens: 50 } } }) })
  reader.close(); break
}
