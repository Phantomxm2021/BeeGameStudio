import { describe, expect, test } from 'bun:test'
import {
  mergeExactFoundationReviewIssues,
} from '../domain/foundation-final-issue-merge'
import type { AuditIssue } from '../domain/foundation-issue-registry'

const source = {
  documentPath: 'docs/GDD.md' as const,
  sectionId: 'states_flow',
  heading: 'Game States and Flow',
  startLine: 10,
  endLine: 20,
  digest: 'a'.repeat(64),
}

function issue(
  id: string,
  type: AuditIssue['type'],
  severity: AuditIssue['severity'],
  actual = 'Loss condition authority is absent.',
): AuditIssue {
  return {
    id,
    type,
    severity,
    source,
    expected: 'A loss-condition decision is explicit.',
    actual,
    remediation: {
      kind: 'patch',
      scope: 'section',
      documentPath: source.documentPath,
      sectionIds: [source.sectionId],
    },
  }
}

describe('foundation final issue merge', () => {
  test('merges the same canonical conflict across audit layers and keeps highest severity', () => {
    expect(mergeExactFoundationReviewIssues([
      issue('AUD-SEMANTIC', 'semantic', 'HIGH'),
      issue('AUD-SCHEMA', 'schema', 'BLOCKER'),
    ])).toEqual([issue('AUD-SCHEMA', 'schema', 'BLOCKER')])
  })

  test('merges one required owner fact despite audit-layer reason and wording differences', () => {
    const schema = {
      ...issue('AUD-SCHEMA', 'schema', 'HIGH'),
      reasonCode: 'schema',
      expected: 'required fact asset.formats must exist with type string[]',
      actual: 'missing fact asset.formats',
    }
    const deterministic = {
      ...issue('AUD-DETERMINISTIC', 'contract', 'BLOCKER'),
      expected: 'Required fact asset.formats must exist with type string[].',
      actual: 'Missing fact asset.formats.',
    }
    expect(mergeExactFoundationReviewIssues([
      schema,
      deterministic,
    ])).toEqual([deterministic])
  })

  test('does not merge distinct business conditions merely because they share a section', () => {
    expect(mergeExactFoundationReviewIssues([
      issue('AUD-ONE', 'semantic', 'HIGH'),
      issue('AUD-TWO', 'semantic', 'HIGH', 'Retry behavior contradicts the state flow.'),
    ])).toHaveLength(2)
  })
})
