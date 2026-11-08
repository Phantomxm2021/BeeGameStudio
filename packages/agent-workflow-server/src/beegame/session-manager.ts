import type { BeeGameModelUsage } from './model-runtime-host'
import { ProductionBlockedError } from './production-blocked'
import { initializeProjectRepository } from '../local-runtime-service'
import {inferRuntimeModelType} from '@bee-game-studio/agent-workflow/runtime-environment'
import type { DesignFileChanges, ProjectFileChanges } from './workflow-v3/state'
import { createHash, randomUUID } from 'node:crypto'
import { projectRuntimeDisplayReason } from './project-runtime-display'
import { normalizeRuntimeEnvironment } from '@bee-game-studio/agent-workflow/runtime-environment'
import { isEnvTruthy } from '@bee-game-studio/agent-workflow/runtime-environment'
import {
  readCanonicalProjectArtifactConsistently,
  type ProjectArtifactIdentity,
} from './project-artifact-store'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'
import { createResponseRedactor } from '@bee-game-studio/agent-workflow/native-response-trace'
import type {
  BeeGameUsageBillingRecordResult as RecordUsageResult,
  BeeGameUsageBillingUsage as Usage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { validateConfirmedBriefContext } from './confirmed-brief-context'
import { appendChatTranscript, appendRuntimeDiagnostic, projectChatPath } from './project-records'
import { projectHostDirectory, projectWorkDirectory, projectWorkRoot } from './project-storage-paths'
import {
  parseNativeBackgroundTaskLaunch,
  readNativeBackgroundTaskUsage,
} from './native-background-task-output'
import { createBgsRunner } from '../bgs/runner'
import { BgsClientError } from '../bgs/client'
import { createNativeSubagentChatEnricher } from './native-subagent-chat'
import { isSupabaseRuntimeEnvAuthError } from '../supabase-runtime-env-client'
import { ChatJsonlReader, CHAT_PAGE_BYTES, type JsonlSelection } from './chat-jsonl-reader'
import { auditEventPage, type EventPageSelection } from './workflow-v3/event-page'
import { answeredQuestionInput, UserQuestionValidationError } from './user-question'
import { expandPath } from '@bee-game-studio/agent-workflow/runtime-path'
import {
  UsageOutboxPersistenceError,
  SessionUsageOutbox,
  type SessionUsageOutboxStatus,
} from './session-usage-outbox'
import { isPersonalModelId } from '../model-connections'
import { getModelBillingSource, type ModelBillingSource } from '../model-billing-source'

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
const MAX_PROJECT_AGENT_RAW_LOG_BYTES = 8 * 1024 * 1024
const PROJECT_AGENT_RAW_LOG_ARCHIVES = 3
const DOCUMENT_ATTACHMENT_TYPES: Record<string, string[]> = {
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime'],
  '.webm': ['video/webm'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.csv': ['text/csv', 'application/csv'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
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
  type: 'image' | 'file'
  storageId: string
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
  | 'usage'
  | 'assistant.message'
  | 'assistant.partial'
  | 'assistant.thinking'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.progress'
  | 'permission.requested'
  | 'permission.resolved'
  | 'workflow.question.validated'
  | 'workflow.question.rejected'
  | 'system.status'
  | 'result'
  | 'turn.completed'
  | 'turn.empty'
  | 'turn.failed'
  | 'session.stopped'
  | 'session.failed'

export type BeeGameEventPayload = {
  type: string
  [key: string]: unknown
}

export type BeeGameEvent = {
  id: number
  sessionId: string
  turnId?: string
  type: BeeGameEventType
  text: string
  payload?: BeeGameEventPayload
  createdAt: Date
}

/** Keep the immutable audit log, but project only the live branch into agent context. */
export function liveProjectConversationEvents<T extends Pick<BeeGameEvent, 'id' | 'type' | 'turnId' | 'payload'>>(
  events: readonly T[],
): T[] {
  const live: T[] = []
  for (const event of events) {
    if (event.type === 'user.message' && typeof event.payload?.supersedesMessageId === 'string') {
      const target = event.payload.supersedesMessageId
      const targetIndex = live.findIndex(candidate => candidate.type === 'user.message' &&
        (candidate.payload?.clientMessageId === target || `beegame-event-${candidate.id}` === target))
      if (targetIndex >= 0) {
        const precedingTurnStart = live.findLast(candidate => candidate.type === 'turn.started' &&
          candidate.turnId === event.turnId)
        const targetTurnId = live[targetIndex]?.turnId
        const startIndex = targetTurnId
          ? live.findIndex(candidate => candidate.type === 'turn.started' && candidate.turnId === targetTurnId)
          : targetIndex
        live.splice(startIndex >= 0 ? startIndex : targetIndex)
        if (precedingTurnStart) live.push(precedingTurnStart)
      }
    }
    live.push(event)
  }
  return live
}

export type BeeGameEventSubscriber = (event: BeeGameEvent) => void

type ProjectEventSubscription = {
  userId: string
  projectId: string
  workspacePath: string
  subscriber: BeeGameEventSubscriber
}

export type BeeGameSession = {
  id: string
  workflowExecution?: { runId: string; taskId: string; attemptId: string }
  cwd: string
  modelConfigId?: string
  status: BeeGameSessionStatus
  turnStatus: BeeGameTurnStatus
  createdAt: Date
  updatedAt: Date
}

// Host acknowledgement of context already supplied to this exact native thread.
// Hashes only; no second conversation or instruction store.
export type BeeGameNativeContext = { threadId: string; runtimeSha256: string; briefSha256: string }

export type BeeGameRuntimeSnapshot = {
  nativeContext?: BeeGameNativeContext
  providerUsageIncomplete?: boolean
  runtime?: 'bgs'
  sessionId: string
  /** Host-only binding; a session UUID alone cannot identify an interrupted attempt. */
  executionIdentity?: { attemptId: string; workerId: string; fence: number; turnId: string; nativeSubmitted?: true }
  /** UUID owned and emitted by the native runtime; never a BGS routing ID. */
  nativeSessionId?: string
  workspacePath: string
  modelConfigId?: string
  phaseName: string
  phaseStatus: string
  /** Current-process child work; never reconstructed from transcript history. */
  activeSubagentToolUseIds: string[]
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
    otherSubagents: number
    unattributed: number
  }
  turnDiagnostics?: {
    turnId: string
    agentCalls: number
    /** Legacy Skill-tool call count only; not Shell reads or native invocation telemetry. */
    skillCalls: number
    taskOutputCalls: number
    failedToolCalls: number
    usage: {
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      total_tokens: number
    }
    roleTokens: {
      mainAgent: number
      otherSubagents: number
      unattributed: number
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

/** One authorized assignment, executed by the native Goal continuation loop. */
export type BeeGameNativeGoalInput =
  | { mode: 'start'; objective: string; tokenBudget?: number }
  | { mode: 'resume' }

/** Current host turn capability; never serialized into model input or snapshots. */
export type BeeGameHostToolCapability = (value: unknown, signal?: AbortSignal) => Promise<unknown>
export type BeeGameTurnTools = {
  /** Existing startup-only recovery from reviewed design when no native history exists. */
  restartFromDesign?: { prompt: string; authorize(): Promise<void> }
  /** Host-validated final JSON; schema is model guidance, not an API output constraint. */
  finalOutput?: {
    /** Project writes remain denied except the native docs/ scope authorized below. */
    readOnly?: boolean
    writeDocument?: { path: string; authorize(): Promise<void> }
    designReview?: {
      /** Effective target interpretation and current handoff facts shared with the author. */
      context: string
      /** Completed receipts from this assignment’s authorized native continuation lineage. */
      previousReviews?: readonly import('./workflow-v3/design-review').DesignReviewReceipt[]
      candidate(value: unknown): Promise<{ source: { path: string; sha256: string }; summary: string;
        reviewResponses?: import('./workflow-v3/design-review').DesignReviewDisposition[] }>
      record(receipt: import('./workflow-v3/design-review').DesignReviewReceipt): Promise<void>
    }
    schema: Record<string, unknown>
    /** Accept a response-only result without submitting production; validate that its sources were unchanged. */
    answer?(value: unknown): Promise<string | undefined>
    accept(value: unknown): Promise<string>
  }
  workflow?: BeeGameHostToolCapability
  /** Current assignment description for the native workflow tool; not serialized business state. */
  workflowDescription?: string
  /** Assignment-owned native role; absent for ordinary Agent work. */
  baseInstructions?: string
  /** Current host-committed readiness, not a model claim or quality verdict. */
  implementationHandoff?: () => string | undefined
  /** Trusted current-turn asset command; native MCP uses the existing image service. */
  imageGenerationEntry?: string
}

export type BeeGameSessionRunnerStartInput = BeeGameTurnTools & {
  nativeGoal?: BeeGameNativeGoalInput
  /** Continue saved native history without inserting a new user assignment. */
  nativeRecovery?: boolean
  sessionId: string
  /** Host capability discovery, separate from the user's message. */
  systemContext?: string
  /** Current confirmed requirements, also retained by the native instruction baseline. */
  confirmedBriefContext?: string
  /** Host-confirmed UI check conditions; never accepted from model tool input. */
  resumeSessionId?: string
  nativeContext?: BeeGameNativeContext
  onNativeContext?(context: BeeGameNativeContext): void
  /** Records the UUID emitted by the native runtime for durable resume. */
  onNativeSessionId?(sessionId: string): void
  /** Native replay of this exact submitted command, not merely CLI startup. */
  onNativeSubmission?(sessionId: string): void
  /** Passive provider accounting, cumulative within this native process. */
  onNativeUsage?(usage: Usage, epoch?: string, accounting?: { incomplete?: boolean; baselineOnly?: boolean; replayed?: boolean; nativeTurnId?: string }): void
  cwd: string
  env: Record<string, string>
  language?: BeeGameSessionLanguage
  /** BGS business scope evaluated before standard permission shortcuts. */
  toolPolicy?(request: DashboardPermissionRequest): Promise<DashboardPermissionDecision | undefined>
  requestPermission?(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

const RUNTIME_MODEL_ENV_KEYS = new Set([
  'BGS_HOME',
  'BEEGAME_BGS_PATH',
  'BEEGAME_MODEL',
  'BEEGAME_API_PROTOCOL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'OPENAI_AUTH_MODE',
  'BEEGAME_CONFIG_DIR',
  'BEEGAME_NATIVE_BUILTIN_SKILLS_DIR',
  'BEEGAME_NATIVE_MCP_SERVERS_JSON',
  'BEEGAME_MODEL_TYPE',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
])

export type BeeGameSessionSubmitInput = BeeGameTurnTools & {
  nativeGoal?: BeeGameNativeGoalInput
  nativeRecovery?: boolean
  prompt: BeeGamePromptInput
  /** Refreshed each turn, including when the native process is reused. */
  language?: BeeGameSessionLanguage
  /** User-confirmed context exposed read-only to platform contract tools. */
  confirmedBriefContext?: string
  signal: AbortSignal
  onMessage(message: BeeGameEventPayload & { type: 'runtime_event'; eventType: BeeGameEventType }): void | Promise<void>
  requestPermission(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

export type BeeGameSessionRuntime = {
  readonly reusable?: boolean
  submit(input: BeeGameSessionSubmitInput): Promise<void>
  stop(): void
  /** Close owned runtime resources and confirm process cleanup. */
  dispose?(): void | Promise<void>
}

export type BeeGameSessionRunner = {
  start(input: BeeGameSessionRunnerStartInput): Promise<BeeGameSessionRuntime>
}

export type DashboardPermissionRequest = {
  toolUseID: string
  toolName: string
  message: string
  input: Record<string, unknown>
  /** Host request lifetime; never accepted from model arguments or persisted. */
  signal?: AbortSignal
  /** Host-only write recheck metadata; never read from model tool arguments. */
  phase?: 'recheck'
  permissionSuggestions?: Record<string, unknown>[]
  decisionReason?: string
  blockedPath?: string
  agentId?: string
}

export type DashboardPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  /** Host policy decisions must not be attributed to a user approval/rejection. */
  source?: 'policy' | 'user'
  /** Ephemeral approval scope. Never persisted across isolated sessions. */
  scope?: 'once' | 'session'
  updatedPermissions?: Record<string, unknown>[]
  /** Native tool input returned after an interactive user response. */
  updatedInput?: Record<string, unknown>
  /** Explicit human design-change authorization, never inferred from answer text. */
  intent?: 'change'
}

type PendingPermission = DashboardPermissionRequest & {
  requestedAt: Date
  resolve(decision: DashboardPermissionDecision): void
}

export type BeeGamePendingPermission = DashboardPermissionRequest & {
  sessionId: string
  projectId?: string
  requestedAt: Date
}

type SessionRecord = {
  nativeContext?: BeeGameNativeContext
  executionIdentity?: BeeGameRuntimeSnapshot['executionIdentity']
  /** Redact runtime credentials from persisted and streamed Chat events only. */
  redactVisible?: ReturnType<typeof createResponseRedactor>
  baseInstructions?: string
  systemContext?: string
  preparingTurn?: boolean
  session: BeeGameSession
  /** Native runtime UUID, distinct from session.id (the BGS routing key). */
  nativeSessionId?: string
  currentTurnUsageExternallyAccounted?: boolean
  /** Process identity, separate from the resumable transcript/session UUID. */
  nativeAccountingEpoch?: string
  runtime: RuntimeModelConfig | undefined
  userId: string
  authToken?: string
  getValidAuthToken?: (options?: {
    forceRefresh?: boolean
  }) => Promise<string | undefined> | string | undefined
  projectId?: string
  userDataRoot?: string
  language?: BeeGameSessionLanguage
  /** Exact canonical JSON supplied by the user's last confirmed build brief. */
  confirmedBriefContext?: string
  transcriptPath: string
  runner: BeeGameSessionRuntime | null
  runnerNeedsRefresh?: boolean
  runnerBillingSource?: ModelBillingSource
  runtimeCleanupFailed?: boolean
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  workflowQuestionGuard?: StartBeeGameSessionInput['workflowQuestionGuard']
  /** User-approved network hosts for this live session only. */
  approvedNetworkHosts: Set<string>
  /** Active native background tasks from live lifecycle notifications. */
  activeNativeTaskToolUseIds: Map<string, string>
  /** Start time for each visible thinking block, used when its end event arrives. */
  thinkingBlockStartedAt: Map<string, string>
  pendingTranscript: BeeGameEvent[]
  streamPersistenceTimer?: ReturnType<typeof setTimeout>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  /** The complete active model turn, including final event/usage callbacks. */
  activeTurn?: Promise<void>
  /** Successful host close, distinct from merely appending a delivery submission. */
  /** Serializes usage billing events without blocking the runtime callback. */
  usageWriteTail: Promise<void>
  usageLastCommittedKey?: string
  usageFailureReported: boolean
  resumeEventPending: boolean
}

export type StartBeeGameSessionInput = {
  workspacePath: string
  /** Host-owned V3 task identity; never forwarded as native business flags. */
  workflowExecution?: { runId: string; taskId: string; attemptId: string }
  /** BGS-side evidence binding only; never forwarded to the native runner. */
  workflowQuestionGuard?: (request: DashboardPermissionRequest, decision?: DashboardPermissionDecision) => Promise<Record<string, unknown>>
  projectId?: string
  modelConfigId?: string
  transcriptSessionId?: string
  /** Resume a native CLI conversation without treating its UUID as a BGS transcript ID. */
  resumeNativeSessionId?: string
  /** Explicit BGS execution-context choice; never erases the user Chat. */
  freshNativeContext?: boolean
  userId: string
  authToken?: string
  getValidAuthToken?: (options?: {
    forceRefresh?: boolean
  }) => Promise<string | undefined> | string | undefined
  userDataRoot?: string
  language?: BeeGameSessionLanguage
}

export type BeeGameSessionInternalMetadata = {
  id: string
  workflowExecution?: BeeGameSession['workflowExecution']
  userId: string
  projectId?: string
  workspacePath: string
  status: BeeGameSessionStatus
  transcriptPath: string
  modelConfigId?: string
  createdAt: Date
  updatedAt: Date
}

export type BeeGameSessionUsageBillingBackend = {
  assertUsageAvailable?: (userId: string) => Promise<void>
  recordUsage?: (
    userId: string,
    options: {
      dataDir: string
      sessionId: string
      turnId?: string
      projectId?: string
      usage: Usage
      idempotencyKey: string
      metadata?: Record<string, unknown>
      authToken?: string
      usageSource?: 'runtime_snapshot' | 'model_runtime_host'
    },
  ) => RecordUsageResult | Promise<RecordUsageResult>
  debitRealtimeUsage?: (
    userId: string,
    options: Parameters<
      NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>
    >[1],
  ) => RecordUsageResult | Promise<RecordUsageResult>
}

export type BeeGameSessionRuntimeStatus = {
  activeTurns: number
  preparingTurns: number
  pendingPermissions: number
  activeNativeTasks: number
  runnerDisposals: number
  cleanupFailures: number
  usageOutbox: {
    configured: boolean
    pendingBuckets: number
    pendingEntries: number
    activeFlushes: number
    state: SessionUsageOutboxStatus['state'] | 'unknown'
  }
}

export class BeeGameSessionManager {
  private readonly runnerDisposals = new Map<Promise<void>, SessionRecord | undefined>()
  private closing?: Promise<void>

  private disposeRunner(runner: BeeGameSessionRuntime | null, record?: SessionRecord): Promise<void> {
    if (!runner) return Promise.resolve()
    const completion = Promise.resolve().then(() => runner.dispose ? runner.dispose() : runner.stop())
      .catch(() => {
        if (record) record.runtimeCleanupFailed = true
        console.error('[BeeGame] Runtime cleanup failed; writer exit is unverified')
      })
    this.runnerDisposals.set(completion, record)
    void completion.then(() => this.runnerDisposals.delete(completion))
    return completion
  }
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly subagentChat = new WeakMap<SessionRecord, ReturnType<typeof createNativeSubagentChatEnricher>>()
  private readonly snapshotInputs = new WeakMap<SessionRecord, {
    source: BeeGameEvent[]; processed: number; events: BeeGameEvent[]; eventCount: number; toolUseCount: number; ordered?: BeeGameEvent[]
  }>()
  private readonly eventSubscribers = new Map<
    string,
    Set<BeeGameEventSubscriber>
  >()
  private readonly projectEventSubscribers = new Set<ProjectEventSubscription>()
  private readonly dashboardDataRoot: string
  private readonly usageOutbox?: SessionUsageOutbox

  constructor(
    private readonly runner: BeeGameSessionRunner = createBgsRunner(),
    dashboardDataRoot?: string,
    private readonly getAdditionalRuntimeEnv: (
      userDataRoot?: string,
      userId?: string,
      authToken?: string,
      modelConfigId?: string,
      signal?: AbortSignal,
    ) => Record<string, string> | Promise<Record<string, string>> = () => ({}),
    private readonly usageBillingBackend: BeeGameSessionUsageBillingBackend = {},
    private readonly allowExternalRuntimeEnv = false,
  ) {
    const configuredDataRoot =
      dashboardDataRoot?.trim() ||
      process.env.AGENT_WORKFLOW_WORKSPACE_PATH?.trim() ||
      process.env.AGENT_WORKFLOW_DATA_DIR?.trim()
    if (!configuredDataRoot) {
      throw new Error('BeeGame session data root is required')
    }
    this.dashboardDataRoot = resolveExistingPath(configuredDataRoot)
    if (usageBillingBackend.recordUsage) {
      this.usageOutbox = new SessionUsageOutbox(this.dashboardDataRoot, usageBillingBackend,
        (entry, result, debit) => {
          const record = this.sessions.get(entry.input.sessionId)
          if (!record || record.session.status !== 'running') return
          for (const [receipt, type, text] of [
            [result, 'billing.usage_recorded', 'Usage recorded'],
            [debit, 'billing.realtime_debited', 'Realtime usage debited'],
          ] as const) {
            if (!receipt || receipt.duplicate || receipt.event.weightedTokensDelta <= 0) continue
            this.append(record, 'system.status', text, {
              type, ...(type === 'billing.usage_recorded' ? { usageEventId: receipt.event.id } : { debitEventId: receipt.event.id }),
              weightedTokens: receipt.event.weightedTokensDelta, creditsMicro: receipt.event.creditsMicro,
              pricingVersion: receipt.event.pricingVersion, idempotencyKey: entry.input.idempotencyKey,
            })
          }
        }, () => console.error('[BeeGame] Pending usage billing could not be settled; retained for retry'))
    }
  }

  /** Auxiliary calls use the same durable transport and restart recovery as agent turns. */
  recordExternalUsage(userId: string, input: import('@bee-game-studio/beegame-billing-core/usage-control-client').BeeGameUsageBillingRecordInput): Promise<RecordUsageResult> {
    if (!this.usageOutbox) return Promise.reject(new UsageOutboxPersistenceError(new Error('Usage billing is unavailable')))
    return this.usageOutbox.submit({ userId, input: { ...input, dataDir: this.dashboardDataRoot } })
  }

  /** Display auxiliary provider receipts separately from native counters and billing. */
  observeExternalModelUsage(sessionId: string, usage: BeeGameModelUsage, billingSource: ModelBillingSource, querySource: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) throw Error('Unknown session for auxiliary model usage')
    this.append(record, 'usage', '', { type: 'usage', subtype: 'model_runtime_host', querySource, billingSource,
      usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_tokens, cache_creation_tokens: usage.cache_creation_tokens, total_tokens: usage.total_tokens },
      ...(usage.incomplete ? { providerUsageIncomplete: true } : {}),
    })
  }

  async assertModelRequestAllowed(userId: string): Promise<void> {
    if (this.closing) throw Error('BeeGame runtime is shutting down')
    if (this.usageBillingBackend.assertUsageAvailable) {
      // Recover acknowledged work before authorizing another paid request,
      // including debt left by a different job or a previous process.
      await this.usageOutbox?.settleForUser(userId)
      await this.usageBillingBackend.assertUsageAvailable(userId)
    }
    if (this.closing) throw Error('BeeGame runtime is shutting down')
  }

  hasActiveOwnerRuntime(userId: string): boolean {
    return [...this.runnerDisposals.values()].some(record => record?.userId === userId) || [...this.sessions.values()].some(record =>
      record.userId === userId && (record.session.turnStatus !== 'idle' || Boolean(record.activeTurn) ||
        Boolean(record.preparingTurn) || record.runtimeCleanupFailed === true))
  }

  /** Read-only counters for the host runtime status endpoint. */
  runtimeStatus(): BeeGameSessionRuntimeStatus {
    let activeTurns = 0
    let preparingTurns = 0
    let pendingPermissions = 0
    let activeNativeTasks = 0
    let cleanupFailures = 0
    for (const record of this.sessions.values()) {
      if (record.session.turnStatus === 'running' || record.activeTurn) activeTurns += 1
      if (record.preparingTurn) preparingTurns += 1
      pendingPermissions += record.pendingPermissions.size
      activeNativeTasks += record.activeNativeTaskToolUseIds.size
      if (record.runtimeCleanupFailed) cleanupFailures += 1
    }
    const usageOutbox = this.usageOutbox?.statusSnapshot()
    return {
      activeTurns,
      preparingTurns,
      pendingPermissions,
      activeNativeTasks,
      runnerDisposals: this.runnerDisposals.size,
      cleanupFailures,
      usageOutbox: usageOutbox
        ? { configured: true, ...usageOutbox }
        : { configured: false, pendingBuckets: 0, pendingEntries: 0, activeFlushes: 0, state: 'idle' },
    }
  }

  start(input: StartBeeGameSessionInput): BeeGameSession {
    if (this.closing) throw Error('BeeGame runtime is shutting down')
    if (input.freshNativeContext && input.resumeNativeSessionId) throw Error('Fresh native context cannot resume a native session')
    if (!isAbsolute(input.workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const cwd = resolve(input.workspacePath)
    const existingLease = [...this.sessions.values()].find(record =>
      record.session.cwd === cwd && record.session.status === 'running' &&
      (!input.workflowExecution || Boolean(record.session.workflowExecution) || record.session.turnStatus !== 'idle'),
    )
    if (existingLease) {
      if (input.freshNativeContext) throw Error('Stop the existing project runner before selecting a fresh native context')
      if (
        input.projectId &&
        existingLease.projectId === input.projectId &&
        existingLease.userId === input.userId &&
        !input.workflowExecution && !existingLease.session.workflowExecution
      ) {
        // The frontend may have opened this idle Chat before its first goal.
        // Bind the current host authorization callback before dispatching work.
        if (input.workflowQuestionGuard && existingLease.session.turnStatus === 'idle')
          existingLease.workflowQuestionGuard = input.workflowQuestionGuard
        return cloneSession(existingLease.session)
      }
      throw new Error(
        `Workspace is already leased by active BeeGame session ${existingLease.session.id}`,
      )
    }
    if (input.projectId && this.hasActiveProjectTurn(input.userId, input.projectId, cwd))
      throw new Error('Previous project request is still stopping')
    mkdirSync(cwd, { recursive: true })
    const runtime = input.modelConfigId
      ? mapModelConfigToRuntime(input.modelConfigId)
      : undefined
    if (input.modelConfigId && !runtime && !this.allowExternalRuntimeEnv && !isPersonalModelId(input.modelConfigId)) {
      throw new Error('Model config not found')
    }

    const now = new Date()
    const sessionId =
      input.transcriptSessionId || `beegame_${randomUUID().replaceAll('-', '')}`
    const session: BeeGameSession = {
      id: sessionId,
      ...(input.workflowExecution ? { workflowExecution: input.workflowExecution } : {}),
      cwd,
      ...(input.modelConfigId ? { modelConfigId: input.modelConfigId } : {}),
      status: 'running',
      turnStatus: 'idle',
      createdAt: now,
      updatedAt: now,
    }

    const recoveredTranscript = input.transcriptSessionId
      ? readExistingTranscriptForResume(input.transcriptSessionId, cwd)
      : undefined
    const persistedRuntime = input.transcriptSessionId
      ? this.readPersistedRuntimeSnapshot(input.transcriptSessionId)
      : undefined
    const confirmedBriefContext = recoverConfirmedBriefContext(
      recoveredTranscript?.events ?? [],
    )
    const transcriptPath = projectChatPath(cwd)
    const source = transcriptReader(transcriptPath)
    const savedEntries = existsSync(transcriptPath) ? source.entriesSync(transcriptPath) : []
    if (savedEntries.length || existsSync(transcriptPath)) source.assertCompleteForAppend()
    const nextProjectId = savedEntries.reduce((max, entry) => Math.max(max, Number(entry.header.id) || 0), 0) + 1
    const record: SessionRecord = {
      session,
      ...(!input.freshNativeContext && persistedRuntime?.workspacePath===cwd && persistedRuntime.executionIdentity
        ? {executionIdentity:persistedRuntime.executionIdentity}:{}),
      ...(input.resumeNativeSessionId
        ? { nativeSessionId: input.resumeNativeSessionId }
        : {}),
      ...(persistedRuntime?.nativeSessionId &&
      !input.resumeNativeSessionId && !input.freshNativeContext &&
      resolveExistingPath(persistedRuntime.workspacePath) ===
        resolveExistingPath(cwd)
        ? { nativeSessionId: persistedRuntime.nativeSessionId }
        : {}),
      ...(!input.freshNativeContext && persistedRuntime?.workspacePath === cwd &&
        persistedRuntime.nativeContext?.threadId === (input.resumeNativeSessionId ?? persistedRuntime.nativeSessionId)
        ? { nativeContext: persistedRuntime.nativeContext } : {}),
      runtime,
      userId: input.userId,
      ...(input.authToken ? { authToken: input.authToken } : {}),
      ...(input.getValidAuthToken
        ? { getValidAuthToken: input.getValidAuthToken }
        : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.userDataRoot ? { userDataRoot: input.userDataRoot } : {}),
      ...(input.language
        ? { language: input.language }
        : recoverSessionLanguage(recoveredTranscript?.events ?? [])),
      ...(confirmedBriefContext ? { confirmedBriefContext } : {}),
      transcriptPath,
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      ...(input.workflowQuestionGuard ? { workflowQuestionGuard: input.workflowQuestionGuard } : {}),
      approvedNetworkHosts: new Set(),
      activeNativeTaskToolUseIds: new Map(),
      thinkingBlockStartedAt: new Map(),
      pendingTranscript: [],
      events: recoveredTranscript?.events ?? [],
      nextEventId: nextProjectId,
      nextTurnIndex: recoveredTranscript
        ? getNextTurnIndex(session.id, recoveredTranscript.events)
        : 1,
      currentTurnId: null,
      usageWriteTail: Promise.resolve(),
      usageFailureReported: false,
      resumeEventPending: Boolean(recoveredTranscript),
    }
    if (confirmedBriefContext) {
      validateConfirmedBriefContext(confirmedBriefContext)
    }
    archiveInterruptedRecoveredTurn(record)
    this.sessions.set(session.id, record)
    this.persistRuntimeSnapshot(record)
    if (!recoveredTranscript) {
      this.append(
        record,
        'session.started',
        `Created BeeGame session in ${cwd}`,
        {
          type: 'session.started',
          ...(record.language ? { language: record.language } : {}),
        },
      )
    }

    return cloneSession(record.session)
  }

  list(userId?: string): BeeGameSession[] {
    return [...this.sessions.values()]
      .filter(record => !userId || record.userId === userId)
      .map(record => cloneSession(record.session))
  }

  pendingPermissionsForProject(
    userId: string,
    projectId: string,
    workspacePath: string,
  ): BeeGamePendingPermission[] {
    const root = resolve(workspacePath)
    const pending: BeeGamePendingPermission[] = []
    for (const record of this.sessions.values()) {
      if (
        record.userId !== userId ||
        record.projectId !== projectId ||
        resolve(record.session.cwd) !== root
      )
        continue
      for (const request of record.pendingPermissions.values()) {
        pending.push({
          ...request,
          sessionId: record.session.id,
          ...(record.projectId ? { projectId: record.projectId } : {}),
        })
      }
    }
    return pending.sort(
      (left, right) => left.requestedAt.getTime() - right.requestedAt.getTime(),
    )
  }

  get(sessionId: string): BeeGameSession | undefined {
    const record = this.sessions.get(sessionId)
    return record ? cloneSession(record.session) : undefined
  }

  hasActiveProjectTurn(userId: string, projectId: string, workspacePath: string, exceptSessionId?: string): boolean {
    return [...this.sessions.values()].some(record =>
      record.userId === userId && record.projectId === projectId &&
      resolve(record.session.cwd) === resolve(workspacePath) && record.session.id !== exceptSessionId &&
      (record.session.turnStatus !== 'idle' || Boolean(record.activeTurn) || Boolean(record.preparingTurn) ||
        record.runtimeCleanupFailed === true || [...this.runnerDisposals.values()].includes(record)))
  }

  language(sessionId: string): BeeGameSessionLanguage | undefined {
    return this.sessions.get(sessionId)?.language
  }

  updateAuthToken(sessionId: string, authToken?: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !authToken) return
    record.authToken = authToken
  }

  metadata(sessionId: string): BeeGameSessionInternalMetadata | undefined {
    const record = this.sessions.get(sessionId)
    if (!record) return undefined
    return {
      id: record.session.id,
      ...(record.session.workflowExecution ? { workflowExecution: record.session.workflowExecution } : {}),
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

  /** Bgs history is owned by app-server, never edited as a raw JSONL file. */
  async projectEditCheckpointInfo(sessionId: string): Promise<{ nativeSessionId?: string }> {
    const record=this.sessions.get(sessionId)
    if(!record)throw Error('Project session not found')
    if(record.session.turnStatus!=='idle'||record.activeTurn||record.preparingTurn)throw Error('Wait for the current agent turn before editing a message')
    return record.nativeSessionId ? {nativeSessionId:record.nativeSessionId} : {}
  }

  async restoreProjectEditCheckpoint(sessionId: string, nativeSessionId?: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Project session not found')
    if (record.session.turnStatus !== 'idle' || record.activeTurn || record.preparingTurn)
      throw new Error('Wait for the current agent turn before editing a message')
    await this.disposeRunner(record.runner, record)
    record.runner = null
    record.nativeSessionId = nativeSessionId
    record.systemContext = undefined
    record.baseInstructions = undefined
    delete record.nativeContext
    this.persistRuntimeSnapshot(record)
  }

  /** The one chat session that owns a project's native conversation. */
  projectConversationSessionId(userId: string, projectId: string, workspacePath: string): string | undefined {
    const root = resolve(workspacePath)
    return [...this.sessions.values()]
      .filter(record => record.userId === userId &&
        record.projectId === projectId && resolve(record.session.cwd) === root && !record.session.workflowExecution)
      .sort((left, right) => right.session.updatedAt.getTime() - left.session.updatedAt.getTime())[0]
      ?.session.id
  }

  runtimeSnapshot(
    sessionId: string,
    workspacePath?: string,
    recoveredEvents?: BeeGameEvent[],
  ): BeeGameRuntimeSnapshot {
    const record = this.sessions.get(sessionId)
    if (record) return this.deriveRuntimeSnapshot(record)
    const persisted = this.readPersistedRuntimeSnapshot(sessionId)
    if (workspacePath) {
      const root = resolveExistingPath(workspacePath)
      const recoveredTranscript = recoveredEvents !== undefined ? (recoveredEvents.length ? { events: recoveredEvents } : undefined) : readExistingTranscriptForResume(
        sessionId,
        root,
      )
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
        resolveExistingPath(workspacePath) ===
          resolveExistingPath(persisted.workspacePath)
      ) {
        // A persisted snapshot is evidence from a previous server process,
        // not proof that its turn or child processes are still alive.
        return {
          ...persisted,
          phaseName: 'idle',
          phaseStatus: 'recovered',
          activeSubagentToolUseIds: [],
        }
      }
    }
    if (workspacePath) {
      const root = resolveExistingPath(workspacePath)
      return deriveRuntimeSnapshotFromEvents(
        sessionId,
        root,
        recoveredEvents ?? readExistingTranscriptForResume(sessionId, root)?.events ?? [],
        undefined,
        { recoveredFromTranscript: true },
      )
    }
    throw new Error('Session not found')
  }

  /** Host status uses the existing incremental index, never full Chat formatting. */
  runtimeStateFacts(sessionId: string) {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    this.runtimeSnapshotInputs(record)
    const index = this.snapshotInputs.get(record)!
    index.ordered ??= index.events.filter(event => !isThinkingProtocolControlEvent(event))
      .map(event => ['turn.failed', 'session.failed'].includes(event.type)
        ? formatBeeGameEventForDisplay(event, record.language) : event)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id)
    return { events: index.ordered, counters: { eventCount: index.eventCount, toolUseCount: index.toolUseCount } }
  }

  events(sessionId: string, after = 0): BeeGameEvent[] {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    return record.events
      .filter(
        event => event.id > after && !isThinkingProtocolControlEvent(event),
      )
      .map(event => formatBeeGameEventForDisplay(event, record.language))
  }

  subscribeEvents(
    sessionId: string,
    subscriber: BeeGameEventSubscriber,
  ): () => void {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    const subscribers = this.eventSubscribers.get(sessionId) ?? new Set()
    const wrappedSubscriber: BeeGameEventSubscriber = event => {
      if (isThinkingProtocolControlEvent(event)) return
      subscriber(formatBeeGameEventForDisplay(event, record.language))
    }
    subscribers.add(wrappedSubscriber)
    this.eventSubscribers.set(sessionId, subscribers)
    return () => {
      const current = this.eventSubscribers.get(sessionId)
      if (!current) return
      current.delete(wrappedSubscriber)
      if (current.size === 0) this.eventSubscribers.delete(sessionId)
    }
  }

  subscribeProjectEvents(
    input: {
      userId: string
      projectId: string
      workspacePath: string
    },
    subscriber: BeeGameEventSubscriber,
  ): () => void {
    const subscription: ProjectEventSubscription = {
      userId: input.userId,
      projectId: input.projectId,
      workspacePath: resolve(input.workspacePath),
      subscriber,
    }
    this.projectEventSubscribers.add(subscription)
    return () => this.projectEventSubscribers.delete(subscription)
  }

  transcript(sessionId: string): Array<{
    id: number
    type: BeeGameEventType
    text: string
    turnId?: string
    payload?: BeeGameEventPayload
    createdAt: Date
  }> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    return this.transcriptFacts(sessionId)
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

  /** Full live-branch facts for host decisions; never display-summarized.
   * Avoid formatting every runtime message just to locate Question outcomes. */
  transcriptFacts(sessionId:string):readonly BeeGameEvent[] {
    const record=this.sessions.get(sessionId)
    if(!record)throw new Error('Session not found')
    return liveProjectConversationEvents(record.events).filter(event=>!isThinkingProtocolControlEvent(event))
  }

  /** Read-only V3 debug view; avoid formatting/serializing all prior runtime events. */
  transcriptPage(sessionId:string, selection:EventPageSelection) {
    const record=this.sessions.get(sessionId)
    if(!record)throw new Error('Session not found')
    return auditEventPage(record.events,selection)
  }

  /** Display-only, durable milestone boundary; never changes the native Agent turn. */
  recordDeliveryPhase(sessionId: string, phase: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    const lastPhase = record.events.findLast(event => event.type === 'system.status' && event.payload?.subtype === 'delivery_phase')
    if (lastPhase?.payload?.phase === phase) return
    this.append(record, 'system.status', phase, { type: 'system.status', subtype: 'delivery_phase', phase })
  }

  /** A host handoff failure is not a failed Agent answer or a completed delivery. */
  recordDeliveryError(sessionId: string, detail: string, category?: 'report-invalid' | 'verification-incomplete' | 'product-failed' | 'workflow-blocked'): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    const labels = {
      'report-invalid': ['验收报告无效：', 'Invalid acceptance report: '],
      'verification-incomplete': ['验收验证不足：', 'Acceptance verification incomplete: '],
      'product-failed': ['游戏验收未通过：', 'Game acceptance failed: '],
      'workflow-blocked': ['任务已停止，尚未完成：', 'Task stopped before completion: '],
    }
    if (category === 'workflow-blocked') {
      detail = projectRuntimeDisplayReason(detail)?.detail ?? ''
      if (record.language === 'zh') detail = detail
        .replace('BGS final result is missing or invalid; no stage was advanced.', '当前阶段未提供有效交接，未进入下一阶段；已保存产物保留，没有自动重试。')
        .replace('Current production assignment ended without its source-bound workflow handoff; no automatic continuation.', '当前阶段缺少有效交接，未进入下一阶段；已保存产物保留，没有自动重试。')
        .replace('Production blocked: ', '当前阶段受阻：')
    }
    const prefix = category ? labels[category][record.language === 'zh' ? 0 : 1]
      : record.language === 'zh' ? '交付未能继续：' : 'Delivery could not continue: '
    this.append(record, 'system.status', formatRuntimeErrorForDisplay(prefix + detail, record.language),
      { type: 'system.status', subtype: 'delivery_error', ...(category ? { category } : {}) })
  }

  /** Display-only host snapshot, independent of the author's final answer. */
  recordHostEvidence(sessionId: string, facts: {
    attemptId: string; turnId?: string; execution: string; note: string; designFileChanges?: DesignFileChanges; projectFileChanges?: ProjectFileChanges;
  }): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (record.events.some(event => event.payload?.subtype === 'host_evidence' && event.payload?.attemptId === facts.attemptId)) return
    const note = projectRuntimeDisplayReason(facts.note)?.detail ?? ''
    const zh = record.language === 'zh'
    const text = [
      zh ? 'BGS 执行记录｜本轮执行已结束' : 'BGS execution record | Turn ended',
      (zh ? '执行状态：' : 'Execution: ')+facts.execution,
      ...(facts.designFileChanges ? [
        (zh ? '本轮设计文件差异（不代表修改者或验收）：' : 'Design file changes this turn (not authorship or acceptance): ')+
          (facts.designFileChanges.status === 'unverified' ? (zh ? '未验证' : 'unverified') :
            facts.designFileChanges.files.map(file => file.path+' ('+file.change+')').join(', ') || (zh ? '无' : 'none')),
      ] : []),
      zh ? '执行结束和文件变化不代表内容验收；内容质量未验证。' : 'Execution and file changes do not certify content acceptance; quality is unverified.',
      note,
    ].join('\n')
    this.append(record, 'system.status', text, {type:'system.status',subtype:'host_evidence',...facts,note,quality:'unverified',deliveryEligible:false}, facts.turnId)
  }

  /** Persist a user message for the chat surface without starting a model turn. */
  appendUserMessage(
    sessionId: string,
    text: string,
    payload?: Record<string, unknown>,
  ): void {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    this.append(record, 'user.message', text, {
      type: 'user.message',
      ...(payload ?? {}),
    })
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
      /** Host workflow work retains turn evidence without inventing user input. */
      messageOrigin?: 'user' | 'workflow'
      /** A settled production handoff continues work; it is not a user resume. */
      resumeReason?: 'production-handoff'
      taskType?: string
      authToken?: string
      getValidAuthToken?: SessionRecord['getValidAuthToken']
      clientMessageId?: string
      supersedesMessageId?: string
      rewindAvailable?: boolean
      language?: BeeGameSessionLanguage
      attachments?: BeeGameAttachment[]
      confirmedBriefContext?: string
      nativeGoal?: BeeGameNativeGoalInput
      nativeRecovery?: boolean
      onTurnAccepted?: (turnId: string) => void
      /** Called before entering the native runner; absence is known only by this live caller. */
      onNativeStart?: () => void
      executionIdentity?: Pick<NonNullable<BeeGameRuntimeSnapshot['executionIdentity']>, 'attemptId'|'workerId'|'fence'>
      prepareTurn?: () => Promise<BeeGameTurnTools & { systemContext?: string; turnContext?: string;
        close?: () => Promise<void> }>
      onTurnSettled?: () => Promise<void>
      onTurnReady?: () => void | Promise<void>
      usageExternallyAccounted?: boolean
    },
  ): Promise<BeeGameSession> {
    if (this.closing) throw Error('BeeGame runtime is shutting down')
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status !== 'running') {
      throw new Error('Session is not running')
    }
    if (record.session.turnStatus !== 'idle' || record.preparingTurn || record.activeTurn) {
      throw new Error('Session is already processing a prompt')
    }
    if (record.projectId && this.hasActiveProjectTurn(
      record.userId, record.projectId, record.session.cwd, sessionId,
    )) throw new Error('Previous project request is still stopping')
    // Claim the turn synchronously before any preparation, hooks, or remote
    // credit calls can yield. Delivery resume and polling paths may race each
    // other; without this claim they can start the same logical turn twice.
    record.session.turnStatus = 'running'
    record.preparingTurn = true
    record.currentTurnUsageExternallyAccounted = display?.usageExternallyAccounted === true
    let turnAccepted = false
    let close: (() => Promise<void>) | undefined
    try {
      if (display?.authToken) record.authToken = display.authToken
      if (display?.getValidAuthToken) record.getValidAuthToken = display.getValidAuthToken
      if (display?.language && display.language !== record.language) {
        await this.disposeRunner(record.runner, record)
        record.runner = null
        record.language = display.language
      }
      const context = await display?.prepareTurn?.()
      close = context?.close
      if (context && (context.baseInstructions !== record.baseInstructions || context.systemContext !== record.systemContext)) {
        await this.disposeRunner(record.runner, record)
        record.runner = null
        record.systemContext = context.systemContext
        record.baseInstructions = context.baseInstructions
      }
      if (record.session.status !== 'running') throw new Error('Session was stopped during turn preparation')
      if (display?.confirmedBriefContext) {
        validateConfirmedBriefContext(display.confirmedBriefContext)
        record.confirmedBriefContext = display.confirmedBriefContext
      }
      if (record.resumeEventPending) {
        record.resumeEventPending = false
        if (display?.resumeReason === 'production-handoff') {
          // The index must still follow the restored transcript without a
          // user-facing resume event for an internal stage transition.
          updateProjectTranscriptIndex(record)
        } else this.append(
          record,
          'session.resumed',
          `Resumed BeeGame session in ${record.session.cwd}`,
          {
            type: 'session.resumed',
            ...(record.language ? { language: record.language } : {}),
          },
        )
      }

      const preparedPrompt = await prepareBeeGamePromptInput({
        text,
        workspace: record.session.cwd,
        attachments: display?.attachments,
        displayKind: display?.displayKind,
      })
      if (record.session.status !== 'running') throw new Error('Session was stopped during turn preparation')
      const nextTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
      record.thinkingBlockStartedAt.clear()
      record.currentTurnId = nextTurnId
      record.executionIdentity = display?.executionIdentity ? {...display.executionIdentity,turnId:nextTurnId}:undefined
      record.nextTurnIndex += 1
      display?.onTurnAccepted?.(nextTurnId)
      turnAccepted = true
      record.abortController = new AbortController()
      this.append(record, 'turn.started', text, display?.messageOrigin === 'workflow' || display?.nativeRecovery ? {
        type: 'turn.started', messageOrigin: 'workflow',
        ...(display.confirmedBriefContext ? { confirmedBriefContext: display.confirmedBriefContext } : {}),
      } : undefined)
      if (display?.messageOrigin !== 'workflow' && !display?.nativeRecovery) this.append(record, 'user.message', text, {
        type: 'user.message',
        ...(preparedPrompt.attachments.length ? { attachments: preparedPrompt.attachments } : {}),
        ...(display?.displayText ? { displayText: display.displayText } : {}),
        ...(display?.displayKind ? { displayKind: display.displayKind } : {}),
        ...(display?.confirmedBriefContext
          ? { confirmedBriefContext: display.confirmedBriefContext }
          : {}),
        ...(display?.clientMessageId
          ? { clientMessageId: display.clientMessageId }
          : {}),
        ...(display?.supersedesMessageId
          ? { supersedesMessageId: display.supersedesMessageId }
          : {}),
        ...(display?.rewindAvailable ? { rewindAvailable: true } : {}),
      })

      let activeTurn!: Promise<void>
      let settlementSucceeded = false
      activeTurn = this.runDirectTurn(
        record,
        display?.nativeRecovery ? [] : context?.turnContext ? [
          // Keep platform facts before the final user intent, which Bgs uses
          // for explicit Skill selection.
          { type: 'text' as const, text: context.turnContext },
          ...(typeof preparedPrompt.prompt === 'string'
            ? [{ type: 'text' as const, text: preparedPrompt.prompt }] : preparedPrompt.prompt),
        ] : preparedPrompt.prompt,
        async () => {
          try { await display?.onTurnSettled?.() }
          finally { await close?.() }
          settlementSucceeded = true
        },
        display?.nativeGoal,
        display?.nativeRecovery,
        { baseInstructions: context?.baseInstructions, workflow: context?.workflow, workflowDescription: context?.workflowDescription, implementationHandoff: context?.implementationHandoff, finalOutput: context?.finalOutput, restartFromDesign: context?.restartFromDesign, imageGenerationEntry: context?.imageGenerationEntry },
        display?.onNativeStart,
      ).finally(() => {
        if (record.activeTurn === activeTurn) record.activeTurn = undefined
      })
      record.activeTurn = activeTurn
      // Only hand off after settlement, capability cleanup and releasing the
      // active-turn guard. A timer inside settlement can race any awaited cleanup.
      void activeTurn.then(async () => {
        if (settlementSucceeded && record.session.status === 'running' && record.session.turnStatus === 'idle' && !record.activeTurn)
          await display?.onTurnReady?.()
      }).catch(error => this.recordDeliveryError(sessionId, toErrorMessage(error)))
      return cloneSession(record.session)
    } catch (error) {
      if (!turnAccepted) {
        try { await close?.() }
        finally {
          record.currentTurnUsageExternallyAccounted = undefined
          record.currentTurnId = null
          record.abortController = null
          record.session.turnStatus = 'idle'
        }
      }
      throw error
    } finally {
      record.preparingTurn = false
    }
  }

  stop(sessionId: string, reason = 'user_stop'): BeeGameSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.status === 'running') {
      record.session.status = 'stopped'
      record.abortController?.abort(reason)
      void this.disposeRunner(record.runner, record)
      record.runner = null
      record.activeNativeTaskToolUseIds.clear()
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        source: 'policy',
        message: 'Session stopped before permission was resolved',
      })
      record.approvedNetworkHosts.clear()
      record.session.turnStatus = 'idle'
      record.session.updatedAt = new Date()
      this.append(record, 'session.stopped', 'BeeGame session stopped', { type: 'session.stopped', reason })
    }
    return cloneSession(record.session)
  }

  /** Cancel one workflow turn without ending the project's conversation. */
  interruptTurn(sessionId: string, reason = 'turn_interrupted'): BeeGameSession {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.session.turnStatus === 'running' || record.preparingTurn) {
      record.abortController?.abort(reason)
      void this.disposeRunner(record.runner, record)
      record.runner = null
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        source: 'policy',
        message: 'Current production stage was interrupted.',
      })
      record.approvedNetworkHosts.clear()
      record.session.turnStatus = 'idle'
      record.session.updatedAt = new Date()
      this.flushStreamPersistence(record)
    }
    return cloneSession(record.session)
  }

  async delete(
    sessionId: string,
    options: { deleteArtifacts?: boolean } = {},
  ): Promise<DeleteBeeGameSessionResult> {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    if (record.runtimeCleanupFailed)
      throw new Error('Runtime cleanup failed; writer exit is unverified')

    if (record.session.status === 'running') {
      record.abortController?.abort('session_deleted')
      await this.disposeRunner(record.runner, record)
      record.runner = null
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        message: 'Session deleted before permission was resolved',
        source: 'policy',
      })
    }

    // stop() may have initiated an asynchronous disposal before this delete
    // call. Wait for that same cleanup to settle and retain the session if it
    // failed; otherwise deleting the record would erase the only busy signal.
    await record.activeTurn?.catch(() => undefined)
    await Promise.all([...this.runnerDisposals].filter(([, owner]) => owner === record).map(([completion]) => completion))
    if (record.runtimeCleanupFailed)
      throw new Error('Runtime cleanup failed; writer exit is unverified')

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
    this.flushStreamPersistence(record)
    this.sessions.delete(sessionId)
    this.eventSubscribers.delete(sessionId)
    return { deleted: true, deletedArtifactPaths }
  }

  /** Wait until a stopped project turn has fully unwound before resuming its
   * existing transcript/native session. This prevents a stop/resume race from
   * admitting a second turn while the first runner is still disposing. */
  async waitForSessionIdle(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    while (record.preparingTurn) await new Promise(resolve => setTimeout(resolve, 10))
    await record.activeTurn?.catch(() => undefined)
    await Promise.all([...this.runnerDisposals.keys()])
    if (record.runtimeCleanupFailed) throw new Error('Runtime cleanup failed; writer exit is unverified')
  }

  dispose(): Promise<void> {
    // Close admission synchronously, before any stop/cleanup callback yields.
    return this.closing ??= Promise.resolve().then(() => this.drain())
  }

  private async drain(): Promise<void> {
    const activeTurnDrains: Promise<void>[] = []
    for (const record of this.sessions.values()) {
      // Mark the session stopped before the transport can flush any more
      // messages. Aborting a runner while leaving the record "running" lets
      // late runtime events cross a hot-reload boundary and mutate durable state.
      if (record.session.status === 'running') this.stop(record.session.id, 'service_shutdown')
      else {
        record.abortController?.abort('service_shutdown')
        void this.disposeRunner(record.runner, record)
        record.runner = null
        this.resolveAllPendingPermissions(record, {
          behavior: 'deny',
          message: 'BeeGame server stopped before permission was resolved',
          source: 'policy',
        })
      }
      if (record.activeTurn)
        activeTurnDrains.push(record.activeTurn.catch(() => undefined))
    }
    await Promise.all(activeTurnDrains)
    await Promise.all(this.runnerDisposals.keys())
    await Promise.all([...this.sessions.values()].map(record => record.usageWriteTail))
    await this.usageOutbox?.dispose()
    for (const record of this.sessions.values()) this.flushStreamPersistence(record)
    this.eventSubscribers.clear()
  }

  /**
   * Runtime feature changes apply by rebuilding only idle native runners.
   * Active BeeGame Studio turns are never interrupted or rescheduled by BeeGame.
   */
  refreshIdleRunners(userId?: string): number {
    let refreshed = 0
    for (const record of this.sessions.values()) {
      if (userId && record.userId !== userId) continue
      record.runnerNeedsRefresh = true
      if (record.session.turnStatus !== 'idle' || !record.runner) continue
      void this.disposeRunner(record.runner, record)
      record.runner = null
      refreshed += 1
    }
    return refreshed
  }

  async readArtifact(
    sessionId: string,
    path: string,
  ): Promise<BeeGameArtifact> {
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
    return readCanonicalProjectArtifactConsistently(record.session.cwd, async () => ({
      path: relativePath,
      content: await readInlineArtifactText(targetPath),
    }))
  }

  async createProjectPackage(
    sessionId: string | undefined,
    workspacePath?: string,
    expectedIdentity?: ProjectArtifactIdentity,
  ): Promise<BeeGameProjectPackage> {
    const record = sessionId ? this.sessions.get(sessionId) : undefined
    if (!record && !workspacePath) throw new Error('Session not found')
    if (!record && workspacePath && !isAbsolute(workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const root = resolve(record?.session.cwd ?? workspacePath ?? '')
    if (record && expectedIdentity &&
      (expectedIdentity.ownerId !== record.userId ||
       (record.projectId !== undefined && expectedIdentity.projectId !== record.projectId))) {
      throw new Error('Artifact identity does not match the session owner or project')
    }
    const data = await readCanonicalProjectArtifactConsistently(
      root,
      async () => {
        // Package the canonical workspace. Application-owned publication files
        // are internal bookkeeping and must never be reintroduced into the archive.
        const files = (await collectPackageFiles(root))
          .filter(file => !file.startsWith('.beegame/artifacts/'))
          .sort()
        const data = createZipArchive(
          await Promise.all(
            files.map(async file => ({
              path: file,
              data: await readFile(resolve(root, file)),
            })),
          ),
        )
        return data
      },
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
    settle?: () => Promise<void>,
    nativeGoal?: BeeGameNativeGoalInput,
    nativeRecovery?: boolean,
    tools: BeeGameTurnTools = {},
    onNativeStart?: () => void,
  ): Promise<void> {
    let turnRunner: BeeGameSessionRuntime | null = null
    let billingSource: ModelBillingSource = 'platform'
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      // Repair ignore coverage for pre-existing projects before tools or the
      // runtime start writing. Sessions without Git remain without Git.
      await initializeProjectRepository(record.session.cwd, {
        createIfMissing: false,
        engine: record.confirmedBriefContext ? JSON.parse(record.confirmedBriefContext).settings?.engine : undefined,
      })
      const additionalEnv = await this.loadAdditionalRuntimeEnv(record, signal)
      // Only the host connection resolver supplies billing provenance. A model
      // config's arbitrary env must not select whether the user pays BGS.
      billingSource = getModelBillingSource(additionalEnv)
      const previousSourceEvent = record.events.findLast(event => typeof event.payload?.billingSource === 'string')
      const previousBillingSource = getModelBillingSource({
        BEEGAME_MODEL_BILLING_SOURCE: previousSourceEvent?.payload?.billingSource,
      })
      if (billingSource === 'platform') await this.assertModelRequestAllowed(record.userId)
      const selectedEnvironment = mergeRuntimeEnv(record.runtime, additionalEnv)
      const env: Record<string, string> = {
        ...buildRuntimeEnv(selectedEnvironment),
      }
      record.redactVisible = createResponseRedactor(env)
      if (signal.aborted || record.session.status !== 'running') return
      if (record.runnerNeedsRefresh || (record.runner && record.runnerBillingSource !== billingSource)) {
        await this.disposeRunner(record.runner, record)
        record.runner = null
        record.runnerNeedsRefresh = false
      }
      if (nativeGoal) delete record.nativeContext // Historical Goal injection has its own context lifecycle.
      if (!record.runner) record.nativeAccountingEpoch = randomUUID()
      const accountingEpoch = record.nativeAccountingEpoch
      onNativeStart?.()
      const runner =
        record.runner ??
        (await this.runner.start({
          sessionId: record.session.id,
          ...tools,
          ...(nativeGoal ? { nativeGoal } : {}),
          ...(nativeRecovery ? { nativeRecovery } : {}),
          systemContext: record.systemContext,
          confirmedBriefContext: record.confirmedBriefContext,
          ...(record.nativeSessionId
            ? { resumeSessionId: record.nativeSessionId }
            : {}),
          nativeContext: record.nativeContext,
          onNativeContext: context => {
            if (context.threadId !== record.nativeSessionId) throw Error('Native context belongs to another thread')
            record.nativeContext = context
            this.persistRuntimeSnapshot(record)
          },
          onNativeSessionId: nativeSessionId => {
            if (record.nativeContext?.threadId !== nativeSessionId) delete record.nativeContext
            record.nativeSessionId = nativeSessionId
            this.persistRuntimeSnapshot(record)
          },
          onNativeSubmission: nativeSessionId => {
            record.nativeSessionId = nativeSessionId
            if(record.executionIdentity)record.executionIdentity={...record.executionIdentity,nativeSubmitted:true}
            this.persistRuntimeSnapshot(record)
          },
          onNativeUsage: (usage, epoch, accounting) => {
            // Resume may recover a receipt the host never saw. Its work used
            // the prior connection, regardless of the newly selected source.
            const historicalUsage = accounting?.replayed && accounting.nativeTurnId
              ? record.events.findLast(event => event.type === 'usage' && event.payload?.subtype === 'native_accounting' &&
                event.payload?.nativeAccountingEpoch === epoch && getDashboardPayloadString(event.payload, 'nativeTurnId') === accounting.nativeTurnId)
              : undefined
            const historicalEvent = historicalUsage ?? (accounting?.replayed && accounting.nativeTurnId
              ? record.events.findLast(event => getDashboardPayloadString(event.payload, 'nativeTurnId') === accounting.nativeTurnId)
              : previousSourceEvent)
            // The recovered counter used the prior protocol as well as the
            // prior connection. Switching bridges cannot promote a baseline
            // to a receipt, or discard a previously billable native increment.
            const baselineOnly = historicalUsage ? historicalUsage.payload?.usageBaselineOnly === true : accounting?.baselineOnly
            const recoveredTurnId = historicalEvent?.payload?.usageReplayed === true
              ? getDashboardPayloadString(historicalEvent.payload, 'usageAttributedTurnId')
              : historicalEvent?.turnId
            const receiptBillingSource = accounting?.replayed ? getModelBillingSource({
              BEEGAME_MODEL_BILLING_SOURCE: historicalEvent?.payload?.billingSource ?? previousBillingSource,
            }) : billingSource
            // Passive accounting stays out of model history. Persist acknowledged
            // provider work even if cancellation prevents a complete receipt.
            if (usage.total_tokens > 0 || accounting?.incomplete) this.append(record, 'usage', '', {
              type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch ?? accountingEpoch, usage,
              billingSource: receiptBillingSource, providerReceiptIncomplete: accounting?.incomplete === true,
              ...(baselineOnly ? { usageBaselineOnly: true } : {}),
              ...(accounting?.incomplete ? { providerUsageIncomplete: true } : {}),
              ...(accounting?.nativeTurnId ? { nativeTurnId: accounting.nativeTurnId } : {}),
              ...(accounting?.replayed ? { usageReplayed: true, usageAttributedTurnId: recoveredTurnId ?? null } : {}),
            })
            // Native receipts arrive even during tool-only turns. Settle the
            // acknowledged cumulative usage without waiting for an answer.
            const usageTurnId = accounting?.replayed ? recoveredTurnId : record.currentTurnId
            if (receiptBillingSource === 'platform' && !baselineOnly && usageTurnId && !record.currentTurnUsageExternallyAccounted)
              void this.recordUsageSnapshot(record, usageTurnId, true)
          },
          cwd: record.session.cwd,
          env,
          ...(record.language ? { language: record.language } : {}),
          requestPermission: request => this.requestPermission(record, request),
        }))
      record.runner = runner
      record.runnerBillingSource = billingSource
      turnRunner = runner
      if (signal.aborted || record.session.status !== 'running') {
        await this.disposeRunner(runner, record)
        record.runner = null
        return
      }
      // Persist provenance before dispatch, even if no usage notification
      // reaches the host. The existing transcript then attributes resume replay.
      if (!previousSourceEvent || previousBillingSource !== billingSource)
        this.append(record, 'usage', '', { type: 'usage', subtype: 'model_connection', billingSource, providerReceiptIncomplete: false })
      await this.submitToRunner(
        record,
        runner,
        prompt,
        signal,
        billingSource,
        nativeGoal,
        nativeRecovery,
        tools,
      )
      if (runner.reusable === false) {
        await this.disposeRunner(runner, record)
        if (record.runner === runner) record.runner = null
        record.activeNativeTaskToolUseIds.clear()
      }
      try {
        if (signal.aborted && record.session.status === 'running') {
          // A cooperative runner may return normally on cancellation. Preserve
          // the interrupted turn identity for settlement/recovery even then.
          this.append(record, 'turn.failed', 'Turn interrupted before completion', { type: 'turn.failed', reason: 'turn_interrupted' })
        } else if (record.session.status === 'running') {
          const turnId = record.currentTurnId
          const hasFinalResult = hasNativeFinalResult(record.events, turnId) || Boolean(nativeGoal &&
            record.events.some(event=>{
              const goal=event.payload?.nativeGoal
              return event.turnId===turnId && event.type==='system.status' &&
                event.payload?.runtime==='bgs' && event.payload?.subtype==='native_goal' &&
                goal && typeof goal==='object' && 'status' in goal && typeof goal.status==='string' &&
                ['complete','blocked','paused','budgetLimited','usageLimited'].includes(goal.status)
            }))
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
      } finally {
        if (signal.aborted) {
          await this.disposeRunner(runner, record)
          if (record.runner === runner) record.runner = null
        }
      }
    } catch (err) {
      await this.disposeRunner(turnRunner ?? record.runner, record)
      if (!turnRunner || record.runner === turnRunner) record.runner = null
      // The disposed process cannot keep any task live. Clear attribution,
      // without fabricating completed events for unfinished writers.
      record.activeNativeTaskToolUseIds.clear()
      if (record.session.status === 'running' && err instanceof ProductionBlockedError && record.abortController?.signal.aborted === false) {
        this.append(record, 'turn.completed', err.message, { type: 'turn.completed', subtype: 'production_blocked' })
      } else if (record.session.status === 'running') {
        this.append(
          record,
          'turn.failed',
          formatRuntimeErrorForDisplay(toErrorMessage(err), record.language),
          err instanceof BgsClientError ? { type: 'turn.failed', bgsErrorInfo: err.bgsErrorInfo } : undefined,
        )
      }
    } finally {
      try { await settle?.() }
      catch (error) {
        this.recordDeliveryError(record.session.id, `Request cleanup failed: ${toErrorMessage(error)}`)
      }
      const terminalTurnId = record.currentTurnId
      if (billingSource === 'platform' && terminalTurnId && !record.currentTurnUsageExternallyAccounted) {
        // Remote billing is accounting, not worker lifecycle authority. A
        // slow or unavailable billing service must not keep a completed native
        // turn (and therefore the whole workflow) in the running state.
        void this.recordUsageSnapshot(record, terminalTurnId)
      }
      if (record.session.status === 'running') {
        record.session.turnStatus = 'idle'
      }
      // These files back durable Chat references; a finished turn must not
      // delete earlier user uploads or tool screenshots from the same store.
      record.currentTurnId = null
      record.thinkingBlockStartedAt.clear()
      record.abortController = null
      record.currentTurnUsageExternallyAccounted = undefined
      record.session.updatedAt = new Date()
    }
  }

  private async loadAdditionalRuntimeEnv(
    record: SessionRecord,
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    try {
      return await this.getAdditionalRuntimeEnv(
        record.userDataRoot,
        record.userId,
        record.authToken,
        record.session.modelConfigId,
        signal,
      )
    } catch (error) {
      signal.throwIfAborted()
      if (!isSupabaseRuntimeEnvAuthError(error) || !record.getValidAuthToken) {
        throw error
      }
      const refreshed = await record.getValidAuthToken({ forceRefresh: true })
      if (!refreshed) {
        throw new Error(
          'Workflow authentication expired and could not be refreshed. Please sign in again.',
        )
      }
      signal.throwIfAborted()
      record.authToken = refreshed
      return this.getAdditionalRuntimeEnv(
        record.userDataRoot,
        record.userId,
        refreshed,
        record.session.modelConfigId,
        signal,
      )
    }
  }

  private async submitToRunner(
    record: SessionRecord,
    runner: BeeGameSessionRuntime,
    prompt: BeeGamePromptInput,
    signal: AbortSignal,
    billingSource: ModelBillingSource,
    nativeGoal?: BeeGameNativeGoalInput,
    nativeRecovery?: boolean,
    tools: BeeGameTurnTools = {},
  ): Promise<void> {
    const submittedTurnId = record.currentTurnId
    await runner.submit({
      prompt,
      ...tools,
      ...(nativeGoal ? { nativeGoal } : {}),
      ...(nativeRecovery ? { nativeRecovery } : {}),
      ...(record.language ? { language: record.language } : {}),
      ...(record.confirmedBriefContext
        ? { confirmedBriefContext: record.confirmedBriefContext }
        : {}),
      signal,
      onMessage: async message => {
        appendProjectAgentDiagnostic(record, message)
        if (message.type === 'runtime_event') {
          if (!submittedTurnId || record.currentTurnId !== submittedTurnId) return
          const goal = message.nativeGoal as {status?: string} | undefined
          // The host pause response accounts usage after abort. Preserve its
          // terminal snapshot for continuation; all other late events stay out.
          const finalNativeGoal = message.runtime === 'bgs' && message.eventType === 'system.status' &&
            message.subtype === 'native_goal' && message.threadId === record.nativeSessionId &&
            ['paused','blocked','usageLimited','budgetLimited','complete'].includes(goal?.status ?? '')
          if (!finalNativeGoal && (signal.aborted || hasTurnEnded(this.runtimeSnapshotInputs(record), submittedTurnId))) return
          const type = String(message.eventType) as BeeGameEventType
          const text = typeof message.text === 'string' ? message.text : ''
          if (type === 'system.status' && typeof message.childThreadId === 'string') {
            if (['pendingInit','running'].includes(String(message.childStatus)))
              record.activeNativeTaskToolUseIds.set(message.childThreadId, String(message.parentToolUseID || message.childThreadId))
            else record.activeNativeTaskToolUseIds.delete(message.childThreadId)
          }
          let payload = message
          if (type === 'tool.completed' && typeof message.imagePath === 'string') {
            try {
              const path = await realpath(resolve(record.session.cwd, message.imagePath))
              const rel = relative(await realpath(record.session.cwd), path)
              if (rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) {
                const info = await stat(path)
                const mediaType = IMAGE_ATTACHMENT_TYPES[extname(path).toLowerCase()]?.[0]
                if (info.isFile() && info.size <= MAX_BEEGAME_ATTACHMENT_BYTES && mediaType) {
                  const attachments = await materializeBeeGameAttachments(record.session.cwd, [{type:'image',
                    mediaType: mediaType as BeeGameImageAttachment['mediaType'], data:(await readFile(path)).toString('base64')}],
                    join(projectHostDirectory(record.session.cwd), 'chat-attachments'))
                  payload = {...message,attachments:attachments.map(({relativePath:_path,...reference})=>reference)}
                }
              }
            } catch { payload = {...message,attachmentError: "Image preview could not be attached"} }
          }
          this.append(record, type, text, { ...payload, billingSource })
          return
        }
      },
      requestPermission: request => this.requestPermission(record, request),
    })
  }

  private async recordUsageSnapshot(
    record: SessionRecord,
    turnId: string,
    checkpoint = false,
  ): Promise<void> {
    if (!this.usageBillingBackend.recordUsage) return
    const events = this.runtimeSnapshotInputs(record)
    const sessionCumulativeUsage = getLatestRuntimeUsage(events)
    const billableCumulativeUsage = getLatestRuntimeUsage(events, true)
    const turnDeltaUsage = getRuntimeUsageForTurn(events, turnId, true)
    const providerUsageIncomplete = record.events.some(event =>
      event.type === 'usage' && isPlatformUsageEvent(event) &&
      (event.payload?.providerReceiptIncomplete ?? event.payload?.providerUsageIncomplete) === true)
    if (turnDeltaUsage.total_tokens <= 0 && !providerUsageIncomplete) return
    const terminalEvent = checkpoint ? undefined : [...record.events]
      .reverse()
      .find(event =>
        event.turnId === turnId &&
        [
          'result',
          'turn.completed',
          'turn.empty',
          'turn.failed',
          'session.stopped',
          'session.failed',
        ].includes(event.type),
      )
    const terminalDigest = createHash('sha256')
      .update(JSON.stringify({
        type: checkpoint ? 'usage_checkpoint' : terminalEvent?.type ?? 'turn_terminal',
        text: terminalEvent?.text ?? '',
        turnDeltaUsage,
        ...(providerUsageIncomplete ? { providerUsageIncomplete: true } : {}),
      }))
      .digest('hex')
    const billingAuthority = `${record.session.id}:${turnId}`
    const idempotencyKey = `usage-${checkpoint ? 'checkpoint' : 'terminal'}:${billingAuthority}:${terminalDigest}`
    if (idempotencyKey === record.usageLastCommittedKey) return
    const deliveryPhase = record.events.findLast(event =>
      event.type === 'system.status' && event.payload?.subtype === 'delivery_phase')?.payload?.phase
    const write = {
      turnId,
      sourceMessageType: checkpoint ? 'usage_checkpoint' : terminalEvent?.type ?? 'turn_terminal',
      // The billing authority computes its own delta from platform-only
      // cumulative usage; personal increments never enter this baseline.
      usage: billableCumulativeUsage,
      idempotencyKey,
      metadata: {
        usageBasis: 'session-cumulative-v1',
        billingSource: 'platform',
        ...(providerUsageIncomplete ? { providerUsageIncomplete: true } : {}),
        // Existing SQL reads this field as the next billed snapshot baseline.
        providerCumulativeUsage: billableCumulativeUsage,
        sessionCumulativeUsage,
        turnDeltaUsage,
        ...(!providerUsageIncomplete ? { billableFinalUsage: billableCumulativeUsage } : {}),
        terminalDigest,
        ...(typeof deliveryPhase === 'string' ? { deliveryPhase } : {}),
      },
    }
    // Persist the bill now, not after an earlier remote request finishes.
    // Model turns are allowed to continue while billing is unavailable.
    const firstAttempt = this.writeUsageRecord(record, write)
    void firstAttempt.catch(() => undefined)
    const previousWrite = record.usageWriteTail
    record.usageWriteTail = previousWrite.catch(() => undefined).then(async () => {
      let failure: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await (attempt === 0 ? firstAttempt : this.writeUsageRecord(record, write))
          failure = undefined
          break
        } catch (error) {
          failure = error
          if (attempt < 2) {
            await new Promise(resolve =>
              setTimeout(resolve, 100 * (attempt + 1)),
            )
          }
        }
      }
      if (!failure) {
        record.usageLastCommittedKey = write.idempotencyKey
        record.usageFailureReported = false
      } else if (
        record.session.status === 'running' &&
        !record.usageFailureReported
      ) {
        record.usageFailureReported = true
        this.append(record, 'system.status', 'Usage recording failed', {
          type: 'billing.usage_record_failed',
          error: failure instanceof Error ? failure.message : String(failure),
          idempotencyKey: write.idempotencyKey,
        })
      }
    })
    await record.usageWriteTail
  }

  private async writeUsageRecord(
    record: SessionRecord,
    write: {
      turnId: string
      sourceMessageType: string
      usage: Usage
      idempotencyKey: string
      metadata: Record<string, unknown>
    },
  ): Promise<void> {
    const options = {
      dataDir: record.userDataRoot ?? this.dashboardDataRoot,
      sessionId: record.session.id,
      turnId: write.turnId,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      usage: write.usage,
      idempotencyKey: write.idempotencyKey,
      metadata: {
        sourceMessageType: write.sourceMessageType,
        modelConfigId: record.session.modelConfigId,
        ...write.metadata,
      },
    }
    await this.usageOutbox!.submit({ userId: record.userId, input: options })
  }

  resolvePermission(
    sessionId: string,
    toolUseID: string,
    decision: DashboardPermissionDecision & { remember?: boolean; answers?: unknown },
  ): { resolved: boolean } {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    const pending = record.pendingPermissions.get(toolUseID)
    if (!pending) throw new Error('Permission request not found')

    if (decision.intent !== undefined)
      throw new UserQuestionValidationError('Question answers do not rewrite the authorized task; use the existing task change request')
    // Validate before consuming the pending request so a failed submission can retry.
    if (decision.behavior === 'allow' &&
        (['AskUserQuestion', 'McpElicitation'].includes(pending.toolName) || decision.answers !== undefined)) {
      const updatedInput = answeredQuestionInput(pending.toolName, pending.input, decision.answers)
      const approvalPersist = pending.toolName === 'McpElicitation' ? updatedInput.approvalPersist : undefined
      decision = {
        ...decision,
        updatedInput,
        source: 'user',
        scope: approvalPersist === 'session' ? 'session' : 'once',
        remember: approvalPersist === 'always',
        updatedPermissions: [],
      }
    }
    record.pendingPermissions.delete(toolUseID)
    if (decision.behavior === 'allow' && decision.scope === 'session' && pending.toolName === 'SandboxNetworkAccess') {
      const host = typeof pending.input.host === 'string' ? pending.input.host.trim().toLowerCase() : ''
      if (host) record.approvedNetworkHosts.add(host)
    }
    const resolvedDecision =
      decision.behavior === 'allow' &&
      decision.scope === 'session' &&
      decision.updatedPermissions === undefined
        ? {
            ...decision,
            updatedPermissions: (pending.permissionSuggestions ?? []).map(
              suggestion => ({ ...suggestion, destination: 'session' }),
            ),
          }
        : decision
    pending.resolve(resolvedDecision)
    this.append(
      record,
      'permission.resolved',
      `${pending.toolName}: ${decision.behavior}`,
      {
        type: 'permission.resolved',
        toolUseID,
        toolName: pending.toolName,
        ...(pending.agentId ? { agentId: pending.agentId } : {}),
        message: pending.message,
        decision: decision.behavior,
        ...(decision.intent ? {intent:decision.intent} : {}),
        scope: decision.scope ?? 'once',
        remember: Boolean(decision.remember),
        ...(pending.toolName === 'AskUserQuestion' && decision.behavior === 'allow' ? { input: decision.updatedInput } : {}),
      },
    )
    return { resolved: true }
  }

  private async requestPermission(
    record: SessionRecord,
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision> {
    // Native permission callbacks can arrive while a stopped runner drains.
    // Its original tool call is no longer resumable, so never publish a new
    // approval gate after the turn has been aborted.
    const turnId = record.currentTurnId
    const current = () => record.session.status === 'running' && record.session.turnStatus === 'running' &&
      record.currentTurnId === turnId && record.abortController?.signal.aborted === false && !request.signal?.aborted
    if (!current()) {
      return { behavior: 'deny', source: 'policy',
        message: 'Session stopped before permission was resolved' }
    }
    let workflowQuestion: Record<string, unknown> | undefined
    if (request.toolName === 'AskUserQuestion' && record.workflowQuestionGuard) {
      try { workflowQuestion = await record.workflowQuestionGuard(request) }
      catch (error) {
        this.append(record, 'workflow.question.rejected', 'Workflow question is not bound to current authorized findings', { type: 'workflow.question.rejected', toolUseID: request.toolUseID, message: toErrorMessage(error) })
        return { behavior: 'deny', source: 'policy', message: toErrorMessage(error) }
      }
    }
    if (!current()) return { behavior: 'deny', source: 'policy', message: 'Permission request cancelled' }
    if (request.toolName === 'SandboxNetworkAccess') {
      const host = typeof request.input.host === 'string' ? request.input.host.trim().toLowerCase() : ''
      if (host && record.approvedNetworkHosts.has(host)) {
        this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
          type: 'permission.resolved', toolUseID: request.toolUseID,
          toolName: request.toolName, decision: 'allow', scope: 'session',
          ...(request.agentId ? { agentId: request.agentId } : {}),
          autoApproved: true, reason: 'session_network_host_approval',
        })
        return { behavior: 'allow', source: 'user', scope: 'session' }
      }
    }
    const projectFileAccess = projectWorkspaceFileAccessAuthority(
      record,
      request,
    )
    if (projectFileAccess) {
      // Re-evaluate live authority, but do not repeat an unchanged automatic
      // write approval. A denial must remain visible even after an earlier allow.
      const repeatedApproval = request.phase === 'recheck' && isFileMutationTool(request.toolName) &&
        projectFileAccess.behavior === 'allow'
      if (!repeatedApproval) this.append(
        record,
        'permission.resolved',
        `${request.toolName}: ${projectFileAccess.behavior}`,
        {
          type: 'permission.resolved',
          toolUseID: request.toolUseID,
          toolName: request.toolName,
          ...(request.agentId ? { agentId: request.agentId } : {}),
          decision: projectFileAccess.behavior,
          ...(request.phase ? { phase: request.phase } : {}),
          scope: 'once',
          autoApproved: projectFileAccess.behavior === 'allow',
          autoDenied: projectFileAccess.behavior === 'deny',
          reason: projectFileAccess.reason,
          message: projectFileAccess.message ?? request.message,
          // Write inputs may contain an entire file. Native tool events already
          // carry that payload; do not duplicate it in automatic permission logs.
          ...(!isFileMutationTool(request.toolName) ? { input: request.input } : {}),
        },
      )
      return Promise.resolve({
        behavior: projectFileAccess.behavior,
        source: 'policy',
        scope: 'once',
        ...(projectFileAccess.message
          ? { message: projectFileAccess.message }
          : {}),
      })
    }
    // Native tools already execute permitted operations without asking here.
    // Worker ownership is not permission to bypass a native safety prompt
    // (including unsandboxed shell execution). Preserve that user decision.
    const decision = await new Promise<DashboardPermissionDecision>(resolve => {
      const cancel = () => {
        if (record.pendingPermissions.get(request.toolUseID) !== pending) return
        record.pendingPermissions.delete(request.toolUseID)
        pending.resolve({ behavior: 'deny', source: 'policy', message: 'Native request cancelled' })
        this.append(record, 'permission.resolved', `${request.toolName}: cancelled`, {
          type: 'permission.resolved', toolUseID: request.toolUseID, toolName: request.toolName,
          decision: 'cancelled', message: request.message,
          ...(request.agentId ? { agentId: request.agentId } : {}),
        })
      }
      const pending: PendingPermission = {
        ...request,
        requestedAt: new Date(),
        resolve(decision) {
          request.signal?.removeEventListener('abort', cancel)
          resolve(decision)
        },
      }
      record.pendingPermissions.set(request.toolUseID, pending)
      request.signal?.addEventListener('abort', cancel, { once: true })
      if (!current()) { cancel(); return }
      this.append(record, 'permission.requested', request.message, {
        type: 'permission.requested',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        message: request.message,
        input: request.input,
        ...(workflowQuestion ? { workflowQuestion } : {}),
        ...(request.decisionReason ? { decisionReason: request.decisionReason } : {}),
        ...(request.blockedPath ? { blockedPath: request.blockedPath } : {}),
      })
    })
    if (!current()) return { behavior: 'deny', source: 'policy', message: 'Permission request cancelled' }
    if (workflowQuestion && decision.behavior === 'allow') {
      try {
        if (record.currentTurnId !== turnId || record.abortController?.signal.aborted)
          throw new Error('Workflow question belongs to an interrupted turn.')
        const binding = await record.workflowQuestionGuard!(request, decision)
        if (!current()) throw new Error('Workflow question cancelled during validation.')
        this.append(record, 'workflow.question.validated', 'User answer bound to current workflow sources', {
          type: 'workflow.question.validated', ...binding, toolUseID: request.toolUseID, questions: request.input.questions, answers: decision.updatedInput?.answers,
        })
      } catch (error) {
        this.append(record, 'workflow.question.rejected', 'User answer is not valid for the current workflow sources', { type: 'workflow.question.rejected', toolUseID: request.toolUseID, message: toErrorMessage(error) })
        return { behavior: 'deny', source: 'policy', message: toErrorMessage(error) }
      }
    }
    return decision
  }

  private resolveAllPendingPermissions(
    record: SessionRecord,
    decision: DashboardPermissionDecision,
  ): void {
    for (const [toolUseID, pending] of record.pendingPermissions) {
      record.pendingPermissions.delete(toolUseID)
      pending.resolve(decision)
      this.append(record, 'permission.resolved', `${pending.toolName}: cancelled`, {
        type: 'permission.resolved', toolUseID, toolName: pending.toolName,
        decision: 'cancelled', message: pending.message,
        ...(pending.agentId ? { agentId: pending.agentId } : {}),
      })
    }
  }

  private append(
    record: SessionRecord,
    type: BeeGameEventType,
    text: string,
    payload?: BeeGameEventPayload,
    turnId?: string,
  ): BeeGameEvent {
    const effectiveTurnId = turnId || record.currentTurnId || undefined
    const sourceTime = getDashboardPayloadString(payload, 'occurredAt')
    const createdAt = sourceTime && Number.isFinite(Date.parse(sourceTime)) ? new Date(sourceTime) : new Date()
    let enrich = this.subagentChat.get(record)
    if (!enrich) {
      enrich = createNativeSubagentChatEnricher()
      this.subagentChat.set(record, enrich)
    }
    let eventPayload = enrich({ type, payload }).payload as BeeGameEventPayload | undefined
    if (record.session.workflowExecution) eventPayload = { type, ...eventPayload, workflowExecution: record.session.workflowExecution }
    if (type === 'assistant.thinking') {
      const thinkingBlockId = getDashboardPayloadString(payload, 'thinkingBlockId') || 'default'
      const thinkingKey = `${effectiveTurnId ?? record.session.id}:${thinkingBlockId}`
      const status = getDashboardPayloadString(payload, 'status')
      let thinkingStartedAt = getDashboardPayloadString(payload, 'thinkingStartedAt') || record.thinkingBlockStartedAt.get(thinkingKey)
      if (!thinkingStartedAt && status !== 'ended') {
        thinkingStartedAt = createdAt.toISOString()
        record.thinkingBlockStartedAt.set(thinkingKey, thinkingStartedAt)
      }
      if (thinkingStartedAt) {
        eventPayload = {
          ...(payload ?? { type: 'assistant.thinking' }),
          thinkingStartedAt,
        }
      }
      if (status === 'ended') record.thinkingBlockStartedAt.delete(thinkingKey)
    }
    if (record.redactVisible && type !== 'user.message') {
      text = record.redactVisible(text) as string
      if (eventPayload) eventPayload = record.redactVisible(eventPayload) as BeeGameEventPayload
    }
    const event: BeeGameEvent = {
      id: allocateTranscriptEventId(record),
      sessionId: record.session.id,
      ...(effectiveTurnId ? { turnId: effectiveTurnId } : {}),
      type,
      text,
      ...(eventPayload ? { payload: eventPayload } : {}),
      createdAt,
    }
    record.events.push(event)
    // Keep the raw epoch receipt for accounting and publish the same session
    // total used by billing/runtime snapshots, including across native restarts.
    if (type === 'usage') event.payload = { type: 'usage', ...event.payload,
      sessionUsage: getLatestRuntimeUsage(this.runtimeSnapshotInputs(record)),
      // A later complete response cannot fill an earlier missing receipt.
      // Keep this alongside the cumulative total for live and history readers.
      ...(record.events.some(item => item.type === 'usage' && item.payload?.providerUsageIncomplete === true)
        ? { providerUsageIncomplete: true } : {}),
    }
    record.pendingTranscript.push(event)
    if (isSnapshotDetailFrame(event) && getDashboardPayloadString(event.payload, 'status') !== 'ended') {
      // Keep live events and their IDs intact. Only disk I/O and derived
      // snapshots are batched; lifecycle, usage and approval events flush now.
      record.streamPersistenceTimer ??= setTimeout(() => {
        try { this.flushStreamPersistence(record) }
        catch (error) {
          // A deferred snapshot I/O failure must be visible without becoming
          // an uncaught timer exception that terminates unrelated sessions.
          console.warn('[BeeGame] Stream snapshot persistence failed', { sessionId: record.session.id, cause: toErrorMessage(error) })
        }
      }, 100)
    } else this.flushStreamPersistence(record)
    // This index locates a Chat transcript; it is not a runtime event log.
    if (event.type === 'session.started' || event.type === 'session.resumed')
      updateProjectTranscriptIndex(record)
    for (const subscriber of this.eventSubscribers.get(record.session.id) ?? []) {
      try {
        subscriber(event)
      } catch (error) {
        console.warn('[BeeGame] Event subscriber failed', {
          sessionId: record.session.id,
          cause: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (record.projectId) {
      for (const subscription of this.projectEventSubscribers) {
        if (
          subscription.userId !== record.userId ||
          subscription.projectId !== record.projectId ||
          subscription.workspacePath !== resolve(record.session.cwd)
        )
          continue
        try {
          const displayEvent = formatBeeGameEventForDisplay(
            event,
            record.language,
          )
          subscription.subscriber(displayEvent)
        } catch (error) {
          console.warn('[BeeGame] Project event subscriber failed', {
            projectId: record.projectId,
            cause: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    record.session.updatedAt = new Date()
    return event
  }

  private flushStreamPersistence(record: SessionRecord): void {
    clearTimeout(record.streamPersistenceTimer)
    record.streamPersistenceTimer = undefined
    if (!record.pendingTranscript.length) return
    appendChatTranscript(record.transcriptPath, record.pendingTranscript)
    record.pendingTranscript = []
    this.persistRuntimeSnapshot(record)
  }

  private persistRuntimeSnapshot(record: SessionRecord): void {
    const snapshot = this.deriveRuntimeSnapshot(record)
    const snapshotPath = getRuntimeSnapshotPath(
      this.dashboardDataRoot,
      record.session.id,
    )
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  }

  private deriveRuntimeSnapshot(record: SessionRecord): BeeGameRuntimeSnapshot {
    return {
      ...deriveRuntimeSnapshotFromEvents(
        record.session.id,
        record.session.cwd,
        this.runtimeSnapshotInputs(record),
        record.session.modelConfigId,
        { nativeSessionId: record.nativeSessionId },
      ),
      activeSubagentToolUseIds: [...record.activeNativeTaskToolUseIds.values()],
      ...(record.executionIdentity?{executionIdentity:record.executionIdentity}:{}),
      ...(record.nativeContext ? {nativeContext:record.nativeContext} : {}),
    }
  }

  private runtimeSnapshotInputs(record: SessionRecord): BeeGameEvent[] {
    let index = this.snapshotInputs.get(record)
    if (!index || index.source !== record.events || index.processed > record.events.length) {
      index = {source: record.events, processed: 0, events: [], eventCount: 0, toolUseCount: 0}
      this.snapshotInputs.set(record, index)
    }
    // Compact only chronological bursts of the same detail type/turn. Type
    // boundaries retain activity timestamps; counters retain every visible frame.
    // Raw Chat, native history, approvals and billing checkpoints are unchanged.
    // Unknown event types are retained.
    for (; index.processed < record.events.length; index.processed++) {
      const event = record.events[index.processed]!, previous = index.events.at(-1)
      delete index.ordered
      if (!isThinkingProtocolControlEvent(event)) {
        index.eventCount++
        if (event.type.startsWith('tool.')) index.toolUseCount++
      }
      if (previous && isSnapshotDetailFrame(event) && event.type === previous.type &&
          !isThinkingProtocolControlEvent(event) && !isThinkingProtocolControlEvent(previous) &&
          event.turnId === previous.turnId && event.createdAt >= previous.createdAt)
        index.events[index.events.length - 1] = event
      else index.events.push(event)
    }
    return index.events
  }

  private readPersistedRuntimeSnapshot(
    sessionId: string,
  ): BeeGameRuntimeSnapshot | undefined {
    try {
      return normalizeRuntimeSnapshot(
        JSON.parse(
          readFileSync(
            getRuntimeSnapshotPath(this.dashboardDataRoot, sessionId),
            'utf8',
          ),
        ),
      )
    } catch {
      return undefined
    }
  }
}

function isSnapshotDetailFrame(event: BeeGameEvent): boolean {
  return event.type === 'assistant.partial' || event.type === 'assistant.thinking' || event.type === 'tool.progress'
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
  await rm(projectHostDirectory(workspaceRoot), { recursive: true, force: true })
  await rm(projectWorkRoot(workspaceRoot), { recursive: true, force: true })
  return workspaceRoot
}

export async function deleteSessionArtifactsFromTranscript(
  sessionId: string,
  cwd: string,
): Promise<string[]> {
  const events = await readSessionTranscriptFactsFromDisk(
    sessionId,
    cwd,
  )
  const roots = getSessionArtifactRootPathsForEvents(cwd, events)
  const deleted: string[] = []
  for (const path of roots) {
    await rm(path, { recursive: true, force: true })
    deleted.push(path)
  }
  return deleted
}

type DiskTranscriptEvent = Omit<BeeGameEvent, 'createdAt'> & { createdAt: string }
// Cache byte offsets and compact host facts, never complete historical bodies.
const transcriptReaders = new Map<string, ChatJsonlReader<DiskTranscriptEvent>>()
function transcriptReader(path: string) {
  let reader = transcriptReaders.get(path)
  if (!reader) {
    reader = new ChatJsonlReader<DiskTranscriptEvent>()
    // Do not retain indexes for every project ever opened by this server.
    if (transcriptReaders.size >= 16) transcriptReaders.delete(transcriptReaders.keys().next().value!)
    transcriptReaders.set(path, reader)
  }
  return reader
}

export function projectChatSource(cwd: string) {
  const path = projectChatPath(cwd)
  return { path, reader: transcriptReader(path) }
}

function hostTranscriptFact(event: DiskTranscriptEvent): DiskTranscriptEvent {
  // Shell output is display evidence. Host status, permissions, billing and
  // continuation use the original lifecycle/identity/input/usage fields.
  // Agent launch output remains intact because it can locate usage receipts.
  if (event.payload?.toolName !== 'Shell') return event
  const { output: _output, ...payload } = event.payload
  return { ...event, payload }
}

/** Explicitly bounded display page. Complete host facts have a separate reader. */
export async function readSessionTranscriptPageFromDisk(sessionId: string, cwd: string, selection: JsonlSelection = {}) {
  const path = projectChatPath(cwd)
  return transcriptReader(path).read(path, { ...selection, sessionId })
}

export async function readSessionTranscriptFromDisk(sessionId: string, cwd: string, selection: JsonlSelection = {}) {
  return (await readSessionTranscriptPageFromDisk(sessionId, cwd, selection)).rows
}

export async function readSessionTranscriptFactsFromDisk(sessionId: string, cwd: string, types?: readonly string[]) {
  const path = projectChatPath(cwd)
  return transcriptReader(path).readFacts(path, hostTranscriptFact, types, sessionId)
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
 * The project log index is the durable session reference, not an authorization
 * source: callers must establish workspace ownership before invoking this function.
 */
export async function recoverLatestProjectSessionFromDisk(
  workspacePath: string,
): Promise<RecoveredProjectSessionMetadata | undefined> {
  let index: ProjectLogIndex
  try {
    const raw = await readFile(getProjectLogIndexPath(workspacePath), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectLogIndex>
    if (
      parsed.version !== 1 ||
      !parsed.sessions ||
      typeof parsed.sessions !== 'object'
    ) {
      return undefined
    }
    index = {
      version: 1,
      project:
        typeof parsed.project === 'string'
          ? parsed.project
          : basename(workspacePath),
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      sessions: parsed.sessions as Record<string, ProjectLogIndexSession>,
    }
  } catch {
    return undefined
  }

  const candidates = Object.entries(index.sessions)
    .filter(
      ([sessionId, entry]) =>
        Boolean(sessionId) &&
        entry?.sessionId === sessionId &&
        typeof entry.transcript === 'string' &&
        typeof entry.updatedAt === 'string',
    )
    .sort(([, left], [, right]) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )

  for (const [sessionId, entry] of candidates) {
    const indexedTranscriptPath = resolve(projectHostDirectory(workspacePath), entry.transcript)
    const expectedTranscriptPath = projectChatPath(workspacePath)
    if (
      relative(projectHostDirectory(workspacePath), indexedTranscriptPath).startsWith('..') ||
      indexedTranscriptPath !== expectedTranscriptPath
    ) {
      continue
    }
    try {
      const events = await readSessionTranscriptFactsFromDisk(
        sessionId,
        workspacePath,
      )
      if (
        events.length === 0 ||
        events.some(event => Boolean(event.payload?.workflowExecution)) ||
        events.some(event => event.sessionId && event.sessionId !== sessionId)
      ) {
        continue
      }
      const terminalType = events.at(-1)?.type
      const status =
        terminalType === 'session.failed'
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

function readExistingTranscriptForResume(
  sessionId: string,
  cwd: string,
): { path: string; events: BeeGameEvent[] } | undefined {
  const transcriptPath = projectChatPath(cwd)
  if (!existsSync(transcriptPath)) return undefined
  const events = transcriptReader(transcriptPath).readFactsSync(transcriptPath, hostTranscriptFact, sessionId)
  if (!events.length) return undefined
  return { path: transcriptPath, events: events.map(event => ({ ...event,
    sessionId: event.sessionId || sessionId, createdAt: new Date(event.createdAt) })) }
}

const nextProjectEventIds = new Map<string, number>()
function allocateTranscriptEventId(record: SessionRecord): number {
  const id = Math.max(record.nextEventId, nextProjectEventIds.get(record.transcriptPath) ?? 1)
  record.nextEventId = id + 1
  nextProjectEventIds.set(record.transcriptPath, id + 1)
  return id
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

function isBeeGameSessionLanguage(
  value: unknown,
): value is BeeGameSessionLanguage {
  return (
    value === 'en' ||
    value === 'zh' ||
    value === 'zh-TW' ||
    value === 'ja' ||
    value === 'ko' ||
    value === 'fr' ||
    value === 'de' ||
    value === 'es' ||
    value === 'it' ||
    value === 'pt'
  )
}

export function recoverConfirmedBriefContext(
  events: ReadonlyArray<Pick<BeeGameEvent, 'type' | 'payload' | 'text'>>,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || !isRuntimeRecord(event.payload)) continue
    if (event.type !== 'user.message' && !(event.type === 'turn.started' && event.payload.messageOrigin === 'workflow'))
      continue
    // Internal production turns retain requirements in their start receipt,
    // without inventing user input. Keep legacy message recovery too.
    const context = event.payload.confirmedBriefContext
    if (typeof context === 'string' && context.trim()) return context.trim()
    if (event.type !== 'user.message' || event.payload.displayKind !== 'confirmed_brief') continue
    const marker = '\nConfirmed brief:\n'
    const markerIndex = event.text.lastIndexOf(marker)
    if (markerIndex >= 0) {
      const recovered = event.text.slice(markerIndex + marker.length).trim()
      if (recovered) return recovered
    }
  }
  return undefined
}

export async function prepareBeeGamePromptInput(input: {
  text: string
  workspace: string
  attachments?: BeeGameAttachment[]
  displayKind?: string
}): Promise<{ prompt: BeeGamePromptInput;
  attachments: Omit<MaterializedBeeGameFileAttachment, 'relativePath'>[] }> {
  const images = (input.attachments ?? []).filter(isBeeGameImageAttachment)
  const materialized = await materializeBeeGameAttachments(input.workspace,
    (input.attachments ?? []).filter(item => isBeeGameImageAttachment(item) || isBeeGameFileAttachment(item)))
  const materializedFiles = materialized.filter(item => item.type === 'file')
  const attachments = materialized.map(({ relativePath: _path, ...reference }) => reference)
  const documentContext =
    materializedFiles.length > 0
      ? `\n\nAttached documents:\n${materializedFiles.map(file => `- ${file.filename} (${file.mediaType}): ${file.relativePath}`).join('\n')}`
      : ''
  const requestText =
    input.text || (images.length > 0 ? 'Analyze the attached image.' : '')
  const userInput = `${requestText}${documentContext}`
  // BeeGame forwards the user's objective without a hidden execution plan.
  // Native BeeGame Studio owns Skill selection, tool use, implementation and
  // validation exactly as it does in the TUI.
  const promptText = userInput
  if (images.length === 0) {
    return {
      attachments,
      prompt: promptText,
    }
  }
  return {
    attachments,
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
  }
}

export async function materializeBeeGameAttachments(
  workspace: string,
  attachments: BeeGameAttachment[],
  destination?: string,
): Promise<MaterializedBeeGameFileAttachment[]> {
  if (attachments.length === 0) return []
  const root = await realpath(workspace)
  const attachmentDirectory = destination ?? join(root, '.beegame-attachments')
  await mkdir(attachmentDirectory, { recursive: true })
  if (await realpath(attachmentDirectory) !== resolve(attachmentDirectory))
    throw new Error('Attachment directory cannot redirect through a symlink')
  const writtenPaths: string[] = []
  const results: MaterializedBeeGameFileAttachment[] = []

  try {
    for (const attachment of attachments) {
      const imageExtension = attachment.type === 'image'
        ? { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[attachment.mediaType] : undefined
      const filename = basename(attachment.filename || `image${imageExtension || ''}`)
      const extension = filename
        .slice(filename.lastIndexOf('.'))
        .toLowerCase()
      const allowedTypes = attachment.type === 'image'
        ? IMAGE_ATTACHMENT_TYPES[imageExtension || ''] : DOCUMENT_ATTACHMENT_TYPES[extension]
      if (
        !filename ||
        !allowedTypes ||
        !allowedTypes.includes(attachment.mediaType)
      ) {
        throw new Error(
            `Unsupported document attachment: ${attachment.filename}`,
        )
      }
      const data = Buffer.from(attachment.data, 'base64')
      if (data.length === 0 || data.length > MAX_BEEGAME_ATTACHMENT_BYTES) {
        throw new Error(
          `Invalid document attachment size: ${attachment.filename}`,
        )
      }
      const safeFilename =
        filename.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'attachment'
      const storedFilename = `${randomUUID()}-${attachment.type === 'image' ? `image${imageExtension}` : safeFilename}`
      const storedPath = join(attachmentDirectory, storedFilename)
      await writeFile(storedPath, data, { flag: 'wx' })
      writtenPaths.push(storedPath)
      results.push({
        type: attachment.type,
        storageId: storedFilename,
        relativePath: relative(root, storedPath),
        filename,
        mediaType: attachment.mediaType,
      })
    }
    return results
  } catch (error) {
    // Only roll back this upload, never previously persisted attachments.
    await Promise.all(writtenPaths.map(path => rm(path, { force: true })))
    throw error
  }
}

function isBeeGameImageAttachment(
  value: unknown,
): value is BeeGameImageAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Partial<BeeGameImageAttachment>
  return (
    attachment.type === 'image' &&
    isSupportedBeeGameImageMediaType(attachment.mediaType) &&
    typeof attachment.data === 'string' &&
    attachment.data.trim().length > 0
  )
}

function isBeeGameFileAttachment(
  value: unknown,
): value is BeeGameFileAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Partial<BeeGameFileAttachment>
  return (
    attachment.type === 'file' &&
    typeof attachment.mediaType === 'string' &&
    typeof attachment.filename === 'string' &&
    typeof attachment.data === 'string' &&
    attachment.data.trim().length > 0
  )
}

function isSupportedBeeGameImageMediaType(
  mediaType: unknown,
): mediaType is BeeGameImageAttachment['mediaType'] {
  return (
    mediaType === 'image/png' ||
    mediaType === 'image/jpeg' ||
    mediaType === 'image/webp'
  )
}

function getEmptyTurnMessage(language?: BeeGameSessionLanguage): string {
  switch (language) {
    case 'zh':
      return 'BeeGame Studio 已结束本轮，但没有返回最终答复。当前任务可能尚未完成，请在同一会话中继续。'
    case 'zh-TW':
      return 'BeeGame Studio 已結束本輪，但沒有返回最終答覆。目前任務可能尚未完成，請在同一工作階段中繼續。'
    case 'ja':
      return 'BeeGame Studio はこのターンを終了しましたが、最終回答を返しませんでした。タスクが未完了の可能性があるため、同じセッションで続行してください。'
    case 'ko':
      return 'BeeGame Studio가 이 턴을 종료했지만 최종 답변을 반환하지 않았습니다. 작업이 완료되지 않았을 수 있으므로 같은 세션에서 계속하세요.'
    case 'en':
    default:
      return 'BeeGame Studio ended the turn without a final response. The task may be incomplete; continue in the same session.'
  }
}

/**
 * Converts a structured provider error envelope into readable chat text while
 * leaving the stored event payload untouched.
 * Known provider refusal codes also carry a concrete continuation explanation.
 */
export function formatRuntimeErrorForDisplay(
  value: string,
  language?: BeeGameSessionLanguage,
): string {
  const text = value.trim()
  if (/^(?:API Error:\s*)?400\b/i.test(text) &&
      /\[model_coming_soon\]|"code"\s*:\s*"model_coming_soon"/.test(text)) {
    const messages: Partial<Record<BeeGameSessionLanguage, string>> = {
      zh: '上游暂未开放当前模型（model_coming_soon），本轮已停止。已有会话和产物保留，可重试原任务；当前模型不变。',
      'zh-TW': '上游暫未開放目前模型（model_coming_soon），本輪已停止。既有對話與產物保留，可重試原任務；目前模型不變。',
      en: 'The provider has not enabled the selected model (model_coming_soon). This turn stopped; saved conversation and files are retained. Retry the same task when ready; the selected model is unchanged.',
      ja: '選択したモデルは提供元でまだ利用できません（model_coming_soon）。このターンは停止しました。会話とファイルは保持されます。同じモデルでタスクを再試行できます。',
      ko: '제공업체가 선택한 모델을 아직 활성화하지 않았습니다(model_coming_soon). 이번 턴은 중단되었으며 대화와 파일은 보존됩니다. 선택한 모델을 유지하며 같은 작업을 재시도할 수 있습니다.',
    }
    return messages[language ?? 'en'] ?? messages.en!
  }
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const jsonStart =
    objectStart < 0
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
  const hasErrorContainer =
    isObject(envelope) && Object.hasOwn(envelope, 'error')
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
  )
    return { ...event }
  return {
    ...event,
    text: formatRuntimeErrorForDisplay(event.text, language),
  }
}

function collectStructuredMessages(value: unknown, depth = 0): string[] {
  if (depth > 6) return []
  if (Array.isArray(value)) {
    return deduplicateStrings(
      value.flatMap(item => collectStructuredMessages(item, depth + 1)),
    )
  }
  if (!isObject(value)) return []
  const direct =
    typeof value.message === 'string' && value.message.trim()
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
    case 'zh':
      return '请求失败'
    case 'zh-TW':
      return '請求失敗'
    case 'ja':
      return 'リクエストに失敗しました'
    case 'ko':
      return '요청 실패'
    case 'fr':
      return 'Échec de la requête'
    case 'de':
      return 'Anfrage fehlgeschlagen'
    case 'es':
      return 'Error en la solicitud'
    case 'it':
      return 'Richiesta non riuscita'
    case 'pt':
      return 'Falha na solicitação'
    case 'en':
    default:
      return 'Request failed'
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
  const entries = Object.entries(value).filter(
    ([, item]) => item !== null && item !== '',
  )
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
      character >= 'A' &&
      character <= 'Z' &&
      previous >= 'a' &&
      previous <= 'z' &&
      !output.endsWith(' ')
    )
      output += ' '
    output += character
  }
  const normalized = output.trim()
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : 'Value'
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

function getRuntimeSnapshotPath(dataRoot: string, sessionId: string): string {
  return resolve(
    dataRoot,
    'snapshots',
    `${getSafeSessionFileName(sessionId)}.json`,
  )
}

function getSafeSessionFileName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function deriveRuntimeSnapshotFromEvents(
  sessionId: string,
  workspacePath: string,
  events: BeeGameEvent[],
  modelConfigId: string | undefined,
  options: {
    recoveredFromTranscript?: boolean
    nativeSessionId?: string
  } = {},
): BeeGameRuntimeSnapshot {
  const usage = getLatestRuntimeUsage(events)
  const latest = events.at(-1)
  const turnDiagnostics = deriveLatestTurnDiagnostics(events)
  const phaseName = deriveSnapshotPhaseName(events, options)
  return {
    runtime: 'bgs',
    sessionId,
    ...(events.some(event => event.type === 'usage' && event.payload?.providerUsageIncomplete === true)
      ? { providerUsageIncomplete: true } : {}),
    ...(options.nativeSessionId
      ? { nativeSessionId: options.nativeSessionId }
      : {}),
    workspacePath,
    ...(modelConfigId ? { modelConfigId } : {}),
    phaseName,
    phaseStatus: deriveSnapshotPhaseStatus(events, phaseName, options),
    activeSubagentToolUseIds: [],
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
  // Snapshot persistence runs for every stream event. Searching the full
  // history again for each prior turn made that hot path history × turns.
  // Collect identities once; even a terminal preceding its start retains the
  // existing semantics. This is observation only, never writer exit proof.
  const started = new Set<string>(), ended = new Set<string>()
  let sessionStarted = false, turnStarted = false
  for (const event of events) {
    if (event.type === 'session.started') sessionStarted = true
    if (event.type === 'turn.started') {
      turnStarted = true
      if (event.turnId) started.add(event.turnId)
    } else if (event.turnId && ['turn.completed','turn.empty','turn.failed','session.stopped','session.failed'].includes(event.type))
      ended.add(event.turnId)
  }
  for (const id of started) if (!ended.has(id)) return 'running'
  if (sessionStarted && !turnStarted) return 'starting'
  return 'idle'
}

function deriveSnapshotPhaseStatus(
  events: BeeGameEvent[],
  phaseName: string,
  options: { recoveredFromTranscript?: boolean } = {},
): string {
  const latest = events.at(-1)
  if (!latest) return 'idle'
  if (options.recoveredFromTranscript) return 'recovered'
  if (latest.type === 'permission.requested') return 'waiting_approval'
  if (latest.type === 'turn.failed' || latest.type === 'session.failed')
    return 'failed'
  if (phaseName === 'starting') return 'starting'
  if (phaseName === 'running') return 'running'
  return 'idle'
}

function hasTurnEnded(events: BeeGameEvent[], turnId?: string): boolean {
  if (!turnId) return true
  return events.some(
    event =>
      event.turnId === turnId &&
      (event.type === 'turn.completed' ||
        event.type === 'turn.empty' ||
        event.type === 'turn.failed' ||
        event.type === 'session.stopped' ||
        event.type === 'session.failed'),
  )
}

function hasNativeFinalResult(
  events: BeeGameEvent[],
  turnId?: string | null,
): boolean {
  if (!turnId) return false
  return events.some(
    event =>
      event.turnId === turnId &&
      (event.type === 'result' || (['bgs', 'codex'].includes(String(event.payload?.runtime)) && ['assistant.message','assistant.partial'].includes(event.type))) &&
      event.text.trim().length > 0 &&
      !isThinkingProtocolControlText(event.text),
  )
}

export function getLatestRuntimeUsage(
  events: readonly BeeGameEvent[],
  billableOnly = false,
): BeeGameRuntimeSnapshot['usage'] {
  // Claude SDK result.modelUsage is cumulative while one native accounting
  // epoch remains active. A resumed/compacted native session may start a new
  // epoch whose counters are lower than the previous terminal snapshot. Keep
  // only the latest snapshot inside each monotonic epoch, then add the epochs;
  // summing every result double-counts while taking only the final result loses
  // all usage before a native counter reset.
  const modelUsage = aggregateCumulativeModelUsage(events, billableOnly)
  if (modelUsage) {
    // A turn can still be in flight after the previous result. Add only the
    // stream usage emitted after the latest modelUsage result; stream usage
    // before that result is already included in its cumulative counters.
    const inFlight = latestCumulativeUsageEvent(
      events,
      findLastModelUsageEventIndex(events),
      billableOnly,
    )
    addRuntimeUsage(modelUsage, inFlight)
    return includeAuxiliaryUsage(modelUsage, events, billableOnly)
  }

  // Before a terminal result exists, message_delta is the only authoritative
  // usage source exposed by the streaming transport.
  const streamedUsage = latestCumulativeUsageEvent(events, -1, billableOnly)
  if (streamedUsage.total_tokens > 0) return includeAuxiliaryUsage(streamedUsage, events, billableOnly)

  return includeAuxiliaryUsage(emptyRuntimeUsage(), events, billableOnly)
}

function findLastModelUsageEventIndex(events: readonly BeeGameEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event && getCumulativeUsageSnapshot(event)
    ) {
      return index
    }
  }
  return -1
}

function latestCumulativeUsageEvent(
  events: readonly BeeGameEvent[],
  afterIndex: number,
  billableOnly = false,
): BeeGameRuntimeSnapshot['usage'] {
  // Native message_delta usage is a cumulative snapshot, not a delta. Keep
  // the greatest observed value for each counter so partial snapshots (for
  // example input tokens at message_start and output tokens at message_delta)
  // compose without summing the same cumulative work repeatedly.
  const latest = emptyRuntimeUsage()
  const checkpoint = events[afterIndex]
  const epoch = getDashboardPayloadString(checkpoint?.payload, 'nativeAccountingEpoch')
  // Native checkpoints include completed main/child requests. Raw SSE is only
  // one request and can arrive after its stderr checkpoint; adding it again
  // would double-charge. With this source available, show completed usage only.
  if (epoch && events.some(event => event.type === 'usage' && event.payload?.subtype === 'native_accounting' &&
      getDashboardPayloadString(event.payload, 'nativeAccountingEpoch') === epoch)) return latest
  for (const event of events.slice(afterIndex + 1)) {
    if (event.type !== 'usage' || event.payload?.subtype === 'native_accounting' || event.payload?.subtype === 'model_runtime_host' ||
        (billableOnly && !isPlatformUsageEvent(event))) continue
    const usage = getUsageFromEventPayload(event.payload)
    latest.prompt_tokens = Math.max(latest.prompt_tokens, usage.prompt_tokens)
    latest.completion_tokens = Math.max(
      latest.completion_tokens,
      usage.completion_tokens,
    )
    latest.cache_read_tokens = Math.max(
      latest.cache_read_tokens,
      usage.cache_read_tokens,
    )
    latest.cache_creation_tokens = Math.max(
      latest.cache_creation_tokens,
      usage.cache_creation_tokens,
    )
  }
  latest.total_tokens =
    latest.prompt_tokens +
    latest.completion_tokens +
    latest.cache_read_tokens +
    latest.cache_creation_tokens
  return latest
}

/** Attribute cumulative increments to their execution, even when a later
 * resume delivers the receipt. Baseline-only native counters remain evidence,
 * never substitute provider receipts or enter billing. */
export function getRuntimeUsageForTurn(
  events: readonly BeeGameEvent[],
  turnId?: string,
  billableOnly = false,
): BeeGameRuntimeSnapshot['usage'] {
  const scopedEvents = turnId ? events.filter(event => event.turnId === turnId) : events
  const modelUsage = aggregateCumulativeModelUsage(events, billableOnly, turnId)
  if (modelUsage) {
    addRuntimeUsage(modelUsage, latestCumulativeUsageEvent(scopedEvents,
      findLastModelUsageEventIndex(scopedEvents), billableOnly))
    return includeAuxiliaryUsage(modelUsage, scopedEvents, billableOnly)
  }
  return includeAuxiliaryUsage(latestCumulativeUsageEvent(scopedEvents, -1, billableOnly), scopedEvents, billableOnly)
}

function deriveLatestTurnDiagnostics(
  events: BeeGameEvent[],
): BeeGameRuntimeSnapshot['turnDiagnostics'] | undefined {
  const turnId = [...events].reverse().find(event => event.turnId)?.turnId
  if (!turnId) return undefined
  const turnEvents = events.filter(event => event.turnId === turnId)
  const usage = getRuntimeUsageForTurn(events, turnId)
  const countTool = (toolName: string) =>
    turnEvents.filter(
      event =>
        event.type === 'tool.started' &&
        getDashboardPayloadString(event.payload, 'toolName') === toolName,
    ).length
  return {
    turnId,
    agentCalls: countTool('Agent'),
    skillCalls: countTool('Skill'),
    taskOutputCalls: countTool('TaskOutput'),
    failedToolCalls: turnEvents.filter(event => event.type === 'tool.failed')
      .length,
    usage,
    roleTokens: deriveObservedRoleTokens(turnEvents, usage),
  }
}

export function deriveObservedRoleTokens(
  events: BeeGameEvent[],
  usage = getRuntimeUsageForTurn(events),
): NonNullable<BeeGameRuntimeSnapshot['turnDiagnostics']>['roleTokens'] {
  const total = usage.total_tokens
  const roleByToolUse = new Map<string, string>()
  const backgroundUsageByToolUse = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed')
      continue
    if (getDashboardPayloadString(event.payload, 'toolName') !== 'Agent')
      continue
    const payload = isRuntimeRecord(event.payload) ? event.payload : undefined
    const input =
      payload && isRuntimeRecord(payload.input) ? payload.input : undefined
    const toolUseID =
      typeof payload?.toolUseID === 'string' ? payload.toolUseID : ''
    const role =
      typeof input?.subagent_type === 'string' ? input.subagent_type : ''
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
    if (event.type !== 'system.status' || !isRuntimeRecord(event.payload))
      continue
    if (
      !['task_notification', 'task_progress'].includes(getDashboardPayloadString(event.payload, 'subtype'))
    )
      continue
    const taskId = getDashboardPayloadString(event.payload, 'task_id')
    const toolUseID = getDashboardPayloadString(event.payload, 'tool_use_id')
    const usage = isRuntimeRecord(event.payload.usage)
      ? event.payload.usage
      : undefined
    if (!taskId || !toolUseID || !usage) continue
    latestTerminalByTask.set(toolUseID, {
      toolUseID,
      role: roleByToolUse.get(toolUseID) ?? 'other',
      tokens: Math.max(
        normalizeFiniteNumber(usage.total_tokens),
        latestTerminalByTask.get(toolUseID)?.tokens ?? 0,
        backgroundUsageByToolUse.get(toolUseID) ?? 0,
      ),
    })
  }

  for (const [toolUseID, tokens] of backgroundUsageByToolUse) {
    if (
      [...latestTerminalByTask.values()].some(
        value => value.toolUseID === toolUseID,
      )
    )
      continue
    latestTerminalByTask.set(`output:${toolUseID}`, {
      toolUseID,
      role: roleByToolUse.get(toolUseID) ?? 'other',
      tokens,
    })
  }

  let otherSubagents = 0
  for (const value of latestTerminalByTask.values()) {
    otherSubagents += value.tokens
  }
  return {
    // Provider checkpoints include all roles. A missing child receipt is not
    // evidence that the coordinator consumed the remaining tokens.
    mainAgent: 0,
    otherSubagents: Math.min(total, otherSubagents),
    unattributed: Math.max(0, total - otherSubagents),
  }
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getUsageFromEventPayload(
  payload: BeeGameEventPayload | undefined,
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
  const cacheReadTokens = normalizeFiniteNumber(
    usage.cache_read_input_tokens ?? usage.cache_read_tokens,
  )
  const cacheCreationTokens = normalizeFiniteNumber(
    usage.cache_creation_input_tokens ?? usage.cache_creation_tokens,
  )
  const totalTokens = normalizeFiniteNumber(
    usage.total_tokens,
    promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens,
  )
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: totalTokens,
  }
}

function getModelUsageFromEventPayload(
  payload: BeeGameEventPayload | undefined,
): BeeGameRuntimeSnapshot['usage'] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  const modelUsage = payload.modelUsage
  if (
    !modelUsage ||
    typeof modelUsage !== 'object' ||
    Array.isArray(modelUsage)
  )
    return null
  const total = emptyRuntimeUsage()
  let found = false
  for (const value of Object.values(modelUsage)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const usage = value as Record<string, unknown>
    const promptTokens = normalizeFiniteNumber(
      usage.inputTokens ?? usage.input_tokens,
    )
    const completionTokens = normalizeFiniteNumber(
      usage.outputTokens ?? usage.output_tokens,
    )
    const cacheReadTokens = normalizeFiniteNumber(
      usage.cacheReadInputTokens ?? usage.cache_read_input_tokens,
    )
    const cacheCreationTokens = normalizeFiniteNumber(
      usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens,
    )
    const totalTokens =
      promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens
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

function getCumulativeUsageSnapshot(event: BeeGameEvent): BeeGameRuntimeSnapshot['usage'] | null {
  if (event.type === 'result') return getModelUsageFromEventPayload(event.payload)
  if (event.type === 'usage' && event.payload?.subtype === 'native_accounting') {
    const usage = getUsageFromEventPayload(event.payload)
    return usage.total_tokens > 0 ? usage : null
  }
  return null
}

function isPlatformUsageEvent(event: BeeGameEvent): boolean {
  // Untagged historical receipts retain their original billing treatment.
  return event.payload?.billingSource !== 'byok' && event.payload?.billingSource !== 'chatgpt-subscription'
}

function aggregateCumulativeModelUsage(
  events: readonly BeeGameEvent[],
  billableOnly = false,
  turnId?: string,
): BeeGameRuntimeSnapshot['usage'] | null {
  const groups = new Map<string, { native: boolean; snapshots: { usage: BeeGameRuntimeSnapshot['usage']; billable: boolean; baselineOnly: boolean; turnId?: string | null }[] }>()
  for (const event of events) {
    const snapshot = getCumulativeUsageSnapshot(event)
    if (!snapshot) continue
    const key = getDashboardPayloadString(event.payload, 'nativeAccountingEpoch') || 'legacy'
    const group = groups.get(key) ?? { native: false, snapshots: [] }
    group.native ||= event.type === 'usage'
    const replayed = event.payload?.usageReplayed === true
    const attributedTurnId = replayed ? getDashboardPayloadString(event.payload, 'usageAttributedTurnId') ?? null : event.turnId
    group.snapshots.push({ usage: snapshot,
      // An unknown historical owner is visible in totals but cannot be charged
      // to the new request merely because it delivered the restored counter.
      billable: isPlatformUsageEvent(event) && (!replayed || Boolean(attributedTurnId)),
      baselineOnly: event.payload?.usageBaselineOnly === true, turnId: attributedTurnId })
    groups.set(key, group)
  }
  if (!groups.size) return null
  const total = emptyRuntimeUsage()
  for (const group of groups.values()) {
    let latest = emptyRuntimeUsage()
    for (const { usage: snapshot, billable, baselineOnly, turnId: attributedTurnId } of group.snapshots) {
      let next = snapshot
      if (group.native) {
        // stdout and stderr are independent streams; older snapshots cannot
        // decrease a native epoch's counters.
        next = { prompt_tokens: Math.max(latest.prompt_tokens, snapshot.prompt_tokens),
          completion_tokens: Math.max(latest.completion_tokens, snapshot.completion_tokens),
          cache_read_tokens: Math.max(latest.cache_read_tokens, snapshot.cache_read_tokens),
          cache_creation_tokens: Math.max(latest.cache_creation_tokens, snapshot.cache_creation_tokens), total_tokens: 0 }
        next.total_tokens = next.prompt_tokens + next.completion_tokens + next.cache_read_tokens + next.cache_creation_tokens
      }
      const delta = !group.native && hasCumulativeCounterReset(latest, next)
        ? next : subtractRuntimeUsage(next, latest)
      if (!baselineOnly && (!billableOnly || billable) && (!turnId || attributedTurnId === turnId)) addRuntimeUsage(total, delta)
      // Personal usage must still advance the native baseline: a resumed thread
      // can keep the same epoch when its connection changes back to platform.
      latest = next
    }
  }
  return total
}

function hasCumulativeCounterReset(
  previous: BeeGameRuntimeSnapshot['usage'],
  current: BeeGameRuntimeSnapshot['usage'],
): boolean {
  return (
    current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens
  )
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

function includeAuxiliaryUsage(usage: BeeGameRuntimeSnapshot['usage'], events: readonly BeeGameEvent[], billableOnly: boolean) {
  // These physical calls are billed by their existing recorder, not native settlement.
  if (!billableOnly) for (const event of events) {
    if (event.type === 'usage' && event.payload?.subtype === 'model_runtime_host')
      addRuntimeUsage(usage, getUsageFromEventPayload(event.payload))
  }
  return usage
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
  payload: BeeGameEventPayload | undefined,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const directUsage = payload.usage
  if (
    directUsage &&
    typeof directUsage === 'object' &&
    !Array.isArray(directUsage)
  ) {
    return directUsage as Record<string, unknown>
  }
  const event = payload.event
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    const eventRecord = event as Record<string, unknown>
    const eventUsage = eventRecord.usage
    if (
      eventUsage &&
      typeof eventUsage === 'object' &&
      !Array.isArray(eventUsage)
    ) {
      return eventUsage as Record<string, unknown>
    }
    const eventMessage = eventRecord.message
    if (
      eventMessage &&
      typeof eventMessage === 'object' &&
      !Array.isArray(eventMessage)
    ) {
      const eventMessageUsage = (eventMessage as Record<string, unknown>).usage
      if (
        eventMessageUsage &&
        typeof eventMessageUsage === 'object' &&
        !Array.isArray(eventMessageUsage)
      ) {
        return eventMessageUsage as Record<string, unknown>
      }
    }
  }
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null
  }
  const messageUsage = (message as Record<string, unknown>).usage
  if (
    messageUsage &&
    typeof messageUsage === 'object' &&
    !Array.isArray(messageUsage)
  ) {
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
  const execution=record.executionIdentity as BeeGameRuntimeSnapshot['executionIdentity']
  const executionIdentity=execution && typeof execution.attemptId==='string' && typeof execution.workerId==='string' &&
    Number.isSafeInteger(execution.fence) && execution.fence>0 && typeof execution.turnId==='string' &&
    execution.attemptId && execution.workerId && execution.turnId ? {
      attemptId:execution.attemptId,workerId:execution.workerId,fence:execution.fence,turnId:execution.turnId,
      ...(execution.nativeSubmitted===true?{nativeSubmitted:true as const}:{}),
    }:undefined
  const context = record.nativeContext as Partial<BeeGameNativeContext> | undefined
  const nativeContext = context && typeof context === 'object' && ['bgs', 'codex'].includes(String(record.runtime)) &&
    typeof context.threadId === 'string' && context.threadId.length > 0 && context.threadId === record.nativeSessionId &&
    typeof context.runtimeSha256 === 'string' && /^[a-f0-9]{64}$/.test(context.runtimeSha256) &&
    typeof context.briefSha256 === 'string' && /^[a-f0-9]{64}$/.test(context.briefSha256)
    ? {threadId:context.threadId,runtimeSha256:context.runtimeSha256,briefSha256:context.briefSha256} : undefined
  const usage =
    record.usage &&
    typeof record.usage === 'object' &&
    !Array.isArray(record.usage)
      ? (record.usage as Record<string, unknown>)
      : {}
  return {
    runtime: 'bgs',
    ...(nativeContext ? {nativeContext} : {}),
    sessionId: String(record.sessionId || ''),
    ...(executionIdentity?{executionIdentity}:{}),
    ...(['bgs', 'codex'].includes(String(record.runtime)) && typeof record.nativeSessionId === 'string' && record.nativeSessionId
      ? { nativeSessionId: record.nativeSessionId }
      : {}),
    workspacePath: String(record.workspacePath || ''),
    ...(typeof record.modelConfigId === 'string' && record.modelConfigId
      ? { modelConfigId: record.modelConfigId }
      : {}),
    phaseName: String(record.phaseName || 'idle'),
    phaseStatus: String(record.phaseStatus || 'idle'),
    // This snapshot may survive a service restart, but live child processes do not.
    activeSubagentToolUseIds: [],
    updatedAt: String(record.updatedAt || new Date().toISOString()),
    usage: {
      prompt_tokens: Number(usage.prompt_tokens ?? 0),
      completion_tokens: Number(usage.completion_tokens ?? 0),
      cache_read_tokens: Number(usage.cache_read_tokens ?? 0),
      cache_creation_tokens: Number(usage.cache_creation_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
    roleTokens: normalizeRoleTokens(record.roleTokens),
    ...(record.turnDiagnostics &&
    typeof record.turnDiagnostics === 'object' &&
    !Array.isArray(record.turnDiagnostics)
      ? normalizeTurnDiagnostics(
          record.turnDiagnostics as Record<string, unknown>,
        )
      : {}),
  }
}

function normalizeTurnDiagnostics(
  value: Record<string, unknown>,
): Pick<BeeGameRuntimeSnapshot, 'turnDiagnostics'> {
  const usage =
    value.usage &&
    typeof value.usage === 'object' &&
    !Array.isArray(value.usage)
      ? (value.usage as Record<string, unknown>)
      : {}
  return {
    turnDiagnostics: {
      turnId: String(value.turnId || ''),
      agentCalls: Number(value.agentCalls ?? 0),
      skillCalls: Number(value.skillCalls ?? 0),
      taskOutputCalls: Number(value.taskOutputCalls ?? 0),
      failedToolCalls: Number(value.failedToolCalls ?? 0),
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
    mainAgent: record.unattributed === undefined ? 0 : Number(record.mainAgent ?? 0),
    otherSubagents: Number(record.otherSubagents ?? 0),
    unattributed: Number(record.unattributed ?? record.mainAgent ?? 0),
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

export function createZipArchive(
  files: Array<{ path: string; data: Uint8Array }>,
): Uint8Array {
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
    localView.setUint16(6, 0x0800, true) // Paths are UTF-8, including resource names.
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
    centralView.setUint16(8, 0x0800, true)
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

type ProjectWorkspaceFileAccessAuthority = {
  behavior: 'allow' | 'deny'
  reason:
    | 'project_workspace_file_access'
    | 'project_workspace_boundary'
    | 'project_workspace_target_invalid'
    | 'project_managed_web_boot'
  message?: string
}

function projectWorkspaceFileAccessAuthority(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): ProjectWorkspaceFileAccessAuthority | undefined {
  if (!record.projectId) return undefined
  const writing = isFileMutationTool(request.toolName)
  const pathKey = request.toolName === 'Read' ? 'file_path' : 'path'
  if (!writing && !['Read', 'Grep', 'Glob'].includes(request.toolName)) return undefined
  // Glob's absolute pattern can override its declared search directory.
  // Keep patterns relative; the separately checked path selects the directory.
  if (request.toolName === 'Glob' && (typeof request.input.pattern !== 'string' ||
      !request.input.pattern.trim() || isAbsolute(request.input.pattern) ||
      request.input.pattern.split(/[\\/]/).includes('..'))) {
    return { behavior: 'deny', reason: 'project_workspace_target_invalid',
      message: 'Glob requires a relative pattern without parent traversal; use path for the project-local search directory.' }
  }
  const inputPath = writing ? getMutationArtifactPath(request.input, request.toolName) : request.input[pathKey]
  const defaultToWorkspace =
    (request.toolName === 'Grep' || request.toolName === 'Glob') &&
    inputPath === undefined
  if (
    !defaultToWorkspace &&
    (typeof inputPath !== 'string' || inputPath.trim().length === 0)
  ) {
    return {
      behavior: 'deny',
      reason: 'project_workspace_target_invalid',
      message: `${request.toolName} requires one project-local target path.`,
    }
  }
  const workspaceRoot = resolveExistingPath(record.session.cwd)
  const targetPath = defaultToWorkspace
    ? workspaceRoot
    : resolveProspectivePath(record.session.cwd, inputPath as string)
  const rel = relative(workspaceRoot, targetPath)
  const workRel = relative(projectWorkDirectory(workspaceRoot, record.session.id), targetPath)
  const currentToolsRead = !writing && !isAbsolute(workRel) && workRel !== '..' && !workRel.startsWith('..' + sep)
  if ((rel.startsWith('..') || isAbsolute(rel)) && !currentToolsRead) {
    return {
      behavior: 'deny',
      reason: 'project_workspace_boundary',
      message: `${request.toolName} may not access files outside the project workspace.`,
    }
  }
  // Keep instruction changes under the existing explicit permission authority,
  // even when native omits a safety reason. Ordinary project outputs retain
  // their current automatic workspace approval.
  if (writing && rel === 'AGENTS.md') return undefined
  // Native serializes safety/other reasons, but not the ordinary ask rule
  // installed by BGS. Preserve those native prompts without allowing a human
  // approval to bypass the project boundary above.
  if (writing && request.decisionReason?.trim()) return undefined
  return {
    behavior: 'allow',
    reason: 'project_workspace_file_access',
  }
}

function resolveProspectivePath(cwd: string, artifactPath: string): string {
  // Match native tool expansion (home notation, whitespace, Unicode/platform
  // normalization) before resolving aliases and checking the project boundary.
  const targetPath = expandPath(artifactPath, cwd)
  const missingSegments: string[] = []
  let existingAncestor = targetPath
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor)
    if (parent === existingAncestor) break
    missingSegments.unshift(basename(existingAncestor))
    existingAncestor = parent
  }
  return resolve(resolveExistingPath(existingAncestor), ...missingSegments)
}

function archiveInterruptedRecoveredTurn(record: SessionRecord): void {
  const turnId = findLatestInterruptedTurnId(record.events)
  if (!turnId) return
  const previousTurnId = record.currentTurnId
  record.currentTurnId = turnId
  record.session.turnStatus = 'idle'
  record.session.status = 'running'
  record.events.push({
    id: allocateTranscriptEventId(record),
    sessionId: record.session.id,
    turnId,
    type: 'turn.failed',
    text: 'Previous BeeGame turn was interrupted before completion.',
    createdAt: new Date(),
  })
  appendChatTranscript(
    record.transcriptPath,
    record.events.at(-1) as BeeGameEvent,
  )
  record.currentTurnId = previousTurnId
  record.session.updatedAt = new Date()
}

function findLatestInterruptedTurnId(events: BeeGameEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event?.type === 'turn.started' &&
      event.turnId &&
      !hasTurnEnded(events, event.turnId)
    ) {
      return event.turnId
    }
  }
  return ''
}

function getMutationArtifactPath(input: Record<string, unknown>, toolName?: string): string {
  const path = toolName ? input[toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path']
    : input.file_path || input.path || input.notebook_path
  return typeof path === 'string' ? path.trim() : ''
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
  payload: BeeGameEventPayload | undefined,
  field: string,
): string {
  const value = payload?.[field]
  return typeof value === 'string' ? value : ''
}

function getDashboardPayloadRecord(
  payload: BeeGameEventPayload | undefined,
  field: string,
): Record<string, unknown> {
  const value = payload?.[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
  updatedAt: string
}

function appendProjectAgentDiagnostic(
  record: SessionRecord,
  message: BeeGameEventPayload,
): void {
  appendRuntimeDiagnostic({
    path: getProjectRuntimeDiagnosticPath(record),
    // Keep transport facts for incident diagnosis, never raw model text or
    // tool inputs. Chat itself is already persisted in the transcript.
    record: {
      type: 'agent.transport',
      sessionId: record.session.id,
      ...(record.currentTurnId ? { turnId: record.currentTurnId } : {}),
      createdAt: new Date().toISOString(),
      messageType: typeof message.type === 'string' ? message.type : 'unknown',
      ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
      ...(typeof message.subtype === 'string' ? { subtype: message.subtype } : {}),
    },
    maxBytes: MAX_PROJECT_AGENT_RAW_LOG_BYTES,
    archiveCount: PROJECT_AGENT_RAW_LOG_ARCHIVES,
  })
}

function updateProjectTranscriptIndex(record: SessionRecord): void {
  const workspacePath = record.session.cwd
  const logsDir = getProjectLogsDirForRecord(record)
  mkdirSync(logsDir, { recursive: true })
  const indexPaths = [getProjectLogIndexPath(workspacePath)]
  const now = new Date().toISOString()
  for (const indexPath of new Set(indexPaths)) {
    mkdirSync(dirname(indexPath), { recursive: true })
    const index = readProjectLogIndex(indexPath, workspacePath)
    index.updatedAt = now
    index.sessions[record.session.id] = {
      sessionId: record.session.id,
      transcript: relative(projectHostDirectory(workspacePath), record.transcriptPath).split(sep).join('/'),
      updatedAt: now,
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
  }
}

function readProjectLogIndex(
  path: string,
  workspacePath: string,
): ProjectLogIndex {
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
        project:
          typeof parsed.project === 'string'
            ? parsed.project
            : basename(workspacePath),
        updatedAt:
          typeof parsed.updatedAt === 'string'
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
  return resolve(projectHostDirectory(workspacePath), 'logs')
}

function getProjectLogsDirForRecord(record: SessionRecord): string {
  return getProjectLogsDir(record.session.cwd)
}

function getProjectLogIndexPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'index.json')
}

function getProjectRuntimeDiagnosticPath(record: SessionRecord): string {
  return resolve(getProjectLogsDir(record.session.cwd), 'runtime-diagnostics.jsonl')
}

function toProjectRelativePath(workspacePath: string, path: string): string {
  return relative(workspacePath, path).split('\\').join('/')
}

function isThinkingProtocolControlEvent(event: BeeGameEvent): boolean {
  return (
    (event.type === 'assistant.partial' ||
      event.type === 'assistant.message') &&
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

function buildRuntimeEnv(
  selectedEnvironment: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(selectedEnvironment).filter(([key]) =>
      RUNTIME_MODEL_ENV_KEYS.has(key),
    ),
  )
}

export function mergeRuntimeEnv(
  runtime: RuntimeModelConfig | undefined,
  additionalEnv: Record<string, string>,
): Record<string, string> {
  const selectedEnvironment = {
    ...normalizeRuntimeEnvironment(additionalEnv),
    ...normalizeRuntimeEnvironment(runtime?.env ?? {}),
    ...(additionalEnv.BGS_MODEL_CONNECTION_RESOLVED === '1' ? normalizeRuntimeEnvironment(additionalEnv) : {}),
  }
  // MCP settings are owner-scoped host data, never an arbitrary model-config env override.
  delete selectedEnvironment.BEEGAME_NATIVE_MCP_SERVERS_JSON
  if (additionalEnv.BEEGAME_NATIVE_MCP_SERVERS_JSON !== undefined)
    selectedEnvironment.BEEGAME_NATIVE_MCP_SERVERS_JSON = additionalEnv.BEEGAME_NATIVE_MCP_SERVERS_JSON
  const selectedType = additionalEnv.BGS_MODEL_CONNECTION_RESOLVED === '1' ? additionalEnv.BEEGAME_MODEL_TYPE : runtime?.modelType
  const modelType = inferSelectedRuntimeModelType({ ...selectedEnvironment, ...(selectedType ? { BEEGAME_MODEL_TYPE: selectedType } : {}) })
  return {
    ...selectedEnvironment,
    ...(modelType ? { BEEGAME_MODEL_TYPE: modelType } : {}),
  }
}

function inferSelectedRuntimeModelType(environment:Record<string,string>) { return inferRuntimeModelType(environment) }

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


export async function readInlineArtifactText(path: string): Promise<string> {
  if ((await stat(path)).size > CHAT_PAGE_BYTES) throw Error('Artifact exceeds the inline text limit; use paged Chat history for events')
  return readFile(path, 'utf8')
}
