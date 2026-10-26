import { createInterface } from 'node:readline'
const responses = []
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (!message.method) { responses.push(message); return }
  if (message.id === undefined) return
  if (message.method === 'fixture/emit')
    for (const event of message.params.messages) send(event)
  send({ id: message.id, result: message.method === 'fixture/responses' ? { responses } : {} })
})
