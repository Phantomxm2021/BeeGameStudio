import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile, lstat, unlink, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { acceptRevisionRequest } from '../request-store'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { openRevisionExecutionLease } from '../execution-lease'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const roots: string[] = []

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-execution-lease-')))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function request() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# execution lease fixture'
  const sourceResult = buildReviewerPublishedResult({
    documents,
    state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: {
      kind: 'initial',
      sourceResultId: 'author',
      sourceDocumentRevision: 'a'.repeat(64),
      confirmedBriefDigest: 'b'.repeat(64),
    },
  })
  return {
    kind: 'initial' as const,
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'execution-lease',
    sourceResult,
    sourceBinding: {
      ownerId: 'owner',
      projectId: 'project',
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

async function acceptedRoot(root: string, value: ReturnType<typeof request>) {
  const accepted = await acceptRevisionRequest(root, value)
  return { accepted, root: dirname(join(root, accepted.artifactPath)), path: join(root, accepted.artifactPath, '..', 'execution-owner.json') }
}

describe('Revision execution owner lease', () => {
  test('concurrent instances have exactly one owner, then release permits reacquire', async () => {
    const root = await workspace()
    const value = request()
    const leases = await Promise.all(Array.from({ length: 8 }, () => openRevisionExecutionLease(root, value)))
    const results = await Promise.all(leases.map(lease => lease.acquire()))
    expect(results.filter(result => result.kind === 'owned')).toHaveLength(1)
    expect(results.filter(result => result.kind === 'busy')).toHaveLength(7)
    const owner = results.find(result => result.kind === 'owned')
    if (owner?.kind !== 'owned') throw new Error('missing owner')
    await owner.assertOwned()
    await Promise.all([owner.release(), owner.release()])
    expect(await leases[0]!.status()).toBe('free')
    const reacquired = await leases[1]!.acquire()
    expect(reacquired.kind).toBe('owned')
    if (reacquired.kind === 'owned') {
      await owner.release()
      await reacquired.assertOwned()
      await reacquired.release()
    }
  })

  test('foreign token or tampering refuses assertion and release without healing', async () => {
    const root = await workspace()
    const value = request()
    const lease = await openRevisionExecutionLease(root, value)
    const acquired = await lease.acquire()
    if (acquired.kind !== 'owned') throw new Error('missing owner')
    const { accepted, path } = await acceptedRoot(root, value)
    const original = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const tampered = { ...original, ownerToken: '123e4567-e89b-42d3-a456-426614174000' }
    const bytes = `${revisionCanonicalJson(tampered)}\n`
    await writeFile(path, bytes)
    await expect(acquired.assertOwned()).rejects.toThrow()
    await expect(acquired.release()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(accepted.record.handle).toBe(original.handle as string)
  })

  test('symlink owner record fails closed and does not modify target', async () => {
    const root = await workspace()
    const value = request()
    const lease = await openRevisionExecutionLease(root, value)
    const acquired = await lease.acquire()
    if (acquired.kind !== 'owned') throw new Error('missing owner')
    const { path } = await acceptedRoot(root, value)
    const target = join(root, 'sentinel.json')
    const sentinel = 'do not modify\n'
    await writeFile(target, sentinel)
    await unlink(path)
    await symlink(target, path)
    await expect(acquired.assertOwned()).rejects.toThrow()
    await expect(acquired.release()).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe(sentinel)
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
  })

  test('stale pid is observable but never taken over or deleted', async () => {
    const root = await workspace()
    const value = request()
    const first = await openRevisionExecutionLease(root, value)
    const acquired = await first.acquire()
    if (acquired.kind !== 'owned') throw new Error('missing owner')
    const { path } = await acceptedRoot(root, value)
    const original = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const stale = { ...original, pid: 999999999 }
    const bytes = `${revisionCanonicalJson(stale)}\n`
    await writeFile(path, bytes)

    expect(await first.status()).toBe('stale')
    const second = await openRevisionExecutionLease(root, value)
    expect(await second.acquire()).toEqual({ kind: 'stale' })
    expect(await readFile(path, 'utf8')).toBe(bytes)
  })

  test('read-only handle observes but cannot acquire or create an owner', async () => {
    const root = await workspace()
    const value = request()
    const accepted = await acceptRevisionRequest(root, value)
    const lease = await openRevisionExecutionLease(root, value, { readOnlyHandle: accepted.record.handle })
    expect(await lease.status()).toBe('free')
    await expect(lease.acquire()).rejects.toThrow('read-only')
  })
})
