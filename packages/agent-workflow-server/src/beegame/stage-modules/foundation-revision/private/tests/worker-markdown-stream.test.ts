import { expect, test } from 'bun:test'
import { createRevisionWorkerMarkdownStream } from '../worker-markdown-stream'
import { createRevisionVisibleMarkdownGate } from '../visible-markdown-gate'

let eventCounter = 0
const streamEvent = (event: Record<string, unknown>, uuid = `event-${++eventCounter}`) => ({ type: 'stream_event', uuid, event })
const start = (index: number, uuid?: string) => streamEvent({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, uuid)
const delta = (index: number, text: string, uuid?: string) => streamEvent({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }, uuid)
const stop = (index: number, uuid?: string) => streamEvent({ type: 'content_block_stop', index }, uuid)
const result = (text?: string, uuid = 'result') => ({ type: 'result', subtype: 'success', is_error: false, ...(text === undefined ? {} : { result: text }), uuid })

test('merges legal incremental blocks, normalizes output, and gives terminal text priority', () => {
  const stream = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  stream.observe(start(0, 'start-0'))
  stream.observe(delta(0, 'head\r\npartial', 'delta-0'))
  stream.observe(stop(0, 'stop-0'))
  stream.observe(start(1, 'start-1'))
  stream.observe(delta(1, 'partial\r\nstream-only', 'delta-1'))
  stream.observe(stop(1, 'stop-1'))
  stream.observe(result('  terminal\r\nanswer  ', 'result-0'))
  expect(stream.finish()).toBe('terminal\nanswer')
  expect(stream.finish()).toBe('terminal\nanswer')
})

test('merges overlapping trailing lines and allows only the document read tool', () => {
  const section = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  section.observe(start(0, 's-start'))
  section.observe(delta(0, 'prefix\nshared', 's-delta'))
  section.observe(stop(0, 's-stop'))
  section.observe(start(1, 's-start-2'))
  section.observe(delta(1, 'shared\ntail', 's-delta-2'))
  section.observe(stop(1, 's-stop-2'))
  section.observe(result(undefined, 's-result'))
  expect(section.finish()).toBe('prefix\nshared\ntail')

  const document = createRevisionWorkerMarkdownStream({ scope: 'document', maxBytes: 128 })
  document.observe(streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'ReadAssignedFoundationRevision' } }, 'tool'))
  document.observe(result('# complete', 'document-result'))
  expect(document.finish()).toBe('# complete')

  const forbidden = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  forbidden.observe(streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'ReadAssignedFoundationRevision' } }, 'forbidden-tool'))
  expect(() => forbidden.finish()).toThrow(/tool/i)

  const toolAfterText = createRevisionWorkerMarkdownStream({ scope: 'document', maxBytes: 128 })
  toolAfterText.observe(start(0, 'tool-text-start'))
  toolAfterText.observe(delta(0, '# text', 'tool-text-delta'))
  toolAfterText.observe(stop(0, 'tool-text-stop'))
  toolAfterText.observe(streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'ReadAssignedFoundationRevision' } }, 'tool-after-text'))
  toolAfterText.observe(streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }, 'tool-input-json'))
  toolAfterText.observe(result('# final', 'tool-final'))
  expect(toolAfterText.finish()).toBe('# final')
})

test('rejects duplicate results, late stream content, closed-block deltas, and over-limit bytes', () => {
  const duplicate = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  duplicate.observe(result('# done', 'result-1'))
  duplicate.observe(result('# done', 'result-2'))
  expect(() => duplicate.finish()).toThrow(/duplicate|after terminal/i)

  const late = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  late.observe(result('# done', 'late-result'))
  late.observe(start(0, 'late-start'))
  expect(() => late.finish()).toThrow(/after terminal/i)

  const closed = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  closed.observe(start(0, 'closed-start'))
  closed.observe(stop(0, 'closed-stop'))
  closed.observe(delta(0, 'late', 'closed-delta'))
  expect(() => closed.finish()).toThrow(/closed/i)

  const oversized = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 4 })
  oversized.observe(start(0, 'size-start'))
  oversized.observe(delta(0, '12345', 'size-delta'))
  expect(() => oversized.finish()).toThrow(/bytes|boundary/i)

  const utf8 = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 3 })
  utf8.observe(result('éé', 'utf8-result'))
  expect(() => utf8.finish()).toThrow(/bytes|maximum/i)

  const overlapping = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  overlapping.observe(start(0, 'overlap-start-0'))
  overlapping.observe(start(1, 'overlap-start-1'))
  expect(() => overlapping.finish()).toThrow(/overlapping/i)

  const unowned = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  unowned.observe(delta(0, 'orphan', 'orphan-delta'))
  expect(() => unowned.finish()).toThrow(/owning|complete/i)
})

test('failures are sticky, abort is terminal, late events are rejected, and config/events are strict', () => {
  const replay = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  const first = start(0, 'same-event')
  replay.observe(first)
  replay.observe(first)
  expect(() => replay.finish()).toThrow(/replayed/i)
  expect(() => replay.finish()).toThrow(/replayed/i)
  replay.observe(result('# ignored', 'ignored'))
  expect(() => replay.finish()).toThrow(/replayed/i)

  const aborted = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  aborted.abort('worker stopped')
  aborted.abort('different reason')
  expect(() => aborted.finish()).toThrow('worker stopped')
  aborted.observe(result('# late', 'abort-late'))
  expect(() => aborted.finish()).toThrow('worker stopped')

  const invalid = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  expect(() => invalid.observe(null as never)).toThrow(/object/i)
  expect(() => invalid.finish()).toThrow(/object/i)

  const finished = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  finished.observe(result('# done', 'finished-result'))
  expect(finished.finish()).toBe('# done')
  expect(() => finished.observe(result('# late', 'finished-late'))).toThrow(/after finish/i)
  expect(finished.finish()).toBe('# done')

  expect(() => createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 0 })).toThrow()
  expect(() => createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128, taskId: 'forbidden' } as never)).toThrow()
  let reads = 0
  expect(() => createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128, get packet() { reads++; return {} } } as never)).toThrow()
  expect(reads).toBe(0)

  const stream = createRevisionWorkerMarkdownStream({ scope: 'section', maxBytes: 128 })
  expect(() => stream.observe({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: Number.NaN } } })).toThrow()
})

test('composes with the visible-Markdown gate: empty result restarts, full result reaches finish', () => {
  const gate = createRevisionVisibleMarkdownGate()
  const stream = createRevisionWorkerMarkdownStream({ scope: 'document', maxBytes: 128 })
  const empty = { type: 'result', subtype: 'success', is_error: false, result: '' }
  expect(gate.observe(empty)).toBe('restart')
  const full = { type: 'result', subtype: 'success', is_error: false, result: '# Repaired document' }
  expect(gate.observe(full)).toBe('forward')
  stream.observe(full)
  expect(stream.finish()).toBe('# Repaired document')
})

test('restart retains the old sink rejection of an unclosed first text block', () => {
  const gate = createRevisionVisibleMarkdownGate()
  const stream = createRevisionWorkerMarkdownStream({ scope: 'document', maxBytes: 128 })
  const open = start(0, 'open-before-empty')
  expect(gate.observe(open)).toBe('forward')
  stream.observe(open)
  expect(gate.observe(result('', 'empty'))).toBe('restart')
  const restarted = start(0, 'open-after-empty')
  expect(gate.observe(restarted)).toBe('forward')
  stream.observe(restarted)
  expect(() => stream.finish()).toThrow('overlapping')
})

test('the forwarded sink still requires the old explicit success subtype', () => {
  const gate = createRevisionVisibleMarkdownGate()
  const stream = createRevisionWorkerMarkdownStream({ scope: 'document', maxBytes: 128 })
  const message = { type: 'result', result: '# body' }
  expect(gate.observe(message)).toBe('forward')
  stream.observe(message)
  expect(() => stream.finish()).toThrow('error result')
})
