import { describe, expect, test } from 'bun:test'
import { parseFoundationAuditState } from './foundation-audit-state'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, FOUNDATION_SEMANTIC_CHECKS } from './foundation-semantic-audit'

describe('foundation semantic audit integration', () => {
  function semanticState(tasks = FOUNDATION_SEMANTIC_CHECKS.map((check, index) => ({
    taskId: `rev:semantic:${index}`,
    kind: 'semantic' as const,
    revision: 'rev',
    checkId: check.checkId,
    packetDigest: 'a'.repeat(64),
    modelTier: check.modelTier,
    status: 'pending' as const,
    attempt: 0,
  }))) {
    const digest = 'a'.repeat(64)
    return {
      schemaVersion: 6 as const,
      schemaFingerprint: 'foundation-audit-state-v6' as const,
      status: 'semantic_review' as const,
      revision: 'rev',
      documentDigests: Object.fromEntries([
        'docs/GDD.md', 'docs/TECHNICAL_DESIGN.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
        'docs/UI_UX_SPEC.md', 'docs/ART_DIRECTION.md', 'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md',
      ].map(path => [path, digest])),
      sectionIndexDigest: digest,
      sectionIndexPath: '.beegame/audit/foundation/rev/staging/section-index.json',
      manifestPath: '.beegame/audit/foundation/rev/staging/manifest.json',
      phaseStartedAt: '2026-01-01T00:00:00.000Z',
      tasks,
      derived: {
        manifestPath: '.beegame/audit/foundation/rev/derived/manifest.json', manifestDigest: digest,
        markerPath: '.beegame/audit/foundation/rev/derived/COMMITTED.json', markerDigest: digest,
        factStorePath: '.beegame/audit/foundation/rev/derived/fact-store.json', factStoreDigest: digest,
        sectionIndexPath: '.beegame/audit/foundation/rev/derived/section-index.json', sectionIndexDigest: digest,
      },
      deterministic: {
        reviewDigest: digest, issueRegistryPath: '.beegame/audit/foundation/rev/staging/review/x/issue-registry.json', issueRegistryDigest: digest,
        manifestPath: '.beegame/audit/foundation/rev/staging/review/x/manifest.json', manifestDigest: digest,
        markerPath: '.beegame/audit/foundation/rev/staging/review/x/COMMITTED.json', markerDigest: digest,
        catalogVersion: 'foundation-facts.v1', contractGraphDigest: digest, sectionIndexDigest: digest, factStoreDigest: digest,
      },
      semantic: { aggregateUsage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
    }
  }

  test('persists semantic tasks in the sole foundation audit state', () => {
    const digest = 'a'.repeat(64)
    const state = parseFoundationAuditState({
      schemaVersion: 6,
      schemaFingerprint: 'foundation-audit-state-v6',
      status: 'semantic_review',
      revision: 'rev',
      documentDigests: Object.fromEntries([
        'docs/GDD.md', 'docs/TECHNICAL_DESIGN.md', 'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md', 'docs/UI_UX_SPEC.md', 'docs/ART_DIRECTION.md',
        'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md',
      ].map(path => [path, digest])),
      sectionIndexDigest: digest,
      sectionIndexPath: '.beegame/audit/foundation/rev/staging/section-index.json',
      manifestPath: '.beegame/audit/foundation/rev/staging/manifest.json',
      phaseStartedAt: '2026-01-01T00:00:00.000Z',
      tasks: Array.from({ length: 10 }, (_, index) => ({
        taskId: `rev:semantic:${index}`, kind: 'semantic', revision: 'rev', checkId: FOUNDATION_SEMANTIC_CHECKS[index]!.checkId,
        packetDigest: digest, modelTier: FOUNDATION_SEMANTIC_CHECKS[index]!.modelTier, status: 'pending', attempt: 0,
      })),
      derived: {
        manifestPath: '.beegame/audit/foundation/rev/derived/manifest.json', manifestDigest: digest,
        markerPath: '.beegame/audit/foundation/rev/derived/COMMITTED.json', markerDigest: digest,
        factStorePath: '.beegame/audit/foundation/rev/derived/fact-store.json', factStoreDigest: digest,
        sectionIndexPath: '.beegame/audit/foundation/rev/derived/section-index.json', sectionIndexDigest: digest,
      },
      deterministic: {
        reviewDigest: digest, issueRegistryPath: '.beegame/audit/foundation/rev/staging/review/x/issue-registry.json', issueRegistryDigest: digest,
        manifestPath: '.beegame/audit/foundation/rev/staging/review/x/manifest.json', manifestDigest: digest,
        markerPath: '.beegame/audit/foundation/rev/staging/review/x/COMMITTED.json', markerDigest: digest,
        catalogVersion: 'foundation-facts.v1', contractGraphDigest: digest, sectionIndexDigest: digest, factStoreDigest: digest,
      },
      semantic: {
        aggregateUsage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    })
    expect(state.tasks[0]?.kind).toBe('semantic')
    expect(state.tasks).toHaveLength(10)
  })

  test('rejects non-exact semantic cardinality and service-unknown check IDs', () => {
    const valid = semanticState()
    for (const count of [1, 9, 11]) {
      const tasks = count === 11 ? [...valid.tasks, { ...valid.tasks[0]!, taskId: 'rev:semantic:10' }] : valid.tasks.slice(0, count)
      expect(() => parseFoundationAuditState({ ...valid, tasks })).toThrow(/exactly ten|checks|semantic/i)
    }
    const wrong = valid.tasks.map((task, index) => index === 0 ? { ...task, checkId: 'SEM.not_service_owned' } : task)
    expect(() => parseFoundationAuditState({ ...valid, tasks: wrong })).toThrow(/checks|manifest|semantic/i)
  })

  test('rejects admitted result unions that do not match their outcome', () => {
    const valid = semanticState()
    for (const admittedResult of [
      { checkId: valid.tasks[0]!.checkId, packetIdentity: valid.tasks[0]!.packetDigest, outcome: 'PASS' as const, issues: [{ problem: 'p', expected: 'e', actual: 'a', sourceSectionKey: 'GDD#vision', fixSectionKey: 'GDD#vision' }] },
      { checkId: valid.tasks[0]!.checkId, packetIdentity: valid.tasks[0]!.packetDigest, outcome: 'ISSUES' as const },
      { checkId: valid.tasks[0]!.checkId, packetIdentity: valid.tasks[0]!.packetDigest, outcome: 'UNDECIDABLE' as const },
    ]) {
      const invalid = valid.tasks.map((task, index) => index === 0 ? { ...task, admittedResult } : task)
      expect(() => parseFoundationAuditState({ ...valid, tasks: invalid })).toThrow(/PASS|ISSUES|UNDECIDABLE|reason|issues|admitted/i)
    }
  })

  test('rejects review bindings before audit_ready, missing audit_ready metrics, and invalid confirmation source outcomes', () => {
    const valid = semanticState()
    const review = {
      reviewDigest: 'b'.repeat(64), issueRegistryPath: '.beegame/audit/foundation/rev/review/' + 'b'.repeat(64) + '/issue-registry.json', issueRegistryDigest: 'b'.repeat(64),
      manifestPath: '.beegame/audit/foundation/rev/review/' + 'b'.repeat(64) + '/manifest.json', manifestDigest: 'b'.repeat(64), markerPath: '.beegame/audit/foundation/rev/review/' + 'b'.repeat(64) + '/COMMITTED.json', markerDigest: 'b'.repeat(64),
      sectionIndexDigest: 'a'.repeat(64), factStoreDigest: 'a'.repeat(64), semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
      knownIssueIds: [],
    }
    expect(() => parseFoundationAuditState({ ...valid, review })).toThrow(/atomic|audit_ready|review/i)
    expect(() => parseFoundationAuditState({ ...valid, status: 'audit_ready', semantic: undefined, review })).toThrow(/semantic|metrics|review/i)
    const source = { ...valid.tasks[0]!, admittedResult: { checkId: valid.tasks[0]!.checkId, packetIdentity: valid.tasks[0]!.packetDigest, outcome: 'PASS' as const } }
    const confirmation = { taskId: 'rev:semantic:0:confirmation', kind: 'confirmation' as const, revision: 'rev', checkId: source.checkId, sourceTaskId: source.taskId, packetDigest: source.packetDigest, modelTier: 'strong' as const, status: 'pending' as const, attempt: 0 }
    expect(() => parseFoundationAuditState({ ...valid, tasks: [source, ...valid.tasks.slice(1), confirmation] })).toThrow(/confirmation|source|UNDECIDABLE|BLOCKER/i)
  })
})
