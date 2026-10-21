import {inferRuntimeModelType} from '@bee-game-studio/agent-workflow/runtime-environment'
import type { DesignFileChanges } from './workflow-v3/state'
import { createHash, randomUUID } from 'node:crypto'
import { PROJECT_DESIGN_PATHS } from './design-handoff'
import { MANAGED_WEB_BOOT_PATHS } from './workflow-v3/managed-web-boot'
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
import { recordConfirmedBriefEvidence } from './confirmed-brief-evidence'
import { appendChatTranscript, appendRuntimeDiagnostic } from './project-records'
import {
  parseNativeBackgroundTaskLaunch,
  readNativeBackgroundTaskUsage,
} from './native-background-task-output'
import { createBgsRunner } from '../bgs/runner'
import { createNativeSubagentChatEnricher, isNativeTaskLifecycle, stoppedNativeTask } from './native-subagent-chat'
import { isSupabaseRuntimeEnvAuthError } from '../supabase-runtime-env-client'
import type { BeeGameNativeTaskNotification } from './native-task-notification'
import { ChatJsonlReader } from './chat-jsonl-reader'
import { auditEventPage, type EventPageSelection } from './workflow-v3/event-page'
import { answeredQuestionInput, UserQuestionValidationError } from './user-question'
import { expandPath } from '@bee-game-studio/agent-workflow/runtime-path'
import { UsageOutboxPersistenceError, SessionUsageOutbox } from './session-usage-outbox'
import { isPersonalModelId } from '../model-connections'

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

export type BeeGameRuntimeSnapshot = {
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

export type BeeGameSessionRunnerStartInput = {
  sessionId: string
  /** Host-observed new-project contract, never inferred from project files. */
  managedWebBoot?: true
  /** Host capability discovery, separate from the user's message. */
  systemContext?: string
  /** Host-confirmed UI check conditions; never accepted from model tool input. */
  uiLayoutConstraints?: import('./ui-layout-audit').LayoutConstraints
  /** Optional private execution directory; Chat and billing retain project identity. */
  isolatedTask?: { workspacePath: string; readOnlyPaths: string[] }
  /** Platform evidence root exposed only through read-only contract facts. */
  resumeSessionId?: string
  /** Host-owned workflow task identity supplied through standard --session-id. */
  nativeSessionId?: string
  /** Records the UUID emitted by the native runtime for durable resume. */
  onNativeSessionId?(sessionId: string): void
  /** Native replay of this exact submitted command, not merely CLI startup. */
  onNativeSubmission?(sessionId: string): void
  /** Passive provider accounting, cumulative within this native process. */
  onNativeUsage?(usage: Usage, epoch?: string, accounting?: { incomplete: boolean }): void
  cwd: string
  env: Record<string, string>
  /** Sanitized evidence of the selected versus forwarded launch settings. */
  runtimeLaunchContract?: RuntimeLaunchContract
  language?: BeeGameSessionLanguage
  /** Native background tasks may outlive the foreground turn that spawned them. */
  onNativeTaskNotification?(notification: BeeGameNativeTaskNotification): void
  /** BGS business scope evaluated before standard permission shortcuts. */
  toolPolicy?(request: DashboardPermissionRequest): Promise<DashboardPermissionDecision | undefined>
  /** Standard CLI role configuration; never private native task metadata. */
  nativeTools?: readonly string[]
  requestPermission?(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

export type RuntimeLaunchContract = {
  selectedEnvironmentKeys: string[]
  forwardedEnvironmentKeys: string[]
  endpointClass: 'default' | 'first_party' | 'custom'
  configDirectoryConfigured: boolean
  credentialConfigured: boolean
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
  'BEEGAME_ARTIFACTS_URL',
  'BEEGAME_ARTIFACTS_TOKEN',
  'TAVILY_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'EXA_API_KEY',
  'SKILL_SEARCH_ENABLED',
  'BEEGAME_MODEL_TYPE',
  'BGS_DEFAULT_FAST_MODEL',
  'BGS_DEFAULT_BALANCED_MODEL',
  'BGS_DEFAULT_STRONG_MODEL',
  'BGS_USE_OPENAI',
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

export type BeeGameSessionSubmitInput = {
  prompt: BeeGamePromptInput
  /** Refreshed each turn, including when the native process is reused. */
  language?: BeeGameSessionLanguage
  /** User-confirmed context exposed read-only to platform contract tools. */
  confirmedBriefContext?: string
  signal: AbortSignal
  onMessage(message: DashboardSDKMessage): void | Promise<void>
  onNativeTaskNotification?(notification: BeeGameNativeTaskNotification): void
  requestPermission(
    request: DashboardPermissionRequest,
  ): Promise<DashboardPermissionDecision>
}

export type BeeGameSessionRuntime = {
  readonly reusable?: boolean
  submit(input: BeeGameSessionSubmitInput): Promise<void>
  stop(): void
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
  designChangeAllowed?: boolean
  resolve(decision: DashboardPermissionDecision): void
}

export type BeeGamePendingPermission = DashboardPermissionRequest & {
  sessionId: string
  projectId?: string
  requestedAt: Date
  designChangeAllowed?: boolean
}

type SessionRecord = {
  designLocked?: boolean
  managedWebBoot?: boolean
  executionIdentity?: BeeGameRuntimeSnapshot['executionIdentity']
  /** Redact runtime credentials from persisted and streamed Chat events only. */
  redactVisible?: ReturnType<typeof createResponseRedactor>
  systemContext?: string
  uiLayoutConstraints?: BeeGameSessionRunnerStartInput['uiLayoutConstraints']
  preparingTurn?: boolean
  session: BeeGameSession
  isolatedTask?: { workspacePath: string; readOnlyPaths: string[] }
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
  runtimeCleanupFailed?: boolean
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  workflowQuestionGuard?: StartBeeGameSessionInput['workflowQuestionGuard']
  /** User-approved network hosts for this live session only. */
  approvedNetworkHosts: Set<string>
  toolUses: Map<string, { toolName: string; input?: unknown }>
  /** Attribution only; the native runner owns task lifecycle and turn draining. */
  nativeTaskTurnIds: Map<string, string | undefined>
  /** Active native background tasks from live lifecycle notifications. */
  activeNativeTaskToolUseIds: Map<string, string>
  terminalNativeTaskIds: Set<string>
  /** Tool-use blocks observed before their streamed JSON input is complete. */
  assistantPartialTextByMessage: Map<string, string>
  activeAssistantMessageId: string | null
  emittedAssistantMessageIds: Set<string>
  thinkingBlockIndexes: Set<number>
  activeAssistantTextBlockIndex?: number
  visibleThinkingBlockIds: Map<number, string>
  /** Start time for each visible thinking block, used when its end event arrives. */
  thinkingBlockStartedAt: Map<string, string>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  /** Provider-cumulative usage captured before the active turn starts. */
  currentTurnStartingUsage?: BeeGameRuntimeSnapshot['usage']
  /** The complete active model turn, including final event/usage callbacks. */
  activeTurn?: Promise<void>
  /** Serializes usage billing events without blocking the SDK callback. */
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
  isolatedTask?: { workspacePath: string; readOnlyPaths: string[] }
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

export class BeeGameSessionManager {
  private readonly runnerDisposals = new Map<Promise<void>, string | undefined>()
  private closing?: Promise<void>

  private disposeRunner(runner: BeeGameSessionRuntime | null, record?: SessionRecord): Promise<void> {
    if (!runner) return Promise.resolve()
    const completion = Promise.resolve().then(() => runner.dispose ? runner.dispose() : runner.stop())
      .catch(() => {
        if (record) record.runtimeCleanupFailed = true
        console.error('[BeeGame] Runtime cleanup failed; writer exit is unverified')
      })
    this.runnerDisposals.set(completion, record?.userId)
    void completion.then(() => this.runnerDisposals.delete(completion))
    return completion
  }
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly subagentChat = new WeakMap<SessionRecord, ReturnType<typeof createNativeSubagentChatEnricher>>()
  private readonly snapshotInputs = new WeakMap<SessionRecord, {
    source: BeeGameEvent[]; processed: number; events: BeeGameEvent[]
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
    return [...this.runnerDisposals.values()].includes(userId) || [...this.sessions.values()].some(record =>
      record.userId === userId && (record.session.turnStatus !== 'idle' || Boolean(record.activeTurn) ||
        Boolean(record.preparingTurn) || record.runtimeCleanupFailed === true))
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
    const record: SessionRecord = {
      session,
      ...(!input.freshNativeContext && persistedRuntime?.workspacePath===cwd && persistedRuntime.executionIdentity
        ? {executionIdentity:persistedRuntime.executionIdentity}:{}),
      ...(input.isolatedTask ? { isolatedTask: input.isolatedTask } : {}),
      ...(input.resumeNativeSessionId
        ? { nativeSessionId: input.resumeNativeSessionId }
        : {}),
      ...(persistedRuntime?.nativeSessionId &&
      !input.resumeNativeSessionId && !input.freshNativeContext &&
      resolveExistingPath(persistedRuntime.workspacePath) ===
        resolveExistingPath(cwd)
        ? { nativeSessionId: persistedRuntime.nativeSessionId }
        : {}),
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
      transcriptPath:
        recoveredTranscript?.path ??
        getSessionTranscriptPath(session.id, session.cwd),
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      ...(input.workflowQuestionGuard ? { workflowQuestionGuard: input.workflowQuestionGuard } : {}),
      approvedNetworkHosts: new Set(),
      toolUses: new Map(),
      nativeTaskTurnIds: new Map(),
      activeNativeTaskToolUseIds: new Map(),
      terminalNativeTaskIds: new Set(),
      assistantPartialTextByMessage: new Map(),
      activeAssistantMessageId: null,
      emittedAssistantMessageIds: new Set(),
      thinkingBlockIndexes: new Set(),
      visibleThinkingBlockIds: new Map(),
      thinkingBlockStartedAt: new Map(),
      events: recoveredTranscript?.events ?? [],
      nextEventId: recoveredTranscript
        ? getNextTranscriptEventId(recoveredTranscript.events)
        : 1,
      nextTurnIndex: recoveredTranscript
        ? getNextTurnIndex(session.id, recoveredTranscript.events)
        : 1,
      currentTurnId: null,
      usageWriteTail: Promise.resolve(),
      usageFailureReported: false,
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
      (record.session.turnStatus !== 'idle' || Boolean(record.activeTurn) || Boolean(record.preparingTurn)))
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
    record.uiLayoutConstraints = undefined
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
  ): BeeGameRuntimeSnapshot {
    const record = this.sessions.get(sessionId)
    if (record) return this.deriveRuntimeSnapshot(record)
    const persisted = this.readPersistedRuntimeSnapshot(sessionId)
    if (workspacePath) {
      const root = resolveExistingPath(workspacePath)
      const recoveredTranscript = readExistingTranscriptForResume(
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
    payload?: DashboardSDKMessage
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
   * Avoid formatting every SDK message just to locate Question outcomes. */
  transcriptFacts(sessionId:string):readonly BeeGameEvent[] {
    const record=this.sessions.get(sessionId)
    if(!record)throw new Error('Session not found')
    return liveProjectConversationEvents(record.events).filter(event=>!isThinkingProtocolControlEvent(event))
  }

  /** Read-only V3 debug view; avoid formatting/serializing all prior SDK events. */
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
  recordDeliveryError(sessionId: string, detail: string, category?: 'report-invalid' | 'verification-incomplete' | 'product-failed'): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    const labels = {
      'report-invalid': ['验收报告无效：', 'Invalid acceptance report: '],
      'verification-incomplete': ['验收验证不足：', 'Acceptance verification incomplete: '],
      'product-failed': ['游戏验收未通过：', 'Game acceptance failed: '],
    }
    const prefix = category ? labels[category][record.language === 'zh' ? 0 : 1]
      : record.language === 'zh' ? '交付未能继续：' : 'Delivery could not continue: '
    this.append(record, 'system.status', formatRuntimeErrorForDisplay(prefix + detail, record.language),
      { type: 'system.status', subtype: 'delivery_error', ...(category ? { category } : {}) })
  }

  /** Display-only host snapshot, independent of the author's final answer. */
  recordHostEvidence(sessionId: string, facts: {
    attemptId: string; turnId?: string; execution: string; measurementId?: string;
    checkStatuses: { id: string; status: string }[]; unmeasured: readonly string[]; note: string; designFileChanges?: DesignFileChanges;
  }): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (record.events.some(event => event.payload?.subtype === 'host_evidence' && event.payload?.attemptId === facts.attemptId)) return
    const note = projectRuntimeDisplayReason(facts.note)?.detail ?? ''
    const zh = record.language === 'zh'
    const statuses: Record<string, string> = {passed:'通过',failed:'失败',unverified:'未验证','execution-error':'执行错误'}
    const text = [
      zh ? 'BGS 宿主检查｜本轮执行已结束，不等于游戏验收通过' : 'BGS host evidence | Execution ended, not game acceptance',
      (zh ? '执行状态：' : 'Execution: ')+facts.execution,
      ...(facts.designFileChanges ? [
        (zh ? '本轮设计文件差异（不代表修改者或验收）：' : 'Design file changes this turn (not authorship or acceptance): ')+
          (facts.designFileChanges.status === 'unverified' ? (zh ? '未验证' : 'unverified') :
            facts.designFileChanges.files.map(file => file.path+' ('+file.change+')').join(', ') || (zh ? '无' : 'none')),
      ] : []),
      facts.measurementId ? (zh ? '已保存测量（非整体验收）：' : 'Saved measurement (not acceptance): ')+facts.measurementId : (zh ? '没有宿主测量记录。' : 'No host measurement.'),
      ...facts.checkStatuses.map(check => check.id+': '+(zh ? statuses[check.status] ?? check.status : check.status)),
      ...(facts.unmeasured.length ? [(zh ? '未测量：' : 'Not measured: ')+facts.unmeasured.join(', ')] : []),
      zh ? '以上是回合结束时的有限范围检查；不证明玩法、审美或完整覆盖。作者测试报告的断言数量和语义未经宿主认证；游戏质量仍未验证。后续改动需重新检查证据有效性。'
        : 'Turn-end scoped checks only, not gameplay, aesthetics or complete coverage. Author report assertions/semantics are not host-certified; game quality remains unverified. Later edits require freshness inspection.',
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

  setProjectDesignLocked(sessionId: string, locked: boolean) {
    const record = this.sessions.get(sessionId)
    if (!record?.projectId) throw new Error('Project session not found')
    record.designLocked = locked
  }

  setProjectManagedWebBoot(sessionId: string, enabled: boolean) {
    const record = this.sessions.get(sessionId)
    if (!record?.projectId) throw new Error('Project session not found')
    record.managedWebBoot = enabled
  }

  async sendWithDisplay(
    sessionId: string,
    text: string,
    display?: {
      displayText?: string
      displayKind?: string
      taskType?: string
      authToken?: string
      getValidAuthToken?: SessionRecord['getValidAuthToken']
      clientMessageId?: string
      supersedesMessageId?: string
      rewindAvailable?: boolean
      language?: BeeGameSessionLanguage
      attachments?: BeeGameAttachment[]
      confirmedBriefContext?: string
      onTurnAccepted?: (turnId: string) => void
      executionIdentity?: Pick<NonNullable<BeeGameRuntimeSnapshot['executionIdentity']>, 'attemptId'|'workerId'|'fence'>
      prepareTurn?: () => Promise<{ systemContext?: string; turnContext?: string;
        uiLayoutConstraints?: BeeGameSessionRunnerStartInput['uiLayoutConstraints']; close?: () => Promise<void> }>
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
      if (context && (context.systemContext !== record.systemContext ||
          JSON.stringify(context.uiLayoutConstraints) !== JSON.stringify(record.uiLayoutConstraints))) {
        await this.disposeRunner(record.runner, record)
        record.runner = null
        record.systemContext = context.systemContext
        record.uiLayoutConstraints = context.uiLayoutConstraints
      }
      if (record.session.status !== 'running') throw new Error('Session was stopped during turn preparation')
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
        this.append(
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
      record.assistantPartialTextByMessage.clear()
      record.activeAssistantMessageId = null
      record.emittedAssistantMessageIds.clear()
      record.thinkingBlockIndexes.clear()
      record.visibleThinkingBlockIds.clear()
      record.thinkingBlockStartedAt.clear()
      record.currentTurnStartingUsage = this.deriveRuntimeSnapshot(record).usage
      record.currentTurnId = nextTurnId
      record.executionIdentity = display?.executionIdentity ? {...display.executionIdentity,turnId:nextTurnId}:undefined
      record.nextTurnIndex += 1
      display?.onTurnAccepted?.(nextTurnId)
      turnAccepted = true
      record.abortController = new AbortController()
      this.append(record, 'turn.started', text)
      this.append(record, 'user.message', text, {
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
        context?.turnContext ? [
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
      this.closeOpenThinkingLifecycle(record, 'session_stopped')
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
      this.closeOpenThinkingLifecycle(record, 'turn_interrupted')
      record.session.turnStatus = 'idle'
      record.session.updatedAt = new Date()
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
      record.abortController?.abort('session_deleted')
      await this.disposeRunner(record.runner, record)
      record.runner = null
      this.resolveAllPendingPermissions(record, {
        behavior: 'deny',
        message: 'Session deleted before permission was resolved',
        source: 'policy',
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
      // late SDK events cross a hot-reload boundary and mutate durable state.
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
      content: await readFile(targetPath, 'utf8'),
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
  ): Promise<void> {
    let turnRunner: BeeGameSessionRuntime | null = null
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      await this.assertModelRequestAllowed(record.userId)
      let selectedEnvironment = mergeRuntimeEnv(
        record.runtime,
        await this.loadAdditionalRuntimeEnv(record),
      )
      const env: Record<string, string> = {
        ...buildRuntimeEnv(selectedEnvironment),
      }
      record.redactVisible = createResponseRedactor(env)
      if (signal.aborted || record.session.status !== 'running') return
      if (record.runnerNeedsRefresh) {
        await this.disposeRunner(record.runner, record)
        record.runner = null
        record.runnerNeedsRefresh = false
      }
      if (!record.runner) record.nativeAccountingEpoch = randomUUID()
      const accountingEpoch = record.nativeAccountingEpoch
      const runner =
        record.runner ??
        (await this.runner.start({
          sessionId: record.session.id,
          ...(record.managedWebBoot ? {managedWebBoot:true as const} : {}),
          systemContext: record.systemContext,
          uiLayoutConstraints: record.uiLayoutConstraints,
          ...(record.isolatedTask ? { isolatedTask: record.isolatedTask } : {}),
          ...(record.nativeSessionId
            ? { resumeSessionId: record.nativeSessionId }
            : {}),
          onNativeSessionId: nativeSessionId => {
            record.nativeSessionId = nativeSessionId
            this.persistRuntimeSnapshot(record)
          },
          onNativeSubmission: nativeSessionId => {
            record.nativeSessionId = nativeSessionId
            if(record.executionIdentity)record.executionIdentity={...record.executionIdentity,nativeSubmitted:true}
            this.persistRuntimeSnapshot(record)
          },
          onNativeUsage: (usage, epoch, accounting) => {
            // Passive accounting stays out of model history. Persist acknowledged
            // provider work even if cancellation prevents a complete receipt.
            if (usage.total_tokens > 0 || accounting?.incomplete) this.append(record, 'usage', '', {
              type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch ?? accountingEpoch, usage,
              ...(accounting?.incomplete ? { providerUsageIncomplete: true } : {}),
            })
            // Native receipts arrive even during tool-only turns. Settle the
            // acknowledged cumulative usage without waiting for an answer.
            if (record.currentTurnId && !record.currentTurnUsageExternallyAccounted)
              void this.recordUsageSnapshot(record, record.currentTurnId, true)
          },
          onNativeTaskNotification: notification => {
            const message = notification.message ?? notification.backgroundMessage
            const taskId = message && getStringField(message, 'task_id')
            const toolUseId = message && (getStringField(message, 'tool_use_id') || getStringField(message, 'toolUseID'))
            if (taskId && !record.terminalNativeTaskIds.has(taskId) && ['task_started', 'task_progress'].includes(String(message?.subtype))) {
              record.nativeTaskTurnIds.set(taskId, record.currentTurnId ?? undefined)
              record.activeNativeTaskToolUseIds.set(taskId,
                toolUseId || record.activeNativeTaskToolUseIds.get(taskId) || taskId)
            } else if (taskId && message?.subtype === 'task_notification' &&
              ['completed', 'failed', 'stopped', 'killed'].includes(getStringField(message, 'status'))) {
              record.activeNativeTaskToolUseIds.delete(taskId)
              record.terminalNativeTaskIds.add(taskId)
              if (toolUseId) {
                for (const [activeTaskId, activeToolUseId] of record.activeNativeTaskToolUseIds) {
                  if (activeToolUseId === toolUseId) record.activeNativeTaskToolUseIds.delete(activeTaskId)
                }
              }
            }
            this.persistRuntimeSnapshot(record)
            // Foreground messages already go through onMessage. Background
            // notifications must remain visible after that turn has returned.
            if (notification.backgroundMessage) {
              const taskId = getStringField(notification.backgroundMessage, 'task_id')
              this.append(record, 'system.status', String(notification.backgroundMessage.subtype),
                notification.backgroundMessage as DashboardSDKMessage,
                record.nativeTaskTurnIds.get(taskId))
            }
          },
          cwd: record.session.cwd,
          env,
          runtimeLaunchContract: buildRuntimeLaunchContract(
            selectedEnvironment,
            env,
          ),
          ...(record.language ? { language: record.language } : {}),
          requestPermission: request => this.requestPermission(record, request),
        }))
      record.runner = runner
      turnRunner = runner
      if (signal.aborted || record.session.status !== 'running') {
        await this.disposeRunner(runner, record)
        record.runner = null
        return
      }
      await this.submitToRunner(
        record,
        runner,
        prompt,
        signal,
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
      // without fabricating completed SDK events for unfinished writers.
      record.activeNativeTaskToolUseIds.clear()
      if (record.session.status === 'running') {
        this.closeOpenThinkingLifecycle(record, 'turn_failed')
        this.append(
          record,
          'turn.failed',
          formatRuntimeErrorForDisplay(toErrorMessage(err), record.language),
        )
      }
    } finally {
      try { await settle?.() }
      catch (error) {
        this.recordDeliveryError(record.session.id, `Request cleanup failed: ${toErrorMessage(error)}`)
      }
      const terminalTurnId = record.currentTurnId
      if (terminalTurnId && !record.currentTurnUsageExternallyAccounted) {
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
      record.currentTurnStartingUsage = undefined
      record.assistantPartialTextByMessage.clear()
      record.activeAssistantMessageId = null
      record.emittedAssistantMessageIds.clear()
      record.thinkingBlockIndexes.clear()
      record.visibleThinkingBlockIds.clear()
      record.thinkingBlockStartedAt.clear()
      record.abortController = null
      record.currentTurnUsageExternallyAccounted = undefined
      record.session.updatedAt = new Date()
    }
  }

  private async loadAdditionalRuntimeEnv(
    record: SessionRecord,
  ): Promise<Record<string, string>> {
    try {
      return await this.getAdditionalRuntimeEnv(
        record.userDataRoot,
        record.userId,
        record.authToken,
        record.session.modelConfigId,
      )
    } catch (error) {
      if (!isSupabaseRuntimeEnvAuthError(error) || !record.getValidAuthToken) {
        throw error
      }
      const refreshed = await record.getValidAuthToken({ forceRefresh: true })
      if (!refreshed) {
        throw new Error(
          'Workflow authentication expired and could not be refreshed. Please sign in again.',
        )
      }
      record.authToken = refreshed
      return this.getAdditionalRuntimeEnv(
        record.userDataRoot,
        record.userId,
        refreshed,
        record.session.modelConfigId,
      )
    }
  }

  private async submitToRunner(
    record: SessionRecord,
    runner: BeeGameSessionRuntime,
    prompt: BeeGamePromptInput,
    signal: AbortSignal,
  ): Promise<void> {
    const submittedTurnId = record.currentTurnId
    const accountingEpoch = record.nativeAccountingEpoch
    let executionError: Error | undefined
    await runner.submit({
      prompt,
      ...(record.language ? { language: record.language } : {}),
      ...(record.confirmedBriefContext
        ? { confirmedBriefContext: record.confirmedBriefContext }
        : {}),
      signal,
      onMessage: async message => {
        appendProjectAgentDiagnostic(record, message)
        if (message.type === 'runtime_event') {
          if (!submittedTurnId || record.currentTurnId !== submittedTurnId || signal.aborted ||
              hasTurnEnded(this.runtimeSnapshotInputs(record), submittedTurnId)) return
          const type = String(message.eventType) as BeeGameEventType
          const text = typeof message.text === 'string' ? message.text : ''
          if (type === 'system.status' && typeof message.childThreadId === 'string') {
            if (['pendingInit','running'].includes(String(message.childStatus)))
              record.activeNativeTaskToolUseIds.set(message.childThreadId, String(message.parentToolUseID || message.childThreadId))
            else record.activeNativeTaskToolUseIds.delete(message.childThreadId)
          }
          if (type !== 'assistant.thinking') this.closeOpenThinkingLifecycle(record, 'visible_output_started')
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
                    mediaType: mediaType as BeeGameImageAttachment['mediaType'], data:(await readFile(path)).toString('base64')}])
                  payload = {...message,attachments:attachments.map(({relativePath:_path,...reference})=>reference)}
                }
              }
            } catch { payload = {...message,attachmentError: "Image preview could not be attached"} }
          }
          this.append(record, type, text, payload)
          return
        }
        if (isSDKExecutionError(message)) {
          executionError = new Error(getSDKExecutionErrorDetail(message))
        }
        // Timed-out runtimes can flush synthetic messages after their turn closed.
        // Preserve raw diagnostics without leaking them into chat or a later turn.
        if (
          !submittedTurnId ||
          record.currentTurnId !== submittedTurnId ||
          hasTurnEnded(this.runtimeSnapshotInputs(record), submittedTurnId)
        )
          return
        // Compatible streaming transports report authoritative usage on
        // message_delta, which has no visible text. Preserve it as a
        // first-class event so runtime snapshots advance during the turn.
        if (
          message.type === 'stream_event' &&
          getUsageFromEventPayload(message).total_tokens > 0
        ) {
          this.append(record, 'usage', '', message)
        }
        const toolInputActivity = mapStreamingToolInputActivity(message)
        if (toolInputActivity) {
          this.append(
            record,
            toolInputActivity.type,
            toolInputActivity.text,
            toolInputActivity.payload,
          )
        }
        const mapped = mapSDKMessageToEvent(record, message)
        const childOwner = getStringField(message, 'parent_tool_use_id')
        if (mapped) {
          if (mapped.type !== 'assistant.thinking' && !childOwner)
            this.closeOpenThinkingLifecycle(record, 'visible_output_started')
          if (childOwner) {
            // Child output must not reconcile against the parent's answer or
            // consume its partial-text/thinking cursors.
            this.append(record, mapped.type, mapped.text, { ...message, ...mapped.payload })
          } else if (mapped.type === 'assistant.partial') {
            this.append(record, mapped.type, mapped.text, {
              ...message, messageId: record.activeAssistantMessageId,
              assistantBlockId: nativeAssistantBlockId(record, record.activeAssistantMessageId),
            })
            this.appendAssistantPartialText(record, message)
          } else if (mapped.type === 'assistant.message') {
            const reconciled = this.reconcileAssistantText(
              record,
              message,
              mapped.text,
            )
            if (reconciled)
              this.append(record, mapped.type, reconciled, { ...message,
                assistantBlockId: nativeAssistantBlockId(record, getSDKAssistantMessageId(message) ?? record.activeAssistantMessageId) })
          } else {
            this.append(
              record,
              mapped.type,
              mapped.text,
              message.type === 'result'
                ? { ...(mapped.payload ?? message), nativeAccountingEpoch: accountingEpoch }
                : mapped.payload ?? message,
            )
          }
        }
        for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
          if (toolEvent.type === 'tool.started' && !childOwner)
            this.closeOpenThinkingLifecycle(record, 'tool_started')
          const images = extractNativeToolImages(message, String(toolEvent.payload?.toolUseID ?? ''))
          if (images.length) {
            try {
              const displayImages = await preferOriginalReadImage(record.session.cwd, toolEvent.payload, images)
              const attachments = await materializeBeeGameAttachments(record.session.cwd, displayImages)
              toolEvent.payload = { ...toolEvent.payload, attachments: attachments.map(({ relativePath: _path, ...reference }) => reference) }
            } catch {
              toolEvent.payload = { ...toolEvent.payload, attachmentError: 'Tool image could not be stored for Chat.' }
            }
          }
          this.append(record, toolEvent.type, toolEvent.text, toolEvent.payload)
        }
        // A completed native assistant message is an authoritative model-usage
        // checkpoint. The terminal snapshot still catches late usage and turns
        // that end without an assistant message.
        if (message.type === 'assistant' && !record.currentTurnUsageExternallyAccounted)
          void this.recordUsageSnapshot(record, submittedTurnId, true)
      },
      requestPermission: request => this.requestPermission(record, request),
    })
    if (executionError) throw executionError
  }

  private async recordUsageSnapshot(
    record: SessionRecord,
    turnId: string,
    checkpoint = false,
  ): Promise<void> {
    if (!this.usageBillingBackend.recordUsage) return
    const providerCumulativeUsage = getLatestRuntimeUsage(this.runtimeSnapshotInputs(record))
    const turnDeltaUsage = subtractRuntimeUsage(
      providerCumulativeUsage,
      record.currentTurnStartingUsage ?? emptyRuntimeUsage(),
    )
    const providerUsageIncomplete = record.events.some(event =>
      event.type === 'usage' && event.payload?.providerUsageIncomplete === true)
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
      // runtime_snapshot is session cumulative; the billing authority computes
      // its own delta. Sending a turn delta here subtracts usage a second time.
      usage: providerCumulativeUsage,
      idempotencyKey,
      metadata: {
        usageBasis: 'session-cumulative-v1',
        ...(providerUsageIncomplete ? { providerUsageIncomplete: true } : {}),
        providerCumulativeUsage,
        turnDeltaUsage,
        ...(!providerUsageIncomplete ? { billableFinalUsage: providerCumulativeUsage } : {}),
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

  private appendAssistantPartialText(
    record: SessionRecord,
    message: DashboardSDKMessage,
  ): void {
    const messageKey = nativeAssistantBlockId(record, record.activeAssistantMessageId) ?? record.currentTurnId
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
    const messageId =
      getSDKAssistantMessageId(message) ?? record.activeAssistantMessageId
    const blockId = nativeAssistantBlockId(record, messageId)
    if (blockId && record.emittedAssistantMessageIds.has(blockId))
      return null

    const messageKey = blockId ?? record.currentTurnId
    const partialText = messageKey
      ? record.assistantPartialTextByMessage.get(messageKey)
      : undefined
    if (messageKey) record.assistantPartialTextByMessage.delete(messageKey)
    if (blockId) record.emittedAssistantMessageIds.add(blockId)
    return finalText || partialText || null
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

    if (decision.intent !== undefined && (decision.intent !== 'change' || decision.behavior !== 'allow' ||
        pending.toolName !== 'AskUserQuestion' || !pending.designChangeAllowed || !record.workflowQuestionGuard))
      throw new UserQuestionValidationError('Design changes require an explicit answer to a current locked-design question')
    // Validate before consuming the pending request so a failed submission can retry.
    if (decision.behavior === 'allow' &&
        (['AskUserQuestion', 'McpElicitation'].includes(pending.toolName) || decision.answers !== undefined)) {
      decision = {
        ...decision,
        updatedInput: answeredQuestionInput(pending.toolName, pending.input, decision.answers),
        source: 'user',
        scope: 'once',
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
    if (record.session.status !== 'running' || record.session.turnStatus !== 'running' ||
        !record.abortController || record.abortController.signal.aborted) {
      return { behavior: 'deny', source: 'policy',
        message: 'Session stopped before permission was resolved' }
    }
    const turnId = record.currentTurnId
    let workflowQuestion: Record<string, unknown> | undefined
    if (request.toolName === 'AskUserQuestion' && record.workflowQuestionGuard) {
      try { workflowQuestion = await record.workflowQuestionGuard(request) }
      catch (error) {
        this.append(record, 'workflow.question.rejected', 'Workflow question is not bound to current authorized findings', { type: 'workflow.question.rejected', toolUseID: request.toolUseID, message: toErrorMessage(error) })
        return { behavior: 'deny', source: 'policy', message: toErrorMessage(error) }
      }
    }
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
      this.append(
        record,
        'permission.resolved',
        `${request.toolName}: ${projectFileAccess.behavior}`,
        {
          type: 'permission.resolved',
          toolUseID: request.toolUseID,
          toolName: request.toolName,
          ...(request.agentId ? { agentId: request.agentId } : {}),
          decision: projectFileAccess.behavior,
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
      record.pendingPermissions.set(request.toolUseID, {
        ...request,
        requestedAt: new Date(),
        ...(workflowQuestion?.designChangeAllowed === true ? {designChangeAllowed:true} : {}),
        resolve,
      })
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
    if (workflowQuestion && decision.behavior === 'allow') {
      try {
        if (record.currentTurnId !== turnId || record.abortController?.signal.aborted)
          throw new Error('Workflow question belongs to an interrupted turn.')
        const binding = await record.workflowQuestionGuard!(request, decision)
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

  private closeOpenThinkingLifecycle(
    record: SessionRecord,
    reason: string,
  ): void {
    if (record.thinkingBlockIndexes.size === 0) return
    record.thinkingBlockIndexes.clear()
    const visibleBlockIds = [...record.visibleThinkingBlockIds.values()]
    record.visibleThinkingBlockIds.clear()
    for (const thinkingBlockId of visibleBlockIds) this.append(record, 'assistant.thinking', 'Thinking', {
      type: 'assistant.thinking', status: 'ended', reason,
      thinkingBlockId,
    })
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
    payload?: DashboardSDKMessage,
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
    let eventPayload = enrich({ type, payload }).payload as DashboardSDKMessage | undefined
    if (record.session.workflowExecution) eventPayload = { type, ...eventPayload, workflowExecution: record.session.workflowExecution }
    const stoppedTask = stoppedNativeTask({ type, payload: eventPayload })
    if (stoppedTask && record.activeNativeTaskToolUseIds.has(stoppedTask) &&
        record.nativeTaskTurnIds.get(stoppedTask) === effectiveTurnId) {
      record.activeNativeTaskToolUseIds.delete(stoppedTask)
      record.terminalNativeTaskIds.add(stoppedTask)
    }
    if (type === 'tool.completed' && eventPayload?.nativeBackgroundTask) {
      const launch = eventPayload.nativeBackgroundTask as Record<string, unknown>
      const taskId = typeof launch.taskId === 'string' ? launch.taskId : ''
      const toolUseId = getDashboardPayloadString(eventPayload, 'toolUseID')
      if (taskId && !record.terminalNativeTaskIds.has(taskId)) {
        record.nativeTaskTurnIds.set(taskId, effectiveTurnId)
        record.activeNativeTaskToolUseIds.set(taskId, toolUseId || taskId)
      }
    }
    if (type === 'tool.completed' && eventPayload?.nativeBackgroundTaskResult) {
      const result = eventPayload.nativeBackgroundTaskResult as Record<string, unknown>
      const toolUseId = typeof result.toolUseID === 'string' ? result.toolUseID : ''
      if (toolUseId) {
        for (const [taskId, activeToolUseId] of record.activeNativeTaskToolUseIds) {
          if (activeToolUseId === toolUseId) {
            record.activeNativeTaskToolUseIds.delete(taskId)
            record.terminalNativeTaskIds.add(taskId)
          }
        }
      }
    }
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
      if (eventPayload) eventPayload = record.redactVisible(eventPayload) as DashboardSDKMessage
    }
    const event: BeeGameEvent = {
      id: record.nextEventId,
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
      sessionUsage: getLatestRuntimeUsage(this.runtimeSnapshotInputs(record)) }
    appendChatTranscript(record.transcriptPath, event)
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
    record.nextEventId += 1
    record.session.updatedAt = new Date()
    this.persistRuntimeSnapshot(record)
    return event
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
    }
  }

  private runtimeSnapshotInputs(record: SessionRecord): BeeGameEvent[] {
    let index = this.snapshotInputs.get(record)
    if (!index || index.source !== record.events || index.processed > record.events.length) {
      index = {source: record.events, processed: 0, events: []}
      this.snapshotInputs.set(record, index)
    }
    // Only a derived host-status index. Consecutive detail frames with the same
    // turn have no usage/lifecycle/tool-count facts; keep their last boundary
    // for latest turn/time/status. Never filter raw Chat, native input, approval
    // evidence or billing checkpoints. Unknown event types are retained.
    for (; index.processed < record.events.length; index.processed++) {
      const event = record.events[index.processed]!, previous = index.events.at(-1)
      if (previous && isSnapshotDetailFrame(event) && isSnapshotDetailFrame(previous) && event.turnId === previous.turnId)
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
  return workspaceRoot
}

export async function deleteSessionArtifactsFromTranscript(
  sessionId: string,
  cwd: string,
): Promise<string[]> {
  const events = await readSessionTranscriptFromDisk(
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
const transcriptReaders = new Map<string, {
  reader: ChatJsonlReader<DiskTranscriptEvent>
  events: DiskTranscriptEvent[]
  pending?: Promise<DiskTranscriptEvent[]>
}>()

function readTranscriptIncrementally(path: string): Promise<DiskTranscriptEvent[]> {
  let state = transcriptReaders.get(path)
  if (!state) {
    state = { reader: new ChatJsonlReader(), events: [] }
    transcriptReaders.set(path, state)
  }
  if (state.pending) return state.pending
  const current = state
  current.pending = current.reader.read(path).then(({ rows, reset }) => {
    if (reset || rows.length) current.events = [...(reset ? [] : current.events), ...rows]
    return current.events
  }).finally(() => { current.pending = undefined })
  return current.pending
}

export async function readSessionTranscriptFromDisk(
  sessionId: string,
  cwd: string,
): Promise<
  Array<{
    id: number
    sessionId?: string
    type: BeeGameEventType
    text: string
    turnId?: string
    payload?: DashboardSDKMessage
    createdAt: string
  }>
> {
  return readTranscriptIncrementally(getSessionTranscriptPath(sessionId, cwd))
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
    const indexedTranscriptPath = resolve(workspacePath, entry.transcript)
    const expectedTranscriptPath = getSessionTranscriptPath(
      sessionId,
      workspacePath,
    )
    if (
      relative(workspacePath, indexedTranscriptPath).startsWith('..') ||
      indexedTranscriptPath !== expectedTranscriptPath
    ) {
      continue
    }
    try {
      const events = await readSessionTranscriptFromDisk(
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
  const transcriptPath = resolveReadableTranscriptPathSync(sessionId, cwd)
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

function recoverConfirmedBriefContext(
  events: BeeGameEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user.message' || !isRuntimeRecord(event.payload))
      continue
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

export function extractNativeToolImages(message: DashboardSDKMessage, toolUseId: string): BeeGameImageAttachment[] {
  const content = getObjectField(message, 'message')?.content ?? message.content
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    if (!block || !['tool_result', 'mcp_tool_result'].includes(block.type) || block.tool_use_id !== toolUseId || !Array.isArray(block.content)) return []
    return block.content.flatMap((part: any): BeeGameImageAttachment[] => {
      const source = part?.source
      if (part?.type !== 'image' || source?.type !== 'base64' ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(source.media_type) || typeof source.data !== 'string') return []
      return [{ type: 'image', mediaType: source.media_type, data: source.data }]
    })
  })
}

// The Read tool may downsample an image for the model's token budget. Save a
// bounded snapshot of its project source for Chat, without changing what the
// model receives. The source may have changed since Read; this is display data,
// not evidence that the model saw identical bytes.
export async function preferOriginalReadImage(
  workspace: string,
  tool: unknown,
  images: BeeGameImageAttachment[],
): Promise<BeeGameImageAttachment[]> {
  const event = tool && typeof tool === 'object' ? tool as Record<string, unknown> : undefined
  const input = event?.input as { file_path?: unknown } | undefined
  if (event?.toolName !== 'Read' || typeof input?.file_path !== 'string' || images.length !== 1) return images
  try {
    const root = await realpath(workspace)
    const path = await realpath(input.file_path)
    const within = relative(root, path)
    if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) return images
    const mediaType = IMAGE_ATTACHMENT_TYPES[extname(path).toLowerCase()]?.[0]
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') return images
    const info = await stat(path)
    if (!info.isFile() || info.size === 0 || info.size > MAX_BEEGAME_ATTACHMENT_BYTES) return images
    const bytes = await readFile(path)
    if (bytes.length === 0 || bytes.length > MAX_BEEGAME_ATTACHMENT_BYTES) return images
    const valid = mediaType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mediaType === 'image/jpeg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!valid) return images
    return [{ type: 'image', mediaType, data: bytes.toString('base64'), filename: basename(path) }]
  } catch {
    return images
  }
}

export async function materializeBeeGameAttachments(
  workspace: string,
  attachments: BeeGameAttachment[],
): Promise<MaterializedBeeGameFileAttachment[]> {
  if (attachments.length === 0) return []
  const attachmentDirectory = join(workspace, '.beegame-attachments')
  await mkdir(attachmentDirectory, { recursive: true })
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
        relativePath: relative(workspace, storedPath),
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
 * leaving the original SDK message untouched in agent.raw.jsonl and payloads.
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

function getSessionTranscriptPath(sessionId: string, cwd: string): string {
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
  events: BeeGameEvent[],
): BeeGameRuntimeSnapshot['usage'] {
  // Claude SDK result.modelUsage is cumulative while one native accounting
  // epoch remains active. A resumed/compacted native session may start a new
  // epoch whose counters are lower than the previous terminal snapshot. Keep
  // only the latest snapshot inside each monotonic epoch, then add the epochs;
  // summing every result double-counts while taking only the final result loses
  // all usage before a native counter reset.
  const modelUsage = aggregateCumulativeModelUsage(events)
  if (modelUsage) {
    // A turn can still be in flight after the previous result. Add only the
    // stream usage emitted after the latest modelUsage result; stream usage
    // before that result is already included in its cumulative counters.
    const inFlight = latestCumulativeUsageEvent(
      events,
      findLastModelUsageEventIndex(events),
    )
    addRuntimeUsage(modelUsage, inFlight)
    return modelUsage
  }

  // Before a terminal result exists, message_delta is the only authoritative
  // usage source exposed by the streaming transport.
  const streamedUsage = latestCumulativeUsageEvent(events, -1)
  if (streamedUsage.total_tokens > 0) return streamedUsage

  return emptyRuntimeUsage()
}

function findLastModelUsageEventIndex(events: BeeGameEvent[]): number {
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
  events: BeeGameEvent[],
  afterIndex: number,
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
    if (event.type !== 'usage' || event.payload?.subtype === 'native_accounting') continue
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

function getRuntimeUsageForTurn(
  events: BeeGameEvent[],
  turnId?: string,
): BeeGameRuntimeSnapshot['usage'] {
  if (turnId) {
    const firstTurnEventIndex = events.findIndex(
      event => event.turnId === turnId,
    )
    const lastTurnEventIndex = events.findLastIndex(
      event => event.turnId === turnId,
    )
    if (firstTurnEventIndex >= 0 && lastTurnEventIndex >= firstTurnEventIndex) {
      const throughTurn = aggregateCumulativeModelUsage(
        events.slice(0, lastTurnEventIndex + 1),
      )
      if (throughTurn) {
        const beforeTurn = aggregateCumulativeModelUsage(
          events.slice(0, firstTurnEventIndex),
        )
        const turnUsage = subtractRuntimeUsage(
          throughTurn,
          beforeTurn ?? emptyRuntimeUsage(),
        )
        const scopedEvents = events.slice(
          firstTurnEventIndex,
          lastTurnEventIndex + 1,
        )
        addRuntimeUsage(
          turnUsage,
          latestCumulativeUsageEvent(
            scopedEvents,
            findLastModelUsageEventIndex(scopedEvents),
          ),
        )
        return turnUsage
      }
    }
  }
  const scopedEvents = turnId
    ? events.filter(event => event.turnId === turnId)
    : events
  const modelUsage = aggregateCumulativeModelUsage(scopedEvents)
  if (modelUsage) {
    addRuntimeUsage(
      modelUsage,
      latestCumulativeUsageEvent(
        scopedEvents,
        findLastModelUsageEventIndex(scopedEvents),
      ),
    )
    return modelUsage
  }

  const streamedUsage = latestCumulativeUsageEvent(scopedEvents, -1)
  if (streamedUsage.total_tokens > 0) return streamedUsage
  return emptyRuntimeUsage()
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

function deriveObservedRoleTokens(
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
  payload: DashboardSDKMessage | undefined,
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

function aggregateCumulativeModelUsage(
  events: BeeGameEvent[],
): BeeGameRuntimeSnapshot['usage'] | null {
  const groups = new Map<string, { native: boolean; snapshots: BeeGameRuntimeSnapshot['usage'][] }>()
  for (const event of events) {
    const snapshot = getCumulativeUsageSnapshot(event)
    if (!snapshot) continue
    const key = getDashboardPayloadString(event.payload, 'nativeAccountingEpoch') || 'legacy'
    const group = groups.get(key) ?? { native: false, snapshots: [] }
    group.native ||= event.type === 'usage'
    group.snapshots.push(snapshot)
    groups.set(key, group)
  }
  if (!groups.size) return null
  const total = emptyRuntimeUsage()
  for (const group of groups.values()) {
    let latest = emptyRuntimeUsage()
    for (const snapshot of group.snapshots) {
      if (!group.native) {
        // Legacy SDK-only transports lack process identity/callback counters.
        if (hasCumulativeCounterReset(latest, snapshot)) addRuntimeUsage(total, latest)
        latest = snapshot
      } else {
        // stdout and stderr are independent streams. A late SDK result can
        // precede a newer diagnostic logically; never mistake it for a reset.
        latest = { prompt_tokens: Math.max(latest.prompt_tokens, snapshot.prompt_tokens),
          completion_tokens: Math.max(latest.completion_tokens, snapshot.completion_tokens),
          cache_read_tokens: Math.max(latest.cache_read_tokens, snapshot.cache_read_tokens),
          cache_creation_tokens: Math.max(latest.cache_creation_tokens, snapshot.cache_creation_tokens), total_tokens: 0 }
        latest.total_tokens = latest.prompt_tokens + latest.completion_tokens + latest.cache_read_tokens + latest.cache_creation_tokens
      }
    }
    addRuntimeUsage(total, latest)
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
  const usage =
    record.usage &&
    typeof record.usage === 'object' &&
    !Array.isArray(record.usage)
      ? (record.usage as Record<string, unknown>)
      : {}
  return {
    runtime: 'bgs',
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
    | 'project_design_locked'
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
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      behavior: 'deny',
      reason: 'project_workspace_boundary',
      message: `${request.toolName} may not access files outside the project workspace.`,
    }
  }
  // Keep instruction changes under the existing explicit permission authority,
  // even when native omits a safety reason. Ordinary project outputs retain
  // their current automatic workspace approval.
  if (writing && record.designLocked && PROJECT_DESIGN_PATHS.includes(rel))
    return { behavior: 'deny', reason: 'project_design_locked', message: 'Planning records are locked by the implementation baseline. An explicit user design change is required; finalize cannot replace the baseline.' }
  if (writing && record.managedWebBoot && MANAGED_WEB_BOOT_PATHS.includes(rel as typeof MANAGED_WEB_BOOT_PATHS[number]))
    return { behavior: 'deny', reason: 'project_managed_web_boot', message: 'BGS maintains only the startup/storage adapter modules. index.html remains editable. Implement the game in src/game.jsx; the existing implementation handoff installs the reserved files.' }
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
    id: record.nextEventId,
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
  record.nextEventId += 1
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
  message: DashboardSDKMessage,
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
      ...(typeof message.uuid === 'string' ? { messageId: message.uuid } : {}),
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
      transcript: toProjectRelativePath(workspacePath, record.transcriptPath),
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
  return resolve(workspacePath, 'logs')
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

function mapSDKMessageToEvent(
  record: SessionRecord,
  message: DashboardSDKMessage,
): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  if (getStringField(message, 'parent_tool_use_id') && message.type === 'stream_event') {
    // Preserve visible child text without altering the parent's stream state.
    // Private reasoning/signature blocks are not display text.
    return mapTextEvent('assistant.partial', extractStreamTextDelta(message))
  }
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
      return mapTextEvent(
        'assistant.partial',
        extractAssistantVisibleText(message),
      )
    case 'stream_event':
      return mapStreamEvent(record, message)
    case 'tool_progress':
      return { type: 'tool.progress', text: extractMessageText(message), payload: { ...message,
        toolUseID: getStringField(message, 'tool_use_id'), toolName: getStringField(message, 'tool_name'),
        ...(getStringField(message, 'parent_tool_use_id') ? { parentToolUseID: getStringField(message, 'parent_tool_use_id') } : {}),
      } }
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
      return (
        mapNativeTaskLifecycleEvent(message) ??
        mapTextEvent('system.status', extractMessageText(message))
      )
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
  if (!isNativeTaskLifecycle(message)) return null
  return { type: 'system.status', text: subtype, payload: message }
}

function isSDKExecutionError(message: DashboardSDKMessage): boolean {
  return (
    message.type === 'result' && getBooleanField(message, 'is_error') === true
  )
}

export function getSDKExecutionErrorDetail(
  message: DashboardSDKMessage,
): string {
  const errors = Array.isArray(message.errors)
    ? message.errors.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
    : []
  if (errors[0]) return errors[0].trim()
  if (typeof message.result === 'string' && message.result.trim()) {
    return message.result.trim()
  }
  return (
    extractMessageText(message).trim() ||
    'Model runtime returned an execution error.'
  )
}

function mapTextEvent(
  type: BeeGameEventType,
  text: string,
): { type: BeeGameEventType; text: string } | null {
  const normalized = text.trim()
  if (
    (type === 'assistant.partial' ||
      type === 'assistant.message' ||
      type === 'result') &&
    isThinkingProtocolControlText(normalized)
  ) {
    return null
  }
  return normalized ? { type, text: normalized } : null
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

function mapStreamEvent(
  record: SessionRecord,
  message: DashboardSDKMessage,
): {
  type: BeeGameEventType
  text: string
  payload?: DashboardSDKMessage
} | null {
  const streamMessageId = extractStreamMessageId(message)
  if (streamMessageId) {
    record.activeAssistantMessageId = streamMessageId
    record.activeAssistantTextBlockIndex = undefined
  }
  const event = getObjectField(message, 'event') ?? message
  if (event.type === 'content_block_start' && getObjectField(event, 'content_block')?.type === 'text')
    record.activeAssistantTextBlockIndex = getNumberField(event, 'index')
  if (event.type === 'content_block_delta' && getObjectField(event, 'delta')?.type === 'text_delta')
    record.activeAssistantTextBlockIndex = getNumberField(event, 'index') ?? record.activeAssistantTextBlockIndex

  const textDelta = extractStreamTextDelta(message)
  if (textDelta) return { type: 'assistant.partial', text: textDelta }

  const thinking = extractStreamThinkingStatus(record, message)
  if (!thinking) return null
  const thinkingText = extractStreamThinkingDelta(message)
  if (thinking.status === 'streaming' && !thinkingText) return null
  return {
    type: 'assistant.thinking',
    text: thinkingText || 'Thinking',
    payload: {
      type: 'assistant.thinking',
      status: thinking.status,
      ...(thinking.blockId ? { thinkingBlockId: thinking.blockId } : {}),
    },
  }
}

function mapSDKMessageToToolEvents(
  record: SessionRecord,
  message: DashboardSDKMessage,
): Array<{
  type: BeeGameEventType
  text: string
  payload: DashboardSDKMessage
}> {
  // Stream fragments are presentation-only and may contain a tool block before
  // its JSON input is complete. BeeGame Studio emits the authoritative tool_use
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
      const nativeResult =
        toolName === 'Agent'
          ? extractNativeAgentResult(block.content)
          : undefined
      const nativeTaskResult =
        toolName === 'TaskOutput'
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
  )
    return undefined
  const result =
    getStringField(task, 'output').trim() ||
    getStringField(task, 'result').trim()
  return {
    taskId,
    status,
    ...(result ? { result } : {}),
  }
}

/**
 * BeeGame Studio may append Agent lifecycle/usage metadata as additional text
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

function extractContentBlocks(
  message: DashboardSDKMessage,
): Record<string, unknown>[] {
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

function mapStreamingToolInputActivity(message: DashboardSDKMessage): {
  type: 'tool.progress'
  text: string
  payload: DashboardSDKMessage
} | null {
  if (message.type !== 'stream_event') return null
  const event = getObjectField(message, 'event') ?? message
  if (getStringField(event, 'type') !== 'content_block_start') return null
  const block = getObjectField(event, 'content_block')
  if (getStringField(block, 'type') !== 'tool_use') return null
  const toolUseId = getStringField(block, 'id')
  const toolName = getStringField(block, 'name')
  if (!toolUseId || !toolName) return null
  return {
    type: 'tool.progress',
    text: `${toolName} input streaming`,
    payload: {
      type: 'tool_progress',
      toolUseID: toolUseId,
      toolName,
      phase: 'input_streaming',
      ...(getStringField(message, 'parent_tool_use_id')
        ? { parentToolUseID: getStringField(message, 'parent_tool_use_id') } : {}),
    },
  }
}

function extractStreamThinkingStatus(
  record: SessionRecord,
  message: DashboardSDKMessage,
): { status: 'started' | 'streaming' | 'ended'; blockId?: string } | null {
  const event = getObjectField(message, 'event') ?? message
  const eventType = getStringField(event, 'type')
  if (eventType === 'content_block_start') {
    const contentBlock = getObjectField(event, 'content_block')
    const blockType = getStringField(contentBlock, 'type')
    if (blockType !== 'thinking' && blockType !== 'redacted_thinking')
      return null
    const index = getNumberField(event, 'index')
    if (index !== undefined) record.thinkingBlockIndexes.add(index)
    return { status: 'streaming' }
  }
  if (eventType === 'content_block_stop') {
    const index = getNumberField(event, 'index')
    if (index === undefined || !record.thinkingBlockIndexes.has(index))
      return null
    record.thinkingBlockIndexes.delete(index)
    const blockId = record.visibleThinkingBlockIds.get(index)
    if (!blockId) return null
    record.visibleThinkingBlockIds.delete(index)
    return { status: 'ended', blockId }
  }
  if (eventType !== 'content_block_delta') return null

  const delta = getObjectField(event, 'delta')
  const deltaType = getStringField(delta, 'type')
  if (
    deltaType !== 'thinking_delta' &&
    deltaType !== 'redacted_thinking_delta'
  ) {
    return null
  }
  const index = getNumberField(event, 'index')
  if (index === undefined || !record.thinkingBlockIndexes.has(index))
    return { status: 'streaming' }
  const existingBlockId = record.visibleThinkingBlockIds.get(index)
  if (existingBlockId) return { status: 'streaming', blockId: existingBlockId }
  const blockId = `${record.activeAssistantMessageId ?? 'stream'}:${index}`
  record.visibleThinkingBlockIds.set(index, blockId)
  return { status: 'started', blockId }
}

function extractStreamThinkingDelta(message: DashboardSDKMessage): string {
  const event = getObjectField(message, 'event') ?? message
  if (getStringField(event, 'type') !== 'content_block_delta') return ''
  const delta = getObjectField(event, 'delta')
  const deltaType = getStringField(delta, 'type')
  if (
    deltaType !== 'thinking_delta' &&
    deltaType !== 'redacted_thinking_delta'
  )
    return ''
  return (
    getStringField(delta, 'thinking') ||
    getStringField(delta, 'text') ||
    getStringField(delta, 'data')
  )
}

function extractStreamMessageId(
  message: DashboardSDKMessage,
): string | undefined {
  const event = getObjectField(message, 'event') ?? message
  if (getStringField(event, 'type') !== 'message_start') return undefined
  return getStringField(getObjectField(event, 'message'), 'id') || undefined
}

function getSDKAssistantMessageId(
  message: DashboardSDKMessage,
): string | undefined {
  if (message.type !== 'assistant') return undefined
  return getStringField(getObjectField(message, 'message'), 'id') || undefined
}

function nativeAssistantBlockId(record: SessionRecord, messageId?: string | null): string | undefined {
  return messageId && record.activeAssistantTextBlockIndex !== undefined
    ? `${record.session.id}:${messageId}:text:${record.activeAssistantTextBlockIndex}` : undefined
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

function buildRuntimeLaunchContract(
  selectedEnvironment: Record<string, string>,
  forwardedEnvironment: Record<string, string>,
): RuntimeLaunchContract {
  const endpoint =
    forwardedEnvironment.OPENAI_BASE_URL ||
    ''
  return {
    selectedEnvironmentKeys: Object.keys(selectedEnvironment).sort(),
    forwardedEnvironmentKeys: Object.keys(forwardedEnvironment).sort(),
    endpointClass: classifyRuntimeEndpoint(endpoint),
    configDirectoryConfigured: Boolean(forwardedEnvironment.BEEGAME_CONFIG_DIR),
    credentialConfigured: Boolean(
      forwardedEnvironment.OPENAI_API_KEY || forwardedEnvironment.OPENAI_AUTH_MODE === 'chatgpt',
    ),
  }
}

function classifyRuntimeEndpoint(
  endpoint: string,
): RuntimeLaunchContract['endpointClass'] {
  if (!endpoint) return 'default'
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase()
    return [
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'api.x.ai',
    ].includes(hostname)
      ? 'first_party'
      : 'custom'
  } catch {
    return 'custom'
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
