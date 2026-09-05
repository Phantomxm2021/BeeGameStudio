import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DispatchRecord,
  type FoundationDocumentPath,
  type WorkflowUsage,
} from '../../types'
import {
  loadFoundationAuditArtifacts,
  writeFoundationFactReceipt,
} from '../../foundation-audit-artifacts'
import {
  validateFoundationFactResults,
  type FoundationFactPacket,
} from '../../foundation-fact-extraction'
import {
  admitFoundationFactTerminal,
  digestFoundationFactTerminal,
  foundationFactTasksComplete,
  type FoundationFactTask,
  type FoundationFactTaskCollection,
  type FoundationFactTerminal,
} from '../../foundation-fact-runtime'
import { projectTaskTerminalEvidence } from '../../task-terminal-evidence'

/** Task fields consumed by terminal admission; dispatch evidence is copied. */
export type FoundationReviewFactTerminalTaskSnapshot = Readonly<{
  taskId: string
  kind: 'document-facts'
  revision: string
  packetDigest: string
  factKeyCount: number
  modelTier: 'fast'
  status: FoundationFactTask['status']
  attempt: number
  dispatch?: DispatchRecord
  attemptHistory?: DispatchRecord[]
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}>

/** Immutable Reviewer projection required to admit one fact terminal. */
export type FoundationReviewFactTerminalSnapshot = Readonly<{
  revision: string
  artifactRevision: string
  phase: 'DOCUMENT_REVIEW'
  status: string
  phaseStartedAt: string
  documentDigests: Readonly<Record<FoundationDocumentPath, string>>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  aggregateUsage?: WorkflowUsage
  tasks: readonly FoundationReviewFactTerminalTaskSnapshot[]
}>

export type FoundationReviewFactTerminalInput = Readonly<{
  workspacePath: string
  snapshot: FoundationReviewFactTerminalSnapshot
  targetTaskId: string
  record: DispatchRecord
  result: FoundationFactTerminal
  packet?: unknown
}>

export type FoundationReviewFactTerminalStatePatch = Readonly<{
  status: FoundationFactTaskCollection['status']
  tasks: readonly FoundationFactTask[]
  aggregateUsage: WorkflowUsage
}>

export type FoundationReviewFactTerminalResult = Readonly<{
  kind: 'replayed' | 'admitted' | 'facts-staged'
  idempotent: boolean
  accepted: boolean
  continueFacts: boolean
  terminalDigest: string
  eventType: 'foundation.fact.terminal.replayed' | 'foundation.fact.terminal.admitted' | 'foundation.fact.facts_staged'
  runStatus: 'running' | 'needs_action'
  statePatch?: FoundationReviewFactTerminalStatePatch
}>

const zeroUsage = (): WorkflowUsage => ({
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
})

function copyDispatch(dispatch: DispatchRecord): DispatchRecord {
  return {
    dispatchId: dispatch.dispatchId,
    workerType: dispatch.workerType,
    phase: dispatch.phase,
    ...(dispatch.taskId === undefined ? {} : { taskId: dispatch.taskId }),
    revision: dispatch.revision,
    status: dispatch.status,
    ...(dispatch.terminalEvidencePath === undefined ? {} : { terminalEvidencePath: dispatch.terminalEvidencePath }),
    ...(dispatch.failureReason === undefined ? {} : { failureReason: dispatch.failureReason }),
    ...(dispatch.request === undefined ? {} : { request: structuredClone(dispatch.request) }),
    ...(dispatch.terminalResult === undefined ? {} : { terminalResult: structuredClone(dispatch.terminalResult) }),
    ...(dispatch.startingUsage === undefined ? {} : { startingUsage: { ...dispatch.startingUsage } }),
    ...(dispatch.usage === undefined ? {} : { usage: { ...dispatch.usage } }),
    startedAt: dispatch.startedAt,
    ...(dispatch.finishedAt === undefined ? {} : { finishedAt: dispatch.finishedAt }),
  }
}

function copySnapshot(
  snapshot: FoundationReviewFactTerminalSnapshot,
): FoundationReviewFactTerminalSnapshot {
  return {
    revision: snapshot.revision,
    artifactRevision: snapshot.artifactRevision,
    phase: snapshot.phase,
    status: snapshot.status,
    phaseStartedAt: snapshot.phaseStartedAt,
    documentDigests: { ...snapshot.documentDigests },
    sectionIndexDigest: snapshot.sectionIndexDigest,
    sectionIndexPath: snapshot.sectionIndexPath,
    manifestPath: snapshot.manifestPath,
    aggregateUsage: snapshot.aggregateUsage ? { ...snapshot.aggregateUsage } : undefined,
    tasks: snapshot.tasks.map(task => ({
      taskId: task.taskId,
      kind: task.kind,
      revision: task.revision,
      packetDigest: task.packetDigest,
      factKeyCount: task.factKeyCount,
      modelTier: task.modelTier,
      status: task.status,
      attempt: task.attempt,
      dispatch: task.dispatch ? copyDispatch(task.dispatch) : undefined,
      attemptHistory: task.attemptHistory?.map(copyDispatch),
      terminalDigest: task.terminalDigest,
      receiptPath: task.receiptPath,
      receiptDigest: task.receiptDigest,
      usage: task.usage ? { ...task.usage } : undefined,
      durationMs: task.durationMs,
      failureReason: task.failureReason,
    })),
  }
}

function copyRecord(record: DispatchRecord): DispatchRecord {
  return copyDispatch(record)
}

function copyResult(result: FoundationFactTerminal): FoundationFactTerminal {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, structuredClone(value)]),
  ) as FoundationFactTerminal
}

function copyPacket(
  packet: unknown,
): unknown {
  return packet === undefined ? undefined : structuredClone(packet)
}

/** Copy the exact fact-task protocol projection consumed by terminal admission. */
export function projectFoundationFactTerminalTask(
  task: FoundationFactTask,
): FoundationReviewFactTerminalTaskSnapshot {
  if (task.kind !== 'document-facts')
    throw new Error('foundation fact terminal reached a non-fact task')
  return {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    packetDigest: task.packetDigest,
    factKeyCount: task.factKeyCount,
    modelTier: task.modelTier,
    status: task.status,
    attempt: task.attempt,
    ...(task.dispatch ? { dispatch: copyDispatch(task.dispatch) } : {}),
    ...(task.attemptHistory ? { attemptHistory: task.attemptHistory.map(copyDispatch) } : {}),
    ...(task.terminalDigest === undefined ? {} : { terminalDigest: task.terminalDigest }),
    ...(task.receiptPath === undefined ? {} : { receiptPath: task.receiptPath }),
    ...(task.receiptDigest === undefined ? {} : { receiptDigest: task.receiptDigest }),
    ...(task.usage ? { usage: { ...task.usage } } : {}),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.failureReason === undefined ? {} : { failureReason: task.failureReason }),
  }
}

function runtimeTask(task: FoundationReviewFactTerminalTaskSnapshot): FoundationFactTask {
  return {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    packetDigest: task.packetDigest,
    factKeyCount: task.factKeyCount,
    modelTier: task.modelTier,
    status: task.status,
    attempt: task.attempt,
    ...(task.dispatch ? { dispatch: copyDispatch(task.dispatch) } : {}),
    ...(task.attemptHistory ? { attemptHistory: task.attemptHistory.map(copyDispatch) } : {}),
    ...(task.terminalDigest === undefined ? {} : { terminalDigest: task.terminalDigest }),
    ...(task.receiptPath === undefined ? {} : { receiptPath: task.receiptPath }),
    ...(task.receiptDigest === undefined ? {} : { receiptDigest: task.receiptDigest }),
    ...(task.usage ? { usage: { ...task.usage } } : {}),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.failureReason === undefined ? {} : { failureReason: task.failureReason }),
  }
}

/**
 * Admit one document-facts terminal and prepare the narrow Reviewer state
 * patch. Locks, global run commits, event append and continuation are owned by
 * the controller adapter.
 */
export async function prepareFoundationFactTerminal(
  input: FoundationReviewFactTerminalInput,
): Promise<FoundationReviewFactTerminalResult> {
  const workspacePath = input.workspacePath
  const snapshot = copySnapshot(input.snapshot)
  const targetTaskId = input.targetTaskId
  const record = copyRecord(input.record)
  const result = copyResult(input.result)
  const packet = copyPacket(input.packet)
  const task = snapshot.tasks.find(candidate => candidate.taskId === targetTaskId)
  if (!task || !task.dispatch || task.dispatch.dispatchId !== record.dispatchId)
    return {
      kind: 'replayed',
      idempotent: false,
      accepted: false,
      continueFacts: false,
      terminalDigest: '',
      eventType: 'foundation.fact.terminal.replayed',
      runStatus: 'running',
    }
  if (task.kind !== 'document-facts')
    throw new Error('foundation fact terminal reached a non-fact task')

  const runtimeTasks = snapshot.tasks.map(task => runtimeTask(task))
  const terminalDigest = task.status === 'completed'
    ? digestFoundationFactTerminal(result)
    : undefined
  if (task.status === 'completed') {
    if (task.terminalDigest !== terminalDigest)
      throw new Error('conflicting foundation fact terminal replay')
    return {
      kind: 'replayed',
      idempotent: true,
      accepted: true,
      continueFacts: snapshot.status === 'facts_staged',
      terminalDigest: terminalDigest!,
      eventType: 'foundation.fact.terminal.replayed',
      runStatus: 'running',
    }
  }

  if (!packet || typeof packet !== 'object')
    throw new Error('foundation fact packet is missing from dispatch contract')
  const expectedState = {
    revision: snapshot.revision,
    status: snapshot.status,
    documentDigests: snapshot.documentDigests,
    sectionIndexDigest: snapshot.sectionIndexDigest,
    sectionIndexPath: snapshot.sectionIndexPath,
    manifestPath: snapshot.manifestPath,
  } as Parameters<typeof loadFoundationAuditArtifacts>[0]['expectedState']
  const artifacts = await loadFoundationAuditArtifacts({
    workspacePath,
    revision: snapshot.artifactRevision,
    expectedState,
  })
  if (!artifacts) throw new Error('foundation fact section index is unavailable')
  const documents = new Map(
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(async path =>
        [path, await readFile(join(workspacePath, path), 'utf8')] as const,
      ),
    ),
  )
  let validated: ReturnType<typeof validateFoundationFactResults>
  try {
    if (!Array.isArray((packet as { keys?: unknown }).keys) || (packet as { keys: unknown[] }).keys.length !== task.factKeyCount)
      throw new Error('foundation fact task key count does not match its immutable packet')
    validated = validateFoundationFactResults({
      packet: packet as FoundationFactPacket,
      expectedRevision: task.revision,
      documents,
      sectionIndex: artifacts.sectionIndex,
      results: result.results as never,
    })
  } catch (error) {
    const invalid = new Error(error instanceof Error ? error.message : 'foundation fact result is invalid')
    invalid.name = 'FoundationFactInvalidResultError'
    throw invalid
  }
  const runtimeState: FoundationFactTaskCollection = {
    revision: snapshot.revision,
    phaseStartedAt: snapshot.phaseStartedAt,
    status: snapshot.status === 'facts_staged' ? 'facts_staged' : 'extracting_facts',
    tasks: runtimeTasks,
    aggregateUsage: snapshot.aggregateUsage ?? zeroUsage(),
  }
  const admission = admitFoundationFactTerminal(runtimeState, {
    taskId: task.taskId,
    dispatchId: record.dispatchId,
    revision: result.revision,
    packetDigest: result.packetDigest,
    terminal: result,
    usage: record.usage ?? zeroUsage(),
    durationMs: Math.max(0, Date.parse(record.finishedAt ?? new Date().toISOString()) - Date.parse(record.startedAt)),
    now: new Date().toISOString(),
  })
  const dispatchRecord = record as DispatchRecord
  let tasks = admission.state.tasks.map(candidate =>
    candidate.taskId === task.taskId
      ? projectTaskTerminalEvidence(candidate, dispatchRecord)
      : candidate,
  )
  let status = admission.state.status
  const aggregateUsage = admission.state.aggregateUsage
  const admittedTask = admission.state.tasks.find(candidate => candidate.taskId === task.taskId)!
  if (admission.accepted && !admission.idempotent) {
    const receipt = await writeFoundationFactReceipt({
      workspacePath,
      revision: task.revision,
      receipt: {
        taskId: task.taskId,
        revision: task.revision,
        packetDigest: task.packetDigest,
        terminalDigest: admission.terminalDigest,
        normalizedFactDigest: validated.normalizedFactDigest,
        receipts: validated.receipts,
        facts: validated.facts,
        usage: admittedTask.usage,
        durationMs: admittedTask.durationMs ?? 0,
      },
    })
    tasks = tasks.map(candidate =>
      candidate.taskId === task.taskId
        ? { ...candidate, receiptPath: receipt.path, receiptDigest: receipt.digest }
        : candidate,
    )
  }
  const collectionAfterReceipt: FoundationFactTaskCollection = {
    ...admission.state,
    tasks: tasks.filter(candidate => candidate.kind === 'document-facts'),
  }
  if (foundationFactTasksComplete(collectionAfterReceipt)) {
    status = 'facts_staged'
    return {
      kind: 'facts-staged',
      idempotent: admission.idempotent,
      accepted: admission.accepted,
      continueFacts: true,
      terminalDigest: admission.terminalDigest,
      eventType: 'foundation.fact.facts_staged',
      runStatus: 'running',
      statePatch: { status, tasks, aggregateUsage },
    }
  }
  const runStatus = tasks.some(candidate => candidate.status === 'needs_action') ? 'needs_action' : 'running'
  return {
    kind: 'admitted',
    idempotent: admission.idempotent,
    accepted: admission.accepted,
    continueFacts: false,
    terminalDigest: admission.terminalDigest,
    eventType: admission.idempotent ? 'foundation.fact.terminal.replayed' : 'foundation.fact.terminal.admitted',
    runStatus,
    statePatch: { status, tasks, aggregateUsage },
  }
}
