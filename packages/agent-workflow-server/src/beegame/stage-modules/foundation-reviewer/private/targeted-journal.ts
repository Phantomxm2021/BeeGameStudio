import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { createReviewerNativeCompletionStore } from './native-completion-store'
import { prepareReviewerCandidateInput, reviewerCandidateInputSchema, type ReviewerCandidateInput } from './candidate-contract'
import { prepareReviewerTargetedAudit } from './targeted-preparation'
import { reviewerTargetedPolicyDigest as recheckPolicyDigest } from './recheck-contract'
import {
  applyReviewerTargetedEvent,
  initialReviewerTargetedState,
  targetedEventSchema,
  type ReviewerTargetedEvent,
  type ReviewerTargetedState,
} from './targeted-state'
import {
  journalDigest,
  openJournalStorage,
  ReviewJournalConflictError,
  type JournalRecord,
} from './journal-storage'

const identity = z.object({ ownerId: z.string().min(1).max(200), projectId: z.string().min(1).max(200), requestId: z.string().min(1).max(200) }).strict()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const eventRecordSchema = z.object({
  version: z.literal(1), index: z.number().int().nonnegative(), previousDigest: digest,
  commandId: z.string().min(1).max(200), commandDigest: digest, at: z.string().datetime(),
  event: targetedEventSchema, digest,
}).strict()
type TargetedJournalRecord = JournalRecord<ReviewerTargetedEvent>
type PreparedTargetedCandidate = ReturnType<typeof prepareReviewerTargetedAudit>
type TrustedCandidate = ReturnType<typeof prepareReviewerCandidateInput>
const stateRootPrefix = '.beegame/workflow/foundation-reviewer/state/'
const targetedPolicyDigest = journalDigest({
  version: 'targeted-reviewer-journal.v3', maxRunning: 4, retryPolicy: 'unbounded-targeted-retries.v1',
  recheckPolicyDigest: recheckPolicyDigest(), cleanup: 'recovery-disabled-until-native-proof.v1',
  eventSchema: 'targeted-event-with-dispatch-billing-and-lifecycle.v1',
})

export type ReviewerTargetedJournalInput = {
  workspacePath: string
  identity: z.infer<typeof identity>
  candidate: ReviewerCandidateInput
  readOnly?: boolean
}

export type ReviewerTargetedExecutionLease = Extract<Awaited<ReturnType<Awaited<ReturnType<typeof openReviewerTargetedJournal>>['tryExecutionLease']>>, { kind: 'owned' }>
function assertWorkspace(path: string): string {
  if (!isAbsolute(path)) throw new Error('targeted journal workspace must be absolute')
  return resolve(path)
}
function captureCandidate(input: ReviewerTargetedJournalInput): { input: TrustedCandidate; prepared: PreparedTargetedCandidate; identity: z.infer<typeof identity>; supplied: ReviewerCandidateInput } {
  // Reconstruct authority from the accepted source/candidate bindings. A caller
  // cannot supply a pre-prepared object and thereby bypass candidate-handoff.
  const supplied = reviewerCandidateInputSchema.parse(structuredClone(input.candidate))
  const trusted = prepareReviewerCandidateInput(supplied)
  const prepared = prepareReviewerTargetedAudit(trusted)
  const candidateIdentity = identity.parse(input.identity)
  if (candidateIdentity.ownerId !== trusted.source.ownerId || candidateIdentity.ownerId !== trusted.candidate.ownerId ||
    candidateIdentity.projectId !== trusted.source.projectId || candidateIdentity.projectId !== trusted.candidate.projectId)
    throw new Error('targeted Reviewer identity does not match candidate authority')
  return { input: trusted, prepared, identity: candidateIdentity, supplied }
}

/**
 * Reviewer-private targeted journal. The run ID is candidate-bound and is
 * intentionally different from the initial-review identity run ID, even when
 * both journals live under the same Reviewer state namespace.
 */
export async function openReviewerTargetedJournal(input: ReviewerTargetedJournalInput) {
  const readOnly = input.readOnly === true
  const workspace = assertWorkspace(input.workspacePath)
  const captured = captureCandidate(input)
  const runId = journalDigest({ kind: 'targeted', identity: captured.identity, candidateResultId: captured.prepared.input.candidate.resultId })
  const root = join(workspace, stateRootPrefix, runId)
  const header = {
    version: 1, kind: 'foundation-reviewer-targeted-journal', runId, identity: captured.identity,
    policyDigest: targetedPolicyDigest,
    // Persist both the caller-supplied public authority and the owner-derived
    // projection. The former keeps retry predecessors self-describing; the
    // latter is what the reducer actually replays.
    input: { supplied: structuredClone(captured.supplied), trusted: structuredClone(captured.input) },
  }
  const storage = await openJournalStorage<ReviewerTargetedState, ReviewerTargetedEvent, TargetedJournalRecord>({
    workspacePath: workspace, root, runId, ownerId: captured.identity.ownerId, header, readOnly,
    eventSchema: eventRecordSchema,
    parseEvent(value) { return targetedEventSchema.parse(value) },
    initialState() { return initialReviewerTargetedState(captured.input) },
    canRecoverUnstartedExecution(state) {
      return [...state.factTasks, ...state.semanticTasks].every(task => !task.dispatch && !(task.attemptHistory?.length))
    },
    reduce(state, event, at, evidence) {
      if (event.kind === 'recover_lost') throw new Error('cleanup implementation unavailable')
      return applyReviewerTargetedEvent(state, captured.input, event, at, evidence)
    },
  })

  const completions = createReviewerNativeCompletionStore({ workspacePath: workspace, runId, headerDigest: journalDigest(header) })
  return Object.freeze({
    runId, leaseScope: storage.leaseScope,
    nativeCompletions: Object.freeze({ read: completions.read,
      record(...args: Parameters<typeof completions.record>) {
        if (readOnly) throw new Error('read-only targeted journal cannot record native completion')
        return completions.record(...args)
      },
    }),
    // A defensive copy is exposed for task construction by the controller;
    // all journal state transitions continue using the closure-captured copy
    // revalidated from the trusted bindings above.
    candidate: structuredClone(captured.input),
    async read() { return storage.read() },
    leaseStatus: storage.leaseStatus,
    canRecoverUnstartedExecution: storage.canRecoverUnstartedExecution,
    recoverUnstartedExecution: storage.recoverUnstartedExecution,
    tryExecutionLease: storage.tryExecutionLease,
    append: storage.append,
  })
}

export { ReviewJournalConflictError }
export const reviewerTargetedPolicyDigest = targetedPolicyDigest
