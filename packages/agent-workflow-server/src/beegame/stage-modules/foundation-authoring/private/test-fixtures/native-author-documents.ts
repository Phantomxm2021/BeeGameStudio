/** Deterministic public Author child: emits exactly one supplied document body. */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const documents = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8')) as Record<string, string>
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const sessionId = randomUUID()
let pending = ''
const decoder = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  pending += decoder.decode(chunk, { stream: true })
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.type !== 'user') continue
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    if (prompt.includes('mutually consistent set of eight game design documents')) {
      for (const [path, content] of Object.entries(documents)) await writeFile(join(process.cwd(), path), content)
      output({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false,
        structured_output: { status: 'completed', summary: 'Offline autonomous bundle completed.' },
        modelUsage: { fixture: { inputTokens: 8, outputTokens: 8 } } })
      continue
    }
    const match = prompt.match(/Author exactly one complete raw Markdown body for (docs\/[^.]+\.md)\./)
    const path = match?.[1]
    if (!path || typeof documents[path] !== 'string') throw new Error(`missing fixture document: ${path}`)
    output({ type: 'stream_event', session_id: sessionId,
      event: { type: 'message_start', message: { id: randomUUID() } } })
    output({ type: 'stream_event', session_id: sessionId,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
    output({ type: 'stream_event', session_id: sessionId,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: documents[path] } } })
    output({ type: 'stream_event', session_id: sessionId,
      event: { type: 'content_block_stop', index: 0 } })
    output({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false,
      modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } })
  }
}
