import { join } from 'node:path'
import { z } from 'zod/v4'
import { openJournalStorage, type JournalRecord } from './journal-storage'
import { reviewDigest, singleReviewReportSchema, type SingleReviewReport } from './single-agent-contract'
import type { SingleReviewStart } from './single-agent-publication'
import type { ReviewNativeUsage } from './native-usage'
import { reviewOutputDiagnosticSchema, reviewNativeSummarySchema } from './single-agent-diagnostic'

const id = z.string().min(1).max(200)
const count = z.number().int().nonnegative().safe()
const usage = z.object({ prompt_tokens: count, completion_tokens: count, cache_read_tokens: count,
  cache_creation_tokens: count, total_tokens: count }).strict().refine(value => value.total_tokens ===
    value.prompt_tokens + value.completion_tokens + value.cache_read_tokens + value.cache_creation_tokens)
export const singleReviewEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), attemptId: id }).strict(),
  z.object({ kind: z.literal('usage'), attemptId: id, usage }).strict(),
  z.object({ kind: z.literal('progress'), attemptId: id,
    progress: z.object({ modelResponses: count, message: z.string().max(2000) }).strict() }).strict(),
  z.object({ kind: z.literal('closed'), attemptId: id, usage, usageObserved: z.boolean(),
    sealScope: z.literal('direct-child'), elapsedMs: count, summary: reviewNativeSummarySchema,
    outcome: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('accepted'), report: singleReviewReportSchema }).strict(),
      z.object({ kind: z.literal('failed'), code: id, diagnostic: reviewOutputDiagnosticSchema.optional() }).strict(),
    ]) }).strict(),
  z.object({ kind: z.literal('settled'), attemptId: id, receipt: z.json() }).strict(),
  z.object({ kind: z.literal('stop'), reason: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('failure'), code: id }).strict(),
  z.object({ kind: z.literal('published'), resultId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])
export type SingleReviewEvent = z.infer<typeof singleReviewEventSchema>
type Closed = Extract<SingleReviewEvent, { kind: 'closed' }>
export type SingleReviewAttempt = { id: string; usage?: ReviewNativeUsage; closed?: Closed; receipt?: unknown }
export type SingleReviewState = {
  attempts: SingleReviewAttempt[]; stopped: boolean; failure?: string;
  report?: SingleReviewReport; published?: string; progress?: { modelResponses: number; message: string };
}
function reduce(prior: SingleReviewState, event: SingleReviewEvent): SingleReviewState {
  const state = structuredClone(prior)
  const attempt = 'attemptId' in event ? state.attempts.find(attempt => attempt.id === event.attemptId) : undefined
  const pending = state.attempts.some(attempt => !attempt.closed)
  if (event.kind === 'claim') {
    if (state.stopped || state.failure || state.report || pending || attempt || state.attempts.some(attempt => !attempt.receipt))
      throw new Error('Review cannot claim another execution')
    state.attempts.push({ id: event.attemptId })
  } else if (event.kind === 'progress') {
    if (!attempt || attempt.closed) throw new Error('Progress does not belong to an open attempt')
    state.progress = event.progress
  } else if (event.kind === 'usage') {
    if (!attempt || attempt.closed) throw new Error('Usage does not belong to an open attempt')
    attempt.usage = event.usage
  } else if (event.kind === 'closed') {
    if (!attempt || attempt.closed) throw new Error('Completion does not belong to an open attempt')
    if (event.outcome.kind === 'accepted' && event.outcome.report.status !== 'completed')
      throw new Error('Incomplete audit cannot be accepted')
    attempt.closed = event; attempt.usage = event.usage
    if (event.outcome.kind === 'failed') state.failure = event.outcome.code
    if (!event.usageObserved) state.failure = 'usage_unavailable'
  } else if (event.kind === 'settled') {
    if (!attempt?.closed || attempt.receipt || !attempt.closed.usageObserved) throw new Error('Unsealed usage cannot settle')
    attempt.receipt = event.receipt
    if (attempt.closed.outcome.kind === 'accepted') state.report = attempt.closed.outcome.report
  } else if (event.kind === 'stop') {
    if (!state.published) state.stopped = true
  } else if (event.kind === 'resume') {
    if (pending || state.attempts.some(attempt => attempt.closed && !attempt.closed.usageObserved))
      throw new Error('Review cleanup or metering needs operator evidence')
    state.stopped = false; delete state.failure
  } else if (event.kind === 'failure') state.failure = event.code
  else {
    if (!state.report || state.stopped || state.failure || state.attempts.some(attempt => !attempt.receipt))
      throw new Error('Cannot publish incomplete review')
    state.published = event.resultId
  }
  return state
}
const eventRecordSchema: z.ZodType<JournalRecord<SingleReviewEvent>> = z.object({ version: z.literal(1), index: count,
  previousDigest: z.string(), commandId: id, commandDigest: z.string(), at: z.string(), event: singleReviewEventSchema, digest: z.string() }).strict()
export function singleReviewRoot(workspacePath: string, ownerId: string, handleId: string) {
  return join(workspacePath, '.beegame/workflow/foundation-reviewer/native-file-v1', reviewDigest(ownerId), handleId)
}
export function openSingleReviewJournal(workspacePath: string, handleId: string, start: SingleReviewStart, readOnly = false) {
  return openJournalStorage({ workspacePath, root: join(singleReviewRoot(workspacePath, start.ownerId, handleId), 'journal'),
    runId: handleId, ownerId: start.ownerId, header: start, readOnly, eventSchema: eventRecordSchema,
    parseEvent: value => singleReviewEventSchema.parse(value),
    initialState: (): SingleReviewState => ({ attempts: [], stopped: false }),
    canRecoverUnstartedExecution: state => state.attempts.length === 0, reduce })
}
