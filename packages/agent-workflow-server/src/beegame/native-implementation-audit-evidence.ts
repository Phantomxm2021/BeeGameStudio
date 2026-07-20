import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IMPLEMENTATION_AUDITOR_AGENT_TYPE } from './delivery-validation-agents'
import { digestWorkspace } from './native-acceptance-evidence'
import {
  parseNativeBackgroundTaskLaunch,
  parseNativeCompletedTaskOutput,
} from './native-background-task-output'
import {
  parseNativeTerminalTaskNotification,
  type BeeGameNativeTaskNotification,
} from './native-task-notification'

export type NativeImplementationAuditStatus = 'passed' | 'failed' | 'blocked'

type NativeImplementationAuditFact = {
  source: string
  detail: string
}

type NativeImplementationAuditReport = {
  auditorId: string
  status: NativeImplementationAuditStatus
  summary: string
  evidence: NativeImplementationAuditFact[]
  findings: NativeImplementationAuditFact[]
}

type NativeImplementationAuditDispatch = {
  version: 1
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeImplementationAuditBackgroundTask = {
  version: 1
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
  version: 1
  kind: 'terminal'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  createdAt: string
}

export type NativeImplementationAuditEvidence = {
  version: 1
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  auditorId: string
  status: NativeImplementationAuditStatus
  summary: string
  evidence: NativeImplementationAuditFact[]
  findings: NativeImplementationAuditFact[]
  reportDigest: string
  workspaceDigest: string
  createdAt: string
}

type NativeImplementationAuditObservation =
  | NativeImplementationAuditDispatch
  | NativeImplementationAuditBackgroundTask
  | NativeImplementationAuditTerminal
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
  if (input.eventType === 'tool.completed') {
    const taskOutput = parseNativeCompletedTaskOutput(input.payload)
    if (taskOutput) {
      observeLinkedTaskOutput(input, taskOutput)
      return
    }
  }
  if (stringValue(input.payload.toolName) !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  if (stringValue(toolInput.subagent_type) !== IMPLEMENTATION_AUDITOR_AGENT_TYPE) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    appendObservation(input.dataRoot, input.sessionId, {
      version: 1,
      kind: 'dispatch',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolUseID,
      auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
      workspaceDigest: digestWorkspace(input.workspacePath),
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
  const report = parseReport(output, Boolean(nativeResult))
  if (report) appendResult(input, dispatch, report)
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
  if (terminal.status !== 'completed' || !terminal.result) return
  const report = parseReport(terminal.result, true)
  if (report) appendResult(input, dispatch, report)
}

export function getObservedNativeImplementationAudit(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'running'; toolUseID: string; workspaceDigest: string; createdAt: string }
  | { state: 'stale'; evidence: NativeImplementationAuditEvidence }
  | { state: 'current'; evidence: NativeImplementationAuditEvidence } {
  const workspaceDigest = digestWorkspace(input.workspacePath)
  const observations = readObservations(input.dataRoot, input.sessionId)
  const running = observations.filter(
    (item): item is NativeImplementationAuditDispatch =>
      item.kind === 'dispatch' &&
      item.workspaceDigest === workspaceDigest &&
      !observations.some(result =>
        result.kind === 'result' && result.toolUseID === item.toolUseID
      ) &&
      !observations.some(terminal =>
        terminal.kind === 'terminal' && terminal.toolUseID === item.toolUseID
      ),
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
  if (!latest) return { state: 'missing' }
  return latest.workspaceDigest === workspaceDigest
    ? { state: 'current', evidence: latest }
    : { state: 'stale', evidence: latest }
}

export function recordNativeImplementationAuditReportForTest(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  report: unknown
}): void {
  const toolUseID = 'test-implementation-auditor-tool-use'
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
  observeNativeImplementationAuditToolEvent({
    ...input,
    eventType: 'tool.completed',
    payload: { ...payload, output: JSON.stringify(input.report) },
    createdAt: new Date(),
  })
}

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

function observeLinkedTaskOutput(
  input: {
    dataRoot: string
    sessionId: string
    workspacePath: string
    turnId?: string
    createdAt: Date
  },
  output: {
    taskId: string
    status: 'completed' | 'failed' | 'stopped' | 'killed'
    result?: string
  },
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  const background = observations.findLast(item =>
    item.kind === 'background-task' && item.taskId === output.taskId
  )
  if (!background || background.kind !== 'background-task') return
  if (observations.some(item =>
    item.kind === 'result' && item.toolUseID === background.toolUseID
  )) return
  const dispatch = findDispatch(input.dataRoot, input.sessionId, background.toolUseID)
  if (!dispatch) return
  appendTerminal(input, dispatch.toolUseID, output.status)
  if (output.status !== 'completed' || !output.result) return
  const report = parseReport(output.result, true)
  if (report) appendResult(input, dispatch, report)
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
    version: 1,
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
    version: 1,
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
  appendObservation(input.dataRoot, input.sessionId, {
    version: 1,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID: dispatch.toolUseID,
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    status: report.status,
    summary: report.summary,
    evidence: report.evidence,
    findings: report.findings,
    reportDigest: createHash('sha256').update(stableJson(report)).digest('hex'),
    workspaceDigest: dispatch.workspaceDigest,
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
  if (evidence.length !== value.evidence.length || findings.length !== value.findings.length) return
  if (status === 'passed' && (evidence.length === 0 || findings.length > 0)) return
  if (status !== 'passed' && findings.length === 0) return
  return {
    auditorId: IMPLEMENTATION_AUDITOR_AGENT_TYPE,
    status,
    summary,
    evidence,
    findings,
  }
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
      return value.version === 1 &&
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
