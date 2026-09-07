import { expect, test } from 'bun:test'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { revisionDigest, revisionBytesDigest } from '../json-digest'
import { acceptRevisionWorkerOutput, REVISION_WORKER_OUTPUT_MAX_BYTES } from '../worker-output'
import { deriveRevisionPatchOperations, parseRevisionSections } from '../markdown'
import { prepareRevisionRequest } from '../request-preparation'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'

const identity = { ownerId: 'worker-output-owner', projectId: 'worker-output-project', requestId: 'review' }
const subject = { kind: 'initial' as const, sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }

function binding(result: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: revisionDigest(result) }
}

function sectionRequest() {
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = documents[0]!.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
  const sourceResult = buildReviewerPublishedResult({ identity, subject, ...completedReviewFixture({ documents, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } }) })
  return { kind: 'initial', ownerId: identity.ownerId, projectId: identity.projectId, requestId: 'repair', sourceResult,
    sourceBinding: binding(sourceResult) }
}

function documentRequest() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
  return { kind: 'initial', ownerId: identity.ownerId, projectId: identity.projectId, requestId: 'repair-format', sourceResult,
    sourceBinding: binding(sourceResult) }
}

test('accepts a section result by rebuilding the full document and deriving exact operations', () => {
  const request = sectionRequest()
  const prepared = prepareRevisionRequest(request)
  const batch = prepared.batches[0]!
  const base = prepared.staging.documents.find(document => document.path === batch.documentPath)!.content
  const section = batch.sectionIds[0]!
  const marker = `<!-- beegame-section:${section} -->`
  const heading = base.slice(base.indexOf(marker)).split('\n').slice(1, 3).join('\n')
  const output = `${heading}\nRevised authority.`
  const accepted = acceptRevisionWorkerOutput({ request, documentPath: batch.documentPath, markdown: output })
  expect(accepted.scope).toBe('section')
  expect(accepted.requestDigest).toBe(prepared.requestDigest)
  expect(accepted.baseDocumentDigest).toBe(revisionBytesDigest(base))
  expect(accepted.markdown).toContain('Revised authority.')
  expect(accepted.operations).toEqual(deriveRevisionPatchOperations({ documentPath: batch.documentPath, baseMarkdown: base,
    stagedMarkdown: accepted.markdown, authorizedSectionIds: batch.sectionIds, issueIdsBySection: { [section]: batch.issueIds } }))
})

test('accepts a whole-document result and derives the format operation', () => {
  const request = documentRequest()
  const prepared = prepareRevisionRequest(request)
  const batch = prepared.batches[0]!
  const repaired = reviewFixtureDocuments()[0]!.content
  const accepted = acceptRevisionWorkerOutput({ request, documentPath: batch.documentPath, markdown: repaired })
  expect(accepted.scope).toBe('document')
  expect(accepted.operations).toEqual([{ scope: 'document', kind: 'REPLACE', documentPath: batch.documentPath,
    issueIds: batch.issueIds, beforeDigest: revisionBytesDigest('# incomplete'), afterDigest: revisionBytesDigest(repaired) }])
  expect(accepted.documentDigest).toBe(revisionBytesDigest(repaired))
})

test('requires byte progress and rejects unauthorized sections, malformed paths, extras and accessors', () => {
  const request = sectionRequest()
  const prepared = prepareRevisionRequest(request)
  const batch = prepared.batches[0]!
  const base = prepared.staging.documents.find(document => document.path === batch.documentPath)!.content
  const section = buildFoundationSectionIndex({ documents: { [batch.documentPath]: base } }).find(ref => ref.sectionId === batch.sectionIds[0])!
  const unchanged = base.split('\n').slice(section.startLine - 1, section.endLine).join('\n')
  const replacements = parseRevisionSections({ documentPath: batch.documentPath, baseMarkdown: base,
    authorizedSectionIds: batch.sectionIds, output: unchanged })
  expect(replacements).toHaveLength(1)
  const acceptedUnchanged = acceptRevisionWorkerOutput({ request, documentPath: batch.documentPath, markdown: unchanged })
  expect(acceptedUnchanged.scope).toBe('section')
  expect(acceptedUnchanged.operations).toHaveLength(1)
  expect(() => acceptRevisionWorkerOutput({ request, documentPath: batch.documentPath, markdown: '## vision\n\nunauthorized' })).toThrow(/heading|section/i)
  expect(() => acceptRevisionWorkerOutput({ request, documentPath: 'docs/foreign.md', markdown: unchanged })).toThrow()
  expect(() => acceptRevisionWorkerOutput({ request, documentPath: batch.documentPath, markdown: unchanged, extra: true })).toThrow()
  let reads = 0
  const accessor = { request, documentPath: batch.documentPath, get markdown() { reads++; return unchanged } }
  expect(() => acceptRevisionWorkerOutput(accessor)).toThrow(/accessor/i)
  expect(reads).toBe(0)
})

test('rejects oversized raw Markdown before preparation', () => {
  expect(() => acceptRevisionWorkerOutput({ request: {}, documentPath: 'docs/GDD.md', markdown: 'x'.repeat(REVISION_WORKER_OUTPUT_MAX_BYTES + 1) }))
    .toThrow(/infrastructure boundary/i)
})
