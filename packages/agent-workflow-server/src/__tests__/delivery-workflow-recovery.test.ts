import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retryRun } from '../beegame/delivery-workflow/recovery'
import { createDeliveryDispatcher } from '../beegame/delivery-workflow/dispatch'
import {
  createInitialDeliveryRun,
  createRunStore,
} from '../beegame/delivery-workflow/run-store'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'

describe('delivery workflow recovery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('treats a duplicate retry for an already resumed run as idempotent', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-retry-idempotent-'))
    const store = createRunStore(workspace, 'owner-1')
    const running = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save(running)

    const duplicate = await retryRun({ store, runId: running.runId })

    expect(duplicate).toMatchObject({
      runId: running.runId,
      phase: running.phase,
      status: 'running',
      revision: running.revision,
    })
    expect(
      (await store.readEvents()).some(
        event => event.type === 'run.retry_requested',
      ),
    ).toBe(false)
  })

  test('carries exact resource failures into a retry repair contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const failed = {
      ...initial,
      phase: 'RESOURCE_PREPARATION' as const,
      status: 'needs_action' as const,
      blockedReason: 'canonical resource contract failed',
      evidence: {
        resourcePreparation: {
          path: '.beegame/workflow/evidence/resource.md',
          kind: 'resource_preparation' as const,
          revision: 'resource-revision',
          status: 'failed' as const,
          observedAt: new Date().toISOString(),
        },
      },
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'resource-preparer' as const,
        phase: 'RESOURCE_PREPARATION' as const,
        revision: initial.revision.document,
        status: 'failed' as const,
        terminalResult: {
          importIds: ['import-1'],
          compositionIds: ['composition-1'],
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    }
    await store.save(failed)

    const retried = await retryRun({ store, runId: failed.runId })

    expect(retried).toMatchObject({
      status: 'running',
      resourceRemediation: {
        sourceRevision: 'resource-revision',
        attempt: 1,
        issues: ['canonical resource contract failed'],
        preserveImportIds: ['import-1'],
        preserveCompositionIds: ['composition-1'],
      },
    })
  })

  test('starts retry idle timing from the new dispatch instead of stale run progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      lastProgressAt: '2020-01-01T00:00:00.000Z',
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 100,
      progressPollIntervalMs: 10,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    const dispatch = await dispatcher.dispatch({
      dispatchId: 'request-placeholder',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    const running = await store.load()

    expect(running?.status).toBe('running')
    expect(running?.activeDispatch?.dispatchId).toBe(dispatch.dispatchId)
    expect(running?.lastProgressAt).toBe(dispatch.startedAt)
  })

  test('uses worker and document lane identity in dispatch idempotency keys', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-identity-'))
    const store = createRunStore(workspace, 'owner-1')
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })
    const shared = {
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: workspace,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: 'revision-1',
    }
    const reviewer = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-reviewer',
        contract: { reviewScope: 'foundation' },
      },
      1,
    )
    const checklistAuthor = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-author',
        contract: { documentSet: 'checklist' },
      },
      1,
    )
    const comprehensiveReviewer = dispatcher.idempotencyKey(
      {
        ...shared,
        workerType: 'document-reviewer',
        contract: { reviewScope: 'complete' },
      },
      1,
    )

    expect(checklistAuthor).not.toBe(reviewer)
    expect(comprehensiveReviewer).not.toBe(reviewer)
  })

  test('starts a checklist author after a reviewer completes at the same phase and revision', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-author-handoff-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      documentRevision: 'revision-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const evidencePath = '.beegame/workflow/evidence/foundation-review.md'
    await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
      recursive: true,
    })
    await writeFile(join(workspace, evidencePath), '# Ready\n')
    const started: WorkerDispatchRequest[] = []
    let dispatcher!: ReturnType<typeof createDeliveryDispatcher>
    dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: request.dispatchId ?? 'missing-dispatch-id',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
      async onTerminal(_record, result) {
        if (result.workerType !== 'document-reviewer') return
        const reviewed = await store.load()
        await store.save({
          ...reviewed!,
          activeDispatch: undefined,
          documentStep: 'CHECKLIST_DRAFTING',
        })
        await dispatcher.dispatch({
          runId: initial.runId,
          ownerId: initial.ownerId,
          projectId: initial.projectId,
          workspacePath: workspace,
          workerType: 'document-author',
          phase: 'DOCUMENT_REVIEW',
          revision: initial.revision.document,
          allowedPaths: ['docs/acceptance/'],
          contract: { documentSet: 'checklist' },
        })
      },
    })
    const review = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })

    await dispatcher.completeDispatch(review.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'READY',
      reviewedDocumentPaths: [],
      checklistIds: [],
      findings: [],
      evidencePath,
    })

    expect(started.map(request => request.workerType)).toEqual([
      'document-reviewer',
      'document-author',
    ])
    expect((await store.load())?.activeDispatch).toMatchObject({
      workerType: 'document-author',
      status: 'running',
    })
  })
})
