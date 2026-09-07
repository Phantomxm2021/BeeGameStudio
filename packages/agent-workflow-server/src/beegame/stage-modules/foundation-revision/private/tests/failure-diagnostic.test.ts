import { expect, test } from 'bun:test'
import { RevisionNativeProcessError, REVISION_NATIVE_PROCESS_ERROR_CODES } from '../native-process'
import {
  classifyRevisionNativeFailure,
  classifyRevisionOutputFailure,
  revisionFailureDiagnosticSchema,
} from '../failure-diagnostic'
import { revisionSettlementSchema } from '../request-execution-state'

test('diagnostics are a closed, bounded native/output vocabulary', () => {
  expect(revisionFailureDiagnosticSchema.parse({ stage: 'native', reasonCode: 'revision_native_result_failed' })).toEqual({
    stage: 'native', reasonCode: 'revision_native_result_failed',
  })
  expect(revisionFailureDiagnosticSchema.parse({ stage: 'output_validation', reasonCode: 'validation_marker_order' })).toEqual({
    stage: 'output_validation', reasonCode: 'validation_marker_order',
  })
  expect(() => revisionFailureDiagnosticSchema.parse({ stage: 'native', reasonCode: 'validation_title' })).toThrow()
  expect(() => revisionFailureDiagnosticSchema.parse({ stage: 'output_validation', reasonCode: 'revision_native_result_failed' })).toThrow()
  expect(() => revisionFailureDiagnosticSchema.parse({ stage: 'native', reasonCode: 'revision_native_aborted' })).toThrow()
  expect(() => revisionFailureDiagnosticSchema.parse({ stage: 'native', reasonCode: 'native_unknown', extra: true })).toThrow()
  expect(() => revisionFailureDiagnosticSchema.parse({ stage: 'native', reasonCode: 'x'.repeat(1000) })).toThrow()
})

test('native classification uses the explicit code allowlist and never reads hostile getters', () => {
  expect(classifyRevisionNativeFailure(new RevisionNativeProcessError('revision_native_result_failed'))).toEqual({
    stage: 'native', reasonCode: 'revision_native_result_failed',
  })
  expect(classifyRevisionNativeFailure(new RevisionNativeProcessError('revision_native_aborted'))).toBeUndefined()
  for (const code of REVISION_NATIVE_PROCESS_ERROR_CODES) {
    if (code === 'revision_native_aborted') continue
    expect(classifyRevisionNativeFailure(new RevisionNativeProcessError(code))).toEqual({ stage: 'native', reasonCode: code })
  }
  const unknown = Object.create(RevisionNativeProcessError.prototype)
  Object.defineProperty(unknown, 'code', { value: 'not-a-native-code' })
  expect(classifyRevisionNativeFailure(unknown)).toEqual({ stage: 'native', reasonCode: 'native_unknown' })
  const revoked = Proxy.revocable(new Error('secret'), {})
  revoked.revoke()
  expect(classifyRevisionOutputFailure(revoked.proxy)).toEqual({ stage: 'output_validation', reasonCode: 'validation_unknown' })
  expect(classifyRevisionOutputFailure({ message: 'complete game document requires one document title' })).toEqual({
    stage: 'output_validation', reasonCode: 'validation_unknown',
  })
  expect(classifyRevisionOutputFailure({ toString: 'constructor', constructor: 'prototype', __proto__: 'literal' })).toEqual({
    stage: 'output_validation', reasonCode: 'validation_unknown',
  })
})

test('output validators map only trusted static prefixes and exact text', () => {
  expect(classifyRevisionOutputFailure(new Error('complete game document requires one document title'))).toEqual({
    stage: 'output_validation', reasonCode: 'validation_title',
  })
  expect(classifyRevisionOutputFailure(new Error('complete game document production materials must exactly match the canonical order for docs/GDD.md'))).toEqual({
    stage: 'output_validation', reasonCode: 'validation_marker_order',
  })
  expect(classifyRevisionOutputFailure(new Error('production material format is invalid: risky-material:mermaid:line 4'))).toEqual({
    stage: 'output_validation', reasonCode: 'validation_material_format',
  })
  expect(classifyRevisionOutputFailure(new Error('secret output bytes that are not a trusted validator prefix'))).toEqual({
    stage: 'output_validation', reasonCode: 'validation_unknown',
  })
  const hostile = Object.create(Error.prototype)
  Object.defineProperty(hostile, 'message', { get() { throw new Error('do not call') } })
  expect(classifyRevisionOutputFailure(hostile)).toEqual({ stage: 'output_validation', reasonCode: 'validation_unknown' })
})

test('settlement diagnostics match retry failure stages and never attach to stop', () => {
  const completion = { scope: 'direct-child' as const, pid: 1, exitCode: 1, signalCode: null,
    stdoutDrained: true as const, termination: 'none' as const }
  const base = { attemptId: crypto.randomUUID(), usageEvents: [], completion }
  expect(() => revisionSettlementSchema.parse({ ...base, status: 'retryable', failureCode: 'native_failed',
    diagnostic: { stage: 'output_validation', reasonCode: 'validation_unknown' } })).toThrow()
  expect(() => revisionSettlementSchema.parse({ ...base, status: 'retryable', failureCode: 'owner_failed',
    diagnostic: { stage: 'native', reasonCode: 'native_unknown' } })).toThrow()
  expect(() => revisionSettlementSchema.parse({ ...base, status: 'stopped', failureCode: 'cancelled',
    diagnostic: { stage: 'native', reasonCode: 'native_unknown' } })).toThrow()
})
