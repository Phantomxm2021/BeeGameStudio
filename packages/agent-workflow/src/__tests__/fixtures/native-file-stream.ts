const send = (event: unknown) => console.log(JSON.stringify({ type: 'stream_event', event }))
console.log(JSON.stringify({ type: 'stream_request_start' }))
send({ type: 'message_start', message: { id: 'offline-stream' } })
for (let n = 0; n < 5; n++) {
  send({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'PRIVATE_MODEL_TEXT' } })
}
console.error('Bearer PRIVATE_STDERR_SECRET')
for (const subtype of ['task_started', 'task_progress', 'task_notification']) {
  console.log(JSON.stringify({ type: 'system', subtype, task_id: 'child-1', tool_use_id: 'agent-1',
    status: subtype === 'task_notification' ? 'completed' : undefined,
    description: 'Checking assets', usage: { tool_uses: 2, total_tokens: 100, duration_ms: 50 },
    prompt: 'PRIVATE_TASK_PROMPT', arbitrary_provider_data: 'PRIVATE_TASK_DATA' }))
}
setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { ok: true } })), 100)
