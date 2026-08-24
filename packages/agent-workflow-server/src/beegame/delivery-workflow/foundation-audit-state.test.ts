import { describe, expect, test } from 'bun:test'
import {
  foundationAuditStateSchema,
  parseFoundationAuditState,
} from './foundation-audit-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

describe('foundationAuditState schema', () => {
  const valid = {
    status: 'derived' as const,
    revision: 'revision-1',
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'a'.repeat(64)]),
    ) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>,
    manifest: {
      revision: 'revision-1',
      sectionIndexDigest: 'b'.repeat(64),
      factStoreDigest: 'c'.repeat(64),
    },
    sectionIndexPath:
      '.beegame/audit/foundation/revision-1/derived/section-index.json',
    factStorePath:
      '.beegame/audit/foundation/revision-1/derived/fact-store.json',
    manifestPath: '.beegame/audit/foundation/revision-1/derived/manifest.json',
  }

  test('accepts only the single derived state and binds its revision and digests', () => {
    expect(parseFoundationAuditState(valid)).toEqual(valid)
    expect(foundationAuditStateSchema.parse(valid).manifest.revision).toBe(
      valid.revision,
    )
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
