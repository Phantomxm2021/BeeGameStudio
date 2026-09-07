import { randomUUID } from 'node:crypto'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import { openReviewerTargetedJournal, ReviewJournalConflictError, type ReviewerTargetedExecutionLease } from './targeted-journal'
import { TARGETED_MAX_RUNNING, type ReviewerTargetedEvent, type ReviewerTargetedState, type TargetedTask } from './targeted-state'
import { createReviewerTargetedFactWorker, createReviewerTargetedSemanticWorker } from './targeted-worker'
import { executeReviewWorker, ReviewNativeError } from './native-worker'
import type { ReviewNativeUsage } from './native-usage'
import { resolvedReviewerProvider, selectFoundationFactFastRuntime, selectFoundationSemanticRuntime } from './model-selection'
import type { WorkflowUsage } from './domain/types'

type Result = { execution: 'owned' | 'busy' | 'stale'; state: ReviewerTargetedState }
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 20))
const usage = (value: ReviewNativeUsage): WorkflowUsage => ({ input_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens,
  cache_read_tokens: value.cache_read_tokens, cache_creation_tokens: value.cache_creation_tokens, total_tokens: value.total_tokens })
const zeroUsage = (): WorkflowUsage => ({ input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 })
function rawPayload(value: unknown): {} | null {
  if (value === null || typeof value === 'object') return value
  throw new Error('targeted worker payload must be an object')
}

export class ReviewerTargetedRecoveryRequiredError extends Error {
  constructor(readonly runId: string, readonly dispatchIds: readonly string[]) {
    super(`targeted recover-required: native dispatches require cleanup before retry (${dispatchIds.join(',')})`)
    this.name = 'ReviewerTargetedRecoveryRequiredError'
  }
}
type Configuration = { command: string[]; env: Record<string, string> }

/**
 * A worker can remove itself after its terminal append but before the driver
 * observes the append's phase transition.  The idle check must therefore be
 * based on a fresh journal read, not only on the previous loop snapshot.
 * Kept exported for a deterministic regression test of that boundary.
 */
export function targetedControllerMustRecheckAfterIdle(
  previous: ReviewerTargetedState,
  latest: ReviewerTargetedState,
): boolean {
  if (latest.phase !== previous.phase) return true
  const activeTasks = latest.phase === 'extracting_facts' ? latest.factTasks :
    latest.phase === 'semantic_review' ? latest.semanticTasks : []
  return activeTasks.some(task => task.status === 'pending' || task.status === 'retryable' || task.status === 'running')
}

export async function createReviewerTargetedController(
  input: Parameters<typeof openReviewerTargetedJournal>[0], runtimeConfiguration: RuntimeConfigurationClient,
  inheritedLease?: ReviewerTargetedExecutionLease,
) {
  if (runtimeConfiguration.protocolVersion !== 1 || runtimeConfiguration.ownerId !== input.candidate.sourceBinding.ownerId ||
    typeof runtimeConfiguration.resolve !== 'function') throw new Error('targeted runtime configuration owner mismatch')
  const bound = structuredClone(input)
  const journal = await openReviewerTargetedJournal(bound)
  if (inheritedLease && (inheritedLease.runId !== journal.runId || inheritedLease.scope !== journal.leaseScope))
    throw new Error('targeted execution lease run mismatch')
  const candidate = journal.candidate
  let serialization: Promise<unknown> = Promise.resolve()
  let activeRun: Promise<Result> | undefined
  const workers = new Map<string, { abort: AbortController; done: Promise<void> }>()
  function append(commandId: string, event: ReviewerTargetedEvent): Promise<ReviewerTargetedState> {
    const next = serialization.catch(() => {}).then(async () => {
      for (let retry = 0; ; retry++) {
        try { return await journal.append(commandId, event) }
        catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
      }
    })
    serialization = next
    return next
  }
  async function resolveConfiguration(task: TargetedTask): Promise<Configuration> {
    const resolved = await runtimeConfiguration.resolve({ ownerId: candidate.candidate.ownerId })
    if (!Array.isArray(resolved.command) || !resolved.command.length || resolved.command.some(item => typeof item !== 'string' || !item) ||
      !resolved.env || typeof resolved.env !== 'object' || Array.isArray(resolved.env) || Object.values(resolved.env).some(item => typeof item !== 'string'))
      throw new Error('invalid configuration')
    const env = { ...resolved.env }
    const provider = resolvedReviewerProvider(env)
    return { command: [...resolved.command], env: task.kind === 'fact'
      ? selectFoundationFactFastRuntime(provider, env)
      : selectFoundationSemanticRuntime(provider, env, 'strong') }
  }
  async function resolveWhileActive(task: TargetedTask, phase: ReviewerTargetedState['phase']): Promise<Configuration> {
    let settled = false
    const cancelled = (async () => {
      while (!settled) {
        await delay()
        const current = await journal.read()
        if (!settled && (current.phase !== phase || current.control?.failure)) throw new Error('targeted configuration wait cancelled')
      }
      return new Promise<never>(() => {})
    })()
    return Promise.race([resolveConfiguration(task), cancelled]).finally(() => { settled = true })
  }

  async function drive(resumeId?: string): Promise<Result> {
    const lease = inheritedLease ?? await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return { execution: lease.kind, state: await journal.read() }
    const ownedLease = lease
    const { assertOwned, release } = lease
    let failure: unknown
    try {
      let state = await journal.read()
      if (state.control?.failure) return { execution: 'owned', state }
      if (resumeId && state.phase !== 'targeted_staged' && state.phase !== 'deterministic_failed') state = await append(resumeId, { kind: 'resume' })
      if (state.phase === 'targeted_staged' || state.phase === 'deterministic_failed' || state.phase === 'stopped') return { execution: 'owned', state }
      const outstanding = [...state.factTasks, ...state.semanticTasks].filter(task => task.status === 'running').map(task => task.dispatch!.dispatchId)
      if (outstanding.length) throw new ReviewerTargetedRecoveryRequiredError(journal.runId, outstanding)

      function launch(task: TargetedTask, dispatchId: string, configuration: Configuration) {
        const admittedTask = task.kind === 'fact' ? createReviewerTargetedFactWorker(candidate, task.index) :
          createReviewerTargetedSemanticWorker(candidate, state.factReceipts, task.index)
        // The reducer re-admits the raw worker payload from the journal. Keep
        // validation from the executable task, but return the exact payload.
        const executable = { ...admittedTask, admit(value: unknown) { admittedTask.admit(value); return rawPayload(value) } }
        const abort = new AbortController()
        const work = { abort, done: Promise.resolve() }
        workers.set(dispatchId, work)
        work.done = (async () => {
          try {
            await assertOwned()
            const beforeSpawn = await journal.read()
            const beforeList = task.kind === 'fact' ? beforeSpawn.factTasks : beforeSpawn.semanticTasks
            if (beforeSpawn.phase === 'stopped' || beforeSpawn.control?.failure ||
              !beforeList.some(item => item.taskId === task.taskId && item.status === 'running' && item.dispatch?.dispatchId === dispatchId)) {
              await append(randomUUID(), { kind: 'usage', taskId: task.taskId, dispatchId, usage: zeroUsage() })
              return
            }
            const result = await executeReviewWorker({ configuration, workspacePath: bound.workspacePath, signal: abort.signal,
              task: executable, onUsage: async value => { await assertOwned(); await append(randomUUID(), { kind: 'usage', taskId: task.taskId, dispatchId, usage: usage(value) }) },
              onClosed: async observation => { await journal.nativeCompletions.record({ taskId: task.taskId, dispatchId,
                revision: executable.revision, packetDigest: executable.packetDigest }, observation, ownedLease) } })
            await assertOwned()
            const current = await journal.read()
            const list = task.kind === 'fact' ? current.factTasks : current.semanticTasks
            if (list.some(item => item.taskId === task.taskId && item.status === 'running' && item.dispatch?.dispatchId === dispatchId))
              await append(randomUUID(), { kind: 'accept', taskId: task.taskId, dispatchId, output: result.value, usage: usage(result.usage) })
          } catch (error) {
            try {
              await assertOwned()
              if (error instanceof ReviewNativeError) await append(randomUUID(), { kind: 'usage', taskId: task.taskId, dispatchId, usage: usage(error.usage) })
              const current = await journal.read()
              const currentTask = [...current.factTasks, ...current.semanticTasks].find(item => item.taskId === task.taskId)
              if (!currentTask || currentTask.status !== 'running' || currentTask.dispatch?.dispatchId !== dispatchId) return
              if (!(error instanceof ReviewNativeError) || error.code === 'usage_unavailable') throw error
              try { await append(randomUUID(), { kind: 'fail', taskId: task.taskId, dispatchId, usage: usage(error.usage), reason: error.message }) }
              catch (failureError) {
                const after = await journal.read()
                const stillRunning = [...after.factTasks, ...after.semanticTasks].some(item => item.taskId === task.taskId &&
                  item.status === 'running' && item.dispatch?.dispatchId === dispatchId)
                if (stillRunning) throw failureError
              }
            } catch (fatal) { failure = fatal }
          } finally { workers.delete(dispatchId) }
        })()
      }

      for (;;) {
        await assertOwned()
        state = await journal.read()
        if (state.phase === 'stopped' || state.control?.failure || failure) for (const worker of workers.values()) worker.abort.abort()
        if (failure) break
        if (state.phase === 'deterministic_validation') { await append(randomUUID(), { kind: 'validate' }); continue }
        if (state.phase === 'extracting_facts' || state.phase === 'semantic_review') {
          const list = state.phase === 'extracting_facts' ? state.factTasks : state.semanticTasks
          const task = list.find(item => item.status === 'pending' || item.status === 'retryable')
          if (task && workers.size < TARGETED_MAX_RUNNING) {
            let configuration: Configuration
            try { configuration = await resolveWhileActive(task, state.phase) }
            catch {
              const current = await journal.read()
              if (current.phase === state.phase && !current.control?.failure) {
                try { await append(randomUUID(), { kind: 'configuration_unavailable', taskId: task.taskId }) }
                catch { const after = await journal.read(); if (after.phase === state.phase && !after.control?.failure) throw new Error('targeted configuration could not be recorded') }
              }
              continue
            }
            await assertOwned()
            if ((await journal.read()).phase !== state.phase) continue
            const dispatchId = randomUUID()
            try { await append(dispatchId, { kind: 'claim', taskId: task.taskId, dispatchId }) }
            catch (error) { if ((await journal.read()).phase !== state.phase) continue; throw error }
            const claimed = await journal.read()
            const claimedTask = [...claimed.factTasks, ...claimed.semanticTasks].find(item => item.taskId === task.taskId)
            if (claimedTask?.status === 'running' && claimedTask.dispatch?.dispatchId === dispatchId) launch(task, dispatchId, configuration)
            else await append(randomUUID(), { kind: 'usage', taskId: task.taskId, dispatchId, usage: zeroUsage() })
            continue
          }
        }
        if (!workers.size) {
          // A worker removes itself in its finally block immediately after its
          // terminal journal append.  The loop's state snapshot can therefore
          // still describe the pre-terminal phase while the worker map has
          // already become empty.  Re-read before declaring the controller
          // done, otherwise the lifecycle can seal usage and expose a
          // resumable needs_action state without running deterministic
          // validation (or the next semantic phase).
          const latest = await journal.read()
          const activeTasks = latest.phase === 'extracting_facts' ? latest.factTasks :
            latest.phase === 'semantic_review' ? latest.semanticTasks : []
          if (targetedControllerMustRecheckAfterIdle(state, latest)) {
            state = latest
            if (!activeTasks.some(task => task.status === 'running')) continue
          }
          const orphaned = activeTasks.filter(task => task.status === 'running').map(task => task.dispatch!.dispatchId)
          if (orphaned.length) throw new ReviewerTargetedRecoveryRequiredError(journal.runId, orphaned)
          break
        }
        await Promise.race([...workers.values()].map(worker => worker.done).concat(delay()))
      }
      if (failure) throw failure
      return { execution: 'owned', state: await journal.read() }
    } finally {
      for (const worker of workers.values()) worker.abort.abort()
      await Promise.allSettled([...workers.values()].map(worker => worker.done))
      await serialization.catch(() => {})
      if (!inheritedLease) await release()
    }
  }

  function run(resumeId?: string): Promise<Result> {
    if (activeRun) return resumeId ? journal.read().then(state => ({ execution: 'busy' as const, state })) : activeRun
    const promise = drive(resumeId)
    activeRun = promise
    void promise.finally(() => { if (activeRun === promise) activeRun = undefined }).catch(() => {})
    return promise
  }
  return Object.freeze({
    runId: journal.runId, read: () => journal.read(), run: () => run(), resume: (commandId: string) => run(commandId),
    async stop(commandId: string) {
      const before = await journal.read()
      const running = [...before.factTasks, ...before.semanticTasks].filter(task => task.status === 'running').map(task => task.dispatch!.dispatchId)
      if (running.length && !activeRun && (await journal.leaseStatus()) !== 'busy') throw new ReviewerTargetedRecoveryRequiredError(journal.runId, running)
      const state = await append(commandId, { kind: 'stop' })
      if (state.phase === 'stopped') { for (const worker of workers.values()) worker.abort.abort(); if (activeRun) await activeRun }
      return journal.read()
    },
  })
}
