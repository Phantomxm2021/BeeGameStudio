import { randomUUID } from 'node:crypto'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import { openReviewerFactJournal, ReviewJournalConflictError, type ReviewerExecutionLease } from './fact-journal'
import type { ReviewerFactEvent, ReviewerFactState } from './fact-state'
import { createFactWorkerTask } from './worker-task'
import { foundationFactModelPayloadSchema } from './worker-schemas'
import { executeReviewWorker, ReviewNativeError } from './native-worker'
import type { ReviewNativeUsage } from './native-usage'
import { resolvedReviewerProvider, selectFoundationFactFastRuntime } from './model-selection'
import { FOUNDATION_FACT_MAX_RUNNING } from './domain/foundation-fact-runtime'
import type { WorkflowUsage } from './domain/types'

type Result = { execution: 'owned' | 'busy' | 'stale'; state: ReviewerFactState }
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 20))
const usage = (value: ReviewNativeUsage): WorkflowUsage => ({
  input_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens, cache_read_tokens: value.cache_read_tokens,
  cache_creation_tokens: value.cache_creation_tokens, total_tokens: value.total_tokens,
})

/** Private fact-phase controller, not the whole Reviewer public lifecycle. */
export async function createReviewerFactController(
  input: Parameters<typeof openReviewerFactJournal>[0],
  runtimeConfiguration: RuntimeConfigurationClient,
  inheritedLease?: ReviewerExecutionLease,
) {
  if (runtimeConfiguration.protocolVersion !== 1 || runtimeConfiguration.ownerId !== input.identity.ownerId || typeof runtimeConfiguration.resolve !== 'function')
    throw new Error('review runtime configuration owner mismatch')
  const bound = structuredClone(input)
  const journal = await openReviewerFactJournal(bound)
  if (inheritedLease && (inheritedLease.runId !== journal.runId || inheritedLease.scope !== journal.leaseScope)) throw new Error('review execution lease run mismatch')
  let serialization: Promise<unknown> = Promise.resolve()
  let activeRun: Promise<Result> | undefined
  const workers = new Map<string, { abort: AbortController; done: Promise<void> }>()
  function append(commandId: string, event: ReviewerFactEvent): Promise<ReviewerFactState> {
    const next = serialization.catch(() => {}).then(async () => {
      for (let retry = 0; ; retry++) {
        try { return await journal.append(commandId, event) }
        catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
      }
    })
    serialization = next
    return next
  }

  async function drive(resumeId?: string): Promise<Result> {
    const lease = inheritedLease ?? await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return { execution: lease.kind, state: await journal.read() }
    const ownedLease = lease
    const { assertOwned, release } = lease
    let failure: unknown
    try {
      let state = await journal.read()
      if (resumeId && state.phase !== 'facts_staged' && state.phase !== 'format_issues') state = await append(resumeId, { kind: 'resume' })
      if (state.phase !== 'extracting_facts') return { execution: 'owned', state }
      const outstanding = state.collection.tasks.filter(task => task.status === 'running').map(task => task.dispatch!.dispatchId)
      if (outstanding.length) {
        // An acquired lease has no predecessor owner; this controller never
        // resumes a previously claimed native turn by guessing its outcome.
        state = await append(randomUUID(), { kind: 'recover_lost', dispatchIds: outstanding })
        return { execution: 'owned', state }
      }

      function launch(index: number, dispatchId: string, configuration: { command: string[]; env: Record<string, string> }) {
        const task = createFactWorkerTask(bound.documents, index)
        const taskId = `fact-${index}`
        const abort = new AbortController()
        const work = { abort, done: Promise.resolve() }
        workers.set(dispatchId, work)
        work.done = (async () => {
          try {
            await assertOwned()
            const result = await executeReviewWorker({ configuration, workspacePath: bound.workspacePath, signal: abort.signal,
              task: { ...task, admit(value) { task.admit(value); return foundationFactModelPayloadSchema.parse(value) } },
              onUsage: async value => { await assertOwned(); await append(randomUUID(), { kind: 'usage', taskId, dispatchId, usage: usage(value) }) },
              onClosed: async observation => { await journal.nativeCompletions.record({ taskId, dispatchId,
                revision: task.revision, packetDigest: task.packetDigest }, observation, ownedLease) },
            })
            await assertOwned()
            const current = await journal.read()
            if (current.collection.tasks[index]?.status === 'running')
              await append(randomUUID(), { kind: 'accept', taskId, dispatchId, output: result.value, usage: usage(result.usage) })
          } catch (error) {
            try {
              if (error instanceof ReviewNativeError) await append(randomUUID(), { kind: 'usage', taskId, dispatchId, usage: usage(error.usage) })
              const current = await journal.read()
              if (current.collection.tasks[index]?.status !== 'running') return
              if (!(error instanceof ReviewNativeError) || error.code === 'usage_unavailable') throw error
              await append(randomUUID(), { kind: 'fail', taskId, dispatchId, usage: usage(error.usage), reason: error.message })
            } catch (fatal) { failure = fatal }
          } finally { workers.delete(dispatchId) }
        })()
      }

      for (;;) {
        await assertOwned()
        state = await journal.read()
        if (state.phase === 'stopped' || failure) for (const worker of workers.values()) worker.abort.abort()
        if (failure) break
        if (state.phase === 'extracting_facts') {
          const candidate = state.collection.tasks.findIndex(task => task.status === 'pending' || task.status === 'retryable')
          if (candidate >= 0 && workers.size < FOUNDATION_FACT_MAX_RUNNING) {
            let configuration: { command: string[]; env: Record<string, string> }
            try {
              let settled = false
              const waitingForStop = (async () => {
                while (!settled) {
                  await delay()
                  if (!settled && (await journal.read()).phase !== 'extracting_facts') throw new Error('review configuration wait cancelled')
                }
                return new Promise<never>(() => {})
              })()
              const resolved = await Promise.race([Promise.resolve().then(() => runtimeConfiguration.resolve({ ownerId: bound.identity.ownerId })), waitingForStop]).finally(() => { settled = true })
              if (!Array.isArray(resolved.command) || !resolved.command.length || resolved.command.some(item => typeof item !== 'string' || !item) ||
                !resolved.env || typeof resolved.env !== 'object' || Object.values(resolved.env).some(item => typeof item !== 'string')) throw new Error('invalid configuration')
              configuration = { command: [...resolved.command], env: selectFoundationFactFastRuntime(resolvedReviewerProvider(resolved.env), { ...resolved.env }) }
            } catch {
              if ((await journal.read()).phase === 'extracting_facts') await append(randomUUID(), { kind: 'configuration_unavailable' })
              continue
            }
            await assertOwned()
            if ((await journal.read()).phase !== 'extracting_facts') continue
            const dispatchId = randomUUID()
            try { await append(dispatchId, { kind: 'claim', taskId: `fact-${candidate}`, dispatchId }) }
            catch (error) { if ((await journal.read()).phase !== 'extracting_facts') continue; throw error }
            // A concurrently committed stop takes precedence over spawning.
            if ((await journal.read()).collection.tasks[candidate]?.status === 'running') launch(candidate, dispatchId, configuration)
            else await append(randomUUID(), { kind: 'usage', taskId: `fact-${candidate}`, dispatchId,
              usage: { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } })
            continue
          }
        }
        if (!workers.size) break
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
    /** Durable intent first. Another process's run observes it before lease release. */
    async stop(commandId: string) {
      const state = await append(commandId, { kind: 'stop' })
      if (state.phase === 'stopped') for (const worker of workers.values()) worker.abort.abort()
      if (state.phase === 'stopped' && activeRun) await activeRun
      return journal.read()
    },
  })
}
