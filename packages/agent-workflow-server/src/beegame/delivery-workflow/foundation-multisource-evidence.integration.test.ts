import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  createFoundationReviewer,
  foundationReviewerInputDigest,
} from '../stage-modules/foundation-reviewer/public'
import {
  createFoundationRevision,
  foundationRevisionInputDigest,
} from '../stage-modules/foundation-revision/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-revision/private/tests/single-review-fixture'
import { offlineReviewerBilling } from '../stage-modules/foundation-reviewer/private/test-fixtures/offline-billing'

const digest = (value: unknown) => {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype)
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(',')}}`
    throw new Error('fixture digest requires finite JSON')
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function runtime(command: string[], env: Record<string, string>) {
  return { protocolVersion: 1 as const, ownerId: 'multisource-owner', async resolve() {
    return { command, env }
  } }
}

async function waitReviewer(api: ReturnType<typeof createFoundationReviewer>, handle: Awaited<ReturnType<ReturnType<typeof createFoundationReviewer>['start']>>) {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    let result: Awaited<ReturnType<typeof api.getResult>>
    try { result = await api.getResult(handle) } catch { await pause(20); continue }
    if (result.status === 'completed' && result.billingStatus === 'settled') return result
    if (result.status === 'needs_action') throw new Error(`Reviewer fixture stopped: ${result.reason}`)
    await pause(10)
  }
  throw new Error('Reviewer fixture did not settle')
}

async function waitRevision(api: ReturnType<typeof createFoundationRevision>, handle: Awaited<ReturnType<ReturnType<typeof createFoundationRevision>['start']>>) {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    let result: Awaited<ReturnType<typeof api.getResult>>
    try { result = await api.getResult(handle) } catch { await pause(20); continue }
    if (result.status === 'completed' && result.billingStatus === 'settled') return result
    if (result.status === 'needs_action') throw new Error(`Revision fixture stopped: ${result.reason}`)
    await pause(10)
  }
  throw new Error('Revision fixture did not settle')
}

test('multi-source semantic evidence crosses public Reviewer → Revision → full Reviewer boundaries', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'multisource-evidence-')))
  const ownerId = 'multisource-owner'
  const projectId = 'multisource-project'
  const brief = 'multi-source evidence fixture'
  const reviewerBilling = offlineReviewerBilling(ownerId)
  const revisionBilling = offlineReviewerBilling(ownerId)
  const reviewerCommand = [process.execPath, fileURLToPath(new URL('./test-fixtures/foundation-multisource-evidence-reviewer.ts', import.meta.url)), '--fixture-mode=initial']
  const reviewer = createFoundationReviewer({ workspacePath }, {
    billing: reviewerBilling.client,
    runtimeConfiguration: runtime(reviewerCommand, {
      BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
      OPENAI_DEFAULT_SONNET_MODEL: 'fixture-fast', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong',
    }),
  })
  const documents = reviewFixtureDocuments().map(document => ({
    ...document, content: document.content + (document.path === 'docs/LEVEL_SCENE_DESIGN.md' ? '\\nroute_choice_contract: missing\\n'
      : document.path === 'docs/GDD.md' ? '\\nPlayer actions: choose a route.\\nRules: route choices must be readable.\\n' : ''),
  }))
  const requirements = { status: 'available' as const, content: brief, digest: createHash('sha256').update(brief).digest('hex') }
  const initialInput = { ownerId, projectId, requestId: 'multisource-review', protocolVersion: 1 as const,
    input: { documents, requirements, subject: { kind: 'initial' as const, sourceResultId: 'author-fixture',
      sourceDocumentRevision: digest('author-fixture'), confirmedBriefDigest: requirements.digest } } }
  const initial = { ...initialInput, inputDigest: foundationReviewerInputDigest(initialInput) }
  try {
    const reviewHandle = await reviewer.start(initial)
    const review = await waitReviewer(reviewer, reviewHandle)
    if (review.status !== 'completed' || !review.result) throw new Error('initial Reviewer result missing')
    expect(review.result.kind).toBe('issues_found')
    expect(review.result.issues).toHaveLength(1)
    const sourceIssue = review.result.issues[0]!
    expect(sourceIssue.issue.source.documentPath).toBe('docs/LEVEL_SCENE_DESIGN.md')
    expect(sourceIssue.issue).not.toHaveProperty('remediation')
    expect(sourceIssue.issue).not.toHaveProperty('evidence')
    expect(review.result.requirements).toEqual(requirements)
    expect(review.result.documents).toHaveLength(8)

    const sourceResult = review.result
    const sourceBinding = { ownerId, projectId, resultId: sourceResult.resultId, resultDigest: digest(sourceResult) }
    const revisionCommand = [process.execPath, fileURLToPath(new URL('./test-fixtures/foundation-multisource-evidence-revision.ts', import.meta.url))]
    const revision = createFoundationRevision({ workspacePath }, {
      billing: revisionBilling.client,
      runtimeConfiguration: runtime(revisionCommand, { OPENAI_API_KEY: 'offline-fixture' }),
    })
    const revisionInput = { ownerId, projectId, requestId: 'multisource-revision', input: {
      sourceResult, sourceBinding,
    } }
    const revisionStart = { ...revisionInput, protocolVersion: 1 as const, inputDigest: foundationRevisionInputDigest({
      ownerId, projectId, input: revisionInput.input,
    }) }
    const revisionHandle = await revision.start(revisionStart)
    const revised = await waitRevision(revision, revisionHandle)
    if (revised.status !== 'completed' || !revised.result) throw new Error('public Revision result missing')
    const candidate = revised.result
    expect(candidate.revisionSummary).toContain('multi-source')
    expect(candidate.documents.find(document => document.path === 'docs/LEVEL_SCENE_DESIGN.md')!.content).toContain('route_choice_contract: readable')
    for (const document of sourceResult.documents.filter(document => document.path !== 'docs/LEVEL_SCENE_DESIGN.md'))
      expect(candidate.documents.find(item => item.path === document.path)!.digest).toBe(document.digest)
    expect(sourceResult.documents.find(document => document.path === 'docs/LEVEL_SCENE_DESIGN.md')!.content).toContain('route_choice_contract: missing')

    const candidateInput = { ownerId, projectId, requestId: 'multisource-full-review', input: {
      documents: candidate.documents.map(({ path, content }) => ({ path, content })), requirements,
      subject: { kind: 'candidate' as const, candidateId: candidate.candidateId, candidateResultId: candidate.resultId,
        sourceReviewResultId: sourceResult.resultId, sourceReviewResultDigest: digest(sourceResult),
        baseDocumentSetDigest: sourceResult.documentSetDigest, round: candidate.round },
    } }
    const targetedReviewer = createFoundationReviewer({ workspacePath }, {
      billing: reviewerBilling.client,
      runtimeConfiguration: runtime([
        process.execPath,
        fileURLToPath(new URL('./test-fixtures/foundation-multisource-evidence-reviewer.ts', import.meta.url)),
        '--fixture-mode=targeted',
      ], { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-strong', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' }),
    })
    const candidateStart = { ...candidateInput, protocolVersion: 1 as const, inputDigest: foundationReviewerInputDigest(candidateInput) }
    const targetedHandle = await targetedReviewer.start(candidateStart)
    const targeted = await waitReviewer(targetedReviewer, targetedHandle)
    if (targeted.status !== 'completed' || !targeted.result) throw new Error('targeted Reviewer result missing')
    expect(targeted.result.kind).toBe('passed')
    expect(targeted.result.documents).toHaveLength(8)
    expect(targeted.result.requirements).toEqual(requirements)
    expect(targeted.result.issues).toEqual([])
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
}, 120_000)
