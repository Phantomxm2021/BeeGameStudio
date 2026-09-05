import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAuthoredFoundationDocument } from '../authored-document-receipt'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  projectFoundationAuthority,
} from '../foundation-authority-projection'
import { createDeliveryWorkflowController } from './controller'
import {
  pauseFoundationAuthoringHandoff,
  readFoundationAuthoringPause,
} from './foundation-audit-boundary'
import { foundationAuthoringSources } from './foundation-authoring-contract'
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

async function writeCommittedProjection(
  workspacePath: string,
  dispatchId: string,
  targetPath: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): Promise<void> {
  const documents = new Map(
    await Promise.all(
      foundationAuthoringSources(targetPath).map(async source => [
        source.path,
        await readFile(join(workspacePath, source.path), 'utf8'),
      ] as const),
    ),
  )
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: foundationAuthoringSources(targetPath).map(
      source => source.path,
    ),
    documents,
  })
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), {
    recursive: true,
  })
  await writeFile(
    join(workspacePath, foundationProjectionRelativePath(dispatchId)),
    canonicalFoundationAuthorityProjectionBytes(projection),
  )
}

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
  test('keeps default and partial authoring runs unchanged and stops a complete eight-document run', () => {
    expect(pauseFoundationAuthoringHandoff(baseRun(), undefined)).toBeUndefined()

    const defaultRun = baseRun()
    expect(pauseFoundationAuthoringHandoff(defaultRun, 'requested')).toBeUndefined()

    const partialRun = {
      ...defaultRun,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    expect(pauseFoundationAuthoringHandoff(partialRun, 'requested')).toBeUndefined()

    const completeUnpaused = eightCommittedRun()
    expect(
      pauseFoundationAuthoringHandoff(completeUnpaused, undefined),
    ).toBeUndefined()

    const paused = pauseFoundationAuthoringHandoff(
      eightCommittedRun(),
      'requested',
    )
    expect(paused).toMatchObject({
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'stopped',
      blockedReason: 'foundation authoring complete; paused before review',
    })
    expect(Object.hasOwn(paused ?? {}, 'foundationAuthoringPause')).toBe(false)
    expect(paused?.foundationAuditState).toBeUndefined()

    const pausedNeedsAction = pauseFoundationAuthoringHandoff(
      { ...eightCommittedRun(), status: 'needs_action' },
      'requested',
    )
    expect(pausedNeedsAction).toMatchObject({
      status: 'stopped',
    })
    expect(Object.hasOwn(pausedNeedsAction ?? {}, 'foundationAuthoringPause')).toBe(false)

    const alreadyAudited = {
      ...eightCommittedRun(),
      foundationAuditState: { status: 'extracting_facts' } as never,
    }
    expect(
      pauseFoundationAuthoringHandoff(alreadyAudited, 'requested'),
    ).toBeUndefined()

    const alreadyStopped = eightCommittedRun('stopped')
    expect(pauseFoundationAuthoringHandoff(alreadyStopped, 'reached')).toBe(
      alreadyStopped,
    )
  })

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
        readFoundationAuthoringPause(await store.readEvents(), durableRun.runId),
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

      const resumed = await resumeRun({
        store,
        runId: run.runId,
        workspacePath,
      })

      expect(resumed).toMatchObject({
        status: 'running',
        foundationDraftState: {
          completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
        },
      })
      expect(Object.hasOwn(resumed, 'foundationAuthoringPause')).toBe(false)
      expect(
        readFoundationAuthoringPause(await store.readEvents(), run.runId),
      ).toBe('requested')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('stops immediately after the real eighth author terminal without audit or reviewer dispatch', async () => {
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
      await writeCommittedProjection(workspacePath, dispatchId, finalPath)
      await commitAuthoredFoundationDocument({
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

      await controller.resume(terminalRun)

      const saved = await store.load()
      expect(dispatches).toEqual([])
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
      })
      expect(saved?.foundationAuditState).toBeUndefined()
      expect(Object.hasOwn(saved ?? {}, 'foundationAuthoringPause')).toBe(false)
      expect(
        readFoundationAuthoringPause(await store.readEvents(), run.runId),
      ).toBe('reached')
      expect(saved?.foundationDraftState.completedPaths).toEqual([
        ...CANONICAL_FOUNDATION_DOCUMENTS,
      ])
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
      await recreated.resume(staleTerminalRun)
      await recreated.ensureProgress(staleTerminalRun)
      expect(replayDispatches).toEqual([])
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(
        snapshotAfterPause,
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('explicit resume consumes the pause and enters ordinary Foundation review', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-pause-resume-'))
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
      await writeCommittedProjection(workspacePath, 'resume-authority', finalPath)
      await commitAuthoredFoundationDocument({
        workspacePath,
        dispatchId: 'resume-authority',
        targetPath: finalPath,
      })

      const run = eightCommittedRun('stopped')
      const store = createRunStore(workspacePath, run.ownerId)
      await journalRequested(store, run)
      await journalPauseChange(store, run, 'reached')
      const dispatches: WorkerDispatchRequest[] = []
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: {
          start: async request => {
            dispatches.push(request)
            return {
              sessionId: `session-${request.taskId}`,
              dispatchId: request.dispatchId!,
            }
          },
          submit: async () => undefined,
          stop: async () => undefined,
          status: async dispatchId => ({
            dispatchId,
            workerType: 'foundation-fact-extractor' as const,
            phase: 'DOCUMENT_REVIEW' as const,
            taskId: 'unknown',
            revision: run.revision.document,
            status: 'running' as const,
            startedAt: new Date().toISOString(),
          }),
        },
      })

      const resumed = await resumeRun({
        store,
        runId: run.runId,
        workspacePath,
      })
      expect(resumed).toMatchObject({
        status: 'running',
      })
      expect(Object.hasOwn(resumed, 'foundationAuthoringPause')).toBe(false)
      expect(
        readFoundationAuthoringPause(await store.readEvents(), run.runId),
      ).toBeUndefined()
      await controller.resume(resumed)

      const saved = await store.load()
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'running',
        foundationAuditState: { status: 'extracting_facts' },
      })
      expect(Object.hasOwn(saved ?? {}, 'foundationAuthoringPause')).toBe(false)
      expect(dispatches).toHaveLength(4)
      expect(new Set(dispatches.map(request => request.taskId)).size).toBe(4)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
