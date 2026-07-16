import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'

export type NativeAcceptanceEvidence = {
  version: 2
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  reportDigest: string
  workspaceDigest: string
  createdAt: string
}

export function observeNativeAcceptanceToolCompletion(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  eventType: string
  payload?: unknown
  createdAt: Date
}): void {
  if (input.eventType !== 'tool.completed' || !isRecord(input.payload)) return
  if (stringValue(input.payload.toolName) !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  const validatorId = stringValue(toolInput.subagent_type)
  if (validatorId !== DELIVERY_VALIDATOR_AGENT_TYPES[0]) return
  const report = parseTerminalJsonObject(stringValue(input.payload.output))
  if (!report || stringValue(report.validatorId) !== validatorId) return
  const status = stringValue(report.status)
  if (status !== 'passed' && status !== 'failed' && status !== 'blocked') return
  const summary = stringValue(report.summary)
  if (!summary) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return
  const evidence: NativeAcceptanceEvidence = {
    version: 2,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId,
    status,
    summary,
    reportDigest: digestJson(report),
    workspaceDigest: digestWorkspace(input.workspacePath),
    createdAt: input.createdAt.toISOString(),
  }
  const path = evidencePath(input.dataRoot, input.sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(evidence)}\n`, 'utf8')
}

export function getObservedNativeAcceptance(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'stale'; evidence: NativeAcceptanceEvidence }
  | { state: 'current'; evidence: NativeAcceptanceEvidence } {
  const path = evidencePath(input.dataRoot, input.sessionId)
  if (!existsSync(path)) return { state: 'missing' }
  const workspaceDigest = digestWorkspace(input.workspacePath)
  const observations: NativeAcceptanceEvidence[] = readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line): NativeAcceptanceEvidence[] => {
    if (!line.trim()) return []
    try {
      const evidence = JSON.parse(line) as NativeAcceptanceEvidence
      return evidence.version === 2 && evidence.sessionId === input.sessionId &&
        evidence.validatorId === DELIVERY_VALIDATOR_AGENT_TYPES[0]
        ? [evidence]
        : []
    } catch {
      return []
    }
  })
  const latest = observations.at(-1)
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
  observeNativeAcceptanceToolCompletion({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    eventType: 'tool.completed',
    payload: {
      toolName: 'Agent',
      toolUseID: 'test-validator-tool-use',
      input: { subagent_type: DELIVERY_VALIDATOR_AGENT_TYPES[0] },
      output: JSON.stringify(input.report),
    },
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
