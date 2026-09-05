import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import {
  projectAuthoringContext,
  applyAuthoringContext,
} from './foundation-authoring-context'
import {
  beginParallelFoundationAuthoring,
  recordFoundationDispatch,
  recordFoundationFailure,
} from './foundation-authoring-batch'
import {
  claimAuthorBatchDispatch,
  retryAuthorState,
  stopAuthorState,
  runningAuthorDispatches,
} from './foundation-authoring-state'
import { recoverAuthorActiveUnit } from './foundation-authoring-recovery'
import {
  authorHandoffCheckpoints,
  authorReadyForHandoff,
} from './foundation-authoring-state'
import type { DeliveryRun, DispatchRecord } from './types'

function run(): DeliveryRun {
  return {
    ...createTestDeliveryRun({
      runId: 'r',
      projectId: 'p',
      ownerId: 'o',
      foundationDraftComplete: false,
    }),
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    status: 'running',
  }
}

describe('Stage 2 state boundary', () => {
  test('hands off only public checkpoint fields, never author dispatch or private inputs', () => {
    const source = run()
    source.foundationDraftState = beginParallelFoundationAuthoring([
      'docs/GDD.md',
    ])
    const handoff = authorHandoffCheckpoints(source.foundationDraftState)
    for (const checkpoint of handoff)
      expect(Object.keys(checkpoint).sort()).toEqual(['path', 'status'])
    expect(authorReadyForHandoff(source.foundationDraftState)).toBe(false)
    source.foundationDraftState.documents =
      source.foundationDraftState.documents!.map(document => ({
        ...document,
        status: 'committed',
      }))
    expect(authorReadyForHandoff(source.foundationDraftState)).toBe(true)
  })
  test('does not expose other stage fields and copies nested mutable author input', () => {
    const source = run()
    const before = JSON.stringify(source)
    const context = projectAuthoringContext(source)
    expect(Object.hasOwn(context, 'foundationAuditState')).toBe(false)
    expect(Object.hasOwn(context, 'resourceProductionState')).toBe(false)
    expect(Object.hasOwn(context, 'tasks')).toBe(false)
    context.foundationDraftState.completedPaths.push('docs/GDD.md')
    context.revision.document = 'updated'
    expect(JSON.stringify(source)).toBe(before)
  })

  test('applies only owned fields even when a result carries unrelated state', () => {
    const source = run()
    const result = {
      ...projectAuthoringContext(source),
      foundationAuditState: { status: 'tampered' },
      resourceProductionState: { currentTask: 'tampered' },
      tasks: [{ id: 'tampered' }],
      confirmedBriefContext: 'tampered',
    }
    const updated = applyAuthoringContext(source, result)
    expect(updated.foundationAuditState).toEqual(source.foundationAuditState)
    expect(updated.resourceProductionState).toEqual(
      source.resourceProductionState,
    )
    expect(updated.tasks).toEqual(source.tasks)
    expect(updated.confirmedBriefContext).toBe(source.confirmedBriefContext)
    expect(updated.revision.resource).toBe(source.revision.resource)
  })

  test('rejects foreign phases, identities and non-review handoffs', () => {
    const source = run()
    const result = projectAuthoringContext(source)
    expect(() =>
      projectAuthoringContext({ ...source, phase: 'FOUNDATION_REVISION' }),
    ).toThrow('DOCUMENT_DRAFTING')
    expect(() =>
      applyAuthoringContext({ ...source, phase: 'DOCUMENT_REVIEW' }, result),
    ).toThrow('DOCUMENT_DRAFTING')
    expect(() =>
      applyAuthoringContext(source, { ...result, runId: 'other' }),
    ).toThrow('identity')
    expect(() =>
      applyAuthoringContext(source, {
        ...result,
        phase: 'RESOURCE_PREPARATION',
      }),
    ).toThrow('handoff')
    expect(
      applyAuthoringContext(source, {
        ...result,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      }).phase,
    ).toBe('DOCUMENT_REVIEW')
  })

  test('stops live authors without erasing terminal siblings and retries only the selected task', () => {
    const record: DispatchRecord = {
      dispatchId: 'd',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: 'docs/LEVEL_SCENE_DESIGN.md',
      revision: 'rev',
      status: 'running',
      startedAt: '2026-09-05T00:00:00Z',
    }
    let state = recordFoundationDispatch(
      beginParallelFoundationAuthoring(['docs/GDD.md']),
      'docs/LEVEL_SCENE_DESIGN.md',
      'drafting',
      record,
    )
    const before = JSON.stringify(state)
    const stopped = stopAuthorState(state, 'user stopped workflow', d => ({
      ...d,
      status: 'interrupted',
      failureReason: 'user stopped workflow',
    }))
    expect(JSON.stringify(state)).toBe(before)
    expect(runningAuthorDispatches(stopped)).toEqual([])
    expect(stopped.documents![0]!.status).toBe('committed')
    expect(stopped.documents![1]!.dispatch!.status).toBe('interrupted')
    expect(retryAuthorState(stopped, 'docs/BALANCE_DESIGN.md').revived).toBe(
      false,
    )
    state = recordFoundationDispatch(
      stopped,
      'docs/BALANCE_DESIGN.md',
      'drafting',
      {
        ...record,
        dispatchId: 'balance',
        taskId: 'docs/BALANCE_DESIGN.md',
      },
    )
    state = recordFoundationFailure(
      state,
      'docs/BALANCE_DESIGN.md',
      'other failure',
    )
    const retried = retryAuthorState(state, 'docs/LEVEL_SCENE_DESIGN.md')
    expect(retried.revived).toBe(true)
    expect(retried.state.documents![1]!.status).toBe('pending')
    expect(retried.state.documents![1]!.dispatch).toBeUndefined()
    expect(retried.state.documents![2]!.status).toBe('needs_action')
  })

  test('materializes a batch only from a GDD-only recovery prefix', () => {
    const dispatch: DispatchRecord = {
      dispatchId: 'recovered-level',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: 'docs/LEVEL_SCENE_DESIGN.md',
      revision: 'rev',
      status: 'running',
      startedAt: '2026-09-05T00:00:00Z',
    }
    const recovered = claimAuthorBatchDispatch(
      { completedPaths: ['docs/GDD.md'] },
      'docs/LEVEL_SCENE_DESIGN.md',
      dispatch,
    ).foundationDraftState
    expect(recovered.documents?.find(document => document.path === 'docs/GDD.md'))
      .toMatchObject({ status: 'committed' })
    expect(recovered.documents?.find(document => document.path === dispatch.taskId))
      .toMatchObject({ status: 'drafting', dispatch })
    expect(() =>
      claimAuthorBatchDispatch(
        { completedPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'] },
        'docs/BALANCE_DESIGN.md',
        dispatch,
      ),
    ).toThrow('parallel foundation authoring state is missing')
  })

  test('raw author recovery does not claim another stage and reports malformed author evidence', () => {
    const reject = (code: string, message: string): never => {
      throw new Error(code + ': ' + message)
    }
    const base = {
      workspacePath: '/unused',
      ownerId: 'o',
      projectId: 'p',
      confirmedBriefContext: 'brief',
      reject,
    }
    expect(
      recoverAuthorActiveUnit({
        ...base,
        snapshot: { phase: 'FOUNDATION_REVISION' },
      }),
    ).toBeUndefined()
    expect(() =>
      recoverAuthorActiveUnit({
        ...base,
        snapshot: { phase: 'DOCUMENT_REVIEW', currentItemId: 'docs/GDD.md' },
      }),
    ).toThrow('recovery_checkpoint_conflict')
    expect(() =>
      recoverAuthorActiveUnit({
        ...base,
        snapshot: {
          phase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          currentItemId: 'docs/GDD.md',
        },
      }),
    ).toThrow('recovery_checkpoint_missing')
  })

  test('rejects an old initial dispatch for any document after the GDD', () => {
    const reject = (code: string, message: string): never => {
      throw new Error(code + ': ' + message)
    }
    expect(() =>
      recoverAuthorActiveUnit({
        workspacePath: '/unused',
        ownerId: 'o',
        projectId: 'p',
        confirmedBriefContext: 'brief',
        reject,
        snapshot: {
          phase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          currentItemId: 'docs/LEVEL_SCENE_DESIGN.md',
          activeDispatch: {
            request: {
              contract: {
                authoringMode: 'initial',
              },
            },
          },
        },
      }),
    ).toThrow('legacy serial initial authoring may only target the GDD')
  })
})
