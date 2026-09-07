import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoundationReviewer, foundationReviewerInputDigest } from '../../public'
import { reviewFixtureDocuments, completedReviewFixture } from '../test-fixtures/review-fixture'
import { candidateFixtureFromReview } from '../test-fixtures/candidate-fixture'
import { initialReviewerFactState } from '../fact-state'
import { reviewerCandidateMode, prepareReviewerCandidateInput } from '../candidate-contract'
import { offlineReviewerBilling } from '../test-fixtures/offline-billing'
import { reviewerDigest } from '../review-summary'
import { buildReviewerFullFormatResult } from '../full-format-publication'
import { prepareReviewerFirstCandidate } from '../candidate-handoff'
import { bindReviewDocuments } from '../prepare-review'
import { verifyReviewerCandidateChanges } from '../candidate-changes'

function candidate(stillMalformed = false) {
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = '# incomplete\n'
  const repaired = reviewFixtureDocuments(true)
  if (stillMalformed) repaired[0]!.content = '# still incomplete\n'
  return candidateFixtureFromReview({ documents, state: initialReviewerFactState(documents) }, repaired)
}
const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({ ownerId: value.ownerId,
  projectId: value.projectId, resultId: value.resultId, resultDigest: reviewerDigest(value) })

test('whole format candidates bind a full review and subsequent repairs start at round one', () => {
  const first = candidate()
  expect(reviewerCandidateMode(first.prepared)).toBe('full_format')
  const result = buildReviewerFullFormatResult({ requestId: 'format-review', candidate: first.prepared,
    state: completedReviewFixture({ documents: first.prepared.documents, output: taskId => taskId === 'semantic-4'
      ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
        sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
      : { status: 'completed', outcome: 'PASS' } }).state })
  expect(result.recheck?.kind).toBe('full_format')
  expect(result.kind).toBe('issues_found')
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = documents[0]!.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
  const snapshot = bindReviewDocuments(documents)
  const { resultId: ignored, ...previous } = first.input.candidateResult
  const body = { ...previous, candidateId: 'new-round-one', round: 1, sourceReviewResultId: result.resultId,
    sourceReviewResultDigest: reviewerDigest(result), baseDocumentSetDigest: result.documentSetDigest,
    documentSetDigest: snapshot.digest, documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })),
    changes: verifyReviewerCandidateChanges({ baseDocuments: result.documents.map(({ path, content }) => ({ path, content })), candidateDocuments: documents, issues: result.issues.map(entry => entry.issue) }),
    repairClaims: result.issues.map(entry => ({ issueId: entry.issue.id, status: 'APPLIED' as const })) }
  const next = { ...body, resultId: reviewerDigest(body) }
  expect(prepareReviewerFirstCandidate({ sourceResult: result, sourceBinding: binding(result), candidateResult: next, candidateBinding: binding(next) }).candidate.round).toBe(1)
  const wrongBody = { ...body, round: 2 }
  const wrong = { ...wrongBody, resultId: reviewerDigest(wrongBody) }
  expect(() => prepareReviewerFirstCandidate({ sourceResult: result, sourceBinding: binding(result), candidateResult: wrong, candidateBinding: binding(wrong) })).toThrow('round')
})

test('public full format candidate runs fresh full semantic review and restart only reads publication', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-full-format-')))
  try {
    const fixture = candidate()
    const input = { kind: 'first' as const, ...fixture.input }
    expect(reviewerCandidateMode(prepareReviewerCandidateInput(input))).toBe('full_format')
    const identity = { ownerId: 'owner', projectId: 'project' }
    const billing = offlineReviewerBilling(identity.ownerId)
    let calls = 0
    const runtimeConfiguration = { protocolVersion: 1 as const, ownerId: identity.ownerId, async resolve() {
      calls++
      return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), '--fixture-mode=success'],
        env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } }
    } }
    const api = createFoundationReviewer({ workspacePath }, { billing: billing.client, runtimeConfiguration })
    const start = { protocolVersion: 1 as const, requestId: 'full-format', ...identity, input,
      inputDigest: foundationReviewerInputDigest({ ...identity, input }) }
    const handle = await api.start(start)
    let result = await api.getResult(handle)
    const deadline = Date.now() + 90_000
    while ((result.status !== 'completed' || result.billingStatus !== 'settled') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
      result = await api.getResult(handle)
    }
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    expect(result.result.recheck?.kind).toBe('full_format')
    expect(result.result.subject.kind).toBe('candidate')
    expect(result.result.documents.map(doc => doc.content)).toEqual(fixture.prepared.documents.map(doc => doc.content))
    expect(calls).toBe(10)
    expect(billing.recorded.size).toBe(10)
    const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', reviewerDigest({ ownerId: 'owner', projectId: 'project', requestId: 'full-format' }))
    const events = await readdir(join(root, 'events'))
    const records = await Promise.all(events.map(name => readFile(join(root, 'events', name), 'utf8')))
    expect(records.some(record => record.includes('begin_semantic'))).toBe(true)
    expect(records.some(record => record.includes('targeted'))).toBe(false)
    const reopened = createFoundationReviewer({ workspacePath }, { billing: billing.client,
      runtimeConfiguration: { ...runtimeConfiguration, async resolve() { throw new Error('lookup cannot execute') } } })
    expect(await reopened.getResult(handle)).toEqual(result)
    expect(await reopened.start(start)).toEqual(handle)
    expect(await readdir(workspacePath)).toEqual(['.beegame'])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}, 110_000)
