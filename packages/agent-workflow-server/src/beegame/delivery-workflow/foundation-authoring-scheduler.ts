import { startDocumentStage } from './foundation-authoring-stage'
import { recordFoundationFailure } from './foundation-authoring-batch'
import type {
  DeliveryRun,
  DispatchRecord,
  WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

// Owns author scheduling/replay policy. The controller only supplies transport
// and persistence capabilities; it must not inspect individual author statuses.
async function resumeFoundationAuthorContext(input: {
  run: FoundationAuthoringContext
  workspacePath: string
  dispatcher: {
    dispatch(request: WorkerDispatchRequest): Promise<unknown>
    workerIsOpen(dispatchId: string): Promise<boolean>
    replayTerminal(
      record: DispatchRecord,
      handler: (
        record: DispatchRecord,
        result: WorkerTerminalResult,
        request?: WorkerDispatchRequest,
      ) => Promise<void>,
    ): Promise<unknown>
  }
  handleTerminal(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void>
  persist(run: FoundationAuthoringContext, event: string): Promise<unknown>
}): Promise<boolean> {
  const { run } = input
  if (
    run.status !== 'running' ||
    run.phase !== 'DOCUMENT_DRAFTING' ||
    !run.foundationDraftState.documents
  )
    return false
  const replayable = run.foundationDraftState.documents.find(
    document => document.dispatch?.terminalResult,
  )?.dispatch
  if (replayable) {
    await input.dispatcher.replayTerminal(replayable, input.handleTerminal)
    return true
  }
  const runningDocuments = run.foundationDraftState.documents.filter(
    document => document.dispatch?.status === 'running',
  )
  if (runningDocuments.length) {
    const unavailable: typeof runningDocuments = []
    for (const document of runningDocuments) {
      const isOpen = await input.dispatcher
        .workerIsOpen(document.dispatch!.dispatchId)
        .catch(() => false)
      if (!isOpen) unavailable.push(document)
    }
    if (!unavailable.length) {
      await startDocumentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher: input.dispatcher,
      })
      return true
    }
    let foundationDraftState = run.foundationDraftState
    for (const document of unavailable)
      foundationDraftState = recordFoundationFailure(
        foundationDraftState,
        document.path,
        'preserved native document session is unavailable',
      )
    await input.persist(
      {
        ...run,
        foundationDraftState,
        status: 'needs_action',
        blockedReason: 'preserved native document session is unavailable',
      },
      'document.parallel.session_unavailable',
    )
    return true
  }
  return false
}

export async function resumeFoundationAuthors(
  input: Omit<
    Parameters<typeof resumeFoundationAuthorContext>[0],
    'run' | 'persist'
  > & {
    run: DeliveryRun
    persist(run: DeliveryRun, event: string): Promise<unknown>
  },
): Promise<boolean> {
  if (input.run.status !== 'running' || input.run.phase !== 'DOCUMENT_DRAFTING')
    return false
  return resumeFoundationAuthorContext({
    ...input,
    run: projectAuthoringContext(input.run),
    persist: (result, event) =>
      input.persist(applyAuthoringContext(input.run, result), event),
  })
}

import {
  projectAuthoringContext,
  applyAuthoringContext,
  type FoundationAuthoringContext,
} from './foundation-authoring-context'
