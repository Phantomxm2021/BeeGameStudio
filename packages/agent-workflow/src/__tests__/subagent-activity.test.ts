import { expect, test } from 'bun:test'
import { mergeSubagentActivity, readSubagentActivity } from '../subagent-activity'

test('terminal tool and permission evidence survives stale running snapshots', () => {
  const complete = readSubagentActivity({ truncated: false, entries: [
    { id: 'bash', kind: 'tool', toolName: 'Bash', status: 'completed', output: 'Passed', elapsedTimeSeconds: 120 },
    { id: 'gate', kind: 'permission', toolName: 'Bash', message: 'Reason', status: 'allowed' },
  ] })!
  const stale = readSubagentActivity({ truncated: true, entries: [
    { id: 'bash', kind: 'tool', toolName: 'Bash', status: 'running', elapsedTimeSeconds: 10 },
    { id: 'gate', kind: 'permission', toolName: 'Bash', message: 'Reason', status: 'pending' },
  ] })!
  const original = JSON.stringify(complete)
  expect(mergeSubagentActivity(complete, stale)).toEqual({ ...complete, truncated: true })
  expect(JSON.stringify(complete)).toBe(original)
})

test('older pages add earlier entries without overwriting newer text and known errors', () => {
  const latest = readSubagentActivity({ truncated: false, entries: [
    { id: 'note', kind: 'message', text: 'Final' },
    { id: 'image', kind: 'tool', toolName: 'Read', status: 'completed', attachmentError: 'Storage failed' },
  ] })!
  const old = readSubagentActivity({ truncated: false, entries: [
    { id: 'before', kind: 'message', text: 'Earlier' }, { id: 'note', kind: 'message', text: 'Draft' },
  ] })!
  expect(mergeSubagentActivity(latest, old, true)?.entries).toEqual([
    { id: 'before', kind: 'message', text: 'Earlier' }, { id: 'note', kind: 'message', text: 'Final' }, latest.entries[1]!,
  ])
  expect(mergeSubagentActivity(latest, undefined)).toBe(latest)
})

test('display metadata is optional for old records and validates elapsed time at the boundary', () => {
  const entry = { id: 'bash', kind: 'tool', toolName: 'Bash', status: 'running' }
  expect(readSubagentActivity({ entries: [entry] })).toBeDefined()
  for (const elapsedTimeSeconds of [-1, Infinity, NaN, '10'])
    expect(readSubagentActivity({ entries: [{ ...entry, elapsedTimeSeconds }] })).toBeUndefined()
  expect(readSubagentActivity({ entries: [{ ...entry, elapsedTimeSeconds: 0, attachmentError: 'Failed' }] })).toBeDefined()
})
