// Offline owned child: never imports or calls an inference provider.
export {}
const submissions = JSON.parse(Buffer.from(process.argv[2]!, 'base64').toString()) as unknown[]
const session = '123e4567-e89b-12d3-a456-426614174000'
let buffer = '', turn = 0
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const input = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    if (input.type !== 'user') continue
    const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
    if (turn && input.session_id !== session) process.exit(2)
    emit({ type: 'assistant', session_id: session, message: { content: [
      { type: 'text', text: 'Explanation outside the document, including # irrelevant Markdown' },
      { type: 'tool_use', id: 'submit-' + turn, name: 'StructuredOutput', input: submissions[turn] ?? submissions.at(-1) },
    ] } })
    emit({ type: 'result', session_id: session, subtype: 'success', is_error: false,
      structured_output: submissions[turn] ?? submissions.at(-1), result: 'not the document',
      usage: { input_tokens: (turn + 1) * 10, output_tokens: (turn + 1) * 5 } })
    turn++
  }
})
