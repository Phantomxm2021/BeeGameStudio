import { expect, test } from 'bun:test'
import { parseNativeProjectTurn } from '@bee-game-studio/agent-workflow/native-direction-authors'

test('project-turn metadata does not require a native-history reset flag', () => {
  expect(parseNativeProjectTurn(undefined)).toBeUndefined()
  expect(parseNativeProjectTurn({})).toEqual({})
  expect(parseNativeProjectTurn({ reviewDocuments: ['GDD.md'] })).toEqual({ reviewDocuments: ['GDD.md'] })
  // Older senders remain compatible; QueryEngine does not act on this flag.
  expect(parseNativeProjectTurn({ restartContext: true })).toEqual({ restartContext: true })
})

test('project-turn metadata rejects invalid shape, duplicate or escaping document paths', () => {
  for (const invalid of [null, [], { restartContext: 'true' }, { reviewDocuments: [] },
    { reviewDocuments: ['../GDD.md'] }, { reviewDocuments: ['GDD.md', 'GDD.md'] }])
    expect(() => parseNativeProjectTurn(invalid)).toThrow()
})

test('production carries the existing host design baseline, not an editable task-file verdict', () => {
  const baseline = { digestVersion: 2 as const, snapshots: { 'GDD.md': 'a'.repeat(64) }, evidenceHashes: { 'content/scenes/level.json': 'b'.repeat(64) } }
  const receipt = { phase: 'content', path: '/project/.beegame/tmp/session/milestone-test.txt', designBaseline: baseline }
  expect(parseNativeProjectTurn({ milestoneResult: receipt })?.milestoneResult?.designBaseline).toEqual(baseline)
  for (const designBaseline of [{ ...baseline, digestVersion: 3 }, { ...baseline, snapshots: {} },
    { ...baseline, snapshots: { '../GDD.md': 'a'.repeat(64) } }, { ...baseline, evidenceHashes: { '../secret': 'b'.repeat(64) } },
    { ...baseline, snapshots: { 'GDD.md': 'passed' } }])
    expect(() => parseNativeProjectTurn({ milestoneResult: { ...receipt, designBaseline } })).toThrow()
})

