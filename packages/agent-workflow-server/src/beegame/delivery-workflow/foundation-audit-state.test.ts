import { describe, expect, test } from 'bun:test'
import {
  foundationAuditStateSchema,
  parseFoundationAuditState,
} from './foundation-audit-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

describe('foundationAuditState schema', () => {
  const valid = {
    status: 'index_staged' as const,
    revision: 'revision-1',
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'a'.repeat(64)]),
    ) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>,
    sectionIndexDigest: 'b'.repeat(64),
    sectionIndexPath:
      '.beegame/audit/foundation/revision-1/staging/section-index.json',
    manifestPath: '.beegame/audit/foundation/revision-1/staging/manifest.json',
    needsAction: 'foundation fact extraction is not part of Task 4A',
  } as const

  test('accepts only the index staged scaffold and binds its revision and digest', () => {
    expect(parseFoundationAuditState(valid)).toEqual(valid)
    expect(foundationAuditStateSchema.parse(valid).sectionIndexDigest).toBe(
      valid.sectionIndexDigest,
    )
  })

  test('rejects the old derived state and fact-store artifact fields', () => {
    expect(() => parseFoundationAuditState({ ...valid, status: 'derived' })).toThrow()
    expect(() => parseFoundationAuditState({ ...valid, factStorePath: 'bad' })).toThrow()
  })

  test('rejects legacy reviewer fields and unknown fields strictly', () => {
    expect(() =>
      parseFoundationAuditState({ ...valid, legacyReviewerState: {} }),
    ).toThrow()
    expect(() =>
      parseFoundationAuditState({ ...valid, unknown: true }),
    ).toThrow()
  })
})
