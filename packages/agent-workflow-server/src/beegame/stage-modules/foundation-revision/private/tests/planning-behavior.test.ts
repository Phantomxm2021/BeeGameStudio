import { expect, test } from 'bun:test'
import type { AuditIssue, FoundationDocumentAuditIssue } from '../../../foundation-reviewer/private/domain/foundation-issue-registry'
import type { FoundationDocumentPath } from '../domain/types'
import { canonicalFoundationBlockIds } from '../domain/foundation-section-index'
import {
  buildFoundationRevisionBatches,
  type RevisionPlanningIssue,
  type RevisionSectionAuthority,
} from '../planning'

const gdd = 'docs/GDD.md' as FoundationDocumentPath
const level = 'docs/LEVEL_SCENE_DESIGN.md' as FoundationDocumentPath
const asset = 'docs/ASSET_PLAN.md' as FoundationDocumentPath
const vision = canonicalFoundationBlockIds(gdd).find(id => id === 'experience_pillars') ?? canonicalFoundationBlockIds(gdd)[1]!
const loop = canonicalFoundationBlockIds(gdd).find(id => id === 'core_loop') ?? canonicalFoundationBlockIds(gdd)[2]!
const inventory = canonicalFoundationBlockIds(asset).find(id => id === 'inventory') ?? canonicalFoundationBlockIds(asset)[1]!

function section(documentPath: FoundationDocumentPath, sectionId: string) {
  return { documentPath, sectionId, heading: sectionId, startLine: 1, endLine: 2, digest: `${documentPath}#${sectionId}`.padEnd(64, '0').slice(0, 64) }
}

const sectionRefs = [section(gdd, vision), section(gdd, loop), section(asset, inventory)]
const authorities: RevisionSectionAuthority[] = sectionRefs.map(({ documentPath, sectionId }) => ({ documentPath, sectionId }))

function sectionIssue(id: string, documentPath: FoundationDocumentPath, sectionId: string, source = section(documentPath, sectionId)): AuditIssue {
  return { id, severity: 'HIGH', type: 'rule', source, expected: 'expected', actual: 'actual', remediation: { kind: 'patch', scope: 'section', documentPath, sectionIds: [sectionId] } }
}

function documentIssue(id: string, documentPath: FoundationDocumentPath, digest = 'f'.repeat(64)): FoundationDocumentAuditIssue {
  return { id, severity: 'HIGH', type: 'schema', source: { scope: 'document', documentPath, digest }, expected: 'expected', actual: 'actual', reasonCode: 'DOCUMENT_FORMAT_INVALID', remediation: { kind: 'patch', scope: 'document', documentPath } }
}

function modern(issues: readonly unknown[], data: readonly RevisionSectionAuthority[] = authorities): { issues: readonly RevisionPlanningIssue[]; sectionAuthorities: readonly RevisionSectionAuthority[] } {
  return { issues: issues as readonly RevisionPlanningIssue[], sectionAuthorities: data }
}

test('valid section grouping is canonical and stable', () => {
  const issues = [sectionIssue('AUD-B', gdd, loop), sectionIssue('AUD-A', gdd, vision), sectionIssue('AUD-I', asset, inventory)]
  expect(buildFoundationRevisionBatches(modern(issues))).toEqual([
    { scope: 'section', documentPath: gdd, sectionIds: [vision, loop], issueIds: ['AUD-A', 'AUD-B'] },
    { scope: 'section', documentPath: asset, sectionIds: [inventory], issueIds: ['AUD-I'] },
  ])
  expect(buildFoundationRevisionBatches(modern([issues[2]!, issues[0]!, issues[1]!]))).toEqual(buildFoundationRevisionBatches(modern(issues)))
})

test('cross-document source and target references never widen the remediation batch', () => {
  const source = section(asset, inventory)
  const issue = { ...sectionIssue('AUD-CROSS', gdd, vision), source, target: section(level, 'world_structure') }
  expect(buildFoundationRevisionBatches(modern([issue]))).toEqual([
    { scope: 'section', documentPath: gdd, sectionIds: [vision], issueIds: ['AUD-CROSS'] },
  ])
})

test('document format repairs preserve the narrow document scope exactly', () => {
  const issues = [documentIssue('FMT-B', gdd), documentIssue('FMT-A', gdd)]
  expect(buildFoundationRevisionBatches(modern(issues, []))).toEqual([
    { scope: 'document', documentPath: gdd, sectionIds: [], issueIds: ['FMT-A', 'FMT-B'] },
  ])
})

test('unknown document, section, empty/duplicate sections, and mixed scopes fail closed', () => {
  const unknownDocument = sectionIssue('BAD-DOC', 'docs/UNKNOWN.md' as FoundationDocumentPath, vision, section(gdd, vision))
  expect(() => buildFoundationRevisionBatches(modern([unknownDocument]))).toThrow()

  const unknownSection = sectionIssue('BAD-SECTION', gdd, 'not-a-block', section(gdd, 'not-a-block'))
  expect(() => buildFoundationRevisionBatches(modern([unknownSection]))).toThrow()

  const empty = { ...sectionIssue('EMPTY', gdd, vision), remediation: { kind: 'patch' as const, scope: 'section' as const, documentPath: gdd, sectionIds: [] } }
  expect(() => buildFoundationRevisionBatches(modern([empty]))).toThrow()
  const duplicateSections = { ...sectionIssue('DUP-SECTIONS', gdd, vision), remediation: { kind: 'patch' as const, scope: 'section' as const, documentPath: gdd, sectionIds: [vision, vision] } }
  expect(() => buildFoundationRevisionBatches(modern([duplicateSections]))).toThrow()

  const mixed = [sectionIssue('SECTION', gdd, vision), documentIssue('DOCUMENT', gdd)]
  expect(() => buildFoundationRevisionBatches(modern(mixed))).toThrow()
})

test('document format authority rejects ordinary issues, bad digest, and any target', () => {
  const ordinary = { ...documentIssue('ORDINARY', gdd), type: 'rule' as const }
  const badDigest = documentIssue('BAD-DIGEST', gdd, 'not-a-digest')
  const target = { ...documentIssue('TARGET', gdd), target: section(gdd, vision) }
  for (const issue of [ordinary, badDigest, target]) {
    expect(() => buildFoundationRevisionBatches(modern([issue], []))).toThrow()
  }
})

test('duplicate section authority is rejected at the new boundary before planning', () => {
  const issue = sectionIssue('AUTH-DUP', gdd, vision)
  const duplicateAuthorities = [...authorities, { documentPath: gdd, sectionId: vision }]
  // This is intentionally new boundary validation, not a business-rule rewrite;
  // A callback registry could silently collapse duplicate entries.
  expect(() => buildFoundationRevisionBatches(modern([issue], duplicateAuthorities))).toThrow(/duplicate.*authority/i)
})

test('duplicate issue IDs remain rejected', () => {
  const issue = sectionIssue('DUP-ID', gdd, vision)
  expect(() => buildFoundationRevisionBatches(modern([issue, { ...issue }]))).toThrow()
})
