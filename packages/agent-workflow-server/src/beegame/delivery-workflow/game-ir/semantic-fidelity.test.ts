import { describe, expect, test } from 'bun:test'
import {
  createSemanticFidelityPrimitives,
  GAME_IR_SEMANTIC_AMBIGUOUS_REASON_CODES,
  GAME_IR_SEMANTIC_FAILURE_REASON_CODES,
  sectionEvidencePointer,
  deriveGameIrSemanticSourceClaims,
  verifyGameIrSemanticClaimBytes,
  type GameIrSemanticAmbiguousReasonCode,
  type GameIrSemanticFailureReasonCode,
  type GameIrSemanticSourceSection,
} from './semantic-fidelity'

const phase5 = createSemanticFidelityPrimitives(
  'invalid Game IR Phase 5 admission',
)

describe('shared semantic fidelity primitives', () => {
  test('derives canonical claims from unique supporting excerpts without requiring IR serialization', () => {
    const authority = {
      sectionIndex: [
        {
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'rules',
          digest: 'a'.repeat(64),
        },
      ],
      sectionBytes: { 'docs/GDD.md#rules': 'Hero action consumes energy.' },
    }
    const nodes = [
      {
        id: 'hero',
        kind: 'gameplay.entity',
        value: { label: 'Hero' },
        references: [],
        edges: [
          { type: 'causes', targetId: 'effect', targetType: 'gameplay.effect' },
        ],
      },
    ] as const
    const claims = deriveGameIrSemanticSourceClaims(authority, nodes, [
      {
        subjects: [
          'node:hero#/edges/0',
          'node:hero#/id',
          'node:hero#/value/label',
        ],
        documentPath: 'docs/GDD.md',
        sectionId: 'rules',
        excerpt: 'Hero action consumes energy.',
      },
    ])
    expect(claims).toHaveLength(3)
    expect(claims[0]).toMatchObject({
      literal: 'Hero action consumes energy.',
      sourcePointer: '/bytes/0/28',
    })
    expect(
      claims.every(
        claim => claim.literal !== JSON.stringify(nodes[0].edges[0]),
      ),
    ).toBe(true)
  })

  test('expands canonical node and collection selectors into exact persisted targets', () => {
    const authority = {
      sectionIndex: [
        {
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'rules',
          digest: 'a'.repeat(64),
        },
      ],
      sectionBytes: { 'docs/GDD.md#rules': 'Hero action consumes energy.' },
    }
    const nodes = [
      {
        id: 'hero',
        kind: 'gameplay.entity',
        value: { label: 'Hero' },
        references: [{ targetId: 'energy', targetType: 'balance.variable' }],
        edges: [
          { type: 'causes', targetId: 'effect', targetType: 'gameplay.effect' },
        ],
      },
    ] as const

    const rootClaims = deriveGameIrSemanticSourceClaims(authority, nodes, [
      {
        subjects: ['node:hero#/'],
        documentPath: 'docs/GDD.md',
        sectionId: 'rules',
        excerpt: 'Hero action consumes energy.',
      },
    ])
    expect(rootClaims.map(claim => claim.subject)).toEqual([
      'node:hero#/edges/0',
      'node:hero#/id',
      'node:hero#/references/0',
      'node:hero#/value/label',
    ])

    const splitClaims = deriveGameIrSemanticSourceClaims(authority, nodes, [
      {
        subjects: [
          'node:hero#/id',
          'node:hero#/value',
          'node:hero#/references',
          'node:hero#/edges',
        ],
        documentPath: 'docs/GDD.md',
        sectionId: 'rules',
        excerpt: 'Hero action consumes energy.',
      },
    ])
    expect(splitClaims).toEqual(rootClaims)
    expect(() =>
      deriveGameIrSemanticSourceClaims(authority, nodes, [
        {
          subjects: ['node:hero#/', 'node:hero#/id'],
          documentPath: 'docs/GDD.md',
          sectionId: 'rules',
          excerpt: 'Hero action consumes energy.',
        },
      ]),
    ).toThrow(/bound more than once/)
    expect(() =>
      deriveGameIrSemanticSourceClaims(authority, nodes, [
        {
          subjects: ['node:hero#/edges/0/targetId'],
          documentPath: 'docs/GDD.md',
          sectionId: 'rules',
          excerpt: 'Hero action consumes energy.',
        },
      ]),
    ).toThrow(/not a semantic target selector/)
  })

  test('rejects repeated excerpts and missing or duplicated target bindings', () => {
    const authority = {
      sectionIndex: [
        {
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'rules',
          digest: 'a'.repeat(64),
        },
      ],
      sectionBytes: { 'docs/GDD.md#rules': 'Hero Hero' },
    }
    const nodes = [
      {
        id: 'hero',
        kind: 'gameplay.entity',
        value: { label: 'Hero' },
        references: [],
        edges: [],
      },
    ] as const
    const group = {
      subjects: ['node:hero#/id'],
      documentPath: 'docs/GDD.md' as const,
      sectionId: 'rules',
      excerpt: 'Hero',
    }
    expect(() =>
      deriveGameIrSemanticSourceClaims(authority, nodes, [group]),
    ).toThrow(/multiple occurrences/)
    const uniqueAuthority = {
      ...authority,
      sectionBytes: { 'docs/GDD.md#rules': 'Hero' },
    }
    expect(() =>
      deriveGameIrSemanticSourceClaims(uniqueAuthority, nodes, [
        { ...group, subjects: ['node:hero#/id', 'node:hero#/id'] },
      ]),
    ).toThrow(/bound more than once/)
    expect(() =>
      deriveGameIrSemanticSourceClaims(uniqueAuthority, nodes, []),
    ).toThrow(/every semantic target exactly once/)
  })
  test('preserves neutral source-section, reason-code, and evidence-pointer bytes', () => {
    const ref: GameIrSemanticSourceSection['ref'] = {
      documentPath: 'docs/GDD.md',
      sectionId: 'rules',
      heading: 'Rules',
      startLine: 3,
      endLine: 4,
      digest: 'b'.repeat(64),
    }
    const sourceSection: GameIrSemanticSourceSection = {
      ref,
      bytes: 'héllo',
    }
    const failure: GameIrSemanticFailureReasonCode =
      GAME_IR_SEMANTIC_FAILURE_REASON_CODES[0]
    const ambiguous: GameIrSemanticAmbiguousReasonCode =
      GAME_IR_SEMANTIC_AMBIGUOUS_REASON_CODES[0]

    expect(sourceSection).toEqual({ ref, bytes: 'héllo' })
    expect(failure).toBe('projection-mismatch')
    expect(ambiguous).toBe('ambiguous-projection')
    expect(sectionEvidencePointer(ref)).toBe(
      'section:docs/GDD.md#rules@' + 'b'.repeat(64),
    )

    const authority = {
      sectionIndex: [ref],
      sectionBytes: { 'docs/GDD.md#rules': sourceSection.bytes },
    }
    verifyGameIrSemanticClaimBytes(authority, {
      subject: 'node:rules#/label',
      documentPath: ref.documentPath,
      sectionId: ref.sectionId,
      sourcePointer: '/bytes/1/3',
      literal: 'é',
    })
    expect(() =>
      verifyGameIrSemanticClaimBytes(authority, {
        subject: 'node:rules#/label',
        documentPath: ref.documentPath,
        sectionId: ref.sectionId,
        sourcePointer: '/bytes/2/3',
        literal: 'l',
      }),
    ).toThrow(
      'invalid Game IR semantic fidelity: source pointer does not lie on UTF-8 code-point boundaries',
    )
  })

  test('derives byte ranges from UTF-8 offsets when the excerpt has a non-ASCII prefix', () => {
    const authority = {
      sectionIndex: [
        {
          documentPath: 'docs/GDD.md' as const,
          sectionId: 'rules',
          digest: 'c'.repeat(64),
        },
      ],
      sectionBytes: { 'docs/GDD.md#rules': '前缀：Hero is ready.' },
    }
    const claims = deriveGameIrSemanticSourceClaims(
      authority,
      [
        {
          id: 'hero',
          kind: 'gameplay.entity',
          value: { label: 'Hero' },
          references: [],
          edges: [],
        },
      ],
      [
        {
          subjects: ['node:hero#/id', 'node:hero#/value/label'],
          documentPath: 'docs/GDD.md',
          sectionId: 'rules',
          excerpt: 'Hero',
        },
      ],
    )
    expect(claims[0]!.sourcePointer).toBe('/bytes/9/13')
    expect(() =>
      verifyGameIrSemanticClaimBytes(authority, claims[0]!),
    ).not.toThrow()
  })

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
