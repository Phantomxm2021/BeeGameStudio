import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../billing/public'
import {
  acceptRevisionRequest,
  readRevisionRequestByHandle,
} from './request-store'
import { openRevisionAttemptStore } from './attempt-store'
import { openRevisionExecutionLease } from './execution-lease'
import { runRevisionOwnedAttempt } from './owned-attempt'
import { flushRevisionUsage } from './usage-outbox'
import { publishRevisionCompletedCandidate } from './completed-candidate'
import { readRevisionPublishedCandidate } from './candidate-publication'
import {
  captureRevisionPublicInput,
  parseRevisionStart,
  revisionHandleSchema,
  revisionResumeInputSchema,
  revisionStopInputSchema,
  revisionRequestInputDigest,
  type RevisionHandle,
  type RevisionResult,
  type RevisionStartInput,
  type RevisionResumeInput,
  type RevisionStopInput,
} from './lifecycle-contract'

export type RevisionInfrastructure = Readonly<{
  runtimeConfiguration: RuntimeConfigurationClient
  billing: UsageBillingClient
}>
export type RevisionOperations = Readonly<{
  start(input: RevisionStartInput): Promise<RevisionHandle>
  getResult(handle: RevisionHandle): Promise<RevisionResult>
  resume(input: RevisionResumeInput): Promise<RevisionResult>
  stop(input: RevisionStopInput): Promise<RevisionResult>
}>
type Registration = Awaited<ReturnType<typeof acceptRevisionRequest>>

/** Revision owns the document lane; no reviewer, controller, worker callback,
 * raw configuration, or mutable stage state is accepted from its caller. */
export function createRevisionLifecycle(
  workspacePath: string,
  infrastructure: RevisionInfrastructure,
): RevisionOperations {
  if (
    !infrastructure ||
    Object.keys(infrastructure).sort().join(',') !==
      'billing,runtimeConfiguration' ||
    infrastructure.billing?.protocolVersion !== 1 ||
    infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    !infrastructure.billing.ownerId ||
    infrastructure.billing.ownerId !==
      infrastructure.runtimeConfiguration.ownerId ||
    typeof infrastructure.billing.submitUsage !== 'function' ||
    typeof infrastructure.runtimeConfiguration.resolve !== 'function'
  )
    throw new Error(
      'Revision requires owner-bound public configuration and billing clients',
    )
  const billing = infrastructure.billing
  const runtimeConfiguration = infrastructure.runtimeConfiguration
  const ownerId = billing.ownerId
  const active = new Map<string, Promise<void>>()
  const pendingContinuation = new Map<string, Registration>()
  const handleFor = (registration: Registration): RevisionHandle => ({
    protocolVersion: 1,
    producer: 'foundation-revision',
    id: registration.record.handle,
  })
  async function load(value: unknown) {
    const handle = revisionHandleSchema.parse(captureRevisionPublicInput(value))
    return readRevisionRequestByHandle(workspacePath, handle.id, ownerId)
  }

  async function drive(registration: Registration, waitForOwner: boolean) {
    const request = registration.prepared.request
    const store = await openRevisionAttemptStore(workspacePath, request)
    const leases = await openRevisionExecutionLease(workspacePath, request)
    const acquire = async () => {
      try {
        return await leases.acquire()
      } catch {
        throw new Error('Revision execution ownership could not be acquired')
      }
    }
    let lease = await acquire()
    // A completed result can be visible while the previous owner is still
    // finishing its billing/cleanup tail. An accepted resume must not vanish
    // merely because that owner has not released its exclusive lane yet.
    while (lease.kind === 'busy' && waitForOwner) {
      await new Promise(resolve => setTimeout(resolve, 100))
      lease = await acquire()
    }
    if (lease.kind !== 'owned') return
    const fail = async (code: Parameters<typeof store.recordFailure>[0]) => {
      await lease.assertOwned()
      return store.recordFailure(code)
    }
    let operation:
      | 'configuration_failed'
      | 'execution_failed'
      | 'publication_failed'
      | 'billing_failed' = 'execution_failed'
    try {
      await lease.assertOwned()
      const initial = await store.readRequest()
      if (initial.activeAttemptId)
        throw new Error('Revision prior attempt closure is unknown')
      // Reconcile already-terminal facts before considering new workers. A
      // transient billing outage remains visible as pending with the same key.
      operation = 'billing_failed'
      await flushRevisionUsage(workspacePath, request, billing)
      if (!initial.stopped && !initial.failure && initial.phase === 'running') {
        operation = 'execution_failed'
        const worker = await store.read()
        if (!worker.completed) {
          operation = 'configuration_failed'
          const configuration = await runtimeConfiguration.resolve({ ownerId })
          await lease.assertOwned()
          operation = 'execution_failed'
          const receipt = await runRevisionOwnedAttempt(workspacePath, { request, configuration })
          await lease.assertOwned()
          operation = 'billing_failed'
          await flushRevisionUsage(workspacePath, request, billing)
          if (receipt.settlement.status !== 'completed' && receipt.settlement.status !== 'stopped')
            await fail('execution_failed')
        }
      }
      await lease.assertOwned()
      const state = await store.readRequest()
      const completed = await store.read()
      if (!state.stopped && completed.completed) {
        operation = 'publication_failed'
        await publishRevisionCompletedCandidate(workspacePath, request)
      }
    } catch {
      await lease.assertOwned()
      if (!(await store.readRequest()).stopped)
        await fail(operation)
    } finally {
      try {
        await lease.assertOwned()
        try {
          const result = await flushRevisionUsage(
            workspacePath,
            request,
            billing,
          )
          if (result.pending) await fail('billing_failed')
        } catch {
          await fail('billing_failed')
        }
      } finally {
        try {
          await lease.release()
        } catch {
          throw new Error('Revision execution ownership could not be released')
        }
      }
    }
  }
  function kick(registration: Registration, waitForOwner = false) {
    if (active.has(registration.record.handle)) {
      if (waitForOwner)
        pendingContinuation.set(registration.record.handle, registration)
      return
    }
    const promise = drive(registration, waitForOwner)
    active.set(registration.record.handle, promise)
    void promise
      .finally(() => {
        if (active.get(registration.record.handle) !== promise) return
        active.delete(registration.record.handle)
        const continuation = pendingContinuation.get(registration.record.handle)
        if (continuation) {
          pendingContinuation.delete(registration.record.handle)
          kick(continuation, true)
        }
      })
      .catch(() => {})
  }
  async function view(registration: Registration): Promise<RevisionResult> {
    const request = registration.prepared.request
    const readOnly = { readOnlyHandle: registration.record.handle }
    const store = await openRevisionAttemptStore(
      workspacePath,
      request,
      readOnly,
    )
    const state = await store.readRequest()
    const outbox = await store.readUsageOutbox()
    const base = {
      ...(state.progress ? { progress: state.progress } : {}),
      handle: handleFor(registration),
      inputDigest: revisionRequestInputDigest(request),
      billingStatus:
        outbox.activeAttemptId ||
        outbox.entries.some(entry => !entry.receipt)
          ? ('pending' as const)
          : ('settled' as const),
    }
    if (state.phase === 'published' || state.phase === 'publishing') {
      const expected = await store.readAuthorizedCandidate()
      const result =
        expected &&
        (await readRevisionPublishedCandidate(workspacePath, expected))
      if (result) return { ...base, status: 'completed', result }
    }
    const execution = await (
      await openRevisionExecutionLease(workspacePath, request, readOnly)
    ).status()
    if (execution === 'stale')
      return {
        ...base,
        status: 'needs_action',
        resumable: false,
        reason:
          'The previous execution owner was lost; explicit closure evidence is required.',
      }
    if (state.stopped && (execution === 'busy' || active.has(registration.record.handle)))
      return { ...base, status: 'running' }
    if (state.stopped)
      return state.activeAttemptId
        ? {
            ...base,
            status: 'needs_action',
            resumable: false,
            reason: 'Stop is recorded; execution cleanup is not yet confirmed.',
          }
        : { ...base, status: 'stopped' }
    if (
      state.failure &&
      !state.activeAttemptId &&
      execution === 'busy' &&
      !active.has(registration.record.handle)
    )
      return {
        ...base,
        status: 'needs_action',
        resumable: false,
        reason:
          'Execution has failed but its ownership cleanup is not confirmed.',
      }
    if (execution === 'busy' || active.has(registration.record.handle))
      return { ...base, status: 'running' }
    if (state.activeAttemptId)
      return {
        ...base,
        status: 'needs_action',
        resumable: false,
        reason:
          'A prior worker has no accepted terminal receipt; explicit recovery evidence is required.',
      }
    return {
      ...base,
      status: 'needs_action',
      resumable: true,
      reason:
        state.failure === 'configuration_failed'
          ? 'Execution authorization or runtime configuration is unavailable.'
          : state.failure === 'billing_failed'
            ? 'Usage acknowledgement is pending.'
            : 'Revision requires explicit continuation.',
    }
  }
  return Object.freeze({
    async start(value: RevisionStartInput) {
      const { prepared } = parseRevisionStart(value)
      if (prepared.request.ownerId !== ownerId)
        throw new Error('Revision start owner mismatch')
      const registration = await acceptRevisionRequest(
        workspacePath,
        prepared.request,
      )
      const state = await (
        await openRevisionAttemptStore(workspacePath, prepared.request)
      ).readRequest()
      if (!state.stopped && !state.failure && state.phase === 'running')
        kick(registration)
      return handleFor(registration)
    },
    async getResult(value: RevisionHandle) {
      return structuredClone(await view(await load(value)))
    },
    async resume(value: RevisionResumeInput): Promise<RevisionResult> {
      const input = revisionResumeInputSchema.parse(
        captureRevisionPublicInput(value),
      )
      const registration = await load(input.handle)
      const store = await openRevisionAttemptStore(
        workspacePath,
        registration.prepared.request,
      )
      const previousControl = await store.readControl(input.requestId)
      if (previousControl && previousControl.kind !== 'resumed')
        throw new Error('Revision control request immutable conflict')
      const current = await view(registration)
      if (
        current.status === 'running' ||
        (current.status === 'needs_action' && !current.resumable)
      )
        return current
      await store.resume({ requestId: input.requestId })
      kick(registration, true)
      return structuredClone(await view(registration))
    },
    async stop(value: RevisionStopInput) {
      const input = revisionStopInputSchema.parse(
        captureRevisionPublicInput(value),
      )
      const registration = await load(input.handle)
      const store = await openRevisionAttemptStore(
        workspacePath,
        registration.prepared.request,
      )
      await store.requestStop({
        requestId: input.requestId,
        reason: input.reason,
      })
      // Remote owners observe the same durable stop. The API need not await
      // them: view distinguishes accepted intent from confirmed closure.
      return structuredClone(await view(registration))
    },
  })
}
