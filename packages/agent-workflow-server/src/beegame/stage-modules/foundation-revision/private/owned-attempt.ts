import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { openRevisionAttemptStore } from './attempt-store'
import { createRevisionNativeAssignment } from './native-assignment'
import { buildRevisionNativeEnvironment } from './native-environment'
import { executeRevisionNativeProcess, RevisionNativeProcessError, type RevisionNativeProcessResult } from './native-process'
import { captureRevisionUsageEvent, type RevisionUsageEvent } from './native-usage'
import { acceptRevisionWorkerOutput } from './worker-output'
import { classifyRevisionNativeFailure, classifyRevisionOutputFailure } from './failure-diagnostic'

const inputSchema = z.object({ request: z.unknown(), documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  configuration: z.object({ command: z.array(z.string().min(1).refine(value => !value.includes('\0'))).min(1),
    env: z.record(z.string(), z.string().refine(value => !value.includes('\0'))) }).strict() }).strict()
type Store = Awaited<ReturnType<typeof openRevisionAttemptStore>>
type Receipt = Awaited<ReturnType<Store['settle']>>

/** One private owner-driven attempt, not the public stage lifecycle.
 * Configuration must eventually come from owner-bound public auth/config clients.
 * No automatic retry, process adoption, billing delivery or candidate publication.
 * A failure to persist settlement leaves its started record blocking redispatch.
 */
export async function runRevisionOwnedAttempt(workspacePath: string, value: unknown, controls: {
  signal?: AbortSignal
  onCompleted?: (receipt: Receipt) => void | Promise<void>
} = {}): Promise<Receipt> {
  const input = inputSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  const externalSignal = controls.signal
  const onCompleted = controls.onCompleted
  const store = await openRevisionAttemptStore(workspacePath, input.request)
  const previous = await store.read(input.documentPath)
  if (previous.completed) {
    // A failed downstream callback is replayed against the immutable receipt;
    // neither new native configuration nor callback failure triggers a worker.
    const receipt = await store.settle(input.documentPath, previous.completed.settlement)
    await onCompleted?.(structuredClone(receipt))
    return receipt
  }
  const started = await store.begin(input.documentPath)
  const controller = new AbortController()
  const signal = controller.signal
  let stopTail: Promise<void> = Promise.resolve()
  let stopControlFailed = false
  let finished = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let pollTail: Promise<void> = Promise.resolve()
  const requestStop = () => {
    stopTail = stopTail.then(async () => {
      try { await store.requestStop({ requestId: 'abort-' + started.attemptId, reason: 'user_requested' }) }
      catch { stopControlFailed = true }
      finally { controller.abort() }
    })
  }
  const poll = async (): Promise<void> => {
    try { if ((await store.readRequest()).stopped) controller.abort() }
    catch { stopControlFailed = true; controller.abort() }
    if (!finished) pollTimer = setTimeout(() => { pollTail = poll() }, 100)
  }
  externalSignal?.addEventListener('abort', requestStop, { once: true })
  if (externalSignal?.aborted) requestStop()
  try {
  await stopTail
  pollTail = poll()
  await pollTail
  let assignment: Awaited<ReturnType<typeof createRevisionNativeAssignment>>
  try {
    assignment = await createRevisionNativeAssignment({ request: input.request, documentPath: input.documentPath,
      attemptId: started.attemptId,
      ...(previous.lastSettlement?.status === 'retryable' ? { priorFailureReason: previous.lastSettlement.failureCode } : {}) })
  } catch {
    await stopTail
    if (stopControlFailed) throw new Error('Revision stop persistence failed; explicit recovery required')
    return store.settle(input.documentPath, { status: signal?.aborted ? 'stopped' : 'retryable',
      attemptId: started.attemptId, failureCode: signal?.aborted ? 'cancelled' : 'owner_failed', usageEvents: [] })
  }

  const usageEvents: RevisionUsageEvent[] = []
  let usagePersistenceFailed = false
  let native: RevisionNativeProcessResult | undefined
  let nativeError: RevisionNativeProcessError | undefined
  let beforeSpawn = true
  let closureKnown = false
  let receipt: Receipt
  try {
    try {
      const env = buildRevisionNativeEnvironment(input.configuration.env, assignment.bridgeEnvironment)
      await stopTail
      if ((await store.readRequest()).stopped) controller.abort()
      if (stopControlFailed) throw new Error('Revision stop persistence failed')
      beforeSpawn = false
      native = await executeRevisionNativeProcess({ configuration: { command: input.configuration.command, env },
        cwd: assignment.cwd, scope: assignment.scope, prompt: assignment.prompt, ...(signal ? { signal } : {}),
        async onMessage(message: Record<string, unknown>) {
          const event = captureRevisionUsageEvent(message)
          if (!event) return
          usageEvents.push(event)
          try { await store.observeUsage(input.documentPath, { attemptId: started.attemptId, observationIndex: usageEvents.length, event }) }
          catch {
            usagePersistenceFailed = true
            throw new Error('Revision usage observation could not be persisted')
          }
        } })
      closureKnown = true
    } catch (error) {
      if (error instanceof RevisionNativeProcessError) {
        nativeError = error
        closureKnown = error.completion !== undefined || ['revision_native_invalid_input', 'revision_native_spawn_failed', 'revision_native_aborted'].includes(error.code)
      } else if (beforeSpawn) closureKnown = true
      // Unknown post-dispatch failure cannot authorize cleanup or retry.
      if (!closureKnown) throw new Error('Revision attempt closure is unknown; explicit recovery required')
    }
    // Never replace a missing durable observation with a zero or smaller total.
    // The child has drained, but explicit recovery is needed to reconcile IO.
    await stopTail
    if (usagePersistenceFailed) throw new Error('Revision usage persistence failed; explicit recovery required')
    if (stopControlFailed) throw new Error('Revision stop persistence failed; explicit recovery required')
    if (!native) {
      const stopped = nativeError?.code === 'revision_native_aborted' || signal?.aborted
      const diagnostic = !stopped && !beforeSpawn && nativeError
        ? classifyRevisionNativeFailure(nativeError)
        : undefined
      receipt = await store.settle(input.documentPath, { status: stopped ? 'stopped' : 'retryable', attemptId: started.attemptId,
        failureCode: stopped ? 'cancelled' : beforeSpawn ? 'owner_failed' : 'native_failed', usageEvents,
        ...(!stopped && !beforeSpawn && diagnostic ? { diagnostic } : {}),
        ...(nativeError?.completion ? { completion: nativeError.completion } : {}) })
    } else {
      let valid = true
      let diagnostic
      try { acceptRevisionWorkerOutput({ request: input.request, documentPath: input.documentPath, markdown: native.markdown },
        { updatedAt: new Date(started.startedAt).toISOString() }) }
      catch (error) { valid = false; diagnostic = classifyRevisionOutputFailure(error) }
      // Keep IO/commit failure outside output-validation catch. The immutable
      // link may already exist even if directory sync or a later callback fails.
      receipt = await store.settle(input.documentPath, valid
        ? { status: 'completed', attemptId: started.attemptId, markdown: native.markdown, usageEvents, completion: native.completion }
        : { status: 'retryable', attemptId: started.attemptId, failureCode: 'output_invalid', usageEvents, diagnostic,
          completion: native.completion })
    }
  } finally {
    if (closureKnown) await assignment.dispose()
  }
  // Completion is durable before any downstream effect. Its failure is not
  // caught by native/output failure handling and cannot demote the receipt.
  if (receipt.settlement.status === 'completed') await onCompleted?.(structuredClone(receipt))
  return receipt
  } finally {
    finished = true
    if (pollTimer) clearTimeout(pollTimer)
    externalSignal?.removeEventListener('abort', requestStop)
    await Promise.all([pollTail, stopTail])
  }
}
