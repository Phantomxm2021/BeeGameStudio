import { describe, expect, test } from 'bun:test'
import type { SectionRef } from './foundation-section-index'
import type { AuditIssue, IssueRegistryContext } from './foundation-issue-registry'
import { buildFoundationRevisionBatches } from './foundation-revision-batches'

const section = (
  documentPath: string,
  sectionId: string,
  startLine = 1,
): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine,
  endLine: startLine + 1,
  digest: `${documentPath}#${sectionId}`.padEnd(64, '0').slice(0, 64),
})

const issue = (
  id: string,
  fixDocument: string,
  fixSectionId: string,
): AuditIssue => {
  const source = section(fixDocument, fixSectionId)
  return {
    id,
    severity: 'HIGH',
    type: 'rule',
    source,
    expected: 'expected',
    actual: 'actual',
    fixDocument: fixDocument as AuditIssue['fixDocument'],
    fixSectionId,
  }
}

const registryFor = (refs: readonly SectionRef[]): IssueRegistryContext => {
  const byKey = new Map(refs.map(ref => [`${ref.documentPath}#${ref.sectionId}`, ref]))
  return {
    validated: true,
    section(documentPath, sectionId) {
      return byKey.get(`${documentPath}#${sectionId}`)
    },
  }
}

const gddVision = section('docs/GDD.md', 'vision', 10)
const gddRules = section('docs/GDD.md', 'rules_systems', 20)
const assetInventory = section('docs/ASSET_PLAN.md', 'inventory', 10)
const technicalPerformance = section('docs/TECHNICAL_DESIGN.md', 'performance', 10)
const registry = registryFor([
  gddVision,
  gddRules,
  assetInventory,
  technicalPerformance,
])

describe('foundation revision batch planning', () => {
  test('merges all issues for one document into one batch', () => {
    const batches = buildFoundationRevisionBatches({
      issues: [
        issue('AUD-B', 'docs/GDD.md', 'rules_systems'),
        issue('AUD-A', 'docs/GDD.md', 'vision'),
      ],
      registry,
    })

    expect(batches).toEqual([
      {
        documentPath: 'docs/GDD.md',
        sectionIds: ['vision', 'rules_systems'],
        issueIds: ['AUD-A', 'AUD-B'],
      },
    ])
  })

  test('creates independent batches across documents in canonical order', () => {
    const batches = buildFoundationRevisionBatches({
      issues: [
        issue('AUD-T', 'docs/TECHNICAL_DESIGN.md', 'performance'),
        issue('AUD-A', 'docs/ASSET_PLAN.md', 'inventory'),
        issue('AUD-G', 'docs/GDD.md', 'vision'),
      ],
      registry,
    })

    expect(batches.map(batch => batch.documentPath)).toEqual([
      'docs/GDD.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ])
    expect(batches.every(batch => batch.issueIds.length > 0)).toBe(true)
  })

  test('exposes only fix target documents and sections', () => {
    const batches = buildFoundationRevisionBatches({
      issues: [
        {
          ...issue('AUD-1', 'docs/GDD.md', 'vision'),
          source: assetInventory,
          target: technicalPerformance,
        },
      ],
      registry,
    })

    expect(batches).toEqual([
      { documentPath: 'docs/GDD.md', sectionIds: ['vision'], issueIds: ['AUD-1'] },
    ])
  })

  test('covers every input issue exactly once', () => {
    const issues = [
      issue('AUD-3', 'docs/GDD.md', 'vision'),
      issue('AUD-1', 'docs/GDD.md', 'rules_systems'),
      issue('AUD-2', 'docs/ASSET_PLAN.md', 'inventory'),
    ]
    const outputIds = buildFoundationRevisionBatches({ issues, registry })
      .flatMap(batch => batch.issueIds)

    expect(outputIds).toHaveLength(issues.length)
    expect(new Set(outputIds)).toEqual(new Set(issues.map(item => item.id)))
  })

  test('fails closed on duplicate issue IDs', () => {
    const duplicate = issue('AUD-DUP', 'docs/GDD.md', 'vision')
    expect(() =>
      buildFoundationRevisionBatches({ issues: [duplicate, { ...duplicate }], registry }),
    ).toThrow(/duplicate.*issue/i)
  })

  test('fails closed on an unknown document or section', () => {
    expect(() =>
      buildFoundationRevisionBatches({
        issues: [issue('AUD-DOC', 'docs/UNKNOWN.md', 'vision')],
        registry,
      }),
    ).toThrow(/unknown|validated|section|canonical/i)
    expect(() =>
      buildFoundationRevisionBatches({
        issues: [issue('AUD-SECTION', 'docs/GDD.md', 'unknown')],
        registry,
      }),
    ).toThrow(/unknown|validated|section/i)
  })

  test('fails closed when the registry authority disagrees with the issue fix target', () => {
    const inconsistentRegistry: IssueRegistryContext = {
      validated: true,
      section(documentPath, sectionId) {
        if (documentPath === 'docs/GDD.md' && sectionId === 'vision')
          return { ...gddVision, sectionId: 'rules_systems' }
        return undefined
      },
    }
    expect(() =>
      buildFoundationRevisionBatches({
        issues: [issue('AUD-MISMATCH', 'docs/GDD.md', 'vision')],
        registry: inconsistentRegistry,
      }),
    ).toThrow(/authority|section|mismatch/i)
  })

  test('is invariant under input issue reordering', () => {
    const issues = [
      issue('AUD-C', 'docs/ASSET_PLAN.md', 'inventory'),
      issue('AUD-A', 'docs/GDD.md', 'rules_systems'),
      issue('AUD-B', 'docs/GDD.md', 'vision'),
      issue('AUD-D', 'docs/TECHNICAL_DESIGN.md', 'performance'),
    ]
    const first = buildFoundationRevisionBatches({ issues, registry })
    const second = buildFoundationRevisionBatches({
      issues: [issues[2]!, issues[0]!, issues[3]!, issues[1]!],
      registry,
    })

    expect(second).toEqual(first)
  })
})
