/** Offline executable protocol fixture. Never contacts a model or a network. */
import { randomUUID } from 'node:crypto'
import { FROZEN_DOCUMENTS } from './frozen-documents'
import type { FoundationDocumentPath } from '../domain/types'

const sessionId = randomUUID()
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
let pending = ''
const decoder = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  pending += decoder.decode(chunk, { stream: true })
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline)
    pending = pending.slice(newline + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.type !== 'user') continue
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    const path = prompt.match(/Author exactly one complete raw Markdown body for (docs\/[^.]+\.md)\./)?.[1] as FoundationDocumentPath
    if (!path || !process.argv.includes('--tools') || process.argv[process.argv.indexOf('--tools') + 1] !== '') {
      output({ type: 'result', subtype: 'error', is_error: true })
      continue
    }
    const text = FROZEN_DOCUMENTS[path]
    if (!text) throw new Error('Unknown frozen document path')
    const event = (payload: unknown) => output({ type: 'stream_event', session_id: sessionId, uuid: randomUUID(), event: payload })
    event({ type: 'message_start', message: { id: randomUUID() } })
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    event({ type: 'content_block_stop', index: 0 })
    output({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false,
      modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } })
  }
}
