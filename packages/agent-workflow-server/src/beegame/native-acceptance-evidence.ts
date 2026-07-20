import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'
import { readAcceptanceChecklistIds } from './document-readiness-audit'
import {
  parseNativeBackgroundTaskLaunch,
  parseNativeCompletedTaskOutput,
} from './native-background-task-output'
import {
  parseNativeTerminalTaskNotification,
  type BeeGameNativeTaskNotification,
} from './native-task-notification'
import {
  getNativeValidatorToolCapabilities,
  recordNativeValidatorToolCapabilitiesForTest,
} from './native-tool-provenance'

type NativeAcceptanceResult = 'passed' | 'failed' | 'blocked'
type NativeAcceptanceEvidenceKind =
  | 'document'
  | 'build'
  | 'test'
  | 'runtime'
  | 'asset'
  | 'skill'

type NativeAcceptanceReportEvidence = {
  kind: NativeAcceptanceEvidenceKind
  source: string
  result: NativeAcceptanceResult
  detail: string
}

type NativeAcceptanceReportFinding = {
  source: string
  detail: string
}

type NativeAcceptanceReport = {
  validatorId: string
  status: NativeAcceptanceResult
  summary: string
  validatedChecklistIds: string[]
  evidence: NativeAcceptanceReportEvidence[]
  findings: NativeAcceptanceReportFinding[]
}

type NativeAcceptanceDispatch = {
  version: 4
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeAcceptanceBackgroundTask = {
  version: 4
  kind: 'background-task'
  sessionId: string
  turnId?: string
  taskId: string
  toolUseID: string
  validatorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeAcceptanceTerminal = {
  version: 4
  kind: 'terminal'
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  createdAt: string
}

export type NativeAcceptanceEvidence = {
  version: 4
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  status: NativeAcceptanceResult
  summary: string
  validatedChecklistIds: string[]
  reportDigest: string
  workspaceDigest: string
  startedAt: string
  evidence: NativeAcceptanceReportEvidence[]
  findings: NativeAcceptanceReportFinding[]
  createdAt: string
}

type NativeAcceptanceObservation =
  | NativeAcceptanceDispatch
  | NativeAcceptanceBackgroundTask
  | NativeAcceptanceTerminal
  | NativeAcceptanceEvidence

const REQUIRED_PASSING_EVIDENCE = new Set<NativeAcceptanceEvidenceKind>([
  'document',
  'build',
  'test',
  'runtime',
  'asset',
  'skill',
])

/**
 * Passively records native Validator dispatch and completion events. The
 * workspace revision is frozen when the Agent tool starts, never when its
 * result happens to arrive. This prevents a validator running against an old
 * snapshot from accepting files that changed while it was in flight.
 */
export function observeNativeAcceptanceToolEvent(input: {
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
    observeNativeBackgroundAcceptanceEvent({ ...input, payload: input.payload })
    return
  }

  if (input.eventType === 'tool.completed') {
    const taskOutput = parseNativeCompletedTaskOutput(input.payload)
    if (taskOutput) {
      observeLinkedTaskOutput(input, taskOutput)
      return
    }
  }

  const toolName = stringValue(input.payload.toolName)
  if (toolName !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  const validatorId = stringValue(toolInput.subagent_type)
  if (validatorId !== DELIVERY_VALIDATOR_AGENT_TYPES[0]) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    appendObservation(input.dataRoot, input.sessionId, {
      version: 4,
      kind: 'dispatch',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolUseID,
      validatorId,
      workspaceDigest: digestWorkspace(input.workspacePath),
      createdAt: input.createdAt.toISOString(),
    })
    return
  }
  if (input.eventType !== 'tool.completed') return

  const dispatch = readObservations(input.dataRoot, input.sessionId)
    .findLast(observation =>
      observation.kind === 'dispatch' &&
      observation.toolUseID === toolUseID &&
      observation.validatorId === validatorId
    )
  if (!dispatch || dispatch.kind !== 'dispatch') return

  const nativeResult = stringValue(input.payload.nativeResult)
  const output = nativeResult || stringValue(input.payload.output)
  const backgroundLaunch = parseNativeBackgroundTaskLaunch(output)
  if (backgroundLaunch) {
    if (!readObservations(input.dataRoot, input.sessionId).some(observation =>
      observation.kind === 'background-task' &&
      observation.taskId === backgroundLaunch.taskId &&
      observation.toolUseID === toolUseID
    )) {
      appendObservation(input.dataRoot, input.sessionId, {
        version: 4,
        kind: 'background-task',
        sessionId: input.sessionId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        taskId: backgroundLaunch.taskId,
        toolUseID,
        validatorId,
        workspaceDigest: dispatch.workspaceDigest,
        createdAt: input.createdAt.toISOString(),
      })
    }
    return
  }

  appendTerminal(input, toolUseID, 'completed')

  const report = parseNativeAcceptanceReport(
    output,
    validatorId,
    input.workspacePath,
    Boolean(nativeResult),
    {
      dataRoot: input.dataRoot,
      sessionId: input.sessionId,
      validatorToolUseID: toolUseID,
    },
  )
  if (!report) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 4,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId,
    status: report.status,
    summary: report.summary,
    validatedChecklistIds: report.validatedChecklistIds,
    reportDigest: digestJson(report),
    workspaceDigest: dispatch.workspaceDigest,
    startedAt: dispatch.createdAt,
    evidence: report.evidence,
    findings: report.findings,
    createdAt: input.createdAt.toISOString(),
  })
}

function observeLinkedTaskOutput(
  input: {
    dataRoot: string
    sessionId: string
    workspacePath: string
    turnId?: string
    createdAt: Date
  },
  taskOutput: {
    taskId: string
    status: 'completed' | 'failed' | 'stopped' | 'killed'
    result?: string
  },
): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  const backgroundTask = observations.findLast(observation =>
    observation.kind === 'background-task' &&
    observation.taskId === taskOutput.taskId
  )
  if (!backgroundTask || backgroundTask.kind !== 'background-task') return
  if (observations.some(observation =>
    observation.kind === 'result' &&
    observation.toolUseID === backgroundTask.toolUseID
  )) return
  const dispatch = observations.findLast(observation =>
    observation.kind === 'dispatch' &&
    observation.toolUseID === backgroundTask.toolUseID
  )
  if (!dispatch || dispatch.kind !== 'dispatch') return
  appendTerminal(input, dispatch.toolUseID, taskOutput.status)
  if (taskOutput.status !== 'completed' || !taskOutput.result) return
  const report = parseNativeAcceptanceReport(
    taskOutput.result,
    dispatch.validatorId,
    input.workspacePath,
    true,
    {
      dataRoot: input.dataRoot,
      sessionId: input.sessionId,
      validatorToolUseID: dispatch.toolUseID,
    },
  )
  if (!report) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 4,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID: dispatch.toolUseID,
    validatorId: dispatch.validatorId,
    status: report.status,
    summary: report.summary,
    validatedChecklistIds: report.validatedChecklistIds,
    reportDigest: digestJson(report),
    workspaceDigest: dispatch.workspaceDigest,
    startedAt: dispatch.createdAt,
    evidence: report.evidence,
    findings: report.findings,
    createdAt: input.createdAt.toISOString(),
  })
}

function observeNativeBackgroundAcceptanceEvent(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: Date
}): void {
  const subtype = stringValue(input.payload.subtype)
  const taskId = stringValue(input.payload.task_id)
  const toolUseID = stringValue(input.payload.tool_use_id)
  if (!taskId || !toolUseID) return

  const observations = readObservations(input.dataRoot, input.sessionId)
  if (subtype === 'task_started') {
    if (observations.some(observation =>
      observation.kind === 'background-task' &&
      observation.taskId === taskId &&
      observation.toolUseID === toolUseID
    )) return
    const dispatch = observations.findLast(observation =>
      observation.kind === 'dispatch' && observation.toolUseID === toolUseID
    )
    if (!dispatch || dispatch.kind !== 'dispatch') return
    appendObservation(input.dataRoot, input.sessionId, {
      version: 4,
      kind: 'background-task',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      taskId,
      toolUseID,
      validatorId: dispatch.validatorId,
      workspaceDigest: dispatch.workspaceDigest,
      createdAt: input.createdAt.toISOString(),
    })
    return
  }

  // Terminal task results arrive through the native queue callback. SDK
  // status events are lifecycle metadata only and never trigger file reads.
}

/** Passively persists the terminal result already emitted by Claude Code. */
export function observeNativeAcceptanceTaskNotification(input: {
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
  if (observations.some(observation =>
    observation.kind === 'result' && observation.toolUseID === terminal.toolUseId
  )) return
  const dispatch = observations.findLast(observation =>
    observation.kind === 'dispatch' && observation.toolUseID === terminal.toolUseId
  )
  if (!dispatch || dispatch.kind !== 'dispatch') return
  appendTerminal(input, terminal.toolUseId, terminal.status)
  if (terminal.status !== 'completed' || !terminal.result) return
  const report = parseNativeAcceptanceReport(
    terminal.result,
    dispatch.validatorId,
    input.workspacePath,
    true,
    {
      dataRoot: input.dataRoot,
      sessionId: input.sessionId,
      validatorToolUseID: dispatch.toolUseID,
    },
  )
  if (!report) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 4,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID: terminal.toolUseId,
    validatorId: dispatch.validatorId,
    status: report.status,
    summary: report.summary,
    validatedChecklistIds: report.validatedChecklistIds,
    reportDigest: digestJson(report),
    workspaceDigest: dispatch.workspaceDigest,
    startedAt: dispatch.createdAt,
    evidence: report.evidence,
    findings: report.findings,
    createdAt: input.createdAt.toISOString(),
  })
}

function appendTerminal(
  input: { dataRoot: string; sessionId: string; turnId?: string; createdAt: Date },
  toolUseID: string,
  status: NativeAcceptanceTerminal['status'],
): void {
  if (readObservations(input.dataRoot, input.sessionId).some(observation =>
    observation.kind === 'terminal' && observation.toolUseID === toolUseID
  )) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 4,
    kind: 'terminal',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId: DELIVERY_VALIDATOR_AGENT_TYPES[0],
    status,
    createdAt: input.createdAt.toISOString(),
  })
}

export function getObservedNativeAcceptance(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'running'; toolUseID: string; workspaceDigest: string; createdAt: string }
  | { state: 'stale'; evidence: NativeAcceptanceEvidence }
  | { state: 'current'; evidence: NativeAcceptanceEvidence } {
  const workspaceDigest = digestWorkspace(input.workspacePath)
  const observations = readObservations(input.dataRoot, input.sessionId)
  const running = observations
    .filter((observation): observation is NativeAcceptanceDispatch =>
      observation.kind === 'dispatch' &&
      observation.workspaceDigest === workspaceDigest &&
      !observations.some(result =>
        result.kind === 'result' && result.toolUseID === observation.toolUseID
      ) &&
      !observations.some(terminal =>
        terminal.kind === 'terminal' && terminal.toolUseID === observation.toolUseID
      )
    )
    .at(-1)
  if (running) return {
    state: 'running',
    toolUseID: running.toolUseID,
    workspaceDigest: running.workspaceDigest,
    createdAt: running.createdAt,
  }
  const latest = observations
    .filter((observation): observation is NativeAcceptanceEvidence =>
      observation.kind === 'result'
    )
    .at(-1)
  if (!latest) return { state: 'missing' }
  return latest.workspaceDigest === workspaceDigest
    ? { state: 'current', evidence: latest }
    : { state: 'stale', evidence: latest }
}

export function recordNativeAcceptanceReportForTest(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  report: unknown
}): void {
  const toolUseID = 'test-validator-tool-use'
  const base = {
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    payload: {
      toolName: 'Agent',
      toolUseID,
      input: { subagent_type: DELIVERY_VALIDATOR_AGENT_TYPES[0] },
    },
  }
  recordNativeValidatorToolCapabilitiesForTest({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    validatorToolUseID: toolUseID,
  })
  observeNativeAcceptanceToolEvent({
    ...base,
    eventType: 'tool.started',
    createdAt: new Date(),
  })
  observeNativeAcceptanceToolEvent({
    ...base,
    eventType: 'tool.completed',
    payload: { ...base.payload, output: JSON.stringify(input.report) },
    createdAt: new Date(),
  })
}

export function digestWorkspace(workspacePath: string): string {
  const workspace = resolve(workspacePath)
  const ignored = new Set([
    '.git', '.cache', '.vite', '.beegame-attachments', 'build', 'coverage',
    'dist', 'logs', 'node_modules', 'out', 'transcripts',
  ])
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (
        entry.isFile() &&
        relative(workspace, path).split('\\').join('/') !==
          'docs/acceptance/validation-report.json'
      ) files.push(path)
    }
  }
  visit(workspace)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(workspace, file).split('\\').join('/'))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

function parseNativeAcceptanceReport(
  text: string,
  validatorId: string,
  workspacePath: string,
  allowNativePreface = false,
  provenance?: {
    dataRoot: string
    sessionId: string
    validatorToolUseID: string
  },
): NativeAcceptanceReport | undefined {
  const report = parseTerminalJsonObject(text, allowNativePreface)
  if (!report || stringValue(report.validatorId) !== validatorId) return undefined
  const status = stringValue(report.status)
  if (status !== 'passed' && status !== 'failed' && status !== 'blocked') {
    return undefined
  }
  const summary = stringValue(report.summary)
  if (!summary || !Array.isArray(report.evidence) || !Array.isArray(report.findings)) {
    return undefined
  }
  const evidence = report.evidence.flatMap(parseReportEvidence)
  const findings = report.findings.flatMap(parseReportFinding)
  const validatedChecklistIds = uniqueStrings(report.validatedChecklistIds)
  if (evidence.length !== report.evidence.length || findings.length !== report.findings.length) {
    return undefined
  }

  if (status === 'passed') {
    if (evidence.some(item => item.result !== 'passed')) {
      return undefined
    }
    const kinds = new Set(evidence.map(item => item.kind))
    if ([...REQUIRED_PASSING_EVIDENCE].some(kind => !kinds.has(kind))) {
      return undefined
    }
    if (!provenance) return undefined
    if (!sameIdentifiers(validatedChecklistIds, readAcceptanceChecklistIds(workspacePath))) return undefined
    const capabilities = getNativeValidatorToolCapabilities(provenance)
    // A source read or a model-authored label is not execution evidence.
    // Build/test require an actually completed executable tool, Skill evidence
    // requires an observed native Skill call, and runtime evidence requires a
    // target-native capability invocation rather than source inspection.
    if (!capabilities.executable || !capabilities.skill || !capabilities.runtime) {
      return undefined
    }
  } else {
    if (findings.length === 0 || !evidence.some(item => item.result === status)) {
      return undefined
    }
  }
  return { validatorId, status, summary, validatedChecklistIds, evidence, findings }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) return []
  return [...new Set(value.map(item => (item as string).trim()))]
}

function sameIdentifiers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every(identifier => actual.includes(identifier))
}

function parseReportEvidence(value: unknown): NativeAcceptanceReportEvidence[] {
  if (!isRecord(value)) return []
  const kind = stringValue(value.kind)
  const result = stringValue(value.result)
  const source = stringValue(value.source)
  const detail = stringValue(value.detail)
  if (
    !isNativeAcceptanceEvidenceKind(kind) ||
    (result !== 'passed' && result !== 'failed' && result !== 'blocked') ||
    !source ||
    !detail
  ) return []
  return [{ kind, result, source, detail }]
}

function parseReportFinding(value: unknown): NativeAcceptanceReportFinding[] {
  if (!isRecord(value)) return []
  const source = stringValue(value.source)
  const detail = stringValue(value.detail)
  return source && detail ? [{ source, detail }] : []
}

function isNativeAcceptanceEvidenceKind(
  value: string,
): value is NativeAcceptanceEvidenceKind {
  return REQUIRED_PASSING_EVIDENCE.has(value as NativeAcceptanceEvidenceKind)
}

function readObservations(
  dataRoot: string,
  sessionId: string,
): NativeAcceptanceObservation[] {
  const path = evidencePath(dataRoot, sessionId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line): NativeAcceptanceObservation[] => {
      if (!line.trim()) return []
      try {
        const observation = JSON.parse(line) as NativeAcceptanceObservation
        return observation.version === 4 && observation.sessionId === sessionId &&
          observation.validatorId === DELIVERY_VALIDATOR_AGENT_TYPES[0] &&
          (
            observation.kind === 'dispatch' ||
            observation.kind === 'background-task' ||
            observation.kind === 'terminal' ||
            observation.kind === 'result'
          )
          ? [observation]
          : []
      } catch {
        return []
      }
    })
}

function appendObservation(
  dataRoot: string,
  sessionId: string,
  observation: NativeAcceptanceObservation,
): void {
  const path = evidencePath(dataRoot, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function evidencePath(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'native-acceptance-evidence', `${sessionId}.jsonl`)
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function parseTerminalJsonObject(
  text: string,
  allowNativePreface = false,
): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.endsWith('}')) return undefined
  if (allowNativePreface && !trimmed.startsWith('{')) {
    for (let start = trimmed.lastIndexOf('{'); start >= 0; start = trimmed.lastIndexOf('{', start - 1)) {
      const parsed = parseJsonObject(trimmed.slice(start))
      if (parsed) return parsed
    }
    return undefined
  }
  if (!trimmed.startsWith('{')) return undefined
  return parseJsonObject(trimmed)
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
