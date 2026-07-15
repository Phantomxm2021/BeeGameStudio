import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'

type NativeAcceptanceEvidence = {
  version: 1
  sessionId: string
  turnId?: string
  toolUseID: string
  validatorId: string
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
  const report = parseFirstJsonObject(stringValue(input.payload.output))
  if (!report || stringValue(report.validatorId) !== validatorId) return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return
  const evidence: NativeAcceptanceEvidence = {
    version: 1,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    validatorId,
    reportDigest: digestJson(report),
    workspaceDigest: digestWorkspace(input.workspacePath),
    createdAt: input.createdAt.toISOString(),
  }
  const path = evidencePath(input.dataRoot, input.sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(evidence)}\n`, 'utf8')
}

export function hasObservedNativeAcceptanceReport(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  report: unknown
}): boolean {
  if (!isRecord(input.report)) return false
  const path = evidencePath(input.dataRoot, input.sessionId)
  if (!existsSync(path)) return false
  const digest = digestJson(input.report)
  const workspaceDigest = digestWorkspace(input.workspacePath)
  return readFileSync(path, 'utf8').split('\n').some(line => {
    if (!line.trim()) return false
    try {
      const evidence = JSON.parse(line) as NativeAcceptanceEvidence
      return evidence.version === 1 && evidence.sessionId === input.sessionId &&
        evidence.validatorId === DELIVERY_VALIDATOR_AGENT_TYPES[0] && evidence.reportDigest === digest
        && evidence.workspaceDigest === workspaceDigest
    } catch {
      return false
    }
  })
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
      else if (entry.isFile() && ![
        'docs/acceptance/gameplay-checklist.md',
        'docs/acceptance/validation-report.json',
      ].includes(relative(workspace, path).split('\\').join('/'))) files.push(path)
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

function parseFirstJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth !== 0) continue
      try {
        const parsed = JSON.parse(text.slice(start, index + 1)) as unknown
        return isRecord(parsed) ? parsed : undefined
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
