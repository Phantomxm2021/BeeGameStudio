import { expect, test } from 'bun:test'
import { parseRevisionInitialSource, type RevisionIssue } from '../initial-source'
import { revisionDigest } from '../json-digest'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
// Producer fixture construction is confined to tests, not Revision production.
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'

const identity = { ownerId: 'revision-owner', projectId: 'revision-project', requestId: 'review' }
const subject = { kind: 'initial' as const, sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }
const binding = (result: ReturnType<typeof buildReviewerPublishedResult>) => ({ ownerId: result.ownerId, projectId: result.projectId,
  resultId: result.resultId, resultDigest: revisionDigest(result) })
function formatFixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  return buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
}
function semanticFixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  return buildReviewerPublishedResult({ identity, subject, ...review })
}
function semanticIssue(result: unknown): Extract<RevisionIssue, { type: 'semantic' }> {
  const issue = (result as { issues: Array<{ issue: RevisionIssue }> }).issues[0]!.issue
  if (issue.type !== 'semantic') throw new Error('expected semantic fixture')
  return issue
}
function rebind(result: ReturnType<typeof buildReviewerPublishedResult>) {
  result.issueRegistryDigest = revisionDigest(result.issues.map(entry => entry.issue))
  const { resultId: _, ...body } = result
  result.resultId = revisionDigest(body)
  return binding(result)
}

function supportingSection(result: ReturnType<typeof buildReviewerPublishedResult>) {
  const index = buildFoundationSectionIndex({ documents: new Map(result.documents.map(doc => [doc.path, doc.content])) })
  const indexed = index.find(section => section.documentPath === 'docs/TECHNICAL_DESIGN.md' && section.sectionId === 'input_interaction')!
  const document = result.documents.find(doc => doc.path === indexed.documentPath)!
  return {
    documentPath: indexed.documentPath,
    sectionId: indexed.sectionId,
    heading: indexed.heading,
    startLine: indexed.startLine,
    endLine: indexed.endLine,
    digest: indexed.digest,
    content: document.content.split('\n').slice(indexed.startLine - 1, indexed.endLine).join('\n'),
  }
}

test('accepts copied initial format and semantic public handoffs, without producer state', () => {
  for (const source of [formatFixture(), semanticFixture()]) {
    const parsed = parseRevisionInitialSource(source, binding(source))
    expect(revisionDigest(parsed)).toBe(revisionDigest(source))
    parsed.issues[0]!.issue.actual = 'local mutation'
    expect(source.issues[0]!.issue.actual).not.toBe('local mutation')
  }
})

test('separate accepted binding rejects replacement, identity mismatch and extra state', () => {
  const source = formatFixture()
  const accepted = binding(source)
  expect(() => parseRevisionInitialSource(source, { ...accepted, ownerId: 'foreign' })).toThrow('binding')
  expect(() => parseRevisionInitialSource({ ...source, state: {} }, accepted)).toThrow()
  source.issues[0]!.issue.actual = 'replacement'
  rebind(source)
  expect(() => parseRevisionInitialSource(source, accepted)).toThrow('binding')
})

test('rehashing does not admit document or evidence mismatches', () => {
  let source = formatFixture()
  source.documents[0]!.byteLength++
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('document binding')
  source = formatFixture()
  source.issues[0]!.sections[0]!.content += 'replacement'
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('slices')
  source = semanticFixture()
  source.issues[0]!.facts[0]!.evidence.digest = 'f'.repeat(64)
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('fact evidence digest')
  source = semanticFixture()
  source.issues[0]!.issue.source.digest = 'f'.repeat(64)
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('section evidence')
})

test('first-source parser refuses passed results and candidate subjects rather than guessing a retry', () => {
  const passed = buildReviewerPublishedResult({ identity, subject, ...completedReviewFixture({ normalizedFacts: true }) })
  expect(() => parseRevisionInitialSource(passed, binding(passed))).toThrow()
  const source = formatFixture()
  const candidate = { ...source, subject: { kind: 'candidate', candidateId: 'candidate' } }
  expect(() => parseRevisionInitialSource(candidate, binding(source))).toThrow()
})

test('valid cross-document evidence survives admission but unrelated keys, wrong owners and bad values do not', () => {
  const valid = semanticFixture()
  const parsed = parseRevisionInitialSource(valid, binding(valid))
  const evidence = parsed.issues[0]!.facts
  expect(evidence.some(fact => fact.key === 'technical.supported_actions' && fact.source.documentPath === 'docs/TECHNICAL_DESIGN.md')).toBe(true)
  const sectionIndex = buildFoundationSectionIndex({ documents: new Map(valid.documents.map(doc => [doc.path, doc.content])) })
  const vision = sectionIndex.find(section => section.documentPath === 'docs/GDD.md' && section.sectionId === 'vision')!
  const visionEvidence = { documentPath: vision.documentPath, sectionId: vision.sectionId,
    startLine: vision.startLine, endLine: vision.endLine, digest: vision.digest }
  let source = semanticFixture()
  source.issues[0]!.facts.push({ key: 'game.players.max', value: 4, source: vision, evidence: visionEvidence })
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('outside repair evidence scope')
  source = semanticFixture()
  source.issues[0]!.facts[0]!.source = vision
  source.issues[0]!.facts[0]!.evidence = visionEvidence
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('owner')
  source = semanticFixture()
  source.issues[0]!.facts[0]!.value = []
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow('list length')
})

test('semantic issues require a well-shaped bounded supportingSections array', () => {
  let source = semanticFixture()
  delete (source.issues[0]!.issue as Record<string, unknown>).supportingSections
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow()

  source = semanticFixture()
  semanticIssue(source).supportingSections = Array.from({ length: 17 }, () => ({
    documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'input_interaction', heading: 'Input and Interaction Boundary',
    startLine: 32, endLine: 38, digest: 'a'.repeat(64),
  }))
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow()

  source = semanticFixture()
  semanticIssue(source).supportingSections = [{ documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'input_interaction',
    heading: 'Input and Interaction Boundary', startLine: 0, endLine: 1, digest: 'a'.repeat(64) }]
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow()
})

test('supportingSections reject duplicate, source-overlapping and stale references', () => {
  let source = semanticFixture()
  const support = supportingSection(source)
  const { content: _content, ...supportRef } = support
  semanticIssue(source).supportingSections = [supportRef, supportRef]
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow(/duplicate|overlaps|ordered/i)

  source = semanticFixture()
  const sourceRef = semanticIssue(source).source
  semanticIssue(source).supportingSections = [sourceRef]
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow(/duplicate|overlaps/i)

  source = semanticFixture()
  const stale = supportingSection(source)
  stale.digest = 'f'.repeat(64)
  const { content: _staleContent, ...staleRef } = stale
  semanticIssue(source).supportingSections = [staleRef]
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow(/section evidence|digest/i)
})

test('supporting section slices are tamper-evident after admission', () => {
  const source = semanticFixture()
  const support = supportingSection(source)
  const { content, ...ref } = support
  semanticIssue(source).supportingSections = [ref]
  source.issues[0]!.sections.push({ path: ref.documentPath, sectionId: ref.sectionId, content: `${content}\ntampered`, digest: ref.digest })
  expect(() => parseRevisionInitialSource(source, rebind(source))).toThrow(/slices|digest/i)
})
