import { expect, test } from 'bun:test'
import { verifyReviewerCandidateChanges } from '../candidate-changes'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import { auditFoundationDocumentFormats } from '../domain/foundation-document-format-review'
import type { FoundationReviewIssue } from '../domain/foundation-issue-registry'

function fixture() {
  const baseDocuments = reviewFixtureDocuments(true)
  const candidateDocuments = structuredClone(baseDocuments)
  candidateDocuments[0]!.content = candidateDocuments[0]!.content.replace('game.mechanics: ["move","attack","dash"]',
    'game.mechanics: ["move","attack","dash","parry"]')
  const source = buildFoundationSectionIndex({ documents: new Map(baseDocuments.map(doc => [doc.path, doc.content])) })
    .find(ref => ref.documentPath === 'docs/GDD.md' && ref.sectionId === 'player_actions')!
  const issues: FoundationReviewIssue[] = [{ id: 'accepted-issue', type: 'semantic', severity: 'HIGH', source,
    expected: 'parry feedback', actual: 'missing', remediation: { kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['player_actions'] } }]
  return { baseDocuments, candidateDocuments, issues }
}

test('candidate byte scope agrees with frozen section diff without trusting repair declarations', () => {
  const input = fixture()
  const operations = verifyReviewerCandidateChanges(input)
  expect(operations.map(operation => operation.scope === 'section' ? operation.sectionId : '')).toEqual(['player_actions'])
  expect(operations).toEqual([{ scope: 'section', kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'player_actions',
    issueIds: ['accepted-issue'], beforeDigest: input.issues[0]!.source.digest,
    afterDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }])
})
test('unrelated document, section, title and marker edits are rejected', () => {
  for (const change of [
    (input: ReturnType<typeof fixture>) => { input.candidateDocuments[1]!.content += '\nunauthorized' },
    (input: ReturnType<typeof fixture>) => { input.candidateDocuments[0]!.content = input.candidateDocuments[0]!.content.replace('game.players.max: 4', 'game.players.max: 8') },
    (input: ReturnType<typeof fixture>) => { input.candidateDocuments[0]!.content = 'unauthorized\n' + input.candidateDocuments[0]!.content },
    (input: ReturnType<typeof fixture>) => { input.candidateDocuments[0]!.content = input.candidateDocuments[0]!.content.replace('player_actions', 'not_a_section') },
  ]) {
    const input = fixture(); change(input)
    expect(() => verifyReviewerCandidateChanges(input)).toThrow()
  }
})
test('service metadata comparison preserves the frozen exception, not arbitrary front matter', () => {
  const input = fixture()
  input.baseDocuments[0]!.content = '---\nversion: 1\nupdated_at: old\nowner: original\n---\n' + input.baseDocuments[0]!.content
  input.candidateDocuments[0]!.content = '---\nversion: 2\nupdated_at: new\nowner: original\n---\n' + input.candidateDocuments[0]!.content
  expect(verifyReviewerCandidateChanges(input)).toHaveLength(1)
  input.candidateDocuments[0]!.content = input.candidateDocuments[0]!.content.replace('owner: original', 'owner: foreign')
  expect(() => verifyReviewerCandidateChanges(input)).toThrow('outside')
})
test('every admitted issue must be covered by real progress and duplicate IDs are rejected', () => {
  const input = fixture()
  expect(() => verifyReviewerCandidateChanges({ ...input, candidateDocuments: input.baseDocuments })).toThrow('progress')
  expect(() => verifyReviewerCandidateChanges({ ...input, issues: [] })).toThrow('unique')
  expect(() => verifyReviewerCandidateChanges({ ...input, issues: [input.issues[0]!, input.issues[0]!] })).toThrow('unique')
  const uncovered = structuredClone(input.issues[0]!)
  uncovered.id = 'uncovered'
  if (uncovered.remediation.scope !== 'section') throw new Error('fixture')
  uncovered.remediation.sectionIds = ['overview']
  expect(() => verifyReviewerCandidateChanges({ ...input, issues: [...input.issues, uncovered] })).toThrow('coverage')
})
test('document-format repair checks complete Markdown and exact before/after bytes', () => {
  const input = fixture()
  input.candidateDocuments = structuredClone(input.baseDocuments)
  input.baseDocuments[0]!.content = '# incomplete'
  input.issues = auditFoundationDocumentFormats({ documents: new Map(input.baseDocuments.map(doc => [doc.path, doc.content])) })
  expect(verifyReviewerCandidateChanges(input)).toEqual([{ scope: 'document', kind: 'REPLACE', documentPath: 'docs/GDD.md',
    issueIds: [input.issues[0]!.id], beforeDigest: input.issues[0]!.source.digest, afterDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  input.candidateDocuments[0]!.content = '# still incomplete'
  expect(() => verifyReviewerCandidateChanges(input)).toThrow()
  input.candidateDocuments[0]!.content = '---\nnot closed'
  expect(() => verifyReviewerCandidateChanges(input)).toThrow('front matter')
})
