import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile, unlink, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { buildReviewerPublishedResult, publishReviewerResult, readReviewerPublishedResult, type ReviewerSubject } from '../review-publication'

const identity = { ownerId: 'publication-owner', projectId: 'project', requestId: 'review-request' }
const subject: ReviewerSubject = { kind: 'initial', sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }
async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-publication-')))
  try { await run(workspace) } finally { await rm(workspace, { recursive: true, force: true }) }
}

test('publication is self-contained, immutable, and does not write canonical documents', async () => fixture(async workspacePath => {
  const input = { workspacePath, identity, subject, ...completedReviewFixture({ normalizedFacts: true }) }
  const expected = buildReviewerPublishedResult(input)
  expect(await readReviewerPublishedResult(workspacePath, expected)).toBeUndefined()
  const pending = publishReviewerResult(input)
  input.documents[0]!.content = 'changed after submission'
  const published = await pending
  expect(published.result).toEqual(expected)
  expect(JSON.parse(await readFile(join(workspacePath, published.artifactPath), 'utf8'))).toEqual(expected)
  expect(await readReviewerPublishedResult(workspacePath, expected)).toEqual(expected)
  expect(await readdir(workspacePath)).toEqual(['.beegame'])
  published.result.documents[0]!.content = 'changed returned copy'
  expect(await readReviewerPublishedResult(workspacePath, expected)).toEqual(expected)
}))

test('unmarked output is not completed and publishing again repairs only the missing commit marker', async () => fixture(async workspacePath => {
  const input = { workspacePath, identity, subject, ...completedReviewFixture() }
  const first = await publishReviewerResult(input)
  const body = await readFile(join(workspacePath, first.artifactPath), 'utf8')
  await unlink(join(workspacePath, first.commitPath))
  expect(await readReviewerPublishedResult(workspacePath, first.result)).toBeUndefined()
  expect(await publishReviewerResult(input)).toEqual(first)
  expect(await readFile(join(workspacePath, first.artifactPath), 'utf8')).toBe(body)
}))

test('a committed missing or modified body is corruption, never a passed result', async () => fixture(async workspacePath => {
  const input = { workspacePath, identity, subject, ...completedReviewFixture({ normalizedFacts: true }) }
  const published = await publishReviewerResult(input)
  const path = join(workspacePath, published.artifactPath)
  const body = await readFile(path, 'utf8')
  await writeFile(path, JSON.stringify({ ...published.result, kind: 'issues_found' }))
  await expect(readReviewerPublishedResult(workspacePath, published.result)).rejects.toThrow('binding mismatch')
  await expect(publishReviewerResult(input)).rejects.toThrow('immutable identity')
  await writeFile(path, body)
  await unlink(path)
  await expect(readReviewerPublishedResult(workspacePath, published.result)).rejects.toThrow('incomplete')
}))

test('publication cannot follow symlink paths into another owner directory', async () => fixture(async workspacePath => {
  const other = join(workspacePath, 'other-owner')
  await mkdir(other)
  await symlink(other, join(workspacePath, '.beegame'))
  await expect(publishReviewerResult({ workspacePath, identity, subject, ...completedReviewFixture() })).rejects.toThrow('real directory')
  expect(await readdir(other)).toEqual([])
}))

test('initial/candidate and candidate A/B results have different immutable bindings', () => {
  const source = completedReviewFixture({ normalizedFacts: true })
  const initial = buildReviewerPublishedResult({ ...source, identity, subject })
  const candidate: ReviewerSubject = { kind: 'candidate', candidateId: 'A', candidateResultId: 'candidate-result-A', baseDocumentSetDigest: initial.documentSetDigest,
    sourceReviewResultId: initial.resultId, sourceReviewResultDigest: 'c'.repeat(64) }
  const a = buildReviewerPublishedResult({ ...source, identity, subject: candidate })
  const b = buildReviewerPublishedResult({ ...source, identity, subject: { ...candidate, candidateId: 'B', candidateResultId: 'candidate-result-B' } })
  expect(new Set([initial.inputDigest, a.inputDigest, b.inputDigest]).size).toBe(3)
  expect(new Set([initial.resultId, a.resultId, b.resultId]).size).toBe(3)
  // Binding capability only: targeted candidate recheck execution is tested separately when connected.
})
