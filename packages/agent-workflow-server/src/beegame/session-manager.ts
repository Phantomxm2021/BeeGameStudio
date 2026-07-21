import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  resolveApprovedOutboundTarget,
  type ApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
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
import {
  observeNativeAcceptanceTaskNotification,
  observeNativeAcceptanceToolEvent,
} from './native-acceptance-evidence'
import {
  observeNativeDocumentReviewTaskNotification,
  observeNativeDocumentReviewToolEvent,
} from './native-document-review-evidence'
import {
  observeNativeImplementationAuditTaskNotification,
  observeNativeImplementationAuditToolEvent,
} from './native-implementation-audit-evidence'
import { observeNativeResourceLibraryToolEvent } from './native-resource-library-evidence'
import { recordConfirmedBriefEvidence } from './confirmed-brief-evidence'
import { observeNativeToolProvenance } from './native-tool-provenance'
import {
  parseNativeBackgroundTaskLaunch,
  readNativeBackgroundTaskUsage,
} from './native-background-task-output'
import { createProcessIsolatedQueryEngineRunner } from './query-engine-process-runner'
import type { BeeGameNativeTaskNotification } from './native-task-notification'
import type { ResourceSelectionRuntimeConfig } from './resource-selection-config'

export type BeeGameImageAttachment = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
  filename?: string
}

export type BeeGameFileAttachment = {
  type: 'file'
  mediaType: string
  data: string
  filename: string
}

export type BeeGameAttachment = BeeGameImageAttachment | BeeGameFileAttachment

const MAX_BEEGAME_ATTACHMENT_BYTES = 10 * 1024 * 1024
const DOCUMENT_ATTACHMENT_TYPES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.csv': ['text/csv', 'application/csv'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.json': ['application/json', 'text/json'],
  '.jsonl': ['application/jsonl', 'application/x-ndjson', 'text/jsonl'],
}

const IMAGE_ATTACHMENT_TYPES: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
}

export type MaterializedBeeGameFileAttachment = {
  relativePath: string
  filename: string
  mediaType: string
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

export type BeeGameSessionLanguage =
  | 'en'
  | 'zh'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'

export type BeeGameEventType =
  | 'session.started'
  | 'session.resumed'
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
    cache_read_tokens: number
    cache_creation_tokens: number
    total_tokens: number
  }
  roleTokens: {
    mainAgent: number
    reviewer: number
    auditor: number
    validator: number
    otherSubagents: number
    waiting: number
  }
  turnDiagnostics?: {
    turnId: string
    agentCalls: number
    taskOutputCalls: number
    usage: {
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      total_tokens: number
    }
    roleTokens: {
      mainAgent: number
      reviewer: number
      auditor: number
      validator: number
      otherSubagents: number
      waiting: number
    }
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
  /** Platform evidence root exposed only through read-only contract facts. */
  deliveryEvidenceDataRoot?: string
  resumeSessionId?: string
  cwd: string
  env: Record<string, string>
  approvedOutboundTargets: BeeGameApprovedOutboundTargets
  /** Platform-owned resource credentials stay in the worker closure, not its shell environment. */
  resourceSelectionConfig?: ResourceSelectionRuntimeConfig
  language?: BeeGameSessionLanguage
  /** Native background tasks may outlive the foreground turn that spawned them. */
  onNativeTaskNotification?(notification: BeeGameNativeTaskNotification): void
  requestPermission?(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

const RUNTIME_PROVIDER_URL_KEYS = [
  'ANTHROPIC_BASE_URL',
  'OPENAI_BASE_URL',
  'GEMINI_BASE_URL',
  'GROK_BASE_URL',
] as const

export type BeeGameRuntimeProviderUrlKey = (typeof RUNTIME_PROVIDER_URL_KEYS)[number]

export type BeeGameApprovedOutboundTargets = Partial<
  Record<BeeGameRuntimeProviderUrlKey, ApprovedOutboundTarget>
>

export type BeeGameSessionSubmitInput = {
  prompt: BeeGamePromptInput
  /** User-confirmed context exposed read-only to platform contract tools. */
  confirmedBriefContext?: string
  signal: AbortSignal
  onMessage(message: DashboardSDKMessage): void
  onNativeTaskNotification?(notification: BeeGameNativeTaskNotification): void
  requestPermission(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

export type BeeGameSessionRuntime = {
  submit(input: BeeGameSessionSubmitInput): Promise<void>
  stop(): void
  dispose?(): void
}

export type BeeGameSessionRunner = {
  start(input: BeeGameSessionRunnerStartInput): Promise<BeeGameSessionRuntime>
}

function disposeRunner(runner: BeeGameSessionRuntime | null): void {
  if (!runner) return
  if (runner.dispose) runner.dispose()
  else runner.stop()
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
  /** Ephemeral approval scope. Never persisted across isolated sessions. */
  scope?: 'once' | 'session'
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
      settleToWeightedTokens: number
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
  /** Exact canonical JSON supplied by the user's last confirmed build brief. */
  confirmedBriefContext?: string
  transcriptPath: string
  runner: BeeGameSessionRuntime | null
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  toolUses: Map<string, { toolName: string; input?: unknown }>
  assistantPartialTextByMessage: Map<string, string>
  activeAssistantMessageId: string | null
  emittedAssistantMessageIds: Set<string>
  thinkingBlockIndexes: Set<number>
  visibleThinkingBlockIndexes: Set<number>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  lastSettledTotalTokens: number
  lastSettledWeightedTokens: number
  pendingCreditOperation: PendingCreditOperation | null
  pendingCreditRetryInFlight: boolean
  pendingCreditRetryFailures: number
  pendingCreditRetryAfter: number
  resumeEventPending: boolean
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

export class BeeGameSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly dashboardDataRoot: string

  constructor(
    private readonly runner: BeeGameSessionRunner = createProcessIsolatedQueryEngineRunner(),
    dashboardDataRoot?: string,
    private readonly getAdditionalRuntimeEnv: (
      userDataRoot?: string,
      userId?: string,
      authToken?: string,
      modelConfigId?: string,
    ) => Record<string, string> | Promise<Record<string, string>> = () => ({}),
    private readonly creditBackend: BeeGameSessionCreditBackend = localCreditBackend,
    private readonly allowExternalRuntimeEnv = false,
    private readonly outboundTargetPolicyOptions: OutboundTargetPolicyOptions = {},
    private readonly resolveOutboundTarget = resolveApprovedOutboundTarget,
    private readonly resourceSelectionConfig?: ResourceSelectionRuntimeConfig,
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
    const existingLease = [...this.sessions.values()].find(record => (
      record.session.cwd === cwd && record.session.status === 'running'
    ))
    if (existingLease) {
      if (
        input.projectId &&
        existingLease.projectId === input.projectId &&
        existingLease.userId === input.userId
      ) {
        return cloneSession(existingLease.session)
      }
      throw new Error(
        `Workspace is already leased by active BeeGame session ${existingLease.session.id}`,
      )
    }
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
    const confirmedBriefContext = recoverConfirmedBriefContext(
      recoveredTranscript?.events ?? [],
    )
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
      ...(confirmedBriefContext
        ? { confirmedBriefContext }
        : {}),
      transcriptPath: recoveredTranscript?.path ??
        getSessionTranscriptPath(
          session.id,
          session.cwd,
        ),
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      toolUses: new Map(),
      assistantPartialTextByMessage: new Map(),
      activeAssistantMessageId: null,
      emittedAssistantMessageIds: new Set(),
      thinkingBlockIndexes: new Set(),
      visibleThinkingBlockIndexes: new Set(),
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
      lastSettledWeightedTokens: recoveredTranscript
        ? calculateCreditWeightedTokens(getLatestRuntimeUsage(recoveredTranscript.events))
        : 0,
      pendingCreditOperation: recoverPendingCreditOperation(
        recoveredTranscript?.events ?? [],
      ),
      pendingCreditRetryInFlight: false,
      pendingCreditRetryFailures: 0,
      pendingCreditRetryAfter: 0,
      resumeEventPending: Boolean(recoveredTranscript),
    }
    if (confirmedBriefContext) {
      recordConfirmedBriefEvidence({
        dataRoot: this.dashboardDataRoot,
        sessionId: session.id,
        confirmedBriefContext,
        createdAt: now,
      })
    }
    archiveInterruptedRecoveredTurn(record)
    this.sessions.set(session.id, record)
    this.persistRuntimeSnapshot(record)
    if (!recoveredTranscript) {
      this.append(record, 'session.started', `Created BeeGame session in ${cwd}`, {
        type: 'session.started',
        ...(record.language ? { language: record.language } : {}),
      })
    }

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

  language(sessionId: string): BeeGameSessionLanguage | undefined {
    return this.sessions.get(sessionId)?.language
  }

  updateAuthToken(sessionId: string, authToken?: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !authToken) return
    record.authToken = authToken
  }

  async retryPendingCreditOperation(sessionId: string): Promise<boolean> {
    const record = this.sessions.get(sessionId)
    if (!record?.pendingCreditOperation) return false
    if (record.pendingCreditRetryInFlight || Date.now() < record.pendingCreditRetryAfter) return false
    record.pendingCreditRetryInFlight = true
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
            weightedTokenTotal: operation.settleToWeightedTokens,
            previousSettledWeightedTokens: record.lastSettledWeightedTokens,
            retry: true,
          },
          ...(record.authToken ? { authToken: record.authToken } : {}),
        })
        record.lastSettledTotalTokens = Math.max(
          record.lastSettledTotalTokens,
          operation.settleToTotalTokens,
        )
        record.lastSettledWeightedTokens = Math.max(
          record.lastSettledWeightedTokens,
          operation.settleToWeightedTokens,
        )
        record.pendingCreditOperation = null
        record.pendingCreditRetryFailures = 0
        record.pendingCreditRetryAfter = 0
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
      record.pendingCreditRetryFailures = 0
      record.pendingCreditRetryAfter = 0
      this.append(record, 'system.status', 'Credit reservation refunded', {
        type: 'credit.refunded',
        reservationId: operation.reservation.id,
        credits: refund.refundedCredits,
        balanceCredits: refund.balance.balanceCredits,
        retry: true,
      })
      return true
    } catch (err) {
      record.pendingCreditRetryFailures += 1
      const retryAfterMs = Math.min(
        30_000,
        1_000 * (2 ** Math.min(5, record.pendingCreditRetryFailures - 1)),
      )
      record.pendingCreditRetryAfter = Date.now() + retryAfterMs
      this.append(record, 'system.status', toErrorMessage(err), {
        type: operation.kind === 'settle'
          ? 'credit.settle_retry_failed'
          : 'credit.refund_retry_failed',
        reservationId: operation.reservation.id,
        error: toErrorMessage(err),
        retryCount: record.pendingCreditRetryFailures,
        retryAfterMs,
      })
      return false
    } finally {
      record.pendingCreditRetryInFlight = false
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
    return record.events
      .filter(event => event.id > after && !isThinkingProtocolControlEvent(event))
      .map(event => formatBeeGameEventForDisplay(event, record.language))
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
    return record.events
      .filter(event => !isThinkingProtocolControlEvent(event))
      .map(event => formatBeeGameEventForDisplay(event, record.language))
      .map(event => ({
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
      supersedesMessageId?: string
      language?: BeeGameSessionLanguage
      attachments?: BeeGameAttachment[]
      confirmedBriefContext?: string
      onTurnAccepted?: () => void
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
    // Claim the turn synchronously before any preparation, hooks, or remote
    // credit calls can yield. Delivery resume and polling paths may race each
    // other; without this claim they can start the same logical turn twice.
    record.session.turnStatus = 'running'
    let turnAccepted = false
    try {
    if (display?.authToken) record.authToken = display.authToken
    if (display?.language) record.language = display.language
    if (display?.confirmedBriefContext) {
      record.confirmedBriefContext = display.confirmedBriefContext
      recordConfirmedBriefEvidence({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        confirmedBriefContext: display.confirmedBriefContext,
        createdAt: new Date(),
      })
    }
    if (record.resumeEventPending) {
      record.resumeEventPending = false
      this.append(record, 'session.resumed', `Resumed BeeGame session in ${record.session.cwd}`, {
        type: 'session.resumed',
        ...(record.language ? { language: record.language } : {}),
      })
    }

    const preparedPrompt = await prepareBeeGamePromptInput({
      text,
      workspace: record.session.cwd,
      attachments: display?.attachments,
      displayKind: display?.displayKind,
    })
    const promptWithConfirmedContext = display?.displayKind === 'confirmed_brief'
      ? preparedPrompt.prompt
      : attachConfirmedBriefContext(
          preparedPrompt.prompt,
          record.confirmedBriefContext,
        )
    const nextTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
    const creditPolicy = getCreditTaskPolicy(display?.taskType ?? display?.displayKind)
    const creditReservation = await this.reserveTurnCredits(record, creditPolicy, display, nextTurnId)
    record.assistantPartialTextByMessage.clear()
    record.activeAssistantMessageId = null
    record.emittedAssistantMessageIds.clear()
    record.thinkingBlockIndexes.clear()
    record.visibleThinkingBlockIndexes.clear()
    record.currentTurnId = nextTurnId
    record.nextTurnIndex += 1
    display?.onTurnAccepted?.()
    turnAccepted = true
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
        ...(display?.confirmedBriefContext
          ? { confirmedBriefContext: display.confirmedBriefContext }
          : {}),
        ...(display?.clientMessageId ? { clientMessageId: display.clientMessageId } : {}),
        ...(display?.supersedesMessageId ? { supersedesMessageId: display.supersedesMessageId } : {}),
      },
    )

    void this.runDirectTurn(
      record,
      promptWithConfirmedContext,
      creditReservation,
      creditPolicy,
      preparedPrompt.attachmentDirectory,
    )
    return cloneSession(record.session)
    } catch (error) {
      if (!turnAccepted) {
        record.currentTurnId = null
        record.abortController = null
        record.session.turnStatus = 'idle'
      }
      throw error
    }
  }

  stop(sessionId: string): BeeGameSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status === 'running') {
      record.abortController?.abort()
      disposeRunner(record.runner)
      record.runner = null
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        message: 'Session stopped before permission was resolved',
      })
      record.session.status = 'stopped'
      record.session.turnStatus = 'idle'
      record.session.updatedAt = new Date()
      this.closeOpenThinkingLifecycle(record, 'session_stopped')
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
      disposeRunner(record.runner)
      record.runner = null
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
    creditReservation?: CreditReservation,
    creditPolicy?: BeeGameCreditTaskPolicy,
    attachmentDirectory?: string,
  ): Promise<void> {
    let shouldRefundReservation = Boolean(creditReservation)
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      const env = buildRuntimeEnv(
        record.runtime,
        await this.getAdditionalRuntimeEnv(
          record.userDataRoot,
          record.userId,
          record.authToken,
          record.session.modelConfigId,
        ),
      )
      const approvedOutboundTargets = await this.resolveRuntimeOutboundTargets(env)
      const runner = record.runner ?? await this.runner.start({
        sessionId: record.session.id,
        deliveryEvidenceDataRoot: this.dashboardDataRoot,
        resumeSessionId: record.session.id,
        cwd: record.session.cwd,
        env,
        approvedOutboundTargets,
        ...(this.resourceSelectionConfig && env.BEEGAME_RESOURCE_LIBRARY_ENABLED !== '0'
          ? { resourceSelectionConfig: this.resourceSelectionConfig }
          : {}),
        ...(record.language ? { language: record.language } : {}),
        onNativeTaskNotification: notification =>
          this.observeNativeTaskNotification(record, notification),
        requestPermission: request => this.requestPermission(record, request),
      })
      record.runner = runner
      try {
        await this.submitToRunner(record, runner, prompt, signal)
        if (!signal.aborted && record.session.status === 'running') {
          const turnId = record.currentTurnId
          const hasFinalResult = hasNativeFinalResult(record.events, turnId)
          this.closeOpenThinkingLifecycle(
            record,
            hasFinalResult ? 'turn_completed' : 'turn_empty',
          )
          if (hasFinalResult) {
            this.append(record, 'turn.completed', 'Turn ended')
          } else {
            this.append(
              record,
              'turn.empty',
              getEmptyTurnMessage(record.language),
              {
                type: 'turn.empty',
                reason: 'missing_native_final_result',
              },
            )
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
        if (signal.aborted && record.runner === runner) {
          disposeRunner(record.runner)
          record.runner = null
        }
      }
    } catch (err) {
      disposeRunner(record.runner)
      record.runner = null
      if (creditReservation) {
        shouldRefundReservation = !await this.settleTurnCredits(
          record,
          creditReservation,
          creditPolicy ?? getCreditTaskPolicy('agent_turn'),
        )
      }
      if (record.session.status === 'running') {
        this.closeOpenThinkingLifecycle(record, 'turn_failed')
        this.append(
          record,
          'turn.failed',
          formatRuntimeErrorForDisplay(toErrorMessage(err), record.language),
        )
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
      if (attachmentDirectory) {
        await rm(attachmentDirectory, { recursive: true, force: true })
      }
      record.currentTurnId = null
      record.assistantPartialTextByMessage.clear()
      record.activeAssistantMessageId = null
      record.emittedAssistantMessageIds.clear()
      record.thinkingBlockIndexes.clear()
      record.visibleThinkingBlockIndexes.clear()
      record.abortController = null
      record.session.updatedAt = new Date()
    }
  }

  private async resolveRuntimeOutboundTargets(
    env: Record<string, string>,
  ): Promise<BeeGameApprovedOutboundTargets> {
    const targets: BeeGameApprovedOutboundTargets = {}
    for (const key of RUNTIME_PROVIDER_URL_KEYS) {
      const value = env[key]
      if (!value) continue
      const target = await this.resolveOutboundTarget(
        value,
        this.outboundTargetPolicyOptions,
      )
      if (!target) {
        throw new Error('Outbound URL is not permitted')
      }
      targets[key] = target
    }
    return targets
  }

  private async submitToRunner(
    record: SessionRecord,
    runner: BeeGameSessionRuntime,
    prompt: BeeGamePromptInput,
    signal: AbortSignal,
  ): Promise<void> {
    const submittedTurnId = record.currentTurnId
    let executionError: Error | undefined
    await runner.submit({
      prompt,
      ...(record.confirmedBriefContext
        ? { confirmedBriefContext: record.confirmedBriefContext }
        : {}),
      signal,
      onMessage: message => {
        appendProjectAgentRawLog(record, message)
        if (isSDKExecutionError(message)) {
          executionError = new Error(getSDKExecutionErrorDetail(message))
        }
        // Timed-out runtimes can flush synthetic messages after their turn closed.
        // Preserve raw diagnostics without leaking them into chat or a later turn.
        if (
          !submittedTurnId ||
          record.currentTurnId !== submittedTurnId ||
          hasTurnEnded(record.events, submittedTurnId)
        ) return
        const mapped = mapSDKMessageToEvent(record, message)
        if (mapped) {
          if (mapped.type === 'assistant.partial') {
            this.append(record, mapped.type, mapped.text, message)
            this.appendAssistantPartialText(record, message)
          } else if (mapped.type === 'assistant.message') {
            const reconciled = this.reconcileAssistantText(record, message, mapped.text)
            if (reconciled) this.append(record, mapped.type, reconciled, message)
          } else {
            this.append(record, mapped.type, mapped.text, mapped.payload ?? message)
          }
        }
        for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
          this.append(
            record,
            toolEvent.type,
            toolEvent.text,
            toolEvent.payload,
          )
        }
      },
      requestPermission: request => this.requestPermission(record, request),
    })
    if (executionError && !signal.aborted) throw executionError
  }

  private observeNativeTaskNotification(
    record: SessionRecord,
    notification: BeeGameNativeTaskNotification,
  ): void {
    const evidenceInput = {
      dataRoot: this.dashboardDataRoot,
      sessionId: record.session.id,
      workspacePath: record.session.cwd,
      ...(record.currentTurnId ? { turnId: record.currentTurnId } : {}),
      notification,
      createdAt: new Date(),
    }
    try {
      observeNativeDocumentReviewTaskNotification(evidenceInput)
    } catch (error) {
      console.warn('[BeeGame] Failed to persist native document review notification', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeAcceptanceTaskNotification(evidenceInput)
    } catch (error) {
      console.warn('[BeeGame] Failed to persist native acceptance notification', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeImplementationAuditTaskNotification(evidenceInput)
    } catch (error) {
      console.warn('[BeeGame] Failed to persist native implementation audit notification', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
  }

  private appendAssistantPartialText(
    record: SessionRecord,
    message: DashboardSDKMessage,
  ): void {
    const messageKey = record.activeAssistantMessageId ?? record.currentTurnId
    if (!messageKey) return
    const text = extractAssistantPartialText(message)
    if (!text) return
    record.assistantPartialTextByMessage.set(
      messageKey,
      `${record.assistantPartialTextByMessage.get(messageKey) ?? ''}${text}`,
    )
  }

  private reconcileAssistantText(
    record: SessionRecord,
    message: DashboardSDKMessage,
    finalText: string,
  ): string | null {
    const messageId = getSDKAssistantMessageId(message) ?? record.activeAssistantMessageId
    if (messageId && record.emittedAssistantMessageIds.has(messageId)) return null

    const messageKey = messageId ?? record.currentTurnId
    const partialText = messageKey
      ? record.assistantPartialTextByMessage.get(messageKey)
      : undefined
    if (messageKey) record.assistantPartialTextByMessage.delete(messageKey)
    if (messageId) record.emittedAssistantMessageIds.add(messageId)
    const normalizedPartial = partialText?.trim()
    if (!normalizedPartial) return finalText
    if (messageId) return normalizedPartial
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
        scope: decision.scope ?? 'once',
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
      const message = 'This headless BeeGame session cannot collect structured AskUserQuestion answers. Ask the user in the assistant response instead.'
      this.append(record, 'permission.resolved', `${request.toolName}: deny`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'deny',
        autoDenied: true,
        reason: message,
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'deny',
        message,
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

  private closeOpenThinkingLifecycle(record: SessionRecord, reason: string): void {
    if (record.thinkingBlockIndexes.size === 0) return
    record.thinkingBlockIndexes.clear()
    if (record.visibleThinkingBlockIndexes.size === 0) return
    record.visibleThinkingBlockIndexes.clear()
    this.append(record, 'assistant.thinking', 'Thinking', {
      type: 'assistant.thinking',
      status: 'ended',
      reason,
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
    const event: BeeGameEvent = {
      id: record.nextEventId,
      sessionId: record.session.id,
      ...(record.currentTurnId ? { turnId: record.currentTurnId } : {}),
      type,
      text,
      ...(payload ? { payload } : {}),
      createdAt: new Date(),
    }
    record.events.push(event)
    appendTranscriptEvent(record.transcriptPath, event)
    appendProjectRuntimeLog(record, event)
    try {
      observeNativeToolProvenance({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        eventType: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    } catch (error) {
      console.warn('[BeeGame] Failed to persist native tool provenance', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeDocumentReviewToolEvent({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        workspacePath: record.session.cwd,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        eventType: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    } catch (error) {
      // Delivery provenance is a passive gate, never an Agent runtime
      // controller. Failure to persist it must not interrupt Claude Code.
      console.warn('[BeeGame] Failed to persist native document review evidence', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeAcceptanceToolEvent({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        workspacePath: record.session.cwd,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        eventType: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    } catch (error) {
      // Acceptance provenance is a deployment gate, never an Agent runtime
      // controller. Failure to persist it must not interrupt Claude Code.
      console.warn('[BeeGame] Failed to persist native delivery evidence', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeImplementationAuditToolEvent({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        workspacePath: record.session.cwd,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        eventType: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    } catch (error) {
      // Audit provenance is passive evidence. Persistence failure must not
      // interrupt or steer Claude Code's native Agent lifecycle.
      console.warn('[BeeGame] Failed to persist native implementation audit evidence', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
    try {
      observeNativeResourceLibraryToolEvent({
        dataRoot: this.dashboardDataRoot,
        sessionId: record.session.id,
        workspacePath: record.session.cwd,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        eventType: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    } catch (error) {
      // Resource provenance is passive evidence for library-first fallback.
      // It must never alter or interrupt Claude Code's native tool lifecycle.
      console.warn('[BeeGame] Failed to persist native resource query evidence', {
        sessionId: record.session.id,
        cause: error instanceof Error ? error.name : 'unknown_error',
      })
    }
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
    requestedTurnId?: string,
  ): Promise<CreditReservation | undefined> {
    const dataDir = record.userDataRoot ?? this.dashboardDataRoot
    const turnId = requestedTurnId ?? record.currentTurnId ?? `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
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
    const weightedTokenTotal = calculateCreditWeightedTokens(usage)
    const tokenDelta = Math.max(
      0,
      weightedTokenTotal - record.lastSettledWeightedTokens,
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
          weightedTokenTotal,
          previousSettledWeightedTokens: record.lastSettledWeightedTokens,
          creditWeights: CREDIT_TOKEN_WEIGHTS,
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
        settleToWeightedTokens: weightedTokenTotal,
      }
      record.pendingCreditRetryFailures = 0
      record.pendingCreditRetryAfter = 0
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
    record.lastSettledWeightedTokens = weightedTokenTotal
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
      record.pendingCreditRetryFailures = 0
      record.pendingCreditRetryAfter = 0
      this.append(record, 'system.status', toErrorMessage(err), {
        type: 'credit.refund_pending',
        reservationId: reservation.id,
        error: toErrorMessage(err),
        pendingCreditOperation: record.pendingCreditOperation,
      })
    }
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
  return events
}

export type RecoveredProjectSessionMetadata = {
  id: string
  workspacePath: string
  status: 'running' | 'stopped' | 'failed'
  transcriptPath: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Recover the latest durable session reference from an owned project workspace.
 *
 * The project log index is a persistence fallback, not an authorization source:
 * callers must establish workspace ownership before invoking this function.
 */
export async function recoverLatestProjectSessionFromDisk(
  workspacePath: string,
): Promise<RecoveredProjectSessionMetadata | undefined> {
  let index: ProjectLogIndex
  try {
    const raw = await readFile(getProjectLogIndexPath(workspacePath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectLogIndex>
    if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') {
      return undefined
    }
    index = {
      version: 1,
      project: typeof parsed.project === 'string' ? parsed.project : basename(workspacePath),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      sessions: parsed.sessions as Record<string, ProjectLogIndexSession>,
    }
  } catch {
    return undefined
  }

  const candidates = Object.entries(index.sessions)
    .filter(([sessionId, entry]) => (
      Boolean(sessionId) &&
      entry?.sessionId === sessionId &&
      typeof entry.transcript === 'string' &&
      typeof entry.updatedAt === 'string'
    ))
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))

  for (const [sessionId, entry] of candidates) {
    const indexedTranscriptPath = resolve(workspacePath, entry.transcript)
    const expectedTranscriptPath = getSessionTranscriptPath(sessionId, workspacePath)
    if (
      relative(workspacePath, indexedTranscriptPath).startsWith('..') ||
      indexedTranscriptPath !== expectedTranscriptPath
    ) {
      continue
    }
    try {
      const events = await readSessionTranscriptFromDisk(sessionId, workspacePath)
      if (
        events.length === 0 ||
        events.some(event => event.sessionId && event.sessionId !== sessionId)
      ) {
        continue
      }
      const terminalType = events.at(-1)?.type
      const status = terminalType === 'session.failed'
        ? 'failed'
        : terminalType === 'session.stopped'
          ? 'stopped'
          : 'running'
      return {
        id: sessionId,
        workspacePath,
        status,
        transcriptPath: entry.transcript,
        createdAt: new Date(events[0]?.createdAt || entry.updatedAt),
        updatedAt: new Date(events.at(-1)?.createdAt || entry.updatedAt),
      }
    } catch {
      // A stale index entry must not prevent trying an older valid session.
    }
  }
  return undefined
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
  const settleToWeightedTokens = normalizeNonNegativeInteger(
    record.settleToWeightedTokens ?? weightedTokens,
  )
  if (!policy || weightedTokens <= 0 || settleToTotalTokens <= 0 || settleToWeightedTokens <= 0) return null
  return {
    kind: 'settle',
    reservation,
    policy,
    weightedTokens,
    settleToTotalTokens,
    settleToWeightedTokens,
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
    value === 'ko' ||
    value === 'fr' ||
    value === 'de' ||
    value === 'es' ||
    value === 'it' ||
    value === 'pt'
}

function recoverConfirmedBriefContext(events: BeeGameEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user.message' || !isRuntimeRecord(event.payload)) continue
    if (event.payload.displayKind !== 'confirmed_brief') continue
    const context = event.payload.confirmedBriefContext
    if (typeof context === 'string' && context.trim()) return context.trim()
    const marker = '\nConfirmed brief:\n'
    const markerIndex = event.text.lastIndexOf(marker)
    if (markerIndex >= 0) {
      const recovered = event.text.slice(markerIndex + marker.length).trim()
      if (recovered) return recovered
    }
  }
  return undefined
}

function attachConfirmedBriefContext(
  prompt: BeeGamePromptInput,
  confirmedBriefContext?: string,
): BeeGamePromptInput {
  if (!confirmedBriefContext?.trim()) return prompt
  const context = [
    'Session-confirmed brief (immutable user-confirmed context):',
    confirmedBriefContext.trim(),
    'Project files, generated summaries, and prior agent conclusions cannot change these confirmed values. Only a new explicit user confirmation can replace them.',
  ].join('\n')
  if (typeof prompt === 'string') return `${context}\n\nCurrent user request:\n${prompt}`
  const blocks = [...prompt]
  const textIndex = blocks.findIndex(block => block.type === 'text')
  if (textIndex < 0) return [{ type: 'text', text: context }, ...blocks]
  const block = blocks[textIndex]
  if (block?.type !== 'text') return blocks
  blocks[textIndex] = {
    type: 'text',
    text: `${context}\n\nCurrent user request:\n${block.text}`,
  }
  return blocks
}

async function prepareBeeGamePromptInput(input: {
  text: string
  workspace: string
  attachments?: BeeGameAttachment[]
  displayKind?: string
}): Promise<{ prompt: BeeGamePromptInput; attachmentDirectory?: string }> {
  const images = (input.attachments ?? []).filter(isBeeGameImageAttachment)
  const files = (input.attachments ?? []).filter(isBeeGameFileAttachment)
  const materializedFiles = files.length > 0
    ? await materializeBeeGameFileAttachments(input.workspace, files)
    : []
  const documentContext = materializedFiles.length > 0
    ? `\n\nAttached documents:\n${materializedFiles.map(file => `- ${file.filename} (${file.mediaType}): ${file.relativePath}`).join('\n')}`
    : ''
  const requestText = input.text || (images.length > 0 ? 'Analyze the attached image.' : '')
  const userInput = `${requestText}${documentContext}`
  // BeeGame forwards the user's objective without a hidden execution plan.
  // Native Claude Code owns Skill selection, tool use, implementation and
  // validation exactly as it does in the TUI.
  const promptText = userInput
  if (images.length === 0) {
    return {
      prompt: promptText,
      ...(materializedFiles.length > 0 ? { attachmentDirectory: join(input.workspace, '.beegame-attachments') } : {}),
    }
  }
  return {
    prompt: [
    { type: 'text', text: promptText || 'Analyze the attached image.' },
    ...images.map(image => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
    ],
    ...(materializedFiles.length > 0 ? { attachmentDirectory: join(input.workspace, '.beegame-attachments') } : {}),
  }
}

export async function materializeBeeGameFileAttachments(
  workspace: string,
  attachments: BeeGameFileAttachment[],
): Promise<MaterializedBeeGameFileAttachment[]> {
  if (attachments.length === 0) return []
  const attachmentDirectory = join(workspace, '.beegame-attachments')
  await mkdir(attachmentDirectory, { recursive: true })

  try {
    return await Promise.all(attachments.map(async (attachment) => {
      const filename = basename(attachment.filename)
      const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
      const allowedTypes = DOCUMENT_ATTACHMENT_TYPES[extension]
      if (!filename || !allowedTypes || !allowedTypes.includes(attachment.mediaType)) {
        throw new Error(`Unsupported document attachment: ${attachment.filename}`)
      }
      const data = Buffer.from(attachment.data, 'base64')
      if (data.length === 0 || data.length > MAX_BEEGAME_ATTACHMENT_BYTES) {
        throw new Error(`Invalid document attachment size: ${attachment.filename}`)
      }
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'attachment'
      const storedFilename = `${randomUUID()}-${safeFilename}`
      const storedPath = join(attachmentDirectory, storedFilename)
      await writeFile(storedPath, data, { flag: 'wx' })
      return {
        relativePath: relative(workspace, storedPath),
        filename,
        mediaType: attachment.mediaType,
      }
    }))
  } catch (error) {
    await rm(attachmentDirectory, { recursive: true, force: true })
    throw error
  }
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

function isBeeGameFileAttachment(
  value: unknown,
): value is BeeGameFileAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Partial<BeeGameFileAttachment>
  return attachment.type === 'file' &&
    typeof attachment.mediaType === 'string' &&
    typeof attachment.filename === 'string' &&
    typeof attachment.data === 'string' &&
    attachment.data.trim().length > 0
}

function isSupportedBeeGameImageMediaType(
  mediaType: unknown,
): mediaType is BeeGameImageAttachment['mediaType'] {
  return mediaType === 'image/png' ||
    mediaType === 'image/jpeg' ||
    mediaType === 'image/webp'
}

function getEmptyTurnMessage(language?: BeeGameSessionLanguage): string {
  switch (language) {
    case 'zh':
      return 'Claude Code 已结束本轮，但没有返回最终答复。当前任务可能尚未完成，请在同一会话中继续。'
    case 'zh-TW':
      return 'Claude Code 已結束本輪，但沒有返回最終答覆。目前任務可能尚未完成，請在同一工作階段中繼續。'
    case 'ja':
      return 'Claude Code はこのターンを終了しましたが、最終回答を返しませんでした。タスクが未完了の可能性があるため、同じセッションで続行してください。'
    case 'ko':
      return 'Claude Code가 이 턴을 종료했지만 최종 답변을 반환하지 않았습니다. 작업이 완료되지 않았을 수 있으므로 같은 세션에서 계속하세요.'
    case 'en':
    default:
      return 'Claude Code ended the turn without a final response. The task may be incomplete; continue in the same session.'
  }
}

/**
 * Converts a structured provider error envelope into readable chat text while
 * leaving the original SDK message untouched in agent.raw.jsonl and payloads.
 * Detection is based on the JSON shape, not provider names or message phrases.
 */
export function formatRuntimeErrorForDisplay(
  value: string,
  language?: BeeGameSessionLanguage,
): string {
  const text = value.trim()
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const jsonStart = objectStart < 0
    ? arrayStart
    : arrayStart < 0
      ? objectStart
      : Math.min(objectStart, arrayStart)
  if (jsonStart < 0) return text
  const prefix = text.slice(0, jsonStart).trim()
  let envelope: unknown
  try {
    envelope = JSON.parse(text.slice(jsonStart)) as unknown
  } catch {
    return text
  }
  const status = findHttpStatus(prefix)
  const hasErrorContainer = isObject(envelope) && Object.hasOwn(envelope, 'error')
  if (!status && !hasErrorContainer) return text
  const messages = collectStructuredMessages(envelope)
  if (messages.length) return messages.join('\n\n')
  const heading = prefix || runtimeErrorHeading(language)
  const details = renderStructuredValue(envelope)
  if (!details.length) return heading
  const rendered = `${heading}\n\n${details.join('\n')}`
  return rendered.length > 6_000 ? `${rendered.slice(0, 5_997)}...` : rendered
}

export function formatBeeGameEventForDisplay(
  event: BeeGameEvent,
  language?: BeeGameSessionLanguage,
): BeeGameEvent {
  if (
    event.type !== 'assistant.message' &&
    event.type !== 'turn.failed' &&
    event.type !== 'session.failed'
  ) return { ...event }
  return {
    ...event,
    text: formatRuntimeErrorForDisplay(event.text, language),
  }
}

function collectStructuredMessages(value: unknown, depth = 0): string[] {
  if (depth > 6) return []
  if (Array.isArray(value)) {
    return deduplicateStrings(value.flatMap(item => collectStructuredMessages(item, depth + 1)))
  }
  if (!isObject(value)) return []
  const direct = typeof value.message === 'string' && value.message.trim()
    ? [value.message.trim()]
    : []
  const nested = Object.entries(value)
    .filter(([key]) => key !== 'message')
    .flatMap(([, item]) => collectStructuredMessages(item, depth + 1))
  return deduplicateStrings([...direct, ...nested])
}

function deduplicateStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function runtimeErrorHeading(language?: BeeGameSessionLanguage): string {
  switch (language) {
    case 'zh': return '请求失败'
    case 'zh-TW': return '請求失敗'
    case 'ja': return 'リクエストに失敗しました'
    case 'ko': return '요청 실패'
    case 'fr': return 'Échec de la requête'
    case 'de': return 'Anfrage fehlgeschlagen'
    case 'es': return 'Error en la solicitud'
    case 'it': return 'Richiesta non riuscita'
    case 'pt': return 'Falha na solicitação'
    case 'en':
    default: return 'Request failed'
  }
}

function renderStructuredValue(
  value: unknown,
  depth = 0,
  indent = '',
): string[] {
  if (depth > 4) return [`${indent}- …`]
  if (Array.isArray(value)) {
    if (!value.length) return [`${indent}- ${emptyValueLabel('array')}`]
    const lines: string[] = []
    for (const item of value.slice(0, 20)) {
      if (isObject(item) || Array.isArray(item)) {
        lines.push(`${indent}-`)
        lines.push(...renderStructuredValue(item, depth + 1, `${indent}  `))
      } else if (item !== null && item !== '') {
        lines.push(`${indent}- ${escapeMarkdown(String(item))}`)
      }
    }
    if (value.length > 20) lines.push(`${indent}- …`)
    return lines
  }
  if (!isObject(value)) {
    return value === null || value === ''
      ? []
      : [`${indent}- ${escapeMarkdown(String(value))}`]
  }
  const entries = Object.entries(value).filter(([, item]) => item !== null && item !== '')
  if (!entries.length) return [`${indent}- ${emptyValueLabel('object')}`]
  const lines: string[] = []
  for (const [key, item] of entries.slice(0, 24)) {
    const label = escapeMarkdown(humanizeJsonKey(key))
    if (isObject(item) || Array.isArray(item)) {
      lines.push(`${indent}- **${label}**`)
      lines.push(...renderStructuredValue(item, depth + 1, `${indent}  `))
    } else {
      lines.push(`${indent}- **${label}:** ${escapeMarkdown(String(item))}`)
    }
  }
  if (entries.length > 24) lines.push(`${indent}- …`)
  return lines
}

function humanizeJsonKey(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '_' || character === '-') {
      if (output && !output.endsWith(' ')) output += ' '
      continue
    }
    const previous = value[index - 1]
    if (
      index > 0 &&
      character >= 'A' && character <= 'Z' &&
      previous >= 'a' && previous <= 'z' &&
      !output.endsWith(' ')
    ) output += ' '
    output += character
  }
  const normalized = output.trim()
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : 'Value'
}

function escapeMarkdown(value: string): string {
  const escapable = new Set(['\\', '*', '_', '[', ']', '<', '>', '`'])
  let escaped = ''
  for (const character of value) {
    escaped += escapable.has(character) ? `\\${character}` : character
  }
  return escaped
}

function emptyValueLabel(kind: 'object' | 'array'): string {
  return kind === 'array' ? 'Empty list' : 'No details'
}

function findHttpStatus(value: string): number | undefined {
  let digits = ''
  for (const character of value) {
    if (character >= '0' && character <= '9') {
      digits += character
      continue
    }
    if (digits) {
      const status = Number(digits)
      if (status >= 400 && status <= 599) return status
      digits = ''
    }
  }
  if (digits) {
    const status = Number(digits)
    if (status >= 400 && status <= 599) return status
  }
  return undefined
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
  const turnDiagnostics = deriveLatestTurnDiagnostics(events)
  return {
    sessionId,
    workspacePath,
    ...(modelConfigId ? { modelConfigId } : {}),
    phaseName: deriveSnapshotPhaseName(events, options),
    phaseStatus: deriveSnapshotPhaseStatus(events, options),
    updatedAt: latest?.createdAt.toISOString() ?? new Date().toISOString(),
    usage,
    roleTokens: deriveObservedRoleTokens(events),
    ...(turnDiagnostics ? { turnDiagnostics } : {}),
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
  if (
    events.some(event => event.type === 'session.started') &&
    !events.some(event => event.type === 'turn.started')
  ) {
    return 'starting'
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
  if (latest.payload?.type === 'credit.reserve_failed') return 'failed'
  if (deriveSnapshotPhaseName(events, options) === 'starting') return 'starting'
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
      event.type === 'session.stopped' ||
      event.type === 'session.failed'
    )
  )
}

function hasNativeFinalResult(
  events: BeeGameEvent[],
  turnId?: string | null,
): boolean {
  if (!turnId) return false
  return events.some(event => (
    event.turnId === turnId &&
    event.type === 'result' &&
    event.text.trim().length > 0 &&
    !isThinkingProtocolControlText(event.text)
  ))
}

export function getLatestRuntimeUsage(events: BeeGameEvent[]): BeeGameRuntimeSnapshot['usage'] {
  // Claude SDK result.modelUsage is cumulative while one native accounting
  // epoch remains active. A resumed/compacted native session may start a new
  // epoch whose counters are lower than the previous terminal snapshot. Keep
  // only the latest snapshot inside each monotonic epoch, then add the epochs;
  // summing every result double-counts while taking only the final result loses
  // all usage before a native counter reset.
  const modelUsage = aggregateCumulativeModelUsage(events)
  if (modelUsage) return modelUsage

  // Older/partial transports do not always expose modelUsage. Preserve the
  // message-level fallback for those sessions; unlike modelUsage these values
  // describe distinct messages and are deduplicated by message id.
  const assistantUsage = sumAssistantMessageUsage(events)
  if (assistantUsage.total_tokens > 0) return assistantUsage

  // A result-only legacy transport has no message ids to deduplicate. Count at
  // most the latest result in each BeeGame turn so streamed copies are not
  // multiplied while distinct legacy turns remain measurable.
  const resultUsageByTurn = new Map<string, BeeGameRuntimeSnapshot['usage']>()
  for (const event of events) {
    if (event.type !== 'result') continue
    const usage = getUsageFromEventPayload(event.payload)
    if (usage.total_tokens <= 0) continue
    resultUsageByTurn.set(event.turnId || '__session__', usage)
  }
  return [...resultUsageByTurn.values()].reduce((total, usage) => {
    addRuntimeUsage(total, usage)
    return total
  }, emptyRuntimeUsage())
}

export const CREDIT_TOKEN_WEIGHTS = {
  input: 1,
  cacheRead: 0.1,
  cacheCreation: 1.25,
  output: 5,
} as const

/**
 * Converts cumulative model usage into cost-equivalent input tokens. The
 * ratios mirror the provider cost shape exposed by Claude-compatible SDK
 * modelUsage: cached reads are discounted, cache writes carry a premium, and
 * generated output is materially more expensive than uncached input.
 */
export function calculateCreditWeightedTokens(
  usage: BeeGameRuntimeSnapshot['usage'],
): number {
  const hundredths =
    normalizeFiniteNumber(usage.prompt_tokens) * 100 +
    normalizeFiniteNumber(usage.cache_read_tokens) * 10 +
    normalizeFiniteNumber(usage.cache_creation_tokens) * 125 +
    normalizeFiniteNumber(usage.completion_tokens) * 500
  return Math.ceil(hundredths / 100)
}

function getRuntimeUsageForTurn(
  events: BeeGameEvent[],
  turnId?: string,
): BeeGameRuntimeSnapshot['usage'] {
  if (turnId) {
    const firstTurnEventIndex = events.findIndex(event => event.turnId === turnId)
    const lastTurnEventIndex = events.findLastIndex(event => event.turnId === turnId)
    if (firstTurnEventIndex >= 0 && lastTurnEventIndex >= firstTurnEventIndex) {
      const throughTurn = aggregateCumulativeModelUsage(
        events.slice(0, lastTurnEventIndex + 1),
      )
      if (throughTurn) {
        const beforeTurn = aggregateCumulativeModelUsage(
          events.slice(0, firstTurnEventIndex),
        )
        return subtractRuntimeUsage(throughTurn, beforeTurn ?? emptyRuntimeUsage())
      }
    }
  }
  const scopedEvents = turnId
    ? events.filter(event => event.turnId === turnId)
    : events
  const modelUsage = aggregateCumulativeModelUsage(scopedEvents)
  if (modelUsage) return modelUsage

  for (const event of [...scopedEvents].reverse()) {
    if (event.type !== 'result') continue
    const usage = getUsageFromEventPayload(event.payload)
    if (usage.total_tokens > 0) return usage
  }
  return sumAssistantMessageUsage(scopedEvents)
}

export function sumAssistantMessageUsage(events: BeeGameEvent[]): BeeGameRuntimeSnapshot['usage'] {
  const usageByMessage = new Map<string, BeeGameRuntimeSnapshot['usage']>()
  for (const event of events) {
    if (event.type !== 'assistant.message') continue
    usageByMessage.set(getAssistantUsageIdentity(event), getUsageFromEventPayload(event.payload))
  }

  return [...usageByMessage.values()].reduce<BeeGameRuntimeSnapshot['usage']>((total, usage) => {
    total.prompt_tokens += usage.prompt_tokens
    total.completion_tokens += usage.completion_tokens
    total.cache_read_tokens += usage.cache_read_tokens
    total.cache_creation_tokens += usage.cache_creation_tokens
    total.total_tokens += usage.total_tokens
    return total
  }, emptyRuntimeUsage())
}

function deriveLatestTurnDiagnostics(
  events: BeeGameEvent[],
): BeeGameRuntimeSnapshot['turnDiagnostics'] | undefined {
  const turnId = [...events].reverse().find(event => event.turnId)?.turnId
  if (!turnId) return undefined
  const turnEvents = events.filter(event => event.turnId === turnId)
  const usage = getRuntimeUsageForTurn(events, turnId)
  const countTool = (toolName: string) => turnEvents.filter(event => (
    event.type === 'tool.started' &&
    getDashboardPayloadString(event.payload, 'toolName') === toolName
  )).length
  return {
    turnId,
    agentCalls: countTool('Agent'),
    taskOutputCalls: countTool('TaskOutput'),
    usage,
    roleTokens: deriveObservedRoleTokens(turnEvents, usage),
  }
}

function deriveObservedRoleTokens(
  events: BeeGameEvent[],
  usage = getRuntimeUsageForTurn(events),
): NonNullable<BeeGameRuntimeSnapshot['turnDiagnostics']>['roleTokens'] {
  const total = usage.total_tokens
  const roleByToolUse = new Map<string, string>()
  const backgroundUsageByToolUse = new Map<string, number>()
  for (const event of events) {
    if (
      event.type !== 'tool.started' &&
      event.type !== 'tool.completed'
    ) continue
    if (getDashboardPayloadString(event.payload, 'toolName') !== 'Agent') continue
    const payload = isRuntimeRecord(event.payload) ? event.payload : undefined
    const input = payload && isRuntimeRecord(payload.input) ? payload.input : undefined
    const toolUseID = typeof payload?.toolUseID === 'string' ? payload.toolUseID : ''
    const role = typeof input?.subagent_type === 'string' ? input.subagent_type : ''
    if (toolUseID && role) roleByToolUse.set(toolUseID, role)
    if (event.type === 'tool.completed' && toolUseID) {
      const launch = parseNativeBackgroundTaskLaunch(
        typeof payload?.output === 'string' ? payload.output : '',
      )
      const taskUsage = launch
        ? readNativeBackgroundTaskUsage(launch.outputFile)
        : undefined
      if (taskUsage) {
        backgroundUsageByToolUse.set(toolUseID, taskUsage.totalTokens)
      }
    }
  }

  const latestTerminalByTask = new Map<
    string,
    { toolUseID: string; role: string; tokens: number }
  >()
  for (const event of events) {
    if (event.type !== 'system.status' || !isRuntimeRecord(event.payload)) continue
    if (getDashboardPayloadString(event.payload, 'subtype') !== 'task_notification') continue
    const taskId = getDashboardPayloadString(event.payload, 'task_id')
    const toolUseID = getDashboardPayloadString(event.payload, 'tool_use_id')
    const usage = isRuntimeRecord(event.payload.usage) ? event.payload.usage : undefined
    if (!taskId || !toolUseID || !usage) continue
    latestTerminalByTask.set(taskId, {
      toolUseID,
      role: roleByToolUse.get(toolUseID) ?? 'other',
      tokens: Math.max(
        normalizeFiniteNumber(usage.total_tokens),
        backgroundUsageByToolUse.get(toolUseID) ?? 0,
      ),
    })
  }

  for (const [toolUseID, tokens] of backgroundUsageByToolUse) {
    if ([...latestTerminalByTask.values()].some(value =>
      value.toolUseID === toolUseID
    )) continue
    latestTerminalByTask.set(`output:${toolUseID}`, {
      toolUseID,
      role: roleByToolUse.get(toolUseID) ?? 'other',
      tokens,
    })
  }

  let reviewer = 0
  let auditor = 0
  let validator = 0
  let otherSubagents = 0
  for (const value of latestTerminalByTask.values()) {
    if (value.role === 'beegame-document-reviewer') reviewer += value.tokens
    else if (value.role === 'beegame-implementation-auditor') auditor += value.tokens
    else if (value.role === 'beegame-acceptance-validator') validator += value.tokens
    else otherSubagents += value.tokens
  }
  return {
    mainAgent: Math.max(0, total - reviewer - auditor - validator - otherSubagents),
    reviewer,
    auditor,
    validator,
    otherSubagents,
    waiting: 0,
  }
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getAssistantUsageIdentity(event: BeeGameEvent): string {
  const payload = event.payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const message = payload.message
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const messageId = (message as Record<string, unknown>).id
      if (typeof messageId === 'string' && messageId.trim()) {
        return `${event.turnId ?? ''}:${messageId}`
      }
    }
  }
  return `${event.turnId ?? ''}:event:${event.id}`
}

function getUsageFromEventPayload(
  payload: DashboardSDKMessage | undefined,
): BeeGameRuntimeSnapshot['usage'] {
  const usage = getUsageRecord(payload)
  if (!usage) {
    return emptyRuntimeUsage()
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
    cache_read_tokens: normalizeFiniteNumber(
      usage.cache_read_input_tokens ?? usage.cache_read_tokens,
    ),
    cache_creation_tokens: normalizeFiniteNumber(
      usage.cache_creation_input_tokens ?? usage.cache_creation_tokens,
    ),
    total_tokens: totalTokens,
  }
}

function getModelUsageFromEventPayload(
  payload: DashboardSDKMessage | undefined,
): BeeGameRuntimeSnapshot['usage'] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const modelUsage = payload.modelUsage
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null
  const total = emptyRuntimeUsage()
  let found = false
  for (const value of Object.values(modelUsage)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const usage = value as Record<string, unknown>
    const promptTokens = normalizeFiniteNumber(usage.inputTokens ?? usage.input_tokens)
    const completionTokens = normalizeFiniteNumber(usage.outputTokens ?? usage.output_tokens)
    const cacheReadTokens = normalizeFiniteNumber(
      usage.cacheReadInputTokens ?? usage.cache_read_input_tokens,
    )
    const cacheCreationTokens = normalizeFiniteNumber(
      usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens,
    )
    const totalTokens = promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens
    if (totalTokens <= 0) continue
    found = true
    addRuntimeUsage(total, {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      total_tokens: totalTokens,
    })
  }
  return found ? total : null
}

function aggregateCumulativeModelUsage(
  events: BeeGameEvent[],
): BeeGameRuntimeSnapshot['usage'] | null {
  const epochs: BeeGameRuntimeSnapshot['usage'][] = []
  let latestInEpoch: BeeGameRuntimeSnapshot['usage'] | null = null
  for (const event of events) {
    if (event.type !== 'result') continue
    const snapshot = getModelUsageFromEventPayload(event.payload)
    if (!snapshot) continue
    if (latestInEpoch && hasCumulativeCounterReset(latestInEpoch, snapshot)) {
      epochs.push(latestInEpoch)
    }
    latestInEpoch = snapshot
  }
  if (latestInEpoch) epochs.push(latestInEpoch)
  if (epochs.length === 0) return null
  return epochs.reduce((total, usage) => {
    addRuntimeUsage(total, usage)
    return total
  }, emptyRuntimeUsage())
}

function hasCumulativeCounterReset(
  previous: BeeGameRuntimeSnapshot['usage'],
  current: BeeGameRuntimeSnapshot['usage'],
): boolean {
  return current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens
}

function subtractRuntimeUsage(
  total: BeeGameRuntimeSnapshot['usage'],
  previous: BeeGameRuntimeSnapshot['usage'],
): BeeGameRuntimeSnapshot['usage'] {
  const promptTokens = Math.max(0, total.prompt_tokens - previous.prompt_tokens)
  const completionTokens = Math.max(
    0,
    total.completion_tokens - previous.completion_tokens,
  )
  const cacheReadTokens = Math.max(
    0,
    total.cache_read_tokens - previous.cache_read_tokens,
  )
  const cacheCreationTokens = Math.max(
    0,
    total.cache_creation_tokens - previous.cache_creation_tokens,
  )
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens:
      promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens,
  }
}

function emptyRuntimeUsage(): BeeGameRuntimeSnapshot['usage'] {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0,
  }
}

function addRuntimeUsage(
  target: BeeGameRuntimeSnapshot['usage'],
  value: BeeGameRuntimeSnapshot['usage'],
): void {
  target.prompt_tokens += value.prompt_tokens
  target.completion_tokens += value.completion_tokens
  target.cache_read_tokens += value.cache_read_tokens
  target.cache_creation_tokens += value.cache_creation_tokens
  target.total_tokens += value.total_tokens
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
      cache_read_tokens: Number(usage.cache_read_tokens ?? 0),
      cache_creation_tokens: Number(usage.cache_creation_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
    roleTokens: normalizeRoleTokens(record.roleTokens),
    ...(record.turnDiagnostics && typeof record.turnDiagnostics === 'object' && !Array.isArray(record.turnDiagnostics)
      ? normalizeTurnDiagnostics(record.turnDiagnostics as Record<string, unknown>)
      : {}),
  }
}

function normalizeTurnDiagnostics(
  value: Record<string, unknown>,
): Pick<BeeGameRuntimeSnapshot, 'turnDiagnostics'> {
  const usage = value.usage && typeof value.usage === 'object' && !Array.isArray(value.usage)
    ? value.usage as Record<string, unknown>
    : {}
  return {
    turnDiagnostics: {
      turnId: String(value.turnId || ''),
      agentCalls: Number(value.agentCalls ?? 0),
      taskOutputCalls: Number(value.taskOutputCalls ?? 0),
      usage: {
        prompt_tokens: Number(usage.prompt_tokens ?? 0),
        completion_tokens: Number(usage.completion_tokens ?? 0),
        cache_read_tokens: Number(usage.cache_read_tokens ?? 0),
        cache_creation_tokens: Number(usage.cache_creation_tokens ?? 0),
        total_tokens: Number(usage.total_tokens ?? 0),
      },
      roleTokens: normalizeRoleTokens(value.roleTokens),
    },
  }
}

function normalizeRoleTokens(
  value: unknown,
): NonNullable<BeeGameRuntimeSnapshot['turnDiagnostics']>['roleTokens'] {
  const record = isRuntimeRecord(value) ? value : {}
  return {
    mainAgent: Number(record.mainAgent ?? 0),
    reviewer: Number(record.reviewer ?? 0),
    auditor: Number(record.auditor ?? 0),
    validator: Number(record.validator ?? 0),
    otherSubagents: Number(record.otherSubagents ?? 0),
    waiting: 0,
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
  _record: SessionRecord,
  _allowedRoot: string,
  request: DashboardPermissionRequest,
): { behavior: 'auto_deny' | 'ask_user'; message?: string } {
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
  }
  return { behavior: 'ask_user' }
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
  if (command === 'mv') {
    const pathArgs = tokens.slice(1).filter(token => !token.startsWith('-'))
    return pathArgs.length === 2 && pathArgs.every(path => (
      isSafeProjectMovePath(cwd, allowedRoot, path)
    ))
  }
  return false
}

function isSafeProjectMovePath(cwd: string, allowedRoot: string, path: string): boolean {
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(cwd, path)
  const workspaceRoot = resolve(allowedRoot)
  const rel = relative(workspaceRoot, resolvedPath).split('\\').join('/')
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) &&
    !isSensitiveProjectMutationPath(rel)
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

function getDashboardPayloadBoolean(
  payload: DashboardSDKMessage | undefined,
  field: string,
): boolean {
  return payload?.[field] === true
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
        message,
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

function mapSDKMessageToEvent(record: SessionRecord, message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  switch (message.type) {
    case 'user':
      return null
    case 'assistant':
      return mapTextEvent(
        'assistant.message',
        formatRuntimeErrorForDisplay(
          extractAssistantVisibleText(message),
          record.language,
        ),
      )
    case 'partial_assistant':
      return mapTextEvent('assistant.partial', extractAssistantVisibleText(message))
    case 'stream_event':
      return mapStreamEvent(record, message)
    case 'tool_progress':
      return mapTextEvent('tool.progress', extractMessageText(message))
    case 'result': {
      // A native terminal result can legitimately carry accounting and status
      // metadata without user-visible text. Persist that envelope so credits,
      // diagnostics, and transcript recovery remain lossless; the frontend
      // already projects result events to usage only, so this does not create
      // an empty chat message. Protocol-only thinking markers stay hidden.
      const text = extractMessageText(message).trim()
      return {
        type: 'result',
        text: isThinkingProtocolControlText(text) ? '' : text,
        payload: message,
      }
    }
    case 'system':
    case 'status':
      return mapNativeTaskLifecycleEvent(message) ?? mapTextEvent('system.status', extractMessageText(message))
    default:
      return mapTextEvent('system.status', extractMessageText(message))
  }
}

function mapNativeTaskLifecycleEvent(message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
  payload: DashboardSDKMessage
} | null {
  const subtype = getStringField(message, 'subtype')
  if (subtype !== 'task_started' && subtype !== 'task_notification') return null
  return { type: 'system.status', text: subtype, payload: message }
}

function isSDKExecutionError(message: DashboardSDKMessage): boolean {
  return message.type === 'result' && getBooleanField(message, 'is_error') === true
}

export function getSDKExecutionErrorDetail(message: DashboardSDKMessage): string {
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  if (errors[0]) return errors[0].trim()
  if (typeof message.result === 'string' && message.result.trim()) {
    return message.result.trim()
  }
  return extractMessageText(message).trim() || 'Model runtime returned an execution error.'
}

function mapTextEvent(
  type: BeeGameEventType,
  text: string,
): { type: BeeGameEventType; text: string } | null {
  const normalized = text.trim()
  if (
    (type === 'assistant.partial' || type === 'assistant.message' || type === 'result') &&
    isThinkingProtocolControlText(normalized)
  ) {
    return null
  }
  return normalized ? { type, text: normalized } : null
}

function isThinkingProtocolControlEvent(event: BeeGameEvent): boolean {
  return (
    (event.type === 'assistant.partial' || event.type === 'assistant.message') &&
    isThinkingProtocolControlText(event.text)
  )
}

function isThinkingProtocolControlText(value: string): boolean {
  let remaining = value.trim()
  if (!remaining) return false

  let foundControlToken = false
  while (remaining) {
    const token = remaining.startsWith('<think>')
      ? '<think>'
      : remaining.startsWith('</think>')
        ? '</think>'
        : undefined
    if (!token) return false
    foundControlToken = true
    remaining = remaining.slice(token.length).trim()
  }
  return foundControlToken
}

function mapStreamEvent(record: SessionRecord, message: DashboardSDKMessage): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  const streamMessageId = extractStreamMessageId(message)
  if (streamMessageId) record.activeAssistantMessageId = streamMessageId

  const textDelta = extractStreamTextDelta(message)
  if (textDelta.trim()) return mapTextEvent('assistant.partial', textDelta)

  const thinking = extractStreamThinkingStatus(record, message)
  if (!thinking || thinking === 'streaming') return null
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
  // Stream fragments are presentation-only and may contain a tool block before
  // its JSON input is complete. Claude Code emits the authoritative tool_use
  // block on the final assistant message, so only that block may start a tool.
  if (message.type === 'stream_event' || message.type === 'partial_assistant') {
    return []
  }
  const events: Array<{
    type: BeeGameEventType
    text: string
    payload: DashboardSDKMessage
  }> = []
  const parentToolUseID = getStringField(message, 'parent_tool_use_id')
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
          ...(parentToolUseID ? { parentToolUseID } : {}),
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
      const nativeResult = toolName === 'Agent'
        ? extractNativeAgentResult(block.content)
        : undefined
      const nativeTaskResult = toolName === 'TaskOutput'
        ? extractNativeCompletedTaskResult(message)
        : undefined
      events.push({
        type: failed ? 'tool.failed' : 'tool.completed',
        text: `${toolName} ${failed ? 'failed' : 'completed'}`,
        payload: {
          type: failed ? 'tool.failed' : 'tool.completed',
          toolUseID,
          toolName,
          ...(parentToolUseID ? { parentToolUseID } : {}),
          ...(cached?.input ? { input: cached.input } : {}),
          output,
          ...(nativeResult ? { nativeResult } : {}),
          ...(nativeTaskResult ? { nativeTaskResult } : {}),
        },
      })
    }
  }
  return events
}

function extractNativeCompletedTaskResult(
  message: DashboardSDKMessage,
): { taskId: string; status: string; result?: string } | undefined {
  const toolUseResult = getObjectField(message, 'tool_use_result')
  if (getStringField(toolUseResult, 'retrieval_status') !== 'success') {
    return undefined
  }
  const task = getObjectField(toolUseResult, 'task')
  if (!task) return undefined
  const taskId = getStringField(task, 'task_id').trim()
  const status = getStringField(task, 'status').trim()
  if (
    !taskId ||
    (status !== 'completed' &&
      status !== 'failed' &&
      status !== 'stopped' &&
      status !== 'killed')
  ) return undefined
  const result = getStringField(task, 'output').trim() ||
    getStringField(task, 'result').trim()
  return {
    taskId,
    status,
    ...(result ? { result } : {}),
  }
}

/**
 * Claude Code may append Agent lifecycle/usage metadata as additional text
 * blocks. Preserve the subagent's own terminal text separately instead of
 * asking delivery evidence consumers to parse the flattened presentation
 * string.
 */
function extractNativeAgentResult(value: unknown): string | undefined {
  const items = Array.isArray(value) ? value : [value]
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (!isObject(item) || getStringField(item, 'type') !== 'text') continue
    const text = getStringField(item, 'text').trim()
    if (text) return text
  }
  return undefined
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
    return 'streaming'
  }
  if (eventType === 'content_block_stop') {
    const index = getNumberField(event, 'index')
    if (index === undefined || !record.thinkingBlockIndexes.has(index)) return null
    record.thinkingBlockIndexes.delete(index)
    if (!record.visibleThinkingBlockIndexes.has(index)) return null
    record.visibleThinkingBlockIndexes.delete(index)
    return 'ended'
  }
  if (eventType !== 'content_block_delta') return null

  const delta = getObjectField(event, 'delta')
  const deltaType = getStringField(delta, 'type')
  if (deltaType !== 'thinking_delta' && deltaType !== 'redacted_thinking_delta') {
    return null
  }
  const index = getNumberField(event, 'index')
  if (index === undefined || !record.thinkingBlockIndexes.has(index)) return 'streaming'
  if (record.visibleThinkingBlockIndexes.has(index)) return 'streaming'
  record.visibleThinkingBlockIndexes.add(index)
  return 'started'
}

function extractStreamMessageId(message: DashboardSDKMessage): string | undefined {
  const event = getObjectField(message, 'event') ?? message
  if (getStringField(event, 'type') !== 'message_start') return undefined
  return getStringField(getObjectField(event, 'message'), 'id') || undefined
}

function getSDKAssistantMessageId(message: DashboardSDKMessage): string | undefined {
  if (message.type !== 'assistant') return undefined
  return getStringField(getObjectField(message, 'message'), 'id') || undefined
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
