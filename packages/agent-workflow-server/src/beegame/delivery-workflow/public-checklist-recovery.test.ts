import { expect, test } from 'bun:test'
import { createDeliveryDispatcher } from './dispatch'
import {
  createAcceptedIrChecklistFixture,
  completedChecklistRun,
  disposeAcceptedIrChecklistFixture,
  fixtureDigest,
} from './test-fixtures/accepted-ir-checklist'
import { createDeliveryWorkflowController } from './controller'
import { retryRun, stopRun } from './recovery'
import { transitionDeliveryRun } from './transition'
import type { DeliveryWorkerPort, WorkerDispatchRequest } from './types'

function workerPort(calls: {
  starts: string[]
  submits: string[]
}): DeliveryWorkerPort {
  return {
    async start(request) {
      const dispatchId = request.dispatchId!
      calls.starts.push(dispatchId)
      return { sessionId: `session:${dispatchId}`, dispatchId }
    },
    async submit(dispatchId) {
      calls.submits.push(dispatchId)
    },
    async stop() {},
    async status(dispatchId) {
      return {
        dispatchId,
        workerType: 'document-author',
        phase: 'DOCUMENT_REVIEW',
        revision: fixtureDigest('checklist-revision'),
        status: 'interrupted',
        startedAt: new Date(0).toISOString(),
      }
    },
  }
}

function downstreamDispatchRequest(
  fixture: Awaited<ReturnType<typeof createAcceptedIrChecklistFixture>>,
  run: ReturnType<typeof completedChecklistRun>,
): WorkerDispatchRequest {
  return {
    dispatchId: 'checklist-dispatch',
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    workspacePath: fixture.workspace,
    workerType: 'document-author',
    phase: 'DOCUMENT_REVIEW',
    revision: run.revision.document,
    allowedPaths: [
      '.beegame/workflow/checklist-candidates/checklist-dispatch.md',
    ],
    projectReadScope: 'empty',
    contract: {
      documentSet: 'checklist',
      approvedDocumentRevision: run.revision.document,
      checklistAuthority: {
        foundationRevision: run.revision.document,
        documents: run.foundationReviewStage!.acceptedReview!.documents.map(
          document => ({
            path: document.path,
            content: document.content,
            digest: fixtureDigest(document.content),
          }),
        ),
        irResultId: fixtureDigest('accepted-ir-result'),
        irModules: [{ moduleId: 'implementation-verification', nodes: [] }],
      },
    },
  }
}

test('completed public Foundation and IR links do not block Checklist transition stop/retry', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  try {
    const downstream = completedChecklistRun(fixture)
    expect(() =>
      transitionDeliveryRun(downstream, { type: 'stop', reason: 'pause' }),
    ).not.toThrow()
    const stoppedByTransition = transitionDeliveryRun(downstream, {
      type: 'stop',
      reason: 'pause',
    })
    expect(stoppedByTransition.status).toBe('stopped')
    expect(() =>
      transitionDeliveryRun(stoppedByTransition, { type: 'retry' }),
    ).not.toThrow()

    await fixture.store.commit(downstream, {
      runId: downstream.runId,
      type: 'fixture.checklist-ready',
      phase: downstream.phase,
      status: downstream.status,
      revision: downstream.revision,
    })
    const stopped = await stopRun({
      store: fixture.store,
      runId: downstream.runId,
      reason: 'operator pause',
    })
    expect(stopped.status).toBe('stopped')
    expect(stopped.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(stopped.gameIrStage?.outcome?.status).toBe('completed')

    const retried = await retryRun({
      store: fixture.store,
      runId: downstream.runId,
    })
    expect(retried.status).toBe('running')
    expect(retried.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(retried.gameIrStage?.control.action).toBe('run')
  } finally {
    await disposeAcceptedIrChecklistFixture(fixture)
  }
})

test('a stale Foundation/IR snapshot cannot make controller stop the current Checklist stage fail', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  const calls = { starts: [] as string[], submits: [] as string[] }
  const controller = createDeliveryWorkflowController({
    workspacePath: fixture.workspace,
    ownerId: fixture.run.ownerId,
    workerPort: workerPort(calls),
  })
  try {
    const downstream = completedChecklistRun(fixture)
    await fixture.store.commit(downstream, {
      runId: downstream.runId,
      type: 'fixture.checklist-ready',
      phase: downstream.phase,
      status: downstream.status,
      revision: downstream.revision,
    })
    const stopped = await controller.stopFoundation(
      fixture.run,
      'operator pause',
    )
    expect(stopped.status).toBe('stopped')
    expect(stopped.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(stopped.gameIrStage?.outcome?.status).toBe('completed')
  } finally {
    await controller.dispose()
    await disposeAcceptedIrChecklistFixture(fixture)
  }
})

test('Checklist dispatch and terminal admission remain available after public links complete', async () => {
  const fixture = await createAcceptedIrChecklistFixture()
  const calls = { starts: [] as string[], submits: [] as string[] }
  const dispatcher = createDeliveryDispatcher({
    store: fixture.store,
    workerPort: workerPort(calls),
  })
  try {
    const downstream = completedChecklistRun(fixture)
    await fixture.store.commit(downstream, {
      runId: downstream.runId,
      type: 'fixture.checklist-ready',
      phase: downstream.phase,
      status: downstream.status,
      revision: downstream.revision,
    })
    const request = downstreamDispatchRequest(fixture, downstream)
    const started = await dispatcher.dispatch(request)
    expect(started.workerType).toBe('document-author')
    expect(calls.starts).toEqual(['checklist-dispatch'])
    expect(calls.submits).toEqual(['checklist-dispatch'])

    const terminal = await dispatcher.completeDispatch('checklist-dispatch', {
      workerType: 'document-author',
      status: 'completed',
      writtenPaths: [request.allowedPaths![0]!],
    })
    expect(terminal.record.status).toBe('completed')
    expect(
      (await fixture.store.load())?.activeDispatch?.terminalResult,
    ).toMatchObject({
      workerType: 'document-author',
      status: 'completed',
    })
    await dispatcher.replayTerminal(terminal.record)
  } finally {
    await disposeAcceptedIrChecklistFixture(fixture)
  }
})
