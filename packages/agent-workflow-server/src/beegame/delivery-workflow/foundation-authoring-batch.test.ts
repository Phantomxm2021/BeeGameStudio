import { describe, expect, test } from 'bun:test'
import {
  MAX_PARALLEL_FOUNDATION_DRAFTS,
  beginParallelFoundationAuthoring,
  readyDraftPaths,
  recordFoundationCommit,
  recordFoundationDispatch,
  recordFoundationFailure,
} from './foundation-authoring-batch'
import type { FoundationDocumentPath, FoundationDraftState } from './types'

function dispatchAndCommit(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
): FoundationDraftState {
  return recordFoundationCommit(
    recordFoundationDispatch(state, path, 'drafting', {
      dispatchId: `dispatch-${path}`,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: path,
      revision: 'revision-1',
      status: 'running',
      startedAt: new Date().toISOString(),
    }),
    path,
  )
}

describe('parallel foundation authoring batch', () => {
  test('releases documents only when every contracted upstream is committed', () => {
    let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    expect(readyDraftPaths(state)).toEqual(['docs/LEVEL_SCENE_DESIGN.md'])

    state = dispatchAndCommit(state, 'docs/LEVEL_SCENE_DESIGN.md')
    expect(readyDraftPaths(state)).toEqual([
      'docs/BALANCE_DESIGN.md',
      'docs/UI_UX_SPEC.md',
    ])

    for (const path of [
      'docs/BALANCE_DESIGN.md',
      'docs/UI_UX_SPEC.md',
    ] as const)
      state = dispatchAndCommit(state, path)
    expect(readyDraftPaths(state)).toEqual([
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/AUDIO_DESIGN.md',
    ])

    for (const path of [
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/AUDIO_DESIGN.md',
    ] as const)
      state = dispatchAndCommit(state, path)
    expect(readyDraftPaths(state)).toEqual(['docs/ASSET_PLAN.md'])

    state = dispatchAndCommit(state, 'docs/ASSET_PLAN.md')
    expect(readyDraftPaths(state)).toEqual([])
    expect(state.completedPaths).toHaveLength(8)
  })

  test('bounds the active pool without creating a calibration state', () => {
    expect(MAX_PARALLEL_FOUNDATION_DRAFTS).toBe(4)
    let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    state = recordFoundationDispatch(
      state,
      'docs/LEVEL_SCENE_DESIGN.md',
      'drafting',
      {
        dispatchId: 'dispatch-level',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'docs/LEVEL_SCENE_DESIGN.md',
        revision: 'revision-1',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    )
    expect(readyDraftPaths(state)).toEqual([])
    expect(JSON.stringify(state)).not.toContain('calibrat')
    expect(JSON.stringify(state)).not.toContain('draftDigest')
  })

  test('commits directly from the active stream and fails closed without requeueing an author', () => {
    const state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    expect(() =>
      recordFoundationCommit(state, 'docs/LEVEL_SCENE_DESIGN.md'),
    ).toThrow('drafting')

    const drafting = recordFoundationDispatch(
      state,
      'docs/LEVEL_SCENE_DESIGN.md',
      'drafting',
      {
        dispatchId: 'dispatch-level',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'docs/LEVEL_SCENE_DESIGN.md',
        revision: 'revision-1',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    )
    const failed = recordFoundationFailure(
      drafting,
      'docs/LEVEL_SCENE_DESIGN.md',
      'provider stopped',
    )
    expect(failed.documents?.[1]).toMatchObject({
      status: 'needs_action',
      failureReason: 'provider stopped',
    })
    expect(failed.documents?.[2]?.status).toBe('pending')
    expect(readyDraftPaths(failed)).toEqual([])
  })

  test('uses committed status only and ignores prose or digest-shaped metadata', () => {
    const state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    state.documents![1] = {
      ...state.documents![1]!,
      status: 'pending',
      failureReason: 'upstream unavailable and unresolved',
      upstreamDigests: { 'docs/GDD.md': 'stale' },
    }

    expect(readyDraftPaths(state)).toEqual(['docs/LEVEL_SCENE_DESIGN.md'])
  })

})
