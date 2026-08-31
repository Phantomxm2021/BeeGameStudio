import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  GAME_IR_CANONICAL_MODULE_IDS,
  type GameIrModuleId,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import type { GameIrSourceSection } from './model'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import {
  GAME_IR_DOMAIN_IDS,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
  buildGameIrDomainSourceEnvelope,
  canonicalGameIrModuleSourceDocuments,
  isGameIrDomainId,
  validateGameIrDomainSourceEnvelope,
} from './domain-source'
import { digestGameIrValue } from './model'

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

const sectionBytes: Record<string, string> = Object.fromEntries(
  CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => {
    const bytes = `# ${documentPath}\n\nSection ${index}.`
    return [documentPath, bytes]
  }),
)

const sectionIndex: readonly GameIrSourceSection[] =
  CANONICAL_FOUNDATION_DOCUMENTS.map((documentPath, index) => ({
    documentPath,
    sectionId: `section-${index}`,
    heading: `Section ${index}`,
    startLine: 1,
    endLine: 3,
    digest: digest(sectionBytes[documentPath]!),
  }))

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function request(
  boundSectionIndex: readonly GameIrSourceSection[] = sectionIndex,
): GameIrCompileRequest {
  const withoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'b'.repeat(64)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(boundSectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'c'.repeat(64),
      issueRegistryDigest: 'd'.repeat(64),
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...withoutDigest,
      receiptDigest: digest(canonical(withoutDigest)),
    },
  }
}

function exactBytes(): Record<string, string> {
  return Object.fromEntries(
    sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      sectionBytes[section.documentPath]!,
    ]),
  )
}

function exactGameplayBytes(): Record<string, string> {
  return { 'docs/GDD.md#section-0': sectionBytes['docs/GDD.md']! }
}

function exactBalanceBytes(): Record<string, string> {
  return {
    'docs/BALANCE_DESIGN.md#section-2': sectionBytes['docs/BALANCE_DESIGN.md']!,
    'docs/GDD.md#section-0': sectionBytes['docs/GDD.md']!,
  }
}

function exactImplementationBytes(): Record<string, string> {
  return Object.fromEntries(
    sectionIndex
      .filter(section =>
        canonicalGameIrModuleSourceDocuments(
          'implementation-verification',
        ).includes(section.documentPath),
      )
      .map(section => [
        `${section.documentPath}#${section.sectionId}`,
        sectionBytes[section.documentPath]!,
      ]),
  )
}

function exactResourceBytes(): Record<string, string> {
  return Object.fromEntries(
    sectionIndex
      .filter(section =>
        canonicalGameIrModuleSourceDocuments('resource-realization').includes(
          section.documentPath,
        ),
      )
      .map(section => [
        `${section.documentPath}#${section.sectionId}`,
        sectionBytes[section.documentPath]!,
      ]),
  )
}

describe('Game IR domain source closure', () => {
  test('accepts only the admitted isolated domain IDs at the envelope boundary', () => {
    expect(GAME_IR_DOMAIN_IDS).toEqual([
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
      'resource-realization',
      'implementation-verification',
    ])
    for (const moduleId of GAME_IR_DOMAIN_IDS)
      expect(isGameIrDomainId(moduleId)).toBe(true)
    const gameplay = buildGameIrDomainSourceEnvelope({
      moduleId: 'gameplay',
      request: request(),
      sectionIndex,
      sectionBytes: exactGameplayBytes(),
    })
    const sourceBytes = (documents: readonly FoundationDocumentPath[]) =>
      Object.fromEntries(
        sectionIndex
          .filter(section => documents.includes(section.documentPath))
          .map(section => [
            `${section.documentPath}#${section.sectionId}`,
            sectionBytes[section.documentPath]!,
          ]),
      )
    const resource = buildGameIrDomainSourceEnvelope({
      moduleId: 'resource-realization',
      request: request(),
      sectionIndex,
      sectionBytes: exactResourceBytes(),
    })
    expect(resource.sectionIndex.map(section => section.documentPath)).toEqual([
      ...canonicalGameIrModuleSourceDocuments('resource-realization'),
    ])
    expect(isGameIrDomainId('core')).toBe(false)
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'core',
        request: request(),
        sectionIndex,
        sectionBytes: {},
      } as never),
    ).toThrow(/moduleId|domain/i)
    expect(() =>
      validateGameIrDomainSourceEnvelope({
        ...gameplay,
        moduleId: 'core',
      } as never),
    ).toThrow(/moduleId|domain/i)
  })

  test('owns the exact canonical source documents for every module', () => {
    const expected: Record<GameIrModuleId, readonly FoundationDocumentPath[]> =
      {
        gameplay: ['docs/GDD.md'],
        balance: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
        'world-scene': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
        presentation: [
          'docs/GDD.md',
          'docs/ART_DIRECTION.md',
          'docs/UI_UX_SPEC.md',
          'docs/AUDIO_DESIGN.md',
        ],
        'resource-realization': [
          'docs/ASSET_PLAN.md',
          'docs/TECHNICAL_DESIGN.md',
          'docs/ART_DIRECTION.md',
          'docs/UI_UX_SPEC.md',
          'docs/AUDIO_DESIGN.md',
          'docs/LEVEL_SCENE_DESIGN.md',
        ],
        'implementation-verification': [
          'docs/GDD.md',
          'docs/LEVEL_SCENE_DESIGN.md',
          'docs/BALANCE_DESIGN.md',
          'docs/TECHNICAL_DESIGN.md',
        ],
      }
    expect(Object.keys(GAME_IR_MODULE_SOURCE_DOCUMENTS).sort()).toEqual(
      [...GAME_IR_CANONICAL_MODULE_IDS].sort(),
    )
    for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS) {
      expect(GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId]).toEqual(
        expected[moduleId],
      )
      expect(Object.isFrozen(GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId])).toBe(
        true,
      )
      expect(canonicalGameIrModuleSourceDocuments(moduleId)).toEqual(
        [...expected[moduleId]].sort(),
      )
      expect(
        Object.isFrozen(canonicalGameIrModuleSourceDocuments(moduleId)),
      ).toBe(true)
    }
  })

  test('builds Gameplay from exactly every GDD Section Index entry', () => {
    const envelope = buildGameIrDomainSourceEnvelope({
      moduleId: 'gameplay',
      request: request(),
      sectionIndex,
      sectionBytes: exactGameplayBytes(),
    })

    expect(envelope.sectionIndex).not.toHaveLength(0)
    expect(
      envelope.sectionIndex.every(
        section => section.documentPath === 'docs/GDD.md',
      ),
    ).toBe(true)
    expect(Object.keys(envelope.sectionBytes)).toEqual([
      'docs/GDD.md#section-0',
    ])
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.sectionIndex)).toBe(true)
    expect(Object.isFrozen(envelope.sectionBytes)).toBe(true)
  })

  test('builds Balance from exactly every GDD and Balance entry', () => {
    const envelope = buildGameIrDomainSourceEnvelope({
      moduleId: 'balance',
      request: request(),
      sectionIndex,
      sectionBytes: exactBalanceBytes(),
    })

    expect(envelope.sectionIndex.map(section => section.documentPath)).toEqual([
      'docs/BALANCE_DESIGN.md',
      'docs/GDD.md',
    ])
  })

  test('builds World and Presentation from their exact selected closures', () => {
    const sourceBytes = (documents: readonly FoundationDocumentPath[]) =>
      Object.fromEntries(
        sectionIndex
          .filter(section => documents.includes(section.documentPath))
          .map(section => [
            `${section.documentPath}#${section.sectionId}`,
            sectionBytes[section.documentPath]!,
          ]),
      )
    const world = buildGameIrDomainSourceEnvelope({
      moduleId: 'world-scene',
      request: request(),
      sectionIndex,
      sectionBytes: sourceBytes(
        canonicalGameIrModuleSourceDocuments('world-scene'),
      ),
    })
    const presentation = buildGameIrDomainSourceEnvelope({
      moduleId: 'presentation',
      request: request(),
      sectionIndex,
      sectionBytes: sourceBytes(
        canonicalGameIrModuleSourceDocuments('presentation'),
      ),
    })

    expect(world.authoritySectionIndex).toHaveLength(8)
    expect(world.sectionIndex.map(section => section.documentPath)).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
    ])
    expect(
      presentation.sectionIndex.map(section => section.documentPath),
    ).toEqual([
      'docs/ART_DIRECTION.md',
      'docs/AUDIO_DESIGN.md',
      'docs/GDD.md',
      'docs/UI_UX_SPEC.md',
    ])
  })

  test('requires Resource Realization to use exactly its six-document closure', () => {
    const base = {
      moduleId: 'resource-realization' as const,
      request: request(),
      sectionIndex,
    }
    const exact = exactResourceBytes()
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: exact }),
    ).not.toThrow()

    const omitted = { ...exact }
    delete omitted['docs/ASSET_PLAN.md#section-7']
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: omitted }),
    ).toThrow(/exact|bytes|closure/i)

    const extra = {
      ...exact,
      'docs/GDD.md#section-0': sectionBytes['docs/GDD.md']!,
    }
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: extra }),
    ).toThrow(/exact|bytes|closure/i)

    const mixed = {
      ...exact,
      'docs/BALANCE_DESIGN.md#section-2':
        sectionBytes['docs/BALANCE_DESIGN.md']!,
    }
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: mixed }),
    ).toThrow(/exact|bytes|closure/i)
  })

  test('builds Implementation Verification from every receipt-bound entry in exactly four documents', () => {
    const envelope = buildGameIrDomainSourceEnvelope({
      moduleId: 'implementation-verification',
      request: request(),
      sectionIndex,
      sectionBytes: exactImplementationBytes(),
    })

    expect(envelope.sectionIndex.map(section => section.documentPath)).toEqual([
      'docs/BALANCE_DESIGN.md',
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
    ])
    expect(Object.keys(envelope.sectionBytes).sort()).toEqual(
      Object.keys(exactImplementationBytes()).sort(),
    )
    expect(
      envelope.sectionIndex.map(
        section => `${section.documentPath}#${section.sectionId}`,
      ),
    ).toEqual(Object.keys(exactImplementationBytes()).sort())
  })

  test('retains every Implementation Verification section when a source document has multiple entries', () => {
    const extraBytes = Object.fromEntries(
      sectionIndex
        .filter(section =>
          canonicalGameIrModuleSourceDocuments(
            'implementation-verification',
          ).includes(section.documentPath),
        )
        .map(section => [
          section.documentPath,
          `# extra ${section.documentPath}`,
        ]),
    ) as Record<string, string>
    const expandedIndex = [
      ...sectionIndex,
      ...sectionIndex
        .filter(section =>
          canonicalGameIrModuleSourceDocuments(
            'implementation-verification',
          ).includes(section.documentPath),
        )
        .map(section => ({
          ...section,
          sectionId: `${section.sectionId}-extra`,
          heading: `${section.heading} extra`,
          digest: digest(extraBytes[section.documentPath]!),
        })),
    ]
    const implementationSections = expandedIndex.filter(section =>
      canonicalGameIrModuleSourceDocuments(
        'implementation-verification',
      ).includes(section.documentPath),
    )
    const implementationBytes = Object.fromEntries(
      implementationSections.map(section => [
        `${section.documentPath}#${section.sectionId}`,
        section.sectionId.endsWith('-extra')
          ? extraBytes[section.documentPath]!
          : sectionBytes[section.documentPath]!,
      ]),
    )
    const envelope = buildGameIrDomainSourceEnvelope({
      moduleId: 'implementation-verification',
      request: request(expandedIndex),
      sectionIndex: expandedIndex,
      sectionBytes: implementationBytes,
    })

    expect(envelope.sectionIndex).toHaveLength(implementationSections.length)
    expect(envelope.sectionIndex).toEqual(
      implementationSections.sort((left, right) =>
        `${left.documentPath}#${left.sectionId}`.localeCompare(
          `${right.documentPath}#${right.sectionId}`,
        ),
      ),
    )
    expect(Object.keys(envelope.sectionBytes).sort()).toEqual(
      Object.keys(implementationBytes).sort(),
    )
  })

  test('rejects narrowed, extra, or altered Implementation Verification closure bytes', () => {
    const base = {
      moduleId: 'implementation-verification' as const,
      request: request(),
      sectionIndex,
    }
    const exact = exactImplementationBytes()
    const missing = { ...exact }
    delete missing['docs/TECHNICAL_DESIGN.md#section-3']
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: missing }),
    ).toThrow(/exact|missing|bytes|closure/i)

    const extra = {
      ...exact,
      'docs/ART_DIRECTION.md#section-4': sectionBytes['docs/ART_DIRECTION.md']!,
    }
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: extra }),
    ).toThrow(/exact|extra|bytes|closure/i)

    const altered = { ...exact }
    altered['docs/TECHNICAL_DESIGN.md#section-3'] = 'altered'
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: altered }),
    ).toThrow(/digest|bytes/i)
  })

  test('keeps the existing four domain envelopes byte-equivalent', () => {
    const existing = [
      'gameplay',
      'balance',
      'world-scene',
      'presentation',
    ] as const
    const sourceBytes = (moduleId: GameIrModuleId) =>
      Object.fromEntries(
        sectionIndex
          .filter(section =>
            canonicalGameIrModuleSourceDocuments(moduleId).includes(
              section.documentPath,
            ),
          )
          .map(section => [
            `${section.documentPath}#${section.sectionId}`,
            sectionBytes[section.documentPath]!,
          ]),
      )
    for (const moduleId of existing) {
      const first = buildGameIrDomainSourceEnvelope({
        moduleId,
        request: request(),
        sectionIndex,
        sectionBytes: sourceBytes(moduleId),
      })
      const second = buildGameIrDomainSourceEnvelope({
        moduleId,
        request: request(),
        sectionIndex: [...sectionIndex].reverse(),
        sectionBytes: sourceBytes(moduleId),
      })
      expect(second.sourceDigest).toBe(first.sourceDigest)
      expect(canonical(second)).toBe(canonical(first))
    }
  })

  test('canonicalizes receipt-valid caller permutations before selecting a domain', () => {
    const first = buildGameIrDomainSourceEnvelope({
      moduleId: 'balance',
      request: request(),
      sectionIndex,
      sectionBytes: exactBalanceBytes(),
    })
    const permuted = buildGameIrDomainSourceEnvelope({
      moduleId: 'balance',
      request: request(),
      sectionIndex: [...sectionIndex].reverse(),
      sectionBytes: exactBalanceBytes(),
    })

    expect(permuted.authoritySectionIndex).toEqual(first.authoritySectionIndex)
    expect(permuted.sectionIndex).toEqual(first.sectionIndex)
    expect(permuted.sourceDigest).toBe(first.sourceDigest)
    expect(canonical(permuted)).toBe(canonical(first))
  })

  test('rejects missing, extra, or altered closure bytes', () => {
    const base = {
      moduleId: 'gameplay' as const,
      request: request(),
      sectionIndex,
    }
    const missing = exactGameplayBytes()
    delete missing['docs/GDD.md#section-0']
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: missing }),
    ).toThrow(/exact|missing|bytes/i)

    const extra = exactGameplayBytes()
    extra['docs/TECHNICAL_DESIGN.md#extra'] = 'extra'
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: extra }),
    ).toThrow(/exact|extra|bytes/i)

    const altered = exactGameplayBytes()
    altered['docs/GDD.md#section-0'] = 'altered'
    expect(() =>
      buildGameIrDomainSourceEnvelope({ ...base, sectionBytes: altered }),
    ).toThrow(/digest|bytes/i)
  })

  test('rejects an incomplete eight-document index and caller-narrowed scope', () => {
    const incomplete = sectionIndex.filter(
      section => section.documentPath !== 'docs/ASSET_PLAN.md',
    )
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'gameplay',
        request: request(),
        sectionIndex: incomplete,
        sectionBytes: exactGameplayBytes(),
      }),
    ).toThrow(/complete|eight|document|index/i)

    const narrowed = sectionIndex.filter(
      section => section.documentPath === 'docs/GDD.md',
    )
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'balance',
        request: request(),
        sectionIndex: narrowed,
        sectionBytes: exactBytes(),
      }),
    ).toThrow(/complete|eight|document|index/i)
  })

  test('rejects stale receipt index digests and hidden or accessor properties', () => {
    const freshRequest = request()
    const staleRequest = {
      ...freshRequest,
      foundation: {
        ...freshRequest.foundation,
        sectionIndexDigest: 'e'.repeat(64),
      },
    }
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'gameplay',
        request: staleRequest,
        sectionIndex,
        sectionBytes: exactBytes(),
      }),
    ).toThrow(/section|digest/i)

    const hidden = exactBytes()
    Object.defineProperty(hidden, 'hidden', {
      value: 'hidden',
      enumerable: false,
    })
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'gameplay',
        request: request(),
        sectionIndex,
        sectionBytes: hidden,
      }),
    ).toThrow(/property|hidden|bytes/i)

    let invoked = false
    const accessor = exactBytes()
    Object.defineProperty(accessor, 'docs/GDD.md#section-0', {
      enumerable: true,
      get() {
        invoked = true
        return sectionBytes['docs/GDD.md']
      },
    })
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'gameplay',
        request: request(),
        sectionIndex,
        sectionBytes: accessor,
      }),
    ).toThrow(/property|accessor|bytes/i)
    expect(invoked).toBe(false)
  })

  test('does not treat a caller-owned narrowed Section Index as authority', () => {
    const callerNarrowed = sectionIndex.filter(
      section => section.documentPath === 'docs/GDD.md',
    ) as readonly GameIrSourceSection[]
    expect(callerNarrowed).toHaveLength(1)
    expect(() =>
      buildGameIrDomainSourceEnvelope({
        moduleId: 'balance',
        request: request(),
        sectionIndex: callerNarrowed,
        sectionBytes: {
          'docs/GDD.md#section-0': sectionBytes['docs/GDD.md']!,
        },
      }),
    ).toThrow(/complete|eight|document|index/i)
  })

  test('rejects a re-digested source envelope with a narrowed authority index', () => {
    const envelope = buildGameIrDomainSourceEnvelope({
      moduleId: 'balance',
      request: request(),
      sectionIndex,
      sectionBytes: exactBalanceBytes(),
    })
    const narrowed = {
      ...envelope,
      authoritySectionIndex: envelope.authoritySectionIndex.filter(
        section =>
          section.documentPath === 'docs/BALANCE_DESIGN.md' ||
          section.documentPath === 'docs/GDD.md',
      ),
      sectionIndex: envelope.authoritySectionIndex.filter(
        section =>
          section.documentPath === 'docs/BALANCE_DESIGN.md' ||
          section.documentPath === 'docs/GDD.md',
      ),
      sectionBytes: {
        'docs/BALANCE_DESIGN.md#section-2':
          sectionBytes['docs/BALANCE_DESIGN.md']!,
        'docs/GDD.md#section-0': sectionBytes['docs/GDD.md']!,
      },
    } as Record<string, unknown>
    narrowed.sourceDigest = digestGameIrValue(
      Object.fromEntries(
        Object.entries(narrowed).filter(([key]) => key !== 'sourceDigest'),
      ),
    )
    expect(() => validateGameIrDomainSourceEnvelope(narrowed)).toThrow(
      /authority|section|digest|index/i,
    )
  })
})
