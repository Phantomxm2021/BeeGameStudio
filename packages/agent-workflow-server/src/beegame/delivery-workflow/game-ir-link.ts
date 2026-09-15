import { z } from 'zod/v4'
import { captureFoundationIrInput, type FoundationIrInput } from '../stage-modules/game-ir/input'
import { gameIrHandleSchema, gameIrResultSchema, type GameIrHandle, type GameIrOperations, type GameIrResult } from '../stage-modules/game-ir/public'
import { foundationPublicDigest } from '../foundation-public-result'
import type { DeliveryRun } from './types'
import type { RunStore, WorkflowLock } from './run-store'

export type GameIrStageLink = {
  protocolVersion: 1
  requestId: string
  inputDigest: string
  foundationRevision: string
  foundationResultId: string
  handle?: GameIrHandle
  outcome?: GameIrResult
  control: { sequence: number; appliedSequence: number; action: 'run' | 'stop'; reason?: string }
}

export const gameIrStageLinkSchema: z.ZodType<GameIrStageLink> = z.object({
  protocolVersion: z.literal(1), requestId: z.string().min(1), inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  foundationRevision: z.string().regex(/^[a-f0-9]{64}$/), foundationResultId: z.string().regex(/^[a-f0-9]{64}$/),
  handle: gameIrHandleSchema.optional(), outcome: gameIrResultSchema.optional(),
  control: z.object({ sequence: z.number().int().nonnegative(), appliedSequence: z.number().int().nonnegative(),
    action: z.enum(['run', 'stop']), reason: z.string().optional() }).strict(),
}).strict()

export function acceptedIrInput(run: DeliveryRun): FoundationIrInput {
  const review = run.foundationReviewStage?.acceptedReview
  if (!review || run.foundationReviewStage?.invocation.outcome?.billingStatus !== 'settled')
    throw new Error('IR requires a settled, accepted Foundation review')
  return captureFoundationIrInput({ ownerId: run.ownerId, projectId: run.projectId,
    acceptedReview: review, publishedDocumentRevision: review.documentSetDigest })
}

/** Workflow owns scheduling and an opaque handle, never compiler records or execution. */
export function createGameIrLink(input: { store: RunStore; ir: GameIrOperations;
  onCompleted(run: DeliveryRun): void; pollIntervalMs?: number }) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false
  async function locked<T>(runId: string, fn: (run: DeliveryRun, lock: WorkflowLock) => Promise<T>): Promise<T> {
    const lock = await input.store.mutationLock(runId)
    try {
      const run = await input.store.load(lock)
      if (!run || run.runId !== runId) throw new Error('IR workflow identity changed')
      return await fn(run, lock)
    } finally { await input.store.unlock(lock) }
  }
  const save = (run: DeliveryRun, lock: WorkflowLock, type: string) => input.store.commit(run,
    { runId: run.runId, type, phase: run.phase, status: run.status, revision: run.revision }, undefined, lock)
  const progressed = (run: DeliveryRun): DeliveryRun => ({ ...run, lastProgressAt: new Date().toISOString() })
  const progressMarker = (outcome: GameIrResult | undefined): string => [outcome?.status ?? '', outcome?.billingStatus ?? '',
    outcome?.progress?.operation ?? '', outcome?.progress?.completedOperations ?? '', outcome?.progress?.totalOperations ?? '',
    outcome?.progress?.message ?? ''].join('\0')
  function check(run: DeliveryRun, link: GameIrStageLink) {
    const source = acceptedIrInput(run)
    if (source.foundationResultId !== link.foundationResultId || source.publishedDocumentRevision !== link.foundationRevision ||
        foundationPublicDigest(source) !== link.inputDigest)
      throw new Error('IR accepted source binding changed')
    return source
  }
  function watch(run: DeliveryRun) {
    const link = run.gameIrStage
    if (closed || !link || timers.has(run.runId) || run.documentStep !== 'GAME_IR_COMPILATION') return
    if (link.outcome && link.outcome.status !== 'running' &&
        !(link.outcome.status === 'completed' && link.outcome.billingStatus === 'pending') &&
        !(link.control.action === 'stop' && link.outcome.billingStatus === 'pending' && link.outcome.status === 'stopped')) return
    const timer = setTimeout(() => {
      timers.delete(run.runId)
      void ensureProgress(run).catch(() => undefined)
    }, input.pollIntervalMs ?? 250)
    timer.unref(); timers.set(run.runId, timer)
  }
  async function observe(run: DeliveryRun, lock: WorkflowLock) {
    if (!run.gameIrStage) {
      if (run.status === 'stopped' || run.foundationReviewStage?.control.action === 'stop') return run
      const source = acceptedIrInput(run)
      if (run.revision.document !== source.publishedDocumentRevision)
        throw new Error('IR start requires the published Foundation revision')
      run = await save(progressed({ ...run, phase: 'DOCUMENT_REVIEW', documentStep: 'GAME_IR_COMPILATION', status: 'running',
        blockedReason: undefined, thinking: 'working', gameIrStage: { protocolVersion: 1,
          requestId: `ir:${run.runId}:${source.foundationResultId}`, inputDigest: foundationPublicDigest(source),
          foundationRevision: source.publishedDocumentRevision, foundationResultId: source.foundationResultId,
          control: { sequence: 0, appliedSequence: 0, action: 'run' } } }), lock, 'game_ir.requested')
    }
    const link = structuredClone(run.gameIrStage!)
    check(run, link)
    if (!link.handle && link.control.action === 'run') {
      link.handle = await input.ir.start({ protocolVersion: 1, ownerId: run.ownerId, projectId: run.projectId,
        requestId: link.requestId, acceptedReview: run.foundationReviewStage!.acceptedReview!,
        publishedDocumentRevision: link.foundationRevision })
      run = await save(progressed({ ...run, gameIrStage: link }), lock, 'game_ir.started')
    }
    if (link.handle) {
      if (link.control.sequence > link.control.appliedSequence) {
        const command = { handle: link.handle, requestId: `${link.requestId}:${link.control.sequence}` }
        link.outcome = link.control.action === 'stop'
          ? await input.ir.stop({ ...command, reason: link.control.reason ?? 'User stopped workflow' })
          : await input.ir.resume(command)
        link.control.appliedSequence = link.control.sequence
      } else link.outcome = await input.ir.getResult(link.handle)
    }
    const outcome = link.outcome
    const stopping = link.control.action === 'stop'
    if (!stopping && outcome?.status === 'completed' && outcome.billingStatus === 'settled') {
      const view = await input.ir.readResult({ handle: link.handle!, foundationRevision: link.foundationRevision })
      if (foundationPublicDigest(view.ready) !== foundationPublicDigest(outcome.result) ||
          foundationPublicDigest(view.input) !== link.inputDigest)
        throw new Error('IR public reader does not match the accepted completion')
      return save(progressed({ ...run, gameIrStage: link, status: 'running', documentStep: 'CHECKLIST_DRAFTING',
        blockedReason: undefined, currentMessage: 'IR 已发布，开始生成验收清单。', thinking: 'working' }), lock, 'game_ir.accepted')
    }
    const status = stopping ? 'stopped' : outcome?.status === 'needs_action' ? 'needs_action'
      : outcome?.status === 'failed' ? 'failed' : outcome?.status === 'stopped' ? 'stopped' : 'running'
    const prior = run.gameIrStage?.outcome
    const hasProgress = progressMarker(prior) !== progressMarker(outcome)
    const observed: DeliveryRun = { ...run, gameIrStage: link, status, thinking: status === 'running' ? 'working' : 'idle',
      blockedReason: outcome && 'reason' in outcome ? outcome.reason : undefined,
      currentMessage: stopping ? 'IR 停止请求已保存，正在确认执行退出与用量结算。'
        : outcome?.status === 'completed' && outcome.billingStatus === 'pending' ? 'IR 编译已完成，等待用量结算。'
        : outcome?.progress?.message ?? 'IR 编译中。',
    }
    return save(hasProgress ? progressed(observed) : observed, lock, 'game_ir.observed')
  }
  async function ensureProgress(run: DeliveryRun): Promise<DeliveryRun> {
    if (closed) return (await input.store.load()) ?? run
    try {
      const next = await locked(run.runId, async (current, lock) => {
        if (current.gameIrStage && current.documentStep !== 'GAME_IR_COMPILATION') return current
        return observe(current, lock)
      })
      watch(next)
      if (next.documentStep === 'CHECKLIST_DRAFTING') input.onCompleted(next)
      return next
    } catch (error) {
      await locked(run.runId, async (current, lock) => {
        if (current.status === 'stopped') return
        await save({ ...current, status: 'needs_action', thinking: 'idle',
          blockedReason: 'IR public handoff could not be verified; explicit action is required.' }, lock, 'game_ir.handoff_failed')
      })
      throw error
    }
  }
  async function control(run: DeliveryRun, action: 'run' | 'stop', reason?: string) {
    const next = await locked(run.runId, async (current, lock) => {
      if (current.documentStep !== 'GAME_IR_COMPILATION') return current
      if (!current.gameIrStage) throw new Error('IR invocation has not been started')
      const link = structuredClone(current.gameIrStage)
      if (link.control.action === action &&
          (action === 'stop' && link.control.reason === reason || action === 'run' && current.status === 'running')) return current
      link.control = { ...link.control, action, sequence: link.control.sequence + 1, ...(reason ? { reason } : {}) }
      return save(progressed({ ...current, gameIrStage: link, status: action === 'stop' ? 'stopped' : 'running' }), lock, `game_ir.${action}_requested`)
    })
    return next.documentStep === 'GAME_IR_COMPILATION' ? ensureProgress(next) : next
  }
  return { ensureProgress, resume: (run: DeliveryRun) => control(run, 'run'),
    stop: (run: DeliveryRun, reason: string) => control(run, 'stop', reason),
    dispose() { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear() } }
}
