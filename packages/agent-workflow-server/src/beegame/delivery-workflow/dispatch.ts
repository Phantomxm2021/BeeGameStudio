import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readAuthoredDocumentReceipt } from '../authored-document-receipt';
import { isWorkflowEvidenceFile,persistImplementationEvidence,} from './evidence';
import { assertSharedDocumentWorker } from './retired-foundation-author';
import { assertNoRetiredFoundationWorker } from './retired-foundation-review';
import type { RunStore,WorkflowLock } from './run-store';
import { parseDispatchRecord } from './schema';
import { isPublicStageActive } from './public-stage-routing';
import type { DeliveryRun,DeliveryWorkerPort,DispatchRecord,WorkerDispatchRequest,WorkflowUsage,} from './types';
import { parseWorkerTerminalResult,type WorkerTerminalResult } from './worker-contracts';
import { buildWorkerPrompt } from './worker-prompts';
export type DispatchCredits = {
    reserve?: (idempotencyKey: string, request: WorkerDispatchRequest) => Promise<void>;
    settle?: (idempotencyKey: string, result: WorkerTerminalResult) => Promise<void>;
};
const TRANSPORT_CLEANUP_TRACKING_TIMEOUT_MS = 5 * 1000;
function dispatchLocation(run: DeliveryRun, dispatchId: string): {
    record: DispatchRecord;
    taskId?: string;
} | undefined {
    if (run.activeDispatch?.dispatchId === dispatchId)
        return { record: run.activeDispatch };
    return undefined;
}
export class DispatchError extends Error {
    constructor(readonly code: 'duplicate' | 'invalid_terminal' | 'not_found' | 'blocked', message: string) {
        super(message);
        this.name = 'DispatchError';
    }
}
class DurableTerminalIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DurableTerminalIntegrityError';
    }
}
function idempotencyKey(request: WorkerDispatchRequest, attempt: number): string {
    const lane = request.workerType === 'document-author'
        ? `document:${String(request.contract.documentSet ?? 'foundation')}`
        : request.workerType;
    return `${request.runId}:${request.phase}:${request.workerType}:${lane}:${request.taskId ?? request.phase}:${request.revision}:${attempt}`;
}
function now(): string {
    return new Date().toISOString();
}
function usageSnapshot(usage: WorkflowUsage | undefined): WorkflowUsage {
    return {
        input_tokens: Math.max(0, usage?.input_tokens ?? 0),
        cache_read_tokens: Math.max(0, usage?.cache_read_tokens ?? 0),
        cache_creation_tokens: Math.max(0, usage?.cache_creation_tokens ?? 0),
        completion_tokens: Math.max(0, usage?.completion_tokens ?? 0),
        total_tokens: Math.max(0, usage?.total_tokens ?? 0),
    };
}
function usageDelta(current: WorkflowUsage | undefined, starting: WorkflowUsage | undefined): WorkflowUsage {
    const end = usageSnapshot(current);
    const start = usageSnapshot(starting);
    return {
        input_tokens: Math.max(0, end.input_tokens - start.input_tokens),
        cache_read_tokens: Math.max(0, end.cache_read_tokens - start.cache_read_tokens),
        cache_creation_tokens: Math.max(0, end.cache_creation_tokens - start.cache_creation_tokens),
        completion_tokens: Math.max(0, end.completion_tokens - start.completion_tokens),
        total_tokens: Math.max(0, end.total_tokens - start.total_tokens),
    };
}
function terminalReasonForResult(result: WorkerTerminalResult, status: DispatchRecord['status']): string | undefined {
    if (status === 'completed')
        return undefined;
    const reason = 'reason' in result && typeof result.reason === 'string'
        ? result.reason
        : undefined;
    return reason || `${result.workerType} dispatch ended with ${status}`;
}
function resourceTaskPerformance(input: {
    dispatch: DispatchRecord;
    request: WorkerDispatchRequest | undefined;
    result: WorkerTerminalResult;
    currentUsage: WorkflowUsage | undefined;
    finishedAt: string;
}): Record<string, unknown> | undefined {
    if (!input.request ||
        input.request.workerType !== 'resource-planner')
        return undefined;
    const startedAt = Date.parse(input.dispatch.startedAt);
    const finishedAt = Date.parse(input.finishedAt);
    return {
        task: input.request.taskId,
        durationMs: Number.isFinite(startedAt) && Number.isFinite(finishedAt)
            ? Math.max(0, finishedAt - startedAt)
            : 0,
        usage: usageDelta(input.currentUsage, input.dispatch.startingUsage),
    };
}
async function documentPerformance(input: {
    dispatch: DispatchRecord;
    request: WorkerDispatchRequest | undefined;
    result: WorkerTerminalResult;
    currentUsage: WorkflowUsage | undefined;
    finishedAt: string;
}): Promise<Record<string, unknown> | undefined> {
    if (input.result.workerType !== 'document-author' ||
        input.request?.workerType !== 'document-author')
        return undefined;
    const receipt = await readAuthoredDocumentReceipt(input.request.workspacePath, input.dispatch.dispatchId);
    const fileBytes = async (path: string | undefined): Promise<number> => {
        if (!path)
            return 0;
        try {
            return (await stat(resolve(input.request!.workspacePath, path))).size;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return 0;
            throw error;
        }
    };
    const targetPath = typeof input.request.contract.foundationDocumentPath === 'string'
        ? input.request.contract.foundationDocumentPath
        : receipt?.targetPath;
    const projectionPath = `.beegame/workflow/document-projections/${input.dispatch.dispatchId}.json`;
    const projectionArtifactBytes = await fileBytes(projectionPath);
    const projectionModelBytes = input.result.authoringMetrics?.authorityProjection?.modelByteLength
        ?? input.result.authoringMetrics?.authorityProjection?.byteLength
        ?? 0;
    const startedAt = Date.parse(input.dispatch.startedAt);
    const finishedAt = Date.parse(input.finishedAt);
    const authoringUsage = input.result.authoringMetrics
        ? {
            input_tokens: input.result.authoringMetrics.inputTokens,
            cache_read_tokens: input.result.authoringMetrics.cacheReadTokens,
            cache_creation_tokens: input.result.authoringMetrics.cacheCreationTokens,
            completion_tokens: input.result.authoringMetrics.outputTokens,
            total_tokens: input.result.authoringMetrics.rawProcessedTokens,
        }
        : usageDelta(input.currentUsage, input.dispatch.startingUsage);
    return {
        targetPath,
        documentAuthority: 'markdown_only',
        usageStatus: input.result.authoringMetrics?.usageStatus ?? 'measured',
        usage: authoringUsage,
        durationMs: Number.isFinite(startedAt) && Number.isFinite(finishedAt)
            ? Math.max(0, finishedAt - startedAt)
            : 0,
        markdownBytes: await fileBytes(receipt?.targetPath ?? targetPath),
        // projectionBytes is the exact content sent to the model. The durable JSON
        // envelope is tracked separately because escaping/metadata must not be
        // reported as model context.
        projectionBytes: projectionModelBytes,
        projectionArtifactBytes,
        retryReason: null,
    };
}
function terminalEvidencePath(result: WorkerTerminalResult): string | undefined {
    return 'evidencePath' in result && typeof result.evidencePath === 'string'
        ? result.evidencePath
        : undefined;
}
function workerRequiresEvidence(workerType: WorkerDispatchRequest['workerType']): boolean {
    return (workerType !== 'document-author' &&
        workerType !== 'resource-planner' &&
        workerType !== 'content-author');
}
export function createDeliveryDispatcher(options: {
    store: RunStore;
    workerPort: DeliveryWorkerPort;
    credits?: DispatchCredits;
    onTerminal?: (record: DispatchRecord, result: WorkerTerminalResult, request?: WorkerDispatchRequest) => Promise<void>;
}) {
    const byKey = new Map<string, DispatchRecord>();
    const requests = new Map<string, WorkerDispatchRequest>();
    const creditSettled = new Set<string>();
    const transportCleanupStarted = new Set<string>();
    const startingDispatches = new Set<string>();
    const terminalReconciliations = new Set<Promise<void>>();
    let dispatchTail: Promise<void> = Promise.resolve();
    async function acquireDispatchLease(runId: string): Promise<WorkflowLock> {
        return options.store.mutationLock(runId);
    }
    function trackTerminalReconciliation(operation: Promise<void>): void {
        let tracked!: Promise<void>;
        tracked = operation.finally(() => terminalReconciliations.delete(tracked));
        terminalReconciliations.add(tracked);
        void tracked.catch(() => undefined);
    }
    async function waitForTerminalReconciliation(): Promise<void> {
        await dispatchTail;
        while (terminalReconciliations.size)
            await Promise.allSettled([...terminalReconciliations]);
    }
    function forgetDispatch(dispatchId: string): void {
        for (const [key, record] of byKey.entries()) {
            if (record.dispatchId === dispatchId)
                byKey.delete(key);
        }
        requests.delete(dispatchId);
    }
    function releaseDispatch(dispatchId: string, cleanup: {
        stopReason?: string;
        preserveSession?: boolean;
    } = {}): void {
        // Durable state is authoritative. Release the idempotency lane before
        // touching the disposable transport so a stalled session close can never
        // prevent a retry from creating a fresh dispatch.
        forgetDispatch(dispatchId);
        if (transportCleanupStarted.has(dispatchId))
            return;
        transportCleanupStarted.add(dispatchId);
        const cleanupOperation = (async () => {
            if (cleanup.stopReason)
                await options.workerPort
                    .stop(dispatchId, cleanup.stopReason)
                    .catch(() => undefined);
            await options.workerPort
                .close?.(dispatchId, {
                ...(cleanup.preserveSession ? { preserveSession: true } : {}),
            })
                .catch(() => undefined);
        })();
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        const cleanupDeadline = new Promise<void>(resolve => {
            cleanupTimer = setTimeout(resolve, TRANSPORT_CLEANUP_TRACKING_TIMEOUT_MS);
            cleanupTimer.unref?.();
        });
        void Promise.race([cleanupOperation, cleanupDeadline]).finally(() => {
            if (cleanupTimer)
                clearTimeout(cleanupTimer);
            transportCleanupStarted.delete(dispatchId);
        });
    }
    function dispatch(request: WorkerDispatchRequest): Promise<DispatchRecord> {
        assertNoRetiredFoundationWorker(request);
        const previous = dispatchTail;
        const current = previous
            .catch(() => undefined)
            .then(() => dispatchUnlocked(request));
        dispatchTail = current.then(() => undefined, () => undefined);
        return current;
    }
    async function dispatchUnlocked(request: WorkerDispatchRequest): Promise<DispatchRecord> {
        const run = await options.store.load();
        if (!run)
            throw new DispatchError('not_found', 'delivery run does not exist');
        if (isPublicStageActive(run))
            throw new DispatchError('blocked', 'public author invocation cannot use legacy worker dispatch');
        assertSharedDocumentWorker(request);
        if (run.status !== 'running')
            throw new DispatchError('blocked', 'delivery run is not running');
        const durableDispatch = run.activeDispatch;
        if (durableDispatch?.status === 'completed'
            &&
                durableDispatch.phase === request.phase &&
            durableDispatch.revision === request.revision &&
            durableDispatch.taskId === request.taskId &&
            durableDispatch.workerType === request.workerType)
            return durableDispatch;
        if (durableDispatch?.status === 'running') {
            const existing = durableDispatch;
            if (existing.phase === request.phase &&
                existing.revision === request.revision &&
                existing.taskId === request.taskId &&
                existing.workerType === request.workerType)
                return existing;
            throw new DispatchError('duplicate', 'another delivery worker is already running');
        }
        const durableTask = request.taskId
            ?
                run.tasks.find(task => task.id === request.taskId)
            : undefined;
        const attempt = durableTask && typeof durableTask.attempt === 'number'
            ? durableTask.attempt + 1
            : 1;
        const priorFailureReason = undefined;
        const key = idempotencyKey(request, attempt);
        const existing = byKey.get(key);
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
            });
        }
        const dispatchId = request.dispatchId ?? randomUUID();
        const dispatchRequest = {
            ...request,
            dispatchId,
            ...(priorFailureReason
                ? { contract: { ...request.contract, priorFailureReason } }
                : {}),
        };
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
        });
        byKey.set(key, record);
        requests.set(record.dispatchId, dispatchRequest);
        startingDispatches.add(dispatchId);
        let startedDispatchId: string | undefined;
        try {
            const lease = await acquireDispatchLease(run.runId);
            try {
                const current = await options.store.load(lease);
                if (!current || current.runId !== run.runId)
                    throw new DispatchError('not_found', 'delivery run does not exist');
                if (current.status !== 'running')
                    throw new DispatchError('blocked', 'delivery run is not running');
                const active = current.activeDispatch?.status === 'running' ? current.activeDispatch : undefined;
                if (active) {
                    if (active.phase === request.phase &&
                        active.revision === request.revision &&
                        active.taskId === request.taskId &&
                        active.workerType === request.workerType) {
                        forgetDispatch(record.dispatchId);
                        return active;
                    }
                    throw new DispatchError('duplicate', 'another delivery worker is already running');
                }
                const next = { ...current, activeDispatch: record };
                await options.store.commit({
                    ...next,
                    lastProgressAt: record.startedAt,
                    currentMessage: undefined,
                    // Any prior rejection has already been copied into the new
                    // request contract. Do not display it as a current block
                    // while the replacement CLI turn is running.
                    blockedReason: undefined,
                    currentItemId: request.workerType === 'document-author' && request.taskId
                        ? request.taskId
                        : undefined,
                    thinking: 'working',
                }, {
                    runId: current.runId,
                    type: 'dispatch.started',
                    phase: current.phase,
                    status: current.status,
                    revision: current.revision,
                    dispatchId: record.dispatchId,
                    workerType: request.workerType,
                    taskId: request.taskId,
                }, undefined, lease);
            }
            finally {
                await options.store.unlock(lease);
            }
            await options.credits?.reserve?.(key, request);
            const started = await options.workerPort.start(dispatchRequest);
            startedDispatchId = started.dispatchId;
            if (started.dispatchId !== dispatchId)
                throw new Error('worker returned a dispatch id that does not match the durable dispatch');
            const current = await options.store.load();
            const currentLocation = current
                ? dispatchLocation(current, record.dispatchId)
                : undefined;
            if (!current ||
                current.runId !== run.runId ||
                current.status !== 'running' ||
                currentLocation?.record.status !== 'running') {
                releaseDispatch(record.dispatchId, {
                    stopReason: 'delivery dispatch lost durable authority before submit',
                });
                if (currentLocation)
                    return currentLocation.record;
                throw new DispatchError('blocked', 'delivery dispatch lost durable authority before submit');
            }
            // Supervision starts as soon as the durable dispatch owns a transport.
            // submit() spans the complete model turn, so attaching these observers
            // after awaiting it would leave thinking/tool execution unsupervised.
            if (options.workerPort.waitForTerminal) {
                trackTerminalReconciliation(options.workerPort
                    .waitForTerminal(record.dispatchId)
                    .then(async (terminal) => {
                    await completeDispatch(record.dispatchId, terminal);
                })
                    .catch(async (error) => {
                    // A foundation review worker that ends without its required
                    // durable terminal has made a failed attempt, not a human
                    // decision. Keep the terminal contract strict and route this
                    // transport failure through the normal per-task retry boundary.
                    if (isWorkerNeedsActionError(error))
                        await markDispatchNeedsAction(record.dispatchId, error.message);
                    else {
                        const reason = error instanceof Error
                            ? error.message
                            : 'worker did not produce a terminal result';
                        await markDispatchFailed(record.dispatchId, reason);
                    }
                }));
            }
            const promptRequest = dispatchRequest;
            await options.workerPort.submit(dispatchId, buildWorkerPrompt(promptRequest));
        }
        catch (error) {
            const current = await options.store.load();
            const currentLocation = current
                ? dispatchLocation(current, record.dispatchId)
                : undefined;
            if (currentLocation && currentLocation.record.status !== 'running') {
                releaseDispatch(record.dispatchId);
                return currentLocation.record;
            }
            await markDispatchFailed(record.dispatchId, error instanceof Error ? error.message : 'worker dispatch failed').catch(() => undefined);
            const reason = error instanceof Error ? error.message : 'worker dispatch failed';
            const transportDispatchId = startedDispatchId ?? record.dispatchId;
            releaseDispatch(transportDispatchId, { stopReason: reason });
            if (transportDispatchId !== record.dispatchId)
                forgetDispatch(record.dispatchId);
            throw error;
        }
        finally {
            startingDispatches.delete(dispatchId);
        }
        return record;
    }
    function isWorkerNeedsActionError(error: unknown): error is Error {
        return error instanceof Error && error.name === 'WorkerNeedsActionError';
    }
    async function completeDispatch(dispatchId: string, terminalValue: unknown): Promise<{
        record: DispatchRecord;
        result?: WorkerTerminalResult;
    }> {
        const run = await options.store.load();
        if (run && isPublicStageActive(run))
            throw new DispatchError('blocked', 'public author invocation cannot accept legacy worker terminals');
        const location = run ? dispatchLocation(run, dispatchId) : undefined;
        if (!run || !location)
            throw new DispatchError('not_found', 'dispatch is not active');
        assertNoRetiredFoundationWorker(location.record);
        if (run.status !== 'running')
            throw new DispatchError('blocked', 'delivery run is no longer running');
        if (location.record.status !== 'running')
            throw new DispatchError('not_found', 'dispatch is not active');
        const request = requests.get(dispatchId) ?? location.record.request;
        let result: WorkerTerminalResult;
        try {
            result = parseWorkerTerminalResult(terminalValue);
            if (result.workerType === 'implementation-worker') {
                const evidencePath = `.beegame/workflow/evidence/implementation-${dispatchId}.json`;
                result = {
                    ...result,
                    evidencePath,
                    evidenceRefs: [evidencePath],
                };
            }
            const resultRevision = 'revision' in result ? result.revision : undefined;
            if (request &&
                (result.workerType !== request.workerType ||
                    (resultRevision !== undefined &&
                        resultRevision !== request.revision) ||
                    (result.workerType === 'implementation-worker' &&
                        result.taskId !== request.taskId)))
                throw new Error('worker terminal result does not match dispatch contract');
            if (request && result.workerType === 'implementation-worker')
                await persistImplementationEvidence({
                    workspacePath: request.workspacePath,
                    evidencePath: result.evidencePath,
                    taskId: result.taskId,
                    revision: result.revision,
                    verifiedArtifacts: result.verifiedArtifacts,
                    summary: result.summary,
                    verificationResults: result.verificationResults,
                });
            const evidencePath = terminalEvidencePath(result);
            if (request &&
                workerRequiresEvidence(request.workerType) &&
                (!evidencePath ||
                    !isWorkflowEvidenceFile(request.workspacePath, evidencePath))) {
                throw new Error('worker terminal evidence file is missing or outside the workflow evidence directory');
            }
        }
        catch (error) {
            const reason = error instanceof Error
                ? error.message
                : 'invalid worker terminal result';
            const invalid = parseDispatchRecord({
                ...location.record,
                status: 'invalid' as const,
                finishedAt: now(),
                failureReason: reason,
            });
            const failedRun = {
                ...run,
                status: 'failed' as const,
                blockedReason: reason,
                activeDispatch: invalid,
                thinking: 'idle' as const,
            };
            const isolatedStatus = failedRun.status;
            await options.store.commit({
                ...failedRun,
                status: isolatedStatus,
                blockedReason: reason,
            }, {
                runId: run.runId,
                type: 'dispatch.invalid',
                phase: run.phase,
                status: isolatedStatus,
                revision: run.revision,
                dispatchId,
                reason,
            });
            releaseDispatch(dispatchId);
            throw new DispatchError('invalid_terminal', 'invalid worker terminal result');
        }
        const status = result.workerType === 'document-author' ||
            result.workerType === 'change-impact-analyzer' ||
            result.workerType === 'question-answerer'
            ? 'completed'
            : result.status === 'completed'
                ? 'completed'
                : result.status === 'blocked'
                    ? 'blocked'
                    : 'failed';
        const finishedAt = now();
        const completed = parseDispatchRecord({
            ...location.record,
            status,
            ...(terminalEvidencePath(result)
                ? { terminalEvidencePath: terminalEvidencePath(result) }
                : {}),
            terminalResult: result as unknown as Record<string, unknown>,
            finishedAt,
        });
        const updatedWithDispatch = { ...run, activeDispatch: completed };
        const updated = {
            ...updatedWithDispatch,
            thinking: updatedWithDispatch.activeDispatch?.status === 'running'
                ? ('working' as const)
                : ('idle' as const),
        };
        const resourcePerformance = resourceTaskPerformance({
            dispatch: location.record,
            request,
            result,
            currentUsage: run.usage,
            finishedAt,
        });
        const completedDocumentPerformance = await documentPerformance({
            dispatch: location.record,
            request,
            result,
            currentUsage: run.usage,
            finishedAt,
        });
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
        });
        const key = request
            ? idempotencyKey(request, request.taskId
                ? Math.max(1, run.tasks.find(task => task.id === request.taskId)?.attempt ??
                    1)
                : 1)
            : dispatchId;
        let terminalHandlerStarted = false;
        try {
            if (!creditSettled.has(key)) {
                await options.credits?.settle?.(key, result);
                creditSettled.add(key);
            }
            terminalHandlerStarted = true;
            await options.onTerminal?.(completed, result, request);
        }
        catch (error) {
            const reason = error instanceof Error
                ? error.message
                : 'workflow terminal handler failed';
            const current = await options.store.load();
            const failed = parseDispatchRecord({
                ...completed,
                status: 'failed',
                failureReason: reason,
                terminalResult: undefined,
            });
            const currentLocation = current
                ? dispatchLocation(current, dispatchId)
                : undefined;
            if (current && current.runId === run.runId && currentLocation) {
                const handlerFailure = terminalHandlerStarted;
                const status: DeliveryRun['status'] = handlerFailure
                    ? 'needs_action'
                    : 'failed';
                const failedCurrent = { ...current, status, activeDispatch: failed };
                await options.store.commit({
                    ...failedCurrent,
                    blockedReason: reason,
                    thinking: 'idle',
                }, {
                    runId: current.runId,
                    type: 'workflow.handler_failed',
                    phase: current.phase,
                    status: failedCurrent.status,
                    revision: current.revision,
                    dispatchId,
                    reason,
                });
            }
            forgetDispatch(dispatchId);
            throw error;
        }
        finally {
            // The durable run/event journal is the worker's retained evidence. The
            // private transport session is disposable once a terminal result exists.
            releaseDispatch(dispatchId);
        }
        return { record: completed, result };
    }
    async function replayTerminal(record: DispatchRecord, onTerminal = options.onTerminal): Promise<void> {
        assertNoRetiredFoundationWorker(record);
        const current = await options.store.load();
        if (current && isPublicStageActive(current))
            throw new DispatchError('blocked', 'public author invocation cannot replay legacy worker terminals');
        if (record.request)
            assertSharedDocumentWorker(record.request);
        else if (record.workerType === 'document-author')
            throw new DispatchError('blocked', 'document replay requires a current Checklist request');
        if (!['completed', 'failed', 'blocked'].includes(record.status) ||
            !record.terminalResult)
            throw new DispatchError('blocked', 'dispatch has no replayable terminal result');
        let result: WorkerTerminalResult;
        try {
            const run = await options.store.load();
            const location = run ? dispatchLocation(run, record.dispatchId) : undefined;
            const task = undefined;
            try {
                result = parseWorkerTerminalResult(record.terminalResult);
                const factTask = task;
            }
            catch (error) {
                if (error instanceof DurableTerminalIntegrityError)
                    throw error;
                throw new DurableTerminalIntegrityError(error instanceof Error ? error.message : 'durable terminal result is malformed');
            }
            const request = record.request;
            const durableTask = request?.taskId
                ?
                    run?.tasks.find(task => task.id === request.taskId)
                : undefined;
            const attempt = durableTask && 'attempt' in durableTask ? durableTask.attempt : 1;
            const key = request ? idempotencyKey(request, attempt) : record.dispatchId;
            await options.credits?.settle?.(key, result);
            await onTerminal?.(record, result, record.request);
        }
        catch (error) {
            const reason = error instanceof Error
                ? error.message
                : 'workflow terminal replay failed';
            const current = await options.store.load();
            const location = current
                ? dispatchLocation(current, record.dispatchId)
                : undefined;
            if (current && location) {
                const failed = parseDispatchRecord({
                    ...location.record,
                    status: 'failed',
                    failureReason: reason,
                    terminalResult: undefined,
                    finishedAt: location.record.finishedAt ?? now(),
                });
                const failedRun = { ...current, activeDispatch: failed };
                await options.store.commit({
                    ...failedRun,
                    status: 'needs_action',
                    blockedReason: reason,
                    thinking: 'idle',
                }, {
                    runId: current.runId,
                    type: 'workflow.replay_failed',
                    phase: current.phase,
                    status: 'needs_action',
                    revision: current.revision,
                    dispatchId: record.dispatchId,
                    reason,
                });
            }
            forgetDispatch(record.dispatchId);
            throw error;
        }
        finally {
            releaseDispatch(record.dispatchId);
        }
    }
    async function markDispatchFailed(dispatchId: string, reason: string): Promise<DispatchRecord> {
        const run = await options.store.load();
        const location = run ? dispatchLocation(run, dispatchId) : undefined;
        if (!run || !location)
            throw new DispatchError('not_found', 'dispatch is not active');
        assertNoRetiredFoundationWorker(location.record);
        if (location.record.status !== 'running')
            return location.record;
        const failed = parseDispatchRecord({
            ...location.record,
            status: 'failed',
            finishedAt: now(),
            failureReason: reason,
        });
        const failedRun = { ...run, activeDispatch: failed };
        const status: DeliveryRun['status'] = 'failed';
        await options.store.commit({
            ...failedRun,
            status,
            blockedReason: reason,
            thinking: failedRun.activeDispatch?.status === 'running'
                ? 'working'
                : 'idle',
        }, {
            runId: run.runId,
            type: 'dispatch.failed',
            phase: run.phase,
            status,
            revision: run.revision,
            dispatchId,
            reason,
        });
        releaseDispatch(dispatchId, { stopReason: reason });
        return failed;
    }
    async function markDispatchNeedsAction(dispatchId: string, reason: string): Promise<DispatchRecord> {
        const run = await options.store.load();
        const location = run ? dispatchLocation(run, dispatchId) : undefined;
        if (!run || !location)
            throw new DispatchError('not_found', 'dispatch is not active');
        assertNoRetiredFoundationWorker(location.record);
        if (location.record.status !== 'running')
            return location.record;
        const interrupted = parseDispatchRecord({
            ...location.record,
            status: 'interrupted',
            finishedAt: now(),
            failureReason: reason,
        });
        const interruptedRun = { ...run, activeDispatch: interrupted };
        const status: DeliveryRun['status'] = 'needs_action';
        await options.store.commit({
            ...interruptedRun,
            status,
            blockedReason: reason,
            thinking: interruptedRun.activeDispatch?.status === 'running'
                ? 'working'
                : 'idle',
        }, {
            runId: run.runId,
            type: 'dispatch.needs_action',
            phase: run.phase,
            status,
            revision: run.revision,
            dispatchId,
            reason,
        });
        releaseDispatch(dispatchId, { stopReason: reason });
        return interrupted;
    }
    async function stop(dispatchId: string, reason: string): Promise<DispatchRecord> {
        const run = await options.store.load();
        const location = run ? dispatchLocation(run, dispatchId) : undefined;
        if (!run || !location)
            throw new DispatchError('not_found', 'dispatch is not active');
        assertNoRetiredFoundationWorker(location.record);
        if (location.record.status !== 'running') {
            // stopRun persists every active lane as interrupted before asking the
            // bridge to tear down transports. The fallback dispatcher path therefore
            // still needs to release the in-memory worker here.
            if (location.record.status === 'interrupted')
                releaseDispatch(dispatchId, { stopReason: reason });
            return location.record;
        }
        const stopped = parseDispatchRecord({
            ...location.record,
            status: 'interrupted',
            finishedAt: now(),
            failureReason: reason,
        });
        const stoppedRun = { ...run, activeDispatch: stopped };
        await options.store.commit({
            ...stoppedRun,
            status: 'stopped',
            blockedReason: reason,
            thinking: 'idle',
        }, {
            runId: run.runId,
            type: 'dispatch.interrupted',
            phase: run.phase,
            status: 'stopped',
            revision: run.revision,
            dispatchId,
        });
        releaseDispatch(dispatchId, { stopReason: reason });
        return stopped;
    }
    async function status(dispatchId: string): Promise<DispatchRecord> {
        const run = await options.store.load();
        const location = run ? dispatchLocation(run, dispatchId) : undefined;
        if (location)
            return location.record;
        const record = [...byKey.values()].find(candidate => candidate.dispatchId === dispatchId);
        if (!record)
            throw new DispatchError('not_found', 'dispatch is not known');
        return record;
    }
    async function workerIsOpen(dispatchId: string): Promise<boolean> {
        if (startingDispatches.has(dispatchId))
            return true;
        const worker = await options.workerPort.status(dispatchId);
        return worker.status === 'running';
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
    };
}
