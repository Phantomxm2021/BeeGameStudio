import { expect, test } from 'bun:test'
import type { AgentRunResult } from '../types.js'

// Directly construct type shapes to verify JSON round-trip (core requirement for resume persistence).
test('AgentRunResult ok branch can JSON round-trip', () => {
  const result = {
    kind: 'ok' as const,
    output: { confirmed: true },
    usage: { outputTokens: 42 },
  }
  const round = JSON.parse(JSON.stringify(result))
  expect(round).toEqual(result)
  expect(round.kind).toBe('ok')
})

test('AgentRunResult skipped/dead branch can JSON round-trip', () => {
  const results: AgentRunResult[] = [
    { kind: 'skipped' },
    { kind: 'dead', reason: 'runagent-threw' },
  ]
  for (const result of results) {
    const round = JSON.parse(JSON.stringify(result))
    expect(round.kind).toBe(result.kind)
  }
})

test('AgentRunResult dead with reason/detail can JSON round-trip', () => {
  const dead = {
    kind: 'dead' as const,
    reason: 'no-structured-output' as const,
    detail: 'finalize content has no StructuredOutput tool_use or JSON text',
  }
  const round = JSON.parse(JSON.stringify(dead))
  expect(round).toEqual(dead)
  expect(round.kind).toBe('dead')
  expect(round.reason).toBe('no-structured-output')
})

test('AgentRunResult invalid-structured-output reason can JSON round-trip', () => {
  const dead: AgentRunResult = {
    kind: 'dead',
    reason: 'invalid-structured-output',
    detail: "must have required property 'count'",
  }
  const round = JSON.parse(JSON.stringify(dead))
  expect(round).toEqual(dead)
  expect(round.reason).toBe('invalid-structured-output')
})

// @ts-expect-error dead results require an explicit current-protocol reason
const deadWithoutReason: AgentRunResult = { kind: 'dead' }
void deadWithoutReason

const deadWithUnknownReason: AgentRunResult = {
  kind: 'dead',
  // @ts-expect-error unclassified terminal state is not a durable protocol value
  reason: 'unknown',
}
void deadWithUnknownReason

test('JournalEntry shape is stable', () => {
  const entry = {
    key: 'abc123',
    result: { kind: 'ok', output: 'text', usage: { outputTokens: 1 } },
  }
  const round = JSON.parse(JSON.stringify(entry))
  expect(round.key).toBe('abc123')
  expect(round.result.kind).toBe('ok')
})
