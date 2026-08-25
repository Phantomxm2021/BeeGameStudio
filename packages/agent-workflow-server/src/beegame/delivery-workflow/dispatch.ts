import { createHash, randomUUID } from 'node:crypto'
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
  FoundationRevisionTask,
  WorkflowUsage,
  WorkerDispatchRequest,
} from './types'
import type { RunStore, WorkflowLock } from './run-store'
import type { FoundationAuditTask } from './foundation-audit-state'
import { claimFoundationFactTasks, digestFoundationFactTerminal, foundationFactOutputTokenLimit, type FoundationFactTask, type FoundationFactTaskCollection } from './foundation-fact-runtime'
import { claimFoundationSemanticTasks, digestFoundationSemanticTerminal, type FoundationSemanticRuntimeTask, type FoundationSemanticTaskCollection } from './foundation-semantic-runtime'
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
import {
  deriveFoundationPatchOperations,
  loadFoundationRevisionPacket,
  loadFoundationRevisionFactPacket,
  loadFoundationRevisionSemanticPacket,
  resetFoundationRevisionStage,
  type RevisionTaskReceipt,
} from './foundation-revision-stage'
import type { AuditIssue } from './foundation-issue-registry'

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

function dispatchLocation(
  run: DeliveryRun,
  dispatchId: string,
):
  | {
      record: DispatchRecord
      path?: FoundationDocumentPath
      auditTaskId?: string
      revisionTaskId?: string
    }
  | undefined {
  if (run.activeDispatch?.dispatchId === dispatchId)
    return { record: run.activeDispatch }
  for (const document of run.foundationDraftState.documents ?? [])
    if (document.dispatch?.dispatchId === dispatchId)
      return { record: document.dispatch, path: document.path }
  for (const task of run.foundationAuditState?.tasks ?? [])
    if (task.dispatch?.dispatchId === dispatchId)
      return { record: task.dispatch, auditTaskId: task.taskId }
  for (const task of run.foundationRevisionState?.tasks ?? [])
    if (task.dispatch?.dispatchId === dispatchId)
      return { record: task.dispatch, revisionTaskId: task.taskId }
  return undefined
}

function isFoundationFactRequest(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'foundation-fact-extractor'
}
function isFoundationSemanticRequest(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'foundation-semantic-reviewer'
}

function isFoundationRevisionRequest(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'foundation-document-reviser'
}

function isFoundationRevisionSemanticRequest(run: DeliveryRun, request: WorkerDispatchRequest): boolean {
  return request.workerType === 'foundation-semantic-reviewer' && !!request.taskId &&
    run.foundationRevisionState?.tasks.some(task => task.taskId === request.taskId && task.kind === 'semantic-recheck') === true
}

function auditFactDispatch(
  run: DeliveryRun,
  taskId: string,
): DispatchRecord | undefined {
  return run.foundationAuditState?.tasks.find(task => task.taskId === taskId)?.dispatch
}

function revisionDispatch(run: DeliveryRun, taskId: string): DispatchRecord | undefined {
  return run.foundationRevisionState?.tasks.find(task => task.taskId === taskId)?.dispatch
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
  return (
    workerType !== 'document-author' &&
    workerType !== 'foundation-fact-extractor' &&
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

  async function mutateFoundationAuditTask(
    dispatchId: string,
    eventType: string,
    mutate: (input: { task: FoundationAuditTask; record: DispatchRecord }) => {
      task: FoundationAuditTask
      record: DispatchRecord
      runStatus?: DeliveryRun['status']
      blockedReason?: string
    },
  ): Promise<DispatchRecord> {
    const initial = await options.store.load()
    const initialLocation = initial ? dispatchLocation(initial, dispatchId) : undefined
    if (!initial || !initialLocation?.auditTaskId)
      throw new DispatchError('not_found', 'foundation audit task dispatch is not active')
    const lease = await acquireDispatchLease(initial.runId)
    try {
      const locked = await options.store.load(lease)
      const location = locked ? dispatchLocation(locked, dispatchId) : undefined
      const task = location?.auditTaskId
        ? locked?.foundationAuditState?.tasks.find(candidate => candidate.taskId === location.auditTaskId)
        : undefined
      if (!locked || !location?.auditTaskId || !task || task.dispatch?.dispatchId !== dispatchId)
        throw new DispatchError('not_found', 'foundation audit task dispatch lost durable authority')
      const changed = mutate({ task, record: task.dispatch! })
      const next = {
        ...locked,
        ...(changed.runStatus ? { status: changed.runStatus } : {}),
        ...(changed.blockedReason !== undefined ? { blockedReason: changed.blockedReason } : {}),
        foundationAuditState: {
          ...locked.foundationAuditState!,
          tasks: locked.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId ? changed.task : candidate),
        },
      }
      await options.store.commit(next, {
        runId: locked.runId,
        type: eventType,
        phase: locked.phase,
        status: next.status,
        revision: locked.revision,
        dispatchId,
        taskId: task.taskId,
      }, undefined, lease)
      return changed.record
    } finally { await options.store.unlock(lease) }
  }

  async function mutateFoundationRevisionTask(
    dispatchId: string,
    eventType: string,
    mutate: (input: { task: FoundationRevisionTask; record: DispatchRecord }) => {
      task: FoundationRevisionTask
      record: DispatchRecord
      runStatus?: DeliveryRun['status']
      blockedReason?: string
    },
  ): Promise<DispatchRecord> {
    const initial = await options.store.load()
    const initialLocation = initial ? dispatchLocation(initial, dispatchId) : undefined
    if (!initial || !initialLocation?.revisionTaskId)
      throw new DispatchError('not_found', 'foundation revision task dispatch is not active')
    const lease = await acquireDispatchLease(initial.runId)
    try {
      const locked = await options.store.load(lease)
      const location = locked ? dispatchLocation(locked, dispatchId) : undefined
      const task = location?.revisionTaskId
        ? locked?.foundationRevisionState?.tasks.find(candidate => candidate.taskId === location.revisionTaskId)
        : undefined
      if (!locked || !location?.revisionTaskId || !task || task.dispatch?.dispatchId !== dispatchId)
        throw new DispatchError('not_found', 'foundation revision task dispatch lost durable authority')
      const changed = mutate({ task, record: task.dispatch! })
      const next = {
        ...locked,
        ...(changed.runStatus ? { status: changed.runStatus } : {}),
        ...(changed.blockedReason !== undefined ? { blockedReason: changed.blockedReason } : {}),
        foundationRevisionState: {
          ...locked.foundationRevisionState!,
          status: changed.runStatus === 'needs_action' ? 'needs_action' as const : locked.foundationRevisionState!.status,
          tasks: locked.foundationRevisionState!.tasks.map(candidate => candidate.taskId === task.taskId ? changed.task : candidate),
        },
      }
      await options.store.commit(next, {
        runId: locked.runId,
        type: eventType,
        phase: locked.phase,
        status: next.status,
        revision: locked.revision,
        dispatchId,
        taskId: task.taskId,
      }, undefined, lease)
      return changed.record
    } finally { await options.store.unlock(lease) }
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
    const foundationPath = foundationPathFor(request)
    const factRequest = isFoundationFactRequest(request)
    const revisionSemanticRequest = isFoundationRevisionSemanticRequest(run, request)
    const semanticRequest = isFoundationSemanticRequest(request) && !revisionSemanticRequest
    const revisionRequest = isFoundationRevisionRequest(request)
    const revisionFactRequest = factRequest && Boolean(request.taskId && run.foundationRevisionState?.tasks.some(task => task.taskId === request.taskId && task.kind === 'impacted-facts'))
    const revisionTaskRequest = revisionRequest || revisionFactRequest || revisionSemanticRequest
    const auditRequest = semanticRequest || (factRequest && !revisionFactRequest)
    const durableDispatch = auditRequest && request.taskId
      ? auditFactDispatch(run, request.taskId)
      : revisionTaskRequest && request.taskId
        ? revisionDispatch(run, request.taskId)
      : foundationPath
        ? foundationDispatch(run, foundationPath)
        : run.activeDispatch

    if (
      durableDispatch?.status === 'completed' &&
      (!auditRequest || run.foundationAuditState?.tasks.some(task => task.taskId === request.taskId && task.status === 'completed')) &&
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
    if (!foundationPath && !factRequest && !semanticRequest && !revisionRequest && hasRunningFoundationDispatch(run))
      throw new DispatchError(
        'duplicate',
        'foundation document authoring batch is active',
      )
    const durableTask = request.taskId
      ? revisionTaskRequest
        ? run.foundationRevisionState?.tasks.find(task => task.taskId === request.taskId)
        : auditRequest
          ? run.foundationAuditState?.tasks.find(task => task.taskId === request.taskId)
          : run.tasks.find(task => task.id === request.taskId)
      : undefined
    const attempt = durableTask && typeof durableTask.attempt === 'number'
      ? durableTask.attempt + 1
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
        const currentFactTask = auditRequest && request.taskId
          ? current.foundationAuditState?.tasks.find(task => task.taskId === request.taskId)
          : undefined
        const currentRevisionTask = revisionTaskRequest && request.taskId
          ? current.foundationRevisionState?.tasks.find(task => task.taskId === request.taskId)
          : undefined
        if (auditRequest) {
          if (!currentFactTask || !['pending', 'retryable'].includes(currentFactTask.status))
            throw new DispatchError('duplicate', 'foundation fact task is not claimable')
          if (currentFactTask.revision !== request.revision || currentFactTask.packetDigest !== request.contract.packetDigest || (semanticRequest && (currentFactTask.kind !== 'semantic' && currentFactTask.kind !== 'confirmation')) || (factRequest && currentFactTask.kind !== 'document-facts'))
            throw new DispatchError('blocked', 'foundation fact packet or revision is stale')
          if ((current.foundationAuditState?.tasks.filter(task => task.status === 'running').length ?? 0) >= 4)
            throw new DispatchError('duplicate', 'foundation fact concurrency limit reached')
          if (currentFactTask.attempt >= 2)
            throw new DispatchError('blocked', 'foundation fact task attempt cap exceeded')
        }
        if (revisionTaskRequest) {
          const expectedKind = revisionFactRequest ? 'impacted-facts' : revisionSemanticRequest ? 'semantic-recheck' : 'document-revision'
          if (!currentRevisionTask || currentRevisionTask.kind !== expectedKind)
            throw new DispatchError('blocked', `foundation revision task kind mismatch: expected ${expectedKind}`)
          if (!['pending', 'retryable'].includes(currentRevisionTask.status))
            throw new DispatchError('duplicate', 'foundation revision task is not claimable')
          if (currentRevisionTask.revision !== request.revision || currentRevisionTask.packetDigest !== request.contract.packetDigest || currentRevisionTask.packetPath !== request.contract.packetPath || currentRevisionTask.round !== request.contract.round)
            throw new DispatchError('blocked', 'foundation revision task is stale')
          if (revisionSemanticRequest && currentRevisionTask.kind === 'semantic-recheck' && (request.contract.issueId !== currentRevisionTask.issueId || request.contract.modelTier !== currentRevisionTask.modelTier || currentRevisionTask.modelTier !== 'strong'))
            throw new DispatchError('blocked', 'foundation semantic revision task identity or model tier is stale')
          if ((current.foundationRevisionState?.tasks.filter(task => task.status === 'running').length ?? 0) >= 4)
            throw new DispatchError('duplicate', 'foundation revision concurrency limit reached')
          if (currentRevisionTask.attempt >= 2) {
            const reason = 'foundation revision task attempt cap exceeded'
            await options.store.commit({ ...current, status: 'needs_action', blockedReason: reason, foundationRevisionState: { ...current.foundationRevisionState!, status: 'needs_action', tasks: current.foundationRevisionState!.tasks.map(task => task.taskId === request.taskId ? { ...task, status: 'needs_action' as const, failureReason: reason } : task) } }, { runId: current.runId, type: 'foundation.revision.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, taskId: request.taskId, reason }, undefined, lease)
            throw new DispatchError('blocked', reason)
          }
        }
        let fastModelError: string | undefined
        if (factRequest && options.workerPort.assertFoundationFactFastReady) {
          try {
            await options.workerPort.assertFoundationFactFastReady(request)
          } catch (error) {
            fastModelError = error instanceof Error ? error.message : 'foundation fact extractor fast model is not configured'
          }
        }
        if (revisionFactRequest && fastModelError) {
          await options.store.commit({
            ...current,
            status: 'needs_action',
            blockedReason: fastModelError,
            foundationRevisionState: {
              ...current.foundationRevisionState!,
              status: 'needs_action',
              tasks: current.foundationRevisionState!.tasks.map(task => task.taskId === request.taskId
                ? { ...task, status: 'needs_action' as const, failureReason: fastModelError }
                : task),
            },
          }, { runId: current.runId, type: 'foundation.revision.impacted_facts.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, taskId: request.taskId, reason: fastModelError }, undefined, lease)
          throw new DispatchError('blocked', fastModelError)
        }
        if ((semanticRequest || revisionSemanticRequest) && options.workerPort.assertFoundationSemanticModelReady) {
          try { await options.workerPort.assertFoundationSemanticModelReady(request) }
          catch (error) { fastModelError = error instanceof Error ? error.message : 'foundation semantic model is not configured' }
        }
        if (revisionSemanticRequest && fastModelError) {
          const reason = fastModelError
          await options.store.commit({
            ...current,
            status: 'needs_action',
            blockedReason: reason,
            foundationRevisionState: {
              ...current.foundationRevisionState!,
              status: 'needs_action',
              tasks: current.foundationRevisionState!.tasks.map(task => task.taskId === request.taskId
                ? { ...task, status: 'needs_action' as const, failureReason: reason }
                : task),
            },
          }, { runId: current.runId, type: 'foundation.revision.semantic.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, taskId: request.taskId, reason }, undefined, lease)
          throw new DispatchError('blocked', reason)
        }
        let claimedFoundationState: FoundationFactTaskCollection | undefined
        if (factRequest && !revisionFactRequest && current.foundationAuditState && request.taskId) {
          const claimed = claimFoundationFactTasks({
            revision: current.foundationAuditState.revision,
            phaseStartedAt: current.foundationAuditState.phaseStartedAt!,
            status: current.foundationAuditState.status === 'facts_staged' ? 'facts_staged' : 'extracting_facts',
            tasks: current.foundationAuditState.tasks.filter(task => task.kind === 'document-facts'),
            aggregateUsage: current.foundationAuditState.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }, {
            onlyTaskId: fastModelError ? undefined : request.taskId,
            dispatchIdFor: () => record.dispatchId,
            now: record.startedAt,
            modelReady: !fastModelError && Boolean(request.workflowJsonSchema),
          })
          claimedFoundationState = claimed
          const claimedTask = claimed.tasks.find(task => task.taskId === request.taskId)
          if (!claimedTask || claimedTask.status !== 'running') {
            const blocked = claimedTask?.failureReason ?? fastModelError ?? 'foundation fact task is not claimable'
            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: claimed.tasks }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.fact.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)
            throw new DispatchError('blocked', blocked)
          }
        }
        let claimedSemanticState: FoundationSemanticTaskCollection | undefined
        if (semanticRequest && current.foundationAuditState && request.taskId) {
          const semanticTasks = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation') as FoundationSemanticRuntimeTask[]
          const claimed = claimFoundationSemanticTasks({ revision: current.foundationAuditState.revision, phaseStartedAt: current.foundationAuditState.phaseStartedAt!, status: 'semantic_review', tasks: semanticTasks, aggregateUsage: current.foundationAuditState.semantic?.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(current.foundationAuditState.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: current.foundationAuditState.semantic.deepPhaseStartedAt } : {}), ...(current.foundationAuditState.semantic?.deepAggregateUsage ? { deepAggregateUsage: current.foundationAuditState.semantic.deepAggregateUsage } : {}) }, { onlyTaskId: fastModelError ? undefined : request.taskId, dispatchIdFor: () => record.dispatchId, now: record.startedAt, configuredTiers: { [request.contract.modelTier as string]: !fastModelError } })
          claimedSemanticState = claimed
          const claimedTask = claimed.tasks.find(task => task.taskId === request.taskId)
          if (!claimedTask || claimedTask.status !== 'running') {
            const blocked = claimedTask?.failureReason ?? fastModelError ?? 'foundation semantic task is not claimable'
            await options.store.commit({ ...current, foundationAuditState: { ...current.foundationAuditState, tasks: current.foundationAuditState.tasks.map(task => claimed.tasks.find(candidate => candidate.taskId === task.taskId) ?? task), semantic: { aggregateUsage: claimed.aggregateUsage, ...(claimed.deepPhaseStartedAt ? { deepPhaseStartedAt: claimed.deepPhaseStartedAt } : {}), ...(claimed.deepAggregateUsage ? { deepAggregateUsage: claimed.deepAggregateUsage } : {}) } }, status: 'needs_action', blockedReason: blocked, thinking: 'idle' }, { runId: current.runId, type: 'foundation.semantic.claim_blocked', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, taskId: request.taskId, reason: blocked }, undefined, lease)
            throw new DispatchError('blocked', blocked)
          }
        }
        const active = currentFactTask
          ? currentFactTask.dispatch?.status === 'running'
            ? currentFactTask.dispatch
            : undefined
          : currentRevisionTask?.dispatch?.status === 'running'
            ? currentRevisionTask.dispatch
          : currentFoundationPath
            ? foundationDispatch(current, currentFoundationPath)
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
        if (
          !currentFoundationPath &&
          !factRequest &&
          !semanticRequest &&
          !revisionRequest &&
          hasRunningFoundationDispatch(current)
        )
          throw new DispatchError(
            'duplicate',
            'foundation document authoring batch is active',
          )
        const next = revisionTaskRequest && request.taskId && currentRevisionTask
          ? { ...current, foundationRevisionState: { ...current.foundationRevisionState!, tasks: current.foundationRevisionState!.tasks.map(task => task.taskId === request.taskId ? { ...task, status: 'running' as const, attempt: task.attempt + 1, dispatch: record } : task) } }
          : factRequest && request.taskId && claimedFoundationState
          ? { ...current, foundationAuditState: { ...current.foundationAuditState!, status: 'extracting_facts' as const, tasks: claimedFoundationState.tasks.map(task => task.taskId === request.taskId ? { ...task, dispatch: record } : task) } }
          : semanticRequest && request.taskId && claimedSemanticState
            ? { ...current, foundationAuditState: { ...current.foundationAuditState!, status: 'semantic_review' as const, tasks: current.foundationAuditState!.tasks.map(task => { const candidate = claimedSemanticState!.tasks.find(item => item.taskId === task.taskId); return candidate ? { ...task, ...candidate, ...(task.taskId === request.taskId ? { dispatch: record } : {}) } : task }), semantic: { aggregateUsage: claimedSemanticState.aggregateUsage, ...(claimedSemanticState.deepPhaseStartedAt ? { deepPhaseStartedAt: claimedSemanticState.deepPhaseStartedAt } : {}), ...(claimedSemanticState.deepAggregateUsage ? { deepAggregateUsage: claimedSemanticState.deepAggregateUsage } : {}) } } }
          : currentFoundationPath
            ? {
              ...current,
              foundationDraftState: recordFoundationDispatch(
                current.foundationDraftState,
                currentFoundationPath,
                'drafting',
                record,
              ),
              }
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
      if (revisionRequest && request.taskId) {
        const claimedRun = await options.store.load()
        const claimedTask = claimedRun?.foundationRevisionState?.tasks.find(task => task.taskId === request.taskId)
        if (!claimedTask || claimedTask.kind !== 'document-revision' || claimedTask.status !== 'running' || claimedTask.dispatch?.dispatchId !== record.dispatchId)
          throw new DispatchError('blocked', 'foundation revision task kind mismatch: expected document-revision')
        await resetFoundationRevisionStage({
          workspacePath: request.workspacePath,
          revision: claimedTask.revision,
          documentPath: claimedTask.documentPath,
          expectedBaseDocumentDigest: claimedTask.baseDocumentDigest,
        })
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
      const promptRequest = revisionRequest || revisionFactRequest || revisionSemanticRequest
        ? {
            ...request,
            contract: {
              ...request.contract,
              packet: await (revisionRequest ? loadFoundationRevisionPacket({
                workspacePath: request.workspacePath,
              revision: request.revision,
              round: Number(request.contract.round) as 1 | 2 | 3,
              taskId: request.taskId!,
              documentPath: request.contract.documentPath as FoundationDocumentPath,
                packetDigest: String(request.contract.packetDigest),
              }) : revisionFactRequest ? loadFoundationRevisionFactPacket({
                workspacePath: request.workspacePath,
                revision: request.revision,
                round: Number(request.contract.round) as 1 | 2 | 3,
                taskId: request.taskId!,
                packetDigest: String(request.contract.packetDigest),
              }) : loadFoundationRevisionSemanticPacket({
                workspacePath: request.workspacePath,
                revision: request.revision,
                round: Number(request.contract.round) as 1 | 2 | 3,
                taskId: request.taskId!,
                packetDigest: String(request.contract.packetDigest),
              })),
            },
          }
        : request
      await options.workerPort.submit(dispatchId, buildWorkerPrompt(promptRequest))
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

  function isTerminalFoundationFactFailure(reason: string): boolean {
    return /(?:fast model|model config|output cap|packet cap|attempt cap|not configured)/i.test(reason)
  }

  async function completeFoundationFactDispatch(
    dispatchId: string,
    terminalValue: unknown,
  ): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location?.auditTaskId)
      throw new DispatchError('not_found', 'foundation fact dispatch is not active')
    const request = requests.get(dispatchId) ?? location.record.request
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      const factResult = result.workerType === 'foundation-fact-extractor' ? result : undefined
      if (!factResult || !request || factResult.runId !== request.runId || factResult.dispatchId !== dispatchId || factResult.taskId !== request.taskId || factResult.revision !== request.revision || factResult.packetDigest !== request.contract.packetDigest)
        throw new Error('foundation fact terminal identity does not match dispatch contract')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid foundation fact terminal'
      const invalid = parseDispatchRecord({ ...location.record, status: 'invalid' as const, finishedAt: now(), failureReason: reason })
      await mutateFoundationAuditTask(dispatchId, 'dispatch.invalid', ({ task, record }) => ({
        task: { ...task, status: task.attempt < 2 ? 'retryable' : 'needs_action', failureReason: reason, dispatch: invalid },
        record: invalid,
        runStatus: task.attempt < 2 ? 'running' : 'needs_action',
        blockedReason: task.attempt < 2 ? undefined : reason,
      }))
      releaseDispatch(dispatchId)
      throw new DispatchError('invalid_terminal', 'invalid foundation fact terminal')
    }
    const factResult = result as Extract<WorkerTerminalResult, { workerType: 'foundation-fact-extractor' }>
    const factTask = run.foundationAuditState?.tasks.find(candidate => candidate.taskId === location.auditTaskId)
    const status = factResult.status === 'completed' ? 'completed' : factResult.status === 'blocked' ? 'blocked' : 'failed'
    const durable = await mutateFoundationAuditTask(dispatchId, `dispatch.${status}`, ({ task, record }) => {
      const completed = parseDispatchRecord({ ...record, status, terminalResult: result as unknown as Record<string, unknown>, finishedAt: now() })
      return { task: { ...task, dispatch: completed }, record: completed }
    })
    try {
      const key = request ? idempotencyKey(request, factTask?.attempt ?? 1) : dispatchId
      await options.credits?.settle?.(key, result)
      await options.onTerminal?.(durable, result, request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'workflow terminal handler failed'
      const terminalIsInvalid = error instanceof Error && (error.name === 'FoundationFactInvalidResultError' || error.name === 'FoundationFactOutputCapError')
      const terminalNeedsAction = error instanceof Error && error.name === 'FoundationFactOutputCapError'
      await mutateFoundationAuditTask(dispatchId, 'workflow.handler_failed', ({ task, record }) => {
        const failed = parseDispatchRecord({
          ...record,
          status: 'failed',
          failureReason: reason,
          ...(terminalIsInvalid ? { terminalResult: undefined } : { terminalResult: record.terminalResult }),
        })
        const needsAction = terminalNeedsAction || task.attempt >= 2
        return {
          task: { ...task, status: needsAction ? 'needs_action' : 'retryable', failureReason: reason, dispatch: failed },
          record: failed,
          runStatus: needsAction ? 'needs_action' : 'running',
          blockedReason: needsAction ? reason : undefined,
        }
      }).catch(() => undefined)
      releaseDispatch(dispatchId)
      throw error
    }
    releaseDispatch(dispatchId)
    return { record: durable, result }
  }

  async function completeFoundationSemanticDispatch(dispatchId: string, terminalValue: unknown): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load(); const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location?.auditTaskId) throw new DispatchError('not_found', 'foundation semantic dispatch is not active')
    const task = run.foundationAuditState?.tasks.find(candidate => candidate.taskId === location.auditTaskId)
    if (!task || (task.kind !== 'semantic' && task.kind !== 'confirmation')) throw new DispatchError('not_found', 'foundation semantic task is not active')
    const request = requests.get(dispatchId) ?? location.record.request
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      if (result.workerType !== 'foundation-semantic-reviewer' || !request || result.runId !== request.runId || result.dispatchId !== dispatchId || result.taskId !== request.taskId || result.revision !== request.revision || result.packetDigest !== request.contract.packetDigest) throw new Error('foundation semantic terminal identity does not match dispatch contract')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid foundation semantic terminal'
      const invalid = parseDispatchRecord({ ...location.record, status: 'invalid' as const, finishedAt: now(), failureReason: reason })
      await mutateFoundationAuditTask(dispatchId, 'dispatch.invalid', ({ task: current, record }) => { const retryable = current.kind === 'confirmation' ? current.attempt < 1 : current.attempt < 2; return { task: { ...current, status: retryable ? 'retryable' : 'needs_action', failureReason: reason, dispatch: invalid }, record: invalid, runStatus: retryable ? 'running' : 'needs_action', blockedReason: retryable ? undefined : reason } })
      releaseDispatch(dispatchId); throw new DispatchError('invalid_terminal', 'invalid foundation semantic terminal')
    }
    const status = result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked' : 'failed'
    const measuredUsage = usageDelta(run.usage, location.record.startingUsage)
    if (Object.values(measuredUsage).some(value => !Number.isFinite(value) || value < 0)) throw new DispatchError('invalid_terminal', 'semantic terminal usage measurement is invalid')
    const durable = await mutateFoundationAuditTask(dispatchId, `dispatch.${status}`, ({ task: current, record }) => { const completed = parseDispatchRecord({ ...record, status, usage: measuredUsage, terminalResult: result as unknown as Record<string, unknown>, finishedAt: now() }); return { task: { ...current, dispatch: completed, usage: measuredUsage }, record: completed } })
    try { await options.credits?.settle?.(request ? idempotencyKey(request, Math.max(1, task.attempt)) : dispatchId, result); await options.onTerminal?.(durable, result, request) } catch (error) {
      const reason = error instanceof Error ? error.message : 'workflow semantic terminal handler failed'
      await mutateFoundationAuditTask(dispatchId, 'workflow.handler_failed', ({ task: current, record }) => { const exhausted = current.kind === 'confirmation' ? current.attempt >= 1 : current.attempt >= 2; return { task: { ...current, status: exhausted ? 'needs_action' : 'retryable', failureReason: reason, dispatch: parseDispatchRecord({ ...record, status: 'failed', failureReason: reason }) }, record: parseDispatchRecord({ ...record, status: 'failed', failureReason: reason }), runStatus: exhausted ? 'needs_action' : 'running', blockedReason: exhausted ? reason : undefined } }).catch(() => undefined)
      releaseDispatch(dispatchId); throw error
    }
    releaseDispatch(dispatchId); return { record: durable, result }
  }

  async function completeFoundationRevisionDispatch(dispatchId: string, terminalValue: unknown): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location?.revisionTaskId) throw new DispatchError('not_found', 'foundation revision dispatch is not active')
    const task = run.foundationRevisionState?.tasks.find(candidate => candidate.taskId === location.revisionTaskId)
    const request = requests.get(dispatchId) ?? location.record.request
    if (!task || !request) throw new DispatchError('not_found', 'foundation revision task authority is missing')
    if (task.kind !== 'document-revision') throw new DispatchError('blocked', 'non-document revision task reached document terminal admission')
    if (task.status === 'completed' && task.dispatch?.terminalResult) {
      const prior = parseWorkerTerminalResult(task.dispatch.terminalResult)
      if (isDeepStrictEqual(prior, terminalValue)) return { record: task.dispatch, result: prior }
      throw new DispatchError('invalid_terminal', 'conflicting foundation revision terminal replay')
    }
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      if (result.workerType !== 'foundation-document-reviser' || result.taskId !== request.taskId || result.revision !== request.revision || result.packetDigest !== request.contract.packetDigest || result.round !== request.contract.round || result.documentPath !== request.contract.documentPath)
        throw new Error('foundation revision terminal identity does not match dispatch contract')
      const packetValue = await loadFoundationRevisionPacket({ workspacePath: request.workspacePath, revision: task.revision, round: task.round, taskId: task.taskId, documentPath: task.documentPath, packetDigest: task.packetDigest })
      if (!Array.isArray(packetValue.issues) || !Array.isArray(packetValue.issueIds) || !Array.isArray(packetValue.sectionIds)) throw new Error('foundation revision packet authority is malformed')
      const batch = { documentPath: request.contract.documentPath as FoundationDocumentPath, issueIds: packetValue.issueIds as string[], sectionIds: packetValue.sectionIds as string[] }
      const receipt = result.receipt as RevisionTaskReceipt
      await deriveFoundationPatchOperations({ workspacePath: request.workspacePath, revision: request.revision, taskId: request.taskId, batch, issues: packetValue.issues as AuditIssue[], receipt })
      if (receipt.baseDocumentDigest !== task.baseDocumentDigest || receipt.stagedPath !== task.stagedPath)
        throw new Error('foundation revision receipt base or stage authority is stale')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid foundation revision terminal'
      const invalid = parseDispatchRecord({ ...location.record, status: 'invalid' as const, finishedAt: now(), failureReason: reason })
      const retryable = task.attempt < 2
      await mutateFoundationRevisionTask(dispatchId, 'dispatch.invalid', ({ task: current }) => ({
        task: { ...current, status: retryable ? 'retryable' : 'needs_action', failureReason: reason, dispatch: invalid },
        record: invalid,
        runStatus: retryable ? 'running' : 'needs_action',
        blockedReason: retryable ? undefined : reason,
      }))
      releaseDispatch(dispatchId)
      throw new DispatchError('invalid_terminal', 'invalid foundation revision terminal')
    }
    const revisionResult = result as Extract<WorkerTerminalResult, { workerType: 'foundation-document-reviser' }>
    const measuredUsage = usageDelta(run.usage, location.record.startingUsage)
    const finishedAt = now()
    const status = revisionResult.status === 'completed' ? 'completed' : revisionResult.status === 'blocked' ? 'blocked' : 'failed'
    const taskStatus = status === 'completed' ? 'completed' : status === 'blocked' || task.attempt >= 2 ? 'needs_action' : 'retryable'
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(location.record.startedAt).getTime())
    const durable = await mutateFoundationRevisionTask(dispatchId, `dispatch.${status}`, ({ task: current, record }) => {
      const completed = parseDispatchRecord({ ...record, status, usage: measuredUsage, terminalResult: result as unknown as Record<string, unknown>, finishedAt })
      return { task: { ...current, status: taskStatus, ...(revisionResult.status === 'completed' ? { receipt: revisionResult.receipt, terminalDigest: revisionResult.receipt.terminalDigest } : {}), usage: measuredUsage, durationMs, dispatch: completed }, record: completed, ...(taskStatus === 'needs_action' ? { runStatus: 'needs_action' as const, blockedReason: revisionResult.status === 'blocked' ? 'foundation revision worker is blocked' : undefined } : {}) }
    })
    try {
      await options.credits?.settle?.(request ? idempotencyKey(request, task.attempt) : dispatchId, result)
      await options.onTerminal?.(durable, result, request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'foundation revision terminal handler failed'
      await mutateFoundationRevisionTask(dispatchId, 'workflow.handler_failed', ({ task: current, record }) => ({
        // Terminal admission is durable before callbacks run. Keep its
        // completed receipt authoritative if a downstream handler fails;
        // resume must replay/advance it rather than run the worker again.
        task: current.kind === 'document-revision' && current.status === 'completed' && current.receipt
          ? { ...current, failureReason: reason }
          : { ...current, status: current.attempt < 2 ? 'retryable' : 'needs_action', failureReason: reason, dispatch: parseDispatchRecord({ ...record, status: 'failed', failureReason: reason }) },
        record: current.kind === 'document-revision' && current.status === 'completed' && current.receipt
          ? parseDispatchRecord({ ...record, status: 'completed', failureReason: reason })
          : parseDispatchRecord({ ...record, status: 'failed', failureReason: reason }),
        ...(current.kind === 'document-revision' && current.status === 'completed' && current.receipt ? {} : {
          runStatus: current.attempt < 2 ? 'running' as const : 'needs_action' as const,
          blockedReason: current.attempt < 2 ? undefined : reason,
        }),
      })).catch(() => undefined)
      releaseDispatch(dispatchId)
      throw error
    }
    releaseDispatch(dispatchId)
    return { record: durable, result }
  }

  async function completeFoundationRevisionSemanticDispatch(dispatchId: string, terminalValue: unknown): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location?.revisionTaskId) throw new DispatchError('not_found', 'foundation semantic revision dispatch is not active')
    const task = run.foundationRevisionState?.tasks.find(candidate => candidate.taskId === location.revisionTaskId)
    const request = requests.get(dispatchId) ?? location.record.request
    if (!task || task.kind !== 'semantic-recheck' || !request) throw new DispatchError('not_found', 'foundation semantic revision task authority is missing')
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      if (result.workerType !== 'foundation-semantic-reviewer' || result.runId !== request.runId || result.dispatchId !== dispatchId || result.taskId !== request.taskId || result.revision !== request.revision || result.packetDigest !== request.contract.packetDigest)
        throw new Error('foundation semantic revision terminal identity does not match dispatch contract')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid foundation semantic revision terminal'
      const invalid = parseDispatchRecord({ ...location.record, status: 'invalid' as const, finishedAt: now(), failureReason: reason })
      await mutateFoundationRevisionTask(dispatchId, 'dispatch.invalid', ({ task: current }) => ({ task: { ...current, status: current.attempt < 2 ? 'retryable' : 'needs_action', failureReason: reason, dispatch: invalid }, record: invalid, runStatus: current.attempt < 2 ? 'running' : 'needs_action', blockedReason: current.attempt < 2 ? undefined : reason }))
      releaseDispatch(dispatchId)
      throw new DispatchError('invalid_terminal', 'invalid foundation semantic revision terminal')
    }
    const measuredUsage = usageDelta(run.usage, location.record.startingUsage)
    const finishedAt = now()
    const status = result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked' : 'failed'
    const terminalDigest = createHash('sha256').update(JSON.stringify(result)).digest('hex')
    const durable = await mutateFoundationRevisionTask(dispatchId, `dispatch.${status}`, ({ task: current, record }) => {
      const completed = parseDispatchRecord({ ...record, status, usage: measuredUsage, terminalResult: result as unknown as Record<string, unknown>, finishedAt })
      const nextStatus = status === 'completed' ? 'running' : current.attempt < 2 ? 'retryable' : 'needs_action'
      return { task: { ...current, status: nextStatus, ...(status === 'completed' ? { terminalDigest } : {}), usage: measuredUsage, durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)), dispatch: completed }, record: completed, ...(nextStatus === 'needs_action' ? { runStatus: 'needs_action' as const, blockedReason: 'foundation semantic revision worker failed' } : {}) }
    })
    try {
      await options.credits?.settle?.(idempotencyKey(request, task.attempt), result)
      await options.onTerminal?.(durable, result, request)
    } catch (error) {
      releaseDispatch(dispatchId)
      throw error
    }
    releaseDispatch(dispatchId)
    return { record: durable, result }
  }

  async function completeFoundationImpactedFactsDispatch(dispatchId: string, terminalValue: unknown): Promise<{ record: DispatchRecord; result?: WorkerTerminalResult }> {
    const run = await options.store.load()
    const location = run ? dispatchLocation(run, dispatchId) : undefined
    if (!run || !location?.revisionTaskId) throw new DispatchError('not_found', 'foundation impacted fact dispatch is not active')
    const task = run.foundationRevisionState?.tasks.find(candidate => candidate.taskId === location.revisionTaskId)
    const request = requests.get(dispatchId) ?? location.record.request
    if (!task || task.kind !== 'impacted-facts' || !request) throw new DispatchError('not_found', 'foundation impacted fact task authority is missing')
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(terminalValue)
      if (result.workerType !== 'foundation-fact-extractor' || result.runId !== request.runId || result.dispatchId !== dispatchId || result.taskId !== request.taskId || result.revision !== request.revision || result.packetDigest !== request.contract.packetDigest)
        throw new Error('foundation impacted fact terminal identity does not match dispatch contract')
      const packet = await loadFoundationRevisionFactPacket({ workspacePath: request.workspacePath, revision: task.revision, round: task.round, taskId: task.taskId, packetDigest: task.packetDigest })
      if ((location.record.usage?.completion_tokens ?? 0) > foundationFactOutputTokenLimit(packet.keys.length))
        throw new Error('foundation impacted fact completion token cap exceeded')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid foundation impacted fact terminal'
      const invalid = parseDispatchRecord({ ...location.record, status: 'invalid' as const, finishedAt: now(), failureReason: reason })
      const terminalCap = reason.includes('completion token cap')
      await mutateFoundationRevisionTask(dispatchId, 'dispatch.invalid', ({ task: current }) => ({ task: { ...current, status: terminalCap || current.attempt >= 2 ? 'needs_action' : 'retryable', failureReason: reason, dispatch: invalid }, record: invalid, runStatus: terminalCap || current.attempt >= 2 ? 'needs_action' : 'running', blockedReason: terminalCap || current.attempt >= 2 ? reason : undefined }))
      releaseDispatch(dispatchId)
      throw new DispatchError('invalid_terminal', 'invalid foundation impacted fact terminal')
    }
    const status = result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked' : 'failed'
    const measuredUsage = location.record.usage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    const durationMs = Math.max(0, Date.parse(now()) - Date.parse(location.record.startedAt))
    const durable = await mutateFoundationRevisionTask(dispatchId, `dispatch.${status}`, ({ task: current, record }) => {
      const completed = parseDispatchRecord({ ...record, status, usage: measuredUsage, terminalResult: result as unknown as Record<string, unknown>, finishedAt: now() })
      // Keep the terminal checkpoint replayable until the controller has
      // validated the receipt and committed it atomically.
      const nextStatus = status === 'completed' ? 'running' : current.attempt < 2 ? 'retryable' : 'needs_action'
      return { task: { ...current, status: nextStatus, ...(status === 'completed' ? { terminalDigest: digestFoundationFactTerminal(result as never) } : {}), usage: measuredUsage, durationMs, dispatch: completed }, record: completed, ...(nextStatus === 'needs_action' ? { runStatus: 'needs_action' as const, blockedReason: 'foundation impacted fact worker failed' } : {}) }
    })
    try {
      await options.credits?.settle?.(idempotencyKey(request, task.attempt), result)
      await options.onTerminal?.(durable, result, request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'foundation impacted fact terminal handler failed'
      // The terminal is the durable replay source. Do not convert it into a
      // fresh worker attempt when controller admission failed after persist.
      await mutateFoundationRevisionTask(dispatchId, 'workflow.handler_failed', ({ task: current, record }) => ({
        task: { ...current, status: 'running', failureReason: reason, dispatch: parseDispatchRecord({ ...record, status: 'completed', failureReason: reason }) },
        record: parseDispatchRecord({ ...record, status: 'completed', failureReason: reason }),
      })).catch(() => undefined)
      releaseDispatch(dispatchId)
      throw error
    }
    releaseDispatch(dispatchId)
    return { record: durable, result }
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
    if (location.auditTaskId) {
      const task = run.foundationAuditState?.tasks.find(candidate => candidate.taskId === location.auditTaskId)
      if (task?.kind === 'semantic' || task?.kind === 'confirmation') return completeFoundationSemanticDispatch(dispatchId, terminalValue)
      return completeFoundationFactDispatch(dispatchId, terminalValue)
    }
    if (location.revisionTaskId) {
      const revisionTask = run.foundationRevisionState?.tasks.find(task => task.taskId === location.revisionTaskId)
      if (revisionTask?.kind === 'impacted-facts') return completeFoundationImpactedFactsDispatch(dispatchId, terminalValue)
      if (revisionTask?.kind === 'semantic-recheck') return completeFoundationRevisionSemanticDispatch(dispatchId, terminalValue)
      return completeFoundationRevisionDispatch(dispatchId, terminalValue)
    }
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
            result.taskId !== request.taskId) ||
          (result.workerType === 'foundation-fact-extractor' &&
            (result.taskId !== request.taskId ||
              result.packetDigest !== request.contract.packetDigest)))
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
      result.workerType === 'document-author' ||
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
      : { ...run, activeDispatch: completed }
    const updated = {
      ...updatedWithDispatch,
      thinking:
        hasRunningFoundationDispatch(updatedWithDispatch) ||
        updatedWithDispatch.activeDispatch?.status === 'running'
          ? ('working' as const)
          : ('idle' as const),
    }
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
    let result: WorkerTerminalResult
    try {
      result = parseWorkerTerminalResult(record.terminalResult)
      const run = await options.store.load()
      const location = run ? dispatchLocation(run, record.dispatchId) : undefined
      const task = location?.auditTaskId
        ? run?.foundationAuditState?.tasks.find(candidate => candidate.taskId === location.auditTaskId)
        : undefined
      const revisionTask = location?.revisionTaskId
        ? run?.foundationRevisionState?.tasks.find(candidate => candidate.taskId === location.revisionTaskId)
        : undefined
      const factTask = task ?? (revisionTask?.kind === 'impacted-facts' ? revisionTask : undefined)
      if (record.workerType === 'foundation-fact-extractor' && (!factTask?.terminalDigest || digestFoundationFactTerminal(result as never) !== factTask.terminalDigest)) {
        throw new Error('foundation fact terminal replay digest conflicts with durable dispatch')
      }
      if (record.workerType === 'foundation-document-reviser') {
        const receipt = result.workerType === 'foundation-document-reviser' ? result.receipt : undefined
        if (!revisionTask || revisionTask.kind !== 'document-revision' || !receipt || result.workerType !== 'foundation-document-reviser' || result.taskId !== revisionTask.taskId || result.revision !== revisionTask.revision || result.packetDigest !== revisionTask.packetDigest || result.round !== revisionTask.round || result.documentPath !== revisionTask.documentPath || receipt.taskId !== revisionTask.taskId || receipt.round !== revisionTask.round || receipt.documentPath !== revisionTask.documentPath || receipt.stagedPath !== revisionTask.stagedPath || receipt.baseDocumentDigest !== revisionTask.baseDocumentDigest)
          throw new Error('foundation revision terminal replay identity conflicts with durable task')
      }
      if (record.workerType === 'foundation-semantic-reviewer' && result.workerType === 'foundation-semantic-reviewer' && revisionTask?.kind === 'semantic-recheck') {
        const terminalDigest = createHash('sha256').update(JSON.stringify(result)).digest('hex')
        if (!revisionTask.terminalDigest || terminalDigest !== revisionTask.terminalDigest || result.taskId !== revisionTask.taskId || result.revision !== revisionTask.revision || result.packetDigest !== revisionTask.packetDigest)
          throw new Error('foundation semantic revision terminal replay identity conflicts with durable task')
      }
      const request = record.request
      const durableTask = request?.taskId
        ? location?.revisionTaskId
          ? run?.foundationRevisionState?.tasks.find(task => task.taskId === location.revisionTaskId)
          : location?.auditTaskId
            ? run?.foundationAuditState?.tasks.find(task => task.taskId === location.auditTaskId)
            : run?.tasks.find(task => task.id === request.taskId)
        : undefined
      const attempt = durableTask && 'attempt' in durableTask ? durableTask.attempt : 1
      const key = request ? idempotencyKey(request, attempt) : record.dispatchId
      await options.credits?.settle?.(key, result)
      await onTerminal?.(record, result, record.request)
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'workflow terminal replay failed'
      const current = await options.store.load()
      const location = current
        ? dispatchLocation(current, record.dispatchId)
        : undefined
      if (current && location) {
        if (location.revisionTaskId) {
          const revisionTask = current.foundationRevisionState?.tasks.find(task => task.taskId === location.revisionTaskId)
          if (revisionTask?.kind === 'document-revision' && revisionTask.status === 'completed' && revisionTask.receipt) {
            await options.store.commit({ ...current, status: 'needs_action', blockedReason: reason, thinking: 'idle' }, { runId: current.runId, type: 'foundation.revision.replay_handler_failed', phase: current.phase, status: 'needs_action', revision: current.revision, dispatchId: record.dispatchId, reason })
            forgetDispatch(record.dispatchId)
            throw error
          }
          const failed = await mutateFoundationRevisionTask(record.dispatchId, 'workflow.replay_failed', ({ task, record: lockedRecord }) => {
            const terminal = parseDispatchRecord({ ...lockedRecord, status: 'failed', failureReason: reason, terminalResult: undefined, finishedAt: lockedRecord.finishedAt ?? now() })
            return { task: { ...task, status: 'needs_action', failureReason: reason, dispatch: terminal }, record: terminal, runStatus: 'needs_action', blockedReason: reason }
          })
          void failed
          forgetDispatch(record.dispatchId)
          throw error
        }
        if (location.auditTaskId) {
          const failed = await mutateFoundationAuditTask(record.dispatchId, 'workflow.replay_failed', ({ task, record: lockedRecord }) => {
            const terminal = parseDispatchRecord({
              ...lockedRecord,
              status: 'failed',
              failureReason: reason,
              terminalResult: undefined,
              finishedAt: lockedRecord.finishedAt ?? now(),
            })
            return {
              task: { ...task, status: 'needs_action', failureReason: reason, dispatch: terminal },
              record: terminal,
              runStatus: 'needs_action',
              blockedReason: reason,
            }
          })
          void failed
          forgetDispatch(record.dispatchId)
          throw error
        }
        const failed = parseDispatchRecord({
          ...location.record,
          status: 'failed',
          failureReason: reason,
          terminalResult: undefined,
          finishedAt: location.record.finishedAt ?? now(),
        })
        const failedRun = location.path
          ? {
              ...current,
              foundationDraftState: recordFoundationHandlerFailure(
                current.foundationDraftState,
                location.path,
                reason,
                failed,
              ),
            }
          : { ...current, activeDispatch: failed }
        await options.store.commit(
          {
            ...failedRun,
            status: 'needs_action',
            blockedReason: reason,
            thinking: 'idle',
          },
          {
            runId: current.runId,
            type: 'workflow.replay_failed',
            phase: current.phase,
            status: 'needs_action',
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
    if (location.auditTaskId) {
      const failed = await mutateFoundationAuditTask(dispatchId, 'dispatch.failed', ({ task, record }) => {
        const terminal = parseDispatchRecord({ ...record, status: 'failed', finishedAt: now(), failureReason: reason })
        const needsAction = isTerminalFoundationFactFailure(reason) || task.attempt >= 2
        return {
          task: { ...task, status: needsAction ? 'needs_action' : 'retryable', failureReason: reason, dispatch: terminal },
          record: terminal,
          runStatus: needsAction ? 'needs_action' : 'running',
          blockedReason: needsAction ? reason : undefined,
        }
      })
      releaseDispatch(dispatchId, { stopReason: reason })
      return failed
    }
    if (location.revisionTaskId) {
      const failed = await mutateFoundationRevisionTask(dispatchId, 'dispatch.failed', ({ task, record }) => {
        const terminal = parseDispatchRecord({ ...record, status: 'failed', finishedAt: now(), failureReason: reason })
        const needsAction = task.attempt >= 2
        return {
          task: { ...task, status: needsAction ? 'needs_action' : 'retryable', failureReason: reason, dispatch: terminal },
          record: terminal,
          runStatus: needsAction ? 'needs_action' : 'running',
          blockedReason: needsAction ? reason : undefined,
        }
      })
      releaseDispatch(dispatchId, { stopReason: reason })
      return failed
    }
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
      : { ...run, activeDispatch: failed }
    const status: DeliveryRun['status'] = location.path
      ? isolatedFoundationFailureStatus(failedRun)
      : 'failed'
    await options.store.commit(
      {
        ...failedRun,
        status,
        ...(status === 'running' ? {} : { blockedReason: reason }),
        thinking:
          hasRunningFoundationDispatch(failedRun) ||
          failedRun.activeDispatch?.status === 'running'
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
    if (location.auditTaskId) {
      const interrupted = await mutateFoundationAuditTask(dispatchId, 'dispatch.needs_action', ({ task, record }) => {
        const terminal = parseDispatchRecord({ ...record, status: 'interrupted', finishedAt: now(), failureReason: reason })
        return {
          task: { ...task, status: 'needs_action', failureReason: reason, dispatch: terminal },
          record: terminal,
          runStatus: 'needs_action',
          blockedReason: reason,
        }
      })
      releaseDispatch(dispatchId, { stopReason: reason })
      return interrupted
    }
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
      : { ...run, activeDispatch: interrupted }
    const status: DeliveryRun['status'] = location.path
      ? isolatedFoundationFailureStatus(interruptedRun)
      : 'needs_action'
    await options.store.commit(
      {
        ...interruptedRun,
        status,
        ...(status === 'running' ? {} : { blockedReason: reason }),
        thinking:
          hasRunningFoundationDispatch(interruptedRun) ||
          interruptedRun.activeDispatch?.status === 'running'
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
    if (location.auditTaskId) {
      const stopped = await mutateFoundationAuditTask(dispatchId, 'dispatch.interrupted', ({ task, record }) => {
        const terminal = parseDispatchRecord({ ...record, status: 'interrupted', finishedAt: now(), failureReason: reason })
        const needsAction = task.attempt >= 2
        return {
          task: { ...task, status: needsAction ? 'needs_action' : 'retryable', failureReason: reason, dispatch: terminal },
          record: terminal,
          runStatus: 'stopped',
          blockedReason: reason,
        }
      })
      releaseDispatch(dispatchId, { stopReason: reason })
      return stopped
    }
    const stopped = parseDispatchRecord({
      ...location.record,
      status: 'interrupted',
      finishedAt: now(),
    })
    const stoppedRun = location.path
      ? withFoundationDispatch(run, location.path, stopped)
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
