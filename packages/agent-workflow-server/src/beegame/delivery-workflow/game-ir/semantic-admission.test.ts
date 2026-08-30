import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  admitGameIrSemanticValidationResult,
  buildGameIrSemanticValidationPacket,
  type GameIrSemanticValidationPacketInput,
} from './semantic-admission'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const receiptDigest = 'a'.repeat(64)
const markdown = '# Core Loop\n\nThe player survives.'
const rulesMarkdown = '# Rules\n\nThe player wins.'
const sectionDigest = createHash('sha256').update(markdown).digest('hex')
const rulesDigest = createHash('sha256').update(rulesMarkdown).digest('hex')

const sectionIndex: readonly GameIrSourceSection[] = [
  {
    documentPath: 'docs/GDD.md' as FoundationDocumentPath,
    sectionId: 'core-loop',
    heading: 'Core Loop',
    startLine: 1,
    endLine: 3,
    digest: sectionDigest,
  },
  {
    documentPath: 'docs/GDD.md' as FoundationDocumentPath,
    sectionId: 'rules',
    heading: 'Rules',
    startLine: 4,
    endLine: 6,
    digest: rulesDigest,
  },
  ...CANONICAL_FOUNDATION_DOCUMENTS.filter(path => path !== 'docs/GDD.md')
    .sort((left, right) => left.localeCompare(right))
    .map((documentPath, index) => ({
      documentPath: documentPath as FoundationDocumentPath,
      sectionId: `section-${index}`,
      heading: `Section ${index}`,
      startLine: 1,
      endLine: 3,
      digest: createHash('sha256')
        .update(`# ${documentPath}\n\nSource ${index}.`)
        .digest('hex'),
    })),
].sort((left, right) =>
  `${left.documentPath}\0${left.startLine}\0${left.sectionId}`.localeCompare(
    `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
  ),
)

function sectionKey(
  ref: Pick<GameIrSourceSection, 'documentPath' | 'sectionId'>,
): string {
  return `${ref.documentPath}#${ref.sectionId}`
}

function sectionBytesFor(moduleId: string): Record<string, string> {
  const module = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
    item => item.moduleId === moduleId,
  )!
  return Object.fromEntries(
    sectionIndex
      .filter(section =>
        module.sourceDocumentPaths.includes(section.documentPath),
      )
      .map(section => [
        sectionKey(section),
        section.documentPath === 'docs/GDD.md'
          ? section.sectionId === 'core-loop'
            ? markdown
            : rulesMarkdown
          : `# ${section.documentPath}\n\nSource ${section.sectionId.replace('section-', '')}.`,
      ]),
  )
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function foundation(): FoundationReadyReceipt {
  const withoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: receiptDigest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, receiptDigest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: receiptDigest,
      issueRegistryDigest: receiptDigest,
    },
  }
  return {
    ...withoutDigest,
    receiptDigest: createHash('sha256')
      .update(canonical(withoutDigest))
      .digest('hex'),
  }
}

function request(): GameIrCompileRequest {
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: foundation(),
  }
}

const moduleIds = [...GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules].map(
  item => item.moduleId,
)

function rawCandidate(): Record<string, unknown> {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: moduleIds.map(moduleId => ({
      moduleId,
      nodes: [
        {
          id: `${moduleId}.root`,
          kind: 'semantic-node',
          producerMode: 'semantic',
          value: { label: moduleId },
          bindings: {
            '/id': {
              kind: 'owner',
              documentPath: 'docs/GDD.md',
              sectionId: 'core-loop',
              sectionDigest,
              sourcePointer: `/ir/${moduleId}`,
            },
            '/value/label': {
              kind: 'owner',
              documentPath: 'docs/GDD.md',
              sectionId: 'core-loop',
              sectionDigest,
              sourcePointer: `/ir/${moduleId}/label`,
            },
          },
        },
      ],
    })),
  }
}

function candidate(): GameIrCandidate {
  return parseGameIrCandidate(rawCandidate(), {
    request: request(),
    sections: sectionIndex,
  })
}

function input(
  overrides: Record<string, unknown> = {},
): GameIrSemanticValidationPacketInput {
  return {
    candidate: candidate(),
    request: request(),
    sectionIndex,
    moduleId: 'gameplay',
    sectionBytes: sectionBytesFor('gameplay'),
    ...overrides,
  } as GameIrSemanticValidationPacketInput
}

function packet() {
  return buildGameIrSemanticValidationPacket(input())
}

function withPacketDigest(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { packetDigest: _packetDigest, ...body } = value
  return {
    ...value,
    packetDigest: createHash('sha256').update(canonical(body)).digest('hex'),
  }
}

describe('isolated Game IR semantic projection admission', () => {
  test('service-owned validator modules declare the canonical source document scope', () => {
    const expected: Record<string, readonly FoundationDocumentPath[]> = {
      core: ['docs/GDD.md'],
      gameplay: ['docs/GDD.md'],
      balance: [
        'docs/GDD.md',
        'docs/BALANCE_DESIGN.md',
      ].sort() as FoundationDocumentPath[],
      'world-scene': [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
      ].sort() as FoundationDocumentPath[],
      presentation: [
        'docs/GDD.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
      ].sort() as FoundationDocumentPath[],
      'resource-realization': [
        'docs/ASSET_PLAN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
        'docs/LEVEL_SCENE_DESIGN.md',
      ].sort() as FoundationDocumentPath[],
      'implementation-verification': [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
      ].sort() as FoundationDocumentPath[],
    }
    for (const module of GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules) {
      expect(module.sourceDocumentPaths).toEqual(
        expected[module.moduleId as keyof typeof expected],
      )
      expect(Object.isFrozen(module.sourceDocumentPaths)).toBe(true)
      expect([...module.sourceDocumentPaths]).toEqual(
        [...module.sourceDocumentPaths].sort(),
      )
    }
    expect(Object.isFrozen(GAME_IR_SEMANTIC_VALIDATOR_MANIFEST)).toBe(true)
  })

  test('validator scope cannot be shrunk to the candidate owner binding', () => {
    const gameplay = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
      module => module.moduleId === 'gameplay',
    )!
    expect(gameplay.sourceDocumentPaths).toContain('docs/GDD.md')
    expect(gameplay.sourceDocumentPaths).toEqual(['docs/GDD.md'])
    const sourceSection = sectionIndex.find(
      section => section.documentPath === 'docs/GDD.md',
    )!
    const packetInput = input({
      moduleId: 'gameplay',
      sectionBytes: sectionBytesFor('gameplay'),
    })
    const value = buildGameIrSemanticValidationPacket(packetInput)
    expect(value.sourceSections.map(item => sectionKey(item.ref))).toEqual([
      'docs/GDD.md#core-loop',
      'docs/GDD.md#rules',
    ])
    expect(value.sourceSections.map(item => item.bytes)).toEqual([
      markdown,
      rulesMarkdown,
    ])
    expect(value.allowedEvidencePointers).toContain(
      `section:docs/GDD.md#rules@${rulesDigest}`,
    )
  })

  test('rejects a packet when any manifest-required section bytes are omitted', () => {
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({
          sectionBytes: { 'docs/GDD.md#core-loop': markdown },
        }),
      ),
    ).toThrow(/sectionBytes|source closure|missing/i)
  })

  test('includes every manifest document and rejects extra or missing bytes for a multi-document module', () => {
    const value = buildGameIrSemanticValidationPacket(
      input({ moduleId: 'balance', sectionBytes: sectionBytesFor('balance') }),
    )
    expect(value.sourceSections.map(item => sectionKey(item.ref))).toEqual([
      sectionKey(
        sectionIndex.find(
          section => section.documentPath === 'docs/BALANCE_DESIGN.md',
        )!,
      ),
      'docs/GDD.md#core-loop',
      'docs/GDD.md#rules',
    ])
    const bytes = sectionBytesFor('balance')
    delete bytes[
      sectionKey(
        sectionIndex.find(
          section => section.documentPath === 'docs/BALANCE_DESIGN.md',
        )!,
      )
    ]
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({ moduleId: 'balance', sectionBytes: bytes }),
      ),
    ).toThrow(/sectionBytes|source closure|missing/i)
  })

  test('fix Critical: rejects a missing or empty canonical module before packet construction', () => {
    const modules = rawCandidate().modules as unknown[]
    const missing = rawCandidate()
    missing.modules = moduleIds
      .filter(moduleId => moduleId !== 'gameplay')
      .map(moduleId =>
        modules.find(
          item => (item as { moduleId: string }).moduleId === moduleId,
        ),
      )
    const empty = rawCandidate()
    empty.modules = moduleIds.map(moduleId =>
      moduleId === 'gameplay'
        ? { moduleId, nodes: [] }
        : (rawCandidate().modules as unknown[]).find(
            item => (item as { moduleId: string }).moduleId === moduleId,
          ),
    )
    for (const value of [missing, empty]) {
      expect(() =>
        buildGameIrSemanticValidationPacket(
          input({
            candidate: parseGameIrCandidate(value, {
              request: request(),
              sections: sectionIndex,
            }),
          }),
        ),
      ).toThrow(/module|canonical|empty|node/i)
    }
  })

  test('fix Critical: rejects forged Section Index metadata and non-exact source bytes', () => {
    const forgedIndex = [{ ...sectionIndex[0]!, heading: 'Forged heading' }]
    expect(() =>
      buildGameIrSemanticValidationPacket(input({ sectionIndex: forgedIndex })),
    ).toThrow(/section|digest/i)
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({ sectionBytes: { 'docs/GDD.md#core-loop': 'different bytes' } }),
      ),
    ).toThrow(/byte|digest|source/i)
    expect(() =>
      buildGameIrSemanticValidationPacket(input({ sectionBytes: {} })),
    ).toThrow(/byte|source|missing/i)
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({
          sectionBytes: {
            'docs/GDD.md#core-loop': markdown,
            'docs/TECHNICAL_DESIGN.md#runtime': markdown,
          },
        }),
      ),
    ).toThrow(/byte|source|extra/i)
  })

  test('fix Critical: accepts only a complete admitted candidate and rejects detached relabeling', () => {
    const detached = candidate().modules.find(
      item => item.moduleId === 'gameplay',
    )!
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({
          candidate: detached,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
        }),
      ),
    ).toThrow(/candidate|complete|detached|module|unknown|input/i)
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({ taskId: 'caller-relabelled-task' }),
      ),
    ).toThrow(/unknown|identity|task|input/i)
    expect(() =>
      buildGameIrSemanticValidationPacket(
        input({ foundationRevision: 'caller-relabelled-revision' }),
      ),
    ).toThrow(/unknown|identity|revision|input/i)
  })

  test('fix Important: PASS requires exact manifest coverage, while empty PASS is rejected', () => {
    const value = packet()
    expect(value.candidateBytes).toBe(canonicalGameIrJson(candidate()))
    expect(value.candidateDigest).toBe(digestGameIrValue(candidate()))
    const expected = [...GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules].find(
      item => item.moduleId === 'gameplay',
    )!.checkIds
    expect(expected.length).toBeGreaterThan(0)
    for (const checkIds of [
      [],
      expected.slice(1),
      [...expected, 'worker-injected-check'],
      [...expected].reverse(),
      [...expected, expected[0]!],
    ]) {
      expect(() =>
        admitGameIrSemanticValidationResult(value, {
          outcome: 'PASS',
          packetDigest: value.packetDigest,
          checkIds,
        }),
      ).toThrow(/check|coverage|manifest|order|duplicate/i)
    }
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'PASS',
        packetDigest: value.packetDigest,
      }),
    ).toThrow(/check|coverage|shape|unknown|missing/i)
    const admitted = admitGameIrSemanticValidationResult(value, {
      outcome: 'PASS',
      packetDigest: value.packetDigest,
      checkIds: expected,
    })
    expect(admitted).toEqual({
      outcome: 'PASS',
      packetDigest: value.packetDigest,
      checkIds: expected,
    })
    expect(Object.isFrozen(admitted)).toBe(true)
  })

  test('fix Important: diagnostics require exact owner evidence namespace, never coarse sections', () => {
    const value = packet()
    const exact = [
      'binding:docs/GDD.md#core-loop/ir/gameplay',
      'binding:docs/GDD.md#core-loop/ir/gameplay/label',
    ]
    for (const outcome of ['FAIL', 'AMBIGUOUS'] as const) {
      const admitted = admitGameIrSemanticValidationResult(value, {
        outcome,
        packetDigest: value.packetDigest,
        reasonCode: 'projection-mismatch',
        actual: 'projection is not supported by source',
        evidencePointers: exact,
      })
      expect(admitted.outcome).toBe(outcome)
      const sectionEvidence = admitGameIrSemanticValidationResult(value, {
        outcome,
        packetDigest: value.packetDigest,
        reasonCode: 'missing-projection',
        actual: 'required source was not projected',
        evidencePointers: [`section:docs/GDD.md#rules@${rulesDigest}`],
      })
      expect(sectionEvidence.outcome).toBe(outcome)
    }
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'FAIL',
        packetDigest: value.packetDigest,
        reasonCode: 'coarse-evidence',
        actual: 'section only',
        evidencePointers: ['docs/GDD.md#core-loop'],
      }),
    ).toThrow(/evidence|pointer|owner/i)
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'AMBIGUOUS',
        packetDigest: value.packetDigest,
        reasonCode: 'duplicate-evidence',
        actual: 'duplicate',
        evidencePointers: [exact[0]!, exact[0]!],
      }),
    ).toThrow(/duplicate|evidence|pointer/i)
    expect(() =>
      admitGameIrSemanticValidationResult(value, {
        outcome: 'FAIL',
        packetDigest: value.packetDigest,
        reasonCode: 'worker-fields',
        actual: 'forged',
        evidencePointers: exact,
        expected: 'worker supplied expected',
        target: 'worker supplied target',
        Patch: 'worker supplied patch',
        candidate: candidate(),
      }),
    ).toThrow(/extra|field|result|shape/i)
  })

  test('binds immutable candidate bytes and rejects stale packet or manifest identity', () => {
    const value = packet()
    const before = digestGameIrValue(candidate())
    expect(() =>
      admitGameIrSemanticValidationResult(
        { ...value, candidateDigest: 'f'.repeat(64) },
        {
          outcome: 'PASS',
          packetDigest: value.packetDigest,
          checkIds: value.checkIds,
        },
      ),
    ).toThrow(/packet|candidate|digest/i)
    expect(() =>
      admitGameIrSemanticValidationResult(
        {
          ...value,
          validatorManifestDigest: 'f'.repeat(64),
        },
        {
          outcome: 'PASS',
          packetDigest: value.packetDigest,
          checkIds: value.checkIds,
        },
      ),
    ).toThrow(/manifest|field|packet/i)
    expect(digestGameIrValue(candidate())).toBe(before)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.sourceSections)).toBe(true)
  })

  test('fix Important: rejects source ref metadata forged with a recomputed packet digest', () => {
    const value = packet()
    for (const refPatch of [{ heading: 'Forged heading' }, { endLine: 99 }]) {
      const forged = withPacketDigest({
        ...value,
        sourceSections: [
          {
            ...value.sourceSections[0]!,
            ref: { ...value.sourceSections[0]!.ref, ...refPatch },
          },
        ],
      })
      expect(() =>
        admitGameIrSemanticValidationResult(forged as never, {
          outcome: 'PASS',
          packetDigest: forged.packetDigest,
          checkIds: value.checkIds,
        }),
      ).toThrow(/section|metadata|source|index|digest/i)
    }
  })

  test('fix Important: PASS checkIds rejects sparse, undefined, accessor, and custom array state', () => {
    const value = packet()
    const expected = [...value.checkIds]
    const sparse = new Array(expected.length) as string[]
    const deleted = [...expected]
    delete deleted[0]
    const undefinedEntry = [...expected]
    undefinedEntry[0] = undefined as never
    const accessor = [...expected] as string[]
    Object.defineProperty(accessor, '0', {
      configurable: true,
      enumerable: true,
      get: () => expected[0],
    })
    const custom = [...expected] as string[] & { hidden?: string }
    custom.hidden = 'forged'
    for (const checkIds of [
      sparse,
      deleted,
      undefinedEntry,
      accessor,
      custom,
    ]) {
      expect(() =>
        admitGameIrSemanticValidationResult(value, {
          outcome: 'PASS',
          packetDigest: value.packetDigest,
          checkIds,
        }),
      ).toThrow(/check|coverage|array|dense|property|json/i)
    }
  })

  test('fix Important: build and admission do not mutate or alias one shared input', () => {
    const shared = input()
    const candidateBefore = digestGameIrValue(shared.candidate)
    const sectionIndexBefore = canonical(shared.sectionIndex)
    const sourceBytes = shared.sectionBytes as Record<string, string>
    const sourceBytesBefore = { ...sourceBytes }
    const packetValue = buildGameIrSemanticValidationPacket(shared)
    admitGameIrSemanticValidationResult(packetValue, {
      outcome: 'PASS',
      packetDigest: packetValue.packetDigest,
      checkIds: packetValue.checkIds,
    })
    sourceBytes['docs/GDD.md#core-loop'] = 'mutated after packet construction'
    expect(digestGameIrValue(shared.candidate)).toBe(candidateBefore)
    expect(canonical(shared.sectionIndex)).toBe(sectionIndexBefore)
    expect(sourceBytesBefore['docs/GDD.md#core-loop']).toBe(markdown)
    expect(
      packetValue.sourceSections.find(
        item => item.ref.sectionId === 'core-loop',
      )!.bytes,
    ).toBe(markdown)
    expect(packetValue.candidateDigest).toBe(candidateBefore)
    expect(packetValue.candidateBytes).toBe(
      canonicalGameIrJson(shared.candidate),
    )
  })
})
