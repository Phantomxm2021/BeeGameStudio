const send = (event: unknown) => console.log(JSON.stringify({ type: 'stream_event', event }))
console.log(JSON.stringify({ type: 'stream_request_start' }))
send({ type: 'message_start', message: { id: 'offline-stream' } })
for (let n = 0; n < 5; n++) {
  send({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'PRIVATE_MODEL_TEXT' } })
}
console.error('Bearer PRIVATE_STDERR_SECRET')
setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { ok: true } })), 100)
