import { expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFoundationReviewer,
  foundationReviewerInputDigest,
  type ReviewerHandle,
} from '../../../foundation-reviewer/public'
import {
  createFoundationRevision,
  foundationRevisionInputDigest,
  type RevisionHandle,
} from '../../public'
import { openReviewerFactJournal } from '../../../foundation-reviewer/private/fact-journal'
import { reviewerDigest } from '../../../foundation-reviewer/private/review-summary'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { offlineReviewerBilling } from '../../../foundation-reviewer/private/test-fixtures/offline-billing'
import { prepareReviewerCandidateInput } from '../../../foundation-reviewer/private/candidate-contract'
import { reviewerCandidateSubject } from '../../../foundation-reviewer/private/targeted-preparation'
import { revisionDigest } from '../json-digest'
import { openRevisionExecutionLease } from '../execution-lease'
import { readRevisionRequestByHandle } from '../request-store'

const ownerId = 'handoff-owner'
const projectId = 'handoff-project'

async function waitReviewer(
  api: ReturnType<typeof createFoundationReviewer>,
  handle: ReviewerHandle,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout
  let latest: Awaited<ReturnType<typeof api.getResult>> | undefined
  while (Date.now() < deadline) {
    latest = await api.getResult(handle)
    if (latest.status === 'completed' && latest.billingStatus === 'settled') return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`public Reviewer did not complete: ${latest?.status ?? 'unknown'}`)
}

async function waitRevision(
  api: ReturnType<typeof createFoundationRevision>,
  handle: RevisionHandle,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout
  let latest: Awaited<ReturnType<typeof api.getResult>> | undefined
  while (Date.now() < deadline) {
    latest = await api.getResult(handle)
    if (latest.status === 'completed' && latest.billingStatus === 'settled') return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`public Revision did not complete: ${latest?.status ?? 'unknown'}`)
}

async function waitFree(read: () => Promise<'free' | 'busy' | 'stale'>, label: string) {
  const deadline = Date.now() + 5_000
  let status: Awaited<ReturnType<typeof read>> = 'busy'
  while (Date.now() < deadline) {
    status = await read()
    if (status === 'free') return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`${label} execution lease did not close: ${status}`)
}

function reviewerRuntime(owner: string, mode: string) {
  return {
    protocolVersion: 1 as const,
    ownerId: owner,
    async resolve() {
      return {
        command: [
          process.execPath,
          join(import.meta.dir, '../../../foundation-reviewer/private/test-fixtures/native-reviewer.ts'),
          `--fixture-mode=${mode}`,
        ],
        env: {
          BEEGAME_MODEL_TYPE: 'openai',
          OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
          OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced',
          OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong',
        },
      }
    },
  }
}

test('public Reviewer -> Revision -> Reviewer handoff keeps each stage independently authoritative', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'public-review-revision-handoff-')))
  const malformedDocuments = reviewFixtureDocuments(true)
  malformedDocuments[0]!.content = '# incomplete'
  const repairedDocuments = reviewFixtureDocuments(true)
  const originalDocuments = structuredClone(malformedDocuments)
  const subject = {
    kind: 'initial' as const,
    sourceResultId: 'author-result',
    sourceDocumentRevision: 'a'.repeat(64),
    confirmedBriefDigest: 'b'.repeat(64),
  }
  const initialInput = {
    protocolVersion: 1 as const,
    requestId: 'review-initial',
    ownerId,
    projectId,
    input: { documents: malformedDocuments, subject },
    inputDigest: foundationReviewerInputDigest({
      ownerId,
      projectId,
      input: { documents: malformedDocuments, subject },
    }),
  }
  const initialBilling = offlineReviewerBilling(ownerId)
  const initialReviewer = createFoundationReviewer(
    { workspacePath },
    {
      billing: initialBilling.client,
      runtimeConfiguration: {
        ...reviewerRuntime(ownerId, 'success'),
        async resolve() {
          throw new Error('format-only initial review must not execute a worker')
        },
      },
    },
  )
  let initialHandle: ReviewerHandle | undefined
  let revisionHandle: RevisionHandle | undefined
  let candidateHandle: ReviewerHandle | undefined
  const cleanup: (() => Promise<void>)[] = []
  try {
    initialHandle = await initialReviewer.start(initialInput)
    cleanup.push(async () => {
      await initialReviewer.stop({ handle: initialHandle!, requestId: 'cleanup-initial', reason: 'shutdown' })
      const journal = await openReviewerFactJournal({ workspacePath,
        identity: { ownerId, projectId, requestId: initialInput.requestId }, documents: initialInput.input.documents,
        binding: { inputDigest: initialInput.inputDigest, subject }, readOnly: true })
      await waitFree(() => journal.leaseStatus(), 'initial Reviewer')
    })
    const initial = await waitReviewer(initialReviewer, initialHandle)
    expect(initial.status).toBe('completed')
    if (initial.status !== 'completed') throw new Error('initial Reviewer result is unavailable')
    expect(initial.result.kind).toBe('issues_found')
    expect(initial.result.issues).toHaveLength(1)
    expect(initial.result.issues[0]!.issue.reasonCode).toBe('DOCUMENT_FORMAT_INVALID')
    expect(initialBilling.recorded.size).toBe(0)

    const revisionSourceBinding = {
      ownerId,
      projectId,
      resultId: initial.result.resultId,
      resultDigest: revisionDigest(initial.result),
    }
    const revisionInput = {
      kind: 'initial' as const,
      sourceResult: initial.result,
      sourceBinding: revisionSourceBinding,
    }
    const revisionStart = {
      protocolVersion: 1 as const,
      requestId: 'revision-initial',
      ownerId,
      projectId,
      input: revisionInput,
      inputDigest: foundationRevisionInputDigest({ ownerId, projectId, input: revisionInput }),
    }
    const revisionBilling = offlineReviewerBilling(ownerId)
    const revision = createFoundationRevision(
      { workspacePath },
      {
        billing: revisionBilling.client,
        runtimeConfiguration: {
          protocolVersion: 1,
          ownerId,
          async resolve() {
            return {
              command: [
                process.execPath,
                join(import.meta.dir, 'owned-attempt-fixture.ts'),
                'valid',
                Buffer.from(repairedDocuments[0]!.content).toString('base64'),
              ],
              env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' },
            }
          },
        },
      },
    )
    revisionHandle = await revision.start(revisionStart)
    cleanup.push(async () => {
      await revision.stop({ handle: revisionHandle!, requestId: 'cleanup-revision', reason: 'shutdown' })
      const registration = await readRevisionRequestByHandle(workspacePath, revisionHandle!.id, ownerId)
      const leases = await openRevisionExecutionLease(workspacePath, registration.prepared.request, { readOnlyHandle: revisionHandle!.id })
      await waitFree(() => leases.status(), 'Revision')
    })
    const revised = await waitRevision(revision, revisionHandle)
    expect(revised.status).toBe('completed')
    if (revised.status !== 'completed') throw new Error('Revision candidate is unavailable')
    expect(revised.result.kind).toBe('candidate_ready')
    expect('verdict' in revised.result).toBe(false)
    expect(revised.result.sourceReviewResultId).toBe(initial.result.resultId)
    expect(revised.result.sourceReviewResultDigest).toBe(reviewerDigest(initial.result))
    expect(revised.result.documents.find(document => document.path === 'docs/GDD.md')!.content)
      .toBe(repairedDocuments[0]!.content.trim())

    const candidateInput = {
      kind: 'first' as const,
      sourceResult: initial.result,
      sourceBinding: {
        ownerId,
        projectId,
        resultId: initial.result.resultId,
        resultDigest: reviewerDigest(initial.result),
      },
      candidateResult: revised.result,
      candidateBinding: {
        ownerId,
        projectId,
        resultId: revised.result.resultId,
        resultDigest: reviewerDigest(revised.result),
      },
    }
    const candidateStart = {
      protocolVersion: 1 as const,
      requestId: 'review-candidate',
      ownerId,
      projectId,
      input: candidateInput,
      inputDigest: foundationReviewerInputDigest({ ownerId, projectId, input: candidateInput }),
    }
    const candidateBilling = offlineReviewerBilling(ownerId)
    const candidateReviewer = createFoundationReviewer(
      { workspacePath },
      { billing: candidateBilling.client, runtimeConfiguration: reviewerRuntime(ownerId, 'success') },
    )
    candidateHandle = await candidateReviewer.start(candidateStart)
    cleanup.push(async () => {
      await candidateReviewer.stop({ handle: candidateHandle!, requestId: 'cleanup-candidate', reason: 'shutdown' })
      // Private reads are solely cleanup probes; all stage execution and
      // handoff above/below use public operations and copied public results.
      const prepared = prepareReviewerCandidateInput(candidateInput)
      const journal = await openReviewerFactJournal({ workspacePath,
        identity: { ownerId, projectId, requestId: candidateStart.requestId }, documents: prepared.documents,
        binding: { inputDigest: candidateStart.inputDigest, subject: reviewerCandidateSubject(prepared) }, readOnly: true })
      await waitFree(() => journal.leaseStatus(), 'candidate Reviewer')
    })
    const candidate = await waitReviewer(candidateReviewer, candidateHandle, 90_000)
    expect(candidate.status).toBe('completed')
    if (candidate.status !== 'completed') throw new Error('candidate Reviewer result is unavailable')
    expect(candidate.result.subject.kind).toBe('candidate')
    expect(candidate.result.producer).toBe('foundation-reviewer')
    expect(candidate.result.recheck?.kind).toBe('full_format')
    expect(candidate.result.documents.map(document => document.content)).toEqual(
      repairedDocuments.map(document => document.path === 'docs/GDD.md' ? document.content.trim() : document.content),
    )
    expect(candidateBilling.recorded.size).toBe(10)
    expect(malformedDocuments).toEqual(originalDocuments)
    expect((await readdir(workspacePath)).sort()).toEqual(['.beegame'])
    expect(await initialReviewer.start(initialInput)).toEqual(initialHandle)
    expect(await revision.start(revisionStart)).toEqual(revisionHandle)
    expect(await candidateReviewer.start(candidateStart)).toEqual(candidateHandle)
    expect(await initialReviewer.getResult(initialHandle)).toEqual(initial)
    expect(await revision.getResult(revisionHandle)).toEqual(revised)
    expect(await candidateReviewer.getResult(candidateHandle)).toEqual(candidate)

  } finally {
    const closed = await Promise.allSettled(cleanup.map(close => close()))
    if (closed.some(result => result.status === 'rejected')) throw new Error('Handoff fixture cleanup is not confirmed; workspace retained')
    await rm(workspacePath, { recursive: true, force: true })
  }
}, 150_000)
