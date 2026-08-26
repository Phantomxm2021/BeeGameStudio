import { describe, expect, test } from 'bun:test'
import type { AuditIssue } from './foundation-issue-registry'
import {
  evaluateFoundationRevisionRoundPolicy,
  type FoundationRevisionRoundPolicySnapshot,
} from './foundation-revision-round-policy'

const digest = (letter: string): string => letter.repeat(64)

const issue = (
  id: string,
  severity: AuditIssue['severity'],
  actual = `actual-${id}`,
): AuditIssue => ({
  id,
  severity,
  type: 'rule',
  source: {
    documentPath: 'docs/GDD.md',
    sectionId: 'vision',
    heading: 'Vision',
    startLine: 1,
    endLine: 2,
    digest: digest('a'),
  },
  expected: `expected-${id}`,
  actual,
  remediation: { kind: 'patch', documentPath: 'docs/GDD.md', sectionIds: ['vision'] },
})

const snapshot = (
  issues: readonly AuditIssue[],
  issueRegistryDigest: string,
  documentRevision: string,
): FoundationRevisionRoundPolicySnapshot => ({
  issues,
  issueRegistryDigest,
  documentRevision,
})

describe('foundation revision round policy', () => {
  test('proceeds from an empty registry during initial planning', () => {
    expect(evaluateFoundationRevisionRoundPolicy({ phase: 'plan', round: 1, issues: [] })).toEqual({
      status: 'proceed',
      repairIssueIds: [],
    })
  })

  test('plans the initial round without caller-side severity filtering', () => {
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'plan',
      round: 1,
      issues: [
        issue('AUD-L', 'LOW'),
        issue('AUD-M', 'MEDIUM'),
        issue('AUD-B', 'BLOCKER'),
      ],
    })

    expect(result).toEqual({
      status: 'repair',
      round: 1,
      repairIssueIds: ['AUD-B', 'AUD-L', 'AUD-M'],
    })
  })

  test('repairs medium and low issues instead of exempting them', () => {
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 1,
        issues: [issue('AUD-L', 'LOW')],
      }),
    ).toEqual({ status: 'repair', round: 1, repairIssueIds: ['AUD-L'] })
  })

  test('plans high issues in any positive round', () => {
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 3,
        issues: [issue('AUD-H', 'HIGH')],
      }),
    ).toEqual({
      status: 'repair',
      round: 3,
      repairIssueIds: ['AUD-H'],
    })
  })

  test('round 1 repairs blocker, high and medium in deterministic order', () => {
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 1,
      before: snapshot(
        [
          issue('AUD-M', 'MEDIUM'),
          issue('AUD-B', 'BLOCKER'),
          issue('AUD-H', 'HIGH'),
        ],
        digest('a'),
        'doc-1',
      ),
      after: snapshot(
        [
          issue('AUD-M2', 'MEDIUM'),
          issue('AUD-H2', 'HIGH'),
          issue('AUD-B2', 'BLOCKER'),
        ],
        digest('b'),
        'doc-2',
      ),
    })

    expect(result).toEqual({
      status: 'continue',
      nextRound: 2,
      repairIssueIds: ['AUD-B2', 'AUD-H2', 'AUD-M2'],
    })
  })

  test('round 2 repairs every unresolved severity', () => {
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 2,
      before: snapshot([issue('AUD-H', 'HIGH')], digest('a'), 'doc-1'),
      after: snapshot(
        [
          issue('AUD-B2', 'BLOCKER'),
          issue('AUD-H2', 'HIGH'),
          issue('AUD-M', 'MEDIUM'),
        ],
        digest('b'),
        'doc-2',
      ),
    })

    expect(result).toEqual({
      status: 'continue',
      nextRound: 3,
      repairIssueIds: ['AUD-B2', 'AUD-H2', 'AUD-M'],
    })
  })

  test('round plans repair every issue at round 2 and beyond', () => {
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 2,
        issues: [
          issue('AUD-L', 'LOW'),
          issue('AUD-M', 'MEDIUM'),
          issue('AUD-H', 'HIGH'),
          issue('AUD-B', 'BLOCKER'),
        ],
      }),
    ).toEqual({
      status: 'repair',
      round: 2,
      repairIssueIds: ['AUD-B', 'AUD-H', 'AUD-L', 'AUD-M'],
    })
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 3,
        issues: [issue('AUD-B', 'BLOCKER'), issue('AUD-H', 'HIGH'), issue('AUD-M', 'MEDIUM')],
      }),
    ).toEqual({
      status: 'repair',
      round: 3,
      repairIssueIds: ['AUD-B', 'AUD-H', 'AUD-M'],
    })
  })

  test('round 3 continues to round 4 when the registry remains non-empty', () => {
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 3,
      before: snapshot([issue('AUD-B', 'BLOCKER')], digest('a'), 'doc-1'),
      after: snapshot(
        [issue('AUD-H', 'HIGH'), issue('AUD-B2', 'BLOCKER')],
        digest('b'),
        'doc-2',
      ),
    })

    expect(result).toEqual({
      status: 'continue',
      nextRound: 4,
      repairIssueIds: ['AUD-B2', 'AUD-H'],
    })
    expect('nextRound' in result).toBe(true)
  })

  test('does not proceed while medium and low issues remain in the registry', () => {
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 3,
      before: snapshot([issue('AUD-B', 'BLOCKER')], digest('a'), 'doc-1'),
      after: snapshot(
        [issue('AUD-L', 'LOW'), issue('AUD-M', 'MEDIUM')],
        digest('b'),
        'doc-2',
      ),
    })

    expect(result).toEqual({
      status: 'continue',
      nextRound: 4,
      repairIssueIds: ['AUD-L', 'AUD-M'],
    })
  })

  test('only an empty registry can proceed', () => {
    const before = snapshot([issue('AUD-B', 'BLOCKER')], digest('a'), 'doc-1')
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'evaluate',
        round: 3,
        before,
        after: snapshot([issue('AUD-M', 'MEDIUM'), issue('AUD-L', 'LOW')], digest('b'), 'doc-2'),
      }),
    ).toMatchObject({ status: 'continue', nextRound: 4, repairIssueIds: ['AUD-L', 'AUD-M'] })
    for (const severity of ['HIGH', 'BLOCKER'] as const) {
      expect(
        evaluateFoundationRevisionRoundPolicy({
          phase: 'evaluate',
          round: 3,
          before,
          after: snapshot([issue(`AUD-${severity}`, severity)], digest('b'), 'doc-2'),
        }),
      ).toMatchObject({ status: 'continue', nextRound: 4 })
    }
  })

  test('stops when issue authority is unchanged even if document bytes drifted', () => {
    const issues = [issue('AUD-B', 'BLOCKER'), issue('AUD-H', 'HIGH')]
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 2,
      before: snapshot(issues, digest('a'), 'doc-1'),
      after: snapshot(
        issues.map(item => ({ ...item })),
        digest('a'),
        'doc-2',
      ),
    })

    expect(result).toEqual({
      status: 'needs_action',
      repairIssueIds: [],
      reason: 'no_progress',
    })
  })

  test('validates duplicate IDs and exact issue identity before applying policy', () => {
    const duplicate = issue('AUD-DUP', 'HIGH')
    expect(() =>
      evaluateFoundationRevisionRoundPolicy({
        phase: 'evaluate',
        round: 1,
        before: snapshot([duplicate, { ...duplicate }], digest('a'), 'doc-1'),
        after: snapshot([], digest('b'), 'doc-2'),
      }),
    ).toThrow(/duplicate.*issue/i)

    expect(() =>
      evaluateFoundationRevisionRoundPolicy({
        phase: 'evaluate',
        round: 0 as never,
        before: snapshot([issue('AUD-B', 'BLOCKER')], digest('a'), 'doc-1'),
        after: snapshot([], digest('b'), 'doc-2'),
      }),
    ).toThrow(/round/i)

    expect(() =>
      evaluateFoundationRevisionRoundPolicy({
        phase: 'evaluate',
        round: 1,
        before: snapshot([issue('AUD-B', 'BLOCKER')], digest('a'), 'doc-1'),
        after: snapshot(
          [issue('AUD-B', 'HIGH', 'changed')],
          digest('a'),
          'doc-2',
        ),
      }),
    ).toThrow(/identity|digest|authoritative/i)
  })
})
