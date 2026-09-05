import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryWorkflowController } from './controller'
import { createRunStore } from './run-store'
import { retryRun } from './recovery'
import { commitAuthoredFoundationDocument } from '../authored-document-receipt'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  type DeliveryRun,
  type DispatchRecord,
  type WorkerDispatchRequest,
} from './types'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../__tests__/delivery-workflow-test-helpers'
import { getGameDocumentContract } from './game-document-contracts'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  projectFoundationAuthority,
} from '../foundation-authority-projection'

async function writeCommittedProjection(
  workspacePath: string,
  dispatchId: string,
  targetPath: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): Promise<void> {
  const contract = getGameDocumentContract(targetPath)
  const documents = new Map(await Promise.all(
    foundationAuthoringSources(targetPath).map(async source => [
      source.path,
      await readFile(join(workspacePath, source.path), 'utf8'),
    ] as const),
  ))
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: foundationAuthoringSources(targetPath).map(source => source.path),
    documents,
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
  await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
}

function runWithEightCommittedDocs(): DeliveryRun {
  const paths = [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
    'docs/ASSET_PLAN.md',
  ] as const
  return {
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    runId: 'run-cutover',
    projectId: 'project-cutover',
    ownerId: 'owner-cutover',
    confirmedBriefDigest: 'a'.repeat(64),
    confirmedBriefContext: 'confirmed brief',
    phase: 'DOCUMENT_DRAFTING',
    status: 'running',
    revision: { document: 'b'.repeat(64), workspace: 'c'.repeat(64) },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: [...paths],
      documents: paths.map(path => ({ path, status: 'committed' as const })),
    },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

describe('foundation audit cutover', () => {
  test('does not dispatch a legacy reviewer after the eighth author receipt', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-cutover-'))
    const dispatches: unknown[] = []
    try {
      const run = runWithEightCommittedDocs()
      const store = createRunStore(workspacePath, run.ownerId)
      await store.save(run)
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: {
          start: async request => {
            dispatches.push(request)
            throw new Error('legacy reviewer dispatch must not start')
          },
          submit: async () => undefined,
          stop: async () => undefined,
          status: async () => {
            throw new Error('no dispatch should exist')
          },
        },
      })
      await controller.resume(run)
      const saved = await store.load()

      expect(dispatches).toEqual([])
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        status: 'needs_action',
        blockedReason: 'foundation audit derivation failed: committed foundation document is missing: docs/GDD.md',
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('cuts over immediately after the real eighth author terminal is accepted', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-terminal-cutover-'))
    const dispatches: unknown[] = []
    try {
      const finalPath = CANONICAL_FOUNDATION_DOCUMENTS.at(-1)!
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
        await writeFile(
          join(workspacePath, path),
          withTestDocumentMetadata(
            path,
            renderTestCompleteGameDocument(path, completeTestSubmission(path)),
          ),
        )
      const dispatchId = 'eighth-author-terminal'
      await writeCommittedProjection(workspacePath, dispatchId, finalPath)
      await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId,
        targetPath: finalPath,
      })
      const run = runWithEightCommittedDocs()
      const request = {
        dispatchId,
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: finalPath,
        revision: run.revision.document,
        allowedPaths: [finalPath],
        contract: {
          confirmedBriefDigest: run.confirmedBriefDigest,
          documentSet: 'foundation',
          authoringMode: 'parallel-draft',
          foundationDocumentPath: finalPath,
        },
      }
      const terminal: DispatchRecord = {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: finalPath,
        revision: run.revision.document,
        status: 'completed',
        request,
        terminalResult: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: [finalPath],
          resolvedFindingIds: [],
        },
        startedAt: '2026-08-24T00:00:00.000Z',
        finishedAt: '2026-08-24T00:01:00.000Z',
      }
      const store = createRunStore(workspacePath, run.ownerId)
      const terminalRun = {
        ...run,
        foundationDraftState: {
          completedPaths: CANONICAL_FOUNDATION_DOCUMENTS.slice(0, -1),
          documents: CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) =>
            index === CANONICAL_FOUNDATION_DOCUMENTS.length - 1
              ? { path, status: 'drafting' as const, dispatch: terminal }
              : { path, status: 'committed' as const },
          ),
        },
      }
      await store.save(terminalRun)
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: {
          start: async request => {
            dispatches.push(request)
            return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! }
          },
          submit: async () => undefined,
          stop: async () => undefined,
          status: async dispatchId => ({ dispatchId, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'unknown', revision: run.revision.document, status: 'running', startedAt: new Date().toISOString() }),
        },
      })
      await controller.resume(terminalRun)
      const saved = await store.load()

      expect(dispatches).toHaveLength(4)
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'running',
        foundationAuditState: { status: 'extracting_facts' },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('retries derivation from the durable review snapshot after a failed derivation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derivation-retry-'))
    const dispatches: WorkerDispatchRequest[] = []
    try {
      const run = {
        ...runWithEightCommittedDocs(),
        phase: 'DOCUMENT_REVIEW' as const,
        documentStep: 'FOUNDATION_REVIEW' as const,
      }
      const store = createRunStore(workspacePath, run.ownerId)
      await store.save(run)
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: {
          start: async request => {
            dispatches.push(request)
            return { sessionId: `session-${request.taskId}`, dispatchId: request.dispatchId! }
          },
          submit: async () => undefined,
          stop: async () => undefined,
          status: async dispatchId => ({ dispatchId, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'unknown', revision: run.revision.document, status: 'running', startedAt: new Date().toISOString() }),
        },
      })

      await controller.resume(run)
      expect(await store.load()).toMatchObject({
        status: 'needs_action',
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      })
      expect((await store.load())?.foundationAuditState).toBeUndefined()

      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
        await writeFile(
          join(workspacePath, path),
          withTestDocumentMetadata(
            path,
            renderTestCompleteGameDocument(path, completeTestSubmission(path)),
          ),
        )

      const retried = await retryRun({ store, runId: run.runId, workspacePath })
      await controller.resume(retried)

      const resumed = await store.load()
      expect(resumed).toMatchObject({
        status: 'running',
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        foundationAuditState: { status: 'extracting_facts' },
      })
      expect(dispatches).toHaveLength(4)
      expect(new Set(dispatches.map(request => request.taskId)).size).toBe(4)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('concurrent resume of one stale review snapshot keeps one fact task set and four running workers', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derivation-concurrent-'))
    const dispatches: WorkerDispatchRequest[] = []
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
        await writeFile(
          join(workspacePath, path),
          withTestDocumentMetadata(
            path,
            renderTestCompleteGameDocument(path, completeTestSubmission(path)),
          ),
        )
      const run = {
        ...runWithEightCommittedDocs(),
        phase: 'DOCUMENT_REVIEW' as const,
        documentStep: 'FOUNDATION_REVIEW' as const,
      }
      const store = createRunStore(workspacePath, run.ownerId)
      await store.save(run)
      const workerPort = {
        start: async (request: WorkerDispatchRequest) => {
          dispatches.push(request)
          return { sessionId: `session-${request.taskId}`, dispatchId: request.dispatchId! }
        },
        submit: async () => undefined,
        stop: async () => undefined,
        status: async (dispatchId: string) => ({ dispatchId, workerType: 'foundation-fact-extractor' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: 'unknown', revision: run.revision.document, status: 'running' as const, startedAt: new Date().toISOString() }),
      }
      const first = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort })
      const second = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort })

      await Promise.all([first.resume(run), second.resume(run)])

      const resumed = await store.load()
      const tasks = resumed?.foundationAuditState?.tasks ?? []
      expect(resumed).toMatchObject({ status: 'running', foundationAuditState: { status: 'extracting_facts' } })
      expect(tasks).toHaveLength(8)
      expect(tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(new Set(tasks.map(task => task.taskId)).size).toBe(8)
      expect(dispatches).toHaveLength(4)

      // A stale controller can also present a pending task that was not in the
      // first controller's wave. Once the durable state has four workers, the
      // concurrency-limit duplicate is benign and must not leak or mutate the
      // run into needs_action.
      const durable = await store.load()
      if (!durable?.foundationAuditState) throw new Error('foundation audit state is missing')
      const staleTasks = durable.foundationAuditState.tasks.map(task => {
        const { dispatch: _dispatch, ...withoutDispatch } = task
        return { ...withoutDispatch, status: 'pending' as const, attempt: 0 } as typeof task
      })
      const pendingTarget = staleTasks[4]!
      const stale = {
        ...durable,
        foundationAuditState: {
          ...durable.foundationAuditState,
          tasks: [pendingTarget, ...staleTasks.filter(task => task.taskId !== pendingTarget.taskId)],
        },
      } as DeliveryRun
      await second.resume(stale)
      const converged = await store.load()
      expect(converged).toMatchObject({ status: 'running', foundationAuditState: { status: 'extracting_facts' } })
      expect(converged?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(dispatches).toHaveLength(4)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
import { foundationAuthoringSources } from './foundation-authoring-contract'
