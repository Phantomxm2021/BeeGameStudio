import { describe, expect, test } from 'bun:test'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
  type WorkerDispatchRequest,
} from '../types'
import { buildFoundationAuthorPrompt } from '../foundation-authoring-prompt'
import { startDocumentStage } from '../foundation-authoring-stage'
import {
  beginParallelFoundationAuthoring,
  MAX_PARALLEL_FOUNDATION_DRAFTS,
  readyDraftPaths,
  recordFoundationCommit,
  recordFoundationDispatch,
  recordFoundationFailure,
} from '../foundation-authoring-batch'
import { retryAuthorState } from '../foundation-authoring-state'
import { foundationAuthoringSources } from '../foundation-authoring-contract'
import { authoringRun } from '../../test-fixtures/authoring-context'

type AuthoringCapture = {
  requestsByPath: Record<FoundationDocumentPath, WorkerDispatchRequest>
  readyBatches: FoundationDocumentPath[][]
}

async function capturePrivateAuthoring(): Promise<AuthoringCapture> {
  const requests: WorkerDispatchRequest[] = []
  const dispatcher = {
    dispatch: async (request: WorkerDispatchRequest) => {
      requests.push(request)
      return request
    },
  }
  await startDocumentStage({
    run: authoringRun(),
    workspacePath: '/tmp/authoring-domain-behavior',
    dispatcher,
  })

  let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
  const readyBatches: FoundationDocumentPath[][] = []
  let sequence = 0
  while (true) {
    const ready = readyDraftPaths(state)
    if (!ready.length) break
    readyBatches.push([...ready])
    const before = requests.length
    await startDocumentStage({
      run: { ...authoringRun(), foundationDraftState: state } as never,
      workspacePath: '/tmp/authoring-domain-behavior',
      dispatcher,
    })
    for (const request of requests.slice(before)) {
      const path = request.taskId as FoundationDocumentPath
      state = recordFoundationDispatch(state, path, 'drafting', {
        dispatchId: `private-${sequence++}`,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: path,
        revision: request.revision,
        status: 'running',
        startedAt: '2026-09-05T00:00:00.000Z',
      })
      state = recordFoundationCommit(state, path)
    }
  }

  return {
    requestsByPath: Object.fromEntries(
      requests.map(request => [request.taskId, request]),
    ) as Record<FoundationDocumentPath, WorkerDispatchRequest>,
    readyBatches,
  }
}

describe('private Author-domain behavior', () => {
  test('dispatches every canonical document with a narrow path and prompt boundary', async () => {
    const capture = await capturePrivateAuthoring()
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const request = capture.requestsByPath[path]
      expect(request.workerType).toBe('document-author')
      expect(request.phase).toBe('DOCUMENT_DRAFTING')
      expect(request.allowedPaths).toEqual([path])
      expect(buildFoundationAuthorPrompt(request)).not.toContain('systemDeliveryContract')
      expect(buildFoundationAuthorPrompt(request)).not.toContain('availableUpstreamPaths')
      expect(buildFoundationAuthorPrompt(request)).not.toContain('confirmedBriefContext')
    }
    expect(buildFoundationAuthorPrompt(capture.requestsByPath['docs/TECHNICAL_DESIGN.md'])).toContain('authoringDeliveryContract')
    expect(buildFoundationAuthorPrompt(capture.requestsByPath['docs/ASSET_PLAN.md'])).toContain('authoringDeliveryContract')
  })

  test('keeps dependency gates and the four-author ceiling explicit', () => {
    expect(MAX_PARALLEL_FOUNDATION_DRAFTS).toBe(4)
    expect(foundationAuthoringSources('docs/ASSET_PLAN.md').map(value => value.path)).toEqual([
      'docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md',
    ])
    let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    const expectedBatches: FoundationDocumentPath[][] = [
      ['docs/LEVEL_SCENE_DESIGN.md'],
      ['docs/BALANCE_DESIGN.md', 'docs/UI_UX_SPEC.md'],
      ['docs/TECHNICAL_DESIGN.md', 'docs/ART_DIRECTION.md'],
      ['docs/AUDIO_DESIGN.md'],
      ['docs/ASSET_PLAN.md'],
    ]
    for (const expected of expectedBatches) {
      expect(readyDraftPaths(state)).toEqual(expected)
      for (const path of expected) {
        state = recordFoundationDispatch(state, path, 'drafting', {
          dispatchId: `private-${path}`,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: path,
          revision: 'revision',
          status: 'running',
          startedAt: '2026-09-05T00:00:00.000Z',
        })
      }
      expect(readyDraftPaths(state)).toEqual([])
      for (const path of expected) state = recordFoundationCommit(state, path)
    }
    expect(readyDraftPaths(state)).toEqual([])
    expect(state.completedPaths).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
  })

  test('retains failed documents as needs_action and retries only the selected document', () => {
    let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    state = recordFoundationDispatch(state, path, 'drafting', {
      dispatchId: 'private-level', workerType: 'document-author', phase: 'DOCUMENT_DRAFTING',
      taskId: path, revision: 'revision', status: 'running', startedAt: '2026-09-05T00:00:00.000Z',
    })
    const failed = recordFoundationFailure(state, path, 'provider stopped')
    expect(failed.documents?.find(document => document.path === path)).toMatchObject({ status: 'needs_action', failureReason: 'provider stopped' })
    expect(readyDraftPaths(failed)).toEqual([])
    const retried = retryAuthorState(failed, path)
    expect(retried.revived).toBe(true)
    expect(retried.state.documents?.find(document => document.path === path)).toMatchObject({ status: 'pending' })
    expect(retried.state.documents?.find(document => document.path === path)?.failureReason).toBeUndefined()
    expect(readyDraftPaths(retried.state)).toEqual([path])
  })

  test('rejects retry-only and foreign fields without widening an author request', async () => {
    const request = (await capturePrivateAuthoring()).requestsByPath['docs/GDD.md']
    expect(() => buildFoundationAuthorPrompt({
      ...request,
      contract: { ...request.contract, priorFailureReason: 'must not be accepted' },
    })).toThrow('retry contract is removed')
    expect(() => buildFoundationAuthorPrompt({
      ...request,
      contract: { ...request.contract, foundationDocumentPath: 'docs/not-a-foundation-file.md' as never },
    })).toThrow('canonical document path')
  })
})
