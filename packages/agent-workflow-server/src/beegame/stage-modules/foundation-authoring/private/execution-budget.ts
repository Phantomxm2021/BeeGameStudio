import { createHash } from 'node:crypto'
import { z } from 'zod'
import { readAutonomousFile } from './autonomous-files'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'

export const authorExecutionLimitsSchema = z.strictObject({
  // Observability thresholds only; they never terminate model work.
  maxActiveMs: z.number().int().positive().max(2147483647),
  maxNoDocumentProgressMs: z.number().int().positive().max(2147483647),
})
export type AuthorExecutionLimits = z.infer<typeof authorExecutionLimitsSchema>
export const defaultAuthorExecutionLimits: Readonly<AuthorExecutionLimits> = Object.freeze({
  maxActiveMs: 30 * 60_000, maxNoDocumentProgressMs: 8 * 60_000,
})
export const autonomousFinishBudgetCaps = Object.freeze({
  maxActiveMs: 5 * 60_000,
  maxNoDocumentProgressMs: 5 * 60_000,
})
/** Finish remains scope bounded. Time thresholds are advisory only. */
export function boundedFinishExecutionLimits(limits: AuthorExecutionLimits): AuthorExecutionLimits {
  authorExecutionLimitsSchema.parse(limits)
  return {
    maxActiveMs: Math.min(limits.maxActiveMs, autonomousFinishBudgetCaps.maxActiveMs),
    maxNoDocumentProgressMs: Math.min(limits.maxNoDocumentProgressMs, autonomousFinishBudgetCaps.maxNoDocumentProgressMs),
  }
}
export type AuthorBudgetFailure = 'document_progress_unavailable'

export type AuthorTimeWarning = 'active_time_warning' | 'document_progress_warning'
/** Byte changes measure deliverable progress, not model liveness. Time alone
 * never aborts an author; explicit stop and unsafe I/O still do. */
export async function startAuthorBudget(workspace: string, limits: AuthorExecutionLimits,
  onWarning?: (warning: AuthorTimeWarning) => void | Promise<void>) {
  const abort = new AbortController()
  const started = performance.now()
  let lastProgress = started, failure: AuthorBudgetFailure | undefined
  let previous = new Map<string, string>(), checking: Promise<void> | undefined
  const changedDocuments = new Set<string>()
  let initialized = false
  let activeWarned = false, progressWarned = false
  const fail = (reason: AuthorBudgetFailure) => { if (!failure) { failure = reason; abort.abort() } }
  async function inspect() {
    const next = new Map<string, string>()
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      let bytes: Buffer | undefined
      try { bytes = await readAutonomousFile(workspace, path, true) }
      catch (error) {
        // A concurrent ordinary write can change size between stat and read.
        // Retry on the next tick without extending the progress deadline.
        if (error instanceof Error && error.message === 'Author file changed while reading') continue
        throw error
      }
      if (bytes?.length) next.set(path, createHash('sha256').update(bytes).digest('hex'))
    }
    const changes = [...next].filter(([path, digest]) => previous.get(path) !== digest)
    if (changes.length) {
      lastProgress = performance.now()
      progressWarned = false
      if (initialized) for (const [path] of changes) changedDocuments.add(path)
    }
    // Deletion/truncation followed by restoring identical bytes is not progress.
    for (const [path, digest] of next) previous.set(path, digest)
  }
  try { await inspect(); initialized = true } catch { fail('document_progress_unavailable') }
  const timer = setInterval(() => {
    if (checking || failure) return
    checking = (async () => {
      try {
        await inspect()
        if (!activeWarned && performance.now() - started >= limits.maxActiveMs) {
          activeWarned = true
          await onWarning?.('active_time_warning')
        }
        if (!progressWarned && performance.now() - lastProgress >= limits.maxNoDocumentProgressMs) {
          progressWarned = true
          await onWarning?.('document_progress_warning')
        }
      } catch { fail('document_progress_unavailable') }
    })().finally(() => { checking = undefined })
  }, Math.max(10, Math.min(1000, Math.floor(limits.maxNoDocumentProgressMs / 10))))
  return {
    signal: abort.signal,
    failure: () => failure,
    progress: () => ({ changedDocuments: changedDocuments.size, noDocumentProgressMs: Math.max(0, Math.round(performance.now() - lastProgress)) }),
    async close() { clearInterval(timer); await checking },
  }
}
