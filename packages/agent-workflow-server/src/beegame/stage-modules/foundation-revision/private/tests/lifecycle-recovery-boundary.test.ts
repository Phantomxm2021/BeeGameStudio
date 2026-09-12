import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createFoundationRevision } from '../../public'
import { acceptRevisionRequest } from '../request-store'
import { openRevisionAttemptStore } from '../attempt-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-recovery-boundary-')))
  roots.push(root)
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const request = { ownerId: 'owner', projectId: 'project', requestId: 'recovery-boundary', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  const accepted = await acceptRevisionRequest(root, request)
  const store = await openRevisionAttemptStore(root, request)
  let calls = 0
  const stage = createFoundationRevision({ workspacePath: root }, {
    runtimeConfiguration: { protocolVersion: 1, ownerId: 'owner', async resolve() { calls++; throw new Error('must not dispatch') } },
    billing: { protocolVersion: 1, ownerId: 'owner', async submitUsage() { calls++; throw new Error('must not bill unknown active usage') } },
  })
  const handle = { protocolVersion: 1 as const, producer: 'foundation-revision' as const, id: accepted.record.handle }
  return { root, request, accepted, store, stage, handle, calls: () => calls }
}
async function bytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) for (const [name, value] of Object.entries(await bytes(join(root, entry.name)))) result[`${entry.name}/${name}`] = value
    else result[entry.name] = await readFile(join(root, entry.name), 'utf8')
  }
  return result
}

test('public reads and resume cannot turn a lost owner and unclosed attempt into retry authority', async () => {
  const { root, request, accepted, store, stage, handle, calls } = await fixture()
  const attempt = await store.begin()
  const leases = await openRevisionExecutionLease(root, request)
  const acquired = await leases.acquire()
  if (acquired.kind !== 'owned') throw new Error('fixture owner missing')
  // An offline journal fixture, not a claim that a real process was cleaned.
  const ownerPath = join(dirname(join(root, accepted.artifactPath)), 'execution-owner.json')
  const owner = JSON.parse(await readFile(ownerPath, 'utf8'))
  const staleBytes = `${revisionCanonicalJson({ ...owner, pid: 999999999 })}\n`
  await writeFile(ownerPath, staleBytes)
  const before = await bytes(root)
  expect(await stage.getResult(handle)).toMatchObject({ status: 'needs_action', resumable: false, billingStatus: 'pending' })
  expect(await bytes(root)).toEqual(before)
  expect(await stage.resume({ handle, requestId: 'cannot-adopt' })).toMatchObject({ status: 'needs_action', resumable: false })
  expect(await stage.stop({ handle, requestId: 'stop-lost', reason: 'user_requested' })).toMatchObject({ status: 'needs_action', resumable: false })
  await expect(stage.resume({ handle, requestId: 'stop-lost' })).rejects.toThrow('could not be accepted')
  expect((await store.read()).active?.attemptId).toBe(attempt.attemptId)
  expect((await store.read()).lastReceipt).toBeNull()
  expect(await readFile(ownerPath, 'utf8')).toBe(staleBytes)
  expect(calls()).toBe(0)
})

test('billing cleanup failure cannot overwrite the primary execution failure', async () => {
  const { store, stage, handle, calls } = await fixture()
  await store.recordFailure('configuration_failed')
  await store.recordFailure('billing_failed')
  expect((await store.readRequest()).failure).toBe('configuration_failed')
  expect(await stage.getResult(handle)).toMatchObject({ status: 'needs_action', resumable: true,
    reason: 'Execution authorization or runtime configuration is unavailable.' })
  expect(calls()).toBe(0)
})
