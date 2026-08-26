import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import { parseWorkerTerminalResult, foundationSemanticReviewerTerminalSchema, foundationSemanticFailureDiagnosticInputSchema, foundationSemanticRecheckStructuredOutputJsonSchema, foundationSemanticRecheckTerminalSchema, foundationSemanticRecheckWorkerPayloadSchema } from './worker-contracts'

describe('foundation semantic reviewer terminal contract', () => {
  const base = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'dispatch', taskId: 'task', revision: 'rev', packetDigest: 'a'.repeat(64) }
  test('accepts only strict PASS/ISSUES/UNDECIDABLE structured output without model IDs', () => {
    expect(parseWorkerTerminalResult({ ...base, outcome: 'PASS' })).toMatchObject({ outcome: 'PASS' })
    expect(parseWorkerTerminalResult({ ...base, outcome: 'ISSUES', issues: [{ problem: 'p', expected: 'e', actual: 'a', sourceSectionKey: 'GDD#vision', remediation: { kind: 'patch', sectionKeys: ['GDD#vision'] } }] })).toMatchObject({ outcome: 'ISSUES' })
    expect(parseWorkerTerminalResult({ ...base, outcome: 'UNDECIDABLE', reason: 'insufficient evidence' })).toMatchObject({ outcome: 'UNDECIDABLE' })
    expect(() => foundationSemanticReviewerTerminalSchema.parse({ ...base, outcome: 'PASS', issueId: 'AUD-caller' })).toThrow(/unknown|unrecognized/i)
    expect(() => foundationSemanticReviewerTerminalSchema.parse({ ...base, outcome: 'ISSUES', issues: [] })).toThrow(/requires/i)
  })

  test('targeted recheck worker schema excludes service-owned authority and requires diagnostic evidence on FAIL', () => {
    const evidence = { documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', digest: 'a'.repeat(64) }
    expect(foundationSemanticRecheckWorkerPayloadSchema.parse({ status: 'PASS' })).toEqual({ status: 'PASS' })
    expect(foundationSemanticRecheckWorkerPayloadSchema.parse({
      status: 'FAIL',
      diagnostic: {
        observedActual: 'actual persists',
        evidence: [evidence],
        failureReasonCode: 'actual_persists',
      },
    })).toMatchObject({ status: 'FAIL' })
    const validate = new Ajv().compile(foundationSemanticRecheckStructuredOutputJsonSchema)
    expect(validate({ status: 'FAIL', diagnostic: {
      observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists',
    } })).toBe(true)
    expect(validate({ status: 'FAIL', diagnostic: {
      observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope',
    } })).toBe(false)
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({
      status: 'FAIL',
      diagnostic: {
        observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope',
      },
    })).toThrow(/unknown|unrecognized/i)
    expect(foundationSemanticReviewerTerminalSchema.parse({
      ...base,
      outcome: 'FAIL',
      diagnostic: {
        observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope',
      },
    })).toMatchObject({ outcome: 'FAIL' })
    expect(() => foundationSemanticFailureDiagnosticInputSchema.parse({
      observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'semantic_issue_persists', scopeAssessment: 'repairable_in_scope',
    })).toThrow()
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({
      status: 'FAIL', diagnostic: { observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope', unmetExpected: 'worker supplied authority' },
    })).toThrow(/unknown|unrecognized/i)
    expect(() => foundationSemanticRecheckTerminalSchema.parse({
      ...base,
      outcome: 'UNDECIDABLE',
      reason: 'insufficient evidence',
    })).toThrow(/PASS|FAIL|targeted|outcome/i)
  })
})
