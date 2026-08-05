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
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import { computeDocumentRevision } from '../beegame/delivery-workflow/revision'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from './delivery-workflow-test-helpers'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import { commitCanonicalDocument } from '../beegame/native-canonical-document-tool'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'

describe('delivery workflow recovery', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('recovers a committed canonical document without redispatching its semantic repair', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-receipt-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'document-repair-dispatch',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: initial.revision.document,
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'remediation',
        foundationDocumentPath: 'docs/GDD.md',
      },
    }
    await commitCanonicalDocument({
      workspacePath: workspace,
      contract: {
        dispatchId: request.dispatchId!,
        targetPath: 'docs/GDD.md',
        documentId: 'GDD',
        operation: 'create',
        baselineDigest: null,
      },
      body: '# Game Design\n\nRepaired rules.',
    })
    await store.save({
      ...initial,
      phase: 'DOCUMENT_DRAFTING',
      status: 'needs_action',
      activeDispatch: {
        dispatchId: request.dispatchId!,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: initial.revision.document,
        status: 'interrupted',
        startedAt: new Date().toISOString(),
        request,
      },
      blockedReason: 'worker transport was interrupted',
    })

    const resumed = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(resumed.status).toBe('running')
    expect(resumed.activeDispatch).toMatchObject({
      dispatchId: request.dispatchId,
      status: 'completed',
      terminalResult: {
        workerType: 'document-author',
        writtenPaths: ['docs/GDD.md'],
      },
    })
  })

  test('recovers and consumes a committed resource content dispatch without redispatching the author', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-receipt-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-resource-receipt',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['dat', 'json'],
        resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [{ id: 'world.visual', required: true }],
      resources: [],
    })
    await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/world.dat'), 'world')
    await registerBeeGameAuthoredResources(workspace, [
      {
        id: 'world-resource',
        root_path: 'assets/runtime/world.dat',
        file_paths: ['assets/runtime/world.dat'],
        provisional: true,
        reason: 'Durable recovery fixture.',
        selection_reason: ['Exercises retry reconciliation.'],
        asset_kind: 'data',
      },
    ])
    const commitContract = {
      dispatchId: 'resource-content-dispatch',
      inventoryRevision: await computeResourceInventoryRevision(workspace),
      baselineResourceRevision: await computeResourceRevision(workspace, ''),
      requiredRequirementIds: ['world.visual'],
      verifiedResourceIds: ['world-resource'],
      inventoryBindings: [
        {
          requirementId: 'world.visual',
          resourceIds: ['world-resource'],
        },
      ],
      protectedPaths: [],
    }
    const tool = createNativeResourceContentTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      contract: commitContract,
      assertMutationAuthority: () => undefined,
    }) as { call(input: unknown): Promise<unknown> }
    await tool.call({
      action: 'commit',
      documents: [
        {
          path: 'assets/content/resource-registry.json',
          schema: 'beegame-content-v1',
          id: 'resource-registry',
          kind: 'resource-registry',
          fulfills: ['world.visual'],
          resources: ['world-resource'],
          data: {
            bindings: [
              {
                requirementId: 'world.visual',
                resourceIds: ['world-resource'],
              },
            ],
          },
        },
      ],
    })
    const request: WorkerDispatchRequest = {
      dispatchId: commitContract.dispatchId,
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {
        ...commitContract,
        preservedPaths: [],
      },
    }
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      status: 'failed',
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT',
      },
      activeDispatch: {
        dispatchId: commitContract.dispatchId,
        workerType: 'resource-content-author',
        phase: 'RESOURCE_PREPARATION',
        revision: request.revision,
        status: 'failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        failureReason: 'transport result mapping failed',
        request,
      },
      blockedReason: 'transport result mapping failed',
    })

    const retried = await retryRun({
      store,
      runId: initial.runId,
      workspacePath: workspace,
    })

    expect(retried.status).toBe('running')
    expect(retried.activeDispatch).toMatchObject({
      dispatchId: commitContract.dispatchId,
      status: 'completed',
      terminalResult: {
        workerType: 'resource-content-author',
        status: 'completed',
        contentIds: ['resource-registry'],
        writtenPaths: ['assets/content/resource-registry.json'],
      },
    })

    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: initial.ownerId,
      workerPort: {
        async start(nextRequest) {
          return {
            sessionId: 'recovery-next-session',
            dispatchId: nextRequest.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.resume(retried)

    const progressed = await store.load()
    expect(progressed?.activeDispatch?.dispatchId).not.toBe(
      commitContract.dispatchId,
    )
    expect(progressed?.activeDispatch?.failureReason).toBeUndefined()
  }, 2_000)

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
      contract: {
        reviewScope: 'foundation',
        currentCheckIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
        reviewArtifacts: [{ path: 'docs/GDD.md', content: 'abc' }],
        referenceIndex: { references: [{ referenceId: 'ref-1' }] },
        priorFindings: [{ findingId: 'prior-1' }],
      },
    })
    await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 20,
        cache_read_tokens: 10,
        cache_creation_tokens: 5,
        completion_tokens: 4,
        total_tokens: 39,
      },
      dispatch.dispatchId,
    )
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
        {
          id: 'cross_document_consistency',
          status: 'pass',
          conclusion: 'The documents are consistent.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
        {
          id: 'gameplay_completeness',
          status: 'pass',
          conclusion: 'The gameplay contract is complete.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
      checklistIds: [],
      findings: [
        {
          findingId: 'missing-behavior',
          checkId: 'brief_alignment',
          severity: 'blocking',
          owner: 'foundation',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          observation: 'A required behavior is missing.',
          blockingImpact: 'The behavior cannot be implemented uniquely.',
          requiredOutcome: 'The required behavior is observable and complete.',
        },
      ],
      evidencePath,
      rejectedSubmissionCount: 2,
    })

    expect(completed.record.status).toBe('completed')
    expect((await store.load())?.activeDispatch).toMatchObject({
      workerType: 'document-reviewer',
      status: 'completed',
    })
    expect(await readFile(join(workspace, evidencePath), 'utf8')).toBe('{}\n')
    expect(
      (await store.readEvents()).find(
        event => event.type === 'dispatch.completed',
      ),
    ).toMatchObject({
      reviewerPerformance: {
        checkIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
        usage: {
          input_tokens: 20,
          cache_read_tokens: 10,
          cache_creation_tokens: 5,
          completion_tokens: 4,
          total_tokens: 39,
        },
        artifactCount: 1,
        artifactBytes: 3,
        referenceCount: 1,
        priorFindingCount: 1,
        rejectedSubmissionCount: 2,
      },
    })
  })

  test('explicit retry resumes an accepted repair handoff regardless of prior pass count', async () => {
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
        checklistApproval: {
          scope: 'checklist',
          revision: initial.revision.document,
          checks: [
            {
              id: 'checklist_traceability',
              status: 'pass',
              conclusion: 'Checklist is approved.',
              evidence: [
                {
                  path: 'docs/acceptance/gameplay-checklist.md',
                  anchor: 'Acceptance',
                },
              ],
              findingIds: [],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          evidencePath: '.beegame/workflow/evidence/checklist.json',
          approvedAt: new Date().toISOString(),
        },
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
          checks: [
            {
              id: 'brief_alignment' as const,
              status: 'block' as const,
              conclusion: 'Foundation remediation is required.',
              evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              findingIds: ['MISSING-RULE'],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'MISSING-RULE',
              checkId: 'brief_alignment',
              severity: 'blocking',
              owner: 'foundation',
              evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
              observation: 'A required rule is missing.',
              blockingImpact: 'The behavior cannot be implemented uniquely.',
              requiredOutcome: 'The required rule is defined.',
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
      status: 'running',
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
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
      documentStep: 'COMPREHENSIVE_REVIEW',
      status: 'needs_action',
      blockedReason:
        'document review cycle has already accepted its unique semantic result',
      documentReviewState: {
        ...initial.documentReviewState,
        checklistApproval: {
          scope: 'checklist',
          revision: initial.revision.document,
          checks: [
            {
              id: 'checklist_traceability',
              status: 'pass',
              conclusion: 'Checklist is approved.',
              evidence: [
                {
                  path: 'docs/acceptance/gameplay-checklist.md',
                  anchor: 'Acceptance',
                },
              ],
              findingIds: [],
              assessments: [],
            },
          ],
          checkEvidenceDigests: {},
          evidencePath: '.beegame/workflow/evidence/checklist.json',
          approvedAt: new Date().toISOString(),
        },
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
          ...createAcceptedComprehensiveReview({
            blockingCheckId: 'resource_content_consistency',
            findingIds: ['resource-finding'],
          }),
          checkEvidenceDigests: {},
          findings: [
            {
              findingId: 'resource-finding',
              checkId: 'resource_content_consistency',
              severity: 'blocking',
              owner: 'resource',
              evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
              subjects: [
                {
                  path: 'assets/asset-manifest.json',
                  anchor: '$',
                  resourceId: 'resource-1',
                },
              ],
              observation: 'The resource contract is inconsistent.',
              blockingImpact: 'Implementation cannot resolve the resource.',
              requiredOutcome: 'The resource contract is consistent.',
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
        failureReason: 'worker transport was interrupted',
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

  test('does not allow an older server to load a newer snapshot', async () => {
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
      checklistApproved: true,
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
      checklistApproved: true,
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
      checklistApproved: true,
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
        workerType: 'resource-curator' as const,
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

    expect(retried).toMatchObject({ status: 'running' })
  })

  test('starts retry idle timing from the new dispatch instead of stale run progress', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-progress-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
      lastProgressAt: '2020-01-01T00:00:00.000Z',
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

    const dispatch = await dispatcher.dispatch({
      dispatchId: 'request-placeholder',
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    const running = await store.load()

    expect(running?.status).toBe('running')
    expect(running?.activeDispatch?.dispatchId).toBe(dispatch.dispatchId)
    expect(running?.lastProgressAt).toBe(dispatch.startedAt)
  })

  test('starts a fresh retry dispatch even while an explicitly stopped transport is still closing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-stale-key-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({
      ...initial,
      phase: 'RESOURCE_PREPARATION',
    })
    const started: string[] = []
    let closeCalls = 0
    const dispatcher = createDeliveryDispatcher({
      store,
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
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      allowedPaths: ['assets/', '.beegame/workflow/evidence/'],
      contract: {},
    }
    const first = await dispatcher.dispatch(request)

    await dispatcher.stop(first.dispatchId, 'operator stopped workflow')
    expect((await store.load())?.status).toBe('stopped')
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

  test('does not submit a worker after its durable dispatch loses authority during start', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-dispatch-start-fence-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
    })
    await store.save({ ...initial, phase: 'RESOURCE_PREPARATION' })
    let submitCount = 0
    const stopped: string[] = []
    const dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          const current = await store.load()
          await store.save({
            ...current!,
            status: 'stopped',
            blockedReason: 'operator stopped workflow',
            activeDispatch: {
              ...current!.activeDispatch!,
              status: 'interrupted',
              finishedAt: new Date().toISOString(),
            },
          })
          return {
            sessionId: 'session-1',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {
          submitCount += 1
        },
        async stop(dispatchId) {
          stopped.push(dispatchId)
        },
        async close() {},
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
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })

    expect(dispatch.status).toBe('interrupted')
    expect(submitCount).toBe(0)
    expect(stopped).toEqual([dispatch.dispatchId])
  })

  test('rejects usage from a stopped or superseded dispatch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-usage-fence-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const startedAt = new Date().toISOString()
    await store.save({
      ...initial,
      phase: 'DOCUMENT_REVIEW',
      activeDispatch: {
        dispatchId: 'dispatch-current',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: initial.revision.document,
        status: 'running',
        startedAt,
      },
    })
    const delta = {
      input_tokens: 10,
      cache_read_tokens: 20,
      cache_creation_tokens: 0,
      completion_tokens: 5,
      total_tokens: 35,
    }

    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-stale')
    expect((await store.load())?.usage?.total_tokens ?? 0).toBe(0)

    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-current')
    expect((await store.load())?.usage?.total_tokens).toBe(35)

    const running = await store.load()
    await store.save({
      ...running!,
      status: 'stopped',
      activeDispatch: {
        ...running!.activeDispatch!,
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
      },
    })
    await store.addWorkflowUsage(initial.runId, delta, 'dispatch-current')
    expect((await store.load())?.usage?.total_tokens).toBe(35)
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

  test('does not stop resource work because wall-clock time elapsed', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-wall-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
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

    const dispatch = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
  })

  test('does not stop document work while a model turn remains active', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-document-submit-clock-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await store.save({ ...initial, phase: 'DOCUMENT_DRAFTING' })
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
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: initial.revision.document,
      contract: { documentSet: 'foundation' },
    })

    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
  })

  test('does not stop resource work because no mutation has occurred yet', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-no-mutation-'))
    const store = createRunStore(workspace, 'owner-1')
    const initial = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      checklistApproved: true,
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

    await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: initial.revision.document,
      contract: {},
    })
    await new Promise(resolve => setTimeout(resolve, 40))

    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
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

  test('does not stop reviewer work when cumulative token usage increases', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-token-growth-'))
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
    await store.addWorkflowUsage(
      initial.runId,
      {
        input_tokens: 0,
        cache_read_tokens: 50,
        cache_creation_tokens: 0,
        completion_tokens: 0,
        total_tokens: 50,
      },
      dispatch.dispatchId,
    )
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await store.load()).toMatchObject({
      status: 'running',
      activeDispatch: { status: 'running' },
    })
    expect((await store.load())?.blockedReason).toBeUndefined()
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
        contract: {
          cycleId: 'cycle-1',
          reviewScope: 'foundation',
          reviewMode: 'initial',
          currentCheckIds: ['brief_alignment'],
        },
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
    expect(
      dispatcher.idempotencyKey(
        {
          ...shared,
          workerType: 'document-reviewer',
          contract: {
            cycleId: 'cycle-1',
            reviewScope: 'foundation',
            reviewMode: 'initial',
            currentCheckIds: ['cross_document_consistency'],
          },
        },
        1,
      ),
    ).not.toBe(reviewer)
  })

  test('hands the next reviewer packet through the dispatcher without stopping the cycle session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-review-packet-handoff-'))
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
    const started: WorkerDispatchRequest[] = []
    const stopped: string[] = []
    let dispatcher!: ReturnType<typeof createDeliveryDispatcher>
    const commonContract = {
      cycleId: 'cycle-1',
      reviewScope: 'foundation',
      reviewMode: 'initial',
      requiredCheckIds: ['brief_alignment', 'cross_document_consistency'],
    }
    dispatcher = createDeliveryDispatcher({
      store,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: 'cycle-session',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop(_dispatchId, reason) {
          stopped.push(reason)
        },
        async close() {},
        async status() {
          throw new Error('not used')
        },
      },
      async onTerminal(_record, result) {
        if (result.workerType !== 'document-reviewer') return
        const current = await store.load()
        await store.save({ ...current!, activeDispatch: undefined })
        await dispatcher.dispatch({
          runId: initial.runId,
          ownerId: initial.ownerId,
          projectId: initial.projectId,
          workspacePath: workspace,
          workerType: 'document-reviewer',
          phase: 'DOCUMENT_REVIEW',
          revision: initial.revision.document,
          contract: {
            ...commonContract,
            currentCheckIds: ['cross_document_consistency'],
          },
        })
      },
    })
    const first = await dispatcher.dispatch({
      runId: initial.runId,
      ownerId: initial.ownerId,
      projectId: initial.projectId,
      workspacePath: workspace,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: initial.revision.document,
      contract: { ...commonContract, currentCheckIds: ['brief_alignment'] },
    })
    await dispatcher.completeDispatch(first.dispatchId, {
      workerType: 'document-reviewer',
      revision: initial.revision.document,
      verdict: 'READY',
      checks: [
        {
          id: 'brief_alignment',
          status: 'pass',
          conclusion: 'The brief is aligned.',
          evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
          findingIds: [],
          assessments: [],
        },
      ],
      checklistIds: [],
      findings: [],
      evidencePath: '.beegame/workflow/evidence/packet-1.json',
      rejectedSubmissionCount: 0,
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(started).toHaveLength(2)
    expect(stopped).toEqual([])
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
      checklistIds: [],
      findings: [],
      evidencePath,
      rejectedSubmissionCount: 0,
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
