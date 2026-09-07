import { expect, test } from 'bun:test'
import { completedReviewFixture } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import {
  deriveFoundationRevisionChangedSectionIds,
  deriveRevisionPatchOperations,
  foundationPatchOperationsDigest,
  applyFoundationRevisionSections,
  parseRevisionSections,
} from '../markdown'

test('changed-section derivation accepts only authorized byte changes', () => {
  const { documents } = completedReviewFixture()
  const path = documents[0]!.path
  const base = documents[0]!.content
  const marker = '<!-- beegame-section:experience_pillars -->'
  const staged = base.replace(`${marker}\n## Player Experience and Design Pillars\n\n`, `${marker}\n## Player Experience and Design Pillars\n\nRevised authority.\n\n`)
  const input = { documentPath: path, baseMarkdown: base, stagedMarkdown: staged, authorizedSectionIds: ['experience_pillars'] }
  expect(deriveFoundationRevisionChangedSectionIds(input)).toEqual(['experience_pillars'])
})

test('unauthorized, reordered, and metadata-only changes fail closed', () => {
  const { documents } = completedReviewFixture()
  const path = documents[0]!.path
  const base = documents[0]!.content
  const section = '<!-- beegame-section:experience_pillars -->\n## Player Experience and Design Pillars\n\n'
  const changed = base.replace(`${section}`, `${section}Changed.\n\n`)
  const input = { documentPath: path, baseMarkdown: base, stagedMarkdown: changed, authorizedSectionIds: ['core_loop'] }
  expect(() => deriveFoundationRevisionChangedSectionIds(input)).toThrow(/unauthorized/i)
  const reordered = base.replace('<!-- beegame-section:vision -->', '<!-- beegame-section:scope_risks -->')
  expect(() => deriveFoundationRevisionChangedSectionIds({ ...input, stagedMarkdown: reordered, authorizedSectionIds: ['vision'] })).toThrow(/contract|marker|order/i)
  expect(() => deriveFoundationRevisionChangedSectionIds({ ...input, stagedMarkdown: base, authorizedSectionIds: ['experience_pillars'] })).toThrow(/progress/i)
})

test('operation digest is independent of input order', () => {
  const operations = [
    { scope: 'section' as const, kind: 'REPLACE' as const, documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', issueIds: ['AUD-B', 'AUD-A'], beforeDigest: 'a'.repeat(64), afterDigest: 'b'.repeat(64) },
    { scope: 'document' as const, kind: 'REPLACE' as const, documentPath: 'docs/ASSET_PLAN.md' as const, issueIds: ['AUD-C'], beforeDigest: 'c'.repeat(64), afterDigest: 'd'.repeat(64) },
  ]
  expect(foundationPatchOperationsDigest(operations)).toMatch(/^[a-f0-9]{64}$/)
  expect(foundationPatchOperationsDigest([...operations].reverse())).toBe(foundationPatchOperationsDigest(operations))
})

test('all eight documents retain section replacement bytes and ordering', () => {
  for (const document of reviewFixtureDocuments()) {
    const sections = buildFoundationSectionIndex({ documents: { [document.path]: document.content } }).slice(0, 2)
    const replacements = sections.map(section => ({ sectionId: section.sectionId,
      sectionMarkdown: `## ${section.heading}\n\nNew replacement ${section.sectionId}.` }))
    const input = { documentPath: document.path, baseMarkdown: document.content,
      authorizedSectionIds: sections.map(section => section.sectionId), replacements: [...replacements].reverse() }
    const applied = applyFoundationRevisionSections(input)
    expect(applied.changedSectionIds).toEqual(sections.map(section => section.sectionId))
    expect(parseRevisionSections({ ...input, output: replacements.map(item => item.sectionMarkdown).join('\n\n') })).toEqual(replacements)
  }
})

test('replacement omissions, duplicates, wrong headings and protocol markers fail closed', () => {
  const document = reviewFixtureDocuments()[0]!
  const section = buildFoundationSectionIndex({ documents: { [document.path]: document.content } })[0]!
  const replacement = { sectionId: section.sectionId, sectionMarkdown: `## ${section.heading}\n\nChanged.` }
  const base = { documentPath: document.path, baseMarkdown: document.content, authorizedSectionIds: [section.sectionId] }
  for (const replacements of [[], [replacement, replacement], [{ ...replacement, sectionId: 'not-authorized' }],
    [{ ...replacement, sectionMarkdown: '## Wrong heading\nChanged.' }],
    [{ ...replacement, sectionMarkdown: `${replacement.sectionMarkdown}\n<!-- beegame-section:vision -->` }]]) {
    expect(() => applyFoundationRevisionSections({ ...base, replacements })).toThrow()
  }
  for (const output of ['prose\n' + replacement.sectionMarkdown, replacement.sectionMarkdown + '\n' + replacement.sectionMarkdown, '## Wrong heading'])
    expect(() => parseRevisionSections({ ...base, output })).toThrow()
})

test('section operations cannot silently drop an admitted issue on an unchanged authorized section', () => {
  const document = reviewFixtureDocuments()[0]!
  const sections = buildFoundationSectionIndex({ documents: { [document.path]: document.content } }).slice(0, 2)
  const changed = applyFoundationRevisionSections({ documentPath: document.path, baseMarkdown: document.content,
    authorizedSectionIds: [sections[0]!.sectionId], replacements: [{ sectionId: sections[0]!.sectionId,
      sectionMarkdown: `## ${sections[0]!.heading}\n\nChanged.` }] })
  expect(() => deriveRevisionPatchOperations({ documentPath: document.path, baseMarkdown: document.content, stagedMarkdown: changed.markdown,
    authorizedSectionIds: sections.map(section => section.sectionId), issueIdsBySection: {
      [sections[0]!.sectionId]: ['changed-issue'], [sections[1]!.sectionId]: ['omitted-issue'],
    } })).toThrow('issue coverage')
})

test('operations carry only digests and issue bindings, never replacement bodies', () => {
  const { documents } = completedReviewFixture()
  const base = documents[0]!.content
  const staged = base.replace('## Player Experience and Design Pillars\n\n', '## Player Experience and Design Pillars\n\nRevised authority.\n\n')
  const operations = deriveRevisionPatchOperations({ documentPath: documents[0]!.path, baseMarkdown: base, stagedMarkdown: staged,
    authorizedSectionIds: ['experience_pillars'], issueIdsBySection: { experience_pillars: ['AUD-1'] } })
  expect(operations).toHaveLength(1)
  expect(operations[0]).toMatchObject({ scope: 'section', kind: 'REPLACE', sectionId: 'experience_pillars', issueIds: ['AUD-1'] })
  expect(operations[0]).not.toHaveProperty('before')
  expect(operations[0]).not.toHaveProperty('after')
})
