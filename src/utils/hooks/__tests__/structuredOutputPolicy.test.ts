import { expect, test } from 'bun:test'
import { isStructuredOutputProtocolHook, STRUCTURED_OUTPUT_ENFORCEMENT_HOOK_ID as id } from '../structuredOutputPolicy'

test('only the exact built-in function can survive external hook isolation', () => {
  expect(isStructuredOutputProtocolHook({ type: 'function', id })).toBe(true)
  for (const type of ['command', 'prompt', 'agent', 'callback', 'http'])
    expect(isStructuredOutputProtocolHook({ type, id })).toBe(false)
  expect(isStructuredOutputProtocolHook({ type: 'function', id: 'external' })).toBe(false)
  expect(isStructuredOutputProtocolHook({ type: 'function' })).toBe(false)
})
