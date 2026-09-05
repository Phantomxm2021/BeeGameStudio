import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import {
  beginParallelFoundationAuthoring,
  recordFoundationDispatch,
} from './foundation-authoring-batch'
import { resumeFoundationAuthors } from './foundation-authoring-scheduler'
import {
  startDocumentStage,
  completeFoundationDocumentDraft,
} from './foundation-authoring-stage'
import type { DeliveryRun, DispatchRecord } from './types'

function fixture(): DeliveryRun {
  const run = createTestDeliveryRun({
    runId: 'r',
    ownerId: 'o',
    projectId: 'p',
    foundationDraftComplete: false,
  })
  const dispatch: DispatchRecord = {
    dispatchId: 'level',
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    revision: run.revision.document,
    taskId: 'docs/LEVEL_SCENE_DESIGN.md',
    status: 'running',
    startedAt: '2026-09-05T00:00:00.000Z',
  }
  return {
    ...run,
    phase: 'DOCUMENT_DRAFTING',
    status: 'running',
    foundationDraftState: recordFoundationDispatch(
      beginParallelFoundationAuthoring(['docs/GDD.md']),
      'docs/LEVEL_SCENE_DESIGN.md',
      'drafting',
      dispatch,
    ),
  }
}

function capabilities(run: DeliveryRun, open = true) {
  const calls: string[] = []
  let saved: DeliveryRun | undefined
  return {
    calls,
    get saved() {
      return saved
    },
    input: {
      run,
      workspacePath: '/unused',
      dispatcher: {
        async dispatch() {
          calls.push('dispatch')
        },
        async workerIsOpen() {
          calls.push('isOpen')
          return open
        },
        async replayTerminal() {
          calls.push('replay')
        },
      },
      async handleTerminal() {
        calls.push('terminal')
      },
      async persist(next: DeliveryRun) {
        calls.push('persist')
        saved = next
      },
    },
  }
}

describe('Stage 2 private scheduling boundary', () => {
  test('does not inspect workers or mutate another stage even with stale author state', async () => {
    for (const phase of [
      'DOCUMENT_REVIEW',
      'FOUNDATION_REVISION',
      'RESOURCE_PREPARATION',
    ] as const) {
      const run = { ...fixture(), phase }
      const before = JSON.stringify(run)
      const c = capabilities(run)
      expect(await resumeFoundationAuthors(c.input)).toBe(false)
      expect(c.calls).toEqual([])
      expect(JSON.stringify(run)).toBe(before)
      await expect(
        startDocumentStage({
          run,
          workspacePath: '/unused',
          dispatcher: c.input.dispatcher,
        }),
      ).rejects.toThrow('DOCUMENT_DRAFTING')
      await expect(
        completeFoundationDocumentDraft({
          run,
          workspacePath: '/unused',
          terminal: {
            workerType: 'document-author',
            status: 'completed',
            writtenPaths: [],
            resolvedFindingIds: [],
          },
        }),
      ).rejects.toThrow('DOCUMENT_DRAFTING')
    }
  })

  test('replays an admitted terminal before inspecting or starting any worker', async () => {
    const run = fixture()
    run.foundationDraftState.documents![1]!.dispatch!.terminalResult = {
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
      resolvedFindingIds: [],
    }
    const c = capabilities(run)
    expect(await resumeFoundationAuthors(c.input)).toBe(true)
    expect(c.calls).toEqual(['replay'])
  })

  test('does not duplicate live authors or release descendants early', async () => {
    const c = capabilities(fixture())
    expect(await resumeFoundationAuthors(c.input)).toBe(true)
    expect(c.calls).toEqual(['isOpen'])
  })

  test('persists one unavailable-session result without mutating the caller snapshot', async () => {
    const run = fixture()
    const before = JSON.stringify(run)
    const c = capabilities(run, false)
    expect(await resumeFoundationAuthors(c.input)).toBe(true)
    expect(c.calls).toEqual(['isOpen', 'persist'])
    expect(c.saved?.status).toBe('needs_action')
    expect(c.saved?.blockedReason).toBe(
      'preserved native document session is unavailable',
    )
    expect(c.saved?.foundationDraftState.documents![1]!.status).toBe(
      'needs_action',
    )
    expect(JSON.stringify(run)).toBe(before)
  })

  test('never resumes a stopped author batch', async () => {
    const c = capabilities({ ...fixture(), status: 'stopped' })
    expect(await resumeFoundationAuthors(c.input)).toBe(false)
    expect(c.calls).toEqual([])
  })
})
