import { createHash, randomUUID } from 'node:crypto'
import type { createFoundationAuthoring, AuthorStartInput, AuthorResult } from '../stage-modules/foundation-authoring/public'
import type { DeliveryRun, AuthorStageLink } from './types'
import type { RunStore, WorkflowLock } from './run-store'

type AuthorPort = ReturnType<typeof createFoundationAuthoring>
const HANDOFF_REASON = 'Foundation documents are complete. Document review handoff is awaiting stage acceptance.'

function controlCommandId(link: AuthorStageLink): string {
  return `${link.requestId}:${link.control.action}:${link.control.sequence}`
}

// This is contract encoding, not the author's document or scheduling logic.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function requestFor(run: DeliveryRun, requestId: string): AuthorStartInput {
  const input = { confirmedBrief: run.confirmedBriefContext, confirmedBriefDigest: run.confirmedBriefDigest,
    ...(run.changeRequest ? { changeRequest: run.changeRequest } : {}) }
  return { protocolVersion: 1, requestId, ownerId: run.ownerId, projectId: run.projectId, input,
    inputDigest: createHash('sha256').update(canonical({ ownerId: run.ownerId, projectId: run.projectId, input })).digest('hex') }
}

/** Orchestration only: opaque calls, durable control intent, public-result handoff. */
export function createFoundationAuthoringLink(input: { store: RunStore; author: AuthorPort; pollIntervalMs?: number;
  onCompleted?: (run: DeliveryRun) => Promise<void> }) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const activated = new Set<string>()
  let closed = false
  async function locked<T>(runId: string, operation: (run: DeliveryRun, lease: WorkflowLock) => Promise<T>): Promise<T> {
    const lease = await input.store.mutationLock(runId)
    try {
      const current = await input.store.load(lease)
      if (!current || current.runId !== runId) throw new Error('Author handoff run changed')
      return await operation(current, lease)
    } finally { await input.store.unlock(lease) }
  }
  async function save(run: DeliveryRun, lease: WorkflowLock, type: string): Promise<DeliveryRun> {
    return input.store.commit(run, { runId: run.runId, type, phase: run.phase, status: run.status, revision: run.revision,
      ...(run.authorStage?.result ? { authorResultId: run.authorStage.result.resultId } : {}) }, undefined, lease)
  }
  function watch(run: DeliveryRun): void {
    if (!closed && run.authorStage?.status === 'completed' && run.authorStage.control.action === 'run') {
      void input.onCompleted?.(run).catch(() => undefined)
      return
    }
    if (closed || timers.has(run.runId) || !run.authorStage || !['starting', 'running'].includes(run.authorStage.status)) return
    const timer = setTimeout(() => {
      timers.delete(run.runId)
      void synchronize(run.runId).then(watch).catch(() => {
        void locked(run.runId, async (current, lease) => {
          const link = current.authorStage
          if (!link || link.result || link.requestId !== run.authorStage!.requestId ||
              link.control.sequence !== run.authorStage!.control.sequence) return
          // This is a failure to observe a public result, not a claimed change
          // to the author's own last-known status or private execution state.
          await save({ ...current, status: 'needs_action', thinking: 'idle', currentMessage: undefined,
            blockedReason: 'Author public status could not be observed. Retry status recovery explicitly.' }, lease,
          'foundation.authoring.observation_unavailable')
        }).catch(() => undefined) // Storage failure cannot be reported durably.
      })
    }, input.pollIntervalMs ?? 250)
    timer.unref()
    timers.set(run.runId, timer)
  }
  function assertInvocation(run: DeliveryRun): AuthorStageLink {
    const link = run.authorStage
    if (!link || requestFor(run, link.requestId).inputDigest !== link.inputDigest) throw new Error('Author handoff input changed')
    return link
  }
  function project(run: DeliveryRun, outcome: AuthorResult): DeliveryRun {
    const link = { ...assertInvocation(run), ...(outcome.timing ? { timing: { ...outcome.timing } } : {}) }
    if (!link.handle || outcome.handle.id !== link.handle.id || outcome.handle.producer !== 'foundation-authoring' || outcome.handle.protocolVersion !== 1)
      throw new Error('Author result handle does not match invocation')
    const stopped = link.control.action === 'stop'
    if (outcome.status === 'completed') {
      const result = outcome.result
      if (result.ownerId !== run.ownerId || result.projectId !== run.projectId || result.confirmedBriefDigest !== run.confirmedBriefDigest || result.inputDigest !== link.inputDigest)
        throw new Error('Author result does not match its public input')
      if (link.result && link.result.resultId !== result.resultId) throw new Error('Author result changed after acceptance')
      return { ...run, authorStage: { ...link, status: 'completed', result: structuredClone(result) },
        phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', status: stopped ? 'stopped' : 'needs_action',
        thinking: 'idle', currentMessage: HANDOFF_REASON, blockedReason: stopped ? link.control.reason : HANDOFF_REASON,
        revision: { ...run.revision, document: result.documentRevision, workspace: result.workspaceRevision } }
    }
    const status = outcome.status === 'running' ? (stopped ? 'needs_action' : 'running') : outcome.status
    return { ...run, authorStage: { ...link, status: outcome.status }, status,
      thinking: status === 'running' ? 'working' : 'idle',
      currentMessage: status === 'running' ? (outcome.progress
        ? `模型响应 ${outcome.progress.modelResponses} · ${outcome.progress.message}` : 'Authoring foundation documents.') : undefined,
      blockedReason: outcome.status === 'needs_action' ? outcome.reason : outcome.status === 'failed' ? outcome.reason
        : stopped ? link.control.reason ?? 'Author stop is awaiting acknowledgment.' : undefined }
  }
  async function synchronize(runId: string): Promise<DeliveryRun> {
    return locked(runId, async (run, lease) => {
      const link = assertInvocation(run)
      if (!link.handle) return run
      let result = await input.author.getResult(link.handle)
      const activationId = `${link.handle.id}:${link.control.sequence}`
      if (!activated.has(activationId) && link.control.action === 'run' && result.status !== 'completed' &&
          (result.status === 'running' || link.control.sequence > 0)) {
        await input.author.resume({ handle: link.handle, requestId: controlCommandId(link) })
        activated.add(activationId)
        // The module owns pending-command projection. Read its post-command
        // public state; orchestration must not invent an optimistic status.
        result = await input.author.getResult(link.handle)
      }
      const next = project(run, result)
      if (canonical(next) === canonical(run)) return run
      return save(next, lease, 'foundation.authoring.public_result')
    })
  }
  async function begin(runId: string): Promise<DeliveryRun> {
    return locked(runId, async (run, lease) => {
      if (!run.authorStage) {
        if (run.phase !== 'DOCUMENT_DRAFTING' || run.foundationDraftState.documents || run.foundationDraftState.completedPaths.length || run.activeDispatch)
          throw new Error('Legacy author state requires an explicit migration; it cannot enter the new author module')
        const requestId = randomUUID()
        const request = requestFor(run, requestId)
        run = await save({ ...run, authorStage: { protocolVersion: 1, requestId, inputDigest: request.inputDigest,
          status: 'starting', control: { sequence: 0, action: 'run', requestId } } }, lease, 'foundation.authoring.start_requested')
      }
      const link = assertInvocation(run)
      if (link.control.action === 'stop' || link.handle) return run
      // Hold the orchestration lease until start has returned its opaque handle:
      // a concurrent stop cannot acknowledge an invocation whose handle is lost.
      const handle = await input.author.start(requestFor(run, link.requestId))
      activated.add(`${handle.id}:${link.control.sequence}`)
      return save({ ...run, authorStage: { ...link, handle, status: 'running' }, status: 'running',
        thinking: 'working', blockedReason: undefined }, lease, 'foundation.authoring.started')
    })
  }
  return {
    async start(run: DeliveryRun): Promise<DeliveryRun> {
      const started = await begin(run.runId)
      const current = started.authorStage?.handle ? await synchronize(run.runId) : started
      watch(current); return current
    },
    async resume(run: DeliveryRun): Promise<DeliveryRun> {
      await locked(run.runId, async (current, lease) => {
        const link = assertInvocation(current)
        if (link.result) return current // P1 has no accepted Reviewer consumer yet.
        if (link.control.action === 'run' && current.status === 'running') return current
        return save({ ...current, authorStage: { ...link, control: { sequence: link.control.sequence + 1, action: 'run', requestId: link.requestId } },
          status: 'running', blockedReason: undefined }, lease, 'foundation.authoring.resume_requested')
      })
      const started = await begin(run.runId)
      const current = started.authorStage?.handle ? await synchronize(run.runId) : started
      watch(current); return current
    },
    async ensureProgress(run: DeliveryRun): Promise<DeliveryRun> {
      const current = await synchronize(run.runId)
      watch(current); return current
    },
    async stop(run: DeliveryRun, reason: string): Promise<DeliveryRun> {
      const pending = await locked(run.runId, async (current, lease) => {
        const link = assertInvocation(current)
        if (link.control.action === 'stop' && link.control.reason === reason) return current
        return save({ ...current, authorStage: { ...link, control: { sequence: link.control.sequence + 1, action: 'stop', requestId: link.requestId, reason } },
          status: 'needs_action', thinking: 'waiting', blockedReason: 'Author stop is awaiting acknowledgment.' }, lease, 'foundation.authoring.stop_requested')
      })
      const link = assertInvocation(pending)
      if (!link.handle) return pending // An ambiguous crashed start is not a confirmed stop.
      await locked(run.runId, async current => {
        const latest = assertInvocation(current)
        // Serialize the external command against a newer resume intent. A stale
        // stop may not cancel a later generation of the same invocation.
        if (latest.control.sequence !== link.control.sequence || latest.control.action !== 'stop') return
        await input.author.stop({ handle: latest.handle!, requestId: controlCommandId(latest), reason: latest.control.reason! })
      })
      return synchronize(run.runId)
    },
    dispose(): void {
      closed = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
