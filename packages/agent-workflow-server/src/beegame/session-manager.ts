import { createHash, randomUUID } from 'node:crypto'
import {
  readCanonicalProjectArtifactConsistently,
  type ProjectArtifactIdentity,
} from './project-artifact-store'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'
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
import { createNativeCliProcessRunner } from './native-cli-process-runner'
import { isSupabaseRuntimeEnvAuthError } from '../supabase-runtime-env-client'
import type { BeeGameNativeTaskNotification } from './native-task-notification'
import { createRunStore } from './delivery-workflow/run-store'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
} from './delivery-workflow/types'
import { sanitizeWorkflowDisplayMessage } from './delivery-workflow/workflow-display-message'
import { createStageChatProjector } from './stage-chat-events'

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

const WORKFLOW_WORKER_CHAT_EVENTS = new Set<BeeGameEventType>([
  'assistant.message',
  'assistant.partial',
  'assistant.thinking',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'tool.progress',
])

export type BeeGameEventSubscriber = (event: BeeGameEvent) => void

type ProjectEventSubscription = {
  userId: string
  projectId: string
  workspacePath: string
  subscriber: BeeGameEventSubscriber
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
  /** UUID owned and emitted by the native runtime; never a BGS routing ID. */
  nativeSessionId?: string
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
    otherSubagents: number
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
  /** Records the UUID emitted by the native runtime for durable resume. */
  onNativeSessionId?(sessionId: string): void
  cwd: string
  env: Record<string, string>
  /** Sanitized evidence of the selected versus forwarded launch settings. */
  runtimeLaunchContract?: RuntimeLaunchContract
  /** Workflow identity is propagated into the native permission boundary. */
  workflowWorker?: boolean
  workflowWorkerType?: string
  workflowDispatchId?: string
  workflowAllowedPaths?: string[]
  workflowAllowedTools?: string[]
  workflowProjectReadScope?: 'empty' | 'allowed'
  workflowProtectedPaths?: string[]
  workflowReadOnlyPaths?: string[]
  language?: BeeGameSessionLanguage
  /** Native background tasks may outlive the foreground turn that spawned them. */
  onNativeTaskNotification?(notification: BeeGameNativeTaskNotification): void
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
  'BEEGAME_CONFIG_DIR',
  'BEEGAME_MODEL_TYPE',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_DEFAULT_HAIKU_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GEMINI',
  'GEMINI_BASE_URL',
  'GEMINI_API_KEY',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_GROK',
  'GROK_BASE_URL',
  'GROK_API_KEY',
  'GROK_DEFAULT_HAIKU_MODEL',
  'GROK_DEFAULT_SONNET_MODEL',
  'GROK_DEFAULT_OPUS_MODEL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'CLAUDE_CODE_PROXY_RESOLVES_HOSTS',
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'ANTHROPIC_UNIX_SOCKET',
])

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
  permissionSuggestions?: Record<string, unknown>[]
}

export type DashboardPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  /** Ephemeral approval scope. Never persisted across isolated sessions. */
  scope?: 'once' | 'session'
  updatedPermissions?: Record<string, unknown>[]
}

type PendingPermission = DashboardPermissionRequest & {
  requestedAt: Date
  resolve(decision: DashboardPermissionDecision): void
}

export type BeeGamePendingPermission = DashboardPermissionRequest & {
  sessionId: string
  projectId?: string
  workflowWorker?: boolean
  workflowRunId?: string
  workflowDispatchId?: string
  requestedAt: Date
}

type SessionRecord = {
  session: BeeGameSession
  /** Native runtime UUID, distinct from session.id (the BGS routing key). */
  nativeSessionId?: string
  /** Workflow workers have isolated transcripts and may share a workspace lease with the chat surface. */
  workflowWorker?: boolean
  workflowRunId?: string
  workflowDispatchId?: string
  workflowWorkerType?: string
  workflowAllowedPaths?: string[]
  workflowAllowedTools?: string[]
  workflowProjectReadScope?: 'empty' | 'allowed'
  workflowProtectedPaths?: string[]
  workflowReadOnlyPaths?: string[]
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
  abortController: AbortController | null
  pendingPermissions: Map<string, PendingPermission>
  toolUses: Map<string, { toolName: string; input?: unknown }>
  /** Tool-use blocks observed before their streamed JSON input is complete. */
  assistantPartialTextByMessage: Map<string, string>
  activeAssistantMessageId: string | null
  emittedAssistantMessageIds: Set<string>
  thinkingBlockIndexes: Set<number>
  visibleThinkingBlockIds: Map<number, string>
  /** Start time for each visible thinking block, used when its end event arrives. */
  thinkingBlockStartedAt: Map<string, string>
  /** Prevents one durable progress write for every streamed prose fragment. */
  documentAuthorWritingReported: boolean
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  /** Provider-cumulative usage captured before the active turn starts. */
  currentTurnStartingUsage?: BeeGameRuntimeSnapshot['usage']
  /** Usage already committed to the durable workflow run ledger. */
  workflowUsageCommitted: BeeGameRuntimeSnapshot['usage']
  /** Serializes workflow usage writes without blocking the SDK callback. */
  workflowUsageWriteTail: Promise<void>
  workflowUsageWriteError?: Error
  /** The complete active model turn, including final event/usage callbacks. */
  activeTurn?: Promise<void>
  /** Serializes usage billing events without blocking the SDK callback. */
  usageWriteTail: Promise<void>
  usageLastCommittedKey?: string
  usageFailureReported: boolean
  resumeEventPending: boolean
}

function workflowDocumentFromToolEvent(
  record: SessionRecord,
  event: BeeGameEvent,
): string | undefined {
  if (event.type !== 'tool.started' && event.type !== 'tool.completed')
    return undefined
  const payload = event.payload
  const input = payload?.input
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return undefined
  const filePath = (input as Record<string, unknown>).file_path
  if (typeof filePath !== 'string' || !filePath.trim()) return undefined
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : join(record.session.cwd, filePath)
  const relativePath = relative(record.session.cwd, resolve(absolutePath))
    .split('\\')
    .join('/')
  return [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST].includes(
    relativePath as
      | (typeof CANONICAL_PROJECT_DOCUMENTS)[number]
      | typeof CANONICAL_ASSET_MANIFEST,
  )
    ? relativePath
    : undefined
}

function documentAuthorActivityMessage(
  record: SessionRecord,
  event: BeeGameEvent,
): string | undefined {
  if (record.workflowWorkerType !== 'document-author') return undefined
  const traditional = record.language === 'zh-TW'
  const chinese = record.language === 'zh' || traditional
  if (
    event.type === 'assistant.thinking' &&
    event.payload?.status === 'started'
  )
    return chinese
      ? traditional
        ? '正在推理目前文件…'
        : '正在推理当前文档…'
      : 'Reasoning about the current document…'
  if (
    event.type === 'assistant.thinking' &&
    event.payload?.status === 'ended'
  )
    return chinese
      ? traditional
        ? '正在撰寫目前文件…'
        : '正在撰写当前文档…'
      : 'Writing the current document…'
  if (
    event.type === 'assistant.partial' &&
    event.text.trim() &&
    !record.documentAuthorWritingReported
  ) {
    record.documentAuthorWritingReported = true
    return chinese
      ? traditional
        ? '正在撰寫目前文件…'
        : '正在撰写当前文档…'
      : 'Writing the current document…'
  }
  if (
    event.type !== 'tool.progress' ||
    event.payload?.phase !== 'input_streaming'
  )
    return undefined
  const toolName = getDashboardPayloadString(event.payload, 'toolName')
  if (toolName !== 'Write' && toolName !== 'Edit') return undefined
  if (toolName === 'Write')
    return chinese
      ? traditional
        ? '正在準備文件寫入…'
        : '正在准备文档写入…'
      : 'Preparing the document write…'
  return chinese
    ? traditional
      ? '正在準備文件修改…'
      : '正在准备文档修改…'
    : 'Preparing the document edit…'
}

function isResourceProductionWorker(workerType?: string): boolean {
  return workerType === 'resource-planner'
}

export type StartBeeGameSessionInput = {
  workspacePath: string
  projectId?: string
  modelConfigId?: string
  transcriptSessionId?: string
  userId: string
  authToken?: string
  getValidAuthToken?: (options?: {
    forceRefresh?: boolean
  }) => Promise<string | undefined> | string | undefined
  userDataRoot?: string
  language?: BeeGameSessionLanguage
  workflowWorker?: boolean
  workflowRunId?: string
  workflowDispatchId?: string
  workflowWorkerType?: string
  workflowAllowedPaths?: string[]
  workflowAllowedTools?: string[]
  workflowProjectReadScope?: 'empty' | 'allowed'
  workflowProtectedPaths?: string[]
  workflowReadOnlyPaths?: string[]
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

export type BeeGameSessionUsageBillingBackend = {
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
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly eventSubscribers = new Map<
    string,
    Set<BeeGameEventSubscriber>
  >()
  private readonly projectEventSubscribers = new Set<ProjectEventSubscription>()
  private readonly dashboardDataRoot: string
  private readonly stageChatFollowers = new Map<string, {
    timer: ReturnType<typeof setInterval>
    syncing: boolean
    files: Map<string, {
      offset: number
      remainder: string
      decoder: StringDecoder
      projector: ReturnType<typeof createStageChatProjector>
    }>
  }>()

  constructor(
    private readonly runner: BeeGameSessionRunner = createNativeCliProcessRunner(),
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
  }

  start(input: StartBeeGameSessionInput): BeeGameSession {
    if (
      'workflowMarkdownStreamContract' in input ||
      'workflowRevisionContract' in input ||
      'workflowRevisionMarkdownStreamContract' in input ||
      input.workflowWorkerType === 'foundation-document-reviser'
    )
      throw new Error('Legacy document revision and Markdown sessions are retired')
    if (!isAbsolute(input.workspacePath)) {
      throw new Error('Workspace path must be absolute')
    }
    const cwd = resolve(input.workspacePath)
    const existingLease = [...this.sessions.values()].find(
      record =>
        record.session.cwd === cwd &&
        record.session.status === 'running' &&
        !input.workflowWorker &&
        !record.workflowWorker,
    )
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
    const sessionId =
      input.transcriptSessionId || `beegame_${randomUUID().replaceAll('-', '')}`
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
      ...(persistedRuntime?.nativeSessionId &&
      resolveExistingPath(persistedRuntime.workspacePath) ===
        resolveExistingPath(cwd)
        ? { nativeSessionId: persistedRuntime.nativeSessionId }
        : {}),
      ...(input.workflowWorker ? { workflowWorker: true } : {}),
      ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      ...(input.workflowDispatchId
        ? { workflowDispatchId: input.workflowDispatchId }
        : {}),
      ...(input.workflowWorkerType
        ? { workflowWorkerType: input.workflowWorkerType }
        : {}),
      ...(input.workflowAllowedPaths
        ? { workflowAllowedPaths: [...input.workflowAllowedPaths] }
        : {}),
      ...(input.workflowAllowedTools
        ? { workflowAllowedTools: [...input.workflowAllowedTools] }
        : {}),
      ...(input.workflowProjectReadScope
        ? { workflowProjectReadScope: input.workflowProjectReadScope }
        : {}),
      ...(input.workflowProtectedPaths
        ? { workflowProtectedPaths: [...input.workflowProtectedPaths] }
        : {}),
      ...(input.workflowReadOnlyPaths
        ? { workflowReadOnlyPaths: [...input.workflowReadOnlyPaths] }
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
      toolUses: new Map(),
      assistantPartialTextByMessage: new Map(),
      activeAssistantMessageId: null,
      emittedAssistantMessageIds: new Set(),
      thinkingBlockIndexes: new Set(),
      visibleThinkingBlockIds: new Map(),
      thinkingBlockStartedAt: new Map(),
      documentAuthorWritingReported: false,
      events: recoveredTranscript?.events ?? [],
      nextEventId: recoveredTranscript
        ? getNextTranscriptEventId(recoveredTranscript.events)
        : 1,
      nextTurnIndex: recoveredTranscript
        ? getNextTurnIndex(session.id, recoveredTranscript.events)
        : 1,
      currentTurnId: null,
      workflowUsageCommitted: emptyRuntimeUsage(),
      workflowUsageWriteTail: Promise.resolve(),
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

  list(
    userId?: string,
    options?: { includeWorkflowWorkers?: boolean },
  ): BeeGameSession[] {
    return [...this.sessions.values()]
      .filter(record => !userId || record.userId === userId)
      .filter(
        record =>
          options?.includeWorkflowWorkers === true || !record.workflowWorker,
      )
      .map(record => cloneSession(record.session))
  }

  isWorkflowWorker(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.workflowWorker === true
  }

  isWorkflowWorkerOpen(dispatchId: string): boolean {
    return [...this.sessions.values()].some(
      record =>
        record.workflowWorker === true &&
        record.workflowDispatchId === dispatchId &&
        record.session.status === 'running',
    )
  }

  /** Dispose the one transport owned by a durable dispatch identity. */
  async disposeWorkflowDispatch(workflowDispatchId: string): Promise<number> {
    const sessionIds = [...this.sessions.values()]
      .filter(
        record =>
          record.workflowWorker === true &&
          record.workflowDispatchId === workflowDispatchId,
      )
      .map(record => record.session.id)
    for (const sessionId of sessionIds)
      await this.disposeWorkflowWorker(sessionId)
    return sessionIds.length
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
          ...(record.workflowWorker ? { workflowWorker: true } : {}),
          ...(record.workflowRunId
            ? { workflowRunId: record.workflowRunId }
            : {}),
          ...(record.workflowDispatchId
            ? { workflowDispatchId: record.workflowDispatchId }
            : {}),
        })
      }
    }
    return pending.sort(
      (left, right) => left.requestedAt.getTime() - right.requestedAt.getTime(),
    )
  }

  resolveProjectPermission(
    userId: string,
    projectId: string,
    workspacePath: string,
    toolUseID: string,
    decision: DashboardPermissionDecision & { remember?: boolean },
  ): { resolved: boolean; sessionId?: string } {
    const root = resolve(workspacePath)
    const candidates = [...this.sessions.values()].filter(
      record =>
        record.userId === userId &&
        record.projectId === projectId &&
        resolve(record.session.cwd) === root &&
        record.pendingPermissions.has(toolUseID),
    )
    if (candidates.length !== 1) return { resolved: false }
    const record = candidates[0]
    return {
      ...this.resolvePermission(record.session.id, toolUseID, decision),
      sessionId: record.session.id,
    }
  }

  workflowUsage(workflowRunId: string): BeeGameRuntimeSnapshot['usage'] {
    const total = emptyRuntimeUsage()
    for (const record of this.sessions.values()) {
      if (!record.workflowWorker || record.workflowRunId !== workflowRunId)
        continue
      // The durable run already contains every delta whose write completed.
      // Expose only the uncommitted live delta so the API can add it without
      // double-counting active workers.
      addRuntimeUsage(
        total,
        subtractRuntimeUsage(
          this.deriveRuntimeSnapshot(record).usage,
          record.workflowUsageCommitted,
        ),
      )
    }
    return total
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
      .filter(
        event => event.id > after && !isThinkingProtocolControlEvent(event),
      )
      .map(event => formatBeeGameEventForDisplay(event, record.language))
  }

  appendProjectChatEvent(input: {
    userId: string
    projectId: string
    workspacePath: string
    type: BeeGameEventType
    text: string
    turnId?: string
    payload?: DashboardSDKMessage
  }): boolean {
    const workspacePath = resolve(input.workspacePath)
    const record = [...this.sessions.values()]
      .filter(candidate =>
        !candidate.workflowWorker &&
        candidate.userId === input.userId &&
        candidate.projectId === input.projectId &&
        resolve(candidate.session.cwd) === workspacePath)
      .sort((left, right) =>
        right.session.updatedAt.getTime() - left.session.updatedAt.getTime())[0]
    if (!record) return false
    const nativeKey = getDashboardPayloadString(input.payload, 'workflowStageNativeKey')
    if (nativeKey && record.events.some(event =>
      getDashboardPayloadString(event.payload, 'workflowStageNativeKey') === nativeKey)) return false
    this.append(record, input.type, input.text, input.payload, input.turnId)
    return true
  }

  followWorkflowStageChat(input: {
    userId: string
    projectId: string
    workspacePath: string
  }): void {
    const workspacePath = resolve(input.workspacePath)
    const key = `${input.userId}:${input.projectId}:${workspacePath}`
    if (this.stageChatFollowers.has(key)) return
    const follower = {
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      syncing: false,
      files: new Map<string, {
        offset: number
        remainder: string
        decoder: StringDecoder
        contentLengths: Map<string, number>
        projector: ReturnType<typeof createStageChatProjector>
      }>(),
    }
    const sync = async () => {
      if (follower.syncing) return
      follower.syncing = true
      try {
        for (const logPath of await listStageNativeEventLogs(join(workspacePath, '.beegame', 'workflow'))) {
          const stage = stageFromNativeLogPath(logPath)
          if (!stage) continue
          let file = follower.files.get(logPath)
          if (!file) {
            file = {
              offset: 0,
              remainder: '',
              decoder: new StringDecoder('utf8'),
              contentLengths: new Map(),
              projector: createStageChatProjector({ stage, sink: event => {
                this.appendProjectChatEvent({ ...input, workspacePath, type: event.type,
                  text: event.text, ...(event.turnId ? { turnId: event.turnId } : {}),
                  ...(event.payload ? { payload: event.payload } : {}) })
              } }),
            }
            follower.files.set(logPath, file)
          }
          const size = (await stat(logPath)).size
          if (size < file.offset) {
            file.offset = 0
            file.remainder = ''
            file.decoder = new StringDecoder('utf8')
            file.contentLengths.clear()
          }
          if (size === file.offset) continue
          const handle = await open(logPath, 'r')
          try {
            const bytes = Buffer.alloc(size - file.offset)
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, file.offset)
            file.offset += bytesRead
            const lines = (file.remainder + file.decoder.write(bytes.subarray(0, bytesRead))).split('\n')
            file.remainder = lines.pop() ?? ''
            for (const line of lines) {
              if (!line) continue
              try {
                const entry = JSON.parse(line) as { event?: unknown; data?: unknown }
                const message = stageChatMessageFromTrace(entry, file.contentLengths)
                if (message) await file.projector(message)
              } catch {
                // Runtime diagnostics remain best-effort observability.
              }
            }
          } finally { await handle.close() }
        }
      } catch (error) {
        console.warn('[BeeGame] Failed to follow workflow Chat output', {
          workspacePath,
          cause: error instanceof Error ? error.message : String(error),
        })
      } finally { follower.syncing = false }
    }
    follower.timer = setInterval(() => { void sync() }, 750)
    follower.timer.unref?.()
    this.stageChatFollowers.set(key, follower)
    void sync()
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
      taskType?: string
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
      const nextTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
      record.assistantPartialTextByMessage.clear()
      record.activeAssistantMessageId = null
      record.emittedAssistantMessageIds.clear()
      record.thinkingBlockIndexes.clear()
      record.visibleThinkingBlockIds.clear()
      record.thinkingBlockStartedAt.clear()
      record.documentAuthorWritingReported = false
      record.currentTurnStartingUsage = this.deriveRuntimeSnapshot(record).usage
      record.currentTurnId = nextTurnId
      record.nextTurnIndex += 1
      display?.onTurnAccepted?.()
      turnAccepted = true
      record.abortController = new AbortController()
      this.append(record, 'turn.started', text)
      this.append(record, 'user.message', text, {
        type: 'user.message',
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
      })

      let activeTurn!: Promise<void>
      activeTurn = this.runDirectTurn(
        record,
        preparedPrompt.prompt,
        preparedPrompt.attachmentDirectory,
      ).finally(() => {
        if (record.activeTurn === activeTurn) record.activeTurn = undefined
      })
      record.activeTurn = activeTurn
      void activeTurn.catch(() => undefined)
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
    this.eventSubscribers.delete(sessionId)
    return { deleted: true, deletedArtifactPaths }
  }

  /**
   * Workflow workers are disposable transport sessions. Their durable
   * progress lives in .beegame/workflow, so remove the private transcript and
   * runtime snapshot when the worker reaches a terminal state.
   */
  async disposeWorkflowWorker(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.workflowWorker) return
    if (record.session.status === 'running') this.stop(sessionId)
    await this.waitForWorkflowWorkerIdle(sessionId)
    await rm(record.transcriptPath, { force: true })
    await rm(
      getRuntimeSnapshotPath(this.dashboardDataRoot, record.session.id),
      { force: true },
    )
    this.sessions.delete(sessionId)
    this.eventSubscribers.delete(sessionId)
  }

  async flushWorkflowUsage(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.workflowWorker) return
    await record.workflowUsageWriteTail
    if (record.workflowUsageWriteError) {
      throw record.workflowUsageWriteError
    }
  }

  async rebindWorkflowWorker(
    sessionId: string,
    binding: { runId: string; dispatchId: string; workerType: string },
  ): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.workflowWorker)
      throw new Error('workflow worker session is unavailable')
    await this.waitForWorkflowWorkerIdle(sessionId)
    record.workflowRunId = binding.runId
    record.workflowDispatchId = binding.dispatchId
    record.workflowWorkerType = binding.workerType
    this.persistRuntimeSnapshot(record)
  }

  async waitForWorkflowWorkerIdle(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.workflowWorker) return
    await record.activeTurn
    await record.workflowUsageWriteTail
    await record.usageWriteTail
    if (record.workflowUsageWriteError) throw record.workflowUsageWriteError
  }

  async dispose(): Promise<void> {
    for (const follower of this.stageChatFollowers.values()) clearInterval(follower.timer)
    this.stageChatFollowers.clear()
    const workflowDrains: Promise<void>[] = []
    for (const record of this.sessions.values()) {
      // Mark the session stopped before the transport can flush any more
      // messages. Aborting a runner while leaving the record "running" lets
      // late SDK events cross a hot-reload boundary and mutate durable state.
      if (record.session.status === 'running') this.stop(record.session.id)
      else {
        record.abortController?.abort()
        disposeRunner(record.runner)
        record.runner = null
        this.resolveAllPendingPermissions(record, {
          behavior: 'deny',
          message: 'BeeGame server stopped before permission was resolved',
        })
      }
      if (record.workflowWorker) {
        workflowDrains.push(
          (async () => {
            await record.activeTurn?.catch(() => undefined)
            await record.workflowUsageWriteTail.catch(() => undefined)
            await record.usageWriteTail.catch(() => undefined)
            if (record.workflowUsageWriteError) {
              console.error('[BeeGame] Failed to flush workflow token usage', {
                runId: record.workflowRunId,
                dispatchId: record.workflowDispatchId,
                cause: record.workflowUsageWriteError.message,
              })
            }
          })(),
        )
      }
    }
    await Promise.all(workflowDrains)
    this.eventSubscribers.clear()
  }

  /**
   * Runtime feature changes apply by rebuilding only idle native runners.
   * Active BeeGame Studio turns are never interrupted or rescheduled by BeeGame.
   */
  refreshIdleRunners(): number {
    let refreshed = 0
    for (const record of this.sessions.values()) {
      if (record.session.turnStatus !== 'idle' || !record.runner) continue
      disposeRunner(record.runner)
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
    attachmentDirectory?: string,
  ): Promise<void> {
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      let selectedEnvironment = mergeRuntimeEnv(
        record.runtime,
        await this.loadAdditionalRuntimeEnv(record),
      )
      const env: Record<string, string> = {
        ...buildRuntimeEnv(selectedEnvironment),
      }
      const runner =
        record.runner ??
        (await this.runner.start({
          sessionId: record.session.id,
          deliveryEvidenceDataRoot: this.dashboardDataRoot,
          ...(record.nativeSessionId
            ? { resumeSessionId: record.nativeSessionId }
            : {}),
          onNativeSessionId: nativeSessionId => {
            record.nativeSessionId = nativeSessionId
            this.persistRuntimeSnapshot(record)
          },
          cwd: record.session.cwd,
          env,
          runtimeLaunchContract: buildRuntimeLaunchContract(
            selectedEnvironment,
            env,
          ),
          ...(record.language ? { language: record.language } : {}),
          ...(record.workflowWorker ? { workflowWorker: true } : {}),
          ...(record.workflowWorkerType
            ? { workflowWorkerType: record.workflowWorkerType }
            : {}),
          ...(record.workflowDispatchId
            ? { workflowDispatchId: record.workflowDispatchId }
            : {}),
          ...(record.workflowAllowedPaths
            ? { workflowAllowedPaths: [...record.workflowAllowedPaths] }
            : {}),
          ...(record.workflowAllowedTools
            ? { workflowAllowedTools: [...record.workflowAllowedTools] }
            : {}),
          ...(record.workflowProjectReadScope
            ? { workflowProjectReadScope: record.workflowProjectReadScope }
            : {}),
          ...(record.workflowProtectedPaths
            ? { workflowProtectedPaths: [...record.workflowProtectedPaths] }
            : {}),
          ...(record.workflowReadOnlyPaths
            ? { workflowReadOnlyPaths: [...record.workflowReadOnlyPaths] }
            : {}),
          requestPermission: request => this.requestPermission(record, request),
        }))
      record.runner = runner
      await this.submitToRunner(
        record,
        runner,
        prompt,
        signal,
      )
      try {
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
      } finally {
        if (signal.aborted && record.runner === runner) {
          disposeRunner(record.runner)
          record.runner = null
        }
      }
    } catch (err) {
      disposeRunner(record.runner)
      record.runner = null
      if (record.session.status === 'running') {
        this.closeOpenThinkingLifecycle(record, 'turn_failed')
        this.append(
          record,
          'turn.failed',
          formatRuntimeErrorForDisplay(toErrorMessage(err), record.language),
        )
      }
    } finally {
      const terminalTurnId = record.currentTurnId
      if (terminalTurnId) {
        await this.recordTerminalUsage(record, terminalTurnId)
      }
      if (record.session.status === 'running') {
        record.session.turnStatus = 'idle'
      }
      if (attachmentDirectory) {
        await rm(attachmentDirectory, { recursive: true, force: true })
      }
      record.currentTurnId = null
      record.currentTurnStartingUsage = undefined
      record.assistantPartialTextByMessage.clear()
      record.activeAssistantMessageId = null
      record.emittedAssistantMessageIds.clear()
      record.thinkingBlockIndexes.clear()
      record.visibleThinkingBlockIds.clear()
      record.thinkingBlockStartedAt.clear()
      record.documentAuthorWritingReported = false
      record.abortController = null
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
    let executionError: Error | undefined
    await runner.submit({
      prompt,
      ...(record.confirmedBriefContext
        ? { confirmedBriefContext: record.confirmedBriefContext }
        : {}),
      signal,
      onMessage: message => {
        appendProjectAgentDiagnostic(record, message)
        if (isSDKExecutionError(message)) {
          executionError = new Error(getSDKExecutionErrorDetail(message))
        }
        // Timed-out runtimes can flush synthetic messages after their turn closed.
        // Preserve raw diagnostics without leaking them into chat or a later turn.
        if (
          !submittedTurnId ||
          record.currentTurnId !== submittedTurnId ||
          hasTurnEnded(record.events, submittedTurnId)
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
        if (mapped) {
          if (mapped.type !== 'assistant.thinking')
            this.closeOpenThinkingLifecycle(record, 'visible_output_started')
          if (mapped.type === 'assistant.partial') {
            this.append(record, mapped.type, mapped.text, message)
            this.appendAssistantPartialText(record, message)
          } else if (mapped.type === 'assistant.message') {
            const reconciled = this.reconcileAssistantText(
              record,
              message,
              mapped.text,
            )
            if (reconciled)
              this.append(record, mapped.type, reconciled, message)
          } else {
            this.append(
              record,
              mapped.type,
              mapped.text,
              mapped.payload ?? message,
            )
          }
        }
        for (const toolEvent of mapSDKMessageToToolEvents(record, message)) {
          if (toolEvent.type === 'tool.started')
            this.closeOpenThinkingLifecycle(record, 'tool_started')
          this.append(record, toolEvent.type, toolEvent.text, toolEvent.payload)
        }
      },
      requestPermission: request => this.requestPermission(record, request),
    })
    if (executionError) throw executionError
  }

  private async recordTerminalUsage(
    record: SessionRecord,
    turnId: string,
  ): Promise<void> {
    if (!this.usageBillingBackend.recordUsage) return
    const providerCumulativeUsage = this.deriveRuntimeSnapshot(record).usage
    const turnDeltaUsage = subtractRuntimeUsage(
      providerCumulativeUsage,
      record.currentTurnStartingUsage ?? emptyRuntimeUsage(),
    )
    if (turnDeltaUsage.total_tokens <= 0) return
    const terminalEvent = [...record.events]
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
        type: terminalEvent?.type ?? 'turn_terminal',
        text: terminalEvent?.text ?? '',
        turnDeltaUsage,
      }))
      .digest('hex')
    const billingAuthority = record.workflowRunId && record.workflowDispatchId
      ? `${record.workflowRunId}:${record.workflowDispatchId}`
      : `${record.session.id}:${turnId}`
    const idempotencyKey = `usage-terminal:${billingAuthority}:${terminalDigest}`
    if (idempotencyKey === record.usageLastCommittedKey) return
    const write = {
      turnId,
      sourceMessageType: terminalEvent?.type ?? 'turn_terminal',
      usage: turnDeltaUsage,
      idempotencyKey,
      metadata: {
        providerCumulativeUsage,
        turnDeltaUsage,
        billableFinalUsage: turnDeltaUsage,
        terminalDigest,
      },
    }
    const previousWrite = record.usageWriteTail
    record.usageWriteTail = previousWrite.catch(() => undefined).then(async () => {
      let failure: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.writeUsageRecord(record, write)
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
        workflowWorker: Boolean(record.workflowWorker),
        ...write.metadata,
      },
      ...(record.authToken ? { authToken: record.authToken } : {}),
    }
    const result = await this.usageBillingBackend.recordUsage!(
      record.userId,
      options,
    )
    if (this.usageBillingBackend.debitRealtimeUsage) {
      const debit = await this.usageBillingBackend.debitRealtimeUsage(
        record.userId,
        options,
      )
      if (
        record.session.status === 'running' &&
        !debit.duplicate &&
        debit.event.weightedTokensDelta > 0
      ) {
        this.append(record, 'system.status', 'Realtime usage debited', {
          type: 'billing.realtime_debited',
          debitEventId: debit.event.id,
          weightedTokens: debit.event.weightedTokensDelta,
          creditsMicro: debit.event.creditsMicro,
          pricingVersion: debit.event.pricingVersion,
          idempotencyKey: write.idempotencyKey,
        })
      }
    }
    if (
      record.session.status === 'running' &&
      !result.duplicate &&
      result.event.weightedTokensDelta > 0
    ) {
      this.append(record, 'system.status', 'Usage recorded', {
        type: 'billing.usage_recorded',
        usageEventId: result.event.id,
        weightedTokens: result.event.weightedTokensDelta,
        creditsMicro: result.event.creditsMicro,
        pricingVersion: result.event.pricingVersion,
        idempotencyKey: write.idempotencyKey,
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
    const messageId =
      getSDKAssistantMessageId(message) ?? record.activeAssistantMessageId
    if (messageId && record.emittedAssistantMessageIds.has(messageId))
      return null

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
    const toolRestriction = workflowToolRestriction(record, request)
    if (toolRestriction) {
      this.append(record, 'permission.resolved', `${request.toolName}: deny`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'deny',
        scope: 'once',
        autoDenied: true,
        reason: 'workflow_tool_not_allowed',
      })
      return Promise.resolve({ behavior: 'deny', scope: 'once', message: toolRestriction })
    }
    const workflowMutation = workflowFileMutationAuthority(record, request)
    if (workflowMutation) {
      this.append(
        record,
        'permission.resolved',
        `${request.toolName}: ${workflowMutation.behavior}`,
        {
          type: 'permission.resolved',
          toolUseID: request.toolUseID,
          toolName: request.toolName,
          decision: workflowMutation.behavior,
          scope: 'once',
          autoApproved: workflowMutation.behavior === 'allow',
          autoDenied: workflowMutation.behavior === 'deny',
          reason: workflowMutation.reason,
        },
      )
      return Promise.resolve({
        behavior: workflowMutation.behavior,
        scope: 'once',
        ...(workflowMutation.message
          ? { message: workflowMutation.message }
          : {}),
      })
    }
    if (authorizeProjectWorkspaceFileMutation(record, request)) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        scope: 'once',
        autoApproved: true,
        reason: 'project_workspace_file_mutation',
      })
      return Promise.resolve({ behavior: 'allow', scope: 'once' })
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
          decision: projectFileAccess.behavior,
          scope: 'once',
          autoApproved: projectFileAccess.behavior === 'allow',
          autoDenied: projectFileAccess.behavior === 'deny',
          reason: projectFileAccess.reason,
          input: request.input,
        },
      )
      return Promise.resolve({
        behavior: projectFileAccess.behavior,
        scope: 'once',
        ...(projectFileAccess.message
          ? { message: projectFileAccess.message }
          : {}),
      })
    }
    if (record.workflowWorker === true) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        scope: 'once',
        autoApproved: true,
        reason: 'workflow_worker_tool_authority',
        input: request.input,
      })
      return Promise.resolve({ behavior: 'allow', scope: 'once' })
    }
    return new Promise(resolve => {
      record.pendingPermissions.set(request.toolUseID, {
        ...request,
        requestedAt: new Date(),
        resolve,
      })
      this.append(record, 'permission.requested', request.message, {
        type: 'permission.requested',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        message: request.message,
        input: request.input,
      })
    })
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
    }
  }

  private append(
    record: SessionRecord,
    type: BeeGameEventType,
    text: string,
    payload?: DashboardSDKMessage,
    turnId?: string,
  ): BeeGameEvent {
    const workflowUsageBefore =
      record.workflowWorker && record.workflowRunId
        ? this.deriveRuntimeSnapshot(record).usage
        : undefined
    const effectiveTurnId = turnId || record.currentTurnId || undefined
    const createdAt = new Date()
    let eventPayload = payload
    if (type === 'assistant.thinking') {
      const thinkingBlockId = getDashboardPayloadString(payload, 'thinkingBlockId') || 'default'
      const thinkingKey = `${effectiveTurnId ?? record.session.id}:${thinkingBlockId}`
      const status = getDashboardPayloadString(payload, 'status')
      let thinkingStartedAt = record.thinkingBlockStartedAt.get(thinkingKey)
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
          subscription.subscriber(
            record.workflowWorker
              ? {
                  ...displayEvent,
                  payload: {
                    ...(displayEvent.payload ?? { type: displayEvent.type }),
                    workflowRunId: record.workflowRunId,
                    workflowDispatchId: record.workflowDispatchId,
                    workflowWorkerType: record.workflowWorkerType,
                    ...(workflowStageForWorkerType(record.workflowWorkerType)
                      ? { workflowStage: workflowStageForWorkerType(record.workflowWorkerType) }
                      : {}),
                  },
                }
              : displayEvent,
          )
        } catch (error) {
          console.warn('[BeeGame] Project event subscriber failed', {
            projectId: record.projectId,
            cause: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    if (
      record.workflowWorker &&
      record.projectId &&
      WORKFLOW_WORKER_CHAT_EVENTS.has(event.type)
    ) {
      const chatRecord = [...this.sessions.values()]
        .filter(
          candidate =>
            !candidate.workflowWorker &&
            candidate.userId === record.userId &&
            candidate.projectId === record.projectId &&
            resolve(candidate.session.cwd) === resolve(record.session.cwd),
        )
        .sort(
          (left, right) =>
            right.session.updatedAt.getTime() - left.session.updatedAt.getTime(),
        )[0]
      if (chatRecord) {
        this.append(chatRecord, event.type, event.text, {
          ...(event.payload ?? { type: event.type }),
          workflowRunId: record.workflowRunId,
          workflowDispatchId: record.workflowDispatchId,
          workflowWorkerType: record.workflowWorkerType,
          ...(workflowStageForWorkerType(record.workflowWorkerType)
            ? { workflowStage: workflowStageForWorkerType(record.workflowWorkerType) }
            : {}),
          workflowSourceSessionId: event.sessionId,
          workflowSourceEventId: event.id,
        })
      }
    }
    if (record.workflowWorker && record.workflowRunId) {
      // Raw tool/system labels remain telemetry. Resource preparation exposes
      // only a small structural activity vocabulary so the card can explain
      // real work without leaking tool inputs or JSON.
      const documentActivityMessage = documentAuthorActivityMessage(
        record,
        event,
      )
      const progressMessage = isResourceProductionWorker(
        record.workflowWorkerType,
      )
        ? ''
        : record.workflowWorkerType === 'document-author'
          ? (documentActivityMessage ?? '')
          : event.type === 'assistant.message'
            ? sanitizeWorkflowDisplayMessage(event.text)
            : ''
      // Initial authoring already has one durable taskId. Keep that authority
      // stable while the worker reads upstream documents instead of projecting
      // transient Read events as a different active task.
      const currentItemId =
        record.workflowWorkerType === 'document-author'
          ? undefined
          : workflowDocumentFromToolEvent(record, event)
      const clearCurrentItem =
        Boolean(currentItemId) &&
        (event.type === 'tool.completed' || event.type === 'tool.failed')
      const durableProgress = isResourceProductionWorker(
        record.workflowWorkerType,
      )
        ? isResourceWorkerDurableProgress(event)
        : record.workflowWorkerType === 'document-author'
          ? isDocumentAuthorDurableProgress(event)
          : true
      const thinking =
        event.type === 'assistant.thinking' ||
            event.type === 'tool.started' ||
            (event.type === 'tool.progress' &&
              event.payload?.phase === 'input_streaming') ||
            (record.workflowWorkerType === 'document-author' &&
              Boolean(documentActivityMessage))
          ? 'working'
          : event.type === 'turn.completed' ||
              event.type === 'turn.empty' ||
              event.type === 'turn.failed' ||
              event.type === 'result'
            ? 'idle'
            : undefined
      if (
        progressMessage ||
        thinking ||
        clearCurrentItem ||
        (isResourceProductionWorker(record.workflowWorkerType) &&
          durableProgress)
      ) {
        void createRunStore(record.session.cwd, record.userId)
          .updateProgress(record.workflowRunId, {
            ...(progressMessage ? { message: progressMessage } : {}),
            ...(thinking ? { thinking } : {}),
            ...(record.workflowWorkerType
              ? { workerType: record.workflowWorkerType }
              : {}),
            ...(record.workflowDispatchId
              ? { dispatchId: record.workflowDispatchId }
              : {}),
            ...(currentItemId ? { currentItemId } : {}),
            ...(clearCurrentItem ? { currentItemId: null } : {}),
            durable: durableProgress,
          })
          .catch(() => undefined)
      }
    }
    record.nextEventId += 1
    record.session.updatedAt = new Date()
    this.persistRuntimeSnapshot(record)
    if (record.workflowWorker && record.workflowRunId && workflowUsageBefore) {
      const workflowUsageAfter = this.deriveRuntimeSnapshot(record).usage
      const delta = subtractRuntimeUsage(
        workflowUsageAfter,
        workflowUsageBefore,
      )
      if (
        delta.total_tokens <= 0 &&
        delta.prompt_tokens <= 0 &&
        delta.completion_tokens <= 0 &&
        delta.cache_read_tokens <= 0 &&
        delta.cache_creation_tokens <= 0
      ) {
        return event
      }
      const usageDelta = {
        input_tokens: delta.prompt_tokens,
        cache_read_tokens: delta.cache_read_tokens,
        cache_creation_tokens: delta.cache_creation_tokens,
        completion_tokens: delta.completion_tokens,
        total_tokens: delta.total_tokens,
      }
      const workflowDispatchId = record.workflowDispatchId
      if (!workflowDispatchId)
        throw new Error('workflow usage event is missing its dispatch identity')
      const previousWrite = record.workflowUsageWriteTail
      const nextWrite = previousWrite
        .catch(() => undefined)
        .then(async () => {
          const persisted = await createRunStore(
            record.session.cwd,
            record.userId,
          ).addWorkflowUsage(
            record.workflowRunId as string,
            usageDelta,
            workflowDispatchId,
          )
          if (!persisted) {
            // `addWorkflowUsage` also returns null for a stale dispatch after
            // a terminal commit. Only report the strict data-loss case when
            // the authoritative run itself is gone.
            const current = await createRunStore(
              record.session.cwd,
              record.userId,
            ).load()
            if (!current)
              throw new Error(
                'workflow run disappeared before usage was persisted',
              )
            return
          }
          addRuntimeUsage(record.workflowUsageCommitted, delta)
        })
      record.workflowUsageWriteTail = nextWrite.catch(error => {
        record.workflowUsageWriteError =
          error instanceof Error ? error : new Error(String(error))
        console.error('[BeeGame] Failed to persist workflow token usage', {
          runId: record.workflowRunId,
          dispatchId: workflowDispatchId,
          cause: record.workflowUsageWriteError.message,
        })
      })
    }
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
    return deriveRuntimeSnapshotFromEvents(
      record.session.id,
      record.session.cwd,
      record.events,
      record.session.modelConfigId,
      { nativeSessionId: record.nativeSessionId },
    )
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

export function isResourceWorkerDurableProgress(event: BeeGameEvent): boolean {
  if (event.type !== 'tool.completed') return false
  const toolName = getDashboardPayloadString(event.payload, 'toolName')
  return isFileMutationTool(toolName)
}

export function isDocumentAuthorDurableProgress(event: BeeGameEvent): boolean {
  return (
    event.type === 'tool.completed' &&
    isFileMutationTool(getDashboardPayloadString(event.payload, 'toolName'))
  )
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
  const transcriptPath = await resolveReadableTranscriptPath(sessionId, cwd)
  const raw = await readFile(transcriptPath, 'utf8')
  const events = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(
      line =>
        JSON.parse(line) as {
          sessionId?: string
          id: number
          type: BeeGameEventType
          text: string
          turnId?: string
          payload?: DashboardSDKMessage
          createdAt: string
        },
    )
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

/**
 * Recover visible chat activity from a workflow worker transcript left behind
 * by an interrupted process. Normal live worker activity is mirrored into the
 * project chat; the source identity prevents this fallback from duplicating it.
 */
export async function readWorkflowWorkerChatHistoryFromDisk(
  workspacePath: string,
  mainSessionId: string,
  mainEvents: readonly BeeGameEvent[],
): Promise<BeeGameEvent[]> {
  const transcriptDir = dirname(
    getSessionTranscriptPath(mainSessionId, workspacePath),
  )
  const mirrored = new Set(
    mainEvents.flatMap(event => {
      const sourceSessionId = getDashboardPayloadString(
        event.payload,
        'workflowSourceSessionId',
      )
      const sourceEventId = event.payload?.workflowSourceEventId
      return sourceSessionId && typeof sourceEventId === 'number'
        ? [`${sourceSessionId}:${sourceEventId}`]
        : []
    }),
  )
  let fileNames: string[]
  try {
    fileNames = await readdir(transcriptDir)
  } catch {
    fileNames = []
  }

  const recovered: BeeGameEvent[] = []
  for (const fileName of fileNames.sort()) {
    if (!fileName.endsWith('.jsonl')) continue
    let events: BeeGameEvent[]
    try {
      events = parseTranscriptEvents(
        await readFile(join(transcriptDir, fileName), 'utf8'),
      )
    } catch {
      continue
    }
    const sourceSessionId = events.find(event => event.sessionId)?.sessionId
    if (!sourceSessionId || sourceSessionId === mainSessionId) continue
    const workerStart = events.find(
      event =>
        event.type === 'turn.started' &&
        event.text.includes('BeeGame delivery worker:'),
    )
    if (!workerStart) continue
    const workflowWorkerType = workerStart.text
      .match(/BeeGame delivery worker:\s*([^\s]+)/)?.[1]
    for (const event of events) {
      if (!WORKFLOW_WORKER_CHAT_EVENTS.has(event.type)) continue
      if (mirrored.has(`${event.sessionId}:${event.id}`)) continue
      recovered.push({
        ...event,
        ...(workflowWorkerType
          ? {
              payload: {
                ...(event.payload ?? { type: event.type }),
                workflowWorkerType,
                ...(workflowStageForWorkerType(workflowWorkerType)
                  ? { workflowStage: workflowStageForWorkerType(workflowWorkerType) }
                  : {}),
              },
            }
          : {}),
      })
    }
  }

  const stageNativeKeys = new Set(mainEvents.flatMap(event => {
    const key = getDashboardPayloadString(event.payload, 'workflowStageNativeKey')
    return key ? [key] : []
  }))
  const workflowRoot = join(workspacePath, '.beegame', 'workflow')
  const nativeLogs = await listStageNativeEventLogs(workflowRoot)
  for (const logPath of nativeLogs) {
    const stage = stageFromNativeLogPath(logPath)
    if (!stage) continue
    let rows: string[]
    try { rows = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean) }
    catch { continue }
    let createdAt = new Date(0)
    const contentLengths = new Map<string, number>()
    const projector = createStageChatProjector({ stage, sink: event => {
      const key = getDashboardPayloadString(event.payload, 'workflowStageNativeKey')
      if (key && stageNativeKeys.has(key)) return
      if (key) stageNativeKeys.add(key)
      recovered.push({ id: recovered.length + 1, sessionId: `workflow-stage:${stage}`,
        type: event.type, text: event.text, ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.payload ? { payload: event.payload } : {}), createdAt })
    } })
    for (const row of rows) {
      try {
        const entry = JSON.parse(row) as { at?: unknown; event?: unknown; data?: unknown }
        const message = stageChatMessageFromTrace(entry, contentLengths)
        if (!message) continue
        createdAt = typeof entry.at === 'string' ? new Date(entry.at) : new Date(0)
        await projector(message)
      } catch {
        // A damaged diagnostic line must not hide the rest of Chat history.
      }
    }
  }
  return recovered.sort((left, right) => {
    const time = left.createdAt.getTime() - right.createdAt.getTime()
    if (time !== 0) return time
    const session = left.sessionId.localeCompare(right.sessionId)
    return session !== 0 ? session : left.id - right.id
  })
}

function workflowStageForWorkerType(workerType?: string): string | undefined {
  const stages: Record<string, string> = {
    'document-author': 'author',
    'content-author': 'content',
    'foundation-reviewer': 'reviewer',
    'foundation-document-reviser': 'revision',
    'resource-planner': 'resources',
    'implementation-worker': 'implementation',
    'acceptance-validator': 'acceptance',
  }
  return workerType ? stages[workerType] : undefined
}

function stageFromNativeLogPath(path: string): 'author' | 'content' | 'reviewer' | 'revision' | undefined {
  const normalized = path.split('\\').join('/')
  if (normalized.includes('/foundation-authoring/')) return 'author'
  if (normalized.includes('/content-authoring/')) return 'content'
  if (normalized.includes('/foundation-reviewer/')) return 'reviewer'
  if (normalized.includes('/foundation-revision/')) return 'revision'
  return undefined
}

/** Converts persisted, redacted trace rows into the native shape understood by
 * the stage Chat projector. */
function stageChatMessageFromTrace(
  entry: { event?: unknown; data?: unknown },
  contentLengths = new Map<string, number>(),
): Record<string, unknown> | undefined {
  if (entry.event === 'response.message' && entry.data && typeof entry.data === 'object')
    return entry.data as Record<string, unknown>
  if (entry.event === 'response.query_end' && entry.data && typeof entry.data === 'object') {
    const data = entry.data as Record<string, unknown>
    return { type: 'thinking_end', queryId: data.queryId }
  }
  if (!entry.data || typeof entry.data !== 'object') return undefined
  const data = entry.data as Record<string, unknown>
  if (entry.event === 'response.content_snapshot') {
    // The log intentionally stores only a redacted cumulative checkpoint.
    // Derive the display delta locally, so logs remain safe and replayable.
    if (data.type !== 'text' || typeof data.content !== 'string' || !data.content) return undefined
    const key = `${data.queryId ?? 'unknown'}:${data.index ?? 0}`
    const priorLength = contentLengths.get(key) ?? 0
    const delta = data.content.length >= priorLength ? data.content.slice(priorLength) : data.content
    contentLengths.set(key, data.content.length)
    if (!delta) return undefined
    return { type: 'stream_event', queryId: data.queryId,
      ...(typeof data.queryId === 'string' && typeof data.index === 'number' && typeof data.receivedBytes === 'number'
        ? { workflowStageNativeKey: `text:${data.queryId}:${data.index}:${data.receivedBytes}` }
        : {}),
      event: { type: 'content_block_delta', index: data.index, delta: { type: 'text_delta', text: delta } } }
  }
  if (entry.event !== 'response.reasoning_snapshot' || typeof data.content !== 'string' || !data.content) return undefined
  return { type: 'stream_event',
    queryId: data.queryId,
    ...(typeof data.queryId === 'string' && typeof data.receivedBytes === 'number'
      ? { workflowStageNativeKey: `thinking:${data.queryId}:${data.receivedBytes}` }
      : {}),
    event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: data.content } } }
}

async function listStageNativeEventLogs(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(directory: string): Promise<void> {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch { return }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('native-events.jsonl')) found.push(path)
    }
  }
  await visit(root)
  return found.sort()
}

async function resolveReadableTranscriptPath(
  sessionId: string,
  cwd: string,
): Promise<string> {
  const primary = getSessionTranscriptPath(sessionId, cwd)
  await readFile(primary, 'utf8')
  return primary
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

async function prepareBeeGamePromptInput(input: {
  text: string
  workspace: string
  attachments?: BeeGameAttachment[]
  displayKind?: string
}): Promise<{ prompt: BeeGamePromptInput; attachmentDirectory?: string }> {
  const images = (input.attachments ?? []).filter(isBeeGameImageAttachment)
  const files = (input.attachments ?? []).filter(isBeeGameFileAttachment)
  const materializedFiles =
    files.length > 0
      ? await materializeBeeGameFileAttachments(input.workspace, files)
      : []
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
      prompt: promptText,
      ...(materializedFiles.length > 0
        ? { attachmentDirectory: join(input.workspace, '.beegame-attachments') }
        : {}),
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
    ...(materializedFiles.length > 0
      ? { attachmentDirectory: join(input.workspace, '.beegame-attachments') }
      : {}),
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
    return await Promise.all(
      attachments.map(async attachment => {
        const filename = basename(attachment.filename)
        const extension = filename
          .slice(filename.lastIndexOf('.'))
          .toLowerCase()
        const allowedTypes = DOCUMENT_ATTACHMENT_TYPES[extension]
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
        const storedFilename = `${randomUUID()}-${safeFilename}`
        const storedPath = join(attachmentDirectory, storedFilename)
        await writeFile(storedPath, data, { flag: 'wx' })
        return {
          relativePath: relative(workspace, storedPath),
          filename,
          mediaType: attachment.mediaType,
        }
      }),
    )
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
 * Detection is based on the JSON shape, not provider names or message phrases.
 */
export function formatRuntimeErrorForDisplay(
  value: string,
  language?: BeeGameSessionLanguage,
): string {
  const text = value.trim()
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
  return {
    sessionId,
    ...(options.nativeSessionId
      ? { nativeSessionId: options.nativeSessionId }
      : {}),
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
  if (
    events.some(
      event =>
        event.type === 'turn.started' && !hasTurnEnded(events, event.turnId),
    )
  ) {
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
  if (latest.type === 'turn.failed' || latest.type === 'session.failed')
    return 'failed'
  if (deriveSnapshotPhaseName(events, options) === 'starting') return 'starting'
  if (deriveSnapshotPhaseName(events, options) === 'running') return 'running'
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
      event.type === 'result' &&
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
      event?.type === 'result' &&
      getModelUsageFromEventPayload(event.payload)
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
  for (const event of events.slice(afterIndex + 1)) {
    if (event.type !== 'usage') continue
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
      getDashboardPayloadString(event.payload, 'subtype') !==
      'task_notification'
    )
      continue
    const taskId = getDashboardPayloadString(event.payload, 'task_id')
    const toolUseID = getDashboardPayloadString(event.payload, 'tool_use_id')
    const usage = isRuntimeRecord(event.payload.usage)
      ? event.payload.usage
      : undefined
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
    mainAgent: Math.max(0, total - otherSubagents),
    otherSubagents,
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
  const usage =
    record.usage &&
    typeof record.usage === 'object' &&
    !Array.isArray(record.usage)
      ? (record.usage as Record<string, unknown>)
      : {}
  return {
    sessionId: String(record.sessionId || ''),
    ...(typeof record.nativeSessionId === 'string' && record.nativeSessionId
      ? { nativeSessionId: record.nativeSessionId }
      : {}),
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
    mainAgent: Number(record.mainAgent ?? 0),
    otherSubagents: Number(record.otherSubagents ?? 0),
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

function createZipArchive(
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

export function workflowToolRestriction(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): string | undefined {
  const allowed = record.workflowAllowedTools
  if (!allowed || allowed.includes(request.toolName)) return undefined
  return `This workflow worker may use only: ${allowed.join(', ')}.`
}

function authorizeProjectWorkspaceFileMutation(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): boolean {
  if (!record.projectId || !isFileMutationTool(request.toolName)) return false
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath) return false
  const workspaceRoot = resolveExistingPath(record.session.cwd)
  const targetPath = resolveProspectivePath(record.session.cwd, artifactPath)
  const rel = relative(workspaceRoot, targetPath)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

type ProjectWorkspaceFileAccessAuthority = {
  behavior: 'allow' | 'deny'
  reason:
    | 'project_workspace_file_access'
    | 'project_workspace_read_scope_empty'
    | 'project_workspace_boundary'
    | 'project_workspace_target_invalid'
  message?: string
}

function projectWorkspaceFileAccessAuthority(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): ProjectWorkspaceFileAccessAuthority | undefined {
  if (!record.projectId) return undefined
  if (
    record.workflowProjectReadScope === 'empty' &&
    ['Read', 'Grep', 'Glob'].includes(request.toolName)
  )
    return {
      behavior: 'deny',
      reason: 'project_workspace_read_scope_empty',
      message: `${request.toolName} is disabled for this scoped audit worker; use the assigned packet only.`,
    }
  if (
    record.workflowWorker === true &&
    record.workflowProjectReadScope === 'allowed' &&
    ['Read', 'Grep', 'Glob'].includes(request.toolName)
  ) {
    if (request.toolName !== 'Read')
      return {
        behavior: 'deny',
        reason: 'project_workspace_read_scope_empty',
        message: 'Scoped workflow workers may use Read only on an assigned path.',
      }
    const inputPath = request.input.file_path
    if (typeof inputPath !== 'string' || !inputPath.trim())
      return {
        behavior: 'deny',
        reason: 'project_workspace_target_invalid',
        message: 'Read requires one assigned staged path.',
      }
    const workspaceRoot = resolveExistingPath(record.session.cwd)
    const targetPath = resolveProspectivePath(record.session.cwd, inputPath)
    const rel = relative(workspaceRoot, targetPath)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
      return {
        behavior: 'deny',
        reason: 'project_workspace_boundary',
        message: 'Read may not access files outside the project workspace.',
      }
    const allowed = (record.workflowAllowedPaths ?? []).some(entry => {
      const configured = entry.trim()
      return configured && targetPath === resolveProspectivePath(record.session.cwd, configured)
    })
    return allowed
      ? { behavior: 'allow', reason: 'project_workspace_file_access' }
      : {
          behavior: 'deny',
          reason: 'project_workspace_read_scope_empty',
          message: 'Scoped workflow workers may read only their assigned path.',
        }
  }
  const pathKey = request.toolName === 'Read' ? 'file_path' : 'path'
  if (!['Read', 'Grep', 'Glob'].includes(request.toolName)) return undefined
  const inputPath = request.input[pathKey]
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
  return {
    behavior: 'allow',
    reason: 'project_workspace_file_access',
  }
}

type WorkflowFileMutationAuthority = {
  behavior: 'allow' | 'deny'
  reason:
    | 'workflow_allowed_path'
    | 'workflow_protected_path'
    | 'workflow_path_not_allowed'
    | 'workflow_workspace_boundary'
    | 'workflow_mutation_target_invalid'
  message?: string
}

function workflowFileMutationAuthority(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): WorkflowFileMutationAuthority | undefined {
  if (record.workflowWorker !== true || !isFileMutationTool(request.toolName))
    return undefined
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath)
    return {
      behavior: 'deny',
      reason: 'workflow_mutation_target_invalid',
      message: 'Workflow file mutations require one explicit target path.',
    }
  const workspaceRoot = resolveExistingPath(record.session.cwd)
  const targetPath = resolveProspectivePath(record.session.cwd, artifactPath)
  const workspaceRelative = relative(workspaceRoot, targetPath)
  if (
    workspaceRelative === '' ||
    workspaceRelative.startsWith('..') ||
    isAbsolute(workspaceRelative)
  )
    return {
      behavior: 'deny',
      reason: 'workflow_workspace_boundary',
      message:
        'Workflow workers may not mutate files outside the project workspace.',
    }
  const protectedPath = (record.workflowProtectedPaths ?? []).find(entry =>
    pathMatchesConfiguredScope(record.session.cwd, targetPath, entry),
  )
  if (protectedPath)
    return {
      behavior: 'deny',
      reason: 'workflow_protected_path',
      message: `Workflow workers may not mutate protected project authority: ${protectedPath}.`,
    }
  const allowed = (record.workflowAllowedPaths ?? []).some(entry => {
    return pathMatchesConfiguredScope(record.session.cwd, targetPath, entry)
  })
  return allowed
    ? { behavior: 'allow', reason: 'workflow_allowed_path' }
    : {
        behavior: 'deny',
        reason: 'workflow_path_not_allowed',
        message: 'Workflow workers may mutate only their assigned project paths.',
      }
}

function pathMatchesConfiguredScope(
  cwd: string,
  targetPath: string,
  entry: string,
): boolean {
  const configuredPath = entry.trim()
  if (!configuredPath) return false
  const directoryScope = /[\\/]$/u.test(configuredPath)
  const scopedPath = resolveProspectivePath(cwd, configuredPath)
  if (!directoryScope) return targetPath === scopedPath
  const child = relative(scopedPath, targetPath)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

function resolveProspectivePath(cwd: string, artifactPath: string): string {
  const targetPath = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(cwd, artifactPath)
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

function hasCompletedTool(
  record: SessionRecord,
  expectedToolName: string,
): boolean {
  const started = new Set<string>()
  for (const event of record.events) {
    const toolUseID = getDashboardPayloadString(event.payload, 'toolUseID')
    if (!toolUseID) continue
    if (
      event.type === 'tool.started' &&
      getDashboardPayloadString(event.payload, 'toolName') === expectedToolName
    ) {
      started.add(toolUseID)
      continue
    }
    if (event.type === 'tool.completed' && started.has(toolUseID)) return true
  }
  return false
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

function getMutationArtifactPath(input: Record<string, unknown>): string {
  return String(
    input.file_path || input.path || input.notebook_path || '',
  ).trim()
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
  const scopedIndexPath =
    record.workflowWorker && record.workflowRunId
      ? resolve(logsDir, 'index.json')
      : getProjectLogIndexPath(workspacePath)
  const indexPaths = record.workflowWorker
    ? [scopedIndexPath, getProjectLogIndexPath(workspacePath)]
    : [scopedIndexPath]
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
  if (record.workflowWorker && record.workflowRunId) {
    return resolve(
      record.session.cwd,
      '.beegame',
      'workflow',
      'logs',
      record.workflowRunId,
    )
  }
  return getProjectLogsDir(record.session.cwd)
}

function getProjectLogIndexPath(workspacePath: string): string {
  return resolve(getProjectLogsDir(workspacePath), 'index.json')
}

function getProjectRuntimeDiagnosticPath(record: SessionRecord): string {
  if (record.workflowWorker && record.workflowRunId) {
    return resolve(
      record.session.cwd,
      '.beegame',
      'workflow',
      'logs',
      record.workflowRunId,
      record.workflowDispatchId ?? record.session.id,
      'runtime-diagnostics.jsonl',
    )
  }
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
  if (subtype !== 'task_started' && subtype !== 'task_notification') return null
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
  if (streamMessageId) record.activeAssistantMessageId = streamMessageId

  const textDelta = extractStreamTextDelta(message)
  if (textDelta.trim()) return mapTextEvent('assistant.partial', textDelta)

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
    ...additionalEnv,
    ...(runtime?.env ?? {}),
  }
  const modelType =
    runtime?.modelType ?? inferSelectedRuntimeModelType(selectedEnvironment)
  return {
    ...selectedEnvironment,
    ...(modelType ? { BEEGAME_MODEL_TYPE: modelType } : {}),
  }
}

function inferSelectedRuntimeModelType(
  environment: Record<string, string>,
): RuntimeModelConfig['modelType'] | undefined {
  const candidates = new Set<RuntimeModelConfig['modelType']>()
  if (
    environment.ANTHROPIC_BASE_URL ||
    environment.ANTHROPIC_AUTH_TOKEN ||
    environment.ANTHROPIC_DEFAULT_SONNET_MODEL
  ) {
    candidates.add('anthropic')
  }
  if (
    environment.OPENAI_BASE_URL ||
    environment.OPENAI_API_KEY ||
    environment.CLAUDE_CODE_USE_OPENAI
  ) {
    candidates.add('openai')
  }
  if (
    environment.GEMINI_BASE_URL ||
    environment.GEMINI_API_KEY ||
    environment.CLAUDE_CODE_USE_GEMINI
  ) {
    candidates.add('gemini')
  }
  if (
    environment.GROK_BASE_URL ||
    environment.GROK_API_KEY ||
    environment.CLAUDE_CODE_USE_GROK
  ) {
    candidates.add('grok')
  }
  if (candidates.size > 1) {
    throw new Error('Selected model environment contains multiple providers')
  }
  return candidates.values().next().value
}

function buildRuntimeLaunchContract(
  selectedEnvironment: Record<string, string>,
  forwardedEnvironment: Record<string, string>,
): RuntimeLaunchContract {
  const endpoint =
    forwardedEnvironment.ANTHROPIC_BASE_URL ||
    forwardedEnvironment.OPENAI_BASE_URL ||
    forwardedEnvironment.GEMINI_BASE_URL ||
    forwardedEnvironment.GROK_BASE_URL ||
    ''
  return {
    selectedEnvironmentKeys: Object.keys(selectedEnvironment).sort(),
    forwardedEnvironmentKeys: Object.keys(forwardedEnvironment).sort(),
    endpointClass: classifyRuntimeEndpoint(endpoint),
    configDirectoryConfigured: Boolean(forwardedEnvironment.BEEGAME_CONFIG_DIR),
    credentialConfigured: Boolean(
      forwardedEnvironment.ANTHROPIC_AUTH_TOKEN ||
        forwardedEnvironment.OPENAI_API_KEY ||
        forwardedEnvironment.GEMINI_API_KEY ||
        forwardedEnvironment.GROK_API_KEY,
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
      'api.anthropic.com',
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
