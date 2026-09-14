import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedHistoricalAuthoredDocument } from '../../__tests__/historical-authored-document-fixture'
import { createDeliveryWorkflowController } from './controller'
import { getGameDocumentContract } from './game-document-contracts'
import { resumeRun } from './recovery'
import { createRunStore } from './run-store'
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
import { createTestDeliveryRun, withTestDocumentMetadata } from '../../__tests__/delivery-workflow-test-helpers'

function baseRun(): DeliveryRun {
  return {
    ...createTestDeliveryRun({
      runId: 'authoring-pause-run',
      projectId: 'authoring-pause-project',
      ownerId: 'authoring-pause-owner',
      foundationDraftComplete: false,
    }),
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    status: 'running',
  }
}

function eightCommittedRun(
  status: DeliveryRun['status'] = 'running',
): DeliveryRun {
  return {
    ...baseRun(),
    status,
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
      documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
        path,
        status: 'committed' as const,
      })),
    },
  }
}

async function journalRequested(
  store: ReturnType<typeof createRunStore>,
  run: DeliveryRun,
): Promise<void> {
  await store.commit(run, {
    runId: run.runId,
    type: 'run.created',
    phase: run.phase,
    status: run.status,
    revision: run.revision,
    foundationAuthoringPause: 'requested',
  })
}

async function journalPauseChange(
  store: ReturnType<typeof createRunStore>,
  run: DeliveryRun,
  foundationAuthoringPause: 'reached' | null,
): Promise<void> {
  await store.appendEvent({
    runId: run.runId,
    type: 'foundation.authoring.pause_changed',
    phase: run.phase,
    status: run.status,
    revision: run.revision,
    foundationAuthoringPause,
  })
}

function workerPortThatRejectsDispatches(dispatches: unknown[]) {
  return {
    start: async (request: WorkerDispatchRequest) => {
      dispatches.push(request)
      throw new Error('unexpected post-authoring dispatch')
    },
    submit: async () => undefined,
    stop: async () => undefined,
    status: async () => {
      throw new Error('no dispatch should exist')
    },
  }
}

describe('Foundation authoring handoff pause', () => {
  test('stale resume and ensureProgress do not consume a reached pause or dispatch review', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-pause-stale-'))
    try {
      const durableRun = eightCommittedRun('stopped')
      const store = createRunStore(workspacePath, durableRun.ownerId)
      await journalRequested(store, durableRun)
      await journalPauseChange(store, durableRun, 'reached')
      const before = await readFile(store.paths.snapshot, 'utf8')
      const dispatches: unknown[] = []
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: durableRun.ownerId,
        workerPort: workerPortThatRejectsDispatches(dispatches),
      })
      const staleRun = {
        ...durableRun,
        status: 'running' as const,
      }

      await controller.resume(staleRun)
      await controller.ensureProgress(staleRun)

      expect(dispatches).toEqual([])
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(before)
      const saved = await store.load()
      expect(saved).toMatchObject({
        status: 'stopped',
      })
      expect(saved?.foundationAuditState).toBeUndefined()
      expect(Object.hasOwn(saved ?? {}, 'foundationAuthoringPause')).toBe(false)
      expect(
        (await store.readEvents()).findLast(event => event.foundationAuthoringPause !== undefined)?.foundationAuthoringPause,
      ).toBe('reached')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('a requested pause on a mid-authoring stopped run remains requested during stale recovery', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-pause-mid-'))
    try {
      const run = {
        ...baseRun(),
        status: 'stopped' as const,
        foundationDraftState: {
          completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
        },
      }
      const store = createRunStore(workspacePath, run.ownerId)
      await journalRequested(store, run)

      const before = await readFile(store.paths.snapshot, 'utf8')
      await expect(resumeRun({ store, runId: run.runId, workspacePath })).rejects.toThrow('retired')
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(before)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('preserves a historical eighth-author terminal instead of replaying the retired controller path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-pause-terminal-'))
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
      const finalPath = CANONICAL_FOUNDATION_DOCUMENTS.at(-1)!
      const dispatchId = 'eighth-author-pause-terminal'
      await seedHistoricalAuthoredDocument({
        workspacePath,
        dispatchId,
        targetPath: finalPath,
      })

      const run = {
        ...baseRun(),
        foundationDraftState: {
          completedPaths: CANONICAL_FOUNDATION_DOCUMENTS.slice(0, -1),
          documents: CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
            path,
            status: index === CANONICAL_FOUNDATION_DOCUMENTS.length - 1
              ? ('drafting' as const)
              : ('committed' as const),
          })),
        },
      }
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
        startedAt: '2026-09-05T00:00:00.000Z',
        finishedAt: '2026-09-05T00:01:00.000Z',
      }
      const terminalRun = {
        ...run,
        activeDispatch: terminal,
        foundationDraftState: {
          ...run.foundationDraftState,
          documents: run.foundationDraftState.documents?.map((document, index) =>
            index === CANONICAL_FOUNDATION_DOCUMENTS.length - 1
              ? { ...document, dispatch: terminal }
              : document,
          ),
        },
      }
      const store = createRunStore(workspacePath, run.ownerId)
      await journalRequested(store, terminalRun)
      const dispatches: unknown[] = []
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: workerPortThatRejectsDispatches(dispatches),
      })

      const snapshotBeforeResume = await readFile(store.paths.snapshot, 'utf8')
      await expect(controller.resume(terminalRun)).rejects.toThrow('legacy author execution is retired')

      const saved = await store.load()
      expect(dispatches).toEqual([])
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'running',
      })
      expect(saved?.foundationAuditState).toBeUndefined()
      expect(Object.hasOwn(saved ?? {}, 'foundationAuthoringPause')).toBe(false)
      expect(
        (await store.readEvents()).findLast(event => event.foundationAuthoringPause !== undefined)?.foundationAuthoringPause,
      ).toBe('requested')
      expect(saved?.foundationDraftState.completedPaths).toEqual(CANONICAL_FOUNDATION_DOCUMENTS.slice(0, -1))
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(snapshotBeforeResume)
      const auditEntries = await readdir(
        join(workspacePath, '.beegame/audit/foundation'),
      ).catch(() => undefined)
      expect(auditEntries).toBeUndefined()

      const snapshotAfterPause = await readFile(store.paths.snapshot, 'utf8')
      const replayDispatches: unknown[] = []
      const recreated = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: workerPortThatRejectsDispatches(replayDispatches),
      })
      const staleTerminalRun = {
        ...terminalRun,
        status: 'running' as const,
      }
      await expect(recreated.resume(staleTerminalRun)).rejects.toThrow('legacy author execution is retired')
      await expect(recreated.ensureProgress(staleTerminalRun)).rejects.toThrow('legacy author execution is retired')
      expect(replayDispatches).toEqual([])
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(
        snapshotAfterPause,
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

})
