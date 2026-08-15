import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
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
  WorkflowUsage,
  WorkerDispatchRequest,
} from './types'
import type { RunStore, WorkflowLock } from './run-store'
import { readAuthoredDocumentReceipt } from '../authored-document-receipt'
import {
  recordFoundationDispatch,
  recordFoundationFailure,
  recordFoundationHandlerFailure,
} from './foundation-authoring-batch'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

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

const TRANSPORT_CLEANUP_TRACKING_TIMEOUT_MS = 5 * 1000

function foundationPathFor(
  request: WorkerDispatchRequest,
): FoundationDocumentPath | undefined {
  const path = request.contract.foundationDocumentPath
  const mode = request.contract.authoringMode
  return request.workerType === 'document-author' &&
    mode === 'parallel-draft' &&
    typeof path === 'string' &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(path as FoundationDocumentPath)
    ? (path as FoundationDocumentPath)
    : undefined
}

function foundationDispatch(
  run: DeliveryRun,
  path: FoundationDocumentPath,
): DispatchRecord | undefined {
  return run.foundationDraftState.documents?.find(
    document => document.path === path,
  )?.dispatch
}

function reviewerRoleFor(request: WorkerDispatchRequest): string | undefined {
  const role = request.contract.reviewRole
  return request.workerType === 'document-reviewer' && typeof role === 'string'
    ? role
    : undefined
}

function reviewerDispatch(
  run: DeliveryRun,
  role: string,
): DispatchRecord | undefined {
  return run.documentReviewState.activeRun?.reports.find(
    report => report.role === role,
  )?.dispatch
}

function dispatchLocation(
  run: DeliveryRun,
  dispatchId: string,
):
  | {
      record: DispatchRecord
      path?: FoundationDocumentPath
      reviewRole?: string
    }
  | undefined {
  if (run.activeDispatch?.dispatchId === dispatchId)
    return { record: run.activeDispatch }
  for (const document of run.foundationDraftState.documents ?? [])
    if (document.dispatch?.dispatchId === dispatchId)
      return { record: document.dispatch, path: document.path }
  for (const report of run.documentReviewState.activeRun?.reports ?? [])
    if (report.dispatch?.dispatchId === dispatchId)
      return { record: report.dispatch, reviewRole: report.role }
  return undefined
}

function hasRunningReviewerDispatch(run: DeliveryRun): boolean {
  return (run.documentReviewState.activeRun?.reports ?? []).some(
    report => report.dispatch?.status === 'running',
  )
}

function hasRunningFoundationDispatch(run: DeliveryRun): boolean {
  return (run.foundationDraftState.documents ?? []).some(
    document => document.dispatch?.status === 'running',
  )
}

function withFoundationDispatch(
  run: DeliveryRun,
  path: FoundationDocumentPath,
  dispatch: DispatchRecord,
): DeliveryRun {
  const documents = run.foundationDraftState.documents
  if (!documents)
    throw new DispatchError(
      'blocked',
      'parallel foundation authoring state is missing',
    )
  return {
    ...run,
    foundationDraftState: {
      ...run.foundationDraftState,
      documents: documents.map(document =>
        document.path === path ? { ...document, dispatch } : { ...document },
      ),
    },
  }
}

function withReviewerDispatch(
  run: DeliveryRun,
  role: string,
  dispatch: DispatchRecord,
): DeliveryRun {
  const activeRun = run.documentReviewState.activeRun
  if (!activeRun)
    throw new DispatchError('blocked', 'document review run is missing')
  return {
    ...run,
    documentReviewState: {
      ...run.documentReviewState,
      activeRun: {
        ...activeRun,
        status: 'running',
        reports: activeRun.reports.map(report =>
          report.role === role
            ? {
                ...report,
                status: 'running',
                dispatch,
                failureReason: undefined,
              }
            : report,
        ),
      },
    },
  }
}

function withReviewerFailure(
  run: DeliveryRun,
  role: string,
  dispatch: DispatchRecord,
  reason: string,
): DeliveryRun {
  const activeRun = run.documentReviewState.activeRun
  if (!activeRun) return run
  const reports = activeRun.reports.map(report =>
    report.role === role
      ? {
          ...report,
          status: 'failed' as const,
          dispatch,
          failureReason: reason,
        }
      : report,
  )
  const othersRunning = reports.some(report => report.status === 'running')
  return {
    ...run,
    status: othersRunning ? 'running' : 'needs_action',
    blockedReason: othersRunning ? undefined : reason,
    documentReviewState: {
      ...run.documentReviewState,
      activeRun: {
        ...activeRun,
        status: 'failed',
        reports,
        failureReason: reason,
      },
    },
    thinking: othersRunning ? 'working' : 'idle',
  }
}

function isolatedFoundationFailureStatus(
  run: DeliveryRun,
): DeliveryRun['status'] {
  return hasRunningFoundationDispatch(run) ? 'running' : 'needs_action'
}

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
        ? `review:${String(request.contract.reviewScope ?? 'complete')}:${String(request.contract.reviewRole ?? 'unknown')}`
        : request.workerType
  return `${request.runId}:${request.phase}:${request.workerType}:${lane}:${request.taskId ?? request.phase}:${request.revision}:${attempt}`
}

function now(): string {
  return new Date().toISOString()
}

function usageSnapshot(usage: WorkflowUsage | undefined): WorkflowUsage {
  return {
    input_tokens: Math.max(0, usage?.input_tokens ?? 0),
    cache_read_tokens: Math.max(0, usage?.cache_read_tokens ?? 0),
    cache_creation_tokens: Math.max(0, usage?.cache_creation_tokens ?? 0),
    completion_tokens: Math.max(0, usage?.completion_tokens ?? 0),
    total_tokens: Math.max(0, usage?.total_tokens ?? 0),
  }
}

function usageDelta(
  current: WorkflowUsage | undefined,
  starting: WorkflowUsage | undefined,
): WorkflowUsage {
  const end = usageSnapshot(current)
  const start = usageSnapshot(starting)
  return {
    input_tokens: Math.max(0, end.input_tokens - start.input_tokens),
    cache_read_tokens: Math.max(
      0,
      end.cache_read_tokens - start.cache_read_tokens,
    ),
    cache_creation_tokens: Math.max(
      0,
      end.cache_creation_tokens - start.cache_creation_tokens,
    ),
    completion_tokens: Math.max(
      0,
      end.completion_tokens - start.completion_tokens,
    ),
    total_tokens: Math.max(0, end.total_tokens - start.total_tokens),
  }
}

function reviewerPerformance(input: {
  dispatch: DispatchRecord
  request: WorkerDispatchRequest | undefined
  result: WorkerTerminalResult
  currentUsage: WorkflowUsage | undefined
  finishedAt: string
}): Record<string, unknown> | undefined {
  if (
    input.result.workerType !== 'document-reviewer' ||
    input.request?.workerType !== 'document-reviewer'
  )
    return undefined
  const contract = input.request.contract
  const startedAt = Date.parse(input.dispatch.startedAt)
  const finishedAt = Date.parse(input.finishedAt)
  return {
    scope: contract.reviewScope,
    role: contract.reviewRole,
    durationMs:
      Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, finishedAt - startedAt)
        : 0,
    usage: usageDelta(input.currentUsage, input.dispatch.startingUsage),
    reportPaths: input.result.reportPaths,
  }
}

function resourceTaskPerformance(input: {
  dispatch: DispatchRecord
  request: WorkerDispatchRequest | undefined
  result: WorkerTerminalResult
  currentUsage: WorkflowUsage | undefined
  finishedAt: string
}): Record<string, unknown> | undefined {
  if (
    !input.request ||
    ![
      'resource-planner',
      'resource-curator',
      'resource-content-author',
    ].includes(input.request.workerType) ||
    !('taskMetrics' in input.result)
  )
    return undefined
  const startedAt = Date.parse(input.dispatch.startedAt)
  const finishedAt = Date.parse(input.finishedAt)
  return {
    task: input.request.taskId,
    durationMs:
      Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, finishedAt - startedAt)
        : 0,
    usage: usageDelta(input.currentUsage, input.dispatch.startingUsage),
    ...input.result.taskMetrics,
  }
}

async function documentPerformance(input: {
  dispatch: DispatchRecord
  request: WorkerDispatchRequest | undefined
  result: WorkerTerminalResult
  currentUsage: WorkflowUsage | undefined
  finishedAt: string
}): Promise<Record<string, unknown> | undefined> {
  if (
    input.result.workerType !== 'document-author' ||
    input.request?.workerType !== 'document-author'
  )
    return undefined
  const receipt = await readAuthoredDocumentReceipt(
    input.request.workspacePath,
    input.dispatch.dispatchId,
  )
  const fileBytes = async (path: string | undefined): Promise<number> => {
    if (!path) return 0
    try {
      return (await stat(resolve(input.request!.workspacePath, path))).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }
  const targetPath =
    typeof input.request.contract.foundationDocumentPath === 'string'
      ? input.request.contract.foundationDocumentPath
      : receipt?.targetPath
  const projectionPath = `.beegame/workflow/document-projections/${input.dispatch.dispatchId}.json`
  const startedAt = Date.parse(input.dispatch.startedAt)
  const finishedAt = Date.parse(input.finishedAt)
  const authoringUsage = input.result.authoringMetrics
    ? {
        input_tokens: input.result.authoringMetrics.inputTokens,
        cache_read_tokens: input.result.authoringMetrics.cacheReadTokens,
        cache_creation_tokens:
          input.result.authoringMetrics.cacheCreationTokens,
        completion_tokens: input.result.authoringMetrics.outputTokens,
        total_tokens: input.result.authoringMetrics.rawProcessedTokens,
      }
    : usageDelta(input.currentUsage, input.dispatch.startingUsage)
  return {
    targetPath,
    documentAuthority: 'markdown_only',
    usage: authoringUsage,
    durationMs:
      Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, finishedAt - startedAt)
        : 0,
    markdownBytes: await fileBytes(receipt?.targetPath ?? targetPath),
    projectionBytes: await fileBytes(projectionPath),
    retryReason: null,
  }
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
  return (
    workerType !== 'document-author' &&
    workerType !== 'document-reviewer' &&
    workerType !== 'resource-planner' &&
    workerType !== 'resource-curator' &&
    workerType !== 'resource-content-author'
  )
}

function assertSingleResourceWorkAuthority(
  request: WorkerDispatchRequest,
  run: DeliveryRun,
): void {
  const taskByWorker = {
    'resource-planner': 'RESOURCE_PLAN',
    'resource-curator': 'RESOURCE_INVENTORY',
    'resource-content-author': 'RESOURCE_CONTENT',
  } as const
  const task = taskByWorker[request.workerType as keyof typeof taskByWorker]
  if (!task) return
  const remediation = request.contract.remediation
  const review = run.documentReviewState.activeRun
  const hasAcceptedResourceAuthority = Boolean(
    review?.scope === 'complete' && review.verdict === 'NEEDS_REVISION',
  )
  if (!hasAcceptedResourceAuthority) {
    if (remediation !== undefined)
      throw new DispatchError(
        'blocked',
        'resource remediation requires the active accepted document-review authority',
      )
    return
  }
  const expected = {
    reviewReportPath: review!.finalReportPath,
    affectedPaths: review!.affectedPaths,
    sourceRevision: review!.revision,
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
  onTerminal?: (
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ) => Promise<void>
}) {
  const byKey = new Map<string, DispatchRecord>()
  const requests = new Map<string, WorkerDispatchRequest>()
  const creditSettled = new Set<string>()
  const transportCleanupStarted = new Set<string>()
  const startingDispatches = new Set<string>()
  const terminalReconciliations = new Set<Promise<void>>()
  let dispatchTail: Promise<void> = Promise.resolve()

  async function acquireDispatchLease(runId: string): Promise<WorkflowLock> {
    return options.store.mutationLock(runId)
  }

  function trackTerminalReconciliation(operation: Promise<void>): void {
    let tracked!: Promise<void>
    tracked = operation.finally(() => terminalReconciliations.delete(tracked))
    terminalReconciliations.add(tracked)
    void tracked.catch(() => undefined)
  }

  async function waitForTerminalReconciliation(): Promise<void> {
    await dispatchTail
    while (terminalReconciliations.size)
      await Promise.allSettled([...terminalReconciliations])
  }

  function forgetDispatch(dispatchId: string): void {
    for (const [key, record] of byKey.entries()) {
      if (record.dispatchId === dispatchId) byKey.delete(key)
    }
    requests.delete(dispatchId)
  }

  function releaseDispatch(
    dispatchId: string,
    cleanup: { stopReason?: string; preserveSession?: boolean } = {},
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
      await options.workerPort
        .close?.(dispatchId, {
          ...(cleanup.preserveSession ? { preserveSession: true } : {}),
        })
        .catch(() => undefined)
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
    if (request.workerType === 'document-reviewer')
      return dispatchUnlocked(request)
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
    const foundationPath = foundationPathFor(request)
    const reviewRole = reviewerRoleFor(request)
    const durableDispatch = foundationPath
      ? foundationDispatch(run, foundationPath)
      : reviewRole
        ? reviewerDispatch(run, reviewRole)
        : run.activeDispatch
    if (
      durableDispatch?.status === 'completed' &&
      durableDispatch.phase === request.phase &&
      durableDispatch.revision === request.revision &&
      durableDispatch.taskId === request.taskId &&
      durableDispatch.workerType === request.workerType
    )
      return durableDispatch
    if (durableDispatch?.status === 'running') {
      const existing = durableDispatch
      if (
        existing.phase === request.phase &&
        existing.revision === request.revision &&
        existing.taskId === request.taskId &&
        existing.workerType === request.workerType
      )
        return existing
      throw new DispatchError(
        'duplicate',
        'another delivery worker is already running',
      )
    }
    if (foundationPath && run.activeDispatch?.status === 'running')
      throw new DispatchError(
        'duplicate',
        'a regular delivery worker is already running',
      )
    if (!foundationPath && hasRunningFoundationDispatch(run))
      throw new DispatchError(
        'duplicate',
        'foundation document authoring batch is active',
      )
    if (reviewRole && run.activeDispatch?.status === 'running')
      throw new DispatchError(
        'duplicate',
        'a regular delivery worker is already running',
      )
    if (!reviewRole && hasRunningReviewerDispatch(run))
      throw new DispatchError('duplicate', 'document review batch is active')
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
      startingUsage: usageSnapshot(run.usage),
      startedAt: now(),
      request: dispatchRequest,
    })
    byKey.set(key, record)
    requests.set(record.dispatchId, request)
    startingDispatches.add(dispatchId)
    let startedDispatchId: string | undefined
    try {
      const lease = await acquireDispatchLease(run.runId)
      try {
        const current = await options.store.load(lease)
        if (!current || current.runId !== run.runId)
          throw new DispatchError('not_found', 'delivery run does not exist')
        assertSingleResourceWorkAuthority(request, current)
        if (current.status !== 'running')
          throw new DispatchError('blocked', 'delivery run is not running')
        const currentFoundationPath = foundationPathFor(request)
        const currentReviewRole = reviewerRoleFor(request)
        const active = currentFoundationPath
          ? foundationDispatch(current, currentFoundationPath)
          : currentReviewRole
            ? reviewerDispatch(current, currentReviewRole)
            : current.activeDispatch
        if (active) {
          if (
            active.phase === request.phase &&
            active.revision === request.revision &&
            active.taskId === request.taskId &&
            active.workerType === request.workerType
          ) {
            forgetDispatch(record.dispatchId)
            return active
          }
          throw new DispatchError(
            'duplicate',
            'another delivery worker is already running',
          )
        }
        if (
          currentFoundationPath &&
          current.activeDispatch?.status === 'running'
        )
          throw new DispatchError(
            'duplicate',
            'a regular delivery worker is already running',
          )
        if (!currentFoundationPath && hasRunningFoundationDispatch(current))
          throw new DispatchError(
            'duplicate',
            'foundation document authoring batch is active',
          )
        if (currentReviewRole && current.activeDispatch?.status === 'running')
          throw new DispatchError(
            'duplicate',
            'a regular delivery worker is already running',
          )
        if (!currentReviewRole && hasRunningReviewerDispatch(current))
          throw new DispatchError(
            'duplicate',
            'document review batch is active',
          )
        const next = currentFoundationPath
          ? {
              ...current,
              foundationDraftState: recordFoundationDispatch(
                current.foundationDraftState,
                currentFoundationPath,
                'drafting',
                record,
              ),
            }
          : currentReviewRole
            ? withReviewerDispatch(current, currentReviewRole, record)
            : { ...current, activeDispatch: record }
        await options.store.commit(
          {
            ...next,
            lastProgressAt: record.startedAt,
            currentMessage: undefined,
            currentItemId:
              request.workerType === 'document-author' && request.taskId
                ? request.taskId
                : undefined,
            thinking: 'working',
          },
          {
            runId: current.runId,
            type: 'dispatch.started',
            phase: current.phase,
            status: current.status,
            revision: current.revision,
            dispatchId: record.dispatchId,
            workerType: request.workerType,
            taskId: request.taskId,
          },
          undefined,
          lease,
        )
      } finally {
        await options.store.unlock(lease)
      }
      await options.credits?.reserve?.(key, request)
      const started = await options.workerPort.start(dispatchRequest)
      startedDispatchId = started.dispatchId
      if (started.dispatchId !== dispatchId)
        throw new Error(
          'worker returned a dispatch id that does not match the durable dispatch',
        )
      let current = await options.store.load()
      if (foundationPath && current) {
        const lease = await acquireDispatchLease(run.runId)
        try {
          const locked = await options.store.load(lease)
          const location = locked
            ? dispatchLocation(locked, record.dispatchId)
            : undefined
          if (locked && location?.path === foundationPath) current = locked
        } finally {
          await options.store.unlock(lease)
        }
      }
      const currentLocation = current
        ? dispatchLocation(current, record.dispatchId)
        : undefined
      if (
        !current ||
        current.runId !== run.runId ||
        current.status !== 'running' ||
        currentLocation?.record.status !== 'running'
      ) {
        releaseDispatch(record.dispatchId, {
          stopReason: 'delivery dispatch lost durable authority before submit',
        })
        if (currentLocation) return currentLocation.record
        throw new DispatchError(
          'blocked',
          'delivery dispatch lost durable authority before submit',
        )
      }
      // Supervision starts as soon as the durable dispatch owns a transport.
      // submit() spans the complete model turn, so attaching these observers
      // after awaiting it would leave thinking/tool execution unsupervised.
      if (options.workerPort.waitForTerminal) {
        trackTerminalReconciliation(
          options.workerPort
            .waitForTerminal(record.dispatchId)
            .then(async terminal => {
              await completeDispatch(record.dispatchId, terminal)
            })
            .catch(async error => {
              if (isWorkerNeedsActionError(error))
                await markDispatchNeedsAction(record.dispatchId, error.message)
              else {
                const reason =
                  error instanceof Error
                    ? error.message
                    : 'worker did not produce a terminal result'
                await markDispatchFailed(record.dispatchId, reason)
              }
            }),
        )
      }
      await options.workerPort.submit(dispatchId, buildWorkerPrompt(request))
    } catch (error) {
      const current = await options.store.load()
      const currentLocation = current
        ? dispatchLocation(current, record.dispatchId)
        : undefined
      if (currentLocation && currentLocation.record.status !== 'running') {
        releaseDispatch(record.dispatchId)
        return currentLocation.record
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
    } finally {
      startingDispatches.delete(dispatchId)
    }
    return record
  }

  function isWorkerNeedsActionError(error: unknown): error is Error {
    return error instanceof Error && error.name === 'WorkerNeedsActionError'
  }

  async function completeDispatch(
    dispatchId: string,
    terminalValue: unknown,
  ): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (run.status !== 'running')
      throw new DispatchError('blocked', 'delivery run is no longer running')
    if (location.record.status !== 'running')
      throw new DispatchError('not_found', 'dispatch is not active')
    const request = requests.get(dispatchId) ?? location.record.request
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
        ...location.record,
        status: 'invalid' as const,
        finishedAt: now(),
        failureReason: reason,
      })
      const failedRun = location.path
        ? {
            ...run,
            foundationDraftState: recordFoundationFailure(
              run.foundationDraftState,
              location.path,
              reason,
            ),
            thinking: 'idle' as const,
          }
        : location.reviewRole
          ? withReviewerFailure(run, location.reviewRole, invalid, reason)
          : {
              ...run,
              status: 'failed' as const,
              blockedReason: reason,
              activeDispatch: invalid,
              thinking: 'idle' as const,
            }
      const isolatedStatus = location.path
        ? isolatedFoundationFailureStatus(failedRun)
        : failedRun.status
      await options.store.commit(
        {
          ...failedRun,
          status: isolatedStatus,
          ...(isolatedStatus === 'needs_action'
            ? { blockedReason: reason }
            : {}),
        },
        {
          runId: run.runId,
          type: 'dispatch.invalid',
          phase: run.phase,
          status: isolatedStatus,
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
    const finishedAt = now()
    const completed = parseDispatchRecord({
      ...location.record,
      status,
      ...(terminalEvidencePath(result)
        ? { terminalEvidencePath: terminalEvidencePath(result) }
        : {}),
      terminalResult: result as unknown as Record<string, unknown>,
      finishedAt,
    })
    const updatedWithDispatch = location.path
      ? withFoundationDispatch(run, location.path, completed)
      : location.reviewRole
        ? withReviewerDispatch(run, location.reviewRole, completed)
        : { ...run, activeDispatch: completed }
    const updated = {
      ...updatedWithDispatch,
      thinking:
        hasRunningFoundationDispatch(updatedWithDispatch) ||
        hasRunningReviewerDispatch(updatedWithDispatch)
          ? ('working' as const)
          : ('idle' as const),
    }
    const performance = reviewerPerformance({
      dispatch: location.record,
      request,
      result,
      currentUsage: run.usage,
      finishedAt,
    })
    const resourcePerformance = resourceTaskPerformance({
      dispatch: location.record,
      request,
      result,
      currentUsage: run.usage,
      finishedAt,
    })
    const completedDocumentPerformance = await documentPerformance({
      dispatch: location.record,
      request,
      result,
      currentUsage: run.usage,
      finishedAt,
    })
    await options.store.commit(updated, {
      runId: run.runId,
      type: `dispatch.${status}`,
      phase: run.phase,
      status: run.status,
      revision: run.revision,
      dispatchId,
      workerType: result.workerType,
      ...(performance ? { reviewerPerformance: performance } : {}),
      ...(resourcePerformance
        ? { resourceTaskPerformance: resourcePerformance }
        : {}),
      ...(completedDocumentPerformance
        ? { documentPerformance: completedDocumentPerformance }
        : {}),
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
    let terminalHandlerCompleted = false
    let draftSessionPreserved = false
    try {
      if (!creditSettled.has(key)) {
        await options.credits?.settle?.(key, result)
        creditSettled.add(key)
      }
      if (request?.contract.authoringMode === 'parallel-draft') {
        await options.workerPort.close?.(dispatchId, {
          preserveSession: true,
        })
        forgetDispatch(dispatchId)
        draftSessionPreserved = true
      }
      terminalHandlerStarted = true
      await options.onTerminal?.(completed, result, request)
      terminalHandlerCompleted = true
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
      const currentLocation = current
        ? dispatchLocation(current, dispatchId)
        : undefined
      if (current && current.runId === run.runId && currentLocation) {
        const handlerFailure = terminalHandlerStarted
        const status: DeliveryRun['status'] = handlerFailure
          ? 'needs_action'
          : 'failed'
        const failedCurrent = currentLocation.path
          ? {
              ...current,
              foundationDraftState: handlerFailure
                ? recordFoundationHandlerFailure(
                    current.foundationDraftState,
                    currentLocation.path,
                    reason,
                    completed,
                  )
                : recordFoundationFailure(
                    current.foundationDraftState,
                    currentLocation.path,
                    reason,
                  ),
              status: isolatedFoundationFailureStatus(current),
            }
          : currentLocation.reviewRole
            ? withReviewerFailure(
                current,
                currentLocation.reviewRole,
                failed,
                reason,
              )
            : { ...current, status, activeDispatch: failed }
        await options.store.commit(
          {
            ...failedCurrent,
            blockedReason: reason,
            thinking: 'idle',
          },
          {
            runId: current.runId,
            type: 'workflow.handler_failed',
            phase: current.phase,
            status: failedCurrent.status,
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
      if (!draftSessionPreserved || !terminalHandlerCompleted)
        releaseDispatch(dispatchId, {
          preserveSession:
            terminalHandlerCompleted &&
            request?.contract.authoringMode === 'parallel-draft',
        })
    }
    return { record: completed, result }
  }

  async function replayTerminal(
    record: DispatchRecord,
    onTerminal = options.onTerminal,
  ): Promise<void> {
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
      await onTerminal?.(record, result, record.request)
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
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (location.record.status !== 'running') return location.record
    const failed = parseDispatchRecord({
      ...location.record,
      status: 'failed',
      finishedAt: now(),
      failureReason: reason,
    })
    const failedRun = location.path
      ? {
          ...run,
          foundationDraftState: recordFoundationFailure(
            run.foundationDraftState,
            location.path,
            reason,
          ),
        }
      : location.reviewRole
        ? withReviewerFailure(run, location.reviewRole, failed, reason)
        : { ...run, activeDispatch: failed }
    const status: DeliveryRun['status'] = location.path
      ? isolatedFoundationFailureStatus(failedRun)
      : location.reviewRole
        ? failedRun.status
        : 'failed'
    await options.store.commit(
      {
        ...failedRun,
        status,
        ...(status === 'running' ? {} : { blockedReason: reason }),
        thinking:
          hasRunningFoundationDispatch(failedRun) ||
          hasRunningReviewerDispatch(failedRun)
            ? 'working'
            : 'idle',
      },
      {
        runId: run.runId,
        type: 'dispatch.failed',
        phase: run.phase,
        status,
        revision: run.revision,
        dispatchId,
        reason,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    return failed
  }

  async function markDispatchNeedsAction(
    dispatchId: string,
    reason: string,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (location.record.status !== 'running') return location.record
    const interrupted = parseDispatchRecord({
      ...location.record,
      status: 'interrupted',
      finishedAt: now(),
      failureReason: reason,
    })
    const interruptedRun = location.path
      ? {
          ...run,
          foundationDraftState: recordFoundationFailure(
            run.foundationDraftState,
            location.path,
            reason,
          ),
        }
      : location.reviewRole
        ? withReviewerFailure(run, location.reviewRole, interrupted, reason)
        : { ...run, activeDispatch: interrupted }
    const status: DeliveryRun['status'] = location.path
      ? isolatedFoundationFailureStatus(interruptedRun)
      : location.reviewRole
        ? interruptedRun.status
        : 'needs_action'
    await options.store.commit(
      {
        ...interruptedRun,
        status,
        ...(status === 'running' ? {} : { blockedReason: reason }),
        thinking:
          hasRunningFoundationDispatch(interruptedRun) ||
          hasRunningReviewerDispatch(interruptedRun)
            ? 'working'
            : 'idle',
      },
      {
        runId: run.runId,
        type: 'dispatch.needs_action',
        phase: run.phase,
        status,
        revision: run.revision,
        dispatchId,
        reason,
      },
    )
    releaseDispatch(dispatchId, { stopReason: reason })
    return interrupted
  }

  async function stop(
    dispatchId: string,
    reason: string,
  ): Promise<DispatchRecord> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location)
      throw new DispatchError('not_found', 'dispatch is not active')
    if (location.record.status !== 'running') return location.record
    const stopped = parseDispatchRecord({
      ...location.record,
      status: 'interrupted',
      finishedAt: now(),
    })
    const stoppedRun = location.path
      ? withFoundationDispatch(run, location.path, stopped)
      : location.reviewRole
        ? withReviewerFailure(run, location.reviewRole, stopped, reason)
        : { ...run, activeDispatch: stopped }
    await options.store.commit(
      {
        ...stoppedRun,
        status: 'stopped',
        blockedReason: reason,
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
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (location) return location.record
    const record = [...byKey.values()].find(
      candidate => candidate.dispatchId === dispatchId,
    )
    if (!record) throw new DispatchError('not_found', 'dispatch is not known')
    return record
  }

  async function workerIsOpen(dispatchId: string): Promise<boolean> {
    if (startingDispatches.has(dispatchId)) return true
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
    waitForTerminalReconciliation,
    idempotencyKey,
  }
}
