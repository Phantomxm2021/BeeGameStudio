import { describe, expect, test } from 'bun:test'
import { createSemanticFidelityPrimitives } from './semantic-fidelity'

const phase5 = createSemanticFidelityPrimitives(
  'invalid Game IR Phase 5 admission',
)

describe('shared semantic fidelity primitives', () => {
  test('admission preserves Phase 5 evidence-kind boundaries', () => {
    const admit = phase5.admitValidationResult
    const policy = {
      packetDigest: 'a'.repeat(64),
      checkIds: ['check.one'],
      requiredTargets: ['node:scene#/id'],
      allowedEvidencePointers: [
        'binding:docs/GDD.md#rules/bytes/0/1',
        'section:docs/GDD.md#rules@' + 'b'.repeat(64),
      ],
    }
    expect(() =>
      admit(
        {
          outcome: 'FAIL',
          packetDigest: policy.packetDigest,
          reasonCode: 'projection-mismatch',
          actual: 'different',
          evidencePointers: [policy.allowedEvidencePointers[1]],
        },
        policy,
      ),
    ).toThrow(/binding|evidence/i)
    expect(() =>
      admit(
        {
          outcome: 'FAIL',
          packetDigest: policy.packetDigest,
          reasonCode: 'missing-projection',
          actual: 'missing',
          missingSubject: policy.requiredTargets[0],
          expectedProjection: 'node',
          evidencePointers: [policy.allowedEvidencePointers[0]],
        },
        policy,
      ),
    ).toThrow(/section|evidence/i)
    expect(
      admit(
        {
          outcome: 'PASS',
          packetDigest: policy.packetDigest,
          checkIds: policy.checkIds,
          coveredTargets: policy.requiredTargets,
        },
        policy,
      ),
    ).toEqual({
      outcome: 'PASS',
      packetDigest: policy.packetDigest,
      checkIds: policy.checkIds,
      coveredTargets: policy.requiredTargets,
    })
  })

  test('enforces exact keys and preserves the canonical error contract', () => {
    expect(() =>
      phase5.exactKeys({ value: 1, extra: true }, ['value'], 'candidate'),
    ).toThrow(
      'invalid Game IR Phase 5 admission: candidate has unknown or missing fields',
    )
    expect(() =>
      phase5.exactKeys(
        {
          get value() {
            return 1
          },
        },
        ['value'],
        'candidate',
      ),
    ).toThrow(
      'invalid Game IR Phase 5 admission: candidate has a hidden or accessor property',
    )
  })

  test('requires dense arrays and exact canonical sorted coverage', () => {
    expect(
      phase5.exactStringCoverage(['a', 'b'], ['a', 'b'], 'coverage'),
    ).toEqual(['a', 'b'])
    expect(() =>
      phase5.exactStringCoverage(['b', 'a'], ['a', 'b'], 'coverage'),
    ).toThrow('exact canonical coverage')
    const sparse = [] as unknown[]
    sparse.length = 1
    expect(() => phase5.strictArray(sparse, 'array')).toThrow('must be dense')
  })

  test('validates shared identity/source-pointer primitives without sentinel defaults', () => {
    expect(phase5.text('resource', 'name')).toBe('resource')
    expect(phase5.safeId('resource-1', 'id')).toBe('resource-1')
    expect(phase5.sha256('a'.repeat(64), 'digest')).toBe('a'.repeat(64))
    expect(phase5.normalizeSourcePointer('/bytes/0/7', 'pointer')).toBe(
      '/bytes/0/7',
    )
    expect(() =>
      phase5.normalizeSourcePointer('/bytes/0/0', 'pointer'),
    ).toThrow('non-empty byte range')
  })

  test('deep-freezes protocol values and rejects mutation', () => {
    const value = phase5.deepFreeze({ nested: { items: ['stable'] } })
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.nested)).toBe(true)
    expect(Object.isFrozen(value.nested.items)).toBe(true)
    expect(() => {
      value.nested.items[0] = 'mutated'
    }).toThrow()
  })

  test('isolates error prefixes for independent semantic owners', () => {
    const resource = createSemanticFidelityPrimitives(
      'invalid Game IR Resource admission',
    )
    expect(() => resource.text('', 'name')).toThrow(
      'invalid Game IR Resource admission: name must be non-empty text',
    )
    expect(() => phase5.text('', 'name')).toThrow(
      'invalid Game IR Phase 5 admission: name must be non-empty text',
    )
  })
})
