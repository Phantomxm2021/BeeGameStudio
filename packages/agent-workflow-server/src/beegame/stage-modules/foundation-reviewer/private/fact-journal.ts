import { lstat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { bindReviewDocuments, type ReviewDocumentInput } from './prepare-review'
import { initialReviewerFactState } from './fact-state'
import { applyReviewerJournalEvent, reviewerEventSchema, type ReviewerJournalEvent, type ReviewerJournalState } from './review-state'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './domain/foundation-semantic-audit'
import { FOUNDATION_FACT_CATALOG } from './domain/foundation-fact-definitions'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './domain/foundation-audit-production-manifest'
import { FOUNDATION_FACT_MAX_RUNNING } from './domain/foundation-fact-runtime'
import { reviewerRequestBindingSchema } from './review-subject'
import { createReviewerNativeCompletionStore } from './native-completion-store'
import {
  journalCanonical,
  journalDigest,
  journalImmutableFiles,
  openJournalStorage,
  ReviewJournalConflictError,
  type JournalRecord,
} from './journal-storage'

// These aliases intentionally retain the historical Reviewer-private names.
const digest = journalDigest
const canonical = journalCanonical
export { ReviewJournalConflictError }
export const reviewerImmutableFiles = journalImmutableFiles

const POLICY_DIGEST = digest(JSON.parse(JSON.stringify({
  version: 'reviewer-journal.v5', catalog: FOUNDATION_FACT_CATALOG,
  deterministicManifest: FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  maxRunning: FOUNDATION_FACT_MAX_RUNNING, maxAttempts: 2,
  semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST, semanticMaxRunning: 4, semanticMaxAttempts: 2, confirmationMaxAttempts: 1,
})))

const identitySchema = z.object({ ownerId: z.string().min(1).max(200), projectId: z.string().min(1).max(200), requestId: z.string().min(1).max(200) }).strict()
const eventSchema = z.object({
  version: z.literal(1), index: z.number().int().nonnegative(), previousDigest: z.string().regex(/^[a-f0-9]{64}$/),
  commandId: z.string().min(1).max(200), commandDigest: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string().datetime(), event: reviewerEventSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
type ReviewerJournalRecord = JournalRecord<ReviewerJournalEvent>

/**
 * Reviewer-private append-only fact and semantic journal. Reading never
 * starts workers. The historical private function name is retained for the
 * fact controller. Storage details live in the module-private helper while
 * this wrapper owns the Reviewer header, event schema, and reducer.
 */
export async function openReviewerFactJournal(input: {
  workspacePath: string
  identity: z.infer<typeof identitySchema>
  documents: readonly ReviewDocumentInput[]
  binding?: z.infer<typeof reviewerRequestBindingSchema>
  readOnly?: boolean
}) {
  const readOnly = input.readOnly === true
  if (!isAbsolute(input.workspacePath)) throw new Error('review workspace must be absolute')
  const workspace = resolve(input.workspacePath)
  // Resolve an existing workspace before choosing a fixed Reviewer-only root.
  const workspaceEntry = await lstat(workspace)
  if (!workspaceEntry.isDirectory() || workspaceEntry.isSymbolicLink()) throw new Error('review workspace must be a real directory')
  const identity = identitySchema.parse(input.identity)
  const snapshot = bindReviewDocuments(input.documents)
  const runId = digest(identity)
  const root = join(workspace, '.beegame/workflow/foundation-reviewer/state', runId)
  const header = { version: 1, identity, policyDigest: POLICY_DIGEST, input: snapshot,
    ...(input.binding ? { binding: reviewerRequestBindingSchema.parse(input.binding) } : {}) }
  const documents = snapshot.documents.map(({ path, content }) => ({ path, content }))
  const storage = await openJournalStorage<ReviewerJournalState, ReviewerJournalEvent, ReviewerJournalRecord>({
    workspacePath: workspace,
    root,
    runId,
    ownerId: identity.ownerId,
    header,
    readOnly,
    eventSchema,
    parseEvent(value) { return reviewerEventSchema.parse(value) },
    initialState() { return initialReviewerFactState(documents) },
    canRecoverUnstartedExecution(state) {
      return [...state.collection.tasks, ...(state.semantic?.collection.tasks ?? [])]
        .every(task => !task.dispatch && !(task.attemptHistory?.length))
    },
    reduce(state, event, at, evidence) { return applyReviewerJournalEvent(state, documents, event, at, evidence) },
  })
  const completions = createReviewerNativeCompletionStore({ workspacePath: workspace, runId, headerDigest: digest(header) })
  return Object.freeze({ ...storage, nativeCompletions: Object.freeze({ read: completions.read,
    record(...args: Parameters<typeof completions.record>) {
      if (readOnly) throw new Error('read-only review journal cannot record native completion')
      return completions.record(...args)
    },
  }) })
}

export type ReviewerExecutionLease = Extract<Awaited<ReturnType<Awaited<ReturnType<typeof openReviewerFactJournal>>['tryExecutionLease']>>, { kind: 'owned' }>
