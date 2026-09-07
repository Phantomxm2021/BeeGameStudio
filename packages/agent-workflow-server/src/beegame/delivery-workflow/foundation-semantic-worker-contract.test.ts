import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import { parseWorkerTerminalResult } from './worker-contracts'
import { foundationSemanticModelPayloadSchema } from '../stage-modules/foundation-reviewer/private/worker-schemas'
import { foundationSemanticFailureDiagnosticInputSchema, foundationSemanticRecheckStructuredOutputJsonSchema, foundationSemanticRecheckWorkerPayloadSchema } from '../stage-modules/foundation-reviewer/private/targeted-worker-schema'

describe('foundation semantic reviewer terminal contract', () => {
  const base = { status: 'completed' as const }
  const issue = { problem: 'p', expected: 'e', actual: 'a', sourceSectionKey: 'GDD#vision', supportingSectionKeys: [] as string[], remediation: { kind: 'patch' as const, sectionKeys: ['GDD#vision'] } }
  test('accepts current model payloads and rejects service-owned terminal fields', () => {
    expect(foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'PASS' })).toMatchObject({ outcome: 'PASS' })
    expect(foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'ISSUES', issues: [issue] })).toMatchObject({ outcome: 'ISSUES' })
    expect(foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'UNDECIDABLE', reason: 'insufficient evidence' })).toMatchObject({ outcome: 'UNDECIDABLE' })
    expect(() => parseWorkerTerminalResult({ workerType: 'foundation-semantic-reviewer', ...base, runId: 'run', dispatchId: 'dispatch', taskId: 'task', revision: 'rev', packetDigest: 'a'.repeat(64), outcome: 'PASS' })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'PASS', issueId: 'AUD-caller' })).toThrow(/unknown|unrecognized/i)
    expect(() => foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'ISSUES', issues: [] })).toThrow(/requires/i)
    expect(() => foundationSemanticModelPayloadSchema.parse({ ...base, outcome: 'ISSUES', issues: [{ ...issue, supportingSectionKeys: undefined }] })).toThrow()
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
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({ status: 'UNDECIDABLE' })).toThrow(/invalid|status/i)
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({ status: 'FAIL' })).toThrow(/diagnostic/i)
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({ status: 'PASS', diagnostic: { observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists' } })).toThrow(/invalid|diagnostic/i)
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
    expect(() => foundationSemanticFailureDiagnosticInputSchema.parse({
      observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'semantic_issue_persists', scopeAssessment: 'repairable_in_scope',
    })).toThrow()
    expect(() => foundationSemanticRecheckWorkerPayloadSchema.parse({
      status: 'FAIL', diagnostic: { observedActual: 'actual persists', evidence: [evidence], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope', unmetExpected: 'worker supplied authority' },
    })).toThrow(/unknown|unrecognized/i)
  })
})
