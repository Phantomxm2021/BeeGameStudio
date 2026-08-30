import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
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
  buildGameIrDomainSourceEnvelope,
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

function request(): GameIrCompileRequest {
  const withoutDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'b'.repeat(64)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
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

describe('Game IR domain source closure', () => {
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
