const emit = (value: unknown) => console.log(JSON.stringify(value))
const toolId = 'truncated-write'

emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'truncated-response' } } })
emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'max_tokens' } } })
emit({ type: 'assistant', message: { id: 'truncated-response', content: [
  { type: 'tool_use', id: toolId, name: 'Write', input: {} },
] } })
emit({ type: 'user', message: { content: [{
  type: 'tool_result', tool_use_id: toolId, is_error: true,
  content: '<tool_use_error>InputValidationError: The required parameter `file_path` is missing</tool_use_error>',
}] } })
emit({ type: 'result', subtype: 'success', is_error: false, modelUsage: {
  fixture: { inputTokens: 1, outputTokens: 1 },
} })
