import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-reviewer/private/test-fixtures/review-documents'
import {
  buildSingleReviewResult,
  singleReviewInputDigest,
} from '../stage-modules/foundation-reviewer/private/single-agent-publication'
import type {
  GameIrHandle,
  GameIrOperations,
  GameIrReadyResult,
  GameIrResult,
} from '../stage-modules/game-ir/public'
import { foundationPublicDigest } from '../foundation-public-result'
import { acceptedIrInput, createGameIrLink } from './game-ir-link'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { parseDeliveryRun } from './schema'
import type { DeliveryRun } from './types'

const digest = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('timed out waiting for IR handoff')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function fixtureHandle(): GameIrHandle {
  return {
    protocolVersion: 1,
    producer: 'game-ir',
    id: digest('game-ir-handle'),
  }
}

function acceptedReview(
  summary = 'Accepted Game IR fixture',
): ReviewerReviewResult {
  const brief = 'Confirmed requirements for the Game IR link fixture.'
  const documents = reviewFixtureDocuments()
  const input = {
    subject: {
      kind: 'initial' as const,
      sourceResultId: 'author-result',
      sourceDocumentRevision: digest('published author revision'),
      confirmedBriefDigest: digest(brief),
    },
    requirements: {
      status: 'available' as const,
      content: brief,
      digest: digest(brief),
    },
    documents,
  }
  const start = {
    protocolVersion: 1 as const,
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'review-request',
    input,
    inputDigest: singleReviewInputDigest({
      ownerId: 'owner',
      projectId: 'project',
      input,
    }),
  }
  return buildSingleReviewResult(start, { summary }) as ReviewerReviewResult
}

async function fixture() {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'game-ir-link-')),
  )
  const review = acceptedReview()
  const brief = 'Confirmed requirements for the Game IR link fixture.'
  const authorResultId = 'a'.repeat(64)
  const authorHandleId = randomUUID()
  const authorInputDigest = digest('author input')
  const authorResult = {
    protocolVersion: 1 as const,
    producer: 'foundation-authoring' as const,
    kind: 'foundation_documents' as const,
    resultId: authorResultId,
    inputDigest: authorInputDigest,
    ownerId: 'owner',
    projectId: 'project',
    confirmedBriefDigest: digest(brief),
    documents: review.documents.map(document => ({
      path: document.path,
      digest: digest(document.content),
      byteLength: Buffer.byteLength(document.content, 'utf8'),
      artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${authorResultId}/${document.path}`,
    })),
    documentRevision: digest('author revision'),
    workspaceRevision: digest('author workspace revision'),
    receiptSetDigest: digest('author receipt set'),
  }
  const run: DeliveryRun = {
    ...createInitialDeliveryRun({
      runId: 'run-game-ir-link',
      ownerId: 'owner',
      projectId: 'project',
      confirmedBriefContext: brief,
      confirmedBriefDigest: digest(brief),
      documentRevision: review.documentSetDigest,
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    authorStage: {
      protocolVersion: 1,
      requestId: 'author-request',
      inputDigest: authorInputDigest,
      handle: {
        protocolVersion: 1,
        producer: 'foundation-authoring',
        id: authorHandleId,
      },
      status: 'completed',
      result: authorResult,
      control: { sequence: 0, action: 'run', requestId: 'author-request' },
    },
    foundationReviewStage: {
      protocolVersion: 1,
      authorResultId,
      control: { sequence: 0, appliedSequence: 0, action: 'run' },
      invocation: {
        stage: 'reviewer',
        handle: {
          protocolVersion: 1,
          producer: 'foundation-reviewer',
          id: authorHandleId,
        },
        request: {
          protocolVersion: 1,
          ownerId: 'owner',
          projectId: 'project',
          requestId: 'review-request',
          input: {
            subject: {
              kind: 'initial',
              sourceResultId: 'author-result',
              sourceDocumentRevision: digest('published author revision'),
              confirmedBriefDigest: digest(brief),
            },
            requirements: {
              status: 'available',
              content: brief,
              digest: digest(brief),
            },
            documents: review.documents.map(document => ({
              path: document.path,
              content: document.content,
            })),
          },
          inputDigest: review.inputDigest,
        },
        outcome: {
          status: 'completed',
          billingStatus: 'settled',
          handle: {
            protocolVersion: 1,
            producer: 'foundation-reviewer',
            id: authorHandleId,
          },
          result: review,
        },
      },
      acceptedReview: review,
    },
  }
  const store = createRunStore(workspace, run.ownerId)
  await store.commit(run, {
    runId: run.runId,
    type: 'run.created',
    phase: run.phase,
    status: run.status,
    revision: run.revision,
  })
  return { workspace, run, store, review }
}

function running(handle: GameIrHandle): GameIrResult {
  return { status: 'running', handle, billingStatus: 'settled' }
}

function stopped(handle: GameIrHandle): GameIrResult {
  return { status: 'stopped', handle, billingStatus: 'pending' }
}

function completed(
  handle: GameIrHandle,
  ready: GameIrReadyResult,
): GameIrResult {
  return {
    status: 'completed',
    handle,
    billingStatus: 'settled',
    result: ready,
  }
}

function readyReceipt(
  source: ReturnType<typeof acceptedIrInput>,
  marker: string,
): GameIrReadyResult {
  return {
    schemaVersion: 'game-ir-ready-receipt.v2' as const,
    taskId: 'game-ir-task',
    publicationId: `ir-publication-${marker}`,
    gameIrSchemaVersion: 'game-ir.v2' as const,
    foundationRevision: source.publishedDocumentRevision,
    foundationReceiptDigest: digest(`foundation-receipt-${marker}`),
    candidateDigest: digest(`candidate-${marker}`),
    manifestDigest: digest(`manifest-${marker}`),
    committedPath: `.beegame/ir/game-ir.v2/revisions/${source.publishedDocumentRevision}/COMMITTED.json`,
  }
}

function irPort(input: {
  source: ReturnType<typeof acceptedIrInput>
  ready?: GameIrReadyResult
  firstResult?: GameIrResult
}) {
  const handle: GameIrHandle = {
    protocolVersion: 1,
    producer: 'game-ir',
    id: digest('game-ir-handle'),
  }
  const ready = input.ready ?? readyReceipt(input.source, 'one')
  let outcome = input.firstResult ?? running(handle)
  let firstGet = true
  const starts: Array<Parameters<GameIrOperations['start']>[0]> = []
  const reads: Array<Parameters<GameIrOperations['readResult']>[0]> = []
  let stopCalls = 0
  const ir: GameIrOperations = {
    async revise() { throw new Error('not used') },
    async start(request) {
      starts.push(structuredClone(request))
      return handle
    },
    async getResult() {
      if (firstGet) {
        firstGet = false
        return outcome
      }
      return outcome
    },
    async resume() {
      return outcome
    },
    async stop() {
      stopCalls += 1
      outcome = stopped(handle)
      return outcome
    },
    async readResult(request) {
      reads.push(structuredClone(request))
      return {
        input: input.source,
        candidate: {
          schemaVersion: 'game-ir.v2',
          taskId: 'game-ir-task',
          sourceRevision: input.source.publishedDocumentRevision,
          parameters: {}, assets: [],
          scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
          ui: [], vfx: [], logic: {},
        },
        ready,
      }
    },
  }
  return {
    ir,
    handle,
    starts,
    reads,
    get outcome() {
      return outcome
    },
    set outcome(value: GameIrResult) {
      outcome = value
    },
    get stopCalls() {
      return stopCalls
    },
    ready,
  }
}

function persistedIrLink(
  f: Awaited<ReturnType<typeof fixture>>,
  outcome: GameIrResult = running({
    protocolVersion: 1,
    producer: 'game-ir',
    id: digest('schema-game-ir-handle'),
  }),
) {
  const handle = outcome.handle
  return {
    protocolVersion: 1 as const,
    requestId: 'ir:run-game-ir-link:request',
    inputDigest: digest('schema-input'),
    foundationRevision: f.review.documentSetDigest,
    foundationResultId: f.review.resultId,
    handle,
    outcome,
    control: { sequence: 0, appliedSequence: 0, action: 'run' as const },
  }
}

test('persists accepted source, starts public IR, and advances only after settled verified readResult', async () => {
  const f = await fixture()
  const source = acceptedIrInput(f.run)
  const port = irPort({ source })
  const completedRuns: DeliveryRun[] = []
  const link = createGameIrLink({
    store: f.store,
    ir: port.ir,
    onCompleted: run => completedRuns.push(run),
    pollIntervalMs: 60_000,
  })
  try {
    const started = await link.ensureProgress(f.run)
    expect(port.starts).toHaveLength(1)
    expect(port.starts[0]!.acceptedReview.resultId).toBe(f.review.resultId)
    expect(port.starts[0]!.publishedDocumentRevision).toBe(
      f.review.documentSetDigest,
    )
    expect(started.gameIrStage?.foundationRevision).toBe(
      f.review.documentSetDigest,
    )
    expect(started.gameIrStage?.inputDigest).toBe(
      foundationPublicDigest(source),
    )
    expect((await f.store.load())?.gameIrStage?.handle).toEqual(port.handle)
    expect(started.documentStep).toBe('GAME_IR_COMPILATION')

    port.outcome = completed(port.handle, port.ready)
    const accepted = await link.ensureProgress(f.run)
    expect(accepted.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(accepted.phase).toBe('DOCUMENT_REVIEW')
    expect(accepted.gameIrStage?.outcome?.status).toBe('completed')
    expect(port.reads).toHaveLength(1)
    expect(port.reads[0]!.foundationRevision).toBe(f.review.documentSetDigest)
    expect(completedRuns).toHaveLength(1)
  } finally {
    link.dispose()
    await rm(f.workspace, { recursive: true, force: true })
  }
})

test('a durable stop prevents a late completed IR result from advancing to Checklist', async () => {
  const f = await fixture()
  const source = acceptedIrInput(f.run)
  const port = irPort({ source })
  const link = createGameIrLink({
    store: f.store,
    ir: port.ir,
    onCompleted: () => undefined,
    pollIntervalMs: 60_000,
  })
  try {
    await link.ensureProgress(f.run)
    const stoppedRun = await link.stop(f.run, 'operator stop')
    expect(stoppedRun.status).toBe('stopped')
    expect(stoppedRun.gameIrStage?.control.action).toBe('stop')
    expect(port.stopCalls).toBe(1)

    port.outcome = completed(port.handle, port.ready)
    const stillStopped = await link.ensureProgress(f.run)
    expect(stillStopped.status).toBe('stopped')
    expect(stillStopped.documentStep).toBe('GAME_IR_COMPILATION')
    expect(stillStopped.gameIrStage?.control.action).toBe('stop')
  } finally {
    link.dispose()
    await rm(f.workspace, { recursive: true, force: true })
  }
})

test('automatically polls a completed-but-unsettled IR until settlement and invokes handoff', async () => {
  const f = await fixture()
  const source = acceptedIrInput(f.run)
  const port = irPort({
    source,
    firstResult: {
      status: 'completed',
      handle: fixtureHandle(),
      billingStatus: 'pending',
      result: readyReceipt(source, 'one'),
    },
  })
  const completedRuns: DeliveryRun[] = []
  const link = createGameIrLink({
    store: f.store,
    ir: port.ir,
    onCompleted: run => completedRuns.push(run),
    pollIntervalMs: 5,
  })
  try {
    const pending = await link.ensureProgress(f.run)
    expect(pending.documentStep).toBe('GAME_IR_COMPILATION')
    expect(pending.gameIrStage?.outcome?.billingStatus).toBe('pending')
    port.outcome = completed(port.handle, readyReceipt(source, 'one'))
    await waitFor(() => completedRuns.length === 1)
    expect(completedRuns[0]?.documentStep).toBe('CHECKLIST_DRAFTING')
    expect((await f.store.load())?.documentStep).toBe('CHECKLIST_DRAFTING')
  } finally {
    link.dispose()
    await rm(f.workspace, { recursive: true, force: true })
  }
})

test('reuses same-action control sequences and rejects IR links in Foundation positions', async () => {
  const f = await fixture()
  const source = acceptedIrInput(f.run)
  const port = irPort({ source })
  const link = createGameIrLink({
    store: f.store,
    ir: port.ir,
    onCompleted: () => undefined,
    pollIntervalMs: 60_000,
  })
  try {
    const started = await link.ensureProgress(f.run)
    const beforeResume = (await f.store.load())!.gameIrStage!.control.sequence
    await link.resume(started)
    expect((await f.store.load())!.gameIrStage!.control.sequence).toBe(
      beforeResume,
    )

    const stoppedRun = await link.stop(started, 'operator stop')
    const beforeRepeatedStop = (await f.store.load())!.gameIrStage!.control
      .sequence
    await link.stop(stoppedRun, 'operator stop')
    expect((await f.store.load())!.gameIrStage!.control.sequence).toBe(
      beforeRepeatedStop,
    )
  } finally {
    link.dispose()
    await rm(f.workspace, { recursive: true, force: true })
  }

  const malformedFixture = await fixture()
  try {
    const link = persistedIrLink(malformedFixture)
    for (const position of [
      { phase: 'BRIEF_CONFIRMED' as const, documentStep: undefined },
      {
        phase: 'DOCUMENT_DRAFTING' as const,
        documentStep: 'FOUNDATION_DRAFTING' as const,
      },
      {
        phase: 'DOCUMENT_REVIEW' as const,
        documentStep: 'FOUNDATION_REVIEW' as const,
      },
    ]) {
      expect(() =>
        parseDeliveryRun({
          ...malformedFixture.run,
          ...position,
          gameIrStage: link,
        }),
      ).toThrow(
        'IR provenance cannot coexist with an earlier Foundation execution stage',
      )
    }
  } finally {
    await rm(malformedFixture.workspace, { recursive: true, force: true })
  }
})

test('rejects source, revision, and verified-result mismatches', async () => {
  const sourceCases = [
    {
      name: 'source',
      mutate(run: DeliveryRun) {
        const replacement = acceptedReview('A different accepted review result')
        run.foundationReviewStage!.acceptedReview = replacement
        run.foundationReviewStage!.invocation.outcome = {
          status: 'completed',
          billingStatus: 'settled',
          handle: run.foundationReviewStage!.invocation.handle!,
          result: replacement,
        }
      },
      startBeforeMutation: true,
      expected: 'IR accepted source binding changed',
    },
    {
      name: 'revision',
      mutate(run: DeliveryRun) {
        run.revision.document = digest('another revision')
      },
      startBeforeMutation: false,
      expected: 'IR start requires the published Foundation revision',
    },
  ] as const

  for (const sourceCase of sourceCases) {
    const f = await fixture()
    const source = acceptedIrInput(f.run)
    const port = irPort({ source })
    const link = createGameIrLink({
      store: f.store,
      ir: port.ir,
      onCompleted: () => undefined,
      pollIntervalMs: 60_000,
    })
    try {
      if (sourceCase.startBeforeMutation) await link.ensureProgress(f.run)
      const baseline = sourceCase.startBeforeMutation
        ? await f.store.load()
        : f.run
      if (!baseline) throw new Error('fixture run disappeared')
      const changed = structuredClone(baseline)
      sourceCase.mutate(changed)
      const commit = f.store.commit(changed, {
        runId: changed.runId,
        type: `test.${sourceCase.name}`,
        phase: changed.phase,
        status: changed.status,
        revision: changed.revision,
      })
      if (sourceCase.startBeforeMutation) {
        await expect(commit).rejects.toThrow(
          'IR link must bind its accepted Foundation result, handle and control sequence',
        )
        expect((await f.store.load())?.documentStep).toBe('GAME_IR_COMPILATION')
        continue
      }
      await commit
      await expect(link.ensureProgress(f.run)).rejects.toThrow(
        sourceCase.expected,
      )
      expect((await f.store.load())?.documentStep).not.toBe(
        'CHECKLIST_DRAFTING',
      )
    } finally {
      link.dispose()
      await rm(f.workspace, { recursive: true, force: true })
    }
  }

  const f = await fixture()
  const source = acceptedIrInput(f.run)
  const readReady = readyReceipt(source, 'read')
  const port = irPort({ source, ready: readReady })
  const link = createGameIrLink({
    store: f.store,
    ir: port.ir,
    onCompleted: () => undefined,
    pollIntervalMs: 60_000,
  })
  try {
    await link.ensureProgress(f.run)
    port.outcome = completed(port.handle, readyReceipt(source, 'outcome'))
    await expect(link.ensureProgress(f.run)).rejects.toThrow(
      'IR public reader does not match the accepted completion',
    )
    expect((await f.store.load())?.documentStep).toBe('GAME_IR_COMPILATION')
  } finally {
    link.dispose()
    await rm(f.workspace, { recursive: true, force: true })
  }
})

test('schema rejects downstream Foundation handoff without accepted IR completion', async () => {
  const f = await fixture()
  try {
    expect(() =>
      parseDeliveryRun({
        ...f.run,
        documentStep: 'CHECKLIST_DRAFTING',
      }),
    ).toThrow('Accepted Foundation documents require settled IR completion')

    const runningIr = {
      ...f.run,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      gameIrStage: persistedIrLink(f),
    }
    expect(() => parseDeliveryRun(runningIr)).toThrow(
      'Accepted Foundation documents require settled IR completion',
    )

    const unsettled = {
      ...runningIr,
      gameIrStage: persistedIrLink(f, {
        ...running(runningIr.gameIrStage!.handle!),
        billingStatus: 'pending',
      }),
    }
    expect(() => parseDeliveryRun(unsettled)).toThrow(
      'Accepted Foundation documents require settled IR completion',
    )
  } finally {
    await rm(f.workspace, { recursive: true, force: true })
  }
})

test('schema rejects an IR completion whose outcome handle is not the persisted handle', async () => {
  const f = await fixture()
  try {
    const persistedHandle: GameIrHandle = {
      protocolVersion: 1,
      producer: 'game-ir',
      id: digest('persisted-handle'),
    }
    const outcomeHandle: GameIrHandle = {
      protocolVersion: 1,
      producer: 'game-ir',
      id: digest('different-outcome-handle'),
    }
    const malformed = {
      ...f.run,
      documentStep: 'GAME_IR_COMPILATION' as const,
      gameIrStage: {
        ...persistedIrLink(f, running(persistedHandle)),
        handle: persistedHandle,
        outcome: running(outcomeHandle),
      },
    }
    expect(() => parseDeliveryRun(malformed)).toThrow(
      'IR link must bind its accepted Foundation result, handle and control sequence',
    )
  } finally {
    await rm(f.workspace, { recursive: true, force: true })
  }
})
