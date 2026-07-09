import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  refundCreditReservation,
  reserveCredits,
  settleCreditReservation,
  type CreditReservation,
  type CreditSettlement,
} from '../credit-store'
import {
  getCreditTaskPolicy,
  type BeeGameCreditTaskPolicy,
  type BeeGameCreditTaskType,
} from '../credit-policy'
import { cleanupRuntimeLayout } from '../runtime-settings-store'
import { createQueryEngineRunner } from './query-engine-runner'

export type BeeGameImageAttachment = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
  filename?: string
}

export type BeeGamePromptInput =
  | string
  | Array<
    | { type: 'text'; text: string }
    | {
      type: 'image'
      source: {
        type: 'base64'
        media_type: BeeGameImageAttachment['mediaType']
        data: string
      }
    }
  >

export type BeeGameSessionStatus = 'running' | 'stopped' | 'failed'

export type BeeGameTurnStatus = 'idle' | 'running'

export type BeeGameSessionLanguage = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko'

export type BeeGameChatThinkingMode = 'enabled' | 'disabled'

export type BeeGameEventType =
  | 'session.started'
  | 'turn.started'
  | 'user.message'
  | 'assistant.message'
  | 'assistant.partial'
  | 'assistant.thinking'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.progress'
  | 'permission.requested'
  | 'permission.resolved'
  | 'runtime.observation'
  | 'system.status'
  | 'result'
  | 'turn.completed'
  | 'turn.empty'
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

export type BeeGameRuntimeSnapshot = {
  sessionId: string
  workspacePath: string
  modelConfigId?: string
  phaseName: string
  phaseStatus: string
  updatedAt: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export type BeeGameArtifact = {
  path: string
  content: string
}

export type BeeGameProjectPackage = {
  filename: string
  contentType: 'application/zip'
  data: Uint8Array
}

export type DeleteBeeGameSessionResult = {
  deleted: boolean
  deletedArtifactPaths: string[]
}

export type BeeGameSessionRunnerStartInput = {
  sessionId: string
  resumeSessionId?: string
  cwd: string
  env: Record<string, string>
}

export type BeeGameSessionSubmitInput = {
  prompt: BeeGamePromptInput
  thinkingMode?: BeeGameChatThinkingMode
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

type PendingCreditOperation =
  | {
      kind: 'settle'
      reservation: CreditReservation
      policy: BeeGameCreditTaskPolicy
      weightedTokens: number
      settleToTotalTokens: number
    }
  | {
      kind: 'refund'
      reservation: CreditReservation
    }

type SessionRecord = {
  session: BeeGameSession
  runtime: RuntimeModelConfig | undefined
  userId: string
  authToken?: string
  projectId?: string
  userDataRoot?: string
  language?: BeeGameSessionLanguage
  transcriptPath: string
  runner: BeeGameSessionRuntime | null
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  trustedSession: boolean
  rememberedPermissions: Set<string>
  rememberedPermissionTools: Set<string>
  monitoredSubagentOutputFiles: Set<string>
  toolUses: Map<string, { toolName: string; input?: unknown }>
  assistantPartialTextByTurn: Map<string, string>
  thinkingBlockIndexes: Set<number>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  lastSettledTotalTokens: number
  pendingCreditOperation: PendingCreditOperation | null
}

type RuntimeObservationFeature = {
  id: string
  label: string
  stage: string
  status: 'available' | 'enabled' | 'disabled'
}

export type StartBeeGameSessionInput = {
  workspacePath: string
  projectId?: string
  modelConfigId?: string
  transcriptSessionId?: string
  userId: string
  authToken?: string
  userDataRoot?: string
  language?: BeeGameSessionLanguage
}

export type BeeGameSessionInternalMetadata = {
  id: string
  userId: string
  projectId?: string
  workspacePath: string
  status: BeeGameSessionStatus
  transcriptPath: string
  modelConfigId?: string
  createdAt: Date
  updatedAt: Date
}

export type BeeGameSessionCreditBackend = {
  reserveCredits: (
    userId: string,
    options: {
      dataDir: string
      credits: number
      kind?: string
      projectId?: string
      idempotencyKey?: string
      metadata?: Record<string, unknown>
      authToken?: string
    },
  ) => CreditReservation | Promise<CreditReservation>
  settleCreditReservation: (
    userId: string,
    options: {
      dataDir: string
      reservationId: string
      weightedTokens: number
      projectId?: string
      idempotencyKey?: string
      metadata?: Record<string, unknown>
      authToken?: string
    },
  ) => CreditSettlement | Promise<CreditSettlement>
  refundCreditReservation: (
    userId: string,
    options: {
      dataDir: string
      reservationId: string
      projectId?: string
      idempotencyKey?: string
      metadata?: Record<string, unknown>
      authToken?: string
    },
  ) => CreditSettlement | Promise<CreditSettlement>
}

const localCreditBackend: BeeGameSessionCreditBackend = {
  reserveCredits,
  settleCreditReservation,
  refundCreditReservation,
}

const MAX_BEEGAME_TURN_BASH_PERMISSION_REQUESTS = 8

export class BeeGameSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly dashboardDataRoot: string

  constructor(
    private readonly runner: BeeGameSessionRunner = createQueryEngineRunner(),
    dashboardDataRoot?: string,
    private readonly getAdditionalRuntimeEnv: (
      userDataRoot?: string,
      userId?: string,
      authToken?: string,
      modelConfigId?: string,
    ) => Record<string, string> | Promise<Record<string, string>> = () => ({}),
    private readonly creditBackend: BeeGameSessionCreditBackend = localCreditBackend,
    private readonly allowExternalRuntimeEnv = false,
  ) {
    this.dashboardDataRoot = resolveExistingPath(
      dashboardDataRoot?.trim() ||
        process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
        resolve(process.cwd(), 'Projects'),
    )
  }

  start(input: StartBeeGameSessionInput): BeeGameSession {
    if (!isAbsolute(input.workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const cwd = resolve(input.workspacePath)
    mkdirSync(cwd, { recursive: true })
    const runtime = input.modelConfigId
      ? mapModelConfigToRuntime(input.modelConfigId)
      : undefined
    if (input.modelConfigId && !runtime && !this.allowExternalRuntimeEnv) {
      throw new Error('Model config not found')
    }

    const now = new Date()
    const sessionId = input.transcriptSessionId ||
      `beegame_${randomUUID().replaceAll('-', '')}`
    const session: BeeGameSession = {
      id: sessionId,
      cwd,
      ...(input.modelConfigId ? { modelConfigId: input.modelConfigId } : {}),
      status: 'running',
      turnStatus: 'idle',
      createdAt: now,
      updatedAt: now,
    }

    const recoveredTranscript = input.transcriptSessionId
      ? readExistingTranscriptForResume(
          input.transcriptSessionId,
          cwd,
        )
      : undefined

    const record: SessionRecord = {
      session,
      runtime,
      userId: input.userId,
      ...(input.authToken ? { authToken: input.authToken } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.userDataRoot ? { userDataRoot: input.userDataRoot } : {}),
      ...(input.language
        ? { language: input.language }
        : recoverSessionLanguage(recoveredTranscript?.events ?? [])),
      transcriptPath: recoveredTranscript?.path ??
        getSessionTranscriptPath(
          session.id,
          session.cwd,
        ),
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      trustedSession: false,
      rememberedPermissions: new Set(),
      rememberedPermissionTools: new Set(),
      monitoredSubagentOutputFiles: new Set(),
      toolUses: new Map(),
      assistantPartialTextByTurn: new Map(),
      thinkingBlockIndexes: new Set(),
      events: recoveredTranscript?.events ?? [],
      nextEventId: recoveredTranscript
        ? getNextTranscriptEventId(recoveredTranscript.events)
        : 1,
      nextTurnIndex: recoveredTranscript
        ? getNextTurnIndex(session.id, recoveredTranscript.events)
        : 1,
      currentTurnId: null,
      lastSettledTotalTokens: recoveredTranscript
        ? getLatestRuntimeUsage(recoveredTranscript.events).total_tokens
        : 0,
      pendingCreditOperation: recoverPendingCreditOperation(
        recoveredTranscript?.events ?? [],
      ),
    }
    archiveInterruptedRecoveredTurn(record)
    this.sessions.set(session.id, record)
    this.refreshCompletedSubagentOutputs(record)
    this.persistRuntimeSnapshot(record)
    this.append(record, 'session.started', `Created BeeGame session in ${cwd}`, {
      type: 'session.started',
      ...(record.language ? { language: record.language } : {}),
    })
    this.appendRuntimeObservation(record, 'initialized')

    return cloneSession(record.session)
  }

  list(userId?: string): BeeGameSession[] {
    return [...this.sessions.values()]
      .filter(record => !userId || record.userId === userId)
      .map(record =>
        cloneSession(record.session),
      )
  }

  get(sessionId: string): BeeGameSession | undefined {
    const record = this.sessions.get(sessionId)
    return record ? cloneSession(record.session) : undefined
  }

  updateAuthToken(sessionId: string, authToken?: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !authToken) return
    record.authToken = authToken
  }

  async retryPendingCreditOperation(sessionId: string): Promise<boolean> {
    const record = this.sessions.get(sessionId)
    if (!record?.pendingCreditOperation) return false
    const operation = record.pendingCreditOperation
    try {
      if (operation.kind === 'settle') {
        const idempotencyKey = `turn:${record.session.id}:retry:settle:${operation.reservation.id}`
        const settlement = await this.creditBackend.settleCreditReservation(record.userId, {
          dataDir: record.userDataRoot ?? this.dashboardDataRoot,
          reservationId: operation.reservation.id,
          weightedTokens: operation.weightedTokens,
          projectId: getCreditProjectId(record),
          idempotencyKey,
          metadata: {
            idempotencyKey,
            taskType: operation.policy.taskType,
            displayName: operation.policy.displayName,
            sessionId: record.session.id,
            ...(record.projectId ? { projectId: record.projectId } : {}),
            workspacePath: record.session.cwd,
            totalTokens: operation.settleToTotalTokens,
            previousSettledTotalTokens: record.lastSettledTotalTokens,
            retry: true,
          },
          ...(record.authToken ? { authToken: record.authToken } : {}),
        })
        record.lastSettledTotalTokens = Math.max(
          record.lastSettledTotalTokens,
          operation.settleToTotalTokens,
        )
        record.pendingCreditOperation = null
        this.append(record, 'system.status', 'Credit settled', {
          type: 'credit.settled',
          reservationId: operation.reservation.id,
          credits: settlement.settledCredits,
          refundedCredits: settlement.refundedCredits,
          weightedTokens: operation.weightedTokens,
          balanceCredits: settlement.balance.balanceCredits,
          retry: true,
        })
        return true
      }
      const idempotencyKey = `turn:${record.session.id}:retry:refund:${operation.reservation.id}`
      const refund = await this.creditBackend.refundCreditReservation(record.userId, {
        dataDir: record.userDataRoot ?? this.dashboardDataRoot,
        reservationId: operation.reservation.id,
        projectId: getCreditProjectId(record),
        idempotencyKey,
        metadata: {
          idempotencyKey,
          sessionId: record.session.id,
          ...(record.projectId ? { projectId: record.projectId } : {}),
          reason: 'turn_finished_without_billable_usage',
          retry: true,
        },
        ...(record.authToken ? { authToken: record.authToken } : {}),
      })
      record.pendingCreditOperation = null
      this.append(record, 'system.status', 'Credit reservation refunded', {
        type: 'credit.refunded',
        reservationId: operation.reservation.id,
        credits: refund.refundedCredits,
        balanceCredits: refund.balance.balanceCredits,
        retry: true,
      })
      return true
    } catch (err) {
      this.append(record, 'system.status', toErrorMessage(err), {
        type: operation.kind === 'settle'
          ? 'credit.settle_retry_failed'
          : 'credit.refund_retry_failed',
        reservationId: operation.reservation.id,
        error: toErrorMessage(err),
      })
      return false
    }
  }

  async retryPendingCreditOperations(
    userId: string,
    authToken?: string,
  ): Promise<{
    attempted: number
    succeeded: string[]
    failed: string[]
  }> {
    const pendingSessionIds = [...this.sessions.values()]
      .filter(record => (
        record.userId === userId &&
        Boolean(record.pendingCreditOperation)
      ))
      .map(record => record.session.id)
    const succeeded: string[] = []
    const failed: string[] = []
    for (const sessionId of pendingSessionIds) {
      if (authToken) this.updateAuthToken(sessionId, authToken)
      if (await this.retryPendingCreditOperation(sessionId)) {
        succeeded.push(sessionId)
      } else {
        failed.push(sessionId)
      }
    }
    return {
      attempted: pendingSessionIds.length,
      succeeded,
      failed,
    }
  }

  metadata(sessionId: string): BeeGameSessionInternalMetadata | undefined {
    const record = this.sessions.get(sessionId)
    if (!record) return undefined
    return {
      id: record.session.id,
      userId: record.userId,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      workspacePath: record.session.cwd,
      status: record.session.status,
      transcriptPath: record.transcriptPath,
      ...(record.session.modelConfigId
        ? { modelConfigId: record.session.modelConfigId }
        : {}),
      createdAt: record.session.createdAt,
      updatedAt: record.session.updatedAt,
    }
  }

  updateModel(sessionId: string, modelConfigId: string): BeeGameSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.turnStatus !== 'idle') {
      throw new Error('Session is already processing a prompt')
    }
    const runtime = mapModelConfigToRuntime(modelConfigId)
    if (!runtime && !this.allowExternalRuntimeEnv) {
      throw new Error('Model config not found')
    }

    record.runtime = runtime
    record.session.modelConfigId = modelConfigId
    record.session.updatedAt = new Date()
    this.persistRuntimeSnapshot(record)
    this.appendRuntimeObservation(record, 'model_updated')
    return cloneSession(record.session)
  }

  runtimeSnapshot(
    sessionId: string,
    workspacePath?: string,
  ): BeeGameRuntimeSnapshot {
    const record = this.sessions.get(sessionId)
    if (record) return this.deriveRuntimeSnapshot(record)
    const persisted = this.readPersistedRuntimeSnapshot(sessionId)
    if (workspacePath) {
      const root = resolveExistingPath(workspacePath)
      const recoveredTranscript = readExistingTranscriptForResume(sessionId, root)
      if (recoveredTranscript) {
        return deriveRuntimeSnapshotFromEvents(
          sessionId,
          root,
          recoveredTranscript.events,
          persisted?.modelConfigId,
          { recoveredFromTranscript: true },
        )
      }
    }
    if (persisted) {
      if (
        !workspacePath ||
        resolveExistingPath(workspacePath) === resolveExistingPath(persisted.workspacePath)
      ) {
        return persisted
      }
    }
    if (workspacePath) {
      const root = resolveExistingPath(workspacePath)
      return deriveRuntimeSnapshotFromEvents(
        sessionId,
        root,
        readExistingTranscriptForResume(sessionId, root)?.events ?? [],
        undefined,
        { recoveredFromTranscript: true },
      )
    }
    throw new Error('Session not found')
  }

  events(sessionId: string, after = 0): BeeGameEvent[] {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    this.refreshCompletedSubagentOutputs(record)
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
    this.refreshCompletedSubagentOutputs(record)
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
    return this.sendWithDisplay(sessionId, text)
  }

  async sendWithDisplay(
    sessionId: string,
    text: string,
    display?: {
      displayText?: string
      displayKind?: string
      taskType?: BeeGameCreditTaskType
      authToken?: string
      clientMessageId?: string
      language?: BeeGameSessionLanguage
      attachments?: BeeGameImageAttachment[]
      thinkingMode?: BeeGameChatThinkingMode
    },
  ): Promise<BeeGameSession> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status !== 'running') {
      throw new Error('Session is not running')
    }
    if (record.session.turnStatus !== 'idle') {
      throw new Error('Session is already processing a prompt')
    }
    if (display?.authToken) record.authToken = display.authToken
    if (display?.language) record.language = display.language

    record.currentTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
    record.nextTurnIndex += 1
    const creditPolicy = getCreditTaskPolicy(display?.taskType ?? display?.displayKind)
    const creditReservation = await this.reserveTurnCredits(record, creditPolicy, display)
    record.session.turnStatus = 'running'
    record.abortController = new AbortController()
    this.append(record, 'turn.started', text)
    this.append(
      record,
      'user.message',
      text,
      {
        type: 'user.message',
        ...(display?.displayText ? { displayText: display.displayText } : {}),
        ...(display?.displayKind ? { displayKind: display.displayKind } : {}),
        ...(display?.clientMessageId ? { clientMessageId: display.clientMessageId } : {}),
      },
    )

    void this.runDirectTurn(
      record,
      buildBeeGamePromptInput({
        text,
        language: record.language,
        attachments: display?.attachments,
      }),
      display?.thinkingMode,
      creditReservation,
      creditPolicy,
    )
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
    if (options.deleteArtifacts) {
      const deletedWorkspacePath = await deleteSessionWorkspaceRoot(
        record,
        this.dashboardDataRoot,
      )
      if (deletedWorkspacePath) deletedArtifactPaths.push(deletedWorkspacePath)
    }
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

  async createProjectPackage(
    sessionId: string,
    workspacePath?: string,
  ): Promise<BeeGameProjectPackage> {
    const record = this.sessions.get(sessionId)
    if (!record && !workspacePath) throw new Error('Session not found')
    if (!record && workspacePath && !isAbsolute(workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const root = resolve(record?.session.cwd ?? workspacePath ?? '')
    const files = await collectPackageFiles(root)
    const data = createZipArchive(
      await Promise.all(
        files.map(async file => ({
          path: file,
          data: await readFile(resolve(root, file)),
        })),
      ),
    )
    return {
      filename: `${basename(root) || 'beegame-project'}.zip`,
      contentType: 'application/zip',
      data,
    }
  }

  private async runDirectTurn(
    record: SessionRecord,
    prompt: BeeGamePromptInput,
    thinkingMode: BeeGameChatThinkingMode | undefined,
    creditReservation?: CreditReservation,
    creditPolicy?: BeeGameCreditTaskPolicy,
  ): Promise<void> {
    let shouldRefundReservation = Boolean(creditReservation)
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      const runner = record.runner ?? await this.runner.start({
        sessionId: record.session.id,
        resumeSessionId: record.session.id,
        cwd: record.session.cwd,
        env: buildRuntimeEnv(
          record.runtime,
          await this.getAdditionalRuntimeEnv(
            record.userDataRoot,
            record.userId,
            record.authToken,
            record.session.modelConfigId,
          ),
        ),
      })
      record.runner = runner
      try {
        const eventCountBeforeTurn = record.events.length
        const toolUseCountBeforeTurn = record.toolUses.size
        await this.submitToRunner(record, runner, prompt, thinkingMode, signal)
        const hadToolUse = record.toolUses.size > toolUseCountBeforeTurn
        const hadRuntimeActivity = hadToolUse || record.events
          .slice(eventCountBeforeTurn)
          .some(event => (
            event.type.startsWith('tool.') ||
            event.type.startsWith('permission.')
          ))
        if (!signal.aborted && record.session.status === 'running') {
          if (!hadRuntimeActivity) {
            this.appendRuntimeObservation(record, 'empty_turn')
            this.append(
              record,
              'turn.empty',
              'Agent ended this turn without using tools. Send continue or retry to start implementation.',
            )
          } else {
            this.appendRuntimeObservation(record, 'turn_completed')
            this.append(record, 'turn.completed', 'Turn ended')
          }
        }
        if (creditReservation) {
          shouldRefundReservation = !await this.settleTurnCredits(
            record,
            creditReservation,
            creditPolicy ?? getCreditTaskPolicy('agent_turn'),
          )
        }
      } finally {
        if (signal.aborted && record.runner === runner) record.runner = null
      }
    } catch (err) {
      record.runner?.stop()
      record.runner = null
      if (creditReservation) {
        shouldRefundReservation = !await this.settleTurnCredits(
          record,
          creditReservation,
          creditPolicy ?? getCreditTaskPolicy('agent_turn'),
        )
      }
      if (record.session.status === 'running') {
        this.append(record, 'turn.failed', toErrorMessage(err))
      }
    } finally {
      if (creditReservation && shouldRefundReservation) {
        await this.refundTurnCredits(record, creditReservation)
      }
      if (record.session.status === 'running') {
        record.session.turnStatus = 'idle'
      }
      cleanupRuntimeLayout({
        dataDir: record.userDataRoot ?? this.dashboardDataRoot,
      })
      record.currentTurnId = null
      record.abortController = null
      record.session.updatedAt = new Date()
    }
  }

  private async submitToRunner(
    record: SessionRecord,
    runner: BeeGameSessionRuntime,
    prompt: BeeGamePromptInput,
    thinkingMode: BeeGameChatThinkingMode | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    await runner.submit({
      prompt,
      thinkingMode: thinkingMode ?? 'disabled',
      signal,
      onMessage: message => {
        appendProjectAgentRawLog(record, message)
        const mapped = mapSDKMessageToEvent(record, message)
        if (mapped) {
          if (mapped.type === 'assistant.partial') {
            this.append(record, mapped.type, mapped.text, message)
            this.appendAssistantPartialText(record, message)
          } else if (mapped.type === 'assistant.message') {
            this.append(record, mapped.type, this.reconcileAssistantText(
              record,
              mapped.text,
            ), message)
          } else {
            this.append(record, mapped.type, mapped.text, mapped.payload ?? message)
          }
        }
        for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
          const appended = this.append(
            record,
            toolEvent.type,
            toolEvent.text,
            toolEvent.payload,
          )
          this.maybeStartSubagentOutputMonitor(record, appended)
        }
      },
      requestPermission: request => this.requestPermission(record, request),
    })
  }

  private appendAssistantPartialText(
    record: SessionRecord,
    message: DashboardSDKMessage,
  ): void {
    const turnId = record.currentTurnId
    if (!turnId) return
    const text = extractAssistantPartialText(message)
    if (!text) return
    record.assistantPartialTextByTurn.set(
      turnId,
      `${record.assistantPartialTextByTurn.get(turnId) ?? ''}${text}`,
    )
  }

  private reconcileAssistantText(record: SessionRecord, finalText: string): string {
    const turnId = record.currentTurnId
    if (!turnId) return finalText
    const partialText = record.assistantPartialTextByTurn.get(turnId)
    record.assistantPartialTextByTurn.delete(turnId)
    const normalizedPartial = partialText?.trim()
    if (!normalizedPartial) return finalText
    return normalizedPartial.length > finalText.trim().length + 24
      ? normalizedPartial
      : finalText
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

  private async requestPermission(
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
    const sessionWorkspaceRoot = record.session.cwd
    const workspaceViolation = getWorkspaceViolation(
      record.session.cwd,
      sessionWorkspaceRoot,
      request,
    )
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
    if (request.toolName === 'Bash' && hasReachedBashPermissionRequestLimit(record)) {
      const message = `BeeGame stopped this turn after too many Bash permission requests (${MAX_BEEGAME_TURN_BASH_PERMISSION_REQUESTS}). The agent should summarize the current result instead of continuing validation.`
      this.append(record, 'permission.resolved', `${request.toolName}: deny`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'deny',
        autoDenied: true,
        reason: message,
        input: request.input,
      })
      throw new Error(message)
    }
    const policyDecision = getBeeGamePermissionPolicyDecision(
      record,
      sessionWorkspaceRoot,
      request,
    )
    if (policyDecision.behavior === 'auto_deny') {
      this.append(record, 'permission.resolved', `${request.toolName}: deny`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'deny',
        autoDenied: true,
        reason: policyDecision.message,
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'deny',
        message: policyDecision.message,
      })
    }
    const signature = permissionSignature(request)
    if (
      policyDecision.behavior === 'auto_allow' ||
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

  private appendRuntimeObservation(
    record: SessionRecord,
    status: 'initialized' | 'turn_completed' | 'empty_turn' | 'model_updated',
  ): void {
    const runtimeSettings = readSessionRuntimeSettings(record.userDataRoot)
    const features: RuntimeObservationFeature[] = [
      {
        id: 'CONTEXT_COLLAPSE',
        label: 'Context collapse',
        stage: 'phase_1',
        status: 'available',
      },
      {
        id: 'HISTORY_SNIP',
        label: 'History snip',
        stage: 'phase_1',
        status: 'available',
      },
      {
        id: 'TOKEN_BUDGET',
        label: 'Token budget',
        stage: 'phase_1',
        status: 'available',
      },
      {
        id: 'PROMPT_CACHE_BREAK_DETECTION',
        label: 'Prompt cache diagnostics',
        stage: 'phase_1',
        status: 'available',
      },
      {
        id: 'SHOT_STATS',
        label: 'Shot stats',
        stage: 'phase_1',
        status: 'available',
      },
      {
        id: 'MONITOR_TOOL',
        label: 'Monitor tool',
        stage: 'phase_1',
        status: 'available',
      },
      ...runtimeSettingsFeatures(runtimeSettings),
    ]
    this.append(record, 'runtime.observation', 'BeeGame runtime observability updated', {
      type: 'runtime.observation',
      status,
      features,
      counters: {
        eventCount: record.events.length,
        toolUseCount: record.toolUses.size,
        turnIndex: Math.max(0, record.nextTurnIndex - 1),
      },
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
  ): BeeGameEvent {
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
    appendProjectRuntimeLog(record, event)
    record.nextEventId += 1
    record.session.updatedAt = new Date()
    this.persistRuntimeSnapshot(record)
    return event
  }

  private persistRuntimeSnapshot(record: SessionRecord): void {
    const snapshot = this.deriveRuntimeSnapshot(record)
    const snapshotPath = getRuntimeSnapshotPath(this.dashboardDataRoot, record.session.id)
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  }

  private deriveRuntimeSnapshot(record: SessionRecord): BeeGameRuntimeSnapshot {
    return deriveRuntimeSnapshotFromEvents(
      record.session.id,
      record.session.cwd,
      record.events,
      record.session.modelConfigId,
    )
  }

  private readPersistedRuntimeSnapshot(
    sessionId: string,
  ): BeeGameRuntimeSnapshot | undefined {
    try {
      return normalizeRuntimeSnapshot(
        JSON.parse(readFileSync(getRuntimeSnapshotPath(this.dashboardDataRoot, sessionId), 'utf8')),
      )
    } catch {
      return undefined
    }
  }

  private async reserveTurnCredits(
    record: SessionRecord,
    policy: BeeGameCreditTaskPolicy,
    display?: { displayText?: string; displayKind?: string },
  ): Promise<CreditReservation | undefined> {
    const dataDir = record.userDataRoot ?? this.dashboardDataRoot
    const turnId = record.currentTurnId ?? `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
    const idempotencyKey = `turn:${record.session.id}:${turnId}:reserve`
    try {
      return await this.creditBackend.reserveCredits(record.userId, {
        dataDir,
        credits: policy.reservedCredits,
        kind: policy.taskType,
        projectId: getCreditProjectId(record),
        idempotencyKey,
        metadata: {
          idempotencyKey,
          turnId,
          taskType: policy.taskType,
          displayName: policy.displayName,
          sessionId: record.session.id,
          ...(record.projectId ? { projectId: record.projectId } : {}),
          workspacePath: record.session.cwd,
          ...(display?.displayKind ? { displayKind: display.displayKind } : {}),
        },
        ...(record.authToken ? { authToken: record.authToken } : {}),
      })
    } catch (err) {
      this.append(record, 'system.status', toErrorMessage(err), {
        type: 'credit.reserve_failed',
        error: toErrorMessage(err),
      })
      throw err
    }
  }

  private async settleTurnCredits(
    record: SessionRecord,
    reservation: CreditReservation,
    policy: BeeGameCreditTaskPolicy,
  ): Promise<boolean> {
    const usage = this.deriveRuntimeSnapshot(record).usage
    const tokenDelta = Math.max(
      0,
      usage.total_tokens - record.lastSettledTotalTokens,
    )
    if (tokenDelta <= 0) return false
    let settlement: CreditSettlement
    const turnId = record.currentTurnId ?? `beegame-turn-${record.session.id}`
    const idempotencyKey = `turn:${record.session.id}:${turnId}:settle:${reservation.id}`
    try {
      settlement = await this.creditBackend.settleCreditReservation(record.userId, {
        dataDir: record.userDataRoot ?? this.dashboardDataRoot,
        reservationId: reservation.id,
        weightedTokens: tokenDelta,
        projectId: getCreditProjectId(record),
        idempotencyKey,
        metadata: {
          idempotencyKey,
          turnId,
          taskType: policy.taskType,
          displayName: policy.displayName,
          sessionId: record.session.id,
          ...(record.projectId ? { projectId: record.projectId } : {}),
          workspacePath: record.session.cwd,
          totalTokens: usage.total_tokens,
          previousSettledTotalTokens: record.lastSettledTotalTokens,
        },
        ...(record.authToken ? { authToken: record.authToken } : {}),
      })
    } catch (err) {
      record.pendingCreditOperation = {
        kind: 'settle',
        reservation,
        policy,
        weightedTokens: tokenDelta,
        settleToTotalTokens: usage.total_tokens,
      }
      this.append(record, 'system.status', toErrorMessage(err), {
        type: 'credit.settle_pending',
        reservationId: reservation.id,
        error: toErrorMessage(err),
        pendingCreditOperation: record.pendingCreditOperation,
        weightedTokens: tokenDelta,
      })
      return true
    }
    record.lastSettledTotalTokens = usage.total_tokens
    this.append(record, 'system.status', 'Credit settled', {
      type: 'credit.settled',
      reservationId: reservation.id,
      credits: settlement.settledCredits,
      refundedCredits: settlement.refundedCredits,
      weightedTokens: tokenDelta,
      balanceCredits: settlement.balance.balanceCredits,
    })
    return true
  }

  private async refundTurnCredits(
    record: SessionRecord,
    reservation: CreditReservation,
  ): Promise<void> {
    const turnId = record.currentTurnId ?? `beegame-turn-${record.session.id}`
    const idempotencyKey = `turn:${record.session.id}:${turnId}:refund:${reservation.id}`
    try {
      const refund = await this.creditBackend.refundCreditReservation(record.userId, {
        dataDir: record.userDataRoot ?? this.dashboardDataRoot,
        reservationId: reservation.id,
        projectId: getCreditProjectId(record),
        idempotencyKey,
        metadata: {
          idempotencyKey,
          turnId,
          sessionId: record.session.id,
          ...(record.projectId ? { projectId: record.projectId } : {}),
          reason: 'turn_finished_without_billable_usage',
        },
        ...(record.authToken ? { authToken: record.authToken } : {}),
      })
      this.append(record, 'system.status', 'Credit reservation refunded', {
        type: 'credit.refunded',
        reservationId: reservation.id,
        credits: refund.refundedCredits,
        balanceCredits: refund.balance.balanceCredits,
      })
    } catch (err) {
      record.pendingCreditOperation = {
        kind: 'refund',
        reservation,
      }
      this.append(record, 'system.status', toErrorMessage(err), {
        type: 'credit.refund_pending',
        reservationId: reservation.id,
        error: toErrorMessage(err),
        pendingCreditOperation: record.pendingCreditOperation,
      })
    }
  }

  private maybeStartSubagentOutputMonitor(
    record: SessionRecord,
    event: BeeGameEvent,
  ): void {
    if (event.type !== 'tool.completed') return
    const payload = event.payload
    const toolName = getDashboardPayloadString(payload, 'toolName')
    if (!isSubagentTool(toolName)) return
    const output = getDashboardPayloadString(payload, 'output')
    const launch = parseAsyncSubagentLaunch(output)
    if (!launch || record.monitoredSubagentOutputFiles.has(launch.outputFile)) {
      return
    }

    record.monitoredSubagentOutputFiles.add(launch.outputFile)
    const toolUseID = getDashboardPayloadString(payload, 'toolUseID')
    const input = getDashboardPayloadRecord(payload, 'input')
    this.append(record, 'tool.progress', 'Subagent running', {
      type: 'tool.progress',
      toolUseID,
      toolName,
      input,
      agentId: launch.agentId,
      status: 'running',
      output: 'Subagent is running in the background.',
    })
    void this.monitorSubagentOutput(record, {
      toolUseID,
      toolName,
      input,
      agentId: launch.agentId,
      outputFile: launch.outputFile,
    })
  }

  private async monitorSubagentOutput(
    record: SessionRecord,
    subagent: {
      toolUseID: string
      toolName: string
      input: Record<string, unknown>
      agentId: string
      outputFile: string
    },
  ): Promise<void> {
    const startedAt = Date.now()
    const timeoutMs = getSubagentMonitorTimeoutMs()
    let lastError = ''
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const raw = await readFile(subagent.outputFile, 'utf8')
        const result = extractCompletedSubagentMessage(raw)
        if (result) {
          this.appendCompletedSubagentOutput(record, subagent, result)
          return
        }
      } catch (err) {
        lastError = toErrorMessage(err)
      }
      await sleep(getSubagentMonitorPollMs())
    }
    this.append(record, 'tool.failed', 'Subagent output unavailable', {
      type: 'tool.failed',
      toolUseID: subagent.toolUseID,
      toolName: subagent.toolName,
      input: subagent.input,
      agentId: subagent.agentId,
      output: lastError
        ? `Subagent did not produce a final report before timeout. Last read error: ${lastError}`
        : 'Subagent did not produce a final report before timeout.',
    })
  }

  private refreshCompletedSubagentOutputs(record: SessionRecord): void {
    for (const event of record.events) {
      if (event.type !== 'tool.completed') continue
      const payload = event.payload
      const toolName = getDashboardPayloadString(payload, 'toolName')
      if (!isSubagentTool(toolName)) continue
      const output = getDashboardPayloadString(payload, 'output')
      const launch = parseAsyncSubagentLaunch(output)
      if (!launch) continue
      if (hasCompletedSubagentOutput(record, launch.agentId)) continue
      record.monitoredSubagentOutputFiles.add(launch.outputFile)
      let raw = ''
      try {
        raw = readFileSync(launch.outputFile, 'utf8')
      } catch {
        continue
      }
      const result = extractCompletedSubagentMessage(raw)
      if (!result) continue
      this.appendCompletedSubagentOutput(record, {
        toolUseID: getDashboardPayloadString(payload, 'toolUseID'),
        toolName,
        input: getDashboardPayloadRecord(payload, 'input'),
        agentId: launch.agentId,
        outputFile: launch.outputFile,
      }, result)
    }
  }

  private appendCompletedSubagentOutput(
    record: SessionRecord,
    subagent: {
      toolUseID: string
      toolName: string
      input: Record<string, unknown>
      agentId: string
      outputFile?: string
    },
    result: string,
  ): void {
    if (hasCompletedSubagentOutput(record, subagent.agentId)) return
    this.append(record, 'tool.completed', 'Subagent completed', {
      type: 'tool.completed',
      toolUseID: subagent.toolUseID,
      toolName: subagent.toolName,
      input: subagent.input,
      agentId: subagent.agentId,
      output: result,
    })
    this.append(record, 'assistant.message', result, {
      type: 'assistant',
      parent_tool_use_id: subagent.toolUseID,
      subagent_id: subagent.agentId,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: result }],
      },
    })
  }
}

function resolveExistingPath(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function isSubagentTool(toolName: string): boolean {
  return toolName === 'Agent' || toolName === 'Task'
}

function hasCompletedSubagentOutput(
  record: SessionRecord,
  agentId: string,
): boolean {
  return record.events.some(event => {
    if (event.type !== 'tool.completed') return false
    if (event.text !== 'Subagent completed') return false
    return getDashboardPayloadString(event.payload, 'agentId') === agentId
  })
}

function parseAsyncSubagentLaunch(
  output: string,
): { agentId: string; outputFile: string } | null {
  if (!output.includes('Async agent launched successfully.')) return null
  const agentIdMatch = output.match(/\bagentId:\s*([^\s(]+)/)
  const outputFileMatch = output.match(/\boutput_file:\s*(\S+)/)
  const agentId = agentIdMatch?.[1]?.trim()
  const outputFile = outputFileMatch?.[1]?.trim()
  if (!agentId || !outputFile || !isAbsolute(outputFile)) return null
  return { agentId, outputFile }
}

function extractCompletedSubagentMessage(raw: string): string {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  for (const line of [...lines].reverse()) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>
      if (entry.type !== 'assistant') continue
      const message = isObject(entry.message) ? entry.message : undefined
      if (!message || message.stop_reason !== 'end_turn') continue
      const text = extractVisibleTextFromContent(message.content)
      if (text.trim()) return text.trim()
    } catch {
      continue
    }
  }
  return ''
}

function getSubagentMonitorTimeoutMs(): number {
  const raw = Number(process.env.BEEGAME_SUBAGENT_MONITOR_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000
}

function getSubagentMonitorPollMs(): number {
  const raw = Number(process.env.BEEGAME_SUBAGENT_MONITOR_POLL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 1000
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

async function deleteSessionWorkspaceRoot(
  record: SessionRecord,
  dashboardDataRoot: string,
): Promise<string | undefined> {
  const workspaceRoot = await realpath(resolve(record.session.cwd))
  const dataRoot = await realpath(resolve(dashboardDataRoot))
  if (workspaceRoot === dataRoot) return undefined
  const rel = relative(dataRoot, workspaceRoot)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  await rm(workspaceRoot, { recursive: true, force: true })
  return workspaceRoot
}

export async function deleteSessionArtifactsFromTranscript(
  sessionId: string,
  cwd: string,
  dashboardDataRoot?: string,
): Promise<string[]> {
  const events = await readSessionTranscriptFromDisk(
    sessionId,
    cwd,
    dashboardDataRoot,
  )
  const roots = getSessionArtifactRootPathsForEvents(cwd, events)
  const deleted: string[] = []
  for (const path of roots) {
    await rm(path, { recursive: true, force: true })
    deleted.push(path)
  }
  return deleted
}

export async function readSessionTranscriptFromDisk(
  sessionId: string,
  cwd: string,
  dashboardDataRoot?: string,
): Promise<Array<{
  id: number
  sessionId?: string
  type: BeeGameEventType
  text: string
  turnId?: string
  payload?: DashboardSDKMessage
  createdAt: string
}>> {
  const transcriptPath = await resolveReadableTranscriptPath(
    sessionId,
    cwd,
  )
  const raw = await readFile(transcriptPath, 'utf8')
  const events = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as {
      sessionId?: string
      id: number
      type: BeeGameEventType
      text: string
      turnId?: string
      payload?: DashboardSDKMessage
      createdAt: string
    })
  return appendCompletedSubagentOutputsFromDisk(transcriptPath, sessionId, events)
}

async function resolveReadableTranscriptPath(
  sessionId: string,
  cwd: string,
): Promise<string> {
  const primary = getSessionTranscriptPath(
    sessionId,
    cwd,
  )
  await readFile(primary, 'utf8')
  return primary
}

function readExistingTranscriptForResume(
  sessionId: string,
  cwd: string,
): { path: string; events: BeeGameEvent[] } | undefined {
  const transcriptPath = resolveReadableTranscriptPathSync(
    sessionId,
    cwd,
  )
  if (!transcriptPath) return undefined
  const raw = readFileSync(transcriptPath, 'utf8')
  return {
    path: transcriptPath,
    events: parseTranscriptEvents(raw),
  }
}

function resolveReadableTranscriptPathSync(
  sessionId: string,
  cwd: string,
): string | undefined {
  const primary = getSessionTranscriptPath(sessionId, cwd)
  try {
    readFileSync(primary, 'utf8')
    return primary
  } catch {
    return undefined
  }
}

function parseTranscriptEvents(raw: string): BeeGameEvent[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parsed = JSON.parse(line) as {
        id: number
        sessionId?: string
        turnId?: string
        type: BeeGameEventType
        text: string
        payload?: DashboardSDKMessage
        createdAt: string
      }
      return {
        id: parsed.id,
        sessionId: parsed.sessionId || '',
        ...(parsed.turnId ? { turnId: parsed.turnId } : {}),
        type: parsed.type,
        text: parsed.text,
        ...(parsed.payload ? { payload: parsed.payload } : {}),
        createdAt: new Date(parsed.createdAt),
      }
    })
}

function appendCompletedSubagentOutputsFromDisk(
  transcriptPath: string,
  fallbackSessionId: string,
  events: Array<{
    id: number
    sessionId?: string
    turnId?: string
    type: BeeGameEventType
    text: string
    payload?: DashboardSDKMessage
    createdAt: string
  }>,
): Array<{
  id: number
  sessionId?: string
  turnId?: string
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
  createdAt: string
}> {
  let nextEventId = events.reduce((max, event) => Math.max(max, event.id), 0) + 1
  for (const event of [...events]) {
    if (event.type !== 'tool.completed') continue
    const payload = event.payload
    const toolName = getDashboardPayloadString(payload, 'toolName')
    if (!isSubagentTool(toolName)) continue
    const launch = parseAsyncSubagentLaunch(
      getDashboardPayloadString(payload, 'output'),
    )
    if (!launch || hasCompletedSubagentOutputInEvents(events, launch.agentId)) {
      continue
    }
    let raw = ''
    try {
      raw = readFileSync(launch.outputFile, 'utf8')
    } catch {
      continue
    }
    const result = extractCompletedSubagentMessage(raw)
    if (!result) continue

    const sessionId = event.sessionId || fallbackSessionId
    const toolUseID = getDashboardPayloadString(payload, 'toolUseID')
    const input = getDashboardPayloadRecord(payload, 'input')
    const completedEvent: BeeGameEvent = {
      id: nextEventId,
      sessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      type: 'tool.completed',
      text: 'Subagent completed',
      payload: {
        type: 'tool.completed',
        toolUseID,
        toolName,
        input,
        agentId: launch.agentId,
        output: result,
      },
      createdAt: new Date(),
    }
    nextEventId += 1
    const messageEvent: BeeGameEvent = {
      id: nextEventId,
      sessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      type: 'assistant.message',
      text: result,
      payload: {
        type: 'assistant',
        parent_tool_use_id: toolUseID,
        subagent_id: launch.agentId,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: result }],
        },
      },
      createdAt: new Date(),
    }
    nextEventId += 1
    appendTranscriptEvent(transcriptPath, completedEvent)
    appendTranscriptEvent(transcriptPath, messageEvent)
    events.push(toDiskTranscriptEvent(completedEvent), toDiskTranscriptEvent(messageEvent))
  }
  return events
}

function hasCompletedSubagentOutputInEvents(
  events: Array<{ type: BeeGameEventType; text: string; payload?: DashboardSDKMessage }>,
  agentId: string,
): boolean {
  return events.some(event =>
    event.type === 'tool.completed' &&
    event.text === 'Subagent completed' &&
    getDashboardPayloadString(event.payload, 'agentId') === agentId,
  )
}

function toDiskTranscriptEvent(event: BeeGameEvent): {
  id: number
  sessionId: string
  turnId?: string
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
  createdAt: string
} {
  return {
    id: event.id,
    sessionId: event.sessionId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    type: event.type,
    text: event.text,
    ...(event.payload ? { payload: event.payload } : {}),
    createdAt: event.createdAt.toISOString(),
  }
}

function getNextTranscriptEventId(events: BeeGameEvent[]): number {
  const maxId = events.reduce((max, event) => Math.max(max, event.id), 0)
  return maxId + 1
}

function getNextTurnIndex(sessionId: string, events: BeeGameEvent[]): number {
  const turnPrefix = `beegame-turn-${sessionId}-`
  let maxTurnIndex = 0
  for (const event of events) {
    const turnId = event.turnId
    if (!turnId?.startsWith(turnPrefix)) continue
    const rawIndex = turnId.slice(turnPrefix.length)
    const index = Number.parseInt(rawIndex, 10)
    if (Number.isFinite(index) && index > maxTurnIndex) {
      maxTurnIndex = index
    }
  }
  return maxTurnIndex + 1
}

function recoverSessionLanguage(
  events: BeeGameEvent[],
): { language: BeeGameSessionLanguage } | Record<string, never> {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const language = events[index]?.payload?.language
    if (isBeeGameSessionLanguage(language)) return { language }
  }
  return {}
}

function recoverPendingCreditOperation(
  events: BeeGameEvent[],
): PendingCreditOperation | null {
  const completedReservationIds = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const type = payload.type
    const reservationId = typeof payload.reservationId === 'string'
      ? payload.reservationId
      : ''
    if (
      (type === 'credit.settled' || type === 'credit.refunded') &&
      reservationId
    ) {
      completedReservationIds.add(reservationId)
      continue
    }
    if (type !== 'credit.settle_pending' && type !== 'credit.refund_pending') {
      continue
    }
    const operation = parsePendingCreditOperation(payload.pendingCreditOperation)
    if (!operation || completedReservationIds.has(operation.reservation.id)) {
      continue
    }
    return operation
  }
  return null
}

function parsePendingCreditOperation(
  value: unknown,
): PendingCreditOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const reservation = parseCreditReservation(record.reservation)
  if (!reservation) return null
  if (record.kind === 'refund') {
    return { kind: 'refund', reservation }
  }
  if (record.kind !== 'settle') return null
  const policy = parseCreditTaskPolicy(record.policy)
  const weightedTokens = normalizeNonNegativeInteger(record.weightedTokens)
  const settleToTotalTokens = normalizeNonNegativeInteger(record.settleToTotalTokens)
  if (!policy || weightedTokens <= 0 || settleToTotalTokens <= 0) return null
  return {
    kind: 'settle',
    reservation,
    policy,
    weightedTokens,
    settleToTotalTokens,
  }
}

function parseCreditReservation(value: unknown): CreditReservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  const reservedCredits = normalizeNonNegativeInteger(record.reservedCredits)
  const balance = record.balance
  if (!balance || typeof balance !== 'object' || Array.isArray(balance)) return null
  return {
    id: record.id,
    reservedCredits,
    balance: balance as CreditReservation['balance'],
  }
}

function parseCreditTaskPolicy(value: unknown): BeeGameCreditTaskPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const taskType = record.taskType
  if (taskType !== 'idea_intake' &&
    taskType !== 'full_build' &&
    taskType !== 'edit_turn' &&
    taskType !== 'continue_turn' &&
    taskType !== 'asset_integration' &&
    taskType !== 'large_build' &&
    taskType !== 'agent_turn') {
    return null
  }
  return {
    taskType,
    reservedCredits: normalizeNonNegativeInteger(record.reservedCredits),
    displayName: typeof record.displayName === 'string'
      ? record.displayName
      : taskType,
    description: typeof record.description === 'string'
      ? record.description
      : '',
  }
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function isBeeGameSessionLanguage(
  value: unknown,
): value is BeeGameSessionLanguage {
  return value === 'en' ||
    value === 'zh' ||
    value === 'zh-TW' ||
    value === 'ja' ||
    value === 'ko'
}

function withSessionLanguageContract(
  prompt: string,
  language?: BeeGameSessionLanguage,
): string {
  if (!language) return prompt
  const instruction = getSessionLanguageInstruction(language)
  if (!instruction) return prompt
  return `${instruction}\n\n${prompt}`
}

function buildBeeGamePromptInput(input: {
  text: string
  language?: BeeGameSessionLanguage
  attachments?: BeeGameImageAttachment[]
}): BeeGamePromptInput {
  const promptText = withSessionLanguageContract(input.text, input.language)
  const images = (input.attachments ?? []).filter(isBeeGameImageAttachment)
  if (images.length === 0) return promptText
  return [
    { type: 'text', text: promptText || 'Analyze the attached image.' },
    ...images.map(image => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
}

function isBeeGameImageAttachment(
  value: unknown,
): value is BeeGameImageAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Partial<BeeGameImageAttachment>
  return attachment.type === 'image' &&
    isSupportedBeeGameImageMediaType(attachment.mediaType) &&
    typeof attachment.data === 'string' &&
    attachment.data.trim().length > 0
}

function isSupportedBeeGameImageMediaType(
  mediaType: unknown,
): mediaType is BeeGameImageAttachment['mediaType'] {
  return mediaType === 'image/png' ||
    mediaType === 'image/jpeg' ||
    mediaType === 'image/gif' ||
    mediaType === 'image/webp'
}

function getSessionLanguageInstruction(
  language: BeeGameSessionLanguage,
): string {
  switch (language) {
    case 'zh':
      return 'Respond to the user in Simplified Chinese. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.'
    case 'zh-TW':
      return 'Respond to the user in Traditional Chinese. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.'
    case 'ja':
      return 'Respond to the user in Japanese. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.'
    case 'ko':
      return 'Respond to the user in Korean. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.'
    case 'en':
      return 'Respond to the user in English. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.'
  }
}

function getSessionTranscriptPath(
  sessionId: string,
  cwd: string,
): string {
  return resolve(
    cwd,
    'transcripts',
    `${getTranscriptProjectPrefix(cwd, sessionId)}__${getShortSessionHash(sessionId)}.jsonl`,
  )
}

function getTranscriptProjectPrefix(cwd: string, sessionId: string): string {
  const normalized = basename(resolve(cwd))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || `project-${getShortSessionHash(sessionId)}`
}

function getShortSessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
}

function getRuntimeSnapshotPath(dataRoot: string, sessionId: string): string {
  return resolve(dataRoot, 'snapshots', `${getSafeSessionFileName(sessionId)}.json`)
}

function getSafeSessionFileName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function deriveRuntimeSnapshotFromEvents(
  sessionId: string,
  workspacePath: string,
  events: BeeGameEvent[],
  modelConfigId: string | undefined,
  options: { recoveredFromTranscript?: boolean } = {},
): BeeGameRuntimeSnapshot {
  const usage = getLatestRuntimeUsage(events)
  const latest = events.at(-1)
  return {
    sessionId,
    workspacePath,
    ...(modelConfigId ? { modelConfigId } : {}),
    phaseName: deriveSnapshotPhaseName(events, options),
    phaseStatus: deriveSnapshotPhaseStatus(events, options),
    updatedAt: latest?.createdAt.toISOString() ?? new Date().toISOString(),
    usage,
  }
}

function deriveSnapshotPhaseName(
  events: BeeGameEvent[],
  options: { recoveredFromTranscript?: boolean } = {},
): string {
  if (options.recoveredFromTranscript) return 'idle'
  if (events.some(event => event.type === 'turn.started' && !hasTurnEnded(events, event.turnId))) {
    return 'running'
  }
  return 'idle'
}

function deriveSnapshotPhaseStatus(
  events: BeeGameEvent[],
  options: { recoveredFromTranscript?: boolean } = {},
): string {
  const latest = events.at(-1)
  if (!latest) return 'idle'
  if (options.recoveredFromTranscript) return 'idle'
  if (latest.type === 'permission.requested') return 'waiting_approval'
  if (latest.type === 'turn.failed' || latest.type === 'session.failed') return 'failed'
  if (deriveSnapshotPhaseName(events, options) === 'running') return 'running'
  return 'idle'
}

function hasTurnEnded(events: BeeGameEvent[], turnId?: string): boolean {
  if (!turnId) return true
  return events.some(event =>
    event.turnId === turnId &&
    (
      event.type === 'turn.completed' ||
      event.type === 'turn.empty' ||
      event.type === 'turn.failed' ||
      event.type === 'result' ||
      event.type === 'session.stopped' ||
      event.type === 'session.failed'
    )
  )
}

function getLatestRuntimeUsage(events: BeeGameEvent[]): BeeGameRuntimeSnapshot['usage'] {
  const assistantUsage = sumAssistantMessageUsage(events)
  if (assistantUsage.total_tokens > 0) return assistantUsage

  for (const event of [...events].reverse()) {
    if (event.type !== 'result') continue
    const usage = getUsageFromEventPayload(event.payload)
    if (usage.total_tokens > 0) return usage
  }
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
}

function sumAssistantMessageUsage(events: BeeGameEvent[]): BeeGameRuntimeSnapshot['usage'] {
  const total = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }
  for (const event of events) {
    if (event.type !== 'assistant.message') continue
    const usage = getUsageFromEventPayload(event.payload)
    total.prompt_tokens += usage.prompt_tokens
    total.completion_tokens += usage.completion_tokens
    total.total_tokens += usage.total_tokens
  }
  return total
}

function getUsageFromEventPayload(
  payload: DashboardSDKMessage | undefined,
): BeeGameRuntimeSnapshot['usage'] {
  const usage = getUsageRecord(payload)
  if (!usage) {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
  }
  const promptTokens = normalizeFiniteNumber(
    usage.input_tokens ?? usage.prompt_tokens,
  )
  const completionTokens = normalizeFiniteNumber(
    usage.output_tokens ?? usage.completion_tokens,
  )
  const totalTokens = normalizeFiniteNumber(
    usage.total_tokens,
    promptTokens + completionTokens,
  )
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  }
}

function getUsageRecord(
  payload: DashboardSDKMessage | undefined,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const directUsage = payload.usage
  if (directUsage && typeof directUsage === 'object' && !Array.isArray(directUsage)) {
    return directUsage as Record<string, unknown>
  }
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null
  }
  const messageUsage = (message as Record<string, unknown>).usage
  if (messageUsage && typeof messageUsage === 'object' && !Array.isArray(messageUsage)) {
    return messageUsage as Record<string, unknown>
  }
  return null
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  return Math.max(0, fallback)
}

function normalizeRuntimeSnapshot(value: unknown): BeeGameRuntimeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid runtime snapshot')
  }
  const record = value as Record<string, unknown>
  const usage = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown>
    : {}
  return {
    sessionId: String(record.sessionId || ''),
    workspacePath: String(record.workspacePath || ''),
    ...(typeof record.modelConfigId === 'string' && record.modelConfigId
      ? { modelConfigId: record.modelConfigId }
      : {}),
    phaseName: String(record.phaseName || 'idle'),
    phaseStatus: String(record.phaseStatus || 'idle'),
    updatedAt: String(record.updatedAt || new Date().toISOString()),
    usage: {
      prompt_tokens: Number(usage.prompt_tokens ?? 0),
      completion_tokens: Number(usage.completion_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
  }
}

const PACKAGE_EXCLUDED_NAMES = new Set(['.git', 'node_modules', '.DS_Store'])

async function collectPackageFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (PACKAGE_EXCLUDED_NAMES.has(entry.name)) continue
      const fullPath = resolve(dir, entry.name)
      const rel = relative(root, fullPath).split('\\').join('/')
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const info = await stat(fullPath)
        if (info.size <= 100 * 1024 * 1024) files.push(rel)
      }
    }
  }
  await walk(root)
  return files.sort((a, b) => a.localeCompare(b))
}

function createZipArchive(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.path)
    const data = file.data
    const crc = crc32(data)
    const localHeader = new Uint8Array(30 + name.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint16(12, 0, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(name, 30)
    localParts.push(localHeader, data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(name, 46)
    centralParts.push(centralHeader)
    offset += localHeader.length + data.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralOffset, true)
  endView.setUint16(20, 0, true)

  const out = new Uint8Array(centralOffset + centralSize + end.length)
  let cursor = 0
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

let crcTable: Uint32Array | undefined

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) {
      let c = i
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
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

function getBeeGamePermissionPolicyDecision(
  record: SessionRecord,
  allowedRoot: string,
  request: DashboardPermissionRequest,
): { behavior: 'auto_allow' | 'auto_deny' | 'ask_user'; message?: string } {
  if (isReadOnlyTool(request.toolName)) return { behavior: 'auto_allow' }
  if (isFileMutationTool(request.toolName)) {
    return {
      behavior: isSafeWorkspaceMutation(record, allowedRoot, request)
        ? 'auto_allow'
        : 'ask_user',
    }
  }
  if (request.toolName === 'Bash') {
    if (isGlobalProcessControlBashCommand(request.input)) {
      return {
        behavior: 'auto_deny',
        message: 'Global process control is managed by BeeGame preview controls.',
      }
    }
    if (isBackgroundProcessBashCommand(request.input)) {
      return {
        behavior: 'auto_deny',
        message: 'Background processes are managed by BeeGame preview controls.',
      }
    }
    return {
      behavior: isSafeBeeGameBashCommand(
        request.input,
        record.session.cwd,
        allowedRoot,
      ) ? 'auto_allow' : 'ask_user',
    }
  }
  return { behavior: 'ask_user' }
}

function isReadOnlyTool(toolName: string): boolean {
  return toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep'
}

function isSafeWorkspaceMutation(
  record: SessionRecord,
  allowedRoot: string,
  request: DashboardPermissionRequest,
): boolean {
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath) return false
  const normalized = getWorkspaceRelativeMutationPath(
    record.session.cwd,
    allowedRoot,
    artifactPath,
  )
  if (!normalized) return false
  return !isSensitiveProjectMutationPath(normalized)
}

function isSensitiveProjectMutationPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean)
  const sensitiveFileNames = new Set([
    '.env',
    '.env.local',
    '.env.production',
    '.npmrc',
    '.yarnrc',
    '.pypirc',
    'id_rsa',
    'id_ed25519',
    'credentials',
    'credentials.json',
    'service-account.json',
  ])
  const sensitiveDirectoryNames = new Set([
    '.aws',
    '.azure',
    '.beegame',
    '.config',
    '.git',
    '.gnupg',
    '.ssh',
  ])
  return segments.some(segment =>
    sensitiveDirectoryNames.has(segment.toLowerCase()) ||
    sensitiveFileNames.has(segment.toLowerCase()),
  )
}

function isSafeBeeGameBashCommand(
  input: Record<string, unknown>,
  cwd: string,
  allowedRoot: string,
): boolean {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command || hasUnsafeShellControlSyntax(command)) return false
  const commandParts = splitShellCommandChain(command)
  if (commandParts.length === 0) return false
  let commandCwd = cwd
  for (const part of commandParts) {
    const tokens = splitShellLike(part)
      .map(cleanShellToken)
      .filter(token => token && !isHarmlessShellRedirectionToken(token))
    if (tokens.length === 0) return false
    if (isSafeChangeDirectoryCommand(tokens, commandCwd, allowedRoot)) {
      commandCwd = resolveCommandDirectory(commandCwd, tokens[1] || '.')
      continue
    }
    if (
      isSafeReadOnlyShellCommand(tokens) ||
      isSafeProjectFilesystemMutationCommand(tokens, commandCwd, allowedRoot) ||
      isSafeProjectFilesystemSetupCommand(tokens, commandCwd, allowedRoot)
    ) {
      continue
    }
    if (tokens.some(token => isDangerousShellToken(token))) return false
    if (tokens.some(token => isSensitiveShellPathToken(commandCwd, allowedRoot, token))) {
      return false
    }
  }
  return true
}

function archiveInterruptedRecoveredTurn(record: SessionRecord): void {
  const turnId = findLatestInterruptedTurnId(record.events)
  if (!turnId) return
  const previousTurnId = record.currentTurnId
  record.currentTurnId = turnId
  record.session.turnStatus = 'idle'
  record.session.status = 'running'
  record.events.push({
    id: record.nextEventId,
    sessionId: record.session.id,
    turnId,
    type: 'turn.failed',
    text: 'Previous BeeGame turn was interrupted before completion.',
    createdAt: new Date(),
  })
  appendTranscriptEvent(record.transcriptPath, record.events.at(-1) as BeeGameEvent)
  record.nextEventId += 1
  record.currentTurnId = previousTurnId
  record.session.updatedAt = new Date()
}

function getCreditProjectId(record: SessionRecord): string {
  return record.projectId || record.session.id
}

function findLatestInterruptedTurnId(events: BeeGameEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn.started' && event.turnId && !hasTurnEnded(events, event.turnId)) {
      return event.turnId
    }
  }
  return ''
}

function hasReachedBashPermissionRequestLimit(record: SessionRecord): boolean {
  if (!record.currentTurnId) return false
  const toolUseIDs = new Set<string>()
  for (const event of record.events) {
    if (event.turnId !== record.currentTurnId) continue
    if (event.type !== 'permission.requested' && event.type !== 'permission.resolved') {
      continue
    }
    const payload = event.payload
    if (payload?.toolName !== 'Bash') continue
    const toolUseID = typeof payload.toolUseID === 'string'
      ? payload.toolUseID
      : `${event.id}`
    toolUseIDs.add(toolUseID)
  }
  return toolUseIDs.size >= MAX_BEEGAME_TURN_BASH_PERMISSION_REQUESTS
}

function isGlobalProcessControlBashCommand(input: Record<string, unknown>): boolean {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command) return false
  return splitShellCommandSegments(command).some(part => {
    const tokens = splitShellLike(part)
      .map(cleanShellToken)
      .filter(token => token && !isHarmlessShellRedirectionToken(token))
    return isGlobalProcessControlTokens(tokens)
  })
}

function isBackgroundProcessBashCommand(input: Record<string, unknown>): boolean {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command) return false
  return hasShellBackgroundOperator(command)
}

function hasShellBackgroundOperator(command: string): boolean {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== '&') continue
    if (command[index - 1] === '>') continue
    if (command[index + 1] === '&') {
      index += 1
      continue
    }
    return true
  }
  return false
}

function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      current += char
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ';' || char === '|' || char === '\n' || char === '\r') {
      if (current.trim()) segments.push(current.trim())
      current = ''
      if (command[index + 1] === char) index += 1
      continue
    }
    if (char === '&' && command[index + 1] === '&') {
      if (current.trim()) segments.push(current.trim())
      current = ''
      index += 1
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

function isGlobalProcessControlTokens(tokens: string[]): boolean {
  const command = tokens[0]?.toLowerCase()
  if (!command) return false
  if (command === 'kill' || command === 'pkill' || command === 'killall') return true
  if (command === 'fuser' && tokens.some(token => token.toLowerCase() === '-k')) return true
  if (
    command === 'xargs' &&
    tokens.slice(1).some(token => {
      const normalized = token.toLowerCase()
      return normalized === 'kill' || normalized === 'pkill' || normalized === 'killall'
    })
  ) {
    return true
  }
  return false
}

function hasUnsafeShellControlSyntax(command: string): boolean {
  return (
    command.includes(';') ||
    command.includes('`') ||
    command.includes('$(')
  )
}

function splitShellCommandChain(command: string): string[] {
  return command
    .split(/&&|\|\||\|/)
    .map(part => part.trim())
    .filter(Boolean)
}

function isHarmlessShellRedirectionToken(token: string): boolean {
  return /^([12])?>&1$/.test(token) ||
    /^([12])?>\/dev\/null$/.test(token) ||
    /^([12])?<\/dev\/null$/.test(token)
}

function isDangerousShellToken(token: string): boolean {
  const normalized = token.toLowerCase()
  if (
    normalized.startsWith('--prefix=') ||
    normalized.startsWith('--location=global')
  ) {
    return true
  }
  return [
    '-g',
    '--global',
    'chmod',
    'chown',
    'mv',
    'rm',
    'sudo',
    'curl',
    'wget',
    'ssh',
    'scp',
    'rsync',
  ].includes(normalized)
}

function isSensitiveShellPathToken(
  cwd: string,
  allowedRoot: string,
  token: string,
): boolean {
  if (!isPathLikeShellToken(token)) return false
  const resolvedPath = isAbsolute(token) ? resolve(token) : resolve(cwd, token)
  const rel = relative(resolve(allowedRoot), resolvedPath).split('\\').join('/')
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return true
  return isSensitiveProjectMutationPath(rel)
}

function isPathLikeShellToken(token: string): boolean {
  if (!token || token.startsWith('-')) return false
  return (
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token === '.' ||
    token === '..' ||
    token.includes('/')
  )
}

function isSafeReadOnlyShellCommand(tokens: string[]): boolean {
  const [command, firstArg] = tokens
  if (command === 'pwd') return tokens.length === 1
  if (command === 'sed') return firstArg === '-n'
  return ['ls', 'cat', 'find', 'grep', 'rg', 'head', 'tail', 'wc'].includes(command)
}

function isSafeChangeDirectoryCommand(
  tokens: string[],
  cwd: string,
  allowedRoot: string,
): boolean {
  if (tokens[0] !== 'cd' || tokens.length !== 2) return false
  return isPathInside(cwd, allowedRoot, tokens[1] || '.')
}

function resolveCommandDirectory(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

function isSafeProjectFilesystemMutationCommand(
  tokens: string[],
  cwd: string,
  allowedRoot: string,
): boolean {
  const [command] = tokens
  if (command === 'rm') {
    const pathArgs = tokens.slice(1).filter(token => !token.startsWith('-'))
    return pathArgs.length > 0 &&
      pathArgs.every(path => isSafeDependencyCleanupPath(cwd, allowedRoot, path))
  }
  return false
}

function isSafeDependencyCleanupPath(
  cwd: string,
  allowedRoot: string,
  path: string,
): boolean {
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
  const workspaceRoot = resolve(allowedRoot)
  const rel = relative(workspaceRoot, resolvedPath).split('\\').join('/')
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false
  if (resolvedPath === resolve(cwd)) return false
  if (path === '.' || path === './' || path === '..') return false
  if (isSensitiveProjectMutationPath(rel)) return false
  const projectRel = relative(resolve(cwd), resolvedPath).split('\\').join('/')
  if (projectRel === '' || projectRel.startsWith('..') || isAbsolute(projectRel)) {
    return false
  }
  const normalized = projectRel.toLowerCase()
  return [
    'node_modules',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ].includes(normalized)
}

function isSafeProjectFilesystemSetupCommand(
  tokens: string[],
  cwd: string,
  allowedRoot: string,
): boolean {
  const [command] = tokens
  if (!command || !['mkdir', 'touch'].includes(command)) return false
  const pathArgs = tokens
    .slice(1)
    .filter(token => !token.startsWith('-'))
  return pathArgs.length > 0 &&
    pathArgs.every(path => isPathInside(cwd, allowedRoot, path))
}

function getMutationArtifactPath(input: Record<string, unknown>): string {
  return String(input.file_path || input.path || input.notebook_path || '').trim()
}

function getWorkspaceRelativeMutationPath(
  cwd: string,
  allowedRoot: string,
  artifactPath: string,
): string {
  const targetPath = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(cwd, artifactPath)
  const rel = relative(resolve(allowedRoot), targetPath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return ''
  return rel.split('\\').join('/')
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
  allowedRoot: string,
  request: Pick<DashboardPermissionRequest, 'toolName' | 'input'>,
): string {
  const paths = extractPermissionPaths(request.input)
  const outsidePath = paths.find(path => !isPathInside(cwd, allowedRoot, path))
  if (!outsidePath) return ''
  return `${request.toolName} requested access outside the current project workspace: ${outsidePath}. This session is restricted to ${allowedRoot}.`
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

function isPathInside(cwd: string, allowedRoot: string, path: string): boolean {
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
  const relativePath = relative(resolve(allowedRoot), resolvedPath)
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

type ProjectLogIndex = {
  version: 1
  project: string
  updatedAt: string
  sessions: Record<string, ProjectLogIndexSession>
}

type ProjectLogIndexSession = {
  sessionId: string
  transcript: string
  agentRawLog: string
  runtimeLog: string
  previewLog: string
  deployLog: string
  updatedAt: string
}

function appendProjectRuntimeLog(record: SessionRecord, event: BeeGameEvent): void {
  if (event.type === 'assistant.partial') return
  try {
    updateProjectLogIndex(record)
    const path = getProjectRuntimeLogPath(record.session.cwd)
    appendFileSync(
      path,
      [
        event.createdAt.toISOString(),
        event.type,
        event.turnId ?? '-',
        collapseLogLine(event.text),
      ].join(' ') + '\n',
      'utf8',
    )
  } catch {
    // Project-local runtime logs are diagnostic only.
  }
}

function appendProjectAgentRawLog(
  record: SessionRecord,
  message: DashboardSDKMessage,
): void {
  try {
    updateProjectLogIndex(record)
    const path = getProjectAgentRawLogPath(record.session.cwd)
    appendFileSync(
      path,
      `${JSON.stringify({
        sessionId: record.session.id,
        ...(record.currentTurnId ? { turnId: record.currentTurnId } : {}),
        createdAt: new Date().toISOString(),
        message: sanitizeBeeGameVisibleValue(message),
      })}\n`,
      'utf8',
    )
  } catch {
    // Raw agent logs must never interrupt the active turn.
  }
}

function updateProjectLogIndex(record: SessionRecord): void {
  const workspacePath = record.session.cwd
  const logsDir = getProjectLogsDir(workspacePath)
  mkdirSync(logsDir, { recursive: true })
  const indexPath = getProjectLogIndexPath(workspacePath)
  const now = new Date().toISOString()
  const index = readProjectLogIndex(indexPath, workspacePath)
  index.updatedAt = now
  index.sessions[record.session.id] = {
    sessionId: record.session.id,
    transcript: toProjectRelativePath(workspacePath, record.transcriptPath),
    agentRawLog: toProjectRelativePath(workspacePath, getProjectAgentRawLogPath(workspacePath)),
    runtimeLog: toProjectRelativePath(workspacePath, getProjectRuntimeLogPath(workspacePath)),
    previewLog: toProjectRelativePath(workspacePath, getProjectPreviewLogPath(workspacePath)),
    deployLog: toProjectRelativePath(workspacePath, getProjectDeployLogPath(workspacePath)),
    updatedAt: now,
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
}

function readProjectLogIndex(path: string, workspacePath: string): ProjectLogIndex {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 1 &&
      parsed.sessions &&
      typeof parsed.sessions === 'object'
    ) {
      return {
        version: 1,
        project: typeof parsed.project === 'string'
          ? parsed.project
          : basename(workspacePath),
        updatedAt: typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date().toISOString(),
        sessions: parsed.sessions as Record<string, ProjectLogIndexSession>,
      }
    }
  } catch {
    // Recreate a damaged or missing index from the active session.
  }
  return {
    version: 1,
    project: basename(workspacePath),
    updatedAt: new Date().toISOString(),
    sessions: {},
  }
}

function getProjectLogsDir(workspacePath: string): string {
  return resolve(workspacePath, 'logs')
}

function getProjectLogIndexPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'index.json')
}

function getProjectRuntimeLogPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'runtime.log')
}

function getProjectAgentRawLogPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'agent.raw.jsonl')
}

function getProjectPreviewLogPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'preview.log')
}

function getProjectDeployLogPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'deploy.log')
}

function toProjectRelativePath(workspacePath: string, path: string): string {
  return relative(workspacePath, path).split('\\').join('/')
}

function collapseLogLine(text: string): string {
  const collapsed = text
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
  return collapsed.length > 800
    ? `${collapsed.slice(0, 797)}...`
    : collapsed
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

function mapSDKMessageToEvent(record: SessionRecord, message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  switch (message.type) {
    case 'user':
      return null
    case 'assistant':
      return mapTextEvent('assistant.message', extractAssistantVisibleText(message))
    case 'partial_assistant':
      return mapTextEvent('assistant.partial', extractAssistantVisibleText(message))
    case 'stream_event':
      return mapStreamEvent(record, message)
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

function mapStreamEvent(record: SessionRecord, message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  const textDelta = extractStreamTextDelta(message)
  if (textDelta.trim()) return mapTextEvent('assistant.partial', textDelta)

  const thinking = extractStreamThinkingStatus(record, message)
  if (!thinking) return null
  return {
    type: 'assistant.thinking',
    text: 'Thinking',
    payload: {
      type: 'assistant.thinking',
      status: thinking,
    },
  }
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
      const existingToolUse = record.toolUses.get(toolUseID)
      record.toolUses.set(toolUseID, { toolName, input })
      if (existingToolUse) continue
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

function extractStreamThinkingStatus(
  record: SessionRecord,
  message: DashboardSDKMessage,
): 'started' | 'streaming' | 'ended' | null {
  const event = getObjectField(message, 'event') ?? message
  const eventType = getStringField(event, 'type')
  if (eventType === 'content_block_start') {
    const contentBlock = getObjectField(event, 'content_block')
    const blockType = getStringField(contentBlock, 'type')
    if (blockType !== 'thinking' && blockType !== 'redacted_thinking') return null
    const index = getNumberField(event, 'index')
    if (index !== undefined) record.thinkingBlockIndexes.add(index)
    return 'started'
  }
  if (eventType === 'content_block_stop') {
    const index = getNumberField(event, 'index')
    if (index === undefined || !record.thinkingBlockIndexes.has(index)) return null
    record.thinkingBlockIndexes.delete(index)
    return 'ended'
  }
  if (eventType !== 'content_block_delta') return null

  const delta = getObjectField(event, 'delta')
  const deltaType = getStringField(delta, 'type')
  return deltaType === 'thinking_delta' || deltaType === 'redacted_thinking_delta'
    ? 'streaming'
    : null
}

function extractAssistantPartialText(message: DashboardSDKMessage): string {
  if (message.type === 'stream_event') return extractStreamTextDelta(message)
  if (message.type === 'partial_assistant') {
    return extractVisibleTextFromContent(getMessageContent(message) ?? message)
  }
  return ''
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

function getNumberField(
  value: Record<string, unknown> | undefined,
  field: string,
): number | undefined {
  const fieldValue = value?.[field]
  return typeof fieldValue === 'number' ? fieldValue : undefined
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
  additionalEnv: Record<string, string> = {},
): Record<string, string> {
  const beegameConfigDir =
    process.env.BEEGAME_CONFIG_DIR ?? resolve(homedir(), '.beegame')
  return {
    BEEGAME_CONFIG_DIR: beegameConfigDir,
    BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
    ...additionalEnv,
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

function readSessionRuntimeSettings(
  userDataRoot: string | undefined,
): Record<string, unknown> {
  if (!userDataRoot) return {}
  const filePath = join(userDataRoot, '.runtime', 'app', 'settings.json')
  if (!existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function runtimeSettingsFeatures(
  settings: Record<string, unknown>,
): RuntimeObservationFeature[] {
  return [
    runtimeSettingsFeature(
      'AUTO_MEMORY',
      'Auto memory',
      settings.autoMemoryEnabled,
    ),
    runtimeSettingsFeature(
      'AUTO_DREAM',
      'Auto dream',
      settings.autoDreamEnabled,
    ),
    runtimeSettingsFeature(
      'SKILL_SEARCH',
      'Skill search',
      settings.skillSearchEnabled,
    ),
    runtimeSettingsFeature(
      'TREE_SITTER_BASH',
      'Tree-sitter Bash',
      settings.treeSitterBashEnabled,
    ),
    runtimeSettingsFeature(
      'WEB_BROWSER_TOOL',
      'Web browser tool',
      settings.webBrowserToolEnabled,
    ),
    runtimeSettingsFeature(
      'BASH_CLASSIFIER',
      'Bash classifier',
      settings.bashClassifierEnabled,
    ),
    runtimeSettingsFeature(
      'MCP_SKILLS',
      'MCP skills',
      settings.mcpSkillsEnabled,
    ),
  ]
}

function runtimeSettingsFeature(
  id: string,
  label: string,
  value: unknown,
): RuntimeObservationFeature {
  return {
    id,
    label,
    stage: 'admin_runtime',
    status: value === true ? 'enabled' : 'disabled',
  }
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
