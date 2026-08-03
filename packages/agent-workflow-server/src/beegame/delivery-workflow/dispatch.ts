import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { readBeeGameAssetManifest } from '../asset-contracts'
import { parseDispatchRecord } from './schema'
import {
  parseWorkerTerminalResult,
  type WorkerTerminalResult,
} from './worker-contracts'
import { buildWorkerPrompt } from './worker-prompts'
import {
  isWorkflowEvidenceFile,
  persistImplementationEvidence,
} from './evidence'
import type {
  DeliveryRun,
  DeliveryWorkerPort,
  DispatchRecord,
  WorkerDispatchRequest,
} from './types'
import type { RunStore } from './run-store'

export type DispatchCredits = {
  reserve?: (
    idempotencyKey: string,
    request: WorkerDispatchRequest,
  ) => Promise<void>
  settle?: (
    idempotencyKey: string,
    result: WorkerTerminalResult,
  ) => Promise<void>
}

const DEFAULT_PROGRESS_POLL_INTERVAL_MS = 5 * 1000
const DEFAULT_RESOURCE_MAX_TOKENS = 750_000
const TRANSPORT_CLEANUP_TRACKING_TIMEOUT_MS = 5 * 1000

export class DispatchError extends Error {
  constructor(
    readonly code: 'duplicate' | 'invalid_terminal' | 'not_found' | 'blocked',
    message: string,
  ) {
    super(message)
    this.name = 'DispatchError'
  }
}

function idempotencyKey(
  request: WorkerDispatchRequest,
  attempt: number,
): string {
  const lane =
    request.workerType === 'document-author'
      ? `document:${String(request.contract.documentSet ?? 'foundation')}`
      : request.workerType === 'document-reviewer'
        ? `review:${String(request.contract.reviewScope ?? 'complete')}`
        : request.workerType
  return `${request.runId}:${request.phase}:${request.workerType}:${lane}:${request.taskId ?? request.phase}:${request.revision}:${attempt}`
}

function now(): string {
  return new Date().toISOString()
}

function terminalEvidencePath(
  result: WorkerTerminalResult,
): string | undefined {
  return 'evidencePath' in result && typeof result.evidencePath === 'string'
    ? result.evidencePath
    : undefined
}

function workerRequiresEvidence(
  workerType: WorkerDispatchRequest['workerType'],
): boolean {
  // Document review evidence is intentionally persisted by the semantic
  // reconciler only after the frozen check/finding contract is accepted.
  // Requiring the file here would reject every valid reviewer terminal before
  // that reconciler gets the opportunity to validate and persist it.
  return workerType !== 'document-author' && workerType !== 'document-reviewer'
}

function assertSingleResourceWorkAuthority(
  request: WorkerDispatchRequest,
  run: DeliveryRun,
): void {
  if (request.workerType !== 'resource-preparer') return
  if ('preparationRetry' in request.contract) {
    throw new DispatchError(
      'blocked',
      'resource preparation retry contracts are retired',
    )
  }
  const remediation = request.contract.remediation
  const cycle = run.documentReviewState.activeCycle
  const hasAcceptedResourceAuthority = Boolean(
    cycle?.acceptedSemanticResult && cycle.activeTarget === 'resource',
  )
  const findings = hasAcceptedResourceAuthority
    ? cycle!.findings.filter(finding => finding.owner === 'resource')
    : []
  if (hasAcceptedResourceAuthority && findings.length === 0) {
    throw new DispatchError(
      'blocked',
      'accepted resource review authority requires at least one resource finding',
    )
  }
  if (!hasAcceptedResourceAuthority) {
    if (remediation !== undefined)
      throw new DispatchError(
        'blocked',
        'resource remediation requires the active accepted document-review authority',
      )
    return
  }
  const expected = {
    kind: 'document_review',
    cycleId: cycle!.cycleId,
    findings,
  }
  if (!isDeepStrictEqual(remediation, expected))
    throw new DispatchError(
      'blocked',
      'resource remediation must exactly match the active accepted document-review authority',
    )
}

export function createDeliveryDispatcher(options: {
  store: RunStore
  workerPort: DeliveryWorkerPort
  credits?: DispatchCredits
  progressPollIntervalMs?: number
  resourceMaxTokens?: number
  onTerminal?: (
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ) => Promise<void>
  /** Continue a resource stage in a fresh bounded worker after durable progress. */
  onResourceBudgetYield?: (
    record: DispatchRecord,
    reason: string,
  ) => Promise<void>
}) {
  const byKey = new Map<string, DispatchRecord>()
  const requests = new Map<string, WorkerDispatchRequest>()
  const creditSettled = new Set<string>()
  const transportCleanupStarted = new Set<string>()
  let dispatchTail: Promise<void> = Promise.resolve()
  const progressPollIntervalMs =
    options.progressPollIntervalMs ?? DEFAULT_PROGRESS_POLL_INTERVAL_MS
  const resourceMaxTokens =
    options.resourceMaxTokens ?? DEFAULT_RESOURCE_MAX_TOKENS

  function forgetDispatch(dispatchId: string): void {
    for (const [key, record] of byKey.entries()) {
      if (record.dispatchId === dispatchId) byKey.delete(key)
    }
    requests.delete(dispatchId)
  }

  function releaseDispatch(
    dispatchId: string,
    cleanup: { stopReason?: string } = {},
  ): void {
    // Durable state is authoritative. Release the idempotency lane before
    // touching the disposable transport so a stalled session close can never
    // prevent a retry from creating a fresh dispatch.
    forgetDispatch(dispatchId)
    if (transportCleanupStarted.has(dispatchId)) return
    transportCleanupStarted.add(dispatchId)
    const cleanupOperation = (async () => {
      if (cleanup.stopReason)
        await options.workerPort
          .stop(dispatchId, cleanup.stopReason)
          .catch(() => undefined)
      await options.workerPort.close?.(dispatchId).catch(() => undefined)
    })()
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const cleanupDeadline = new Promise<void>(resolve => {
      cleanupTimer = setTimeout(resolve, TRANSPORT_CLEANUP_TRACKING_TIMEOUT_MS)
      cleanupTimer.unref?.()
    })
    void Promise.race([cleanupOperation, cleanupDeadline]).finally(() => {
      if (cleanupTimer) clearTimeout(cleanupTimer)
      transportCleanupStarted.delete(dispatchId)
    })
  }

  function dispatch(request: WorkerDispatchRequest): Promise<DispatchRecord> {
    const previous = dispatchTail
    const current = previous
      .catch(() => undefined)
      .then(() => dispatchUnlocked(request))
    dispatchTail = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  async function dispatchUnlocked(
    request: WorkerDispatchRequest,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (!run)
      throw new DispatchError('not_found', 'delivery run does not exist')
    assertSingleResourceWorkAuthority(request, run)
    if (run.status !== 'running')
      throw new DispatchError('blocked', 'delivery run is not running')
    if (
      run.activeDispatch &&
      run.activeDispatch.status === 'completed' &&
      run.activeDispatch.phase === request.phase &&
      run.activeDispatch.revision === request.revision &&
      run.activeDispatch.taskId === request.taskId &&
      run.activeDispatch.workerType === request.workerType
    ) {
      return run.activeDispatch
    }
    if (run.activeDispatch?.status === 'running') {
      const existing = run.activeDispatch
      const existingKey = [...byKey.entries()].find(
        ([, record]) => record.dispatchId === existing.dispatchId,
      )?.[0]
      if (
        existingKey ===
        idempotencyKey(
          request,
          Math.max(
            1,
            existing.taskId
              ? (run.tasks.find(task => task.id === existing.taskId)?.attempt ??
                  1)
              : 1,
          ),
        )
      )
        return existing
      throw new DispatchError(
        'duplicate',
        'another delivery worker is already running',
      )
    }
    const attempt = request.taskId
      ? Math.max(
          1,
          run.tasks.find(task => task.id === request.taskId)?.attempt ?? 1,
        )
      : 1
    const key = idempotencyKey(request, attempt)
    const existing = byKey.get(key)
    if (existing) {
      // A record in this map is reusable only while the durable run points at
      // the same dispatch. Reaching this branch means it does not, so keeping
      // it would manufacture a running workflow with no worker.
      releaseDispatch(existing.dispatchId, {
        ...(existing.status === 'running'
          ? {
              stopReason: 'stale delivery dispatch superseded by durable state',
            }
          : {}),
      })
    }
    const dispatchId = randomUUID()
    const dispatchRequest = { ...request, dispatchId }
    const record = parseDispatchRecord({
      dispatchId,
      workerType: request.workerType,
      phase: request.phase,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      revision: request.revision,
      status: 'running',
      startingUsageTotalTokens: Math.max(0, run.usage?.total_tokens ?? 0),
      startedAt: now(),
      request: dispatchRequest,
    })
    byKey.set(key, record)
    requests.set(record.dispatchId, request)
    let startedDispatchId: string | undefined
    try {
      await options.store.commit(
        {
          ...run,
          activeDispatch: record,
          lastProgressAt: record.startedAt,
          currentMessage: undefined,
          currentItemId:
            request.workerType === 'document-author' && request.taskId
              ? request.taskId
              : undefined,
          ...(request.workerType === 'document-reviewer'
            ? { reviewedDocumentPaths: [] }
            : {}),
          thinking: 'working',
        },
        {
          runId: run.runId,
          type: 'dispatch.started',
          phase: run.phase,
          status: run.status,
          revision: run.revision,
          dispatchId: record.dispatchId,
          workerType: request.workerType,
          taskId: request.taskId,
        },
      )
      await options.credits?.reserve?.(key, request)
      const started = await options.workerPort.start(dispatchRequest)
      startedDispatchId = started.dispatchId
      if (started.dispatchId !== dispatchId)
        throw new Error(
          'worker returned a dispatch id that does not match the durable dispatch',
        )
      // Supervision starts as soon as the durable dispatch owns a transport.
      // submit() spans the complete model turn, so attaching these observers
      // after awaiting it would leave thinking/tool execution unsupervised.
      if (options.workerPort.waitForTerminal) {
        void options.workerPort
          .waitForTerminal(record.dispatchId)
          .then(terminal => thisComplete(terminal))
          .catch(error =>
            isWorkerNeedsActionError(error)
              ? thisNeedsAction(error.message)
              : thisFail(error),
          )
      }
      void monitorIdleProgress(record.dispatchId).catch(() => undefined)
      await options.workerPort.submit(dispatchId, buildWorkerPrompt(request))
    } catch (error) {
      const current = await options.store.load()
      if (
        current?.activeDispatch?.dispatchId === record.dispatchId &&
        current.activeDispatch.status !== 'running'
      ) {
        releaseDispatch(record.dispatchId)
        return current.activeDispatch
      }
      await markDispatchFailed(
        record.dispatchId,
        error instanceof Error ? error.message : 'worker dispatch failed',
      ).catch(() => undefined)
      const reason =
        error instanceof Error ? error.message : 'worker dispatch failed'
      const transportDispatchId = startedDispatchId ?? record.dispatchId
      releaseDispatch(transportDispatchId, { stopReason: reason })
      if (transportDispatchId !== record.dispatchId)
        forgetDispatch(record.dispatchId)
      throw error
    }
    return record

    function thisComplete(terminal: unknown): void {
      void completeDispatch(record.dispatchId, terminal).catch(() => undefined)
    }
    function thisFail(error: unknown): void {
      const reason =
        error instanceof Error
          ? error.message
          : 'worker did not produce a terminal result'
      void markDispatchFailed(record.dispatchId, reason).catch(() => undefined)
    }
    function thisNeedsAction(reason: string): void {
      void markDispatchNeedsAction(record.dispatchId, reason).catch(
        () => undefined,
      )
    }
  }

  async function monitorIdleProgress(dispatchId: string): Promise<void> {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, progressPollIntervalMs))
      const run = await options.store.load()
      if (
        !run?.activeDispatch ||
        run.activeDispatch.dispatchId !== dispatchId ||
        run.activeDispatch.status !== 'running' ||
        run.status !== 'running'
      )
        return
      const isResourceWorker =
        run.activeDispatch.workerType === 'resource-preparer'
      const resourceMutationInFlight =
        isResourceWorker &&
        (await options.workerPort
          .hasInFlightMutation?.(dispatchId)
          .catch(() => false))
      const activeRequest =
        requests.get(dispatchId) ?? run.activeDispatch.request
      if (
        isResourceWorker &&
        !resourceMutationInFlight &&
        activeRequest &&
        (await resourcePlanCheckpointCompleted(activeRequest))
      ) {
        await yieldResourceDispatch(
          dispatchId,
          'resource plan checkpoint completed',
          'dispatch.resource_plan_checkpoint_yielded',
        )
        return
      }
      if (
        isResourceWorker &&
        !resourceMutationInFlight &&
        resourceMaxTokens > 0
      ) {
        const consumed = Math.max(
          0,
          (run.usage?.total_tokens ?? 0) -
            (run.activeDispatch.startingUsageTotalTokens ?? 0),
        )
        if (consumed >= resourceMaxTokens) {
          const reason = `resource worker exceeded its ${resourceMaxTokens} token limit`
          if (hasDurableProgressSinceDispatch(run))
            await yieldResourceDispatch(dispatchId, reason)
          else await markDispatchNeedsAction(dispatchId, reason)
          return
        }
      }
    }
  }

  function hasDurableProgressSinceDispatch(run: {
    lastProgressAt?: string
    activeDispatch?: DispatchRecord
  }): boolean {
    if (!run.activeDispatch || !run.lastProgressAt) return false
    const startedAt = Date.parse(run.activeDispatch.startedAt)
    const lastProgressAt = Date.parse(run.lastProgressAt)
    return (
      Number.isFinite(startedAt) &&
      Number.isFinite(lastProgressAt) &&
      lastProgressAt > startedAt
    )
  }

  async function resourcePlanCheckpointCompleted(
    request: WorkerDispatchRequest,
  ): Promise<boolean> {
    if (
      request.workerType !== 'resource-preparer' ||
      request.contract.resourcePlanOnly !== true
    )
      return false
    try {
      const manifest = await readBeeGameAssetManifest(request.workspacePath)
      return (
        Boolean(manifest.project_target) &&
        manifest.requirements.length > 0 &&
        manifest.resources.length === 0
      )
    } catch {
      return false
    }
  }

  function isWorkerNeedsActionError(error: unknown): error is Error {
    return error instanceof Error && error.name === 'WorkerNeedsActionError'
  }

  async function completeDispatch(
    dispatchId: string,
    terminalValue: unknown,
  ): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    if (!run?.activeDispatch || run.activeDispatch.dispatchId !== dispatchId)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.status !== 'running' || run.activeDispatch.status !== 'running')
      throw new DispatchError('blocked', 'delivery run is no longer running')
    const request = requests.get(dispatchId) ?? run.activeDispatch.request
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      if (result.workerType === 'implementation-worker') {
        const evidencePath = `.beegame/workflow/evidence/implementation-${dispatchId}.json`
        result = {
          ...result,
          evidencePath,
          evidenceRefs: [evidencePath],
        }
      }
      const resultRevision = 'revision' in result ? result.revision : undefined
      if (
        request &&
        (result.workerType !== request.workerType ||
          (resultRevision !== undefined &&
            resultRevision !== request.revision) ||
          (result.workerType === 'implementation-worker' &&
            result.taskId !== request.taskId))
      )
        throw new Error(
          'worker terminal result does not match dispatch contract',
        )
      if (request && result.workerType === 'implementation-worker')
        await persistImplementationEvidence({
          workspacePath: request.workspacePath,
          evidencePath: result.evidencePath,
          taskId: result.taskId,
          revision: result.revision,
          verifiedArtifacts: result.verifiedArtifacts,
          verificationResults: result.verificationResults,
        })
      const evidencePath = terminalEvidencePath(result)
      if (
        request &&
        workerRequiresEvidence(request.workerType) &&
        (!evidencePath ||
          !isWorkflowEvidenceFile(request.workspacePath, evidencePath))
      ) {
        throw new Error(
          'worker terminal evidence file is missing or outside the workflow evidence directory',
        )
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'invalid worker terminal result'
      const invalid = parseDispatchRecord({
        ...run.activeDispatch,
        status: 'invalid' as const,
        finishedAt: now(),
        failureReason: reason,
      })
      await options.store.commit(
        {
          ...run,
          status: 'failed',
          blockedReason: reason,
          activeDispatch: invalid,
          thinking: 'idle',
        },
        {
          runId: run.runId,
          type: 'dispatch.invalid',
          phase: run.phase,
          status: 'failed',
          revision: run.revision,
          dispatchId,
          reason,
        },
      )
      releaseDispatch(dispatchId)
      throw new DispatchError(
        'invalid_terminal',
        'invalid worker terminal result',
      )
    }
    const status =
      result.workerType === 'document-reviewer'
        ? 'completed'
        : result.workerType === 'document-author' ||
            result.workerType === 'atomic-task-planner' ||
            result.workerType === 'change-impact-analyzer' ||
            result.workerType === 'question-answerer'
          ? 'completed'
          : result.status === 'passed' || result.status === 'completed'
            ? 'completed'
            : result.status === 'blocked'
              ? 'blocked'
              : 'failed'
    const completed = parseDispatchRecord({
      ...run.activeDispatch,
      status,
      ...(terminalEvidencePath(result)
        ? { terminalEvidencePath: terminalEvidencePath(result) }
        : {}),
      terminalResult: result as unknown as Record<string, unknown>,
      finishedAt: now(),
    })
    const updated = {
      ...run,
      activeDispatch: completed,
      thinking: 'idle' as const,
    }
    await options.store.commit(updated, {
      runId: run.runId,
      type: `dispatch.${status}`,
      phase: run.phase,
      status: run.status,
      revision: run.revision,
      dispatchId,
      workerType: result.workerType,
    })
    const key = request
      ? idempotencyKey(
          request,
          request.taskId
            ? Math.max(
                1,
                run.tasks.find(task => task.id === request.taskId)?.attempt ??
                  1,
              )
            : 1,
        )
      : dispatchId
    let terminalHandlerStarted = false
    try {
      if (!creditSettled.has(key)) {
        await options.credits?.settle?.(key, result)
        creditSettled.add(key)
      }
      terminalHandlerStarted = true
      await options.onTerminal?.(completed, result, request)
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'workflow terminal handler failed'
      const current = await options.store.load()
      const failed = parseDispatchRecord({
        ...completed,
        status: 'failed',
        failureReason: reason,
        terminalResult: undefined,
      })
      if (
        current &&
        current.runId === run.runId &&
        (!current.activeDispatch ||
          current.activeDispatch.dispatchId === dispatchId)
      ) {
        const handlerFailure = terminalHandlerStarted
        const status = handlerFailure ? 'needs_action' : 'failed'
        await options.store.commit(
          {
            ...current,
            status,
            blockedReason: reason,
            activeDispatch: failed,
            thinking: 'idle',
          },
          {
            runId: current.runId,
            type: 'workflow.handler_failed',
            phase: current.phase,
            status,
            revision: current.revision,
            dispatchId,
            reason,
          },
        )
      }
      forgetDispatch(dispatchId)
      throw error
    } finally {
      // The durable run/event journal is the worker's retained evidence. The
      // private transport session is disposable once a terminal result exists.
      releaseDispatch(dispatchId)
    }
    return { record: completed, result }
  }

  async function replayTerminal(record: DispatchRecord): Promise<void> {
    if (
      !['completed', 'failed', 'blocked'].includes(record.status) ||
      !record.terminalResult
    )
      throw new DispatchError(
        'blocked',
        'dispatch has no replayable terminal result',
      )
    const result = parseWorkerTerminalResult(record.terminalResult)
    try {
      const run = await options.store.load()
      const request = record.request
      const attempt = request?.taskId
        ? Math.max(
            1,
            run?.tasks.find(task => task.id === request.taskId)?.attempt ?? 1,
          )
        : 1
      const key = request ? idempotencyKey(request, attempt) : record.dispatchId
      await options.credits?.settle?.(key, result)
      await options.onTerminal?.(record, result, record.request)
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'workflow terminal replay failed'
      const current = await options.store.load()
      if (current?.activeDispatch?.dispatchId === record.dispatchId) {
        const failed = parseDispatchRecord({
          ...current.activeDispatch,
          status: 'failed',
          failureReason: reason,
          terminalResult: undefined,
          finishedAt: current.activeDispatch.finishedAt ?? now(),
        })
        await options.store.commit(
          {
            ...current,
            status: 'failed',
            blockedReason: reason,
            activeDispatch: failed,
            thinking: 'idle',
          },
          {
            runId: current.runId,
            type: 'workflow.replay_failed',
            phase: current.phase,
            status: 'failed',
            revision: current.revision,
            dispatchId: record.dispatchId,
            reason,
          },
        )
      }
      forgetDispatch(record.dispatchId)
      throw error
    } finally {
      releaseDispatch(record.dispatchId)
    }
  }

  async function markDispatchFailed(
    dispatchId: string,
    reason: string,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (!run?.activeDispatch || run.activeDispatch.dispatchId !== dispatchId)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.activeDispatch.status !== 'running') return run.activeDispatch
    const failed = parseDispatchRecord({
      ...run.activeDispatch,
      status: 'failed',
      finishedAt: now(),
      failureReason: reason,
    })
    const saved = await options.store.commit(
      {
        ...run,
        status: 'failed',
        blockedReason: reason,
        activeDispatch: failed,
        thinking: 'idle',
      },
      {
        runId: run.runId,
        type: 'dispatch.failed',
        phase: run.phase,
        status: 'failed',
        revision: run.revision,
        dispatchId,
        reason,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    return saved.activeDispatch ?? failed
  }

  async function markDispatchNeedsAction(
    dispatchId: string,
    reason: string,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (!run?.activeDispatch || run.activeDispatch.dispatchId !== dispatchId)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.activeDispatch.status !== 'running') return run.activeDispatch
    const interrupted = parseDispatchRecord({
      ...run.activeDispatch,
      status: 'interrupted',
      finishedAt: now(),
      failureReason: reason,
    })
    const saved = await options.store.commit(
      {
        ...run,
        status: 'needs_action',
        blockedReason: reason,
        activeDispatch: interrupted,
        thinking: 'idle',
      },
      {
        runId: run.runId,
        type: 'dispatch.idle_timeout',
        phase: run.phase,
        status: 'needs_action',
        revision: run.revision,
        dispatchId,
        reason,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    return saved.activeDispatch ?? interrupted
  }

  async function yieldResourceDispatch(
    dispatchId: string,
    reason: string,
    eventType = 'dispatch.resource_budget_yielded',
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (!run?.activeDispatch || run.activeDispatch.dispatchId !== dispatchId)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.activeDispatch.status !== 'running') return run.activeDispatch
    const interrupted = parseDispatchRecord({
      ...run.activeDispatch,
      status: 'interrupted',
      finishedAt: now(),
      failureReason: reason,
    })
    const saved = await options.store.commit(
      {
        ...run,
        status: 'running',
        blockedReason: undefined,
        activeDispatch: interrupted,
        thinking: 'idle',
      },
      {
        runId: run.runId,
        type: eventType,
        phase: run.phase,
        status: 'running',
        revision: run.revision,
        dispatchId,
        reason,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    await options.onResourceBudgetYield?.(interrupted, reason)
    return saved.activeDispatch ?? interrupted
  }

  async function stop(
    dispatchId: string,
    reason: string,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (!run?.activeDispatch || run.activeDispatch.dispatchId !== dispatchId)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.activeDispatch.status !== 'running') return run.activeDispatch
    const stopped = parseDispatchRecord({
      ...run.activeDispatch,
      status: 'interrupted',
      finishedAt: now(),
    })
    await options.store.commit(
      {
        ...run,
        status: 'stopped',
        blockedReason: reason,
        activeDispatch: stopped,
        thinking: 'idle',
      },
      {
        runId: run.runId,
        type: 'dispatch.interrupted',
        phase: run.phase,
        status: 'stopped',
        revision: run.revision,
        dispatchId,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    return stopped
  }

  async function status(dispatchId: string): Promise<DispatchRecord> {
    const run = await options.store.load()
    if (run?.activeDispatch?.dispatchId === dispatchId)
      return run.activeDispatch
    const record = [...byKey.values()].find(
      candidate => candidate.dispatchId === dispatchId,
    )
    if (!record) throw new DispatchError('not_found', 'dispatch is not known')
    return record
  }

  async function workerIsOpen(dispatchId: string): Promise<boolean> {
    const worker = await options.workerPort.status(dispatchId)
    return worker.status === 'running'
  }

  return {
    dispatch,
    completeDispatch,
    replayTerminal,
    stop,
    status,
    workerIsOpen,
    idempotencyKey,
  }
}
