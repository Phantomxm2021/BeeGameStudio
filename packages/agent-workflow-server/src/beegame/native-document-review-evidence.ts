import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DOCUMENT_REVIEWER_AGENT_TYPE } from './delivery-validation-agents'
import {
  auditDocumentReadiness,
  readAcceptanceChecklistIds,
  REQUIRED_PROJECT_DOCUMENTS,
} from './document-readiness-audit'
import {
  hasCompletedNativeDeliveryContract,
  recordNativeDeliveryContractForTest,
} from './native-tool-provenance'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'
import {
  parseNativeBackgroundTaskLaunch,
} from './native-background-task-output'
import {
  parseNativeTerminalTaskNotification,
  type BeeGameNativeTaskNotification,
} from './native-task-notification'

export type NativeDocumentReviewVerdict = 'READY' | 'NEEDS_REVISION' | 'BLOCKED'

type NativeDocumentReviewFinding = {
  source: string
  detail: string
}

type NativeDocumentReviewReport = {
  reviewerId: string
  verdict: NativeDocumentReviewVerdict
  summary: string
  confirmedResourceLibraryUsage: ResourceLibraryUsage
  reviewedDocumentPaths: string[]
  reviewedChecklistIds: string[]
  findings: NativeDocumentReviewFinding[]
}

type NativeDocumentReviewDispatch = {
  version: 2
  kind: 'dispatch'
  sessionId: string
  turnId?: string
  toolUseID: string
  reviewerId: string
  documentsDigest: string
  createdAt: string
}

type NativeDocumentReviewBackgroundTask = {
  version: 2
  kind: 'background-task'
  sessionId: string
  turnId?: string
  taskId: string
  toolUseID: string
  reviewerId: string
  documentsDigest: string
  createdAt: string
}

type NativeDocumentReviewTerminal = {
  version: 2
  kind: 'terminal'
  sessionId: string
  turnId?: string
  toolUseID: string
  reviewerId: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  createdAt: string
}

export type NativeDocumentReviewEvidence = {
  version: 2
  kind: 'result'
  sessionId: string
  turnId?: string
  toolUseID: string
  reviewerId: string
  verdict: NativeDocumentReviewVerdict
  summary: string
  confirmedResourceLibraryUsage: ResourceLibraryUsage
  reviewedDocumentPaths: string[]
  reviewedChecklistIds: string[]
  findings: NativeDocumentReviewFinding[]
  reportDigest: string
  documentsDigest: string
  createdAt: string
}

type NativeDocumentReviewObservation =
  | NativeDocumentReviewDispatch
  | NativeDocumentReviewBackgroundTask
  | NativeDocumentReviewTerminal
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
    return
  }

  if (stringValue(input.payload.toolName) !== 'Agent') return
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  if (stringValue(toolInput.subagent_type) !== DOCUMENT_REVIEWER_AGENT_TYPE)
    return
  const toolUseID = stringValue(input.payload.toolUseID)
  if (!toolUseID) return

  if (input.eventType === 'tool.started') {
    const documentsDigest = digestProjectDocuments(input.workspacePath)
    const observations = readObservations(input.dataRoot, input.sessionId)
    const duplicateActiveReview = observations.some(observation =>
      observation.kind === 'dispatch' &&
      observation.documentsDigest === documentsDigest &&
      !observations.some(terminal =>
        terminal.kind === 'terminal' && terminal.toolUseID === observation.toolUseID
      )
    )
    if (duplicateActiveReview) return
    appendObservation(input.dataRoot, input.sessionId, {
      version: 2,
      kind: 'dispatch',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      toolUseID,
      reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
      documentsDigest,
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
  const nativeResult = stringValue(input.payload.nativeResult)
  const output = nativeResult || stringValue(input.payload.output)
  const backgroundLaunch = parseNativeBackgroundTaskLaunch(output)
  if (backgroundLaunch) {
    const observations = readObservations(input.dataRoot, input.sessionId)
    if (!observations.some(observation =>
      observation.kind === 'background-task' &&
      observation.taskId === backgroundLaunch.taskId &&
      observation.toolUseID === toolUseID
    )) {
      appendObservation(input.dataRoot, input.sessionId, {
        version: 2,
        kind: 'background-task',
        sessionId: input.sessionId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        taskId: backgroundLaunch.taskId,
        toolUseID,
        reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
        documentsDigest: dispatch.documentsDigest,
        createdAt: input.createdAt.toISOString(),
      })
    }
    return
  }
  appendTerminal(input, toolUseID, 'completed')
  const report = parseReport(output, input.workspacePath, Boolean(nativeResult))
  if (!report) return
  if (!hasCompletedNativeDeliveryContract({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: toolUseID,
  })) return
  appendResult(input, toolUseID, dispatch.documentsDigest, report)
}

export function getObservedNativeDocumentReview(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}):
  | { state: 'missing' }
  | { state: 'running'; toolUseID: string; documentsDigest: string; createdAt: string }
  | { state: 'stale'; evidence: NativeDocumentReviewEvidence }
  | { state: 'current'; evidence: NativeDocumentReviewEvidence } {
  const observations = readObservations(input.dataRoot, input.sessionId)
  const currentDigest = digestProjectDocuments(input.workspacePath)
  const running = observations
    .filter((observation): observation is NativeDocumentReviewDispatch =>
      observation.kind === 'dispatch' &&
      observation.documentsDigest === currentDigest &&
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
    documentsDigest: running.documentsDigest,
    createdAt: running.createdAt,
  }
  const latest = observations
    .filter(
      (observation): observation is NativeDocumentReviewEvidence =>
        observation.kind === 'result',
    )
    .at(-1)
  if (!latest) return { state: 'missing' }
  return latest.documentsDigest === currentDigest
    ? { state: 'current', evidence: latest }
    : { state: 'stale', evidence: latest }
}

/** Passively persists the terminal result already emitted by Claude Code. */
export function observeNativeDocumentReviewTaskNotification(input: {
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
  const report = parseReport(terminal.result, input.workspacePath, true)
  if (!report) return
  if (!hasCompletedNativeDeliveryContract({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: dispatch.toolUseID,
  })) return
  appendResult(input, terminal.toolUseId, dispatch.documentsDigest, report)
}

function appendTerminal(
  input: { dataRoot: string; sessionId: string; turnId?: string; createdAt: Date },
  toolUseID: string,
  status: NativeDocumentReviewTerminal['status'],
): void {
  if (readObservations(input.dataRoot, input.sessionId).some(observation =>
    observation.kind === 'terminal' && observation.toolUseID === toolUseID
  )) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 2,
    kind: 'terminal',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
    status,
    createdAt: input.createdAt.toISOString(),
  })
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
  recordNativeDeliveryContractForTest({
    dataRoot: input.dataRoot,
    sessionId: input.sessionId,
    agentToolUseID: toolUseID,
  })
  const report = isRecord(input.report)
    ? {
        ...input.report,
        reviewedDocumentPaths: input.report.reviewedDocumentPaths ?? [...REQUIRED_PROJECT_DOCUMENTS],
        reviewedChecklistIds: input.report.reviewedChecklistIds ?? readAcceptanceChecklistIds(input.workspacePath),
      }
    : input.report
  observeNativeDocumentReviewToolEvent({
    ...input,
    eventType: 'tool.completed',
    payload: { ...basePayload, output: JSON.stringify(report) },
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
  const assetManifest = join(workspace, 'assets', 'asset-manifest.json')
  if (existsSync(assetManifest)) files.push(assetManifest)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(workspace, file).split('\\').join('/'))
    hash.update(
      file === assetManifest
        ? digestibleAssetContract(readFileSync(file, 'utf8'))
        : readFileSync(file),
    )
  }
  return hash.digest('hex')
}

function digestibleAssetContract(source: string): string {
  try {
    const manifest = JSON.parse(source) as unknown
    if (!isRecord(manifest)) return source
    const requirementsSource = manifest.requirements
    const requirements = Array.isArray(requirementsSource)
      ? requirementsSource.map(requirement => {
          if (!isRecord(requirement)) return requirement
          return {
            id: requirement.id,
            name: requirement.name,
            purpose: requirement.purpose,
            required: requirement.required,
            resource_requirement: requirement.resource_requirement,
          }
        }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
      : requirementsSource
    const imports = Array.isArray(manifest.imports)
      ? manifest.imports.map(resourceImport => {
          if (!isRecord(resourceImport)) return resourceImport
          return {
            id: resourceImport.id,
            source: resourceImport.source,
            asset_kind: resourceImport.asset_kind,
            root_path: resourceImport.root_path,
            local_files: resourceImport.local_files,
            dependencies: resourceImport.dependencies,
          }
        }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
      : manifest.imports
    const compositions = Array.isArray(manifest.compositions)
      ? manifest.compositions.map(composition => {
          if (!isRecord(composition)) return composition
          return {
            id: composition.id,
            kind: composition.kind,
            required: composition.required,
            assembly_mode: composition.assembly_mode,
            members: composition.members,
            recipe: composition.recipe,
          }
        }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
      : manifest.compositions
    return stableJson({
      version: manifest.version,
      project_target: manifest.project_target,
      requirements,
      imports,
      compositions,
    })
  } catch {
    return source
  }
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
      version: 2,
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

  // Terminal task results arrive through the native queue callback. SDK
  // status events are lifecycle metadata only and never trigger file reads.
}

function appendResult(
  input: {
    dataRoot: string
    sessionId: string
    workspacePath: string
    turnId?: string
    createdAt: Date
  },
  toolUseID: string,
  documentsDigest: string,
  report: NativeDocumentReviewReport,
): void {
  const readiness = report.verdict === 'READY'
    ? auditDocumentReadiness(input.workspacePath)
    : undefined
  const deterministicIssues = readiness?.issues ?? []
  const effectiveReport: NativeDocumentReviewReport = deterministicIssues.length
    ? {
        reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
        verdict: 'NEEDS_REVISION',
        confirmedResourceLibraryUsage: report.confirmedResourceLibraryUsage,
        reviewedDocumentPaths: report.reviewedDocumentPaths,
        reviewedChecklistIds: report.reviewedChecklistIds,
        summary: [
          'Deterministic project-contract checks rejected the Reviewer READY result.',
          ...deterministicIssues,
        ].join(' '),
        findings: deterministicIssues.map(detail => ({
          source: 'deterministic project-contract audit',
          detail,
        })),
      }
    : report
  appendObservation(input.dataRoot, input.sessionId, {
    version: 2,
    kind: 'result',
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
    verdict: effectiveReport.verdict,
    summary: effectiveReport.summary,
    confirmedResourceLibraryUsage: effectiveReport.confirmedResourceLibraryUsage,
    reviewedDocumentPaths: effectiveReport.reviewedDocumentPaths,
    reviewedChecklistIds: effectiveReport.reviewedChecklistIds,
    findings: effectiveReport.findings,
    reportDigest: digestJson(effectiveReport),
    documentsDigest,
    createdAt: input.createdAt.toISOString(),
  })
}


function parseReport(
  text: string,
  workspacePath: string,
  allowNativePreface = false,
): NativeDocumentReviewReport | undefined {
  const report = parseTerminalJsonObject(text, allowNativePreface)
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
  const confirmedResourceLibraryUsage = stringValue(report.confirmedResourceLibraryUsage)
  const reviewedDocumentPaths = uniqueStrings(report.reviewedDocumentPaths)
  const reviewedChecklistIds = uniqueStrings(report.reviewedChecklistIds)
  if (
    !summary ||
    !Array.isArray(report.findings) ||
    !isResourceLibraryUsage(confirmedResourceLibraryUsage)
  ) return undefined
  const findings = report.findings.flatMap(parseFinding)
  if (findings.length !== report.findings.length) return undefined
  if (!sameIdentifiers(reviewedDocumentPaths, [...REQUIRED_PROJECT_DOCUMENTS])) return undefined
  if (!sameIdentifiers(reviewedChecklistIds, readAcceptanceChecklistIds(workspacePath))) return undefined
  if (verdict === 'READY' && findings.length > 0) return undefined
  if (verdict !== 'READY' && findings.length === 0) return undefined
  return {
    reviewerId: DOCUMENT_REVIEWER_AGENT_TYPE,
    verdict,
    summary,
    confirmedResourceLibraryUsage,
    reviewedDocumentPaths,
    reviewedChecklistIds,
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
        return observation.version === 2 &&
          observation.sessionId === sessionId &&
          observation.reviewerId === DOCUMENT_REVIEWER_AGENT_TYPE &&
          ['dispatch', 'background-task', 'terminal', 'result'].includes(observation.kind)
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
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isResourceLibraryUsage(value: string): value is ResourceLibraryUsage {
  return value === 'optional' || value === 'preferred' || value === 'required'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
