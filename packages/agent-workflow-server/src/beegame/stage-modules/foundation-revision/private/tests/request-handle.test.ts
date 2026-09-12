import { afterEach, expect, test } from 'bun:test'
import {
  mkdtemp,
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptRevisionRequest,
  readRevisionRequestByHandle,
} from '../request-store'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []

async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'revision-request-handle-')),
  )
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete handle fixture'
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
    requestId: 'request-handle',
    sourceResult,
    sourceBinding: {
      ownerId: 'owner',
      projectId: 'project',
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

function requestPath(root: string, request: ReturnType<typeof fixture>) {
  return join(
    root,
    '.beegame/workflow/foundation-revision/native-file-v1/requests',
    revisionDigest({
      ownerId: request.ownerId,
      projectId: request.projectId,
      requestId: request.requestId,
    }),
    'request.json',
  )
}

function handlePath(root: string, handle: string) {
  return join(
    root,
    '.beegame/workflow/foundation-revision/native-file-v1/handles',
    `${handle}.json`,
  )
}

test('initial acceptance creates a hardlinked opaque handle and repeated lookup re-prepares it', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  const lookedUp = await readRevisionRequestByHandle(
    root,
    accepted.record.handle,
    'owner',
  )
  expect(lookedUp).toEqual(accepted)
  expect(lookedUp.artifactPath).toBe(accepted.artifactPath)

  const canonical = await lstat(requestPath(root, request))
  const handle = await lstat(handlePath(root, accepted.record.handle))
  expect(handle.isFile()).toBe(true)
  expect(handle.ino).toBe(canonical.ino)
  expect(
    (await readRevisionRequestByHandle(root, accepted.record.handle, 'owner'))
      .record,
  ).toEqual(accepted.record)
  expect(accepted.record).not.toHaveProperty('credential')
  expect(accepted.record).not.toHaveProperty('token')
})

test('concurrent same-request acceptance converges on one handle and handle lookup', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await Promise.all(
    Array.from({ length: 8 }, () => acceptRevisionRequest(root, request)),
  )
  expect(new Set(accepted.map(value => value.record.handle)).size).toBe(1)
  expect(new Set(accepted.map(value => value.record.candidateId)).size).toBe(1)
  const first = accepted[0]!
  expect(
    await readRevisionRequestByHandle(root, first.record.handle, 'owner'),
  ).toEqual(first)
})

test('handle lookup rejects wrong or unknown owners and does not create a namespace while probing', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  await expect(
    readRevisionRequestByHandle(root, accepted.record.handle, 'other-owner'),
  ).rejects.toThrow()
  await expect(
    readRevisionRequestByHandle(
      root,
      '123e4567-e89b-42d3-a456-426614174000',
      'owner',
    ),
  ).rejects.toThrow()
  await expect(
    readRevisionRequestByHandle(root, 'not-a-uuid', 'owner'),
  ).rejects.toThrow()

  const emptyRoot = await workspace()
  await expect(
    readRevisionRequestByHandle(
      emptyRoot,
      '123e4567-e89b-42d3-a456-426614174000',
      'owner',
    ),
  ).rejects.toThrow()
  expect(await readdir(emptyRoot)).toEqual([])
})

test('tampered handle records fail closed and remain untouched', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  const path = handlePath(root, accepted.record.handle)
  await unlink(path)
  const tampered = { ...accepted.record, requestDigest: '0'.repeat(64) }
  const bytes = `${revisionCanonicalJson(tampered)}\n`
  await writeFile(path, bytes)
  await expect(
    readRevisionRequestByHandle(root, accepted.record.handle, 'owner'),
  ).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(bytes)
  expect(await readFile(requestPath(root, request), 'utf8')).toBe(
    `${revisionCanonicalJson(accepted.record)}\n`,
  )
})

test('canonical request mismatch is rejected without healing either record', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  const canonicalPath = requestPath(root, request)
  const originalHandleBytes = await readFile(
    handlePath(root, accepted.record.handle),
    'utf8',
  )
  const tampered = {
    ...accepted.record,
    candidateId: '123e4567-e89b-42d3-a456-426614174000',
  }
  const canonicalBytes = `${revisionCanonicalJson(tampered)}\n`
  await unlink(canonicalPath)
  await writeFile(canonicalPath, canonicalBytes)
  await expect(
    readRevisionRequestByHandle(root, accepted.record.handle, 'owner'),
  ).rejects.toThrow()
  expect(await readFile(canonicalPath, 'utf8')).toBe(canonicalBytes)
  expect(await readFile(handlePath(root, accepted.record.handle), 'utf8')).toBe(
    originalHandleBytes,
  )
})

test('handle symlinks are refused without following or modifying their target', async () => {
  const root = await workspace()
  const request = fixture()
  const accepted = await acceptRevisionRequest(root, request)
  const path = handlePath(root, accepted.record.handle)
  const target = join(root, 'foreign.json')
  const bytes = 'foreign sentinel\n'
  await writeFile(target, bytes)
  await unlink(path)
  await symlink(target, path)
  await expect(
    readRevisionRequestByHandle(root, accepted.record.handle, 'owner'),
  ).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe(bytes)
})
