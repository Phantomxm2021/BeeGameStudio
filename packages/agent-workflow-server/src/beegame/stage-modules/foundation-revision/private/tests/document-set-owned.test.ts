import { expect, test } from 'bun:test'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'
import { revisionDigest } from '../json-digest'
import { runRevisionOwnedAttempt } from '../owned-attempt'
import { openRevisionAttemptStore } from '../attempt-store'
import { publishRevisionCompletedCandidate } from '../completed-candidate'
import { readRevisionPublishedCandidate } from '../candidate-publication'

test('one native file child edits companions, seals all changes, and replays without redispatch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'document-set-owned-')))
  try {
    const documents = reviewFixtureDocuments()
    documents[0]!.content = '# incomplete'
    const source = buildSingleReviewFixture({ documents,
      identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
      subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
    const request = { ownerId: source.ownerId, projectId: source.projectId,
      requestId: 'repair', sourceResult: source, sourceBinding: { ownerId: source.ownerId, projectId: source.projectId,
        resultId: source.resultId, resultDigest: revisionDigest(source) } }
    const changed = reviewFixtureDocuments().slice(0, 4).map(document => ({ path: document.path,
      markdown: document.content.replace('This complete', 'This revised complete') }))
    const receipt = await runRevisionOwnedAttempt(root, { request,
      configuration: { command: [process.execPath, join(import.meta.dir, 'native-file-revision.ts'), 'valid',
        Buffer.from(JSON.stringify({documents:Object.fromEntries(changed.map(document=>[document.path,document.markdown]))})).toString('base64')], env: {} } })
    expect(receipt.settlement).toMatchObject({ status: 'completed' })
    expect(receipt.usage).toMatchObject({ total_tokens: 16 })
    const store = await openRevisionAttemptStore(root, request)
    expect((await store.read()).attempt).toBe(1)
    const published = await publishRevisionCompletedCandidate(root, request)
    const candidate = (await readRevisionPublishedCandidate(root, published.result))!
    for (const document of changed) expect(candidate.documents.find(item => item.path === document.path)!.content).toBe(document.markdown)
    expect(candidate).not.toHaveProperty('issueAssessments')
    expect(candidate.revisionSummary).toBeTruthy()
    expect(candidate.documents.some(document => document.content.includes('Explanation outside'))).toBe(false)
    const replay = await runRevisionOwnedAttempt(root, { request,
      configuration: { command: ['/no-new-child'], env: {} } })
    expect(replay).toEqual(receipt)
    expect(await publishRevisionCompletedCandidate(root, request)).toEqual(published)
  } finally { await rm(root, { recursive: true, force: true }) }
})
