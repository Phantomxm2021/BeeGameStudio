import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, lstat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { acceptRevisionRequest } from '../request-store'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-execution-lease-fault-')))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function request() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# execution lease fault fixture'
  const sourceResult = buildSingleReviewFixture({
    documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: {
      kind: 'initial',
      sourceResultId: 'author',
      sourceDocumentRevision: 'a'.repeat(64),
      confirmedBriefDigest: 'b'.repeat(64),
    },
  })
  return {
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'execution-lease-fault',
    sourceResult,
    sourceBinding: {
      ownerId: 'owner',
      projectId: 'project',
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

test('post-link directory fsync failure rolls back only the unpublished claim', async () => {
  const root = await workspace()
  const value = request()
  const accepted = await acceptRevisionRequest(root, value)
  const requestRoot = dirname(join(root, accepted.artifactPath))
  const ownerPath = join(requestRoot, 'execution-owner.json')
  const fixture = join(import.meta.dir, 'execution-lease-fault-fixture.ts')
  const child = Bun.spawn(
    [process.execPath, fixture, root, JSON.stringify(value)],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode).toBe(0)
  expect(stderr).toBe('')
  const result = JSON.parse(stdout.trim()) as { ok: boolean; injected?: boolean; ownerPath?: string; error?: string }
  expect(result).toEqual({ ok: true, ownerPath, injected: true })
  await expect(lstat(ownerPath)).rejects.toMatchObject({ code: 'ENOENT' })
  // The child has exited and its patched prototype has been restored before
  // this parent-side cleanup/inspection runs.
  expect(await Bun.file(ownerPath).exists()).toBe(false)
  expect(await readFile(join(root, accepted.artifactPath), 'utf8')).toContain('request_accepted')
})
