import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceSection,
} from './model'
import {
  admitGameIrSemanticValidationResult,
  buildGameIrSemanticValidationPacket,
} from './semantic-admission'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const digest = 'a'.repeat(64)
const sectionDigest = 'b'.repeat(64)
const technicalSectionDigest = 'c'.repeat(64)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

const sections: readonly GameIrSourceSection[] = [
  {
    documentPath: 'docs/GDD.md',
    sectionId: 'core-loop',
    heading: 'Core Loop',
    startLine: 1,
    endLine: 4,
    digest: sectionDigest,
  },
  {
    documentPath: 'docs/TECHNICAL_DESIGN.md',
    sectionId: 'runtime-states',
    heading: 'Runtime States',
    startLine: 1,
    endLine: 5,
    digest: technicalSectionDigest,
  },
]

function receiptWithoutDigest(): Omit<FoundationReadyReceipt, 'receiptDigest'> {
  return {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sections),
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
}

function request(): GameIrCompileRequest {
  const foundation = receiptWithoutDigest()
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: createHash('sha256')
        .update(canonical(foundation))
        .digest('hex'),
    },
  }
}

function candidate(): GameIrCandidate {
  const owner = {
    kind: 'owner' as const,
    documentPath: 'docs/GDD.md' as const,
    sectionId: 'core-loop',
    sectionDigest,
    sourcePointer: '/entities/player',
  }
  return parseGameIrCandidate(
    {
      schemaVersion: GAME_IR_SCHEMA_VERSION,
      taskId: 'compile-task-1',
      foundationRevision: 'foundation-revision-1',
      modules: [
        {
          moduleId: 'gameplay',
          nodes: [
            {
              id: 'player',
              kind: 'entity',
              producerMode: 'semantic',
              value: { health: 3 },
              bindings: {
                '/id': owner,
                '/value/health': {
                  ...owner,
                  sourcePointer: '/entities/player/health',
                },
              },
            },
          ],
        },
      ],
    },
    { request: request(), sections },
  )
}

function packet() {
  const value = candidate()
  return buildGameIrSemanticValidationPacket({
    candidate: value,
    moduleId: 'gameplay',
    sourceSections: [sections[0]!],
  })
}

describe('isolated Game IR semantic projection admission', () => {
  test('binds an immutable module candidate and exact source sections', () => {
    const value = candidate()
    const before = digestGameIrValue(value.modules[0]!)
    const result = buildGameIrSemanticValidationPacket({
      candidate: value,
      moduleId: 'gameplay',
      sourceSections: [sections[0]!],
    })

    expect(result).toEqual({
      schemaVersion: 'game-ir-semantic-validation-packet.v1',
      taskId: 'compile-task-1',
      foundationRevision: 'foundation-revision-1',
      moduleId: 'gameplay',
      candidateDigest: before,
      sourceSections: [sections[0]!],
      packetDigest: expect.any(String),
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.sourceSections)).toBe(true)
    expect(result.packetDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(digestGameIrValue(value.modules[0]!)).toBe(before)
  })

  test('admits the exact PASS result and freezes the evidence', () => {
    const result = admitGameIrSemanticValidationResult(packet(), {
      outcome: 'PASS',
      packetDigest: packet().packetDigest,
    })
    expect(result).toEqual({
      outcome: 'PASS',
      packetDigest: packet().packetDigest,
    })
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('admits structured FAIL and AMBIGUOUS diagnostics', () => {
    const value = packet()
    for (const outcome of ['FAIL', 'AMBIGUOUS'] as const) {
      const result = admitGameIrSemanticValidationResult(value, {
        outcome,
        packetDigest: value.packetDigest,
        reasonCode:
          outcome === 'FAIL' ? 'projection-mismatch' : 'owner-ambiguous',
        actual: 'the source admits more than one projection',
        evidencePointers: ['docs/GDD.md#core-loop'],
      })
      expect(result.outcome).toBe(outcome)
      if (result.outcome !== 'PASS')
        expect(Object.isFrozen(result.evidencePointers)).toBe(true)
    }
  })

  test('rejects worker identity, workflow, and replacement-candidate fields', () => {
    const value = packet()
    for (const extra of [
      { expected: 'worker supplied expectation' },
      { target: { documentPath: 'docs/GDD.md', sectionId: 'core-loop' } },
      { Patch: { sectionId: 'core-loop' } },
      { candidate: candidate() },
      { taskId: 'other-task' },
      { moduleId: 'other-module' },
    ]) {
      expect(() =>
        admitGameIrSemanticValidationResult(value, {
          outcome: 'PASS',
          packetDigest: value.packetDigest,
          ...extra,
        }),
      ).toThrow(/result|field|identity|extra|shape/i)
    }
  })

  test('rejects stale packet digests and unknown or duplicate evidence', () => {
    const value = packet()
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'PASS',
        packetDigest: 'f'.repeat(64),
      }),
    ).toThrow(/packet|digest/i)
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'FAIL',
        packetDigest: value.packetDigest,
        reasonCode: 'bad-projection',
        actual: 'bad',
        evidencePointers: ['docs/GDD.md#unknown'],
      }),
    ).toThrow(/evidence|pointer/i)
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'AMBIGUOUS',
        packetDigest: value.packetDigest,
        reasonCode: 'ambiguous',
        actual: 'ambiguous',
        evidencePointers: ['docs/GDD.md#core-loop', 'docs/GDD.md#core-loop'],
      }),
    ).toThrow(/duplicate|evidence|pointer/i)
  })
})
