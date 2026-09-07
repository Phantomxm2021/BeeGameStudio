import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { parseRevisionCandidateResult } from '../candidate-result'
import { publishRevisionDerivedCandidate, readRevisionPublishedCandidate } from '../candidate-publication'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const source = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
    documents, state: initialReviewerFactState(documents) })
  const candidate = buildRevisionInitialCandidate({ sourceResult: source,
    sourceBinding: binding(source), requestId: 'revise', candidateDocuments: reviewFixtureDocuments(), unresolvedIssues: [] })
  return parseRevisionCandidateResult(candidate, binding(candidate))
}
function binding(result: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: revisionDigest(result) }
}
const resultDirectory = (workspace: string, resultId: string) => join(workspace, '.beegame/workflow/foundation-revision/results', resultId)
async function temporary(run: (workspace: string) => Promise<void>) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'revision-publication-')))
  try { await run(workspace) } finally { await rm(workspace, { recursive: true, force: true }) }
}

test('publishes complete candidate atomically and replay/concurrency preserve canonical input bytes', async () => temporary(async workspace => {
  const candidate = fixture()
  await mkdir(join(workspace, 'docs'))
  const original = '# author original must remain unchanged'
  await writeFile(join(workspace, 'docs/GDD.md'), original)
  const [first, concurrent] = await Promise.all([
    publishRevisionDerivedCandidate(workspace, candidate), publishRevisionDerivedCandidate(workspace, candidate),
  ])
  expect(first).toEqual(concurrent)
  expect(await publishRevisionDerivedCandidate(workspace, candidate)).toEqual(first)
  expect(await readRevisionPublishedCandidate(workspace, candidate)).toEqual(candidate)
  expect(await readFile(join(workspace, 'docs/GDD.md'), 'utf8')).toBe(original)
  expect((await readdir(resultDirectory(workspace, candidate.resultId))).sort()).toEqual(['COMMITTED.json', 'result.json'])
  expect(first.artifactPath).toStartWith('.beegame/workflow/foundation-revision/results/')
  expect(JSON.parse(await readFile(join(workspace, first.artifactPath), 'utf8'))).toEqual(candidate)
}))

test('incomplete result is invisible and resumes only with identical bytes; committed corruption fails closed', async () => temporary(async workspace => {
  const candidate = fixture()
  expect(await readRevisionPublishedCandidate(workspace, candidate)).toBeUndefined()
  const root = resultDirectory(workspace, candidate.resultId)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'result.json'), revisionCanonicalJson(candidate))
  expect(await readRevisionPublishedCandidate(workspace, candidate)).toBeUndefined()
  await publishRevisionDerivedCandidate(workspace, candidate)
  await unlink(join(root, 'result.json'))
  await expect(readRevisionPublishedCandidate(workspace, candidate)).rejects.toThrow('incomplete')
  await writeFile(join(root, 'result.json'), '{}')
  await expect(readRevisionPublishedCandidate(workspace, candidate)).rejects.toThrow('binding')
  await expect(publishRevisionDerivedCandidate(workspace, candidate)).rejects.toThrow('conflict')
  expect(await readFile(join(root, 'result.json'), 'utf8')).toBe('{}')
}))

test('marker conflicts are never replaced and non-JSON submitted state is rejected before IO', async () => temporary(async workspace => {
  const candidate = fixture()
  const root = resultDirectory(workspace, candidate.resultId)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'COMMITTED.json'), '{}')
  await expect(publishRevisionDerivedCandidate(workspace, candidate)).rejects.toThrow('conflict')
  await expect(readRevisionPublishedCandidate(workspace, candidate)).rejects.toThrow('marker binding')
  expect(await readFile(join(root, 'COMMITTED.json'), 'utf8')).toBe('{}')
  const invalid = { ...candidate }
  let called = false
  Object.defineProperty(invalid, 'documents', { get() { called = true; return candidate.documents } })
  await expect(publishRevisionDerivedCandidate(join(workspace, 'absent'), invalid)).rejects.toThrow()
  expect(called).toBe(false)
}))

test('rejects symlink directories and file links without changing the link target', async () => temporary(async workspace => {
  const candidate = fixture()
  const foreign = join(workspace, 'foreign')
  await mkdir(foreign)
  await symlink(foreign, join(workspace, '.beegame'))
  await expect(publishRevisionDerivedCandidate(workspace, candidate)).rejects.toThrow('real directory')
  expect(await readdir(foreign)).toEqual([])
  await unlink(join(workspace, '.beegame'))
  const root = resultDirectory(workspace, candidate.resultId)
  await mkdir(root, { recursive: true })
  const target = join(foreign, 'target.json')
  await writeFile(target, '{}')
  await symlink(target, join(root, 'result.json'))
  await expect(publishRevisionDerivedCandidate(workspace, candidate)).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('{}')
  await expect(publishRevisionDerivedCandidate('relative', candidate)).rejects.toThrow('absolute')
  expect(await readdir(dirname(root))).toEqual([candidate.resultId])
}))

test('captures expected input before the first await and returns independent result copies', async () => temporary(async workspace => {
  const candidate = fixture()
  const expected = structuredClone(candidate)
  const pending = publishRevisionDerivedCandidate(workspace, candidate)
  candidate.documents[0]!.content = 'mutation after invocation'
  const published = await pending
  expect(published.result).toEqual(expected)
  published.result.documents[0]!.content = 'returned mutation'
  expect(await readRevisionPublishedCandidate(workspace, expected)).toEqual(expected)
}))
