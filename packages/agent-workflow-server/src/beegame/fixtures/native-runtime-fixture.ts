export {}

const decoder = new TextDecoder()
let buffer = ''

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true })
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line) as Record<string, unknown>
    if (message.type === 'control_response') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', permissionResponse: message })}\n`,
      )
      continue
    }
    if (message.type !== 'user') continue
    const rawContent = (message.message as { content?: unknown } | undefined)
      ?.content
    const content = Array.isArray(rawContent)
      ? (rawContent.find(
          block =>
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'text',
        ) as { text?: unknown } | undefined)?.text
      : rawContent
    if (content === 'error') {
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: '550e8400-e29b-41d4-a716-446655440000', errors: ['provider exploded'] })}\n`,
      )
      continue
    }
    if (content === 'eof') process.exit(0)
    if (content === 'incomplete-success') {
      process.stdout.write(
        `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'planning' }], stop_reason: null } })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', stop_reason: '', session_id: '550e8400-e29b-41d4-a716-446655440000', usage: { input_tokens: 0, output_tokens: 0 } })}\n`,
      )
      continue
    }
    if (content === 'visible-markdown-without-stop-reason') {
      process.stdout.write(
        `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '# Visible Markdown' }], stop_reason: null } })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '# Visible Markdown', stop_reason: '', session_id: '550e8400-e29b-41d4-a716-446655440000', usage: { input_tokens: 0, output_tokens: 0 } })}\n`,
      )
      continue
    }
    if (content === 'permission') {
      process.stdout.write(
        `${JSON.stringify({
          type: 'control_request',
          request_id: 'permission-1',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Write',
            tool_use_id: 'tool-1',
            input: { file_path: 'docs/GDD.md', content: 'test' },
          },
        })}\n`,
      )
      continue
    }
    process.stdout.write(
      `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } })}\n`,
    )
    process.stdout.write(
      `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: '550e8400-e29b-41d4-a716-446655440000', received_session_id: message.session_id, received_content: content })}\n`,
    )
  }
}
