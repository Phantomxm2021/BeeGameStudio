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
import { computeDocumentRevision } from '../beegame/delivery-workflow/revision'
import {
  createRunStore,
  readObsoleteWorkflowRestartSeed,
} from '../beegame/delivery-workflow/run-store'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'

describe('delivery workflow recovery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('records NEEDS_REVISION as a completed reviewer execution', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-status-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
    const evidencePath = '.beegame/workflow/evidence/review.json'
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-review',
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
        await mkdir(join(workspace, '.beegame', 'workflow', 'evidence'), {
          recursive: true,
        })
        await writeFile(join(workspace, result.evidencePath), '{}\n')
      },
    })
    const dispatch = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })
    const completed = await dispatcher.completeDispatch(dispatch.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'NEEDS_REVISION',
      checks: [
        {
          id: 'brief_alignment',
          status: 'block',
          conclusion: 'A required behavior is missing.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: ['missing-behavior'],
          assessments: [],
        },
      ],
      reviewedDocumentPaths: [],
      checklistIds: [],
      findings: [
        {
          findingId: 'missing-behavior',
          checkId: 'brief_alignment',
          severity: 'blocking',
          owner: 'foundation',
          subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          observation: 'A required behavior is missing.',
          blockingReason: 'The behavior cannot be implemented uniquely.',
          requiredAction: 'Define the required behavior.',
          closureCondition: 'The required behavior is observable and complete.',
        },
      ],
      evidencePath,
    })

    expect(completed.record.status).toBe('completed')
    expect((await store.load())?.activeDispatch).toMatchObject({
      workerType: 'document-reviewer',
      status: 'completed',
    })
    expect(await readFile(join(workspace, evidencePath), 'utf8')).toBe('{}\n')
  })

  test('explicit retry cannot reset an exhausted accepted repair budget', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-lock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-review-lock',
      projectId: 'project-review-lock',
      ownerId: 'owner-1',
    })
    const revision = await computeDocumentRevision(
      workspace,
      initial.confirmedBriefDigest,
    )
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      revision: { ...initial.revision, document: revision },
      blockedReason: 'review repair is exhausted',
      documentReviewState: {
        ...initial.documentReviewState,
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          foundation: 2,
        },
        activeCycle: {
          cycleId: 'cycle-1',
          parentCycleId: 'initial-cycle',
          originScope: 'foundation',
          scope: 'foundation',
          mode: 'closure',
          sourceRevision: revision,
          requiredCheckIds: ['brief_alignment'],
          completedCheckIds: ['brief_alignment'],
          checks: [{
            id: 'brief_alignment' as const,
            status: 'block' as const,
            conclusion: 'Foundation remediation is required.',
            evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
            findingIds: ['MISSING-RULE'],
            assessments: [],
          }],
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'MISSING-RULE',
              checkId: 'brief_alignment',
              severity: 'blocking',
              owner: 'foundation',
              subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              observation: 'A required rule is missing.',
              blockingReason: 'The behavior cannot be implemented uniquely.',
              requiredAction: 'Define the required rule.',
              closureCondition: 'The required rule is defined.',
            },
          ],
          activeTarget: 'foundation',
          acceptedSemanticResult: true,
          changedPaths: ['docs/GDD.md'],
          sourceArtifactDigests: {},
        },
      },
    })

    const retried = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })
    expect(retried).toMatchObject({
      status: 'needs_action',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      documentReviewState: {
        repairPasses: { foundation: 2 },
        activeCycle: {
          cycleId: 'cycle-1',
          acceptedSemanticResult: true,
        },
      },
    })
  })

  test('restores an interrupted accepted resource remediation handoff', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-resource-review-handoff-'),
    )
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-resource-review-handoff',
      projectId: 'project-resource-review-handoff',
      ownerId: 'owner-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_REVIEW',
      status: 'needs_action',
      blockedReason:
        'document review cycle has already accepted its unique semantic result',
      documentReviewState: {
        ...initial.documentReviewState,
        repairPasses: {
          ...initial.documentReviewState.repairPasses,
          resource: 1,
        },
        activeCycle: {
          cycleId: 'resource-cycle',
          originScope: 'complete',
          scope: 'complete',
          mode: 'initial',
          sourceRevision: 'resources',
          requiredCheckIds: ['resource_content_consistency'],
          completedCheckIds: ['resource_content_consistency'],
          checks: [{
            id: 'resource_content_consistency' as const,
            status: 'block' as const,
            conclusion: 'Resource remediation is required.',
            evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
            findingIds: ['resource-finding'],
            assessments: [],
          }],
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'resource-finding',
              checkId: 'resource_content_consistency',
              severity: 'blocking',
              owner: 'resource',
              subjects: [
                {
                  path: 'assets/asset-manifest.json',
                  anchor: '$',
                  resourceId: 'resource-1',
                },
              ],
              observation: 'The resource contract is inconsistent.',
              blockingReason: 'Implementation cannot resolve the resource.',
              requiredAction: 'Correct the canonical resource contract.',
              closureCondition: 'The resource contract is consistent.',
            },
          ],
          activeTarget: 'resource',
          acceptedSemanticResult: true,
          changedPaths: [],
          sourceArtifactDigests: {},
        },
      },
    })

    const retried = await retryRun({ store, runId: initial.runId })

    expect(retried).toMatchObject({
      status: 'running',
      phase: 'RESOURCE_PREPARATION',
      documentStep: undefined,
      blockedReason: undefined,
      documentReviewState: {
        repairPasses: { resource: 1 },
        activeCycle: {
          cycleId: 'resource-cycle',
          acceptedSemanticResult: true,
          activeTarget: 'resource',
        },
      },
    })
  })

  test('treats a duplicate retry for an already resumed run as idempotent', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-retry-idempotent-'))
    const store = createRunStore(workspace, 'owner-1')
    const running = createTestDeliveryRun({
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

  test('persists reviewer artifact progress only for the active dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      reviewedDocumentPaths: [],
      activeDispatch: {
        dispatchId: 'review-dispatch',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    await store.updateProgress('run-1', {
      dispatchId: 'review-dispatch',
      reviewedDocumentPath: 'docs/GDD.md',
    })
    await store.updateProgress('run-1', {
      dispatchId: 'review-dispatch',
      reviewedDocumentPath: 'docs/GDD.md',
    })
    await store.updateProgress('run-1', {
      dispatchId: 'stale-dispatch',
      reviewedDocumentPath: 'docs/TECHNICAL_DESIGN.md',
    })

    expect((await store.load())?.reviewedDocumentPaths).toEqual(['docs/GDD.md'])
  })

  test('rejects late progress from a terminal dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-terminal-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const terminalAt = '2026-01-01T00:30:00.000Z'
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'needs_action',
      thinking: 'idle',
      lastProgressAt: terminalAt,
      activeDispatch: {
        dispatchId: 'author-dispatch',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'interrupted',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: terminalAt,
        failureReason: 'document-author exceeded its wall-clock limit',
      },
    })

    await store.updateProgress(initial.runId, {
      dispatchId: 'author-dispatch',
      thinking: 'working',
      message: 'late thinking event',
      durable: true,
    })

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      thinking: 'idle',
      lastProgressAt: terminalAt,
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('rejects retired current-version fields without rewriting the snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-normalize-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
    await expect(store.load()).rejects.toThrow(
      'workflow snapshot schema is invalid',
    )
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(retiredSnapshot)
  })

  test('rejects an obsolete snapshot version before nested schema validation', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-obsolete-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-obsolete',
      projectId: 'project-obsolete',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    const obsoleteSnapshot = JSON.stringify({
      ...initial,
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1,
      activeDispatch: {
        retiredStateMarker: true,
      },
    })
    await writeFile(store.paths.snapshot, obsoleteSnapshot, 'utf8')

    await expect(store.load()).rejects.toMatchObject({
      code: 'obsolete',
      message: `unsupported workflow snapshot schema version ${DELIVERY_RUN_SCHEMA_VERSION - 1}; current version is ${DELIVERY_RUN_SCHEMA_VERSION}`,
    })
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(obsoleteSnapshot)
  })

  test('extracts only digest-bound authority when explicitly restarting an obsolete snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-restart-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-obsolete',
      projectId: 'project-obsolete',
      ownerId: 'owner-1',
      confirmedBriefContext: 'Build the confirmed game.',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      JSON.stringify({
        ...initial,
        schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1,
        activeDispatch: {
          untrustedRetiredState: true,
        },
      }),
      'utf8',
    )

    await expect(
      readObsoleteWorkflowRestartSeed(workspace, 'owner-1'),
    ).resolves.toEqual({
      schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1,
      runId: initial.runId,
      projectId: initial.projectId,
      ownerId: initial.ownerId,
      confirmedBriefDigest: initial.confirmedBriefDigest,
      confirmedBriefContext: initial.confirmedBriefContext,
    })
  })

  test('does not treat a current snapshot as restartable obsolete state', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-current-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-current',
      projectId: 'project-current',
      ownerId: 'owner-1',
    })
    await store.save(initial)

    await expect(
      readObsoleteWorkflowRestartSeed(workspace, 'owner-1'),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  test('does not allow an older server to replace a newer snapshot', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-storage-newer-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-newer',
      projectId: 'project-newer',
      ownerId: 'owner-1',
    })
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      JSON.stringify({
        ...initial,
        schemaVersion: DELIVERY_RUN_SCHEMA_VERSION + 1,
      }),
      'utf8',
    )

    await expect(store.load()).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      readObsoleteWorkflowRestartSeed(workspace, 'owner-1'),
    ).rejects.toMatchObject({ code: 'conflict' })
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
    const initial = createTestDeliveryRun({
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
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
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
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const task = {
      id: 'task-1',
      title: 'Build the runtime entry point',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
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

  test('resumes failed Resource Production without creating a repair contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
          resourceIds: ['resource-1'],
          contentIds: ['content-1'],
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    }
    await store.save(failed)

    const retried = await retryRun({ store, runId: failed.runId })

    expect(retried).toMatchObject({
      status: 'running',
      resourcePreparationAttempt: 1,
    })
  })

  test('preserves Resource Production retry accounting across a startup failure', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-retry-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
      resourcePreparationAttempt: 7,
    })

    const retried = await retryRun({ store, runId: initial.runId })

    expect(retried.resourcePreparationAttempt).toBe(7)
  })

  test('starts retry idle timing from the new dispatch instead of stale run progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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

  test('preserves Resource Production execution accounting without a retry contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-remediation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      resourcePreparationAttempt: 2,
    })
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

    expect((await store.load())?.resourcePreparationAttempt).toBe(2)
  })

  test('starts a fresh retry dispatch even while the timed-out transport is still closing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-stale-key-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
    const initial = createTestDeliveryRun({
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
    const initial = createTestDeliveryRun({
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

  test('supervises document wall-clock while submit is still running the model turn', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-submit-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'DOCUMENT_DRAFTING' })
    let finishSubmit: (() => void) | undefined
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      documentAuthorMaxDurationMs: 20,
      documentAuthorMaxTokens: 0,
      progressPollIntervalMs: 5,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId ?? 'missing-dispatch-id',
          }
        },
        async submit() {
          await new Promise<void>(resolve => {
            finishSubmit = resolve
          })
        },
        async stop() {
          finishSubmit?.()
        },
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
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: initial.revision.document,
      contract: { documentSet: 'foundation' },
    })

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      blockedReason: 'document-author exceeded its 20ms wall-clock limit',
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('reports resource no-mutation timeout before the longer wall-clock cap', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-no-mutation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
    const initial = createTestDeliveryRun({
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
    await store.updateUsage(initial.runId, {
      ...baselineUsage,
      cache_read_tokens: 80,
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

  test('does not stop an active reviewer because wall-clock time elapsed', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-no-wall-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 0,
      resourceMaxTokens: 0,
      documentReviewMaxTokens: 0,
      documentAuthorMaxDurationMs: 0,
      documentAuthorMaxTokens: 0,
      progressPollIntervalMs: 5,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-review',
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
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect((await store.load())?.status).toBe('running')
    expect((await store.load())?.blockedReason).toBeUndefined()
  })

  test('bounds reviewer usage by total tokens including cache reads', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-token-limit-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      usage: baselineUsage,
    })
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 0,
      resourceMaxTokens: 0,
      documentReviewMaxTokens: 50,
      documentAuthorMaxDurationMs: 0,
      documentAuthorMaxTokens: 0,
      progressPollIntervalMs: 5,
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-review',
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
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { reviewScope: 'foundation' },
    })
    await store.updateUsage(initial.runId, {
      ...baselineUsage,
      cache_read_tokens: 80,
      total_tokens: 150,
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await store.load())?.status === 'needs_action') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(await store.load()).toMatchObject({
      status: 'needs_action',
      blockedReason: 'document-reviewer exceeded its 50 total token limit',
    })
  })

  test('yields a resource dispatch with durable progress so the controller can continue it', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-token-yield-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
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

    expect(yielded).toEqual(['resource worker exceeded its 50 token limit'])
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'interrupted' },
    })
  })

  test('forces a fresh resource dispatch after the initial plan checkpoint', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-plan-yield-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-plan',
      projectId: 'project-plan',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-plan',
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    const yielded: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      idleProgressTimeoutMs: 0,
      resourceIdleProgressTimeoutMs: 0,
      resourceMaxDurationMs: 60_000,
      resourceMaxTokens: 0,
      progressPollIntervalMs: 5,
      onResourceBudgetYield: async (_record, reason) => {
        yielded.push(reason)
      },
      workerPort: {
        async start(request) {
          return {
            sessionId: 'session-plan',
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
      contract: { resourcePlanOnly: true },
    })
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/asset-manifest.json'),
      `${JSON.stringify({
        version: 7,
        project_target: {
          asset_format_capabilities: ['svg'],
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [{ id: 'world.structure', required: true }],
        resources: [],
      })}\n`,
    )
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (yielded.length) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(yielded).toEqual(['resource plan checkpoint completed'])
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: {
        status: 'interrupted',
        failureReason: 'resource plan checkpoint completed',
      },
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
    const initial = createTestDeliveryRun({
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
      checks: [
        {
          id: 'brief_alignment',
          status: 'pass',
          conclusion: 'The authority is aligned.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
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
