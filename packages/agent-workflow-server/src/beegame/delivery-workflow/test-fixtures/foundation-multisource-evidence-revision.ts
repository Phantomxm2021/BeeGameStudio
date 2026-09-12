/** Offline whole-document repair checks evidence and uses only its private staged bytes. */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
let pending = ''
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk, { stream: true })
  const newline = pending.indexOf('\n')
  if (newline < 0) continue
  const message = JSON.parse(pending.slice(0, newline))
  if (message.type !== 'user') continue
  const packet = {
    documentPath: 'document-set',
    documents: await Promise.all((await readdir(join(process.cwd(), 'docs'))).map(async name => ({ path: 'docs/' + name, content: await readFile(join(process.cwd(), 'docs', name), 'utf8') }))),
    requirements: { content: await readFile(join(process.cwd(), 'requirements.md'), 'utf8') },
    issues: JSON.parse(await readFile(join(process.cwd(), 'review.json'), 'utf8')).findings,
  }
  if (packet.documentPath !== 'document-set' || packet.documents.length !== 8 ||
    packet.requirements.content !== 'multi-source evidence fixture' || packet.issues.length !== 1 ||
    packet.issues[0].documentPath !== 'docs/LEVEL_SCENE_DESIGN.md' || process.env.BEEGAME_REVISION_STAGED_PATH)
    throw new Error('Revision authority or full evidence was lost')
  const gdd = packet.documents.find((doc: { path: string }) => doc.path === 'docs/GDD.md')
  if (!gdd?.content.includes('Player actions:') || !gdd.content.includes('Rules:'))
    throw new Error('Supporting full document missing')
  const path = 'docs/LEVEL_SCENE_DESIGN.md'
  const markdown = packet.documents.find((doc: { path: string }) => doc.path === path)!.content
  if (!markdown.includes('route_choice_contract: missing')) throw new Error('Assigned document is not the source')
  await writeFile(join(process.cwd(), path), markdown.replace('route_choice_contract: missing', 'route_choice_contract: readable'))
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    structured_output: { summary: 'Original multi-source context supports the repair' },
    modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } }) + '\n')
  process.exit(0)
}
