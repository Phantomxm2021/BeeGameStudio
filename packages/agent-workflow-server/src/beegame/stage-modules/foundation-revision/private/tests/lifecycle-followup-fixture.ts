let input = ''
let received = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  input += chunk
  if (received || !input.includes('\n')) return
  received = true
  process.stdin.pause()
  const sessionId = '123e4567-e89b-12d3-a456-426614174000'
  const body = Buffer.from(process.argv[3] ?? '', 'base64').toString('utf8')
  const messages = [
    { type: 'system', session_id: sessionId },
    { type: 'usage', usage: { input_tokens: 3 } },
    { type: 'result', session_id: sessionId, subtype: 'success', result: body,
      modelUsage: { fixture: { inputTokens: 5, outputTokens: 2 } } },
  ]
  process.stdout.write(messages.map(message => JSON.stringify(message) + '\n').join(''))
  setTimeout(() => process.exit(0), 20)
})
