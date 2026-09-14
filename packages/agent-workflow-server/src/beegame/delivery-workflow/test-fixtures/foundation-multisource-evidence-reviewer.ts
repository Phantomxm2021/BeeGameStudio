/** Offline native-file fixture refuses missing whole-document or requirements evidence. */
import { createInterface } from 'node:readline'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
createInterface({ input: process.stdin }).once('line', async () => {
  const input = {
    documents: await Promise.all((await readdir(join(process.cwd(), 'docs'))).map(async name => ({ path: 'docs/' + name, content: await readFile(join(process.cwd(), 'docs', name), 'utf8') }))),
    requirements: { status: 'available', content: await readFile(join(process.cwd(), 'requirements.md'), 'utf8') },
  }
  if (input.documents.length !== 8 || input.requirements.status !== 'available' || input.requirements.content !== 'multi-source evidence fixture')
    throw new Error('Full audit input lost documents or original requirements')
  const gdd = input.documents.find((doc: { path: string }) => doc.path === 'docs/GDD.md')
  const level = input.documents.find((doc: { path: string }) => doc.path === 'docs/LEVEL_SCENE_DESIGN.md')
  if (!gdd || !level) throw new Error('Required source documents missing')
  const cite = (document: { path: string; content: string }, text: string) => {
    const line = document.content.split('\n').findIndex(value => value.includes(text))
    if (line < 0) throw new Error('Missing evidence: ' + text)
    return { path: document.path, startLine: line + 1, endLine: line + 1 }
  }
  const evidence = [cite(gdd, 'Player actions:'), cite(gdd, 'Rules:')]
  const broken = level.content.includes('route_choice_contract: missing')
  if (!broken && !level.content.includes('route_choice_contract: readable')) throw new Error('Missing route contract')
  const report = { summary: 'Full input inspected',
    findings: broken ? [{ title: 'Route feedback is missing', actual: 'route_choice_contract: missing',
      expected: 'route_choice_contract: readable', documentPath: level.path }] : [] }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', structured_output: report,
    modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } }) + '\n')
  setInterval(() => {}, 1000)
})
