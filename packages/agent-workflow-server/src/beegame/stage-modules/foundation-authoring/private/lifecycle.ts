import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  authorDigest, authorHandleSchema, authorResumeSchema, authorStopSchema, parseAuthorStart,
  type AuthorConfiguration, type AuthorHandle, type AuthorResult, type AuthorStartInput,
  type AuthorResumeInput, type AuthorStopInput,
} from './contract'
import { createAuthorPersistence } from './persistence'
import { createAuthorRuntime, type AuthorRuntime, type AuthorRuntimeConfig } from './runtime/runtime'
import { createAuthorToolWorkspace } from './runtime/tool-workspace'
import { startDocumentStage, completeFoundationDocumentDraft } from './domain/foundation-authoring-stage'
import { recordFoundationDispatch, recordFoundationFailure } from './domain/foundation-authoring-batch'
import { retryAuthorState, stopAuthorState } from './domain/foundation-authoring-state'
import { buildFoundationAuthorPrompt } from './domain/foundation-authoring-prompt'
import { buildFoundationAuthorAuthorityBlock } from './domain/foundation-authoring-input'
import { createFoundationMarkdownStreamSink, type FoundationMarkdownStreamSink } from './domain/foundation-markdown-stream'
import { reconcileAuthoredDocumentReceipt } from './domain/authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './domain/revision'
import type { FoundationAuthoringContext, WorkerDispatchRequest, DispatchRecord } from './domain/types'
import { publishAuthorDocuments } from './publication'
import { parseAuthorCheckpoint, type Registration, type AuthorCheckpoint as Checkpoint } from './checkpoint'
import { createAuthorUsageJournal } from './usage-journal'
import type { UsageBillingClient } from '../../../../billing/public'
import type { AuthorUsage } from './runtime/runtime'
import type { RuntimeConfigurationClient } from '../../../../runtime-configuration/public'
import { createAuthorAcceptanceJournal } from './acceptance-journal'

type Control = { sequence: number; action: 'run' | 'stop'; requestId: string; reason?: string; requests: Record<string, { sequence: number; reason?: string }> }
type Job = { record: DispatchRecord; runtime: AuthorRuntime; sink?: FoundationMarkdownStreamSink; promise: Promise<Outcome> }
type Outcome = { dispatchId: string; success: boolean; usage?: AuthorUsage }
type RuntimeFactory = (config: AuthorRuntimeConfig) => AuthorRuntime

export type AuthorOperations = {
  start(input: AuthorStartInput): Promise<AuthorHandle>
  resume(input: AuthorResumeInput): Promise<AuthorHandle>
  stop(input: AuthorStopInput): Promise<AuthorResult>
  getResult(handle: AuthorHandle): Promise<AuthorResult>
}

/** Test injection is module-private; the production factory accepts data only. */
export function createAuthorLifecycle(config: AuthorConfiguration, runtimeFactory: RuntimeFactory = createAuthorRuntime,
  infrastructure: { billing?: UsageBillingClient; runtimeConfiguration?: RuntimeConfigurationClient } = {}): AuthorOperations {
  const configuration = structuredClone(config)
  const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
  const active = new Map<string, Promise<void>>()
  const controlKey = (id: string) => authorDigest(['author-control', id])
  const controlLockKey = (id: string) => authorDigest(['author-control-lock', id])
  const registrationKey = (id: string) => authorDigest(['author-registration', id])
  const acceptanceJournal = (registration: Registration) => createAuthorAcceptanceJournal(store, {
    runId: registration.handle.id, ownerId: registration.start.ownerId, projectId: registration.start.projectId,
    inputDigest: registration.start.inputDigest, confirmedBriefDigest: registration.start.input.confirmedBriefDigest,
    workspacePath: registration.workspacePath,
  })
  const isBusy = (error: unknown) => error instanceof Error && /^author persistence key (is busy|recovery is busy)/.test(error.message)
  function validateOwner(ownerId: string): void {
    if ((infrastructure.billing && infrastructure.billing.ownerId !== ownerId) ||
        (infrastructure.runtimeConfiguration && infrastructure.runtimeConfiguration.ownerId !== ownerId))
      throw new Error('Author infrastructure owner mismatch')
  }
  async function withControlLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await store.withLock(controlLockKey(id), operation) }
      catch (error) {
        if (!isBusy(error) || attempt >= 100) throw error
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  async function load(handle: AuthorHandle): Promise<Checkpoint> {
    const safe = authorHandleSchema.parse(handle)
    const checkpoint = await store.load<unknown>(safe.id)
    if (!checkpoint) throw new Error('Unknown author handle')
    const registered = await store.load<Registration>(registrationKey(safe.id))
    if (!registered || !checkpoint || typeof checkpoint !== 'object' ||
        authorDigest(registered) !== authorDigest((checkpoint as Checkpoint).registration))
      throw new Error('Author checkpoint registration binding mismatch')
    const parsed = await parseAuthorCheckpoint(checkpoint, { handle: safe, workspacePath: await realpath(configuration.workspacePath),
      acceptanceJournal: acceptanceJournal(registered) })
    validateOwner(parsed.registration.start.ownerId)
    return parsed
  }

  async function initialize(registration: Registration): Promise<void> {
    await store.create(controlKey(registration.handle.id), { sequence: 0, action: 'run', requestId: registration.start.requestId, requests: {} } satisfies Control)
    if (await store.load(registration.handle.id)) return
    const start = registration.start
    const context: FoundationAuthoringContext = {
      runId: registration.handle.id, ownerId: start.ownerId, projectId: start.projectId,
      confirmedBriefDigest: start.input.confirmedBriefDigest, confirmedBriefContext: start.input.confirmedBrief,
      phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING', status: 'running',
      foundationDraftState: { completedPaths: [] }, updatedAt: registration.createdAt,
      ...(start.input.changeRequest ? { changeRequest: start.input.changeRequest } : {}),
      revision: {
        document: await computeDocumentRevision(registration.workspacePath, start.input.confirmedBriefDigest),
        workspace: await computeWorkspaceRevision(registration.workspacePath),
      },
    }
    await store.create(registration.handle.id, { registration, context, appliedSequence: 0, acceptedDispatches: {}, sessions: {}, usage: {} } satisfies Checkpoint)
  }

  function launch(handle: AuthorHandle): Promise<void> {
    const running = active.get(handle.id)
    if (running) return running
    let owned = false
    const promise = store.withLock(handle.id, async () => {
      owned = true
      const checkpoint = await load(handle)
      try {
        const usageJournal = createAuthorUsageJournal(store, { runId: handle.id, ownerId: checkpoint.registration.start.ownerId,
          projectId: checkpoint.registration.start.projectId }, infrastructure.billing)
        await usageJournal.sealInterrupted()
        await usageJournal.flush()
        if (checkpoint.result) return
        await store.withLock(authorDigest(['author-workspace', checkpoint.registration.workspacePath]), () => drive(checkpoint))
      } catch (error) {
        // Still inside the handle lease: another instance cannot overwrite this
        // diagnostic checkpoint between failure and its durable publication.
        if (checkpoint.result) throw error
        checkpoint.context.status = 'needs_action'
        checkpoint.context.blockedReason = isBusy(error)
          ? 'Another author invocation owns this workspace.'
          : 'Author execution could not safely finish. Explicit recovery is required.'
        const interrupt = (record: DispatchRecord): DispatchRecord => ({ ...record, status: 'interrupted',
          failureReason: checkpoint.context.blockedReason, finishedAt: new Date().toISOString() })
        checkpoint.context.foundationDraftState = stopAuthorState(checkpoint.context.foundationDraftState,
          checkpoint.context.blockedReason, interrupt)
        if (checkpoint.context.activeDispatch?.status === 'running') checkpoint.context.activeDispatch = interrupt(checkpoint.context.activeDispatch)
        await store.save(handle.id, checkpoint)
      }
    }).catch(error => {
      // A different instance already owns this exact handle. It owns progress.
      if (isBusy(error)) return
      throw error
    }).finally(async () => {
      if (active.get(handle.id) === promise) active.delete(handle.id)
      if (owned) {
        const checkpoint = await load(handle)
        const control = await store.load<Control>(controlKey(handle.id))
        // A public control request can arrive after the last checkpoint but
        // before lease release. Its sequence must not disappear in that gap.
        if (!checkpoint.result && control && control.sequence > checkpoint.appliedSequence) void launch(handle)
      }
    })
    active.set(handle.id, promise)
    // Avoid an unhandled rejection if durable storage itself is unavailable.
    void promise.catch(() => undefined)
    return promise
  }

  async function drive(checkpoint: Checkpoint): Promise<void> {
    const { handle, start, workspacePath } = checkpoint.registration
    const acceptedJournal = acceptanceJournal(checkpoint.registration)
    const usageJournal = createAuthorUsageJournal(store, { runId: handle.id, ownerId: start.ownerId, projectId: start.projectId }, infrastructure.billing)
    const jobs = new Map<string, Job>()
    let stopping = false
    let storageFailure: unknown
    let tail: Promise<unknown> = Promise.resolve()
    const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
      const next = tail.then(operation)
      tail = next.catch(() => undefined)
      return next
    }
    const persist = () => store.save(handle.id, checkpoint)
    const readControl = async () => {
      const value = await store.load<Control>(controlKey(handle.id))
      if (!value || !Number.isSafeInteger(value.sequence) || !['run', 'stop'].includes(value.action)) throw new Error('Corrupt author control record')
      return value
    }
    const checkStop = async () => {
      const control = await readControl()
      if (control.action === 'stop') {
        stopping = true
        for (const job of jobs.values()) job.runtime.stop()
      }
      return control
    }
    const control = await readControl()
    // Recover accepted writes before considering a new native execution. Lost native
    // sessions become needs_action, preserving the original explicit-retry policy.
    const interrupted = checkpoint.context.foundationDraftState.documents
      ? checkpoint.context.foundationDraftState.documents.flatMap(value => value.dispatch?.status === 'running' ? [value.dispatch] : [])
      : checkpoint.context.activeDispatch?.status === 'running' ? [checkpoint.context.activeDispatch] : []
    for (const record of interrupted) {
      const receipt = await reconcileAuthoredDocumentReceipt({ workspacePath, dispatchId: record.dispatchId })
      if (receipt?.status === 'committed' && receipt.targetPath === record.taskId) {
        await acceptedJournal.accept(record, receipt)
        checkpoint.context = await completeFoundationDocumentDraft({ run: { ...checkpoint.context, activeDispatch: record }, workspacePath,
          terminal: { workerType: 'document-author', status: 'completed', writtenPaths: [receipt.targetPath], resolvedFindingIds: [] } })
        if (checkpoint.context.foundationDraftState.documents?.find(value => value.path === receipt.targetPath)?.status === 'committed')
          checkpoint.acceptedDispatches[receipt.targetPath] = record.dispatchId
      } else {
        failDispatch(record, 'Preserved native document session is unavailable.')
      }
      await persist()
    }
    if (control.action === 'run' && control.sequence > checkpoint.appliedSequence) {
      // Receipt recovery must precede retry: a user resume cannot discard the
      // original dispatch proof for a canonical commit whose checkpoint was lost.
      checkpoint.context.foundationDraftState = retryAuthorState(checkpoint.context.foundationDraftState).state
      checkpoint.context.activeDispatch = undefined
      checkpoint.context.status = 'running'
      checkpoint.context.blockedReason = undefined
      checkpoint.appliedSequence = control.sequence
      await persist()
    }
    function failDispatch(record: DispatchRecord, reason: string): void {
      if (checkpoint.context.foundationDraftState.documents && record.taskId) {
        checkpoint.context.foundationDraftState = recordFoundationFailure(checkpoint.context.foundationDraftState, record.taskId as never, reason)
        checkpoint.context.activeDispatch = undefined
      } else checkpoint.context.activeDispatch = { ...record, status: 'failed', failureReason: reason, finishedAt: new Date().toISOString() }
      checkpoint.context.status = 'needs_action'
      checkpoint.context.blockedReason = reason
    }
    async function acknowledgeStop(): Promise<void> {
      const intent = await readControl()
      const reason = intent.reason ?? 'Author invocation stopped.'
      checkpoint.context.foundationDraftState = stopAuthorState(checkpoint.context.foundationDraftState, reason,
        record => ({ ...record, status: 'interrupted', failureReason: reason, finishedAt: new Date().toISOString() }))
      if (checkpoint.context.activeDispatch?.status === 'running')
        checkpoint.context.activeDispatch = { ...checkpoint.context.activeDispatch, status: 'interrupted', failureReason: reason, finishedAt: new Date().toISOString() }
      checkpoint.context.status = 'stopped'
      checkpoint.appliedSequence = intent.sequence
      await persist()
    }
    const timer = setInterval(() => {
      void checkStop().catch(error => {
        storageFailure = error
        stopping = true
        for (const job of jobs.values()) job.runtime.stop()
      })
    }, 100)
    try {
      for (;;) {
        await checkStop()
        if (stopping) break
        if (checkpoint.context.status === 'running' && checkpoint.context.phase === 'DOCUMENT_DRAFTING') {
          const requests: WorkerDispatchRequest[] = []
          await startDocumentStage({ run: structuredClone(checkpoint.context), workspacePath,
            dispatcher: { dispatch: async request => { requests.push(request) } } })
          for (const request of requests) {
            if ((await checkStop()).action === 'stop') break
            const dispatchId = randomUUID()
            const record: DispatchRecord = { dispatchId, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', taskId: request.taskId,
              revision: request.revision, status: 'running', request: { ...request, dispatchId }, startedAt: new Date().toISOString() }
            const claimed = await transaction(() => withControlLock(handle.id, async () => {
              if ((await checkStop()).action === 'stop') return false
              if (checkpoint.context.foundationDraftState.documents)
                checkpoint.context.foundationDraftState = recordFoundationDispatch(checkpoint.context.foundationDraftState, request.taskId as never, 'drafting', record)
              else checkpoint.context.activeDispatch = record
              await persist()
              return true
            }))
            if (!claimed) break
            let runtime: AuthorRuntime
            try {
              const model = infrastructure.runtimeConfiguration
                ? await infrastructure.runtimeConfiguration.resolve({ ownerId: start.ownerId }) : configuration.model
              runtime = runtimeFactory(model)
            } catch {
              await transaction(async () => { failDispatch(record, 'Author runtime configuration is unavailable.'); await persist() })
              continue
            }
            const job = { record, runtime } as Job
            jobs.set(dispatchId, job)
            job.promise = (async (): Promise<Outcome> => {
              try {
                const authority = await buildFoundationAuthorAuthorityBlock(record.request!)
                job.sink = await createFoundationMarkdownStreamSink({ workspacePath, runId: handle.id, dispatchId,
                  targetPath: request.contract.foundationDocumentPath, maxBytes: 2 * 1024 * 1024,
                  authorBodyVersion: request.contract.authorBodyVersion as string | undefined })
                await checkStop()
                if (stopping) throw new Error('Author stopped')
                const prompt = [configuration.language ? `User-facing status language: ${configuration.language}. Write any status/message text in this language; keep structured tool enum values unchanged.` : '',
                  start.input.confirmedBrief, authority, buildFoundationAuthorPrompt(record.request!)].filter(Boolean).join('\n\n')
                const toolWorkspace = await createAuthorToolWorkspace({ privateRootPath: configuration.privateRootPath,
                  projectPath: workspacePath, requirements: start.input.confirmedBrief })
                const result = await runtime.execute({ runId: handle.id, dispatchId, workspacePath: toolWorkspace, prompt,
                  onNativeSessionId: sessionId => transaction(async () => { checkpoint.sessions[dispatchId] = sessionId; await persist() }),
                  onUsage: usage => usageJournal.observe(dispatchId, usage),
                  onMessage: async message => {
                    await checkStop(); if (!stopping) job.sink!.observe(message)
                  },
                })
                await usageJournal.observe(dispatchId, result.turnUsage, true)
                return { dispatchId, success: result.terminal.kind === 'completed', usage: result.turnUsage }
              } catch {
                const usage = runtime.getUsageSnapshot()
                try { await usageJournal.observe(dispatchId, usage, true) }
                catch (error) { storageFailure = error; stopping = true; for (const running of jobs.values()) running.runtime.stop() }
                return { dispatchId, success: false, usage }
              }
            })()
          }
        }
        if (jobs.size === 0) break
        const outcome = await Promise.race([...jobs.values()].map(job => job.promise))
        const job = jobs.get(outcome.dispatchId)!
        await usageJournal.flush()
        await transaction(() => withControlLock(handle.id, async () => {
          await checkStop()
          if (!stopping) {
            try {
              if (!outcome.success || !job.sink) throw new Error('Author model failed')
              // Stop intent is checked before the sole canonical-write admission.
              const receipt = await job.sink.commit()
              const proof = await reconcileAuthoredDocumentReceipt({ workspacePath, dispatchId: job.record.dispatchId })
              if (!proof || proof.status !== 'committed' || proof.targetPath !== job.record.taskId || proof.finalDigest !== receipt.finalDigest)
                throw new Error('Author committed receipt lost its byte binding')
              await acceptedJournal.accept(job.record, proof)
              checkpoint.context = await completeFoundationDocumentDraft({ run: { ...checkpoint.context, activeDispatch: job.record }, workspacePath,
                terminal: { workerType: 'document-author', status: 'completed', writtenPaths: [receipt.targetPath], resolvedFindingIds: [] } })
              const accepted = checkpoint.context.foundationDraftState.documents?.find(value => value.path === receipt.targetPath)?.status === 'committed'
              if (accepted) checkpoint.acceptedDispatches[receipt.targetPath] = outcome.dispatchId
            } catch { failDispatch(job.record, 'Author document generation or committed receipt validation failed.') }
            if (outcome.usage) checkpoint.usage[outcome.dispatchId] = outcome.usage
            await persist()
          }
        }))
        job.runtime.dispose()
        jobs.delete(outcome.dispatchId)
      }
      if (stopping) {
        for (const job of jobs.values()) job.runtime.stop()
        await Promise.all([...jobs.values()].map(job => job.promise))
        await usageJournal.flush()
        await transaction(() => withControlLock(handle.id, acknowledgeStop))
      } else if (checkpoint.context.phase === 'DOCUMENT_REVIEW' && checkpoint.context.status === 'running') {
        await transaction(() => withControlLock(handle.id, async () => {
          await checkStop()
          if (stopping) { await acknowledgeStop(); return }
          checkpoint.result = await publishAuthorDocuments({ start, workspacePath, acceptedDispatches: checkpoint.acceptedDispatches })
          checkpoint.context.status = 'completed'
          await persist()
        }))
      }
      if (storageFailure) throw storageFailure
    } finally {
      clearInterval(timer)
      for (const job of jobs.values()) job.runtime.dispose()
      // The run lease cannot be released while old callbacks can still append usage.
      await Promise.allSettled([...jobs.values()].map(job => job.promise))
      await usageJournal.flush()
      for (const job of jobs.values()) await job.sink?.abort('Author execution ended before acceptance.')
      await tail
    }
  }

  async function getResult(handle: AuthorHandle): Promise<AuthorResult> {
    const checkpoint = await load(handle)
    const safeHandle = structuredClone(checkpoint.registration.handle)
    const pending = infrastructure.billing ? (await createAuthorUsageJournal(store, { runId: handle.id,
      ownerId: checkpoint.registration.start.ownerId, projectId: checkpoint.registration.start.projectId }, infrastructure.billing).status()).pending : undefined
    const envelope = { handle: safeHandle, ...(pending === undefined ? {} : { billingStatus: pending ? 'pending' as const : 'settled' as const }) }
    if (checkpoint.result) return { status: 'completed', ...envelope, result: structuredClone(checkpoint.result) }
    const control = await store.load<Control>(controlKey(handle.id))
    if (!control || !Number.isSafeInteger(control.sequence) || control.sequence < 0 || !['run', 'stop'].includes(control.action))
      throw new Error('Corrupt author control record')
    // A durable public command has been accepted, but the private execution
    // loop has not applied it yet. Its predecessor's stopped/failed projection
    // is not the result of the new command. Keep this entirely stage-owned.
    if (control.sequence > checkpoint.appliedSequence) return { status: 'running', ...envelope }
    if (checkpoint.context.status === 'stopped') return { status: 'stopped', ...envelope }
    if (checkpoint.context.status === 'needs_action') {
      if (checkpoint.context.foundationDraftState.documents?.some(value => value.dispatch?.status === 'running'))
        return { status: 'running', ...envelope }
      return { status: 'needs_action', ...envelope, reason: checkpoint.context.blockedReason ?? 'Author requires explicit recovery.', resumable: true }
    }
    if (checkpoint.context.status === 'failed') return { status: 'failed', ...envelope, code: 'author_failed', reason: 'Author could not complete.' }
    return { status: 'running', ...envelope }
  }

  return {
    async start(value) {
      const start = parseAuthorStart(value)
      validateOwner(start.ownerId)
      const workspacePath = await realpath(configuration.workspacePath)
      if (resolve(configuration.privateRootPath) !== resolve(workspacePath, '.beegame/workflow/foundation-authoring/state'))
        throw new Error('Author private root must use its workspace-owned state namespace')
      const requestKey = authorDigest(['author-start', workspacePath, start.ownerId, start.projectId, start.requestId])
      const registration: Registration = { handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() }, start, createdAt: new Date().toISOString(), workspacePath }
      await store.create(requestKey, registration)
      const saved = await store.load<Registration>(requestKey)
      if (!saved || saved.start.inputDigest !== start.inputDigest) throw new Error('Author request ID conflicts with its original input')
      await store.create(registrationKey(saved.handle.id), saved)
      await initialize(saved)
      void launch(saved.handle)
      return structuredClone(saved.handle)
    },
    async resume(value) {
      const input = authorResumeSchema.parse(value)
      await withControlLock(input.handle.id, async () => {
        const checkpoint = await load(input.handle)
        const requestKey = authorDigest(['author-resume', input.requestId])
        const control = await store.load<Control>(controlKey(input.handle.id))
        if (!control) throw new Error('Missing author control')
        if (control.requests[requestKey]) return
        if (checkpoint.result || checkpoint.context.status === 'running') {
          await store.save(controlKey(input.handle.id), { ...control, requests: { ...control.requests, [requestKey]: { sequence: control.sequence } } })
          return
        }
        if (checkpoint.context.status === 'failed') throw new Error('Author invocation is not resumable')
        const next: Control = { sequence: control.sequence + 1, action: 'run', requestId: input.requestId, requests: { ...control.requests, [requestKey]: { sequence: control.sequence + 1 } } }
        await store.save(controlKey(input.handle.id), next)
      })
      void launch(input.handle)
      return structuredClone(input.handle)
    },
    async stop(value) {
      const input = authorStopSchema.parse(value)
      let alreadyAcknowledged = false
      await withControlLock(input.handle.id, async () => {
        const checkpoint = await load(input.handle)
        if (checkpoint.result) return
        const requestKey = authorDigest(['author-stop', input.requestId])
        const control = await store.load<Control>(controlKey(input.handle.id))
        if (!control) throw new Error('Missing author control')
        const previous = control.requests[requestKey]
        if (previous) {
          if (previous.reason !== input.reason) throw new Error('Author stop request ID conflicts with original reason')
          alreadyAcknowledged = checkpoint.appliedSequence >= previous.sequence
          return
        }
        const next: Control = { sequence: control.sequence + 1, action: 'stop', requestId: input.requestId, reason: input.reason,
          requests: { ...control.requests, [requestKey]: { sequence: control.sequence + 1, reason: input.reason } } }
        await store.save(controlKey(input.handle.id), next)
      })
      if (alreadyAcknowledged) return getResult(input.handle)
      await launch(input.handle)
      // A different local instance may own the execution lease.
      for (;;) {
        const result = await getResult(input.handle)
        if (result.status !== 'running') return result
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    },
    getResult,
  }
}
