import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoundationReviewer, foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerHandle } from '../../public'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { offlineReviewerBilling } from '../test-fixtures/offline-billing'

function inputs() {
  const { input: authority } = firstCandidateFixture()
  const identity = { ownerId: authority.sourceBinding.ownerId, projectId: authority.sourceBinding.projectId }
  const documents = reviewFixtureDocuments(); documents[0]!.content = '# incomplete\n'
  const initial = { protocolVersion: 1 as const, ...identity, requestId: 'initial', input: { documents,
    subject: { kind: 'initial' as const, sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } } }
  const candidate = { protocolVersion: 1 as const, ...identity, requestId: 'candidate', input: { kind: 'first' as const, ...authority } }
  return { initial: { ...initial, inputDigest: foundationReviewerInputDigest(initial) }, candidate: { ...candidate, inputDigest: foundationReviewerInputDigest(candidate) } }
}
async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-public-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function complete(api: ReturnType<typeof createFoundationReviewer>, handle: ReviewerHandle) {
  const end = Date.now() + 25_000
  while (Date.now() < end) {
    const result = await api.getResult(handle)
    if (result.status === 'completed' && result.billingStatus === 'settled') return result
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('public Reviewer did not complete')
}
function infrastructure(ownerId: string) {
  return { billing: offlineReviewerBilling(ownerId).client, runtimeConfiguration: { protocolVersion: 1 as const, ownerId, async resolve() {
    return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), '--fixture-mode=targeted-pass'],
      env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } }
  } } }
}

test('one public Reviewer owns initial and candidate calls without leaking internal operations', async () => fixture(async workspacePath => {
  const input = inputs()
  const clients = infrastructure(input.initial.ownerId)
  const api = createFoundationReviewer({ workspacePath }, clients)
  expect(Object.keys(api).sort()).toEqual(['getResult', 'resume', 'start', 'stop'])
  const initialHandle = await api.start(input.initial)
  const initial = await complete(api, initialHandle)
  expect(initial.result.issues[0]!.issue.reasonCode).toBe('DOCUMENT_FORMAT_INVALID')
  const candidateHandle = await api.start(input.candidate)
  const candidate = await complete(api, candidateHandle)
  if (candidate.result.recheck?.kind !== 'targeted') throw new Error('targeted evidence missing')
  expect(candidate.result.recheck!.decision).toBe('round_complete')
  expect(candidateHandle).not.toEqual(initialHandle)
  expect(Object.keys(candidateHandle).sort()).toEqual(['id', 'producer', 'protocolVersion'])
  const reopened = createFoundationReviewer({ workspacePath }, { ...clients, runtimeConfiguration: { ...clients.runtimeConfiguration, async resolve() { throw new Error('lookup cannot execute') } } })
  expect(await reopened.getResult(initialHandle)).toEqual(initial)
  expect(await reopened.getResult(candidateHandle)).toEqual(candidate)
}), 35_000)

test('public factory rejects private capabilities and sanitizes invalid input or foreign-handle errors', async () => fixture(async workspacePath => {
  const input = inputs()
  const clients = infrastructure(input.initial.ownerId)
  expect(() => createFoundationReviewer({ workspacePath, model: { command: ['untrusted'] } } as never, clients)).toThrow()
  expect(() => createFoundationReviewer({ workspacePath }, { ...clients, admitWorker: () => {} } as never)).toThrow()
  const api = createFoundationReviewer({ workspacePath }, clients)
  await expect(api.start({ ...input.initial, privateState: {} } as ReviewerStartInput)).rejects.toThrow('Reviewer operation could not be accepted or safely completed')
  const handle = await api.start(input.initial)
  await complete(api, handle)
  const foreign = createFoundationReviewer({ workspacePath }, infrastructure('foreign'))
  await expect(foreign.getResult(handle)).rejects.toThrow('Reviewer operation could not be accepted or safely completed')
  await expect(api.start({ ...input.candidate, requestId: input.initial.requestId })).rejects.toThrow('Reviewer operation could not be accepted or safely completed')
}), 35_000)
