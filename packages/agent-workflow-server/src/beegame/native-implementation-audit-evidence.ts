import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { IMPLEMENTATION_AUDITOR_AGENT_TYPE } from './delivery-validation-agents'
import { readAcceptanceChecklistIds } from './document-readiness-audit'
import { digestWorkspace } from './native-acceptance-evidence'
import {
  parseNativeBackgroundTaskLaunch,
} from './native-background-task-output'
import {
  parseNativeTerminalTaskNotification,
  type BeeGameNativeTaskNotification,
} from './native-task-notification'
import {
  hasCompletedNativeDeliveryContract,
  recordNativeDeliveryContractForTest,
} from './native-tool-provenance'
import { materializeFindings, reconcileFindings, type CanonicalFinding } from './finding-lifecycle'

export type NativeImplementationAuditStatus = 'passed' | 'failed' | 'blocked'

type NativeImplementationAuditFact = {
  source: string
  detail: string
}

type NativeImplementationAuditReport = {
  auditorId: string
  status: NativeImplementationAuditStatus
  summary: string
  auditedChecklistIds: string[]
  auditedImportIds: string[]
  auditedCompositionIds: string[]
  evidence: NativeImplementationAuditFact[]
  findings: NativeImplementationAuditFact[]
}

type NativeImplementationAuditDispatch = {
  version: 3
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeImplementationAuditBackgroundTask = {
  version: 3
  kind: 'background-task'
  sessionId: string
  turnId?: string
  taskId: string
  toolUseID: string
  auditorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeImplementationAuditTerminal = {
  version: 3
  kind: 'terminal'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  createdAt: string
}

type NativeImplementationAuditInterruption = {
  version: 3
  kind: 'interruption'
  sessionId: string
  toolUseID: string
  auditorId: string
  reason: 'session_recovered' | 'session_stopped'
  createdAt: string
}

type NativeImplementationAuditInvalidResult = {
  version: 3
  kind: 'invalid-result'
  sessionId: string
  toolUseID: string
  auditorId: string
  reason: string
  createdAt: string
}

export type NativeImplementationAuditEvidence = {
  version: 3
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  status: NativeImplementationAuditStatus
  summary: string
  auditedChecklistIds: string[]
  auditedImportIds: string[]
  auditedCompositionIds: string[]
  evidence: NativeImplementationAuditFact[]
  findings: CanonicalFinding[]
  reportDigest: string
  workspaceDigest: string
  startedAt: string
  createdAt: string
}

type NativeImplementationAuditObservation =
  | NativeImplementationAuditDispatch
  | NativeImplementationAuditBackgroundTask
  | NativeImplementationAuditTerminal
  | NativeImplementationAuditInterruption
  | NativeImplementationAuditInvalidResult
  | NativeImplementationAuditEvidence

/**
 * Passively records the native Implementation Auditor lifecycle. It never
 * starts, resumes, retries, or otherwise controls the Agent.
 */
export function observeNativeImplementationAuditToolEvent(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  eventType: string
  payload?: unknown
  createdAt: Date
}): void {
  if (!isRecord(input.payload)) return
  if (input.eventType === 'system.status') {
    observeBackgroundStart(input as typeof input & { payload: Record<string, unknown> })
    return
  }
  if (stringValue(input.payload.toolName) !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  if (stringValue(toolInput.subagent_type) !== IMPLEMENTATION_AUDITOR_AGENT_TYPE) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    const workspaceDigest = digestWorkspace(input.workspacePath)
    const observations = readObservations(input.dataRoot, input.sessionId)
    const duplicateActiveAudit = observations.some(observation =>
      observation.kind === 'dispatch' &&
      observation.workspaceDigest === workspaceDigest &&
      !isClosed(observations, observation.toolUseID)
    )
    if (duplicateActiveAudit) return
    appendObservation(input.dataRoot, input.sessionId, {
      version: 3,
      kind: 'dispatch',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolUseID,
      auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
      workspaceDigest,
      createdAt: input.createdAt.toISOString(),
    })
    return
  }
  if (input.eventType !== 'tool.completed') return
  const dispatch = findDispatch(input.dataRoot, input.sessionId, toolUseID)
  if (!dispatch) return
  const nativeResult = stringValue(input.payload.nativeResult)
  const output = nativeResult || stringValue(input.payload.output)
  const backgroundLaunch = parseNativeBackgroundTaskLaunch(output)
  if (backgroundLaunch) {
    appendBackgroundTask(input, dispatch, backgroundLaunch.taskId)
    return
  }
  appendTerminal(input, toolUseID, 'completed')
  const report = parseReport(output, input.workspacePath, Boolean(nativeResult))
  if (!report) {
    appendInvalidResult(input, toolUseID, 'terminal_result_invalid')
    return
  }
  if (!hasCompletedNativeDeliveryContract({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: dispatch.toolUseID,
  })) {
    appendInvalidResult(input, toolUseID, 'delivery_contract_not_observed')
    return
  }
  appendResult(input, dispatch, report)
}

/** Passively persists a native terminal background notification. */
export function observeNativeImplementationAuditTaskNotification(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  notification: BeeGameNativeTaskNotification
  createdAt: Date
}): void {
  const terminal = parseNativeTerminalTaskNotification(input.notification)
  if (!terminal?.toolUseId) return
  const observations = readObservations(input.dataRoot, input.sessionId)
  if (observations.some(item =>
    item.kind === 'result' && item.toolUseID === terminal.toolUseId
  )) return
  const dispatch = findDispatch(input.dataRoot, input.sessionId, terminal.toolUseId)
  if (!dispatch) return
  appendTerminal(input, terminal.toolUseId, terminal.status)
  if (terminal.status !== 'completed') {
    appendInvalidResult(input, terminal.toolUseId, `native_task_${terminal.status}`)
    return
  }
  if (!terminal.result) {
    appendInvalidResult(input, terminal.toolUseId, 'terminal_result_missing')
    return
  }
  const report = parseReport(terminal.result, input.workspacePath, true)
  if (!report) {
    appendInvalidResult(input, terminal.toolUseId, 'terminal_result_invalid')
    return
  }
  if (!hasCompletedNativeDeliveryContract({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: dispatch.toolUseID,
  })) {
    appendInvalidResult(input, terminal.toolUseId, 'delivery_contract_not_observed')
    return
  }
  appendResult(input, dispatch, report)
}

/** Records only that the native worker which owned an unfinished audit ended. */
export function interruptUnfinishedNativeImplementationAudits(input: {
  dataRoot: string
  sessionId: string
  reason: NativeImplementationAuditInterruption['reason']
  createdAt: Date
}): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  for (const dispatch of observations.filter(
    (item): item is NativeImplementationAuditDispatch => item.kind === 'dispatch',
  )) {
    if (isClosed(observations, dispatch.toolUseID)) continue
    appendObservation(input.dataRoot, input.sessionId, {
      version: 3,
      kind: 'interruption',
      sessionId: input.sessionId,
      toolUseID: dispatch.toolUseID,
      auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
      reason: input.reason,
      createdAt: input.createdAt.toISOString(),
    })
  }
}

export function getObservedNativeImplementationAudit(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'running'; toolUseID: string; workspaceDigest: string; createdAt: string }
  | { state: 'interrupted'; toolUseID: string; reason: NativeImplementationAuditInterruption['reason']; createdAt: string }
  | { state: 'invalid'; toolUseID: string; reason: string; createdAt: string }
  | { state: 'stale'; evidence: NativeImplementationAuditEvidence }
  | { state: 'current'; evidence: NativeImplementationAuditEvidence } {
  const workspaceDigest = digestWorkspace(input.workspacePath)
  const observations = readObservations(input.dataRoot, input.sessionId)
  const running = observations.filter(
    (item): item is NativeImplementationAuditDispatch =>
      item.kind === 'dispatch' &&
      item.workspaceDigest === workspaceDigest &&
      !isClosed(observations, item.toolUseID),
  ).at(-1)
  if (running) return {
    state: 'running',
    toolUseID: running.toolUseID,
    workspaceDigest: running.workspaceDigest,
    createdAt: running.createdAt,
  }
  const latest = observations.filter(
    (item): item is NativeImplementationAuditEvidence => item.kind === 'result',
  ).at(-1)
  if (!latest) {
    const invalid = observations.filter(
      (item): item is NativeImplementationAuditInvalidResult =>
        item.kind === 'invalid-result',
    ).at(-1)
    if (invalid) return {
      state: 'invalid',
      toolUseID: invalid.toolUseID,
      reason: invalid.reason,
      createdAt: invalid.createdAt,
    }
    const interrupted = observations.filter(
      (item): item is NativeImplementationAuditInterruption =>
        item.kind === 'interruption',
    ).at(-1)
    if (interrupted) return {
      state: 'interrupted',
      toolUseID: interrupted.toolUseID,
      reason: interrupted.reason,
      createdAt: interrupted.createdAt,
    }
    return { state: 'missing' }
  }
  return latest.workspaceDigest === workspaceDigest
    ? { state: 'current', evidence: latest }
    : { state: 'stale', evidence: latest }
}

function appendInvalidResult(
  input: { dataRoot: string; sessionId: string; createdAt: Date },
  toolUseID: string,
  reason: string,
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  if (observations.some(item =>
    item.kind === 'invalid-result' && item.toolUseID === toolUseID
  )) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'invalid-result',
    sessionId: input.sessionId,
    toolUseID,
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    reason,
    createdAt: input.createdAt.toISOString(),
  })
}

function isClosed(
  observations: NativeImplementationAuditObservation[],
  toolUseID: string,
): boolean {
  return observations.some(item =>
    item.toolUseID === toolUseID &&
    (item.kind === 'terminal' ||
      item.kind === 'result' ||
      item.kind === 'interruption' ||
      item.kind === 'invalid-result')
  )
}

export function recordNativeImplementationAuditReportForTest(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  report: unknown
}): void {
  const toolUseID = `test-implementation-auditor-tool-use-${nextTestAuditSequence++}`
  const payload = {
    toolName: 'Agent',
    toolUseID,
    input: { subagent_type: IMPLEMENTATION_AUDITOR_AGENT_TYPE },
  }
  observeNativeImplementationAuditToolEvent({
    ...input,
    eventType: 'tool.started',
    payload,
    createdAt: new Date(),
  })
  recordNativeDeliveryContractForTest({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: toolUseID,
  })
  observeNativeImplementationAuditToolEvent({
    ...input,
    eventType: 'tool.completed',
    payload: { ...payload, output: JSON.stringify(input.report) },
    createdAt: new Date(),
  })
}

let nextTestAuditSequence = 1

function observeBackgroundStart(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  payload: Record<string, unknown>
  createdAt: Date
}): void {
  if (stringValue(input.payload.subtype) !== 'task_started') return
  const taskId = stringValue(input.payload.task_id)
  const toolUseID = stringValue(input.payload.tool_use_id)
  if (!taskId || !toolUseID) return
  const dispatch = findDispatch(input.dataRoot, input.sessionId, toolUseID)
  if (dispatch) appendBackgroundTask(input, dispatch, taskId)
}

function appendBackgroundTask(
  input: { dataRoot: string; sessionId: string; turnId?: string; createdAt: Date },
  dispatch: NativeImplementationAuditDispatch,
  taskId: string,
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  if (observations.some(item =>
    item.kind === 'background-task' &&
    item.taskId === taskId &&
    item.toolUseID === dispatch.toolUseID
  )) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'background-task',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    taskId,
    toolUseID: dispatch.toolUseID,
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    workspaceDigest: dispatch.workspaceDigest,
    createdAt: input.createdAt.toISOString(),
  })
}

function appendTerminal(
  input: { dataRoot: string; sessionId: string; turnId?: string; createdAt: Date },
  toolUseID: string,
  status: NativeImplementationAuditTerminal['status'],
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  if (observations.some(item =>
    item.kind === 'terminal' && item.toolUseID === toolUseID
  )) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'terminal',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    status,
    createdAt: input.createdAt.toISOString(),
  })
}

function appendResult(
  input: { dataRoot: string; sessionId: string; turnId?: string; createdAt: Date },
  dispatch: NativeImplementationAuditDispatch,
  report: NativeImplementationAuditReport,
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  if (observations.some(item =>
    item.kind === 'result' && item.toolUseID === dispatch.toolUseID
  )) return
  const materializedFindings = materializeFindings({
    stream: 'implementation-audit',
    revision: dispatch.workspaceDigest,
    observedAt: input.createdAt.toISOString(),
    findings: report.findings,
  })
  const previousFindings = observations
    .findLast((observation): observation is NativeImplementationAuditEvidence => observation.kind === 'result')
    ?.findings ?? []
  const persistedFindings = reconcileFindings({
    previous: previousFindings.filter(finding => typeof finding.id === 'string'),
    current: materializedFindings,
    observedAt: input.createdAt.toISOString(),
    revision: dispatch.workspaceDigest,
  })
  const persistedReport = {
    ...report,
    findings: persistedFindings,
  }
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID: dispatch.toolUseID,
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    status: report.status,
    summary: report.summary,
    auditedChecklistIds: report.auditedChecklistIds,
    auditedImportIds: report.auditedImportIds,
    auditedCompositionIds: report.auditedCompositionIds,
    evidence: report.evidence,
    findings: persistedFindings,
    reportDigest: createHash('sha256').update(stableJson(persistedReport)).digest('hex'),
    workspaceDigest: dispatch.workspaceDigest,
    startedAt: dispatch.createdAt,
    createdAt: input.createdAt.toISOString(),
  })
}

function findDispatch(
  dataRoot: string,
  sessionId: string,
  toolUseID: string,
): NativeImplementationAuditDispatch | undefined {
  return readObservations(dataRoot, sessionId).findLast(
    (item): item is NativeImplementationAuditDispatch =>
      item.kind === 'dispatch' && item.toolUseID === toolUseID,
  )
}

function parseReport(
  source: string,
  workspacePath: string,
  allowNativePreface = false,
): NativeImplementationAuditReport | undefined {
  const value = parseTerminalJsonObject(source, allowNativePreface)
  if (!value || stringValue(value.auditorId) !== IMPLEMENTATION_AUDITOR_AGENT_TYPE) return
  const status = stringValue(value.status)
  const summary = stringValue(value.summary)
  if (
    (status !== 'passed' && status !== 'failed' && status !== 'blocked') ||
    !summary ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.findings)
  ) return
  const evidence = value.evidence.flatMap(parseFact)
  const findings = value.findings.flatMap(parseFact)
  const auditedChecklistIds = uniqueStrings(value.auditedChecklistIds)
  const auditedImportIds = uniqueStrings(value.auditedImportIds)
  const auditedCompositionIds = uniqueStrings(value.auditedCompositionIds)
  if (evidence.length !== value.evidence.length || findings.length !== value.findings.length) return
  if (status === 'passed' && (evidence.length === 0 || findings.length > 0)) return
  if (status === 'passed' && !sameIdentifiers(auditedChecklistIds, readAcceptanceChecklistIds(workspacePath))) return
  const assetContract = auditAssetContract(workspacePath)
  if (status === 'passed' && !sameIdentifiers(
    auditedImportIds,
    assetContract.imports?.map(item => item.id) ?? [],
  )) return
  if (status === 'passed' && !sameIdentifiers(
    auditedCompositionIds,
    assetContract.compositions.map(item => item.id),
  )) return
  if (status !== 'passed' && findings.length === 0) return
  return {
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    status,
    summary,
    auditedChecklistIds,
    auditedImportIds,
    auditedCompositionIds,
    evidence,
    findings,
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) return []
  return [...new Set(value.map(item => (item as string).trim()))]
}

function sameIdentifiers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every(identifier => actual.includes(identifier))
}

function parseFact(value: unknown): NativeImplementationAuditFact[] {
  if (!isRecord(value)) return []
  const source = stringValue(value.source)
  const detail = stringValue(value.detail)
  return source && detail ? [{ source, detail }] : []
}

function parseTerminalJsonObject(
  source: string,
  allowNativePreface: boolean,
): Record<string, unknown> | undefined {
  const value = source.trim()
  if (!value.endsWith('}')) return
  if (!allowNativePreface && !value.startsWith('{')) return
  if (value.startsWith('{')) return parseJsonObject(value)
  for (
    let index = value.lastIndexOf('{');
    index >= 0;
    index = value.lastIndexOf('{', index - 1)
  ) {
    const parsed = parseJsonObject(value.slice(index))
    if (parsed) return parsed
  }
}

function parseJsonObject(source: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(source) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function readObservations(
  dataRoot: string,
  sessionId: string,
): NativeImplementationAuditObservation[] {
  const path = evidencePath(dataRoot, sessionId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      const value = JSON.parse(line) as NativeImplementationAuditObservation
      return value.version === 3 &&
        value.sessionId === sessionId &&
        value.auditorId === IMPLEMENTATION_AUDITOR_AGENT_TYPE
        ? [value]
        : []
    } catch {
      return []
    }
  })
}

function appendObservation(
  dataRoot: string,
  sessionId: string,
  observation: NativeImplementationAuditObservation,
): void {
  const path = evidencePath(dataRoot, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function evidencePath(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'native-implementation-audit-evidence', `${sessionId}.jsonl`)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
