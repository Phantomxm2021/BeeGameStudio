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
import { DOCUMENT_REVIEWER_AGENT_TYPE } from './delivery-validation-agents'
import { parseNativeBackgroundTaskLaunch } from './native-background-task-output'

export type NativeDocumentReviewVerdict = 'READY' | 'NEEDS_REVISION' | 'BLOCKED'

type NativeDocumentReviewFinding = {
  source: string
  detail: string
}

type NativeDocumentReviewReport = {
  reviewerId: string
  verdict: NativeDocumentReviewVerdict
  summary: string
  findings: NativeDocumentReviewFinding[]
}

type NativeDocumentReviewDispatch = {
  version: 1
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  reviewerId: string
  documentsDigest: string
  createdAt: string
}

type NativeDocumentReviewBackgroundTask = {
  version: 1
  kind: 'background-task'
  sessionId: string
  turnId?: string
  taskId: string
  toolUseID: string
  reviewerId: string
  documentsDigest: string
  outputFile?: string
  createdAt: string
}

export type NativeDocumentReviewEvidence = {
  version: 1
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  reviewerId: string
  verdict: NativeDocumentReviewVerdict
  summary: string
  findings: NativeDocumentReviewFinding[]
  reportDigest: string
  documentsDigest: string
  createdAt: string
}

type NativeDocumentReviewObservation =
  | NativeDocumentReviewDispatch
  | NativeDocumentReviewBackgroundTask
  | NativeDocumentReviewEvidence

/**
 * Passively observes Claude Code's native document-reviewer Agent lifecycle.
 * It never starts, resumes, or controls the reviewer. The docs revision is
 * frozen at native Agent dispatch so a delayed result cannot approve newer
 * documents.
 */
export function observeNativeDocumentReviewToolEvent(input: {
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
    observeBackgroundEvent({ ...input, payload: input.payload })
    if (stringValue(input.payload.subtype) === 'init') {
      observePendingBackgroundResults(input)
    }
    return
  }

  if (input.eventType === 'result') {
    observePendingBackgroundResults(input)
    return
  }

  if (stringValue(input.payload.toolName) !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  if (stringValue(toolInput.subagent_type) !== DOCUMENT_REVIEWER_AGENT_TYPE)
    return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    appendObservation(input.dataRoot, input.sessionId, {
      version: 1,
      kind: 'dispatch',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolUseID,
      reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
      documentsDigest: digestProjectDocuments(input.workspacePath),
      createdAt: input.createdAt.toISOString(),
    })
    return
  }
  if (input.eventType !== 'tool.completed') return

  const dispatch = readObservations(input.dataRoot, input.sessionId).findLast(
    observation =>
      observation.kind === 'dispatch' && observation.toolUseID === toolUseID,
  )
  if (!dispatch || dispatch.kind !== 'dispatch') return
  const output = stringValue(input.payload.output)
  const backgroundLaunch = parseNativeBackgroundTaskLaunch(output)
  if (backgroundLaunch) {
    const observations = readObservations(input.dataRoot, input.sessionId)
    if (!observations.some(observation =>
      observation.kind === 'background-task' &&
      observation.taskId === backgroundLaunch.taskId &&
      observation.toolUseID === toolUseID
    )) {
      appendObservation(input.dataRoot, input.sessionId, {
        version: 1,
        kind: 'background-task',
        sessionId: input.sessionId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        taskId: backgroundLaunch.taskId,
        toolUseID,
        reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
        documentsDigest: dispatch.documentsDigest,
        outputFile: backgroundLaunch.outputFile,
        createdAt: input.createdAt.toISOString(),
      })
    }
    return
  }
  const report = parseReport(output)
  if (!report) return
  appendResult(input, toolUseID, dispatch.documentsDigest, report)
}

export function getObservedNativeDocumentReview(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'stale'; evidence: NativeDocumentReviewEvidence }
  | { state: 'current'; evidence: NativeDocumentReviewEvidence } {
  const latest = readObservations(input.dataRoot, input.sessionId)
    .filter(
      (observation): observation is NativeDocumentReviewEvidence =>
        observation.kind === 'result',
    )
    .at(-1)
  if (!latest) return { state: 'missing' }
  return latest.documentsDigest === digestProjectDocuments(input.workspacePath)
    ? { state: 'current', evidence: latest }
    : { state: 'stale', evidence: latest }
}

export function recordNativeDocumentReviewForTest(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  report: unknown
}): void {
  const toolUseID = 'test-document-reviewer-tool-use'
  const basePayload = {
    toolName: 'Agent',
    toolUseID,
    input: { subagent_type: DOCUMENT_REVIEWER_AGENT_TYPE },
  }
  observeNativeDocumentReviewToolEvent({
    ...input,
    eventType: 'tool.started',
    payload: basePayload,
    createdAt: new Date(),
  })
  observeNativeDocumentReviewToolEvent({
    ...input,
    eventType: 'tool.completed',
    payload: { ...basePayload, output: JSON.stringify(input.report) },
    createdAt: new Date(),
  })
}

export function digestProjectDocuments(workspacePath: string): string {
  const workspace = resolve(workspacePath)
  const docsRoot = join(workspace, 'docs')
  const files: string[] = []
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (
        entry.isFile() &&
        relative(workspace, path).split('\\').join('/') !==
          'docs/acceptance/validation-report.json'
      )
        files.push(path)
    }
  }
  visit(docsRoot)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(workspace, file).split('\\').join('/'))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

function observeBackgroundEvent(input: {
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
    if (
      observations.some(
        observation =>
          observation.kind === 'background-task' &&
          observation.taskId === taskId &&
          observation.toolUseID === toolUseID,
      )
    )
      return
    const dispatch = observations.findLast(
      observation =>
        observation.kind === 'dispatch' && observation.toolUseID === toolUseID,
    )
    if (!dispatch || dispatch.kind !== 'dispatch') return
    appendObservation(input.dataRoot, input.sessionId, {
      version: 1,
      kind: 'background-task',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      taskId,
      toolUseID,
      reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
      documentsDigest: dispatch.documentsDigest,
      createdAt: input.createdAt.toISOString(),
    })
    return
  }

  if (
    subtype !== 'task_notification' ||
    stringValue(input.payload.status) !== 'completed'
  )
    return
  if (
    observations.some(
      observation =>
        observation.kind === 'result' && observation.toolUseID === toolUseID,
    )
  )
    return
  const task = observations.findLast(
    observation =>
      observation.kind === 'background-task' &&
      observation.taskId === taskId &&
      observation.toolUseID === toolUseID,
  )
  if (!task || task.kind !== 'background-task') return
  const report = parseReport(
    readBackgroundTaskTerminalText(
      stringValue(input.payload.output_file) || task.outputFile || '',
    ),
  )
  if (!report) return
  appendResult(input, toolUseID, task.documentsDigest, report)
}

function observePendingBackgroundResults(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  createdAt: Date
}): void {
  const observations = readObservations(input.dataRoot, input.sessionId)
  const completedToolUseIDs = new Set(observations.flatMap(observation =>
    observation.kind === 'result' ? [observation.toolUseID] : []
  ))
  for (const task of observations) {
    if (
      task.kind !== 'background-task' ||
      !task.outputFile ||
      completedToolUseIDs.has(task.toolUseID)
    ) continue
    const report = parseReport(readBackgroundTaskTerminalText(task.outputFile))
    if (!report) continue
    appendResult(input, task.toolUseID, task.documentsDigest, report)
    completedToolUseIDs.add(task.toolUseID)
  }
}

function appendResult(
  input: {
    dataRoot: string
    sessionId: string
    turnId?: string
    createdAt: Date
  },
  toolUseID: string,
  documentsDigest: string,
  report: NativeDocumentReviewReport,
): void {
  appendObservation(input.dataRoot, input.sessionId, {
    version: 1,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
    verdict: report.verdict,
    summary: report.summary,
    findings: report.findings,
    reportDigest: digestJson(report),
    documentsDigest,
    createdAt: input.createdAt.toISOString(),
  })
}

const MAX_NATIVE_TASK_OUTPUT_BYTES = 16 * 1024 * 1024

function readBackgroundTaskTerminalText(path: string): string {
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
        const value = JSON.parse(line) as unknown
        const text = getAssistantText(value)
        if (text) return text
      } catch {}
    }
  } catch {
    return ''
  } finally {
    if (file !== undefined) closeSync(file)
  }
  return ''
}

function getAssistantText(value: unknown): string {
  if (!isRecord(value) || value.type !== 'assistant') return ''
  const message = isRecord(value.message) ? value.message : undefined
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .flatMap(item => {
      if (!isRecord(item) || item.type !== 'text') return []
      const text = stringValue(item.text)
      return text ? [text] : []
    })
    .join('\n')
    .trim()
}

function parseReport(text: string): NativeDocumentReviewReport | undefined {
  const report = parseTerminalJsonObject(text)
  if (
    !report ||
    stringValue(report.reviewerId) !== DOCUMENT_REVIEWER_AGENT_TYPE
  ) {
    return undefined
  }
  const verdict = stringValue(report.verdict)
  if (
    verdict !== 'READY' &&
    verdict !== 'NEEDS_REVISION' &&
    verdict !== 'BLOCKED'
  ) {
    return undefined
  }
  const summary = stringValue(report.summary)
  if (!summary || !Array.isArray(report.findings)) return undefined
  const findings = report.findings.flatMap(parseFinding)
  if (findings.length !== report.findings.length) return undefined
  if (verdict === 'READY' && findings.length > 0) return undefined
  if (verdict !== 'READY' && findings.length === 0) return undefined
  return {
    reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
    verdict,
    summary,
    findings,
  }
}

function parseFinding(value: unknown): NativeDocumentReviewFinding[] {
  if (!isRecord(value)) return []
  const source = stringValue(value.source)
  const detail = stringValue(value.detail)
  return source && detail ? [{ source, detail }] : []
}

function readObservations(
  dataRoot: string,
  sessionId: string,
): NativeDocumentReviewObservation[] {
  const path = evidencePath(dataRoot, sessionId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap(line => {
      if (!line.trim()) return []
      try {
        const observation = JSON.parse(line) as NativeDocumentReviewObservation
        return observation.version === 1 &&
          observation.sessionId === sessionId &&
          observation.reviewerId === DOCUMENT_REVIEWER_AGENT_TYPE &&
          ['dispatch', 'background-task', 'result'].includes(observation.kind)
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
  observation: NativeDocumentReviewObservation,
): void {
  const path = evidencePath(dataRoot, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function evidencePath(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'native-document-review-evidence', `${sessionId}.jsonl`)
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function parseTerminalJsonObject(
  text: string,
): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  try {
    const value = JSON.parse(trimmed) as unknown
    return isRecord(value) ? value : undefined
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
