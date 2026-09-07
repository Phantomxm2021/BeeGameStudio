import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { parseReviewerCandidateStart, reviewerCandidateInputDigest } from '../candidate-contract'
import { createReviewerAllRegistrations, parseReviewerStart } from '../review-contract'
import { reviewerInputDigest } from '../review-publication'
import { reviewerDigest } from '../review-summary'

function fixture() {
  const { input: candidate } = firstCandidateFixture()
  const input = { kind: 'first' as const, ...candidate }
  const identity = { ownerId: candidate.sourceBinding.ownerId, projectId: candidate.sourceBinding.projectId, requestId: 'reviewer-own-request' }
  return parseReviewerCandidateStart({ protocolVersion: 1, ...identity, input, inputDigest: reviewerCandidateInputDigest({ ...identity, input }) })
}

test('candidate start validates caller authority and binds the whole public handoff', () => {
  const start = fixture()
  expect(parseReviewerStart(start)).toEqual(start)
  const changed = structuredClone(start)
  changed.input.sourceBinding.resultDigest = 'f'.repeat(64)
  expect(() => parseReviewerCandidateStart(changed)).toThrow('binding')
  expect(() => parseReviewerCandidateStart({ ...start, ownerId: 'foreign' })).toThrow('owner or project')
  expect(() => parseReviewerCandidateStart({ ...start, inputDigest: reviewerDigest(start.input) })).toThrow('input digest')
  expect(() => parseReviewerCandidateStart({ ...start, input: { ...start.input, privateTasks: [] } })).toThrow()
})

test('initial and candidate starts share immutable request identities and owner-bound handles', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-candidate-contract-')))
  try {
    const start = fixture()
    const registrations = createReviewerAllRegistrations(workspacePath, start.ownerId)
    const first = await registrations.register(start)
    expect(await registrations.register(start)).toEqual(first)
    expect(await createReviewerAllRegistrations(workspacePath, start.ownerId).load(first.handle)).toEqual(first)
    const source = firstCandidateFixture().prepared.source
    const initial = { ...start, input: { subject: { kind: 'initial' as const, sourceResultId: 'author-result',
      sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, documents: source.documents.map(({ path, content }) => ({ path, content })) } }
    initial.inputDigest = reviewerInputDigest({ ownerId: initial.ownerId, projectId: initial.projectId, ...initial.input })
    await expect(registrations.register(initial)).rejects.toThrow('identity conflicts')
    await expect(createReviewerAllRegistrations(workspacePath, 'foreign').load(first.handle)).rejects.toThrow('owner binding')
    expect(await readdir(workspacePath)).toEqual(['.beegame'])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
