import { z } from 'zod/v4'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { prepareRevisionRequest } from './request-preparation'
import { revisionSnapshotSchema, captureRevisionSnapshot } from './revision-snapshot'
import type { RevisionCandidateResult } from './candidate-result'
import { getLatestRevisionRuntimeUsage, type RevisionUsageEvent } from './native-usage'
import { constructRevisionCandidate } from './candidate-construction'
import { revisionBillingReceiptSchema, revisionBillingUsageSchema, revisionUsageEventId, validateRevisionBillingReceipt } from './usage-billing'
import { revisionFailureDiagnosticSchema } from './failure-diagnostic'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const sequence = z.number().int().safe().positive()
const milliseconds = z.number().int().safe().nonnegative()
const completion = z.object({ scope: z.literal('direct-child'), pid: z.number().int().positive().nullable(),
  exitCode: z.number().int().nullable(), signalCode: z.string().nullable(), stdoutDrained: z.literal(true),
  termination: z.enum(['none', 'term_requested', 'kill_requested']) }).strict()
export const revisionObservationSchema = z.object({ attemptId: z.uuid(), observationIndex: sequence, event: z.unknown() }).strict()
const retryableSettlementSchema = z.object({ status: z.literal('retryable'), attemptId: z.uuid(),
  failureCode: z.enum(['native_failed', 'output_invalid', 'owner_failed', 'cancelled']),
  usageEvents: z.array(z.unknown()), completion: completion.optional(), diagnostic: revisionFailureDiagnosticSchema.optional() }).strict()
  .superRefine((value, context) => {
    if (!value.diagnostic) return
    const expectedStage = value.failureCode === 'native_failed' ? 'native' : value.failureCode === 'output_invalid' ? 'output_validation' : undefined
    if (!expectedStage || value.diagnostic.stage !== expectedStage)
      context.addIssue({ code: 'custom', path: ['diagnostic', 'stage'], message: 'Revision failure diagnostic stage does not match failure code' })
  })
export const revisionSettlementSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), attemptId: z.uuid(), snapshot: revisionSnapshotSchema, usageEvents: z.array(z.unknown()), completion }).strict(),
  retryableSettlementSchema,
  z.object({ status: z.literal('stopped'), attemptId: z.uuid(), failureCode: z.literal('cancelled'),
    usageEvents: z.array(z.unknown()), completion: completion.optional() }).strict(),
])
export const revisionStopSchema = z.object({ requestId: z.string().min(1).max(200), reason: z.enum(['user_requested', 'shutdown']) }).strict()
export const revisionResumeSchema = z.object({ requestId: z.string().min(1).max(200) }).strict()
export const revisionLifecycleFailureSchema = z.enum(['configuration_failed', 'execution_failed', 'publication_failed', 'billing_failed'])
const common = { protocolVersion: z.literal(2), producer: z.literal('foundation-revision'),
  requestDigest: digest, handle: z.uuid(), sequence, previousDigest: digest.nullable() }
export const revisionExecutionEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('attempt_started'), attemptId: z.uuid(), attempt: sequence, startedAt: milliseconds }).strict(),
  z.object({ ...common, kind: z.literal('attempt_usage_observed'), observation: revisionObservationSchema }).strict(),
  z.object({ ...common, kind: z.literal('attempt_progress'), attemptId: z.uuid(),
    progress: z.object({ modelResponses: z.number().int().nonnegative(), message: z.string().max(2000) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal('attempt_settled'), submittedSettlement: revisionSettlementSchema,
    settlement: revisionSettlementSchema, usage: z.unknown(), finishedAt: milliseconds, durationMs: milliseconds }).strict(),
  z.object({ ...common, kind: z.literal('stop_requested'), control: revisionStopSchema }).strict(),
  z.object({ ...common, kind: z.literal('resumed'), control: revisionResumeSchema }).strict(),
  z.object({ ...common, kind: z.literal('candidate_authorized'), candidateResultId: digest, candidateResultDigest: digest,
    receiptDigest: digest }).strict(),
  z.object({ ...common, kind: z.literal('candidate_published'), authorizationDigest: digest }).strict(),
  z.object({ ...common, kind: z.literal('billing_ack'), attemptId: z.uuid(), receipt: revisionBillingReceiptSchema }).strict(),
  z.object({ ...common, kind: z.literal('lifecycle_failed'), code: revisionLifecycleFailureSchema }).strict(),
])
export type RevisionExecutionEvent = z.infer<typeof revisionExecutionEventSchema>
export type RevisionSettlement = z.infer<typeof revisionSettlementSchema>
export type RevisionStarted = Extract<RevisionExecutionEvent, { kind: 'attempt_started' }>
export type RevisionSettled = Extract<RevisionExecutionEvent, { kind: 'attempt_settled' }>
export type RevisionPublicationAuthorization = Extract<RevisionExecutionEvent, { kind: 'candidate_authorized' }>
export type RevisionExecutionState = {
  active: RevisionStarted | null; completed: RevisionSettled | null; attempt: number;
  progress?: { modelResponses: number; message: string };
  usageEvents: RevisionUsageEvent[]; attemptEvents: RevisionExecutionEvent[];
  stopped: boolean; publication: RevisionPublicationAuthorization | null; published: boolean;
  candidate?: RevisionCandidateResult;
  controls: Map<string, Extract<RevisionExecutionEvent, { kind: 'stop_requested' | 'resumed' }>>;
  attemptIds: Set<string>; events: RevisionExecutionEvent[];
  billing: Map<string, z.infer<typeof revisionBillingReceiptSchema>>;
  failure: z.infer<typeof revisionLifecycleFailureSchema> | null;
}
const same = (a: unknown, b: unknown) => revisionCanonicalJson(a) === revisionCanonicalJson(b)

/** Revision-specific replay reducer; no cross-stage runtime or IO. */
export function createRevisionExecutionReducer(request: unknown, identity: { requestDigest: string; handle: string; candidateId: string }) {
  const prepared = prepareRevisionRequest(request)
  function initial(): RevisionExecutionState {
    return { active: null, completed: null, attempt: 0, usageEvents: [], attemptEvents: [],
      stopped: false, publication: null, published: false, controls: new Map(),
      attemptIds: new Set(), events: [], billing: new Map(), failure: null }
  }
  function effectiveSettlement(state: RevisionExecutionState, submitted: RevisionSettlement): RevisionSettlement {
    if (!state.stopped) return submitted
    return { status: 'stopped', attemptId: submitted.attemptId, failureCode: 'cancelled', usageEvents: submitted.usageEvents,
      ...(submitted.completion ? { completion: submitted.completion } : {}) }
  }
  function deriveSettlement(settlement: RevisionSettlement) {
    const usage = getLatestRevisionRuntimeUsage(settlement.usageEvents as RevisionUsageEvent[])
    if ((settlement.status === 'stopped') !== ('failureCode' in settlement && settlement.failureCode === 'cancelled'))
      throw new Error('Revision attempt cancellation status mismatch')
    if (settlement.status === 'completed' && settlement.completion.pid === null)
      throw new Error('Revision completed attempt requires an observed child')
    if (settlement.status === 'completed') captureRevisionSnapshot(settlement.snapshot)
    return { usage }
  }
  function candidate(state: RevisionExecutionState) {
    const receipt = state.completed
    if (!receipt || receipt.settlement.status !== 'completed')
      throw new Error('Revision candidate requires a completed execution')
    state.candidate ??= constructRevisionCandidate(prepared, identity.candidateId, receipt.settlement.snapshot)
    return { candidate: state.candidate, receipt }
  }
  // The immutable terminal receipt is itself the sealed outbox fact. No active
  // observation or caller-supplied aggregate can become a billable entry.
  function usageOutbox(state: RevisionExecutionState) {
    return state.events.flatMap(event => {
      if (event.kind !== 'attempt_settled') return []
      const usage = revisionBillingUsageSchema.parse(event.usage)
      return [{ attemptId: event.settlement.attemptId,
        receiptDigest: revisionDigest(event), usage,
        eventId: revisionUsageEventId(identity.handle, event.settlement.attemptId, usage),
        receipt: state.billing.get(event.settlement.attemptId) ?? null }]
    })
  }
  function billingReceipt(state: RevisionExecutionState, attemptId: string, value: unknown) {
    const entry = usageOutbox(state).find(item => item.attemptId === attemptId)
    if (!entry) throw new Error('Revision billing acknowledgement requires a terminal receipt')
    return validateRevisionBillingReceipt(value, { ownerId: prepared.request.ownerId, eventId: entry.eventId, usage: entry.usage })
  }
  function apply(state: RevisionExecutionState, event: RevisionExecutionEvent): void {
    if (event.requestDigest !== identity.requestDigest || event.handle !== identity.handle || event.sequence !== state.events.length + 1 ||
      event.previousDigest !== (state.events.length ? revisionDigest(state.events.at(-1)) : null))
      throw new Error('Revision request execution journal binding mismatch')
    if (event.kind === 'attempt_started' || event.kind === 'attempt_usage_observed' ||
        event.kind === 'attempt_progress' || event.kind === 'attempt_settled') {
      const current = state
      if (event.kind === 'attempt_started') {
        if (state.stopped || state.publication || state.failure) throw new Error('Revision request is stopped, failed or publication is sealed')
        if (current.active || current.completed || event.attempt !== current.attempt + 1 || state.attemptIds.has(event.attemptId))
          throw new Error('Revision attempt invalid start transition')
        state.attemptIds.add(event.attemptId)
        current.active = event; current.attempt = event.attempt; current.usageEvents = []
      } else if (event.kind === 'attempt_usage_observed') {
        if (!current.active || current.active.attemptId !== event.observation.attemptId || event.observation.observationIndex !== current.usageEvents.length + 1)
          throw new Error('Revision attempt stale or out-of-order usage observation')
        getLatestRevisionRuntimeUsage([...current.usageEvents, event.observation.event as RevisionUsageEvent])
        current.usageEvents.push(event.observation.event as RevisionUsageEvent)
      } else if (event.kind === 'attempt_progress') {
        if (!current.active || current.active.attemptId !== event.attemptId) throw new Error('Revision progress has no active owner')
        current.progress = event.progress
      } else {
        if (!current.active || current.active.attemptId !== event.settlement.attemptId || event.submittedSettlement.attemptId !== event.settlement.attemptId)
          throw new Error('Revision attempt stale settlement')
        if (event.durationMs !== Math.max(0, event.finishedAt - current.active.startedAt)) throw new Error('Revision attempt duration mismatch')
        if (!same(event.settlement, effectiveSettlement(state, event.submittedSettlement))) throw new Error('Revision settlement disagrees with durable stop order')
        if (!same(current.usageEvents, event.settlement.usageEvents)) throw new Error('Revision settlement usage differs from durable observations')
        const derived = deriveSettlement(event.settlement)
        if (!same(derived.usage, event.usage)) throw new Error('Revision attempt derived receipt mismatch')
        if (event.settlement.status === 'stopped') current.attempt = Math.max(0, current.attempt - 1)
        if (event.settlement.status === 'completed') current.completed = event
        current.active = null
      }
      current.attemptEvents.push(event)
    } else if (event.kind === 'stop_requested' || event.kind === 'resumed') {
      if (state.controls.has(event.control.requestId)) throw new Error('Revision control request ID was reused')
      if (!state.publication) {
        if (event.kind === 'stop_requested') state.stopped = true
        else {
          if (state.active) throw new Error('Revision active attempt requires explicit recovery before resume')
          state.stopped = false
        }
      }
      if (event.kind === 'resumed') state.failure = null
      state.controls.set(event.control.requestId, event)
    } else if (event.kind === 'candidate_authorized') {
      if (state.stopped || state.publication) throw new Error('Revision request is stopped or publication is sealed')
      const expected = candidate(state)
      if (event.candidateResultId !== expected.candidate.resultId || event.candidateResultDigest !== revisionDigest(expected.candidate) ||
        event.receiptDigest !== revisionDigest(expected.receipt)) throw new Error('Revision publication authorization mismatch')
      state.publication = event
    } else if (event.kind === 'lifecycle_failed') {
      state.failure = event.code
    } else if (event.kind === 'billing_ack') {
      if (state.billing.has(event.attemptId)) throw new Error('Revision billing acknowledgement requires an unacknowledged terminal receipt')
      const receipt = billingReceipt(state, event.attemptId, event.receipt)
      state.billing.set(event.attemptId, receipt)
    } else {
      if (!state.publication || state.published || event.authorizationDigest !== revisionDigest(state.publication))
        throw new Error('Revision publication completion authority mismatch')
      state.published = true
    }
    state.events.push(event)
  }
  return { initial, effectiveSettlement, deriveSettlement, candidate, usageOutbox, billingReceipt, apply }
}
