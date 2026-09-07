import { randomUUID } from 'node:crypto'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import { openReviewerFactJournal, ReviewJournalConflictError, type ReviewerExecutionLease } from './fact-journal'
import type { ReviewerJournalEvent, ReviewerJournalState } from './review-state'
import type { ReviewerSemanticEvent } from './semantic-state'
import { prepareReviewerSemanticInput } from './semantic-input'
import { createSemanticWorkerTask } from './worker-task'
import { foundationSemanticModelPayloadSchema } from './worker-schemas'
import { executeReviewWorker, ReviewNativeError } from './native-worker'
import type { ReviewNativeUsage } from './native-usage'
import { resolvedReviewerProvider, selectFoundationSemanticRuntime } from './model-selection'
import { FOUNDATION_SEMANTIC_MAX_RUNNING, type FoundationSemanticRuntimeTask } from './domain/foundation-semantic-runtime'
import type { WorkflowUsage } from './domain/types'

type Result = { execution: 'owned' | 'busy' | 'stale'; state: ReviewerJournalState }
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 20))
const usage = (value: ReviewNativeUsage): WorkflowUsage => ({ input_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens,
  cache_read_tokens: value.cache_read_tokens, cache_creation_tokens: value.cache_creation_tokens, total_tokens: value.total_tokens })

/** Private semantic phase only. It consumes staged facts but never starts fact work or publishes a review. */
export async function createReviewerSemanticController(input: Parameters<typeof openReviewerFactJournal>[0], runtimeConfiguration: RuntimeConfigurationClient, inheritedLease?: ReviewerExecutionLease) {
  if (runtimeConfiguration.protocolVersion !== 1 || runtimeConfiguration.ownerId !== input.identity.ownerId || typeof runtimeConfiguration.resolve !== 'function')
    throw new Error('review runtime configuration owner mismatch')
  const bound = structuredClone(input)
  const journal = await openReviewerFactJournal(bound)
  if (inheritedLease && (inheritedLease.runId !== journal.runId || inheritedLease.scope !== journal.leaseScope)) throw new Error('review execution lease run mismatch')
  let serialization: Promise<unknown> = Promise.resolve()
  let activeRun: Promise<Result> | undefined
  const workers = new Map<string, { abort: AbortController; done: Promise<void> }>()
  function append(commandId: string, event: ReviewerJournalEvent): Promise<ReviewerJournalState> {
    const next = serialization.catch(() => {}).then(async () => {
      for (let retry = 0; ; retry++) {
        try { return await journal.append(commandId, event) }
        catch (error) { if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error }
      }
    })
    serialization = next
    return next
  }
  const semantic = (command: ReviewerSemanticEvent) => append(randomUUID(), { kind: 'semantic', command })
  const running = (state: ReviewerJournalState, taskId: string, dispatchId: string) =>
    state.semantic?.collection.tasks.some(task => task.taskId === taskId && task.status === 'running' && task.dispatch?.dispatchId === dispatchId)

  async function drive(resumeId?: string): Promise<Result> {
    const lease = inheritedLease ?? await journal.tryExecutionLease()
    if (lease.kind !== 'owned') return { execution: lease.kind, state: await journal.read() }
    const ownedLease = lease
    const { assertOwned, release } = lease
    let failure: unknown
    try {
      let state = await journal.read()
      if (!state.semantic) {
        if (state.phase !== 'facts_staged') return { execution: 'owned', state }
        try { state = await append(randomUUID(), { kind: 'begin_semantic' }) }
        catch (error) {
          state = await journal.read()
          if (!state.semantic) throw error
          // A durable phase stop may have atomically initialized the phase.
        }
      } else if (resumeId && state.semantic.phase !== 'semantic_staged') state = await append(resumeId, { kind: 'resume' })
      const outstanding = state.semantic!.collection.tasks.filter(task => task.status === 'running').map(task => task.dispatch!.dispatchId)
      if (outstanding.length) {
        // No predecessor lease owner exists. Do not replay a previously claimed
        // native process or invent a successful result from its running record.
        state = await semantic({ kind: 'recover_lost', dispatchIds: outstanding })
        return { execution: 'owned', state }
      }
      if (state.semantic!.phase !== 'semantic_review') return { execution: 'owned', state }
      const packets = prepareReviewerSemanticInput(bound.documents, state).packets

      function launch(task: FoundationSemanticRuntimeTask, dispatchId: string, configuration: { command: string[]; env: Record<string, string> }) {
        const packet = packets.find(item => item.checkId === task.checkId)!
        const executable = createSemanticWorkerTask(packet, task.kind === 'confirmation' ? 'confirmation' : 'source')
        const taskId = task.taskId
        const abort = new AbortController()
        const work = { abort, done: Promise.resolve() }
        workers.set(dispatchId, work)
        work.done = (async () => {
          try {
            await assertOwned()
            if (!running(await journal.read(), taskId, dispatchId)) {
              await semantic({ kind: 'usage', taskId, dispatchId, usage: usage({ prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }) })
              return
            }
            const result = await executeReviewWorker({ configuration, workspacePath: bound.workspacePath, signal: abort.signal,
              task: { ...executable, admit(value) { executable.admit(value); return foundationSemanticModelPayloadSchema.parse(value) } },
              onUsage: async value => { await assertOwned(); await semantic({ kind: 'usage', taskId, dispatchId, usage: usage(value) }) },
              onClosed: async observation => { await journal.nativeCompletions.record({ taskId, dispatchId,
                revision: executable.revision, packetDigest: executable.packetDigest }, observation, ownedLease) },
            })
            await assertOwned()
            if (running(await journal.read(), taskId, dispatchId))
              await semantic({ kind: 'accept', taskId, dispatchId, output: result.value, usage: usage(result.usage) })
          } catch (error) {
            try {
              await assertOwned()
              if (error instanceof ReviewNativeError) await semantic({ kind: 'usage', taskId, dispatchId, usage: usage(error.usage) })
              if (!running(await journal.read(), taskId, dispatchId)) return
              if (!(error instanceof ReviewNativeError) || error.code === 'usage_unavailable') throw error
              await semantic({ kind: 'fail', taskId, dispatchId, usage: usage(error.usage), reason: error.message })
            } catch (fatal) { failure = fatal }
          } finally { workers.delete(dispatchId) }
        })()
      }

      for (;;) {
        await assertOwned()
        const currentState = await journal.read()
        if (currentState.semantic!.phase === 'stopped' || failure) for (const worker of workers.values()) worker.abort.abort()
        if (failure) break
        if (currentState.semantic!.phase === 'semantic_review') {
          const candidate = currentState.semantic!.collection.tasks.find(task => task.status === 'pending' || task.status === 'retryable')
          if (candidate && workers.size < FOUNDATION_SEMANTIC_MAX_RUNNING) {
            let configuration: { command: string[]; env: Record<string, string> }
            try {
              let settled = false
              const cancellation = (async () => {
                while (!settled) {
                  await delay()
                  if (!settled && (await journal.read()).semantic?.phase !== 'semantic_review') throw new Error('semantic configuration wait cancelled')
                }
                return new Promise<never>(() => {})
              })()
              const resolved = await Promise.race([Promise.resolve().then(() => runtimeConfiguration.resolve({ ownerId: bound.identity.ownerId })), cancellation]).finally(() => { settled = true })
              if (!Array.isArray(resolved.command) || !resolved.command.length || resolved.command.some(item => typeof item !== 'string' || !item) ||
                !resolved.env || typeof resolved.env !== 'object' || Object.values(resolved.env).some(item => typeof item !== 'string')) throw new Error('invalid configuration')
              configuration = { command: [...resolved.command], env: selectFoundationSemanticRuntime(resolvedReviewerProvider(resolved.env), { ...resolved.env }, candidate.modelTier) }
            } catch {
              if ((await journal.read()).semantic?.phase === 'semantic_review') await semantic({ kind: 'configuration_unavailable', taskId: candidate.taskId })
              continue
            }
            await assertOwned()
            if ((await journal.read()).semantic?.phase !== 'semantic_review') continue
            const dispatchId = randomUUID()
            try { await append(dispatchId, { kind: 'semantic', command: { kind: 'claim', taskId: candidate.taskId, dispatchId } }) }
            catch (error) { if ((await journal.read()).semantic?.phase !== 'semantic_review') continue; throw error }
            if (running(await journal.read(), candidate.taskId, dispatchId)) launch(candidate, dispatchId, configuration)
            else await semantic({ kind: 'usage', taskId: candidate.taskId, dispatchId,
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
  return Object.freeze({ runId: journal.runId, read: () => journal.read(), run: () => run(), resume: (commandId: string) => run(commandId),
    /** A remote caller records intent; the execution owner's run proves cleanup. */
    async stop(commandId: string) {
      const state = await append(commandId, { kind: 'semantic_stop' })
      if (state.semantic?.phase === 'stopped') {
        for (const worker of workers.values()) worker.abort.abort()
        if (activeRun) await activeRun
      }
      return journal.read()
    },
  })
}
