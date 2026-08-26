import { describe, expect, test } from 'bun:test'
import {
  activeFoundationRevisionBundle,
  activeFoundationRevisionTasks,
  foundationAuditStateSchema,
  foundationRuntimeTasks,
  parseFoundationAuditState,
} from './foundation-audit-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import type { FoundationFactTask } from './foundation-fact-runtime'

describe('foundationAuditState schema', () => {
  const valid = {
    schemaVersion: 9 as const,
    schemaFingerprint: 'foundation-audit-state-v9' as const,
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

  test('rejects the prior audit-state schema without a compatibility reader', () => {
    expect(() => parseFoundationAuditState({
      ...valid,
      schemaVersion: 8,
      schemaFingerprint: 'foundation-audit-state-v8',
    })).toThrow(/schemaVersion|schemaFingerprint/)
  })

  test('rejects staged states that still contain pending or running tasks', () => {
    const task = {
      taskId: 'revision-1:fact:0',
      kind: 'document-facts' as const,
      revision: 'revision-1',
      packetDigest: 'c'.repeat(64),
      factKeyCount: 1,
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

  test('allows revision task collections beyond the fact catalog size', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => ({
      taskId: `revision-1:fact:${index}`,
      kind: 'document-facts' as const,
      revision: 'revision-1',
      packetDigest: 'c'.repeat(64),
      factKeyCount: 1,
      modelTier: 'fast' as const,
      status: 'pending' as const,
      attempt: 0,
    }))
    expect(parseFoundationAuditState({ ...valid, status: 'extracting_facts', phaseStartedAt: '2026-08-24T00:00:00.000Z', tasks })).toMatchObject({ tasks })
  })

  test('requires publication-bound current derived evidence for revision_ready', () => {
    const derivedRoot = '.beegame/audit/foundation/revision-1/derived'
    const digest = 'c'.repeat(64)
    const ready = {
      ...valid,
      status: 'revision_ready' as const,
      phaseStartedAt: '2026-08-24T00:00:00.000Z',
      documentDigests: Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest])) as Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>,
      sectionIndexDigest: digest,
      sectionIndexPath: `${derivedRoot}/section-index.json`,
      manifestPath: `${derivedRoot}/manifest.json`,
      derived: {
        manifestPath: `${derivedRoot}/manifest.json`, manifestDigest: digest,
        markerPath: `${derivedRoot}/COMMITTED.json`, markerDigest: digest,
        factStorePath: `${derivedRoot}/fact-store.json`, factStoreDigest: digest,
        sectionIndexPath: `${derivedRoot}/section-index.json`, sectionIndexDigest: digest,
      },
      authority: {
        issueAuthority: { kind: 'publication' as const, baseRevision: 'revision-1', authorityDigest: digest, issueRegistryDigest: digest },
        derivedDigests: { sectionIndex: digest, factStore: digest, manifest: digest },
        documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest })),
      },
      roundBefore: { documentRevision: 'revision-1', issueRegistryDigest: digest, issueAuthority: { kind: 'publication' as const, baseRevision: 'revision-1', authorityDigest: digest, issueRegistryDigest: digest } },
      round: 1 as const,
      activeBundleId: 'bundle-1',
      revisionBundles: [{ bundleId: 'bundle-1', status: 'active' as const, round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest })), remediationDigest: digest, taskIds: ['revision-1.impacted-facts.1.0'], frozenTaskIds: [] }],
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
      tasks: [{
        taskId: 'revision-1.impacted-facts.1.0', kind: 'impacted-facts' as const, revision: 'revision-1', round: 1 as const,
        bundleId: 'bundle-1',
        packetPath: '.beegame/audit/foundation/revision-1/round-1/tasks/revision-1.impacted-facts.1.0/packet.json', packetDigest: digest,
        modelTier: 'fast' as const, status: 'completed' as const, attempt: 1, terminalDigest: digest,
        receiptPath: '.beegame/audit/foundation/revision-1/round-1/tasks/revision-1.impacted-facts.1.0/receipt.json', receiptDigest: digest,
        usage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, durationMs: 0,
        dispatch: { dispatchId: 'dispatch-1', workerType: 'foundation-fact-extractor' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: 'revision-1.impacted-facts.1.0', revision: 'revision-1', status: 'completed' as const, terminalResult: { ok: true }, startedAt: '2026-08-24T00:00:00.000Z', finishedAt: '2026-08-24T00:00:00.000Z' },
      }],
      publication: { preparedPath: 'prepared', journalPath: 'journal', committedPath: 'committed', authorityDigest: digest, resultingRevision: 'revision-1', resultingIssueRegistryDigest: digest },
    }
    expect(parseFoundationAuditState(ready).status).toBe('revision_ready')
    expect(() => parseFoundationAuditState({ ...ready, authority: undefined })).toThrow(/publication authority|metadata/i)
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
      catalogVersion: 'foundation-facts.v2',
      contractGraphDigest: '5'.repeat(64),
      sectionIndexDigest: 'f'.repeat(64),
      factStoreDigest: 'e'.repeat(64),
    }
    for (const status of ['derived_committed', 'deterministic_ready'] as const) {
      expect(parseFoundationAuditState({ ...valid, status, phaseStartedAt: '2026-08-24T00:00:00.000Z', derived, ...(status === 'derived_committed' ? {} : { deterministic }) })).toMatchObject({ status, derived })
    }
  })

  test('selects exactly one active bundle and excludes superseded evidence from runtime tasks', () => {
    const state = {
      status: 'revising' as const,
      activeBundleId: 'bundle-new',
      revisionBundles: [
        { bundleId: 'bundle-old', status: 'superseded' as const, round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['old-task'], frozenTaskIds: [] },
        { bundleId: 'bundle-new', status: 'active' as const, round: 2, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'b'.repeat(64), taskIds: ['new-task'], frozenTaskIds: [] },
      ],
      tasks: [
        { taskId: 'old-task', kind: 'impacted-facts' as const, revision: 'revision-1', round: 1, bundleId: 'bundle-old', packetPath: 'old', packetDigest: 'c'.repeat(64), modelTier: 'fast' as const, status: 'needs_action' as const, attempt: 1 },
        { taskId: 'new-task', kind: 'impacted-facts' as const, revision: 'revision-1', round: 2, bundleId: 'bundle-new', packetPath: 'new', packetDigest: 'd'.repeat(64), modelTier: 'fast' as const, status: 'pending' as const, attempt: 0 },
      ],
    } as any

    expect(activeFoundationRevisionBundle(state).bundleId).toBe('bundle-new')
    expect(activeFoundationRevisionTasks(state).map(task => task.taskId)).toEqual(['new-task'])
    expect(foundationRuntimeTasks(state).map(task => task.taskId)).toEqual(['new-task'])
    expect(() => activeFoundationRevisionBundle({ activeBundleId: 'missing', revisionBundles: state.revisionBundles } as never)).toThrow(/ambiguous|missing|stale/i)
    expect(() => activeFoundationRevisionTasks({ ...state, tasks: [state.tasks[1], state.tasks[1]] })).toThrow(/duplicated/i)
  })

  test('rejects duplicate durable task and bundle identities', () => {
    expect(() => parseFoundationAuditState({
      ...valid,
      revisionBundles: [
        { bundleId: 'bundle-duplicate', status: 'superseded' as const, round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'a'.repeat(64), taskIds: ['task-1'], frozenTaskIds: [] },
        { bundleId: 'bundle-duplicate', status: 'superseded' as const, round: 1, baseDocumentRevision: 'revision-1', baseDocumentDigests: [], remediationDigest: 'b'.repeat(64), taskIds: ['task-2'], frozenTaskIds: [] },
      ],
    })).toThrow(/bundle IDs must be unique/i)
  })
})
