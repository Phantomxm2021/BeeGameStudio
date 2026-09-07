/** Offline Revision fixture: one assigned section only, with an explicit byte-scope assertion. */
import { randomUUID } from 'node:crypto'

const markdown = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8')
if (!markdown) throw new Error('missing assigned section fixture')
const sessionId = randomUUID()
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
let pending = ''

for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk, { stream: true })
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline)
    pending = pending.slice(newline + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.type !== 'user') continue
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    const evidenceLine = prompt.split('\n').find((value: string) => value.startsWith('Revision evidence: '))
    if (!evidenceLine) throw new Error('missing assigned revision packet')
    const packet = JSON.parse(evidenceLine.slice('Revision evidence: '.length)) as {
      documentPath: string; sectionIds: string[]; sections: Array<{ documentPath: string; sectionId: string; content: string }>
    }
    if (packet.documentPath !== 'docs/LEVEL_SCENE_DESIGN.md' || JSON.stringify(packet.sectionIds) !== '["material.route-choice-diagram"]')
      throw new Error('Revision received unauthorized scope')
    const section = packet.sections.find(value => value.documentPath === 'docs/LEVEL_SCENE_DESIGN.md' && value.sectionId === 'material.route-choice-diagram')
    const broken = 'route_choice_contract: missing'
    const fixed = 'route_choice_contract: readable'
    if (!section?.content.includes(broken) || section.content.trimEnd() !== markdown.trimEnd())
      throw new Error('Revision fixture changed bytes outside its one remediation section')
    output({ type: 'system', session_id: sessionId })
    output({ type: 'result', session_id: sessionId, subtype: 'success', is_error: false, result: markdown.replace(broken, fixed),
      modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } })
    setTimeout(() => process.exit(0), 20)
  }
}
