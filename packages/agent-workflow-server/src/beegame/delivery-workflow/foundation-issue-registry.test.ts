import { describe, expect, test } from 'bun:test'
import {
  createFoundationIssueRegistry,
  issueIdentity,
  makeAuditIssue,
  type AuditIssue,
} from './foundation-issue-registry'
import type { SectionRef } from './foundation-section-index'

const source: SectionRef = {
  documentPath: 'docs/GDD.md',
  sectionId: 'core_loop',
  heading: 'Core Loop',
  startLine: 1,
  endLine: 4,
  digest: 'c'.repeat(64),
}

const issue = (actual: string): AuditIssue =>
  makeAuditIssue({
    checkId: 'schema.fact-types',
    severity: 'HIGH',
    type: 'schema',
    source,
    expected: 'string',
    actual,
    fixDocument: source.documentPath,
    fixSectionId: source.sectionId,
  })

describe('foundation issue registry', () => {
  test('keeps issue IDs stable when issue input order changes', () => {
    const first = createFoundationIssueRegistry([
      issue('number'),
      issue('empty'),
    ])
    const second = createFoundationIssueRegistry([
      issue('empty'),
      issue('number'),
    ])
    expect(first).toEqual(second)
    expect(first.map(item => item.id)).toEqual(
      [...first]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(item => item.id),
    )
  })

  test('rejects duplicate IDs and conflicting duplicate identities', () => {
    const first = issue('number')
    expect(() => createFoundationIssueRegistry([first, first])).toThrow(
      'duplicate audit issue id',
    )

    const conflictingIdentity = { ...issue('other'), id: first.id }
    expect(() =>
      createFoundationIssueRegistry([first, conflictingIdentity]),
    ).toThrow('duplicate audit issue id')

    expect(issueIdentity(first)).toBe(
      issueIdentity({ ...first, id: 'different' }),
    )

    const sameIdentityDifferentId = { ...first, id: 'AUD-MANUAL-DIFFERENT' }
    expect(() =>
      createFoundationIssueRegistry([first, sameIdentityDifferentId]),
    ).toThrow('conflicting duplicate audit issue identity')
  })
})
