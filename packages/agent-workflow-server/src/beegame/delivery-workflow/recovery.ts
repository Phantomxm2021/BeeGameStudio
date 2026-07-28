import { transitionDeliveryRun } from './transition'
import type { DeliveryRun, DispatchRecord } from './types'
import type { RunStore } from './run-store'

export async function reconcileRunOnStartup(input: {
  store: RunStore
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun | null> {
  return input.store.reconcile(input.sessionIsOpen ?? (async () => false))
}

async function acquireAndLoad(input: {
  store: RunStore
  runId: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<{ run: DeliveryRun; unlock: () => Promise<void> }> {
  const run = await input.store.load()
  if (!run || run.runId !== input.runId)
    throw new Error('delivery run not found')
  await input.store.lock(run.runId, async () => {
    if (run.activeDispatch?.status !== 'running') return false
    return input.sessionIsOpen ? input.sessionIsOpen(run.activeDispatch) : true
  })
  return { run, unlock: () => input.store.unlock(run.runId) }
}

export async function resumeRun(input: {
  store: RunStore
  runId: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun> {
  const reconciled = await input.store.reconcile(
    input.sessionIsOpen ?? (async () => false),
  )
  if (!reconciled || reconciled.runId !== input.runId)
    throw new Error('delivery run not found')
  const acquired = await acquireAndLoad(input)
  try {
    if (acquired.run.status === 'completed') return acquired.run
    const retryable =
      acquired.run.status === 'needs_action' ||
      acquired.run.status === 'blocked' ||
      acquired.run.status === 'stopped' ||
      acquired.run.status === 'failed'
    const resumed = retryable
      ? transitionDeliveryRun(
          {
            ...acquired.run,
            activeDispatch: acquired.run.activeDispatch?.terminalResult
              ? acquired.run.activeDispatch
              : undefined,
          },
          { type: 'retry' },
        )
      : acquired.run
    return input.store.commit(resumed, {
      runId: resumed.runId,
      type: 'run.resumed',
      phase: resumed.phase,
      status: resumed.status,
      revision: resumed.revision,
    })
  } finally {
    await acquired.unlock()
  }
}

export async function retryRun(input: {
  store: RunStore
  runId: string
  taskId?: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun> {
  const reconciled = await input.store.reconcile(
    input.sessionIsOpen ?? (async () => false),
  )
  if (!reconciled || reconciled.runId !== input.runId)
    throw new Error('delivery run not found')
  const acquired = await acquireAndLoad(input)
  try {
    const replayable =
      !input.taskId && acquired.run.activeDispatch?.terminalResult
    const resumed = transitionDeliveryRun(
      {
        ...acquired.run,
        activeDispatch: replayable ? acquired.run.activeDispatch : undefined,
      },
      { type: 'retry', ...(input.taskId ? { taskId: input.taskId } : {}) },
    )
    return input.store.commit(resumed, {
      runId: resumed.runId,
      type: 'run.retry_requested',
      phase: resumed.phase,
      status: resumed.status,
      revision: resumed.revision,
      taskId: input.taskId,
    })
  } finally {
    await acquired.unlock()
  }
}

export async function stopRun(input: {
  store: RunStore
  runId: string
  reason: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
  stopDispatch?: (dispatchId: string, reason: string) => Promise<unknown>
}): Promise<DeliveryRun> {
  const acquired = await acquireAndLoad({
    store: input.store,
    runId: input.runId,
    sessionIsOpen: input.sessionIsOpen,
  })
  try {
    const stopped = transitionDeliveryRun(acquired.run, {
      type: 'stop',
      reason: input.reason,
    })
    const persisted = {
      ...stopped,
      activeDispatch:
        stopped.activeDispatch?.status === 'running'
          ? {
              ...stopped.activeDispatch,
              status: 'interrupted' as const,
              finishedAt: new Date().toISOString(),
            }
          : stopped.activeDispatch,
    }
    if (acquired.run.activeDispatch?.status === 'running')
      await input.stopDispatch?.(
        acquired.run.activeDispatch.dispatchId,
        input.reason,
      )
    return input.store.commit(persisted, {
      runId: persisted.runId,
      type: 'run.stopped',
      phase: persisted.phase,
      status: persisted.status,
      revision: persisted.revision,
      reason: input.reason,
    })
  } finally {
    await acquired.unlock()
  }
}
