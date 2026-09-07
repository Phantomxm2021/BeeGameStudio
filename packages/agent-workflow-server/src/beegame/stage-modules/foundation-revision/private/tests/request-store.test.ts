import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptRevisionRequest, commitRevisionRequestCandidate } from '../request-store'
import { publishRevisionDerivedCandidate, readRevisionPublishedCandidate } from '../candidate-publication'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const roots: string[] = []
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-request-store-')))
  roots.push(root)
  return root
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: '../request', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

test('concurrent acceptance and disk replay keep one private handle and candidate identity', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await Promise.all(Array.from({ length: 8 }, () => acceptRevisionRequest(root, request)))
  expect(new Set(accepted.map(value => value.record.handle)).size).toBe(1)
  expect(new Set(accepted.map(value => value.record.candidateId)).size).toBe(1)
  expect(await acceptRevisionRequest(root, structuredClone(request))).toEqual(accepted[0])
  const key = revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
  expect(accepted[0]!.artifactPath).toBe(`.beegame/workflow/foundation-revision/requests/${key}/request.json`)
  expect(JSON.parse(await readFile(join(root, accepted[0]!.artifactPath), 'utf8'))).toEqual(accepted[0]!.record)
  const other = await acceptRevisionRequest(root, { ...request, requestId: 'other' })
  expect(other.record.handle).not.toBe(accepted[0]!.record.handle)
  expect(other.record.candidateId).not.toBe(accepted[0]!.record.candidateId)
})

test('captures before yielding, and rejects same-key changed input without replacing the accepted record', async () => {
  const root = await workspace()
  const request = fixture()
  const pending = acceptRevisionRequest(root, request)
  request.sourceResult.documents[0]!.content = 'mutated'
  const first = await pending
  expect(first.prepared.source.documents[0]!.content).toBe('# incomplete')
  const bytes = await readFile(join(root, first.artifactPath), 'utf8')
  const changed = fixture()
  changed.sourceResult.requestId = 'different-review'
  const { resultId: _id, ...body } = changed.sourceResult
  changed.sourceResult.resultId = revisionDigest(body)
  changed.sourceBinding.resultId = changed.sourceResult.resultId
  changed.sourceBinding.resultDigest = revisionDigest(changed.sourceResult)
  await expect(acceptRevisionRequest(root, changed)).rejects.toThrow()
  expect(await readFile(join(root, first.artifactPath), 'utf8')).toBe(bytes)
})

test('stored identity or request corruption fails closed and never self-heals by replacing the record', async () => {
  const root = await workspace()
  const request = fixture()
  const first = await acceptRevisionRequest(root, request)
  const path = join(root, first.artifactPath)
  for (const invalid of [{ ...first.record, handle: '../invalid' }, { ...first.record, requestDigest: '0'.repeat(64) },
    { ...first.record, callerState: true }, { ...first.record, request: { ...request, requestId: 'another' } }]) {
    const bytes = revisionCanonicalJson(invalid) + '\n'
    await writeFile(path, bytes)
    await expect(acceptRevisionRequest(root, request)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(bytes)
  }
})

test('rejects symlink namespace and file targets without changing the target', async () => {
  const root = await workspace()
  const target = await workspace()
  await symlink(target, join(root, '.beegame'))
  await expect(acceptRevisionRequest(root, fixture())).rejects.toThrow()
  const other = await workspace()
  const request = fixture()
  const key = revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
  const directory = join(other, '.beegame/workflow/foundation-revision/requests', key)
  await mkdir(directory, { recursive: true })
  const targetFile = join(target, 'sentinel.json')
  await writeFile(targetFile, '{}')
  await symlink(targetFile, join(directory, 'request.json'))
  await expect(acceptRevisionRequest(other, request)).rejects.toThrow()
  expect(await readFile(targetFile, 'utf8')).toBe('{}')
})

test('candidate materialization reuses the admitted identity and commits one immutable snapshot before publication', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  const input = { request, candidateDocuments: reviewFixtureDocuments(), unresolvedIssues: [] }
  const attempts = await Promise.all(Array.from({ length: 4 }, () => commitRevisionRequestCandidate(root, input)))
  const first = attempts[0]!
  expect(attempts.every(value => revisionCanonicalJson(value) === revisionCanonicalJson(first))).toBe(true)
  expect(first.candidate.candidateId).toBe(accepted.record.candidateId)
  expect(first.record.handle).toBe(accepted.record.handle)
  expect(await commitRevisionRequestCandidate(root, structuredClone(input))).toEqual(first)
  expect(JSON.parse(await readFile(join(root, first.artifactPath), 'utf8'))).toEqual(first.candidate)
  const published = await publishRevisionDerivedCandidate(root, first.candidate)
  expect(await readRevisionPublishedCandidate(root, first.candidate)).toEqual(published.result)
  const changed = input.candidateDocuments.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? doc.content + '\n' : doc.content }))
  await expect(commitRevisionRequestCandidate(root, { ...input, candidateDocuments: changed })).rejects.toThrow('conflict')
  expect(JSON.parse(await readFile(join(root, first.artifactPath), 'utf8'))).toEqual(first.candidate)
  await writeFile(join(root, first.artifactPath), '{}')
  await expect(commitRevisionRequestCandidate(root, input)).rejects.toThrow('conflict')
  expect(await readFile(join(root, first.artifactPath), 'utf8')).toBe('{}')
})
