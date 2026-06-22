import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'

const PLAYABLE_SPEC_READY_MARKER = 'PLAYABLE_SPEC_READY: yes'
const BUILD_AFTER_PLAYABLE_SPEC_PROMPT = [
  'Now implement the approved playable spec inside the active BeeGame workspace.',
  'Use ./BEEGAME_PLAYABLE_SPEC.md as the source of truth; read it if details are needed instead of relying on previous conversation history.',
  'Create files only under a workspace-local game directory such as ./snake-game.',
  'Write the design artifacts into the project directory before code if they are useful.',
  'Then implement the playable MVP, run build checks, and self-review against the Playability Acceptance Checklist.',
].join('\n')
import { createQueryEngineRunner } from './query-engine-runner'

export type BeeGameSessionStatus = 'running' | 'stopped' | 'failed'

export type BeeGameTurnStatus = 'idle' | 'running'

export type BeeGameEventType =
  | 'session.started'
  | 'turn.started'
  | 'user.message'
  | 'assistant.message'
  | 'assistant.partial'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.progress'
  | 'permission.requested'
  | 'permission.resolved'
  | 'workflow.phase'
  | 'workflow.blocked'
  | 'system.status'
  | 'result'
  | 'turn.completed'
  | 'turn.failed'
  | 'session.stopped'
  | 'session.failed'

export type DashboardSDKMessage = {
  type: string
  [key: string]: unknown
}

export type BeeGameEvent = {
  id: number
  sessionId: string
  turnId?: string
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
  createdAt: Date
}

export type BeeGameSession = {
  id: string
  cwd: string
  modelConfigId?: string
  status: BeeGameSessionStatus
  turnStatus: BeeGameTurnStatus
  createdAt: Date
  updatedAt: Date
}

export type BeeGameArtifact = {
  path: string
  content: string
}

export type DeleteBeeGameSessionResult = {
  deleted: boolean
  deletedArtifactPaths: string[]
}

export type BeeGameSessionRunnerStartInput = {
  sessionId: string
  cwd: string
  env: Record<string, string>
}

export type BeeGameSessionSubmitInput = {
  prompt: string
  signal: AbortSignal
  onMessage(message: DashboardSDKMessage): void
  requestPermission(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

export type BeeGameSessionRuntime = {
  submit(input: BeeGameSessionSubmitInput): Promise<void>
  stop(): void
}

export type BeeGameSessionRunner = {
  start(input: BeeGameSessionRunnerStartInput): Promise<BeeGameSessionRuntime>
}

export type DashboardPermissionRequest = {
  toolUseID: string
  toolName: string
  message: string
  input: Record<string, unknown>
}

export type DashboardPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
}

type PendingPermission = DashboardPermissionRequest & {
  resolve(decision: DashboardPermissionDecision): void
}

type WorkflowPhase = 'planning' | 'building' | 'completed'

type SessionRecord = {
  session: BeeGameSession
  runtime: RuntimeModelConfig | undefined
  transcriptPath: string
  runner: BeeGameSessionRuntime | null
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  trustedSession: boolean
  rememberedPermissions: Set<string>
  rememberedPermissionTools: Set<string>
  toolUses: Map<string, { toolName: string; input?: unknown }>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  workflowPhase: WorkflowPhase
}

export type StartBeeGameSessionInput = {
  workspacePath: string
  modelConfigId?: string
}

export class BeeGameSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly runner: BeeGameSessionRunner = createQueryEngineRunner(),
  ) {}

  start(input: StartBeeGameSessionInput): BeeGameSession {
    if (!isAbsolute(input.workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const cwd = resolve(input.workspacePath)
    const runtime = input.modelConfigId
      ? mapModelConfigToRuntime(input.modelConfigId)
      : undefined
    if (input.modelConfigId && !runtime) {
      throw new Error('Model config not found')
    }

    const now = new Date()
    const session: BeeGameSession = {
      id: `beegame_${randomUUID().replaceAll('-', '')}`,
      cwd,
      ...(input.modelConfigId ? { modelConfigId: input.modelConfigId } : {}),
      status: 'running',
      turnStatus: 'idle',
      createdAt: now,
      updatedAt: now,
    }

    const record: SessionRecord = {
      session,
      runtime,
      transcriptPath: resolve(cwd, '.beegame-dashboard', 'transcripts', `${session.id}.jsonl`),
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      trustedSession: false,
      rememberedPermissions: new Set(),
      rememberedPermissionTools: new Set(),
      toolUses: new Map(),
      events: [],
      nextEventId: 1,
      nextTurnIndex: 1,
      currentTurnId: null,
      workflowPhase: 'planning',
    }
    this.sessions.set(session.id, record)
    this.append(record, 'session.started', `Created BeeGame session in ${cwd}`)

    return cloneSession(record.session)
  }

  list(): BeeGameSession[] {
    return [...this.sessions.values()].map(record =>
      cloneSession(record.session),
    )
  }

  get(sessionId: string): BeeGameSession | undefined {
    const record = this.sessions.get(sessionId)
    return record ? cloneSession(record.session) : undefined
  }

  events(sessionId: string, after = 0): BeeGameEvent[] {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    return record.events
      .filter(event => event.id > after)
      .map(event => ({ ...event }))
  }

  transcript(sessionId: string): Array<{
    id: number
    type: BeeGameEventType
    text: string
    turnId?: string
    payload?: DashboardSDKMessage
    createdAt: Date
  }> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    return record.events.map(event => ({
      id: event.id,
      type: event.type,
      text: event.text,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      ...(event.payload ? { payload: event.payload } : {}),
      createdAt: event.createdAt,
    }))
  }

  async send(sessionId: string, text: string): Promise<BeeGameSession> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status !== 'running') {
      throw new Error('Session is not running')
    }
    if (record.session.turnStatus !== 'idle') {
      throw new Error('Session is already processing a prompt')
    }

    record.session.turnStatus = 'running'
    record.abortController = new AbortController()
    record.currentTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
    record.nextTurnIndex += 1
    this.append(record, 'turn.started', text)
    this.setWorkflowPhase(record, 'planning')
    this.append(record, 'user.message', text)
    this.append(record, 'system.status', 'BeeGame runtime is starting.')

    void this.runTurn(record, text)
    return cloneSession(record.session)
  }

  stop(sessionId: string): BeeGameSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status === 'running') {
      record.abortController?.abort()
      record.runner?.stop()
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        message: 'Session stopped before permission was resolved',
      })
      record.session.status = 'stopped'
      record.session.turnStatus = 'idle'
      record.session.updatedAt = new Date()
      this.append(record, 'session.stopped', 'BeeGame session stopped')
    }
    return cloneSession(record.session)
  }

  async delete(
    sessionId: string,
    options: { deleteArtifacts?: boolean } = {},
  ): Promise<DeleteBeeGameSessionResult> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')

    if (record.session.status === 'running') {
      record.abortController?.abort()
      record.runner?.stop()
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        message: 'Session deleted before permission was resolved',
      })
    }

    const deletedArtifactPaths = options.deleteArtifacts
      ? await deleteSessionArtifactRoots(record)
      : []
    this.sessions.delete(sessionId)
    return { deleted: true, deletedArtifactPaths }
  }

  async readArtifact(sessionId: string, path: string): Promise<BeeGameArtifact> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    const targetPath = isAbsolute(path)
      ? resolve(path)
      : resolve(record.session.cwd, path)
    const relativePath = relative(record.session.cwd, targetPath)
    if (
      relativePath === '' ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      throw new Error('Artifact path must stay inside the session workspace')
    }
    return {
      path: relativePath,
      content: await readFile(targetPath, 'utf8'),
    }
  }

  private async runTurn(record: SessionRecord, prompt: string): Promise<void> {
    try {
      const runner = await this.ensureRunner(record)
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      await runner.submit({
        prompt,
        signal,
        onMessage: message => {
          const mapped = mapSDKMessageToEvent(message)
          if (mapped) {
            this.append(record, mapped.type, mapped.text, message)
          }
          for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
            this.append(record, toolEvent.type, toolEvent.text, toolEvent.payload)
          }
        },
        requestPermission: request => this.requestPermission(record, request),
      })
      if (
        !signal.aborted &&
        record.session.status === 'running' &&
        record.workflowPhase === 'planning' &&
        hasPlayableSpecReadyMarker(record)
      ) {
        await persistPlayableSpec(record)
        this.setWorkflowPhase(record, 'building')
        runner.stop()
        record.runner = null
        const buildRunner = await this.ensureRunner(record)
        await buildRunner.submit({
          prompt: BUILD_AFTER_PLAYABLE_SPEC_PROMPT,
          signal,
          onMessage: message => {
            const mapped = mapSDKMessageToEvent(message)
            if (mapped) {
              this.append(record, mapped.type, mapped.text, message)
            }
            for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
              this.append(record, toolEvent.type, toolEvent.text, toolEvent.payload)
            }
          },
          requestPermission: request => this.requestPermission(record, request),
        })
      }
      if (!signal.aborted && record.session.status === 'running') {
        if (record.workflowPhase === 'building') {
          this.setWorkflowPhase(record, 'completed')
        }
        this.append(record, 'turn.completed', 'BeeGame turn completed')
      }
    } catch (err) {
      if (record.session.status === 'running') {
        this.append(record, 'turn.failed', toErrorMessage(err))
      }
    } finally {
      if (record.session.status === 'running') {
        record.session.turnStatus = 'idle'
      }
      record.currentTurnId = null
      record.abortController = null
      record.session.updatedAt = new Date()
    }
  }

  private async ensureRunner(
    record: SessionRecord,
  ): Promise<BeeGameSessionRuntime> {
    if (record.runner) return record.runner
    record.runner = await this.runner.start({
      sessionId: record.session.id,
      cwd: record.session.cwd,
      env: buildRuntimeEnv(record.runtime),
    })
    return record.runner
  }

  resolvePermission(
    sessionId: string,
    toolUseID: string,
    decision: DashboardPermissionDecision & { remember?: boolean },
  ): { resolved: boolean } {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    const pending = record.pendingPermissions.get(toolUseID)
    if (!pending) throw new Error('Permission request not found')

    record.pendingPermissions.delete(toolUseID)
    if (decision.behavior === 'allow' && decision.remember) {
      record.trustedSession = true
      record.rememberedPermissions.add(permissionSignature(pending))
      record.rememberedPermissionTools.add(pending.toolName)
    }
    pending.resolve(decision)
    this.append(
      record,
      'permission.resolved',
      `${pending.toolName}: ${decision.behavior}`,
      {
        type: 'permission.resolved',
        toolUseID,
        toolName: pending.toolName,
        decision: decision.behavior,
        remember: Boolean(decision.remember),
      },
    )
    return { resolved: true }
  }

  private requestPermission(
    record: SessionRecord,
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision> {
    if (isUserQuestionTool(request.toolName)) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        autoApproved: true,
        reason: 'User clarification tools do not require dashboard permission approval.',
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'allow',
        message: 'Allowed so BeeGame can ask the user for clarification.',
      })
    }
    const workspaceViolation = getWorkspaceViolation(record.session.cwd, request)
    if (workspaceViolation) {
      this.append(record, 'permission.resolved', `${request.toolName}: deny`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'deny',
        autoDenied: true,
        reason: workspaceViolation,
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'deny',
        message: workspaceViolation,
      })
    }
    if (record.workflowPhase === 'planning' && hasPlayableSpecReadyMarker(record)) {
      this.setWorkflowPhase(record, 'building')
    }
    const gameplayGateViolation =
      record.workflowPhase === 'planning'
        ? getGameplayGateViolation(record, request)
        : undefined
    if (gameplayGateViolation) {
      this.append(record, 'workflow.blocked', gameplayGateViolation, {
        type: 'workflow.blocked',
        phase: record.workflowPhase,
        blockedToolName: request.toolName,
        toolUseID: request.toolUseID,
        reason: gameplayGateViolation,
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'deny',
        message: gameplayGateViolation,
      })
    }
    const signature = permissionSignature(request)
    if (
      (record.trustedSession && request.toolName !== 'Bash') ||
      record.rememberedPermissions.has(signature) ||
      (request.toolName !== 'Bash' &&
        record.rememberedPermissionTools.has(request.toolName))
    ) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        remember: true,
        autoApproved: true,
      })
      return Promise.resolve({
        behavior: 'allow',
        message: 'Auto-approved by dashboard for a matching prior permission.',
      })
    }
    return new Promise(resolve => {
      record.pendingPermissions.set(request.toolUseID, { ...request, resolve })
      this.append(record, 'permission.requested', request.message, {
        type: 'permission.requested',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        message: request.message,
        input: request.input,
      })
    })
  }

  private setWorkflowPhase(record: SessionRecord, phase: WorkflowPhase): void {
    record.workflowPhase = phase
    this.append(record, 'workflow.phase', phase, {
      type: 'workflow.phase',
      phase,
    })
  }

  private resolveAllPendingPermissions(
    record: SessionRecord,
    decision: DashboardPermissionDecision,
  ): void {
    for (const [toolUseID, pending] of record.pendingPermissions) {
      record.pendingPermissions.delete(toolUseID)
      pending.resolve(decision)
    }
  }

  private append(
    record: SessionRecord,
    type: BeeGameEventType,
    text: string,
    payload?: DashboardSDKMessage,
  ): void {
    const sanitizedText = sanitizeBeeGameText(text)
    const sanitizedPayload = payload
      ? (sanitizeBeeGameVisibleValue(payload) as DashboardSDKMessage)
      : undefined
    const event: BeeGameEvent = {
      id: record.nextEventId,
      sessionId: record.session.id,
      ...(record.currentTurnId ? { turnId: record.currentTurnId } : {}),
      type,
      text: sanitizedText,
      ...(sanitizedPayload ? { payload: sanitizedPayload } : {}),
      createdAt: new Date(),
    }
    record.events.push(event)
    appendTranscriptEvent(record.transcriptPath, event)
    record.nextEventId += 1
    record.session.updatedAt = new Date()
  }
}

async function deleteSessionArtifactRoots(
  record: SessionRecord,
): Promise<string[]> {
  const roots = getSessionArtifactRootPaths(record)
  const deleted: string[] = []
  for (const path of roots) {
    await rm(path, { recursive: true, force: true })
    deleted.push(path)
  }
  return deleted
}

export async function deleteSessionArtifactsFromTranscript(
  sessionId: string,
  cwd: string,
): Promise<string[]> {
  const transcriptPath = resolve(
    cwd,
    '.beegame-dashboard',
    'transcripts',
    `${sessionId}.jsonl`,
  )
  const raw = await readFile(transcriptPath, 'utf8')
  const events = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as Pick<BeeGameEvent, 'type' | 'payload'>)
  const roots = getSessionArtifactRootPathsForEvents(cwd, events)
  const deleted: string[] = []
  for (const path of roots) {
    await rm(path, { recursive: true, force: true })
    deleted.push(path)
  }
  return deleted
}

function getSessionArtifactRootPaths(record: SessionRecord): string[] {
  return getSessionArtifactRootPathsForEvents(record.session.cwd, record.events)
}

function getSessionArtifactRootPathsForEvents(
  cwd: string,
  events: Array<Pick<BeeGameEvent, 'type' | 'payload'>>,
): string[] {
  const roots = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed') {
      continue
    }
    const toolName = getDashboardPayloadString(event.payload, 'toolName')
    if (!isFileMutationTool(toolName)) continue
    const input = getDashboardPayloadRecord(event.payload, 'input')
    const artifactPath = getMutationArtifactPath(input)
    if (!artifactPath) continue
    const root = getTopLevelWorkspacePath(cwd, artifactPath)
    if (root) roots.add(root)
  }
  return [...roots].sort((left, right) => left.localeCompare(right))
}

function isFileMutationTool(toolName: string): boolean {
  return ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)
}

function getGameplayGateViolation(
  record: SessionRecord,
  request: Pick<DashboardPermissionRequest, 'toolName'>,
): string | undefined {
  if (!isImplementationTool(request.toolName)) return undefined
  if (hasPlayableSpecReadyMarker(record)) return undefined
  return `Playable Spec gate is not complete. BeeGame must first produce a Playable Spec, Playability Acceptance Checklist, and the exact marker "${PLAYABLE_SPEC_READY_MARKER}" before using ${request.toolName}.`
}

function isImplementationTool(toolName: string): boolean {
  return toolName === 'Bash' || isFileMutationTool(toolName)
}

function hasPlayableSpecReadyMarker(record: SessionRecord): boolean {
  return record.events.some(event =>
    (event.type === 'assistant.message' || event.type === 'assistant.partial') &&
    event.text.includes(PLAYABLE_SPEC_READY_MARKER),
  )
}

async function persistPlayableSpec(record: SessionRecord): Promise<void> {
  const currentTurnId = record.currentTurnId
  const content = record.events
    .filter(event =>
      event.type === 'assistant.message' &&
      (!currentTurnId || event.turnId === currentTurnId),
    )
    .map(event => event.text.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
    .trim()
  if (!content || !content.includes(PLAYABLE_SPEC_READY_MARKER)) return
  await writeFile(resolve(record.session.cwd, 'BEEGAME_PLAYABLE_SPEC.md'), `${content}\n`, 'utf8')
}

function getMutationArtifactPath(input: Record<string, unknown>): string {
  return String(input.file_path || input.path || input.notebook_path || '').trim()
}

function getTopLevelWorkspacePath(cwd: string, artifactPath: string): string {
  const targetPath = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(cwd, artifactPath)
  const rel = relative(cwd, targetPath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return ''
  const [firstSegment] = rel.split('/')
  if (!firstSegment || firstSegment.startsWith('.')) return ''
  return resolve(cwd, firstSegment)
}

function getDashboardPayloadString(
  payload: DashboardSDKMessage | undefined,
  field: string,
): string {
  const value = payload?.[field]
  return typeof value === 'string' ? value : ''
}

function getDashboardPayloadRecord(
  payload: DashboardSDKMessage | undefined,
  field: string,
): Record<string, unknown> {
  const value = payload?.[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isUserQuestionTool(toolName: string): boolean {
  return toolName === 'AskUserQuestion'
}

function getWorkspaceViolation(
  cwd: string,
  request: Pick<DashboardPermissionRequest, 'toolName' | 'input'>,
): string {
  const paths = extractPermissionPaths(request.input)
  const outsidePath = paths.find(path => !isPathInside(cwd, path))
  if (!outsidePath) return ''
  return `${request.toolName} requested access outside the session workspace: ${outsidePath}. The dashboard session is restricted to ${cwd}.`
}

function extractPermissionPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [
    input.file_path,
    input.path,
    input.notebook_path,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
  if (typeof input.command === 'string') {
    paths.push(...extractShellPathReferences(input.command))
  }
  return paths
}

function extractShellPathReferences(command: string): string[] {
  return splitShellLike(command)
    .map(cleanShellToken)
    .filter(Boolean)
    .filter(token => isPathReference(token))
}

function splitShellLike(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (isShellWhitespace(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function cleanShellToken(token: string): string {
  let start = 0
  let end = token.length
  while (start < end && isShellWrapperPrefix(token[start])) start += 1
  while (end > start && isShellWrapperSuffix(token[end - 1])) end -= 1
  return token.slice(start, end).trim()
}

function isShellWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function isShellWrapperPrefix(char: string | undefined): boolean {
  return char === '(' || char === '[' || char === '{'
}

function isShellWrapperSuffix(char: string | undefined): boolean {
  return (
    char === ')' ||
    char === ']' ||
    char === '}' ||
    char === ',' ||
    char === ';'
  )
}

function isPathReference(token: string): boolean {
  if (!token || token.startsWith('-')) return false
  return (
    token.startsWith('/') ||
    token === '..' ||
    token.startsWith('../') ||
    token.includes('/../')
  )
}

function isPathInside(cwd: string, path: string): boolean {
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
  const relativePath = relative(cwd, resolvedPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function appendTranscriptEvent(path: string, event: BeeGameEvent): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(
      path,
      `${JSON.stringify({
        id: event.id,
        sessionId: event.sessionId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        type: event.type,
        text: event.text,
        ...(event.payload ? { payload: event.payload } : {}),
        createdAt: event.createdAt.toISOString(),
      })}\n`,
      'utf8',
    )
  } catch {
    // Transcript logging must not break the active BeeGame turn.
  }
}

function permissionSignature(request: Pick<DashboardPermissionRequest, 'toolName' | 'input'>): string {
  return `${request.toolName}:${stableJson(request.input)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function mapSDKMessageToEvent(message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
} | null {
  switch (message.type) {
    case 'user':
      return mapTextEvent('user.message', extractAssistantVisibleText(message))
    case 'assistant':
      return mapTextEvent('assistant.message', extractAssistantVisibleText(message))
    case 'partial_assistant':
      return mapTextEvent('assistant.partial', extractAssistantVisibleText(message))
    case 'stream_event':
      return mapTextEvent('assistant.partial', extractStreamTextDelta(message))
    case 'tool_progress':
      return mapTextEvent('tool.progress', extractMessageText(message))
    case 'result':
      return mapTextEvent('result', extractMessageText(message))
    case 'system':
    case 'status':
      return mapTextEvent('system.status', extractMessageText(message))
    default:
      return mapTextEvent('system.status', extractMessageText(message))
  }
}

function mapTextEvent(
  type: BeeGameEventType,
  text: string,
): { type: BeeGameEventType; text: string } | null {
  const normalized = text.trim()
  return normalized ? { type, text: normalized } : null
}

function mapSDKMessageToToolEvents(
  record: SessionRecord,
  message: DashboardSDKMessage,
): Array<{ type: BeeGameEventType; text: string; payload: DashboardSDKMessage }> {
  const events: Array<{
    type: BeeGameEventType
    text: string
    payload: DashboardSDKMessage
  }> = []
  for (const block of extractContentBlocks(message)) {
    const blockType = getStringField(block, 'type')
    if (
      blockType === 'tool_use' ||
      blockType === 'server_tool_use' ||
      blockType === 'mcp_tool_use'
    ) {
      const toolUseID = getStringField(block, 'id')
      if (!toolUseID) continue
      const toolName = getStringField(block, 'name') || 'Tool'
      const input = getObjectField(block, 'input')
      record.toolUses.set(toolUseID, { toolName, input })
      events.push({
        type: 'tool.started',
        text: toolName,
        payload: {
          type: 'tool.started',
          toolUseID,
          toolName,
          ...(input ? { input } : {}),
        },
      })
      continue
    }

    if (blockType === 'tool_result' || blockType === 'mcp_tool_result') {
      const toolUseID = getStringField(block, 'tool_use_id')
      if (!toolUseID) continue
      const cached = record.toolUses.get(toolUseID)
      const toolName = cached?.toolName ?? 'Tool'
      const failed = getBooleanField(block, 'is_error') === true
      const output = extractMessageText(block.content)
      events.push({
        type: failed ? 'tool.failed' : 'tool.completed',
        text: `${toolName} ${failed ? 'failed' : 'completed'}`,
        payload: {
          type: failed ? 'tool.failed' : 'tool.completed',
          toolUseID,
          toolName,
          ...(cached?.input ? { input: cached.input } : {}),
          output,
        },
      })
    }
  }
  return events
}

function extractContentBlocks(message: DashboardSDKMessage): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []
  const event = getObjectField(message, 'event')
  const contentBlock = getObjectField(event, 'content_block')
  if (contentBlock) blocks.push(contentBlock)
  const delta = getObjectField(event, 'delta')
  if (delta) blocks.push(delta)

  const messageBody = getObjectField(message, 'message')
  const content = messageBody?.content ?? message.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isObject(block)) blocks.push(block)
    }
  }
  if (isObject(content)) blocks.push(content)
  return blocks
}

function extractMessageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractMessageText).filter(Boolean).join('')
  }
  if (!isObject(value)) return ''

  if (typeof value.text === 'string') return value.text
  if (typeof value.result === 'string') return value.result
  if (typeof value.summary === 'string') return value.summary
  if (typeof value.status === 'string') return value.status
  if (typeof value.tool_name === 'string') return value.tool_name

  if ('content' in value) {
    const contentText = extractMessageText(value.content)
    if (contentText) return contentText
  }
  if ('message' in value) {
    const messageText = extractMessageText(value.message)
    if (messageText) return messageText
  }
  if ('event' in value) {
    const eventText = extractMessageText(value.event)
    if (eventText) return eventText
  }
  if ('delta' in value) {
    const deltaText = extractMessageText(value.delta)
    if (deltaText) return deltaText
  }

  return value.type ? String(value.type) : ''
}

function extractAssistantVisibleText(message: DashboardSDKMessage): string {
  return extractVisibleTextFromContent(getMessageContent(message) ?? message)
}

function getMessageContent(message: DashboardSDKMessage): unknown {
  const messageBody = getObjectField(message, 'message')
  if (messageBody && 'content' in messageBody) return messageBody.content
  if ('content' in message) return message.content
  return undefined
}

function extractVisibleTextFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractVisibleTextFromContent).filter(Boolean).join('')
  }
  if (!isObject(value)) return ''

  const blockType = getStringField(value, 'type')
  if (blockType && blockType !== 'text') {
    return ''
  }
  if (typeof value.text === 'string') return value.text
  if ('content' in value) return extractVisibleTextFromContent(value.content)
  return ''
}

function extractStreamTextDelta(message: DashboardSDKMessage): string {
  const event = getObjectField(message, 'event') ?? message
  const eventType = getStringField(event, 'type')
  if (eventType !== 'content_block_delta') return ''

  const delta = getObjectField(event, 'delta')
  if (!delta || getStringField(delta, 'type') !== 'text_delta') return ''
  return getStringField(delta, 'text')
}

function getStringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string {
  const fieldValue = value?.[field]
  return typeof fieldValue === 'string' ? fieldValue : ''
}

function getBooleanField(
  value: Record<string, unknown> | undefined,
  field: string,
): boolean | undefined {
  const fieldValue = value?.[field]
  return typeof fieldValue === 'boolean' ? fieldValue : undefined
}

function getObjectField(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (!isObject(value)) return undefined
  const fieldValue = value[field]
  return isObject(fieldValue) ? fieldValue : undefined
}

function buildRuntimeEnv(
  runtime: RuntimeModelConfig | undefined,
): Record<string, string> {
  const beegameConfigDir =
    process.env.BEEGAME_CONFIG_DIR ?? resolve(homedir(), '.beegame')
  return {
    CLAUDE_CONFIG_DIR: beegameConfigDir,
    BEEGAME_CONFIG_DIR: beegameConfigDir,
    BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
    ...(runtime?.env ?? {}),
  }
}

function cloneSession(session: BeeGameSession): BeeGameSession {
  return { ...session }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  ) {
    return err.message
  }
  return String(err || 'Request failed')
}

function sanitizeBeeGameVisibleValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeBeeGameText(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeBeeGameVisibleValue(item))
  }
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const sanitizedKey = shouldPreserveRuntimeKey(key)
        ? key
        : sanitizeBeeGameText(key)
      return [
        sanitizedKey,
        shouldPreserveRuntimeValue(key) ? item : sanitizeBeeGameVisibleValue(item),
      ]
    }),
  )
}

function sanitizeBeeGameText(value: string): string {
  const protectedSegments: string[] = []
  const protectedValue = value.replace(pathSegmentPattern, segment => {
    const placeholder = `__BEEGAME_PATH_${protectedSegments.length}__`
    protectedSegments.push(segment)
    return placeholder
  })
  const legacyUpper = ['CLAU', 'DE'].join('')
  const legacyTitle = ['Clau', 'de'].join('')
  const legacyLower = ['clau', 'de'].join('')
  const sanitized = protectedValue
    .split(`${legacyTitle} Code`).join('BeeGame')
    .split(`${legacyTitle} code`).join('BeeGame')
    .split(`${legacyLower} code`).join('BeeGame')
    .split(`${legacyUpper}_CODE`).join('BEEGAME')
    .split(`${legacyLower}_code`).join('beegame')
    .split(legacyTitle).join('BeeGame')
    .split(legacyLower).join('BeeGame')
  return protectedSegments.reduce(
    (text, segment, index) => text.replace(`__BEEGAME_PATH_${index}__`, segment),
    sanitized,
  )
}

const pathSegmentPattern = /(?:\/[^\s"'`),\]}]+)+(?:[^\s"'`),\]}.:;!?])?/g

function shouldPreserveRuntimeKey(key: string): boolean {
  return runtimeDataKeys.has(key)
}

function shouldPreserveRuntimeValue(key: string): boolean {
  return runtimeDataKeys.has(key) || key === 'input'
}

const runtimeDataKeys = new Set([
  'args',
  'command',
  'cwd',
  'file',
  'file_path',
  'filename',
  'notebook_path',
  'old_string',
  'output',
  'path',
  'paths',
  'pattern',
  'stderr',
  'stdout',
])
