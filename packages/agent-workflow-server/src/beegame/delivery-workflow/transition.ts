import { parseDeliveryRun } from './schema'
import type {
  AtomicTask,
  ChecklistBridgeIdentity,
  DeliveryRun,
  EvidenceRef,
  EvidenceStatus,
  GameIrCheckpointRef,
  GameIrCompilationIdentity,
  GameIrState,
} from './types'
import { digestGameIrValue } from './game-ir/model'
import { parseGameIrReadyReceipt } from './game-ir/contracts'
import type {
  FoundationAuditState,
  FoundationAuditTask,
  FoundationRevisionTask,
} from './foundation-audit-state'
import {
  activeFoundationRevisionTasks,
  foundationRuntimeTasks,
} from './foundation-audit-state'
import { isActiveFoundationRepairState } from './display-progress'

export class WorkflowTransitionError extends Error {
  constructor(
    readonly code: 'invalid_transition' | 'invariant_violation',
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowTransitionError'
  }
}

type EvidenceEvent = { evidence: EvidenceRef }

type GameIrReadyEventState = Extract<GameIrState, { status: 'ready' }>

export type DeliveryTransition =
  | {
      type: 'game_ir_compilation_started'
      identity: GameIrCompilationIdentity
    }
  | {
      type: 'game_ir_checkpoint_committed'
      checkpoint: GameIrCheckpointRef
      expectedPreviousCheckpoint?: GameIrCheckpointRef
    }
  | { type: 'game_ir_ready'; state: GameIrReadyEventState }
  | {
      type: 'checklist_bridge_started'
      identity: ChecklistBridgeIdentity
    }
  | {
      type: 'checklist_bridge_ready'
      receiptPath: string
      receiptDigest: string
    }
  | { type: 'documents_ready' }
  | ({
      type: 'resource_preparation_ready'
      resourceRevision: string
    } & EvidenceEvent)
  | ({
      type: 'resource_preparation_needs_action'
      reason: string
    } & EvidenceEvent)
  | { type: 'resource_preparation_required'; reason?: string }
  | { type: 'tasks_planned'; tasks: AtomicTask[] }
  | { type: 'task_started'; taskId: string; revision: string }
  | {
      type: 'task_completed'
      taskId: string
      revision: string
      evidenceRefs: string[]
    }
  | { type: 'task_failed'; taskId: string; reason: string }
  | ({
      type:
        | 'implementation_audit_passed'
        | 'implementation_audit_failed'
        | 'implementation_audit_blocked'
    } & EvidenceEvent)
  | ({
      type: 'acceptance_passed' | 'acceptance_failed' | 'acceptance_blocked'
    } & EvidenceEvent)
  | { type: 'delivery_completed' }
  | { type: 'stop'; reason: string }
  | { type: 'retry'; taskId?: string }

const timestamp = () => new Date().toISOString()

const FOUNDATION_MODEL_CONFIGURATION_FAILURES = new Set([
  'foundation fact fast model is not configured',
  'foundation fact extractor fast model is not configured',
  'foundation semantic fast model is not configured',
  'foundation semantic balanced model is not configured',
  'foundation semantic strong model is not configured',
  'foundation semantic model is not configured',
])

type FoundationRetryTask = FoundationAuditTask | FoundationRevisionTask

function isEligibleFoundationRetryTask(
  task: FoundationRetryTask,
  taskId: string | undefined,
): boolean {
  const value = task as FoundationRetryTask & {
    receiptPath?: unknown
    receiptDigest?: unknown
    resultDigest?: unknown
    resultPath?: unknown
    receipt?: unknown
    result?: unknown
    admittedResult?: unknown
  }
  return (
    (!taskId || task.taskId === taskId) &&
    task.status === 'needs_action' &&
    task.attempt === 0 &&
    FOUNDATION_MODEL_CONFIGURATION_FAILURES.has(task.failureReason ?? '') &&
    task.dispatch === undefined &&
    task.terminalDigest === undefined &&
    task.usage === undefined &&
    task.durationMs === undefined &&
    value.receiptPath === undefined &&
    value.receiptDigest === undefined &&
    value.resultDigest === undefined &&
    value.resultPath === undefined &&
    value.receipt === undefined &&
    value.result === undefined &&
    value.admittedResult === undefined
  )
}

function isUserStoppedFoundationRetryTask(
  task: FoundationRetryTask,
  taskId: string | undefined,
): boolean {
  return (
    (!taskId || task.taskId === taskId) &&
    task.status === 'retryable' &&
    task.dispatch?.status === 'interrupted' &&
    /(?:user|operator) stopped/i.test(task.failureReason ?? '')
  )
}

function isActionableFoundationRevisionRetryTask(
  task: FoundationRetryTask,
  taskId: string | undefined,
): boolean {
  return (
    (!taskId || task.taskId === taskId) &&
    ['document-revision', 'impacted-facts', 'semantic-recheck'].includes(
      task.kind,
    ) &&
    task.status === 'needs_action' &&
    (task.dispatch?.status === 'invalid' || task.dispatch?.status === 'failed')
  )
}

function isRetryableFoundationRevisionBoundary(
  state: FoundationAuditState,
  runStatus: DeliveryRun['status'],
  taskId: string | undefined,
): boolean {
  if (taskId) return false
  if (runStatus !== 'needs_action') return false
  if (state.status === 'planning') return true
  if (!['validating', 'round_closing'].includes(state.status)) return false
  const activeTasks = activeFoundationRevisionTasks(state)
  return (
    activeTasks.length > 0 &&
    activeTasks.every(task => task.status === 'completed')
  )
}

function fail(message: string): never {
  throw new WorkflowTransitionError('invalid_transition', message)
}

function assertTaskGraph(tasks: AtomicTask[]): void {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id))
      throw new WorkflowTransitionError(
        'invariant_violation',
        `duplicate atomic task id: ${task.id}`,
      )
    ids.add(task.id)
    if (!task.expectedArtifacts.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no expected artifact`,
      )
    if (!task.allowedPaths.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no allowed paths`,
      )
    if (!task.verification.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no verification`,
      )
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency))
        throw new WorkflowTransitionError(
          'invariant_violation',
          `task ${task.id} depends on unknown task ${dependency}`,
        )
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new WorkflowTransitionError(
        'invariant_violation',
        'atomic task graph contains a cycle',
      )
    if (visited.has(id)) return
    visiting.add(id)
    const task = tasks.find(candidate => candidate.id === id)
    for (const dependency of task?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
}

export function assertDeliveryRunInvariants(run: DeliveryRun): DeliveryRun {
  parseDeliveryRun(run)
  assertTaskGraph(run.tasks)
  if (
    run.activeTaskId &&
    !run.tasks.some(task => task.id === run.activeTaskId)
  ) {
    throw new WorkflowTransitionError(
      'invariant_violation',
      `active task does not exist: ${run.activeTaskId}`,
    )
  }
  if (run.activeDispatch && run.activeDispatch.phase !== run.phase) {
    throw new WorkflowTransitionError(
      'invariant_violation',
      'active dispatch phase does not match run phase',
    )
  }
  if (run.status === 'completed' && run.phase !== 'DELIVERY') {
    throw new WorkflowTransitionError(
      'invariant_violation',
      'only DELIVERY can be completed',
    )
  }
  for (const task of run.tasks) {
    if (
      task.status === 'completed' &&
      (!task.completedRevision || task.evidenceRefs.length === 0)
    ) {
      throw new WorkflowTransitionError(
        'invariant_violation',
        `completed task ${task.id} has no current evidence`,
      )
    }
  }
  return run
}

function withEvidence(
  run: DeliveryRun,
  key: 'resourcePreparation' | 'implementationAudit' | 'acceptance',
  evidence: EvidenceRef,
): DeliveryRun {
  return {
    ...run,
    evidence: { ...run.evidence, [key]: evidence },
    updatedAt: timestamp(),
  }
}

function requirePhase(run: DeliveryRun, phase: DeliveryRun['phase']): void {
  if (run.phase !== phase)
    fail(`transition requires ${phase}, current phase is ${run.phase}`)
}

function requireSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest`)
}

function sameGameIrIdentity(
  left: GameIrCompilationIdentity,
  right: GameIrCompilationIdentity,
): boolean {
  return (
    left.runId === right.runId &&
    left.taskId === right.taskId &&
    left.publicationId === right.publicationId &&
    left.confirmedBriefDigest === right.confirmedBriefDigest &&
    left.foundationRevision === right.foundationRevision &&
    left.foundationReadyReceiptDigest === right.foundationReadyReceiptDigest
  )
}

function requireFoundationReadyIdentity(
  run: DeliveryRun,
  identity: GameIrCompilationIdentity,
): void {
  if (run.documentStep !== 'FOUNDATION_REVIEW')
    fail('Game IR compilation requires the Foundation review step')
  if (
    !run.foundationAuditState ||
    !['audit_ready', 'revision_ready'].includes(run.foundationAuditState.status)
  )
    fail('Game IR compilation requires a Foundation READY audit state')
  if (identity.runId !== run.runId)
    fail('Game IR compilation identity run does not match DeliveryRun')
  if (!identity.taskId || !identity.publicationId)
    fail('Game IR compilation identity must name one task and publication')
  if (identity.confirmedBriefDigest !== run.confirmedBriefDigest)
    fail('Game IR compilation identity brief does not match DeliveryRun')
  if (identity.foundationRevision !== run.foundationAuditState.revision)
    fail(
      'Game IR compilation identity revision does not match Foundation READY',
    )
  requireSha256(identity.confirmedBriefDigest, 'confirmed brief digest')
  requireSha256(
    identity.foundationReadyReceiptDigest,
    'Foundation READY receipt digest',
  )
}

function requireEvidence(
  evidence: EvidenceRef,
  revision: string,
  statuses: readonly EvidenceStatus[],
): void {
  if (evidence.revision !== revision)
    fail('evidence revision does not match current run revision')
  if (!statuses.includes(evidence.status))
    fail(`evidence status ${evidence.status} is not valid for this transition`)
}

function enterResourcePreparation(
  run: DeliveryRun,
  options: { reason?: string } = {},
): DeliveryRun {
  return {
    ...run,
    phase: 'RESOURCE_PREPARATION',
    documentStep: undefined,
    status: 'running',
    activeTaskId: undefined,
    activeDispatch: undefined,
    blockedReason: options.reason,
    revision: {
      ...run.revision,
      resource: undefined,
      implementation: undefined,
    },
    tasks: [],
    evidence: {},
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    updatedAt: timestamp(),
  }
}

export function transitionDeliveryRun(
  input: DeliveryRun,
  event: DeliveryTransition,
): DeliveryRun {
  const run = assertDeliveryRunInvariants(input)
  let next: DeliveryRun
  switch (event.type) {
    case 'game_ir_compilation_started':
      requirePhase(run, 'DOCUMENT_REVIEW')
      requireFoundationReadyIdentity(run, event.identity)
      if (run.gameIrState)
        fail('Game IR compilation cannot start with an existing Game IR state')
      next = {
        ...run,
        phase: 'GAME_IR_COMPILATION',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        gameIrState: { status: 'compiling', identity: event.identity },
        checklistBridgeState: undefined,
        updatedAt: timestamp(),
      }
      break
    case 'game_ir_checkpoint_committed': {
      requirePhase(run, 'GAME_IR_COMPILATION')
      if (!run.gameIrState || run.gameIrState.status !== 'compiling')
        fail('Game IR checkpoint requires compiling state')
      requireSha256(event.checkpoint.checkpointDigest, 'checkpoint digest')
      if (
        run.activeDispatch &&
        (run.activeDispatch.workerType !== 'game-ir-compiler' ||
          run.activeDispatch.status !== 'completed' ||
          !run.activeDispatch.terminalResult)
      )
        fail(
          'Game IR checkpoint cannot consume a non-terminal compiler dispatch',
        )
      const current = run.gameIrState.latestCheckpoint
      const sameCheckpoint =
        current?.checkpointPath === event.checkpoint.checkpointPath &&
        current?.checkpointDigest === event.checkpoint.checkpointDigest
      const checkpointedState = {
        ...run.gameIrState,
        latestCheckpoint: event.checkpoint,
        diagnosticRef: undefined,
        diagnostic: undefined,
        progressIdentity: undefined,
      }
      if (sameCheckpoint)
        return {
          ...run,
          activeDispatch: undefined,
          status: 'running',
          blockedReason: undefined,
          thinking: 'working',
          gameIrState: checkpointedState,
          updatedAt: timestamp(),
        }
      if (current && current.checkpointPath === event.checkpoint.checkpointPath)
        fail(
          'Game IR checkpoint pointer conflicts with the existing checkpoint',
        )
      const expected = event.expectedPreviousCheckpoint
      if (
        (current === undefined && expected !== undefined) ||
        (current !== undefined &&
          (expected === undefined ||
            current.checkpointPath !== expected.checkpointPath ||
            current.checkpointDigest !== expected.checkpointDigest))
      )
        fail('Game IR checkpoint compare-and-swap predecessor is stale')
      next = {
        ...run,
        activeDispatch: undefined,
        status: 'running',
        blockedReason: undefined,
        thinking: 'working',
        gameIrState: checkpointedState,
        updatedAt: timestamp(),
      }
      break
    }
    case 'game_ir_ready': {
      requirePhase(run, 'GAME_IR_COMPILATION')
      if (!run.gameIrState || run.gameIrState.status !== 'compiling')
        fail('Game IR ready requires compiling state')
      const checkpoint = run.gameIrState.latestCheckpoint
      if (!checkpoint) fail('Game IR ready requires a committed checkpoint')
      if (
        checkpoint.checkpointPath !== event.state.checkpoint.checkpointPath ||
        checkpoint.checkpointDigest !== event.state.checkpoint.checkpointDigest
      )
        fail('Game IR ready checkpoint does not match the committed checkpoint')
      if (!sameGameIrIdentity(run.gameIrState.identity, event.state.identity))
        fail('Game IR ready identity does not match the compilation identity')
      let readyReceipt
      try {
        readyReceipt = parseGameIrReadyReceipt(event.state.readyReceipt)
      } catch (error) {
        fail(
          error instanceof Error
            ? error.message
            : 'Game IR ready receipt is invalid',
        )
      }
      if (digestGameIrValue(readyReceipt) !== event.state.readyReceiptDigest)
        fail('Game IR ready receipt digest mismatch')
      if (
        readyReceipt.taskId !== event.state.identity.taskId ||
        readyReceipt.publicationId !== event.state.identity.publicationId ||
        readyReceipt.foundationRevision !==
          event.state.identity.foundationRevision ||
        readyReceipt.foundationReceiptDigest !==
          event.state.identity.foundationReadyReceiptDigest
      )
        fail(
          'Game IR ready receipt identity does not match compilation identity',
        )
      next = {
        ...run,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
        status: 'running',
        blockedReason: undefined,
        activeTaskId: undefined,
        activeDispatch: undefined,
        gameIrState: {
          status: 'ready',
          identity: run.gameIrState.identity,
          checkpoint,
          readyReceipt,
          readyReceiptDigest: event.state.readyReceiptDigest,
        },
        checklistBridgeState: undefined,
        updatedAt: timestamp(),
      }
      break
    }
    case 'checklist_bridge_started':
      requirePhase(run, 'DOCUMENT_REVIEW')
      if (run.documentStep !== 'CHECKLIST_DRAFTING')
        fail('Checklist bridge requires the Checklist drafting step')
      if (!run.gameIrState || run.gameIrState.status !== 'ready')
        fail('Checklist bridge requires ready Game IR state')
      if (run.checklistBridgeState)
        fail('Checklist bridge cannot start with an existing bridge state')
      if (event.identity.runId !== run.runId)
        fail('Checklist bridge identity run does not match DeliveryRun')
      requireSha256(
        event.identity.checklistPublicationDigest,
        'Checklist publication digest',
      )
      if (
        event.identity.gameIrReadyReceiptDigest !==
        run.gameIrState.readyReceiptDigest
      )
        fail('Checklist bridge identity does not match ready Game IR')
      next = {
        ...run,
        documentStep: 'CHECKLIST_BRIDGE',
        status: 'running',
        checklistBridgeState: { status: 'bridging', identity: event.identity },
        updatedAt: timestamp(),
      }
      break
    case 'checklist_bridge_ready': {
      requirePhase(run, 'DOCUMENT_REVIEW')
      if (run.documentStep !== 'CHECKLIST_BRIDGE')
        fail('Checklist bridge ready requires the bridge step')
      if (
        !run.checklistBridgeState ||
        run.checklistBridgeState.status !== 'bridging'
      )
        fail('Checklist bridge ready requires bridging state')
      if (!run.gameIrState || run.gameIrState.status !== 'ready')
        fail('Checklist bridge ready requires ready Game IR state')
      if (!event.receiptPath.trim())
        fail('Checklist bridge receipt path is required')
      requireSha256(event.receiptDigest, 'Checklist bridge receipt digest')
      if (
        run.checklistBridgeState.identity.gameIrReadyReceiptDigest !==
        run.gameIrState.readyReceiptDigest
      )
        fail('Checklist bridge receipt is stale for the ready Game IR')
      next = {
        ...run,
        phase: 'RESOURCE_PREPARATION',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        activeTaskId: undefined,
        activeDispatch: undefined,
        checklistBridgeState: {
          status: 'ready',
          identity: run.checklistBridgeState.identity,
          receiptPath: event.receiptPath,
          receiptDigest: event.receiptDigest,
        },
        revision: {
          ...run.revision,
          resource: undefined,
          implementation: undefined,
        },
        tasks: [],
        evidence: {},
        resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
        updatedAt: timestamp(),
      }
      break
    }
    case 'documents_ready':
      requirePhase(run, 'BRIEF_CONFIRMED')
      next = {
        ...run,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        foundationDraftState: { completedPaths: [] },
        updatedAt: timestamp(),
      }
      break
    case 'resource_preparation_ready':
      requirePhase(run, 'RESOURCE_PREPARATION')
      requireEvidence(event.evidence, event.resourceRevision, ['passed'])
      next = {
        ...withEvidence(run, 'resourcePreparation', event.evidence),
        revision: { ...run.revision, resource: event.resourceRevision },
        phase: 'ATOMIC_TASK_PLANNING',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        resourceProductionState: {
          ...run.resourceProductionState,
          currentTask: 'RESOURCE_GATE',
        },
      }
      break
    case 'resource_preparation_needs_action':
      requirePhase(run, 'RESOURCE_PREPARATION')
      requireEvidence(event.evidence, event.evidence.revision, [
        'failed',
        'blocked',
      ])
      next = {
        ...withEvidence(run, 'resourcePreparation', event.evidence),
        status: 'needs_action',
        blockedReason: event.reason,
      }
      break
    case 'resource_preparation_required': {
      next = enterResourcePreparation(run, { reason: event.reason })
      break
    }
    case 'tasks_planned':
      requirePhase(run, 'ATOMIC_TASK_PLANNING')
      if (
        !run.revision.resource ||
        run.evidence.resourcePreparation?.status !== 'passed' ||
        run.evidence.resourcePreparation.revision !== run.revision.resource
      )
        fail('task planning requires passed resource-content evidence')
      assertTaskGraph(event.tasks)
      if (!event.tasks.length) fail('atomic task graph must not be empty')
      next = {
        ...run,
        tasks: event.tasks,
        phase: 'IMPLEMENTATION',
        activeTaskId: undefined,
        updatedAt: timestamp(),
      }
      break
    case 'task_started': {
      requirePhase(run, 'IMPLEMENTATION')
      const task = run.tasks.find(candidate => candidate.id === event.taskId)
      if (!task) fail(`unknown task ${event.taskId}`)
      if (task.status !== 'pending' && task.status !== 'failed')
        fail(`task ${event.taskId} is not runnable`)
      const dependencies = run.tasks.filter(candidate =>
        task.dependsOn.includes(candidate.id),
      )
      if (dependencies.some(candidate => candidate.status !== 'completed'))
        fail(`task ${event.taskId} has incomplete dependencies`)
      if (run.activeTaskId)
        fail('another implementation task is already active')
      next = {
        ...run,
        activeTaskId: task.id,
        tasks: run.tasks.map(candidate =>
          candidate.id === task.id
            ? {
                ...candidate,
                status: 'running',
                attempt: candidate.attempt + 1,
                startedRevision: event.revision,
              }
            : candidate,
        ),
        updatedAt: timestamp(),
      }
      break
    }
    case 'task_completed': {
      requirePhase(run, 'IMPLEMENTATION')
      if (run.activeTaskId !== event.taskId)
        fail(`task ${event.taskId} is not the active task`)
      const task = run.tasks.find(candidate => candidate.id === event.taskId)
      if (!task || task.status !== 'running')
        fail(`task ${event.taskId} is not running`)
      if (!event.revision || event.revision === 'uncomputed')
        fail('task evidence revision is missing')
      if (!event.evidenceRefs.length)
        fail('task completion requires evidence references')
      next = {
        ...run,
        activeTaskId: undefined,
        tasks: run.tasks.map(candidate =>
          candidate.id === event.taskId
            ? {
                ...candidate,
                status: 'completed',
                completedRevision: event.revision,
                evidenceRefs: event.evidenceRefs,
              }
            : candidate,
        ),
        revision: {
          ...run.revision,
          implementation: event.revision,
          workspace: event.revision,
        },
        updatedAt: timestamp(),
      }
      break
    }
    case 'task_failed':
      requirePhase(run, 'IMPLEMENTATION')
      if (!run.tasks.some(candidate => candidate.id === event.taskId))
        fail(`unknown task ${event.taskId}`)
      next = {
        ...run,
        activeTaskId: undefined,
        status: 'failed',
        blockedReason: event.reason,
        tasks: run.tasks.map(candidate =>
          candidate.id === event.taskId
            ? { ...candidate, status: 'failed' }
            : candidate,
        ),
        updatedAt: timestamp(),
      }
      break
    case 'implementation_audit_passed':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['passed'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        phase: 'ACCEPTANCE',
      }
      break
    case 'implementation_audit_failed':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['failed'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        phase: 'IMPLEMENTATION',
      }
      break
    case 'implementation_audit_blocked':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['blocked'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        status: 'needs_action',
        blockedReason: 'implementation audit is blocked and requires attention',
      }
      break
    case 'acceptance_passed':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['passed'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        phase: 'DELIVERY',
      }
      break
    case 'acceptance_failed':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['failed'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        phase: 'IMPLEMENTATION',
      }
      break
    case 'acceptance_blocked':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['blocked'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        status: 'needs_action',
        blockedReason: 'runtime acceptance is blocked and requires attention',
      }
      break
    case 'delivery_completed':
      requirePhase(run, 'DELIVERY')
      if (run.evidence.acceptance?.status !== 'passed')
        fail('delivery requires passed acceptance evidence')
      {
        const completedAt = timestamp()
        next = {
          ...run,
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
        }
      }
      break
    case 'stop':
      if (run.status === 'completed')
        fail('completed delivery cannot be stopped')
      next = {
        ...run,
        status: 'stopped',
        currentMessage: undefined,
        thinking: 'idle',
        ...(run.phase === 'IMPLEMENTATION' && run.activeTaskId
          ? {
              activeTaskId: undefined,
              tasks: run.tasks.map(task =>
                task.id === run.activeTaskId && task.status === 'running'
                  ? { ...task, status: 'pending' as const }
                  : task,
              ),
            }
          : {}),
        blockedReason: event.reason,
        updatedAt: timestamp(),
      }
      break
    case 'retry':
      if (
        run.status !== 'needs_action' &&
        run.status !== 'blocked' &&
        run.status !== 'stopped' &&
        run.status !== 'failed'
      )
        fail('only actionable, blocked, stopped or failed runs can be retried')
      if (
        run.phase === 'IMPLEMENTATION' &&
        event.taskId &&
        !run.tasks.some(
          task => task.id === event.taskId && task.status === 'failed',
        )
      )
        fail('retry task must be a failed task')
      {
        let draftRevived = false
        const nextDraftState =
          run.phase === 'DOCUMENT_DRAFTING' &&
          run.foundationDraftState.documents
            ? {
                ...run.foundationDraftState,
                documents: run.foundationDraftState.documents.map(document => {
                  if (
                    document.status !== 'needs_action' ||
                    (event.taskId && document.path !== event.taskId)
                  )
                    return document
                  draftRevived = true
                  return {
                    ...document,
                    status: 'pending' as const,
                    dispatch: undefined,
                    failureReason: undefined,
                  }
                }),
              }
            : undefined
        const revisionState =
          run.phase === 'DOCUMENT_REVIEW' &&
          isActiveFoundationRepairState(run.foundationAuditState)
            ? run.foundationAuditState
            : undefined
        const auditState =
          run.phase === 'DOCUMENT_REVIEW' && !revisionState
            ? run.foundationAuditState
            : undefined
        let auditRevived = false
        const nextAuditState = auditState
          ? {
              ...auditState,
              tasks: auditState.tasks.map(task => {
                if (
                  (!isEligibleFoundationRetryTask(task, event.taskId) &&
                    !isUserStoppedFoundationRetryTask(task, event.taskId)) ||
                  !['document-facts', 'semantic', 'confirmation'].includes(
                    task.kind,
                  )
                )
                  return task
                auditRevived = true
                return {
                  ...task,
                  status: 'pending' as const,
                  failureReason: undefined,
                }
              }),
            }
          : undefined
        let revisionRevived = false
        const nextRevisionState =
          revisionState && revisionState.status !== 'planning'
            ? {
                ...revisionState,
                ...(() => {
                  const activeTaskIds = new Set(
                    foundationRuntimeTasks(revisionState).map(
                      task => task.taskId,
                    ),
                  )
                  return {
                    tasks: revisionState.tasks.map(task => {
                      if (!activeTaskIds.has(task.taskId)) return task
                      const actionableRevisionRetry =
                        (task.kind !== 'document-revision' ||
                          revisionState.status === 'revising') &&
                        isActionableFoundationRevisionRetryTask(
                          task,
                          event.taskId,
                        )
                      const userStoppedRetry = isUserStoppedFoundationRetryTask(
                        task,
                        event.taskId,
                      )
                      const canReviveDocument =
                        task.kind === 'document-revision' &&
                        (actionableRevisionRetry || userStoppedRetry)
                      const canReviveRevisionWorker =
                        ['impacted-facts', 'semantic-recheck'].includes(
                          task.kind,
                        ) &&
                        (actionableRevisionRetry ||
                          isEligibleFoundationRetryTask(task, event.taskId) ||
                          userStoppedRetry)
                      if (!canReviveDocument && !canReviveRevisionWorker)
                        return task
                      revisionRevived = true
                      return {
                        ...task,
                        status: 'pending' as const,
                        failureReason: undefined,
                      }
                    }),
                  }
                })(),
              }
            : undefined
        const revisionBoundaryRevived = revisionState
          ? isRetryableFoundationRevisionBoundary(
              revisionState,
              run.status,
              event.taskId,
            )
          : false
        const revisionBoundaryNeedsFactReplan = Boolean(
          revisionBoundaryRevived &&
            revisionState?.status === 'validating' &&
            activeFoundationRevisionTasks(revisionState).every(
              task => task.kind === 'document-revision',
            ),
        )
        const foundationStateInCurrentPhase = !!(
          (run.phase === 'DOCUMENT_DRAFTING' &&
            run.foundationDraftState.documents?.some(
              document => document.status === 'needs_action',
            )) ||
          auditState?.tasks.some(task => task.status === 'needs_action') ||
          (revisionState && run.status === 'needs_action') ||
          (revisionState &&
            revisionState.status !== 'planning' &&
            activeFoundationRevisionTasks(revisionState).some(
              task => task.status === 'needs_action',
            ))
        )
        const foundationRevived =
          draftRevived ||
          auditRevived ||
          revisionRevived ||
          revisionBoundaryRevived
        const preserveFoundationActionableState =
          foundationStateInCurrentPhase && !foundationRevived
        next = {
          ...run,
          status: preserveFoundationActionableState ? run.status : 'running',
          ...(draftRevived ? { foundationDraftState: nextDraftState } : {}),
          ...(auditRevived ? { foundationAuditState: nextAuditState } : {}),
          ...(revisionRevived
            ? { foundationAuditState: nextRevisionState }
            : {}),
          ...(revisionBoundaryNeedsFactReplan
            ? {
                foundationAuditState: {
                  ...revisionState!,
                  status: 'rebuilding_facts' as const,
                },
              }
            : {}),
          ...(run.phase === 'IMPLEMENTATION' && run.activeTaskId
            ? {
                activeTaskId: undefined,
                tasks: run.tasks.map(task =>
                  task.id === run.activeTaskId && task.status === 'running'
                    ? { ...task, status: 'pending' as const }
                    : task,
                ),
              }
            : {}),
          blockedReason: preserveFoundationActionableState
            ? run.blockedReason
            : undefined,
          updatedAt: timestamp(),
        }
      }
      break
    default:
      return event satisfies never
  }
  return assertDeliveryRunInvariants(next)
}
