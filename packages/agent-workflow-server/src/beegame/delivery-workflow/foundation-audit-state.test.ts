import { describe, expect, test } from 'bun:test'
import {
  foundationAuditStateSchema,
  parseFoundationAuditState,
} from './foundation-audit-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import type { FoundationFactTask } from './foundation-fact-runtime'

describe('foundationAuditState schema', () => {
  const valid = {
    schemaVersion: 3 as const,
    schemaFingerprint: 'foundation-audit-state-v3' as const,
    status: 'index_staged' as const,
    revision: 'revision-1',
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'a'.repeat(64)]),
    ) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>,
    sectionIndexDigest: 'b'.repeat(64),
    sectionIndexPath:
      '.beegame/audit/foundation/revision-1/staging/section-index.json',
    manifestPath: '.beegame/audit/foundation/revision-1/staging/manifest.json',
    tasks: [] as FoundationFactTask[],
  } as const

  test('accepts only the index staged scaffold and binds its revision and digest', () => {
    expect(parseFoundationAuditState(valid)).toEqual(valid)
    expect(foundationAuditStateSchema.parse(valid).sectionIndexDigest).toBe(
      valid.sectionIndexDigest,
    )
  })

  test('rejects the old derived state and fact-store artifact fields', () => {
    expect(() => parseFoundationAuditState({ ...valid, status: 'derived' })).toThrow()
  })

  test('rejects legacy reviewer fields and unknown fields strictly', () => {
    expect(() =>
      parseFoundationAuditState({ ...valid, legacyReviewerState: {} }),
    ).toThrow()
    expect(() =>
      parseFoundationAuditState({ ...valid, unknown: true }),
    ).toThrow()
  })

  test('rejects staged states that still contain pending or running tasks', () => {
    const task = {
      taskId: 'revision-1:fact:0',
      kind: 'document-facts' as const,
      revision: 'revision-1',
      packetDigest: 'c'.repeat(64),
      modelTier: 'fast' as const,
      status: 'pending' as const,
      attempt: 0,
    }
    expect(() => parseFoundationAuditState({
      ...valid,
      status: 'facts_staged',
      phaseStartedAt: '2026-08-24T00:00:00.000Z',
      tasks: [task],
    })).toThrow(/pending|receipt|completed/i)
  })
})
