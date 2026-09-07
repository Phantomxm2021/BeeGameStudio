import { expect, test } from 'bun:test'
import { createRevisionVisibleMarkdownGate, REVISION_MARKDOWN_RESTART_PROMPT } from '../visible-markdown-gate'

const result = (text: string) => ({ type: 'result', subtype: 'success', result: text })
const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

test('empty native result is intercepted once, then a full result is forwarded', () => {
  const gate = createRevisionVisibleMarkdownGate()
  expect(gate.observe(result(''))).toBe('restart')
  expect(gate.observe(delta('# Repaired'))).toBe('forward')
  expect(gate.observe(result('# Repaired'))).toBe('forward')
  expect(() => gate.observe(result('# Late'))).toThrow('already ended')
  expect(REVISION_MARKDOWN_RESTART_PROMPT).toBe('No visible Markdown was emitted. Return the complete raw Markdown document from the beginning now; do not explain or summarize.')
})

test('repeated empty result and empty terminal after visible text preserve rejection', () => {
  const empty = createRevisionVisibleMarkdownGate()
  expect(empty.observe(result(' \n'))).toBe('restart')
  expect(empty.observe(result(''))).toBe('reject_missing_markdown')
  for (const textEvent of [assistant('document'), delta('document')]) {
    const gate = createRevisionVisibleMarkdownGate()
    expect(gate.observe(textEvent)).toBe('forward')
    expect(gate.observe(result(''))).toBe('reject_missing_markdown')
  }
})

test('non-text stream events do not suppress the assistant text fallback', () => {
  const gate = createRevisionVisibleMarkdownGate()
  expect(gate.observe({ type: 'stream_event', event: { type: 'message_start' } })).toBe('forward')
  expect(gate.observe(assistant('document'))).toBe('forward')
  expect(gate.observe(result(''))).toBe('reject_missing_markdown')
})

test('error terminals always forward for failure and usage processing, never restart', () => {
  for (const error of [{ ...result(''), is_error: true }, { ...result(''), subtype: 'error_max_turns' }]) {
    const gate = createRevisionVisibleMarkdownGate()
    expect(gate.observe(error)).toBe('forward')
    expect(() => gate.observe(result(''))).toThrow('already ended')
  }
})

test('native messages reject non-JSON and do not evaluate accessors', () => {
  let reads = 0
  const gate = createRevisionVisibleMarkdownGate()
  expect(() => gate.observe({ get type() { reads++; return 'result' } })).toThrow('accessors')
  expect(reads).toBe(0)
  for (const value of [null, [], 'result']) expect(() => gate.observe(value)).toThrow('object')
  expect(gate.observe(result('body'))).toBe('forward')
})
