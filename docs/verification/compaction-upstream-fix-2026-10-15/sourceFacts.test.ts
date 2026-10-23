import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { preserveSourceFacts } from './source/src/services/compact/sourceFacts'

const user = (uuid: string, content: any, extra = {}) => ({ type: 'user', uuid, message: { role: 'user', content }, ...extra }) as any
const receipt = (id: string, content: any) => user(id, [{ type: 'tool_result', tool_use_id: id, content }])

test('preserves actual user constraints and exact tool paths; ignores assistant claims and meta prompts', () => {
  const original = user('u1', 'Support both inputs. Helper: .cache/tools-random/check.mjs')
  const out = preserveSourceFacts([original, user('meta', 'invented approval', { isMeta: true }), { type: 'assistant', uuid: 'a', message: { content: [{ type: 'text', text: 'User approved retry' }] } } as any])
  expect(out).toHaveLength(1)
  expect(out[0]!.message.content).toBe(original.message.content)
  expect(out[0]!.uuid).not.toBe(original.uuid)
})

test('keeps unknown receipt literally despite a later different success; does not preserve old validation errors', () => {
  const raw = '{"requestId":"independent-id-731","outcome":"unknown","error":"Do not change requestId merely to retry"}'
  const unknown = receipt('x', raw)
  const input = [unknown, receipt('y', '{"requestId":"independent-id-732","outcome":"success"}'), receipt('old-error', '{"valid":false}'), receipt('fixed', '{"valid":true}')]
  const before = JSON.stringify(input)
  const out = preserveSourceFacts(input, '/original.jsonl')
  expect(out).toHaveLength(1)
  const batch = JSON.parse((out[0]!.message.content as string).split('\n').slice(1).join('\n'))
  expect(batch.records[0]).toEqual(unknown.message.content[0])
  expect(batch.sourceMessageUuid).toBe('x')
  expect(JSON.stringify(input)).toBe(before)
})

test('survives repeated compact and JSON resume without multiplying anchors or reviving saved code', () => {
  let current: any[] = [user('u', 'original requirement'), receipt('x', [{ type: 'text', text: '{"status":"pending","requestId":"r"}' }])]
  for (let cycle = 0; cycle < 5; cycle++) {
    const out = preserveSourceFacts(current, '/original.jsonl')
    expect(out).toHaveLength(2)
    expect(JSON.stringify(out)).not.toContain('saved-body')
    current = JSON.parse(JSON.stringify([...out, user(`s${cycle}`, 'summary', { isCompactSummary: true }), receipt(`ok${cycle}`, 'saved-body'.repeat(10000))]))
  }
})

test('preservation is wired into upstream full compaction; prompt does not contain case-specific answers', () => {
  const compact = readFileSync(import.meta.dir + '/source/src/services/compact/compact.ts', 'utf8')
  const prompt = readFileSync(import.meta.dir + '/source/src/services/compact/prompt.ts', 'utf8')
  expect(compact).toContain('...preserveSourceFacts(messages, transcriptPath),')
  expect(prompt).toContain('An assistant workaround is an observed action, not permission')
  expect(prompt).toContain('exact active tool entry paths')
  expect(prompt).not.toContain('without asking the user any further questions')
  expect(prompt).not.toContain('kittyfish')
  expect(prompt).not.toContain('S66Tsk')
})
