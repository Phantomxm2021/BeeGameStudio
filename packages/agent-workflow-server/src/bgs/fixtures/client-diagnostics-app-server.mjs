import { createInterface } from 'node:readline'
import { setImmediate } from 'node:timers/promises'

const mode = process.env.BGS_CLIENT_DIAGNOSTICS_MODE || 'ok'
const secret = 'SYNTHETIC_PROVIDER_SECRET_MUST_NOT_ESCAPE'

function send(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}

function afterInitialize() {
  if (mode === 'exit' || mode === 'signal' || mode === 'timeout')
    process.stderr.write(secret + '\n')
  if (mode === 'exit') setTimeout(() => process.exit(23), 25)
  if (mode === 'signal') setTimeout(() => process.kill(process.pid, 'SIGTERM'), 25)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', async line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') {
    send({ id: message.id, result: { thread: { id: 'client-diagnostics-fixture' } } })
    afterInitialize()
    return
  }
  if (message.id === undefined || mode === 'timeout') return
  if (message.method === 'fixture/replay-stdout') {
    for (const chunk of message.params.chunks) {
      process.stdout.write(Buffer.from(chunk, 'base64'))
      await setImmediate()
    }
    if (message.params.end) process.exit(0)
  }
  send({ id: message.id, result: {} })
})
