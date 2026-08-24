import { describe, expect, test } from 'bun:test'
import {
  foundationAuditStateSchema,
  parseFoundationAuditState,
} from './foundation-audit-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import type { FoundationFactTask } from './foundation-fact-runtime'

describe('foundationAuditState schema', () => {
  const valid = {
    schemaVersion: 4 as const,
    schemaFingerprint: 'foundation-audit-state-v4' as const,
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

  test('preserves the exact derived binding through forward audit states', () => {
    const derived = {
      manifestPath: '.beegame/audit/foundation/revision-1/derived/manifest.json',
      manifestDigest: 'c'.repeat(64),
      markerPath: '.beegame/audit/foundation/revision-1/derived/COMMITTED.json',
      markerDigest: 'd'.repeat(64),
      factStorePath: '.beegame/audit/foundation/revision-1/derived/fact-store.json',
      factStoreDigest: 'e'.repeat(64),
      sectionIndexPath: '.beegame/audit/foundation/revision-1/derived/section-index.json',
      sectionIndexDigest: 'f'.repeat(64),
    }
    const deterministic = {
      reviewDigest: '1'.repeat(64),
      issueRegistryPath: '.beegame/audit/foundation/revision-1/staging/review/1/issue-registry.json',
      issueRegistryDigest: '2'.repeat(64),
      manifestPath: '.beegame/audit/foundation/revision-1/staging/review/1/manifest.json',
      manifestDigest: '3'.repeat(64),
      markerPath: '.beegame/audit/foundation/revision-1/staging/review/1/COMMITTED.json',
      markerDigest: '4'.repeat(64),
      catalogVersion: 'foundation-facts.v1',
      contractGraphDigest: '5'.repeat(64),
      sectionIndexDigest: 'f'.repeat(64),
      factStoreDigest: 'e'.repeat(64),
    }
    for (const status of ['derived_committed', 'deterministic_ready'] as const) {
      expect(parseFoundationAuditState({ ...valid, status, phaseStartedAt: '2026-08-24T00:00:00.000Z', derived, ...(status === 'derived_committed' ? {} : { deterministic }) })).toMatchObject({ status, derived })
    }
  })
})
