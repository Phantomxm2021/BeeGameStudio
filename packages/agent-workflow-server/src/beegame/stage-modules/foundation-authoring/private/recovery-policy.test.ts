import { expect, test } from 'bun:test'
import { stopAuthorState, retryAuthorState } from './domain/foundation-authoring-state'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDraftState, type DispatchRecord } from './domain/types'

function state(): FoundationDraftState {
  return {
    completedPaths: ['docs/GDD.md'],
    documents: CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
      path,
      status: ['committed', 'drafting', 'needs_action', 'pending'][index % 4] as never,
      attempt: index + 1,
      ...(index % 4 === 1 ? { dispatch: {
        dispatchId: 'dispatch-' + index, workerType: 'document-author' as const, phase: 'DOCUMENT_DRAFTING' as const,
        taskId: path, status: 'running' as const, revision: 'revision', startedAt: '2026-09-05T00:00:00.000Z',
      } } : {}),
    })),
  }
}

const interrupt = (record: DispatchRecord): DispatchRecord => ({
  ...record,
  status: 'interrupted',
  failureReason: 'fixed stop',
  finishedAt: '2026-09-05T00:00:01.000Z',
})

test('stop preserves sibling state and marks running author dispatches interrupted', () => {
  for (const dispatchStatus of ['running', 'completed', 'failed', 'interrupted'] as const) {
    const before = state()
    for (const document of before.documents!) if (document.dispatch) document.dispatch.status = dispatchStatus
    const untouched = structuredClone(before)
    const current = stopAuthorState(before, 'fixed stop', interrupt)
    expect(before).toEqual(untouched)
    for (const [index, document] of before.documents!.entries()) {
      const after = current.documents![index]!
      if (document.dispatch?.status === 'running') {
        expect(after.status).toBe('needs_action')
        expect(after.failureReason).toBe('fixed stop')
        expect(after.dispatch).toMatchObject({ status: 'interrupted', failureReason: 'fixed stop' })
      } else {
        expect(after).toEqual(document)
      }
    }
  }
})

test('explicit retry revives only a selected failed document and keeps siblings blocked', () => {
  let current = state()
  current = stopAuthorState(current, 'fixed stop', interrupt)
  for (const taskId of [undefined, ...CANONICAL_FOUNDATION_DOCUMENTS, 'not-a-document']) {
    const snapshot = structuredClone(current)
    const result = retryAuthorState(current, taskId)
    expect(current).toEqual(snapshot)
    if (taskId === 'docs/LEVEL_SCENE_DESIGN.md') expect(result.revived).toBe(true)
  }
  const failed = { ...state(), documents: state().documents!.map(document =>
    document.path === 'docs/LEVEL_SCENE_DESIGN.md'
      ? { ...document, status: 'needs_action' as const, failureReason: 'provider stopped' }
      : document,
  ) }
  const result = retryAuthorState(failed, 'docs/LEVEL_SCENE_DESIGN.md')
  expect(result.revived).toBe(true)
  expect(result.state.documents?.find(document => document.path === 'docs/LEVEL_SCENE_DESIGN.md')).toMatchObject({ status: 'pending' })
  expect(result.state.documents?.find(document => document.path === 'docs/BALANCE_DESIGN.md')?.status).toBe('needs_action')
  expect(result.state.documents?.find(document => document.path === 'docs/LEVEL_SCENE_DESIGN.md')?.failureReason).toBeUndefined()
})

test('empty author state remains safe to stop and retry', () => {
  const initial = { completedPaths: [] } satisfies FoundationDraftState
  expect(stopAuthorState(initial, 'fixed stop', interrupt)).toEqual(initial)
  expect(retryAuthorState(initial)).toEqual({ state: initial, revived: false, actionable: false })
})
