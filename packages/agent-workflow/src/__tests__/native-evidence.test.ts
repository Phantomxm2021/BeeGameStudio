import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createEvidenceResponseRecorder, createEvidenceWriter, evidenceSecrets, redactEvidence, withEvidenceRequest } from '../native-evidence'

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), 'review-evidence-unit-')))
const ids = { runId: 'run', attemptId: 'attempt', turnId: 'turn' }
function readEvidence(directory: string) {
  const records = readdirSync(directory).filter(name => name.endsWith('.jsonl')).flatMap(name =>
    readFileSync(join(directory, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
  return records.map(record => ({ ...record, body: record.payload ? JSON.parse(readFileSync(join(directory, record.payload.file), 'utf8')) : null }))
}

test('disabled capture has no filesystem side effect', () => {
  const root = temporary()
  try {
    const writer = createEvidenceWriter({ enabled: false, directory: join(root, 'evidence'), ids })
    writer.record('input', { secret: 'private' }); writer.close()
    expect(readdirSync(root)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('private evidence deduplicates blobs, binds hashes and keeps concurrent request IDs isolated', async () => {
  const root = temporary(), directory = join(root, 'evidence')
  try {
    const writer = createEvidenceWriter({ enabled: true, directory, ids })
    await Promise.all([1, 2].map(requestId => withEvidenceRequest({ requestId }, async () => {
      await Promise.resolve()
      writer.record('request', { documents: 'GDD 第85行\nASSET 第72行', reasoning: 'Keep report reasoning.' })
    })))
    writer.close()
    const records = readEvidence(directory)
    expect(records.map(record => record.requestId).sort()).toEqual([1, 2])
    expect(records[0].payload.file).toBe(records[1].payload.file)
    expect(records.every(record => record.runId === 'run' && record.turnId === 'turn')).toBe(true)
    expect(records[0].body.reasoning).toBe('Keep report reasoning.')
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    for (const name of readdirSync(directory)) expect(statSync(join(directory, name)).mode & 0o777).toBe(0o600)
    const bytes = readFileSync(join(directory, records[0].payload.file))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(records[0].payload.sha256)
    expect(bytes.length).toBe(records[0].payload.bytes)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('redaction removes credentials and private thinking but preserves report reasoning and source lines', () => {
  const secrets = evidenceSecrets({ ANTHROPIC_API_KEY: 'fixture-secret', PATH: '/bin' })
  const result: any = redactEvidence({
    reasoning: 'GDD:85 与 ASSET:72 不一致', authorization: 'Basic opaque', api_token: 'opaque',
    thinking: { type: 'enabled', budget_tokens: 1000 },
    text: 'fixture-secret Bearer bearer-token https://user:pass@example.com/a?token=x',
    blocks: [{ type: 'thinking', thinking: 'PRIVATE_THINKING', signature: 'SIGNED' }],
  }, secrets)
  expect(result.reasoning).toContain('GDD:85')
  expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 1000 })
  const text = JSON.stringify(result)
  for (const secret of ['fixture-secret', 'bearer-token', 'user:pass', 'token=x', 'PRIVATE_THINKING', 'SIGNED', 'opaque']) expect(text).not.toContain(secret)
})

test('size limit is explicit and does not throw or keep growing', () => {
  const root = temporary(), directory = join(root, 'evidence')
  try {
    const writer = createEvidenceWriter({ enabled: true, directory, ids, maxBytes: 800 })
    expect(() => writer.record('large', { content: 'x'.repeat(2000) })).not.toThrow()
    writer.record('ignored', { content: 'not saved' })
    writer.close()
    expect(writer.incomplete).toBe(true)
    expect(readEvidence(directory)).toMatchObject([{ event: 'capture_incomplete', reason: 'size_limit' }])
    expect(readdirSync(directory)).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('URL redaction preserves ordinary source bytes and nested JSON quote escapes', () => {
  const source = { line: 210, text: '<svg xmlns="http://www.w3.org/2000/svg" width="960">' }
  const nested = JSON.stringify(source)
  expect(redactEvidence(nested)).toBe(nested)
  expect(JSON.parse(redactEvidence(nested) as string)).toEqual(source)
  const twice = JSON.stringify({ source: nested })
  expect(JSON.parse(JSON.parse(redactEvidence(twice) as string).source)).toEqual(source)
  for (const url of ['https://EXAMPLE.com:443/a%2fb', 'http://example.com',
    '[namespace](http://www.w3.org/2000/svg)', 'https://[::1]:8080/path#section', 'https://example.com/中文'])
    expect(redactEvidence(url)).toBe(url)
})

test('URL credentials and queries remain redacted without modifying escaped source structure', () => {
  const source = { text: '<a href="https://user:pass@example.com/a%2fb?token=unknown-secret#section">open</a>' }
  const nested = JSON.stringify(source)
  const redacted = redactEvidence(nested) as string
  expect(JSON.parse(redacted)).toEqual({ text: '<a href="https://example.com/a%2fb?redacted#section">open</a>' })
  for (const secret of ['user:pass', 'unknown-secret', 'token=']) expect(redacted).not.toContain(secret)
  expect(redactEvidence('HTTPS://user:pass@[::1]:8080/a?key=private')).toBe('HTTPS://[::1]:8080/a?redacted')
  expect(redactEvidence(source)).toEqual(JSON.parse(redacted))
  expect(source.text).toContain('user:pass')
})

test('unsafe symlink destination cannot redirect evidence writes', () => {
  const root = temporary(), target = temporary()
  try {
    symlinkSync(target, join(root, 'redirect'))
    const writer = createEvidenceWriter({ enabled: true, directory: join(root, 'redirect', 'evidence'), ids })
    expect(writer.enabled).toBe(false)
    expect(writer.incomplete).toBe(true)
    expect(readdirSync(target)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }) }
})

test('stream capture assembles split secrets, retains unfinished visible blocks and omits thinking deltas', () => {
  const records: any[] = []
  const capture = createEvidenceResponseRecorder(() => 7,
    (event, value, request) => records.push({ event, ...request, body: redactEvidence(value, ['fixture-secret']) }), true)
  capture.consume({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
  capture.consume({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE_THINKING' } })
  capture.consume({ type: 'content_block_stop', index: 0 })
  capture.consume({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'StructuredOutput', input: {} } })
  capture.consume({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"reasoning":"fixture-' } })
  capture.consume({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'secret"}' } })
  capture.consume({ type: 'content_block_stop', index: 1 })
  capture.consume({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } })
  capture.consume({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Unfinished GDD:85' } })
  capture.finish({ stopReason: null })
  const tool = records.find(record => record.event === 'api_response_block' && record.body.index === 1)
  expect(tool.body.block.input.reasoning).toBe('[REDACTED]')
  expect(records.find(record => record.body.index === 2).body.complete).toBe(false)
  expect(records.at(-1).body.messageStopObserved).toBe(false)
  expect(records.every(record => record.requestId === 7)).toBe(true)
  expect(JSON.stringify(records)).not.toContain('PRIVATE_THINKING')
})
