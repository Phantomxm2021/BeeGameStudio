import { describe, expect, test } from 'bun:test'
import {
  MAX_PARALLEL_FOUNDATION_DRAFTS,
  beginParallelFoundationAuthoring,
  readyCalibrationPaths,
  readyDraftPaths,
  recordFoundationCommit,
  recordFoundationDispatch,
  recordFoundationDraft,
  recordFoundationFailure,
} from './foundation-authoring-batch'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const DIGEST = 'a'.repeat(64)

function completeDrafts() {
  return CANONICAL_FOUNDATION_DOCUMENTS.slice(1).reduce(
    (state, path) =>
      recordFoundationDraft(state, path, {
        digest: DIGEST,
        workerSessionId: `session:${path}`,
      }),
    beginParallelFoundationAuthoring(['docs/GDD.md']),
  )
}

describe('parallel foundation authoring batch', () => {
  test('starts every downstream foundation draft after GDD commits', () => {
    const state = beginParallelFoundationAuthoring(['docs/GDD.md'])

    expect(readyDraftPaths(state)).toEqual(
      CANONICAL_FOUNDATION_DOCUMENTS.slice(
        1,
        MAX_PARALLEL_FOUNDATION_DRAFTS + 1,
      ),
    )
    expect(readyCalibrationPaths(state)).toEqual([])
    expect(state.completedPaths).toEqual(['docs/GDD.md'])
  })

  test('refills a bounded draft pool as one author finishes', () => {
    let state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS.slice(
      1,
      MAX_PARALLEL_FOUNDATION_DRAFTS + 1,
    ))
      state = recordFoundationDispatch(state, path, 'drafting', {
        dispatchId: `dispatch:${path}`,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: path,
        revision: 'revision-1',
        status: 'running',
        startedAt: new Date().toISOString(),
      })

    expect(readyDraftPaths(state)).toEqual([])

    state = recordFoundationDraft(
      state,
      CANONICAL_FOUNDATION_DOCUMENTS[1],
      {
        digest: 'a'.repeat(64),
        workerSessionId: 'session:level',
      },
    )
    expect(readyDraftPaths(state)).toEqual([
      CANONICAL_FOUNDATION_DOCUMENTS[MAX_PARALLEL_FOUNDATION_DRAFTS + 1],
    ])
  })

  test('releases calibration in canonical dependency waves', () => {
    const drafted = completeDrafts()
    expect(readyCalibrationPaths(drafted)).toEqual([
      'docs/LEVEL_SCENE_DESIGN.md',
    ])

    const level = recordFoundationCommit(
      drafted,
      'docs/LEVEL_SCENE_DESIGN.md',
    )
    expect(readyCalibrationPaths(level)).toEqual([
      'docs/BALANCE_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
    ])

    const secondWave = [
      'docs/BALANCE_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
    ] as const
    const calibratedSecondWave = secondWave.reduce(
      (state, path) => recordFoundationCommit(state, path),
      level,
    )
    expect(readyCalibrationPaths(calibratedSecondWave)).toEqual([
      'docs/TECHNICAL_DESIGN.md',
      'docs/AUDIO_DESIGN.md',
    ])

    const thirdWave = [
      'docs/TECHNICAL_DESIGN.md',
      'docs/AUDIO_DESIGN.md',
    ] as const
    const calibratedThirdWave = thirdWave.reduce(
      (state, path) => recordFoundationCommit(state, path),
      calibratedSecondWave,
    )
    expect(readyCalibrationPaths(calibratedThirdWave)).toEqual([
      'docs/ASSET_PLAN.md',
    ])

    const complete = recordFoundationCommit(
      calibratedThirdWave,
      'docs/ASSET_PLAN.md',
    )
    expect(readyCalibrationPaths(complete)).toEqual([])
    expect(complete.completedPaths).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ])
  })

  test('rejects draft and commit transitions without their prerequisites', () => {
    const state = beginParallelFoundationAuthoring(['docs/GDD.md'])

    expect(() =>
      recordFoundationDraft(state, 'docs/LEVEL_SCENE_DESIGN.md', {
        digest: 'not-a-digest',
        workerSessionId: 'session:level',
      }),
    ).toThrow('draft digest')
    expect(() =>
      recordFoundationCommit(state, 'docs/LEVEL_SCENE_DESIGN.md'),
    ).toThrow('drafted')
  })

  test('isolates dispatch and failure state to one document', () => {
    const state = beginParallelFoundationAuthoring(['docs/GDD.md'])
    const dispatch = {
      dispatchId: 'dispatch-level',
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      taskId: 'docs/LEVEL_SCENE_DESIGN.md',
      revision: 'revision-1',
      status: 'running' as const,
      startedAt: new Date().toISOString(),
    }
    const drafting = recordFoundationDispatch(
      state,
      'docs/LEVEL_SCENE_DESIGN.md',
      'drafting',
      dispatch,
    )
    expect(drafting.documents?.[1]).toMatchObject({
      path: 'docs/LEVEL_SCENE_DESIGN.md',
      status: 'drafting',
      dispatch,
    })
    expect(drafting.documents?.[2]).toMatchObject({
      path: 'docs/BALANCE_DESIGN.md',
      status: 'pending',
    })

    const failed = recordFoundationFailure(
      drafting,
      'docs/LEVEL_SCENE_DESIGN.md',
      'provider stopped',
    )
    expect(failed.documents?.[1]).toMatchObject({
      status: 'needs_action',
      failureReason: 'provider stopped',
    })
    expect(failed.documents?.[1]?.dispatch).toBeUndefined()
    expect(readyDraftPaths(failed)).not.toContain(
      'docs/LEVEL_SCENE_DESIGN.md',
    )
  })
})
