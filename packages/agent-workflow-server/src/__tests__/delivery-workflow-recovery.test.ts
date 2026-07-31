import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  reconcileRunOnStartup,
  retryRun,
  stopRun,
} from '../beegame/delivery-workflow/recovery'
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
      createdAt: running.createdAt,
    })
    expect(
      (await store.readEvents()).some(
        event => event.type === 'run.retry_requested',
      ),
    ).toBe(false)
  })

  test('rejects retired schema-v1 fields without rewriting the snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-normalize-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      JSON.stringify({
        ...initial,
        currentMessageKey: 'workflow.resourcePreparation',
        resourceRemediation: {
          sourceRevision: 'resource-1',
          attempt: 1,
          issues: ['resource contract failed'],
          preserveImportIds: [],
          preserveCompositionIds: [],
        },
      }),
      'utf8',
    )

    const retiredSnapshot = await readFile(store.paths.snapshot, 'utf8')
    await expect(store.load()).rejects.toThrow('workflow snapshot schema is invalid')
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(retiredSnapshot)
  })

  test('does not overwrite a genuinely invalid workflow snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-invalid-'))
    const store = createRunStore(workspace, 'owner-1')
    await mkdir(store.paths.directory, { recursive: true })
    const invalidSnapshot = '{"schemaVersion":1'
    await writeFile(store.paths.snapshot, invalidSnapshot, 'utf8')

    await expect(store.load()).rejects.toThrow(
      'workflow snapshot JSON is invalid',
    )
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(invalidSnapshot)
    expect(await store.readEvents()).toEqual([])
  })

  test('marks an orphaned running worker interrupted and makes the run retryable', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-restart-recovery-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    const interrupted = await reconcileRunOnStartup({
      store,
      sessionIsOpen: async () => false,
    })
    expect(interrupted).toMatchObject({
      status: 'stopped',
      thinking: 'idle',
      activeDispatch: { status: 'interrupted' },
    })

    const retried = await retryRun({ store, runId: initial.runId })
    expect(retried).toMatchObject({
      status: 'running',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    expect(retried.activeDispatch).toBeUndefined()
  })

  test('stopping implementation releases the interrupted task so continue can dispatch it again', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-stop-implementation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      resourceRequirementIds: ['requirement-1'],
      checklistIds: [],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/main.ts'],
      verification: [
        {
          kind: 'build' as const,
          commandOrAction: 'bun run build',
          expectedResult: 'Build exits successfully',
        },
      ],
      status: 'running' as const,
      attempt: 1,
      startedRevision: initial.revision.workspace,
      evidenceRefs: [],
    }
    await store.save({
      ...initial,
      phase: 'IMPLEMENTATION',
      activeTaskId: task.id,
      tasks: [task],
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'implementation-worker',
        phase: 'IMPLEMENTATION',
        taskId: task.id,
        revision: initial.revision.workspace,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    const stopped = await stopRun({
      store,
      runId: initial.runId,
      reason: 'user stopped workflow',
      sessionIsOpen: async () => true,
      stopDispatch: async () => undefined,
    })

    expect(stopped).toMatchObject({
      status: 'stopped',
      activeDispatch: { status: 'interrupted' },
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(stopped.activeTaskId).toBeUndefined()

    const continued = await retryRun({ store, runId: initial.runId })
    expect(continued).toMatchObject({
      status: 'running',
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(continued.activeTaskId).toBeUndefined()
    expect(continued.activeDispatch).toBeUndefined()
  })

  test('continue repairs an implementation snapshot stopped before active-task release was persisted', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-continue-repair-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      resourceRequirementIds: ['requirement-1'],
      checklistIds: [],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/main.ts'],
      verification: [
        {
          kind: 'build' as const,
          commandOrAction: 'bun run build',
          expectedResult: 'Build exits successfully',
        },
      ],
      status: 'running' as const,
      attempt: 1,
      startedRevision: initial.revision.workspace,
      evidenceRefs: [],
    }
    await store.save({
      ...initial,
      phase: 'IMPLEMENTATION',
      status: 'stopped',
      activeTaskId: task.id,
      tasks: [task],
      blockedReason: 'user stopped workflow',
      activeDispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'implementation-worker',
        phase: 'IMPLEMENTATION',
        taskId: task.id,
        revision: initial.revision.workspace,
        status: 'interrupted',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    })

    const continued = await retryRun({ store, runId: initial.runId })

    expect(continued).toMatchObject({
      status: 'running',
      tasks: [{ id: task.id, status: 'pending', attempt: 1 }],
    })
    expect(continued.activeTaskId).toBeUndefined()
    expect(continued.activeDispatch).toBeUndefined()
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

  test('does not carry stale reselection execution intent across retry', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-mode-'))
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
      status: 'needs_action',
      blockedReason: 'resource worker produced no durable mutation',
      resourceRemediation: {
        sourceRevision: initial.revision.document,
        attempt: 7,
        issues: ['old catalog-call limit'],
        mode: 'reselection',
        preserveImportIds: ['current-import'],
        preserveCompositionIds: ['current-composition'],
        reselectImportIds: ['already-removed-import'],
      },
    })

    const retried = await retryRun({ store, runId: initial.runId })

    expect(retried.resourceRemediation).toMatchObject({
      attempt: 8,
      mode: 'repair',
      issues: ['resource worker produced no durable mutation'],
    })
    expect(retried.resourceRemediation).not.toHaveProperty('reselectImportIds')
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

  test('persists the exact resource remediation used by the active dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-remediation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
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
    const remediation = {
      sourceRevision: initial.revision.document,
      attempt: 2,
      issues: ['target compatibility changed'],
      mode: 'reselection' as const,
      preserveImportIds: ['compatible-import'],
      preserveCompositionIds: ['current-composition'],
      reselectImportIds: ['incompatible-import'],
    }

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: { remediation },
    })

    expect((await store.load())?.resourceRemediation).toEqual(remediation)
  })

  test('starts a fresh retry dispatch even while the timed-out transport is still closing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-stale-key-'))
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
    })
    const started: string[] = []
    let closeCalls = 0
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 30,
      progressPollIntervalMs: 5,
      workerPort: {
        async start(request) {
          const dispatchId = request.dispatchId ?? 'missing-dispatch-id'
          started.push(dispatchId)
          return { sessionId: dispatchId, dispatchId }
        },
        async submit() {},
        async stop() {},
        async close() {
          closeCalls += 1
          await new Promise<void>(() => undefined)
        },
        async status() {
          throw new Error('not used')
        },
      },
    })
    const request: WorkerDispatchRequest = {
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      allowedPaths: ['assets/', '.beegame/workflow/evidence/'],
      contract: {},
    }
    const first = await dispatcher.dispatch(request)

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await store.load())?.status === 'needs_action') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect((await store.load())?.status).toBe('needs_action')
    expect(closeCalls).toBe(1)

    const retried = await retryRun({ store, runId: initial.runId })
    expect(retried.activeDispatch).toBeUndefined()
    const second = await dispatcher.dispatch(request)

    expect(second.dispatchId).not.toBe(first.dispatchId)
    expect(started).toEqual([first.dispatchId, second.dispatchId])
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: {
        dispatchId: second.dispatchId,
        status: 'running',
      },
    })
  })

  test('does not let display-only activity refresh durable progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-durable-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const durableAt = '2025-01-01T00:00:00.000Z'
    await store.save({ ...initial, lastProgressAt: durableAt })

    await store.updateProgress(initial.runId, {
      message: 'working',
      thinking: 'working',
      durable: false,
    })
    expect((await store.load())?.lastProgressAt).toBe(durableAt)

    await store.updateProgress(initial.runId, { durable: true })
    expect((await store.load())?.lastProgressAt).not.toBe(durableAt)
  })

  test('applies the resource wall-clock limit even when idle detection is disabled', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-wall-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 20,
      resourceMaxTokens: 0,
      progressPollIntervalMs: 5,
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

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await store.load())?.status === 'needs_action') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      blockedReason: 'resource worker exceeded its 20ms wall-clock limit',
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('reports resource no-mutation timeout before the longer wall-clock cap', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-no-mutation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceIdleProgressTimeoutMs: 20,
      resourceMaxDurationMs: 1000,
      resourceMaxTokens: 0,
      progressPollIntervalMs: 5,
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

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await store.load())?.status === 'needs_action') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      blockedReason:
        'resource worker produced no durable resource mutation for 20ms',
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('stops a resource dispatch after its own cumulative token delta', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-token-limit-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const baselineUsage = {
      input_tokens: 40,
      cache_read_tokens: 30,
      cache_creation_tokens: 20,
      completion_tokens: 10,
      total_tokens: 100,
    }
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      usage: baselineUsage,
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 0,
      resourceMaxTokens: 50,
      progressPollIntervalMs: 5,
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
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    expect(dispatch.startingUsageTotalTokens).toBe(100)
    expect(dispatch.startingUsageBudgetTokens).toBe(70)
    await store.updateUsage(initial.runId, {
      ...baselineUsage,
      input_tokens: 90,
      total_tokens: 150,
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await store.load())?.status === 'needs_action') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      blockedReason: 'resource worker exceeded its 50 token limit',
    })
  })

  test('yields a resource dispatch with durable progress so the controller can continue it', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-token-yield-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const yielded: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 0,
      resourceMaxTokens: 50,
      progressPollIntervalMs: 5,
      onResourceBudgetYield: async (_record, reason) => {
        yielded.push(reason)
      },
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

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-preparer',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    await new Promise(resolve => setTimeout(resolve, 2))
    await store.updateProgress(initial.runId, { durable: true })
    await store.updateUsage(initial.runId, {
      input_tokens: 50,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      completion_tokens: 0,
      total_tokens: 50,
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (yielded.length) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(yielded).toEqual([
      'resource worker exceeded its 50 token limit',
    ])
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'interrupted' },
    })
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
