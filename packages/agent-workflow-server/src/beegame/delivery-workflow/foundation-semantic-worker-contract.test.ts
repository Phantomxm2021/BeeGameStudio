import { describe, expect, test } from 'bun:test'
import { parseWorkerTerminalResult, foundationSemanticReviewerTerminalSchema } from './worker-contracts'

describe('foundation semantic reviewer terminal contract', () => {
  const base = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'dispatch', taskId: 'task', revision: 'rev', packetDigest: 'a'.repeat(64) }
  test('accepts only strict PASS/ISSUES/UNDECIDABLE structured output without model IDs', () => {
    expect(parseWorkerTerminalResult({ ...base, outcome: 'PASS' })).toMatchObject({ outcome: 'PASS' })
    expect(parseWorkerTerminalResult({ ...base, outcome: 'ISSUES', issues: [{ problem: 'p', expected: 'e', actual: 'a', sourceSectionKey: 'GDD#vision', fixSectionKey: 'GDD#vision' }] })).toMatchObject({ outcome: 'ISSUES' })
    expect(parseWorkerTerminalResult({ ...base, outcome: 'UNDECIDABLE', reason: 'insufficient evidence' })).toMatchObject({ outcome: 'UNDECIDABLE' })
    expect(() => foundationSemanticReviewerTerminalSchema.parse({ ...base, outcome: 'PASS', issueId: 'AUD-caller' })).toThrow(/unknown|unrecognized/i)
    expect(() => foundationSemanticReviewerTerminalSchema.parse({ ...base, outcome: 'ISSUES', issues: [] })).toThrow(/requires/i)
  })
})
