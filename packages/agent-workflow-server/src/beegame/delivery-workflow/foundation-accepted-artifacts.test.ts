import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixtures from '../stage-modules/foundation-revision/private/tests/fixtures/public-initial-inputs.json'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { readCurrentProjectArtifact } from '../project-artifact-store'
import { foundationPublicDigest } from './foundation-public-handoff'
import { publishFoundationAcceptedArtifacts } from './foundation-accepted-artifacts'

async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'accepted-artifacts-')))
  const source = structuredClone(fixtures.infrastructure.start.input.sourceResult)
  const { resultId: _, ...body } = { ...source, kind: 'passed' as const, issues: [] }
  const review = { ...body, resultId: foundationPublicDigest(body) } as ReviewerReviewResult
  return { workspacePath, ownerId: review.ownerId, projectId: review.projectId, review,
    expectedDocuments: structuredClone(review.documents) }
}
function resign(review: ReviewerReviewResult) {
  const { resultId: _, ...body } = review
  review.resultId = foundationPublicDigest(body)
}
test('application publishes exact reviewed bytes and returns the accepted revision', async () => {
  const f = await fixture()
  expect(await publishFoundationAcceptedArtifacts(f)).toBe(f.review.documentSetDigest)
  await publishFoundationAcceptedArtifacts(f)
  for (const document of f.review.documents) {
    expect(await readCurrentProjectArtifact(f.workspacePath, document.path)).toBe(document.content)
    expect(await readFile(join(f.workspacePath, document.path), 'utf8')).toBe(document.content)
  }
})
test('application rejects unrelated, unpassed, mutated or incomplete public results', async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.review.ownerId = 'foreign'; resign(f.review) },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.review.kind = 'issues_found'; resign(f.review) },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.review.documents[0]!.content += 'changed'; resign(f.review) },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.review.documents.pop(); resign(f.review) },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.review.documentSetDigest = '0'.repeat(64); resign(f.review) },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.expectedDocuments[0]!.content += 'different invocation' },
  ]) {
    const f = await fixture(); mutate(f)
    await expect(publishFoundationAcceptedArtifacts(f)).rejects.toThrow()
    expect(await readCurrentProjectArtifact(f.workspacePath, 'docs/GDD.md')).toBeUndefined()
    await expect(readFile(join(f.workspacePath, 'docs/GDD.md'), 'utf8')).rejects.toThrow()
  }
})
test('a self-consistent changed result cannot publish against the original invocation', async () => {
  const f = await fixture()
  const document = f.review.documents[0]!
  document.content += '\nunaudited'
  document.digest = createHash('sha256').update(document.content).digest('hex')
  document.byteLength = Buffer.byteLength(document.content)
  f.review.documentSetDigest = createHash('sha256').update(JSON.stringify(f.review.documents.map(({ path, digest }) => [path, digest]))).digest('hex')
  resign(f.review)
  await expect(publishFoundationAcceptedArtifacts(f)).rejects.toThrow('reviewed input')
})
