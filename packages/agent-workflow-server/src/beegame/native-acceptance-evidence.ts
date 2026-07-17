import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'

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
  evidence: NativeAcceptanceReportEvidence[]
  findings: NativeAcceptanceReportFinding[]
}

type NativeAcceptanceDispatch = {
  version: 3
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  workspaceDigest: string
  createdAt: string
}

type NativeAcceptanceBackgroundTask = {
  version: 3
  kind: 'background-task'
  sessionId: string
  turnId?: string
  taskId: string
  toolUseID: string
  validatorId: string
  workspaceDigest: string
  createdAt: string
}

export type NativeAcceptanceEvidence = {
  version: 3
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  status: NativeAcceptanceResult
  summary: string
  reportDigest: string
  workspaceDigest: string
  evidence: NativeAcceptanceReportEvidence[]
  findings: NativeAcceptanceReportFinding[]
  createdAt: string
}

type NativeAcceptanceObservation =
  | NativeAcceptanceDispatch
  | NativeAcceptanceBackgroundTask
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

  const toolName = stringValue(input.payload.toolName)
  if (toolName !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  const validatorId = stringValue(toolInput.subagent_type)
  if (validatorId !== DELIVERY_VALIDATOR_AGENT_TYPES[0]) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    appendObservation(input.dataRoot, input.sessionId, {
      version: 3,
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

  const report = parseNativeAcceptanceReport(
    stringValue(input.payload.output),
    validatorId,
  )
  if (!report) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId,
    status: report.status,
    summary: report.summary,
    reportDigest: digestJson(report),
    workspaceDigest: dispatch.workspaceDigest,
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
      version: 3,
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

  if (
    subtype !== 'task_notification' ||
    stringValue(input.payload.status) !== 'completed'
  ) return
  if (observations.some(observation =>
    observation.kind === 'result' && observation.toolUseID === toolUseID
  )) return
  const backgroundTask = observations.findLast(observation =>
    observation.kind === 'background-task' &&
    observation.taskId === taskId &&
    observation.toolUseID === toolUseID
  )
  if (!backgroundTask || backgroundTask.kind !== 'background-task') return

  const report = parseNativeAcceptanceReport(
    readNativeBackgroundTaskTerminalText(stringValue(input.payload.output_file)),
    backgroundTask.validatorId,
  )
  if (!report) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId: backgroundTask.validatorId,
    status: report.status,
    summary: report.summary,
    reportDigest: digestJson(report),
    workspaceDigest: backgroundTask.workspaceDigest,
    evidence: report.evidence,
    findings: report.findings,
    createdAt: input.createdAt.toISOString(),
  })
}

const MAX_NATIVE_TASK_OUTPUT_BYTES = 16 * 1024 * 1024

function readNativeBackgroundTaskTerminalText(path: string): string {
  if (!path || !existsSync(path)) return ''
  let file: number | undefined
  try {
    file = openSync(path, 'r')
    const size = fstatSync(file).size
    const length = Math.min(size, MAX_NATIVE_TASK_OUTPUT_BYTES)
    const offset = Math.max(0, size - length)
    const bytes = Buffer.alloc(length)
    readSync(file, bytes, 0, length, offset)
    const lines = bytes.toString('utf8').split('\n')
    if (offset > 0) lines.shift()
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim()
      if (!line) continue
      try {
        const message = JSON.parse(line) as unknown
        const text = getNativeAssistantText(message)
        if (text) return text
      } catch {
        continue
      }
    }
  } catch {
    return ''
  } finally {
    if (file !== undefined) closeSync(file)
  }
  return ''
}

function getNativeAssistantText(value: unknown): string {
  if (!isRecord(value) || value.type !== 'assistant') return ''
  const message = isRecord(value.message) ? value.message : undefined
  if (!message || !Array.isArray(message.content)) return ''
  return message.content.flatMap(item => {
    if (!isRecord(item) || item.type !== 'text') return []
    const text = stringValue(item.text)
    return text ? [text] : []
  }).join('\n').trim()
}

export function getObservedNativeAcceptance(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'stale'; evidence: NativeAcceptanceEvidence }
  | { state: 'current'; evidence: NativeAcceptanceEvidence } {
  const workspaceDigest = digestWorkspace(input.workspacePath)
  const latest = readObservations(input.dataRoot, input.sessionId)
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
): NativeAcceptanceReport | undefined {
  const report = parseTerminalJsonObject(text)
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
  if (evidence.length !== report.evidence.length || findings.length !== report.findings.length) {
    return undefined
  }

  if (status === 'passed') {
    if (findings.length > 0 || evidence.some(item => item.result !== 'passed')) {
      return undefined
    }
    const kinds = new Set(evidence.map(item => item.kind))
    if ([...REQUIRED_PASSING_EVIDENCE].some(kind => !kinds.has(kind))) {
      return undefined
    }
  } else {
    if (findings.length === 0 || !evidence.some(item => item.result === status)) {
      return undefined
    }
  }
  return { validatorId, status, summary, evidence, findings }
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
        return observation.version === 3 && observation.sessionId === sessionId &&
          observation.validatorId === DELIVERY_VALIDATOR_AGENT_TYPES[0] &&
          (
            observation.kind === 'dispatch' ||
            observation.kind === 'background-task' ||
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

function parseTerminalJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
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
