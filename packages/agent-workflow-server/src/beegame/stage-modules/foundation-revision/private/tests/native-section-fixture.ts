/** Offline section-scoped Revision child. It emits only the assigned Markdown section. */
import { randomUUID } from 'node:crypto'

const markdown = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8')
if (!markdown) throw new Error('missing section fixture')
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
    const evidence = prompt.split('\n').find((value: string) => value.startsWith('Revision evidence: '))
    if (!evidence) throw new Error('missing assigned packet')
    const packet = JSON.parse(evidence.slice('Revision evidence: '.length))
    if (packet.documentPath !== 'docs/TECHNICAL_DESIGN.md' || JSON.stringify(packet.sectionIds) !== '["input_interaction"]')
      throw new Error('unexpected repair scope')
    const section = packet.sections.find((value: { documentPath: string; sectionId: string }) =>
      value.documentPath === packet.documentPath && value.sectionId === 'input_interaction')
    const broken = 'technical.supported_actions: ["move","attack"]'
    const fixed = 'technical.supported_actions: ["move","attack","dash"]'
    if (!section?.content.includes(broken) || section.content.replace(broken, fixed).trimEnd() !== markdown.trimEnd())
      throw new Error('fixture output changes bytes beyond its one admitted repair')
    output({ type: 'system', session_id: sessionId })
    output({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false,
      result: markdown, modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } })
    setTimeout(() => process.exit(0), 20)
  }
}
