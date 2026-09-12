import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Fixed offline child: stdio plus its assigned temporary document, no services.
const mode = process.argv[2]
const body = Buffer.from(process.argv[3] ?? '', 'base64').toString('utf8')
const sessionId = '123e4567-e89b-12d3-a456-426614174000'
let buffer = ''
process.on('SIGTERM', () => undefined)
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk: string) => {
  buffer += chunk
  if (!buffer.includes('\n')) return
  process.stdin.pause()
  if (process.argv.includes('--json-schema')) {
    const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
    const prompt = message.message.content[0].text as string
    const packet = JSON.parse(prompt.split('INPUT:\n')[1]!)
    if (packet.executionMode !== 'document-set-v1' || packet.documents.length !== 8 ||
        process.env.BEEGAME_REVISION_STAGED_PATH) process.exit(3)
    const issuePath = (issue: any): string => issue.source.documentPath
    const paths = [...new Set<string>(packet.issues.map(issuePath))]
    const documents = paths.map(path => ({ path, markdown: mode === 'repair-marker'
      ? packet.documents.find((document: any) => document.path === path).content.replace('REPAIR_REQUIRED', 'Repair completed') : body }))
    process.stdout.write(JSON.stringify({ type: 'result', session_id: sessionId, subtype: 'success',
      structured_output: { documents, assessments: packet.issues.map((issue: any) => ({
        issueId: issue.id, status: 'repaired', reason: 'Offline supported repair', documentPaths: [issuePath(issue)],
      })) }, modelUsage: { fixture: { inputTokens: 5, outputTokens: 2 } } }) + '\n')
    return
  }
if (!readFileSync(process.env.BEEGAME_REVISION_STAGED_PATH!, 'utf8').trim()) process.exit(2)
  if (mode === 'assert-retry-feedback') {
    if (!buffer.includes('validation_marker') || !buffer.includes('structuralFailures') ||
      !buffer.includes('expected exactly once') || buffer.includes('# still invalid') ||
      readFileSync(process.env.BEEGAME_REVISION_STAGED_PATH!, 'utf8') !== '# incomplete') process.exit(3)
  }
  if (mode === 'wait') {
    process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 3 } }) + '\n', () => {
      writeFileSync(process.argv[4]!, 'ready', { flag: 'wx' })
    })
    setInterval(() => undefined, 1000)
    return
  }
  if (mode === 'barrier') {
    writeFileSync(process.argv[4]!, 'ready', { flag: 'wx' })
    await new Promise<void>(resolve => {
      const timer = setInterval(() => { if (existsSync(process.argv[5]!)) { clearInterval(timer); resolve() } }, 5)
    })
  }
  const messages = [
    { type: 'system', session_id: sessionId },
    { type: 'usage', usage: { input_tokens: 3 } },
    { type: 'result', session_id: sessionId, subtype: mode === 'error' ? 'error' : 'success',
      is_error: mode === 'error', result: mode === 'repair-marker' ? readFileSync(process.env.BEEGAME_REVISION_STAGED_PATH!, 'utf8').replace('REPAIR_REQUIRED', 'Repair completed') : body,
      modelUsage: { fixture: { inputTokens: 5, outputTokens: 2 } } },
  ]
  process.stdout.write(messages.map(message => JSON.stringify(message) + '\n').join(''))
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: 'usage', usage: { input_tokens: 1 } }) + '\n', () => process.exit(0))
  }, 20)
})
