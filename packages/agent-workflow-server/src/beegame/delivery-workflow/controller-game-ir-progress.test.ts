import { describe, expect, test } from 'bun:test'
import {
  gameIrCompilerAdmissionProgressIdentity,
  normalizeGameIrDiagnosticReason,
} from './controller'

describe('Game IR compiler admission progress identity', () => {
  const input = {
    inputDigest: 'input',
    checkpointJournalDigest: 'checkpoint',
    operation: 'phase5/world-scene/validation',
  }

  test('same native candidate remains unchanged across terminal dispatch identities', () => {
    const candidate = {
      outcome: 'FAIL',
      reasonCode: 'missing-projection',
      actual: 'world',
    }
    const first = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      dispatchId: 'dispatch-one',
      candidate,
    })
    const replay = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      dispatchId: 'dispatch-two',
      candidate: { ...candidate },
    })

    expect(replay).toEqual(first)
    expect(replay.diagnosticDigest).toBe(first.diagnosticDigest)
    expect(replay.candidateDigest).toBe(first.candidateDigest)
    expect(replay.terminalDigest).toBe(first.terminalDigest)
  })

  test('different native candidate remains retryable', () => {
    const first = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      candidate: {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        actual: 'world',
      },
    })
    const changed = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      candidate: {
        outcome: 'FAIL',
        reasonCode: 'projection-mismatch',
        actual: 'world',
      },
    })

    expect(changed.diagnosticDigest).toBe(first.diagnosticDigest)
    expect(changed.candidateDigest).not.toBe(first.candidateDigest)
    expect(changed.terminalDigest).not.toBe(first.terminalDigest)
  })

  test('binds normalized admission reasons so different failures remain retryable', () => {
    const first = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      candidate: { outcome: 'FAIL', reasonCode: 'missing-projection' },
      reason: 'schema mismatch\r\n',
    })
    const equivalent = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      candidate: { outcome: 'FAIL', reasonCode: 'missing-projection' },
      reason: 'schema mismatch\n',
    })
    const changed = gameIrCompilerAdmissionProgressIdentity({
      ...input,
      candidate: { outcome: 'FAIL', reasonCode: 'missing-projection' },
      reason: 'source evidence mismatch',
    })

    expect(normalizeGameIrDiagnosticReason('  schema mismatch\r\n')).toBe(
      'schema mismatch',
    )
    expect(
      normalizeGameIrDiagnosticReason(
        "Output does not match required schema: /semantic/nodes/0/edges/0: must have required property 'type', /semantic/nodes/1/edges/2: must have required property 'type', /semantic/nodes/1/edges/2: must have required property 'targetType'",
      ),
    ).toBe(
      "Output does not match required schema: /semantic/nodes/*/edges/*: must have required property 'type', /semantic/nodes/*/edges/*: must have required property 'targetType'",
    )
    expect(
      normalizeGameIrDiagnosticReason(
        'Output does not match required schema: /semantic/nodes/0: must match schema, /semantic/nodes/1: must NOT have additional pro\n\n... [99 characters truncated] ...\n\ntic/nodes/2: must match schema',
      ),
    ).toBe(
      'Output does not match required schema: /semantic/nodes/*: must match schema',
    )
    expect(equivalent.diagnosticDigest).toBe(first.diagnosticDigest)
    expect(changed.diagnosticDigest).not.toBe(first.diagnosticDigest)
  })
})
