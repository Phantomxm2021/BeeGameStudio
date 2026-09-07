const mode = process.env.BEEGAME_TEST_CASE ?? 'basic'
const sessionId = '123e4567-e89b-12d3-a456-426614174000'
let buffer = ''
let turn = 0
let firstSession = ''

function emit(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function markdown(): void {
  emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
  emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '# Revision fixture\n' } } })
  emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_stop', index: 0 } })
  emit({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false, result: '# Revision fixture' })
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    const input = JSON.parse(line) as { type?: string; message?: { content?: Array<{ text?: string }> } }
    if (mode === 'permission' && input.type === 'control_response') {
      const response = (input as unknown as { response?: { subtype?: string; request_id?: string; response?: { behavior?: string; toolUseID?: string; decisionClassification?: string } } }).response
      if (response?.subtype !== 'success' || response.request_id !== 'permission-1' || response.response?.behavior !== 'deny' || response.response.toolUseID !== 'read-1' || response.response.decisionClassification !== 'user_reject') {
        emit({ type: 'result', subtype: 'error', is_error: true, result: 'permission denial mismatch' })
        continue
      }
      markdown()
      continue
    }
    const text = input.message?.content?.[0]?.text ?? ''
    turn += 1
    if (turn === 1) firstSession = (input as { session_id?: string }).session_id ?? ''
    if (mode === 'argv-env') {
      emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ argv: process.argv.slice(2), marker: process.env.BEEGAME_MARKER ?? '', inheritedPath: Object.hasOwn(process.env, 'PATH') }) })
    } else if (mode === 'empty-restart' && turn === 2 && ((input as { session_id?: string }).session_id !== sessionId || firstSession !== '')) {
      emit({ type: 'result', subtype: 'error', is_error: true, result: 'bad restart session' })
    } else if (mode === 'empty-restart' && turn === 1) {
      emit({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false, result: '' })
    } else if (mode === 'stderr-secret') {
      console.error('fixture-secret-stderr')
      markdown()
    } else if (mode === 'permission') {
      emit({ type: 'control_request', request_id: 'permission-1', request: { subtype: 'can_use_tool', tool_name: 'ReadAssignedFoundationRevision', tool_use_id: 'read-1', input: {} } })
    } else if (mode === 'assistant') {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: '# assistant fixture' }] } })
      emit({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false, result: '# assistant fixture' })
    } else if (mode === 'late-usage') {
      markdown()
      setTimeout(() => emit({ type: 'usage', session_id: sessionId, usage: { input_tokens: 1 } }), 15)
      setTimeout(() => process.exit(0), 30)
    } else if (mode === 'large-valid' || mode === 'large-invalid') {
      const text = '# ' + 'x'.repeat((mode === 'large-valid' ? 2 * 1024 * 1024 - 100 : 2 * 1024 * 1024 + 1))
      emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
      emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
      emit({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_stop', index: 0 } })
      emit({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false, result: text })
    } else if (mode === 'wait') {
      // The test aborts this process; SIGTERM is intentionally ignored below.
    } else if (mode === 'wait-ready') {
      emit({ type: 'system', session_id: sessionId, subtype: 'ready' })
    } else if (mode === 'no-terminal') {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text }] } })
      process.stdout.end()
      setTimeout(() => process.exit(0), 10)
    } else if (mode === 'bad-json') {
      process.stdout.write('{bad json\n')
      process.stdout.end()
      setTimeout(() => process.exit(0), 10)
    } else if (mode === 'tool-error') {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 'read-1', name: 'ReadAssignedFoundationRevision', input: {} }] } })
      emit({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', is_error: true, content: 'fixture failure' }] } })
    } else if (mode === 'late-tool-error') {
      emit({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: 'read-1', name: 'ReadAssignedFoundationRevision', input: {} }] } })
      markdown()
      setTimeout(() => {
        emit({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', is_error: true }] } })
        process.exit(0)
      }, 25)
    } else if (mode === 'early-stdin-close') {
      process.stdin.destroy()
      setTimeout(() => process.exit(0), 5)
    } else if (mode === 'ignore-term') {
      markdown()
    } else {
      markdown()
    }
  }
})

if (mode === 'ignore-term' || mode === 'late-tool-error' || mode === 'late-usage' || mode === 'wait' || mode === 'wait-ready') {
  process.on('SIGTERM', () => undefined)
  setInterval(() => undefined, 1000)
}
