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
  fixDocument: 'docs/GDD.md',
  fixSectionId: 'vision',
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
      repairIssueIds: ['AUD-B', 'AUD-M'],
      knownIssueIds: ['AUD-L'],
    })
  })

  test('proceeds from a plan with only medium or low issues', () => {
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 1,
        issues: [issue('AUD-L', 'LOW')],
      }),
    ).toEqual({
      status: 'proceed',
      repairIssueIds: [],
      knownIssueIds: ['AUD-L'],
    })
  })

  test('stops a round-three plan with an unrepairable high issue', () => {
    expect(
      evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 3,
        issues: [issue('AUD-H', 'HIGH')],
      }),
    ).toEqual({
      status: 'needs_action',
      repairIssueIds: [],
      knownIssueIds: [],
      reason: 'round_limit',
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
      repairIssueIds: ['AUD-B2', 'AUD-H2'],
      knownIssueIds: ['AUD-M2'],
    })
  })

  test('round 2 repairs current and new blocker/high issues, but not medium', () => {
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
      repairIssueIds: ['AUD-B2'],
      knownIssueIds: ['AUD-M'],
    })
  })

  test('round 3 repairs only blockers and never starts round 4', () => {
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
      status: 'needs_action',
      repairIssueIds: [],
      knownIssueIds: [],
      reason: 'round_limit',
    })
    expect('nextRound' in result).toBe(false)
  })

  test('proceeds with medium and low issues as known issues when no blocker or high remains', () => {
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
      status: 'proceed',
      repairIssueIds: [],
      knownIssueIds: ['AUD-L', 'AUD-M'],
    })
  })

  test('stops on explicit no-progress with unchanged authoritative identities and document revision', () => {
    const issues = [issue('AUD-B', 'BLOCKER'), issue('AUD-H', 'HIGH')]
    const result = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: 2,
      before: snapshot(issues, digest('a'), 'doc-1'),
      after: snapshot(
        issues.map(item => ({ ...item })),
        digest('a'),
        'doc-1',
      ),
    })

    expect(result).toEqual({
      status: 'needs_action',
      repairIssueIds: [],
      knownIssueIds: [],
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
        round: 4 as never,
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
          'doc-1',
        ),
      }),
    ).toThrow(/identity|digest|authoritative/i)
  })
})
