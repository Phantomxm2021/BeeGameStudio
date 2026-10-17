// Preloaded only by the isolated-worker regression test. No HTTP leaves this process.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body))
  process.send?.({ type: 'fixture.request', url, model: body.model,
    sessionHeaderPresent: !!headers.get('x-opencode-session'),
    apiKeyMatches: headers.get('x-api-key') === 'offline-go-key',
    bearerMatches: headers.get('authorization') === 'Bearer offline-go-key' })
  return Response.json(new URL(url).pathname.endsWith('/messages')
    ? { id: 'msg-offline', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: 'OFFLINE_OK' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 } }
    : { id: 'offline', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OFFLINE_OK' } }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })
}) as typeof fetch
