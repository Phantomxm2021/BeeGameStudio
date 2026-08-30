import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_CANONICAL_MODULE_IDS,
  GAME_IR_SCHEMA_VERSION,
  gameIrCommittedPath,
  parseFoundationDefectReport,
  parseFoundationReadyReceipt,
  parseGameIrCompileRequest,
  parseGameIrReadyReceipt,
  type FoundationDefectReport,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
  type GameIrReadyReceipt,
} from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'

const digest = 'a'.repeat(64)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function withCanonicalReceiptDigest(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const withoutReceiptDigest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'receiptDigest'),
  )
  return { ...value, receiptDigest: sha256(withoutReceiptDigest) }
}

function withReceiptDigest(
  receipt: Omit<FoundationReadyReceipt, 'receiptDigest'>,
): FoundationReadyReceipt {
  return { ...receipt, receiptDigest: sha256(receipt) }
}

function foundationReceipt(
  overrides: Partial<Omit<FoundationReadyReceipt, 'receiptDigest'>> = {},
): FoundationReadyReceipt {
  return withReceiptDigest({
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digest,
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
    ...overrides,
  })
}

const validFoundation = foundationReceipt()

function compileRequest(
  overrides: Partial<GameIrCompileRequest> = {},
): GameIrCompileRequest {
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: validFoundation,
    ...overrides,
  }
}

function defectReport(
  overrides: Partial<FoundationDefectReport> = {},
): FoundationDefectReport {
  return {
    schemaVersion: 'foundation-defect-report.v1',
    taskId: 'compile-task-1',
    foundationRevision: validFoundation.foundationRevision,
    reasonCode: 'missing-owner-fact',
    expected: 'a canonical state transition',
    actual: 'no transition is declared',
    source: {
      documentPath: 'docs/GDD.md',
      sectionId: 'core-loop',
      digest,
    },
    target: {
      documentPath: 'docs/TECHNICAL_DESIGN.md',
      sectionId: 'runtime-states',
    },
    sourceBindingPointers: ['/core-loop/state-transition'],
    ...overrides,
  }
}

function readyReceipt(
  overrides: Partial<GameIrReadyReceipt> = {},
): GameIrReadyReceipt {
  const moduleDigests = Object.fromEntries(
    GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => [moduleId, digest]),
  ) as Record<(typeof GAME_IR_CANONICAL_MODULE_IDS)[number], string>
  return {
    schemaVersion: 'game-ir-ready-receipt.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundationRevision: validFoundation.foundationRevision,
    foundationReceiptDigest: validFoundation.receiptDigest,
    manifestDigest: digest,
    moduleDigests,
    sourceMapDigests: { ...moduleDigests },
    dependencyGraphDigest: digest,
    committedPath: gameIrCommittedPath(validFoundation.foundationRevision),
    ...overrides,
  }
}

describe('isolated Game IR contracts', () => {
  test('parses each exact DTO shape and freezes parsed containers', () => {
    const foundation = parseFoundationReadyReceipt(validFoundation)
    const compile = parseGameIrCompileRequest(compileRequest())
    const defect = parseFoundationDefectReport(defectReport())
    const ready = parseGameIrReadyReceipt(readyReceipt())

    expect(foundation).toEqual(validFoundation)
    expect(compile).toEqual(compileRequest())
    expect(defect).toEqual(defectReport())
    expect(ready).toEqual(readyReceipt())
    expect(Object.isFrozen(foundation)).toBe(true)
    expect(Object.isFrozen(foundation.documentDigests)).toBe(true)
    expect(Object.isFrozen(foundation.authority)).toBe(true)
    expect(Object.isFrozen(compile.foundation)).toBe(true)
    expect(Object.isFrozen(compile)).toBe(true)
    expect(Object.isFrozen(defect.source)).toBe(true)
    expect(Object.isFrozen(defect.target)).toBe(true)
    expect(Object.isFrozen(defect.sourceBindingPointers)).toBe(true)
    expect(Object.isFrozen(defect)).toBe(true)
    expect(Object.isFrozen(ready.moduleDigests)).toBe(true)
    expect(Object.isFrozen(ready.sourceMapDigests)).toBe(true)
    expect(Object.isFrozen(ready)).toBe(true)
  })

  test('uses an exclusive revision-publication authority variant', () => {
    const receipt = foundationReceipt({
      authority: {
        kind: 'revision_publication',
        baseRevision: 'foundation-revision-0',
        authorityDigest: digest,
        issueRegistryDigest: digest,
      },
    })
    expect(parseFoundationReadyReceipt(receipt).authority.kind).toBe(
      'revision_publication',
    )
    expect(() =>
      parseFoundationReadyReceipt({
        ...validFoundation,
        authority: {
          ...validFoundation.authority,
          reviewDigest: digest,
          issueRegistryDigest: digest,
          baseRevision: 'foundation-revision-0',
          authorityDigest: digest,
        },
      } as unknown),
    ).toThrow()
  })

  test('rejects unknown and missing fields in strict schemas', () => {
    expect(() =>
      parseFoundationReadyReceipt({ ...validFoundation, extra: true }),
    ).toThrow()
    expect(() =>
      parseFoundationReadyReceipt(
        withCanonicalReceiptDigest({
          ...validFoundation,
          documentDigests: Object.fromEntries(
            CANONICAL_FOUNDATION_DOCUMENTS.slice(1).map(path => [path, digest]),
          ),
        }),
      ),
    ).toThrow()
    expect(() =>
      parseFoundationReadyReceipt({
        ...validFoundation,
        documentDigests: {
          ...validFoundation.documentDigests,
          'docs/UNKNOWN.md': digest,
        },
      } as unknown),
    ).toThrow()
    expect(() =>
      parseGameIrCompileRequest({ ...compileRequest(), extra: true }),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport({
        ...defectReport(),
        source: { ...defectReport().source, extra: true },
      }),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport({ ...defectReport(), extra: true }),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport({
        ...defectReport(),
        target: { ...defectReport().target, extra: true },
      }),
    ).toThrow()
    expect(() =>
      parseGameIrReadyReceipt({ ...readyReceipt(), extra: true }),
    ).toThrow()
  })

  test('rejects malformed digests and stale receipt canonical bytes', () => {
    expect(() =>
      parseFoundationReadyReceipt({
        ...validFoundation,
        confirmedBriefDigest: 'not-a-sha256',
      }),
    ).toThrow()
    expect(() =>
      parseGameIrReadyReceipt({
        ...readyReceipt(),
        manifestDigest: 'f'.repeat(63),
      }),
    ).toThrow()
    expect(() =>
      parseFoundationReadyReceipt({
        ...validFoundation,
        receiptDigest: '0'.repeat(64),
      }),
    ).toThrow(/receipt.*digest|digest/i)
  })

  test('requires the complete V1 canonical module digest set', () => {
    const canonicalModules = Object.fromEntries(
      GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => [moduleId, digest]),
    )
    expect(Object.keys(readyReceipt().moduleDigests).sort()).toEqual(
      [...GAME_IR_CANONICAL_MODULE_IDS].sort(),
    )
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({
          moduleDigests: {} as GameIrReadyReceipt['moduleDigests'],
        }),
      ),
    ).toThrow(/module|canonical|missing/i)
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({
          moduleDigests: {
            ...canonicalModules,
            unknown: digest,
          } as unknown as GameIrReadyReceipt['moduleDigests'],
        }),
      ),
    ).toThrow(/module|canonical|unknown/i)
    expect(() =>
      parseGameIrReadyReceipt({
        ...readyReceipt(),
        sourceMapDigests: { gameplay: digest },
      }),
    ).toThrow(/source.?map|module|canonical|missing/i)
  })

  test('requires module and source-map digest key sets to match exactly', () => {
    const sourceMapDigests = Object.fromEntries(
      Object.entries(readyReceipt().sourceMapDigests).filter(
        ([moduleId]) => moduleId !== 'gameplay',
      ),
    ) as GameIrReadyReceipt['sourceMapDigests']
    expect(() =>
      parseGameIrReadyReceipt(readyReceipt({ sourceMapDigests })),
    ).toThrow(/source.?map|module|match|canonical/i)
  })

  test('derives one canonical committed path from schema version and foundation revision', () => {
    expect(parseGameIrReadyReceipt(readyReceipt()).committedPath).toBe(
      '.beegame/ir/game-ir.v1/revisions/foundation-revision-1/COMMITTED.json',
    )
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({
          committedPath:
            '.beegame/ir/game-ir.v1/revisions/publication-1/COMMITTED.json',
        }),
      ),
    ).toThrow(/committed|canonical|path/i)
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({
          committedPath: '.beegame/game-ir/publication-1/COMMITTED.json',
        }),
      ),
    ).toThrow(/committed|canonical|path/i)
    expect(() =>
      parseGameIrReadyReceipt({
        ...readyReceipt(),
        foundationRevision: 'revision/escape',
      }),
    ).toThrow(/revision|canonical|path/i)
  })

  test('rejects unsafe task and publication IDs and traversal artifact paths', () => {
    expect(() =>
      parseGameIrCompileRequest(compileRequest({ taskId: '../escape' })),
    ).toThrow()
    expect(() =>
      parseGameIrCompileRequest(
        compileRequest({ publicationId: 'pub/../escape' }),
      ),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(defectReport({ taskId: 'task id' })),
    ).toThrow()
    expect(() =>
      parseFoundationReadyReceipt(
        foundationReceipt({ sectionIndexPath: '../section-index.json' }),
      ),
    ).toThrow()
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({ committedPath: '/tmp/COMMITTED.json' }),
      ),
    ).toThrow()
    expect(() =>
      parseGameIrReadyReceipt(
        readyReceipt({ committedPath: 'a/../COMMITTED.json' }),
      ),
    ).toThrow()
  })

  test('rejects empty reason, expected, actual, and source bindings', () => {
    expect(() =>
      parseFoundationDefectReport(defectReport({ reasonCode: '' })),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(defectReport({ expected: ' ' })),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(defectReport({ actual: '' })),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(defectReport({ sourceBindingPointers: [] })),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(
        defectReport({ sourceBindingPointers: [''] }),
      ),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(
        defectReport({ sourceBindingPointers: ['/b', '/b'] }),
      ),
    ).toThrow()
    expect(() =>
      parseFoundationDefectReport(
        defectReport({ sourceBindingPointers: ['/b', '/a'] }),
      ),
    ).toThrow()
  })

  test('rejects a compile request whose foundation receipt is not valid', () => {
    const mismatchedRevision = foundationReceipt({
      foundationRevision: 'other-revision',
    })
    expect(() =>
      parseGameIrCompileRequest(
        compileRequest({
          foundation: { ...mismatchedRevision, receiptDigest: '0'.repeat(64) },
        }),
      ),
    ).toThrow(/digest|revision/i)
    expect(() =>
      parseGameIrCompileRequest({
        ...compileRequest(),
        foundation: {
          ...validFoundation,
          foundationRevision: 'other-revision',
        },
      }),
    ).toThrow(/digest|revision/i)
  })
})
