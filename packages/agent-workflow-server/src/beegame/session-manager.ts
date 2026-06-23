import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  mapModelConfigToRuntime,
  type RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'
import {
  createFileJournalStore,
  createHostHandle,
  runWorkflow,
  type AgentRunParams,
  type AgentRunResult,
  type ProgressEvent,
  type WorkflowPorts,
} from '@claude-code-best/workflow-engine'

const PLAYABLE_SPEC_READY_MARKER = 'PLAYABLE_SPEC_READY: yes'
const PLAYABILITY_CHECKS_PASSED_MARKER = 'PLAYABILITY_CHECKS_PASSED: yes'
const TRACEABILITY_MATRIX_PATH = 'traceability_matrix.json'
const PLAYABLE_LOOP_REVIEW_PATH = 'playable_loop_review.md'
const LEGACY_PLAYABLE_LOOP_REVIEW_JSON_PATH = 'playable_loop_review.json'
const GENERATED_PLAYABILITY_REVIEW_PATH = 'BEEGAME_PLAYABILITY_REVIEW.md'
const PLAYABLE_LOOP_CHECKS = [
  'start',
  'player_action',
  'feedback',
  'pressure',
  'terminal_state',
] as const
const REQUIRED_DESIGN_PACK = [
  {
    path: 'docs/PLAYABLE_SPEC.md',
    sections: [
      'Core Loop',
      'Fun Hook',
      'Skill Test',
      'Risk/Reward',
      'Failure Pressure',
      'First 3 Minutes',
      'MVP Acceptance',
      PLAYABLE_SPEC_READY_MARKER,
    ],
  },
  {
    path: 'docs/GDD.md',
    sections: [
      'Player Promise',
      'Core Loop',
      'First Minute',
      'Win Lose Rules',
    ],
  },
  {
    path: 'docs/TECH_DESIGN.md',
    sections: ['Runtime Architecture', 'State Model', 'Build Validation'],
  },
  {
    path: 'docs/ART_AUDIO_DIRECTION.md',
    sections: ['Visual Language', 'Feedback VFX', 'Audio Cues'],
  },
  {
    path: 'docs/RESOURCE_PLACEHOLDERS.md',
    sections: ['Placeholder Assets', 'VFX Slots', 'SFX Slots'],
  },
  {
    path: 'docs/LEVEL_TUNING.md',
    sections: ['Level Layout', 'Difficulty Curve', 'Replay Target'],
  },
  {
    path: 'docs/PLAYABILITY_ACCEPTANCE.md',
    sections: [
      'Clarity 30s',
      'Interesting Decision 60s',
      'Responsive Input',
      'Readable Feedback',
      'Failure Pressure',
      'Replayable Challenge',
    ],
  },
] as const
const BUILD_REQUIRED_READ_DOCS = [
  'BEEGAME_PLAYABLE_SPEC.md',
  ...REQUIRED_DESIGN_PACK.map(doc => doc.path),
] as const
const BUILD_AFTER_PLAYABLE_SPEC_PROMPT = [
  'Now implement the approved playable spec inside the active BeeGame workspace.',
  'Before writing implementation files or running build commands, first read every mandatory design document in this workspace:',
  ...BUILD_REQUIRED_READ_DOCS.map(path => `- ./${path}`),
  'Treat those files as the source of truth instead of relying on previous conversation history.',
  'The current working directory is already the project workspace. Do not create another top-level folder with the same project name.',
  'Create implementation files under workspace-local implementation folders such as ./src, ./game, ./public, or another purpose-named folder only when needed.',
  'Implement the playable MVP from those design docs, run build checks, and fix issues before declaring completion.',
  `Before finishing, write ./${TRACEABILITY_MATRIX_PATH} mapping every docs/PLAYABILITY_ACCEPTANCE.md requirement to implementation files and verification evidence.`,
  `Before finishing, write ./${PLAYABLE_LOOP_REVIEW_PATH} as a concise Markdown playable loop review.`,
  'The review must include these exact machine-readable lines:',
  'verdict: pass',
  ...PLAYABLE_LOOP_CHECKS.map(check => `${check}: pass`),
  'Then add short human-readable evidence for each check and the real command results.',
  `Do not write ./${GENERATED_PLAYABILITY_REVIEW_PATH} yourself. BeeGame will generate it from the traceability matrix and playable loop review.`,
  `Only structured verifier output may include "${PLAYABILITY_CHECKS_PASSED_MARKER}".`,
].join('\n')
const BEEGAME_BUILD_WORKFLOW_SCRIPT = `
export const meta = {
  name: 'beegame-build',
  description: 'BeeGame deterministic design pack to playable build workflow',
  phases: [
    { title: 'Planning', detail: 'Write project design docs under ./docs' },
    { title: 'Build', detail: 'Read docs, implement, and verify the playable build' },
  ],
}

phase('Planning')
const planning = await agent(args.prompt, {
  label: 'Design Pack',
  phase: 'Planning',
  maxTokens: 32000,
})
if (!planning) {
  throw new Error('BeeGame design pack did not complete')
}

phase('Build')
const build = await agent(args.buildPrompt, {
  label: 'Playable Build',
  phase: 'Build',
  maxTokens: 32000,
})
if (!build) {
  throw new Error('BeeGame build did not complete')
}

return { planning, build }
`
const BEEGAME_BUILD_RECOVERY_WORKFLOW_SCRIPT = `
export const meta = {
  name: 'beegame-build-recovery',
  description: 'BeeGame paused build recovery workflow',
  phases: [
    { title: 'Build', detail: 'Recover a paused playable build from existing docs' },
  ],
}

phase('Build')
const build = await agent(args.prompt, {
  label: 'Playable Build Recovery',
  phase: 'Build',
  maxTokens: 32000,
})
if (!build) {
  throw new Error('BeeGame build recovery did not complete')
}

return { build }
`
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
  | 'runtime.observation'
  | 'verification.required'
  | 'workflow.phase'
  | 'workflow.pipeline'
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

type WorkflowBlock = {
  message: string
  recoverable?: boolean
  recoveryKind?: string
  currentWorkspace?: string
  targetPath?: string
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
  buildReadDocs: Set<string>
  events: BeeGameEvent[]
  nextEventId: number
  nextTurnIndex: number
  currentTurnId: string | null
  workflowPhase: WorkflowPhase
}

export type StartBeeGameSessionInput = {
  workspacePath: string
  modelConfigId?: string
  transcriptSessionId?: string
}

export class BeeGameSessionManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly dashboardDataRoot: string

  constructor(
    private readonly runner: BeeGameSessionRunner = createQueryEngineRunner(),
    dashboardDataRoot?: string,
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

    const recoveredTranscript = input.transcriptSessionId
      ? readExistingTranscriptForResume(
          input.transcriptSessionId,
          cwd,
          this.dashboardDataRoot,
        )
      : undefined

    const record: SessionRecord = {
      session,
      runtime,
      transcriptPath: recoveredTranscript?.path ??
        getSessionTranscriptPath(
          session.id,
          session.cwd,
          this.dashboardDataRoot,
        ),
      runner: null,
      abortController: null,
      pendingPermissions: new Map(),
      trustedSession: false,
      rememberedPermissions: new Set(),
      rememberedPermissionTools: new Set(),
      toolUses: new Map(),
      buildReadDocs: new Set(),
      events: recoveredTranscript?.events ?? [],
      nextEventId: recoveredTranscript
        ? getNextTranscriptEventId(recoveredTranscript.events)
        : 1,
      nextTurnIndex: 1,
      currentTurnId: null,
      workflowPhase: 'planning',
    }
    this.sessions.set(session.id, record)
    this.append(record, 'session.started', `Created BeeGame session in ${cwd}`)
    this.appendRuntimeObservation(record, 'initialized')

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

    const useBuildRecovery = await shouldRunBuildRecovery(record)
    record.session.turnStatus = 'running'
    record.abortController = new AbortController()
    record.currentTurnId = `beegame-turn-${record.session.id}-${record.nextTurnIndex}`
    record.nextTurnIndex += 1
    this.append(record, 'turn.started', text)
    this.append(record, 'user.message', text)
    this.append(record, 'system.status', 'BeeGame runtime is starting.')

    void this.runWorkflowTurn(record, text, useBuildRecovery)
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

  private async runWorkflowTurn(
    record: SessionRecord,
    prompt: string,
    useBuildRecovery: boolean,
  ): Promise<void> {
    try {
      const signal = record.abortController?.signal
      if (!signal) throw new Error('Turn abort controller was not initialized')
      if (useBuildRecovery) {
        this.append(record, 'system.status', 'BeeGame build recovery is starting', {
          type: 'workflow.recovery.started',
          phase: 'building',
        })
      }
      const workflowResult = await runWorkflow({
        script: useBuildRecovery
          ? BEEGAME_BUILD_RECOVERY_WORKFLOW_SCRIPT
          : BEEGAME_BUILD_WORKFLOW_SCRIPT,
        args: {
          prompt: useBuildRecovery
            ? buildBuildRecoveryPrompt(prompt)
            : prompt,
          buildPrompt: BUILD_AFTER_PLAYABLE_SPEC_PROMPT,
        },
        runId: record.currentTurnId ?? record.session.id,
        workflowName: useBuildRecovery
          ? 'beegame-build-recovery'
          : 'beegame-build',
        ports: this.createWorkflowPorts(record, signal),
        host: createHostHandle({ sessionId: record.session.id }),
        signal,
        cwd: record.session.cwd,
        budgetTotal: null,
      })
      if (
        !signal.aborted &&
        record.session.status === 'running' &&
        workflowResult.status === 'completed'
      ) {
        this.setWorkflowPhase(record, 'completed')
        this.appendRuntimeObservation(record, 'turn_completed')
        this.append(record, 'turn.completed', 'BeeGame turn completed')
      } else if (
        !signal.aborted &&
        record.session.status === 'running' &&
        workflowResult.status === 'failed'
      ) {
        const latestBlock = getLatestCurrentTurnWorkflowBlock(record)
        if (latestBlock) {
          this.append(record, 'system.status', 'BeeGame workflow paused', {
            type: 'workflow.paused',
            reason: latestBlock.text,
          })
          return
        }
        throw new Error(workflowResult.error || 'BeeGame workflow failed')
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

  private async submitToRunner(
    record: SessionRecord,
    runner: BeeGameSessionRuntime,
    prompt: string,
    signal: AbortSignal,
  ): Promise<void> {
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
          recordBuildDocReadFromToolEvent(record, toolEvent.payload)
        }
      },
      requestPermission: request => this.requestPermission(record, request),
    })
  }

  private createWorkflowPorts(
    record: SessionRecord,
    signal: AbortSignal,
  ): WorkflowPorts {
    return {
      agentRunner: {
        runAgentToResult: params => this.runWorkflowAgent(record, params, signal),
      },
      progressEmitter: {
        emit: event => this.appendWorkflowProgress(record, event),
      },
      taskRegistrar: {
        register: () => ({ runId: record.currentTurnId ?? record.session.id, signal }),
        complete: () => {},
        fail: () => {},
        kill: () => {
          record.abortController?.abort()
        },
        pendingAction: () => null,
      },
      journalStore: createFileJournalStore(resolve(this.dashboardDataRoot, 'workflow-runs')),
      permissionGate: {
        isAborted: () => signal.aborted,
      },
      logger: {
        debug: () => {},
        event: () => {},
        warn: message => this.append(record, 'system.status', message, {
          type: 'workflow.log',
          level: 'warn',
          message,
        }),
      },
      hostFactory: () => ({
        handle: createHostHandle({ sessionId: record.session.id }),
        cwd: record.session.cwd,
        budgetTotal: null,
      }),
    }
  }

  private appendWorkflowProgress(record: SessionRecord, event: ProgressEvent): void {
    switch (event.type) {
      case 'run_started':
        this.append(record, 'workflow.pipeline', event.workflowName, {
          type: 'workflow.pipeline',
          workflowName: event.workflowName,
          meta: event.meta ?? undefined,
        })
        return
      case 'phase_started':
        this.setWorkflowPhase(record, mapWorkflowEnginePhase(event.phase))
        return
      case 'agent_started':
        this.append(record, 'system.status', `${event.label ?? 'Agent'} started`, {
          type: 'workflow.agent.started',
          agentId: event.agentId,
          label: event.label,
          phase: event.phase,
        })
        return
      case 'agent_done':
        this.append(record, 'system.status', `${event.label ?? 'Agent'} finished`, {
          type: 'workflow.agent.done',
          agentId: event.agentId,
          label: event.label,
          phase: event.phase,
          result: event.result,
        })
        return
      case 'agent_progress':
        this.append(record, 'system.status', `${event.label ?? 'Agent'} is running`, {
          type: 'workflow.agent.progress',
          agentId: event.agentId,
          label: event.label,
          phase: event.phase,
          tokenCount: event.tokenCount,
          toolCount: event.toolCount,
        })
        return
      case 'log':
        this.append(record, 'system.status', event.message, {
          type: 'workflow.log',
          message: event.message,
        })
        return
      case 'run_done':
        this.append(record, 'workflow.pipeline', event.status, {
          type: 'workflow.pipeline',
          status: event.status,
          ...(event.error ? { error: event.error } : {}),
        })
        return
      case 'phase_done':
        return
    }
  }

  private async runWorkflowAgent(
    record: SessionRecord,
    params: AgentRunParams,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    record.workflowPhase = mapWorkflowEnginePhase(params.phase)
    if (record.workflowPhase === 'building') {
      this.appendVerificationRequired(record)
    }

    const runner = await this.runner.start({
      sessionId: record.session.id,
      cwd: record.session.cwd,
      env: buildRuntimeEnv(record.runtime),
    })
    record.runner = runner
    let output = ''
    try {
      await this.submitToRunner(record, runner, params.prompt, signal)
      output = getLatestAgentOutput(record)
    } finally {
      runner.stop()
      if (record.runner === runner) record.runner = null
    }

    if (signal.aborted || record.session.status !== 'running') {
      return { kind: 'dead', reason: 'runagent-threw', detail: 'aborted' }
    }

    if (record.workflowPhase === 'planning') {
      const violation = await this.validatePlanningAgent(record)
      if (violation) {
        return { kind: 'skipped' }
      }
      await persistPlayableSpec(record)
    }

    if (record.workflowPhase === 'building') {
      const violation = await this.validateBuildAgent(record)
      if (violation) {
        return { kind: 'skipped' }
      }
    }

    return {
      kind: 'ok',
      output,
      usage: { outputTokens: 0 },
      toolCount: record.toolUses.size,
    }
  }

  private async validatePlanningAgent(
    record: SessionRecord,
  ): Promise<string | undefined> {
    if (!(await hasPlayableSpecReadySignal(record))) {
      const message = [
        `BeeGame planning did not produce "${PLAYABLE_SPEC_READY_MARKER}".`,
        'Write the playable spec and design pack under ./docs before implementation.',
      ].join(' ')
      this.append(record, 'workflow.blocked', message, {
        type: 'workflow.blocked',
        phase: record.workflowPhase,
        reason: message,
        recoverable: true,
        recoveryKind: 'planning_docs_required',
      })
      return message
    }

    const designPackViolation = await getDesignPackViolation(record)
    if (!designPackViolation) return undefined
    this.append(record, 'workflow.blocked', designPackViolation, {
      type: 'workflow.blocked',
      phase: record.workflowPhase,
      reason: designPackViolation,
      recoverable: true,
      recoveryKind: 'design_pack_repair',
      requiredArtifacts: REQUIRED_DESIGN_PACK.map(doc => ({
        path: doc.path,
        sections: [...doc.sections],
      })),
    })
    return designPackViolation
  }

  private async validateBuildAgent(record: SessionRecord): Promise<string | undefined> {
    const missingReadDocs = getMissingBuildReadDocs(record)
    if (missingReadDocs.length > 0) {
      const message = [
        'BeeGame build turn must read mandatory docs before completion.',
        `Missing reads: ${missingReadDocs.join(', ')}.`,
        'Start the build turn by reading those docs, then continue implementation from the documented design requirements.',
      ].join(' ')
      this.append(record, 'workflow.blocked', message, {
        type: 'workflow.blocked',
        phase: record.workflowPhase,
        missingDocs: missingReadDocs,
      })
      return message
    }
    const qualityGateResult = await validateAndWritePlayableLoopReview(record)
    if (qualityGateResult) {
      this.append(record, 'workflow.blocked', qualityGateResult, {
        type: 'workflow.blocked',
        phase: record.workflowPhase,
        reason: qualityGateResult,
        recoverable: true,
        recoveryKind: 'playable_loop_review_required',
        requiredArtifacts: [
          TRACEABILITY_MATRIX_PATH,
          PLAYABLE_LOOP_REVIEW_PATH,
        ],
      })
      return qualityGateResult
    }
    this.append(record, 'verification.required', 'BeeGame playability verification passed', {
      type: 'verification.required',
      artifactPath: GENERATED_PLAYABILITY_REVIEW_PATH,
      status: 'pass',
      generatedPaths: [
        TRACEABILITY_MATRIX_PATH,
        PLAYABLE_LOOP_REVIEW_PATH,
        GENERATED_PLAYABILITY_REVIEW_PATH,
      ],
      checks: [
        { id: 'start', label: 'Start playable loop', status: 'pass' },
        { id: 'player_action', label: 'Player action changes state', status: 'pass' },
        { id: 'feedback', label: 'Readable feedback appears', status: 'pass' },
        { id: 'pressure', label: 'Failure pressure advances', status: 'pass' },
        { id: 'terminal_state', label: 'Win or loss and restart are available', status: 'pass' },
      ],
    })
    return undefined
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
    const workspaceViolation = getWorkspaceViolation(
      record.session.cwd,
      this.dashboardDataRoot,
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
    if (
      record.workflowPhase === 'planning' &&
      isDesignPackMutationRequest(record, request)
    ) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        autoApproved: true,
        reason: 'Required BeeGame design pack files may be written during planning.',
        input: request.input,
      })
      return {
        behavior: 'allow',
        message: 'Allowed for required BeeGame design pack output.',
      }
    }
    if (
      record.workflowPhase === 'building' &&
      isBuildQualityGateMutationRequest(record, request)
    ) {
      this.append(record, 'permission.resolved', `${request.toolName}: allow`, {
        type: 'permission.resolved',
        toolUseID: request.toolUseID,
        toolName: request.toolName,
        decision: 'allow',
        autoApproved: true,
        reason: 'Structured BeeGame verification artifacts may be written during build.',
        input: request.input,
      })
      return {
        behavior: 'allow',
        message: 'Allowed for structured BeeGame verification output.',
      }
    }
    const workflowBlock =
      record.workflowPhase === 'planning'
        ? await getGameplayGateViolation(record, request)
        : undefined
    if (workflowBlock) {
      this.append(record, 'workflow.blocked', workflowBlock.message, {
        type: 'workflow.blocked',
        phase: record.workflowPhase,
        blockedToolName: request.toolName,
        toolUseID: request.toolUseID,
        reason: workflowBlock.message,
        recoverable: workflowBlock.recoverable,
        recoveryKind: workflowBlock.recoveryKind,
        currentWorkspace: workflowBlock.currentWorkspace,
        targetPath: workflowBlock.targetPath,
        input: request.input,
      })
      return Promise.resolve({
        behavior: 'deny',
        message: workflowBlock.message,
      })
    }
    const signature = permissionSignature(request)
    if (
      getBeeGamePermissionPolicyDecision(record, request) === 'auto_allow' ||
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
    this.appendWorkflowPipeline(record)
  }

  private appendWorkflowPipeline(record: SessionRecord): void {
    const stages = getWorkflowPipelineStages(record.workflowPhase)
    this.append(record, 'workflow.pipeline', getCurrentPipelinePhase(record.workflowPhase), {
      type: 'workflow.pipeline',
      currentPhase: getCurrentPipelinePhase(record.workflowPhase),
      stages,
    })
  }

  private appendVerificationRequired(record: SessionRecord): void {
    if (record.events.some(event => event.type === 'verification.required')) {
      return
    }
    this.append(record, 'verification.required', 'BeeGame playability verification is required', {
      type: 'verification.required',
      artifactPath: 'BEEGAME_PLAYABILITY_REVIEW.md',
      checks: [
        {
          id: 'clarity_30s',
          label: 'Clarity within 30 seconds',
          detail: 'Player understands goal, controls, and feedback quickly.',
        },
        {
          id: 'interesting_decision_60s',
          label: 'First interesting decision within 60 seconds',
          detail: 'The first minute contains a meaningful player decision.',
        },
        {
          id: 'responsive_input',
          label: 'Responsive input feel',
          detail: 'Core controls respond immediately and consistently.',
        },
        {
          id: 'readable_feedback',
          label: 'Readable feedback',
          detail: 'Scoring, damage, progress, and failure feedback are visible.',
        },
        {
          id: 'failure_pressure',
          label: 'Failure pressure',
          detail: 'The game has pressure, fail state, or escalating challenge.',
        },
        {
          id: 'replayable_challenge',
          label: 'Replayable challenge',
          detail: 'There is at least one reason to retry and improve.',
        },
      ],
    })
  }

  private appendRuntimeObservation(
    record: SessionRecord,
    status: 'initialized' | 'turn_completed',
  ): void {
    this.append(record, 'runtime.observation', 'BeeGame runtime observability updated', {
      type: 'runtime.observation',
      status,
      phase: record.workflowPhase,
      features: [
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
      ],
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

function resolveExistingPath(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

function getCurrentPipelinePhase(phase: WorkflowPhase): string {
  if (phase === 'planning') return 'gdd'
  if (phase === 'building') return 'implementation'
  return 'build'
}

function getWorkflowPipelineStages(phase: WorkflowPhase): Array<{
  id: string
  label: string
  status: 'completed' | 'active' | 'pending'
}> {
  const current = getCurrentPipelinePhase(phase)
  const order = [
    { id: 'idea_intake', label: 'Idea Intake' },
    { id: 'gdd', label: 'Playable Spec' },
    { id: 'implementation', label: 'Implementation' },
    { id: 'qa', label: 'Playability Review' },
    { id: 'build', label: 'Build/Preview' },
  ]
  const currentIndex = order.findIndex(stage => stage.id === current)
  return order.map((stage, index) => ({
    ...stage,
    status:
      phase === 'completed' || index < currentIndex
        ? 'completed'
        : index === currentIndex
          ? 'active'
          : 'pending',
  }))
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
  type: BeeGameEventType
  text: string
  turnId?: string
  payload?: DashboardSDKMessage
  createdAt: string
}>> {
  const transcriptPath = await resolveReadableTranscriptPath(
    sessionId,
    cwd,
    dashboardDataRoot,
  )
  const raw = await readFile(transcriptPath, 'utf8')
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as {
      id: number
      type: BeeGameEventType
      text: string
      turnId?: string
      payload?: DashboardSDKMessage
      createdAt: string
    })
}

async function resolveReadableTranscriptPath(
  sessionId: string,
  cwd: string,
  dashboardDataRoot?: string,
): Promise<string> {
  const primary = getSessionTranscriptPath(
    sessionId,
    cwd,
    resolve(dashboardDataRoot || cwd),
  )
  try {
    await readFile(primary, 'utf8')
    return primary
  } catch {
    await readFile(primary, 'utf8')
    return primary
  }
}

function readExistingTranscriptForResume(
  sessionId: string,
  cwd: string,
  dashboardDataRoot: string,
): { path: string; events: BeeGameEvent[] } | undefined {
  const transcriptPath = resolveReadableTranscriptPathSync(
    sessionId,
    cwd,
    dashboardDataRoot,
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
  dashboardDataRoot: string,
): string | undefined {
  const primary = getSessionTranscriptPath(sessionId, cwd, resolve(dashboardDataRoot))
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

function getSessionTranscriptPath(
  sessionId: string,
  cwd: string,
  root: string,
): string {
  return resolve(
    root,
    '.beegame-dashboard',
    'transcripts',
    getTranscriptProjectPrefix(cwd, sessionId),
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

async function getGameplayGateViolation(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): Promise<WorkflowBlock | undefined> {
  if (!isImplementationTool(request.toolName)) return undefined
  if (isDesignPackMutationRequest(record, request)) return undefined
  const artifactPath = getMutationArtifactPath(request.input)
  if (isFileMutationTool(request.toolName) && artifactPath) {
    if (!isPathInside(record.session.cwd, record.session.cwd, artifactPath)) {
      return {
        message: [
          `${request.toolName} targets another project folder during planning: ${artifactPath}.`,
          `The current BeeGame project workspace is ${record.session.cwd}.`,
          'During planning, write design documents with relative paths under ./docs, for example ./docs/PLAYABLE_SPEC.md.',
          'Do not use absolute paths from another project.',
        ].join(' '),
        recoverable: true,
        recoveryKind: 'planning_path_rewrite',
        currentWorkspace: record.session.cwd,
        targetPath: artifactPath,
      }
    }
  }
  return {
    message: [
      `Planning phase is docs-only before ${request.toolName}.`,
      `First produce the Playable Spec and required design pack under ./docs, including docs/PLAYABLE_SPEC.md and docs/PLAYABILITY_ACCEPTANCE.md, with the exact marker "${PLAYABLE_SPEC_READY_MARKER}".`,
      'After the planning turn finishes, BeeGame will validate those docs and start a separate build turn.',
    ].join(' '),
    recoverable: true,
    recoveryKind: 'planning_docs_required',
    currentWorkspace: record.session.cwd,
    targetPath: artifactPath,
  }
}

function isImplementationTool(toolName: string): boolean {
  return toolName === 'Bash' || isFileMutationTool(toolName)
}

async function hasPlayableSpecReady(record: SessionRecord): Promise<boolean> {
  for (const path of ['BEEGAME_PLAYABLE_SPEC.md', 'docs/PLAYABLE_SPEC.md']) {
    try {
      const content = await readFile(resolve(record.session.cwd, path), 'utf8')
      if (content.includes(PLAYABLE_SPEC_READY_MARKER)) return true
    } catch {
      // Absence means the gate is still pending.
    }
  }
  return false
}

async function hasPlayableSpecReadySignal(record: SessionRecord): Promise<boolean> {
  if (await hasPlayableSpecReady(record)) return true
  return record.events.some(event =>
    (event.type === 'assistant.message' || event.type === 'assistant.partial') &&
    event.text.includes(PLAYABLE_SPEC_READY_MARKER),
  )
}

function isDesignPackMutationRequest(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): boolean {
  if (!isFileMutationTool(request.toolName)) return false
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath) return false
  const normalized = getWorkspaceRelativeMutationPath(record.session.cwd, artifactPath)
  return (
    REQUIRED_DESIGN_PACK.some(doc => normalized === doc.path) ||
    isProjectDocsMarkdownPath(normalized)
  )
}

function isBuildQualityGateMutationRequest(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): boolean {
  if (!isFileMutationTool(request.toolName)) return false
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath) return false
  const normalized = getWorkspaceRelativeMutationPath(record.session.cwd, artifactPath)
  return getQualityGateArtifactAliases().includes(normalized)
}

function getQualityGateArtifactAliases(): string[] {
  return [
    TRACEABILITY_MATRIX_PATH,
    PLAYABLE_LOOP_REVIEW_PATH,
    `docs/${basename(TRACEABILITY_MATRIX_PATH)}`,
    `docs/${basename(PLAYABLE_LOOP_REVIEW_PATH)}`,
  ]
}

function isProjectDocsMarkdownPath(path: string): boolean {
  return path.startsWith('docs/') && path.endsWith('.md')
}

function getBeeGamePermissionPolicyDecision(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): 'auto_allow' | 'ask_user' {
  if (isReadOnlyTool(request.toolName)) return 'auto_allow'
  if (isFileMutationTool(request.toolName)) {
    return isSafeProjectLocalMutation(record, request) ? 'auto_allow' : 'ask_user'
  }
  if (request.toolName === 'Bash') {
    return isSafeBeeGameBashCommand(request.input) ? 'auto_allow' : 'ask_user'
  }
  return 'ask_user'
}

function isReadOnlyTool(toolName: string): boolean {
  return toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep'
}

function isSafeProjectLocalMutation(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): boolean {
  const artifactPath = getMutationArtifactPath(request.input)
  if (!artifactPath) return false
  const normalized = getWorkspaceRelativeMutationPath(record.session.cwd, artifactPath)
  if (!normalized) return false
  return !isSensitiveProjectMutationPath(normalized)
}

function isSensitiveProjectMutationPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean)
  const sensitiveFileNames = new Set([
    '.env',
    '.env.local',
    '.npmrc',
    '.yarnrc',
    '.pypirc',
    'id_rsa',
    'id_ed25519',
    'credentials',
    'credentials.json',
    'service-account.json',
  ])
  return segments.some(segment =>
    segment.startsWith('.') ||
    sensitiveFileNames.has(segment.toLowerCase()),
  )
}

function isSafeBeeGameBashCommand(input: Record<string, unknown>): boolean {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command || hasShellControlSyntax(command)) return false
  const tokens = splitShellLike(command).map(cleanShellToken).filter(Boolean)
  if (tokens.length === 0) return false
  if (tokens.some(token => isDangerousShellToken(token))) return false
  return isSafeReadOnlyShellCommand(tokens) || isSafeProjectValidationCommand(tokens)
}

function hasShellControlSyntax(command: string): boolean {
  return (
    command.includes('|') ||
    command.includes(';') ||
    command.includes('&&') ||
    command.includes('||') ||
    command.includes('>') ||
    command.includes('<') ||
    command.includes('`') ||
    command.includes('$(')
  )
}

function isDangerousShellToken(token: string): boolean {
  const normalized = token.toLowerCase()
  return [
    'rm',
    'mv',
    'chmod',
    'chown',
    'sudo',
    'curl',
    'wget',
    'ssh',
    'scp',
    'rsync',
  ].includes(normalized)
}

function isSafeReadOnlyShellCommand(tokens: string[]): boolean {
  const [command, firstArg] = tokens
  if (command === 'pwd') return tokens.length === 1
  if (command === 'sed') return firstArg === '-n'
  return ['ls', 'cat', 'find', 'grep', 'rg'].includes(command)
}

function isSafeProjectValidationCommand(tokens: string[]): boolean {
  const [command, firstArg, secondArg] = tokens
  if (command === 'npm') {
    return firstArg === 'test' || (firstArg === 'run' && secondArg === 'build' && tokens.length === 3)
  }
  if (command === 'bun') {
    return firstArg === 'test' ||
      (firstArg === 'run' && (secondArg === 'build' || secondArg === 'test') && tokens.length === 3)
  }
  return false
}

function recordBuildDocReadFromToolEvent(
  record: SessionRecord,
  payload: DashboardSDKMessage,
): void {
  if (record.workflowPhase !== 'building') return
  if (getDashboardPayloadString(payload, 'toolName') !== 'Read') return
  const input = getDashboardPayloadRecord(payload, 'input')
  const artifactPath = getMutationArtifactPath(input)
  if (!artifactPath) return
  const normalized = getWorkspaceRelativeMutationPath(record.session.cwd, artifactPath)
  if (isBuildRequiredReadDoc(normalized)) {
    record.buildReadDocs.add(normalized)
  }
}

function getMissingBuildReadDocs(record: SessionRecord): string[] {
  return BUILD_REQUIRED_READ_DOCS.filter(path => !record.buildReadDocs.has(path))
}

function isBuildRequiredReadDoc(path: string): path is typeof BUILD_REQUIRED_READ_DOCS[number] {
  return BUILD_REQUIRED_READ_DOCS.some(requiredPath => requiredPath === path)
}

function mapWorkflowEnginePhase(phase: unknown): WorkflowPhase {
  if (phase === 'Build') return 'building'
  if (phase === 'Delivery') return 'completed'
  return 'planning'
}

function getLatestAgentOutput(record: SessionRecord): string {
  const currentTurnId = record.currentTurnId
  const outputEvent = [...record.events]
    .reverse()
    .find(event =>
      (!currentTurnId || event.turnId === currentTurnId) &&
      (event.type === 'result' || event.type === 'assistant.message'),
    )
  return outputEvent?.text ?? ''
}

function getLatestCurrentTurnWorkflowBlock(record: SessionRecord): BeeGameEvent | undefined {
  const currentTurnId = record.currentTurnId
  return [...record.events]
    .reverse()
    .find(event =>
      event.type === 'workflow.blocked' &&
      (!currentTurnId || event.turnId === currentTurnId),
    )
}

async function getDesignPackViolation(
  record: SessionRecord,
): Promise<string | undefined> {
  const missing: string[] = []
  const empty: string[] = []
  for (const doc of REQUIRED_DESIGN_PACK) {
    let content = ''
    try {
      content = await readFile(resolve(record.session.cwd, doc.path), 'utf8')
    } catch {
      missing.push(doc.path)
      continue
    }
    if (content.trim().length === 0) empty.push(doc.path)
  }
  if (!(await hasPlayableSpecReady(record))) {
    empty.push('docs/PLAYABLE_SPEC.md missing playable spec ready marker')
  }
  if (missing.length === 0 && empty.length === 0) return undefined
  const details = [...missing, ...empty].join('; ')
  return `BeeGame required design pack is incomplete before implementation: ${details}`
}

async function shouldRunBuildRecovery(record: SessionRecord): Promise<boolean> {
  if (record.workflowPhase === 'building') return true
  if (!(await getDesignPackViolation(record))) return true
  return record.events.some(event => {
    if (event.type !== 'workflow.blocked') return false
    const payload = getPayloadRecordFromEvent(event)
    const phase = typeof payload.phase === 'string' ? payload.phase : ''
    const recoveryKind = typeof payload.recoveryKind === 'string' ? payload.recoveryKind : ''
    return phase === 'building' || recoveryKind === 'playable_loop_review_required'
  })
}

function getPayloadRecordFromEvent(event: BeeGameEvent): Record<string, unknown> {
  const payload = event.payload
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function buildBuildRecoveryPrompt(userPrompt: string): string {
  return [
    'Recover the paused BeeGame build from the existing project workspace.',
    'Do not restart planning and do not create a new project.',
    'First read the existing design docs and verification artifacts:',
    ...BUILD_REQUIRED_READ_DOCS.map(path => `- ./${path}`),
    `- ./${TRACEABILITY_MATRIX_PATH}`,
    `- ./${PLAYABLE_LOOP_REVIEW_PATH}`,
    `- ./${LEGACY_PLAYABLE_LOOP_REVIEW_JSON_PATH} if it exists`,
    `If ${LEGACY_PLAYABLE_LOOP_REVIEW_JSON_PATH} is invalid, do not keep editing that JSON file.`,
    `Write a fresh ./${PLAYABLE_LOOP_REVIEW_PATH} with verdict: pass and pass lines for ${PLAYABLE_LOOP_CHECKS.join(', ')} after verifying the build.`,
    'Then finish the build validation so BeeGame can generate the final playability review.',
    '',
    `User request now:\n${userPrompt}`,
  ].join('\n')
}

async function validateAndWritePlayableLoopReview(record: SessionRecord): Promise<string | undefined> {
  const traceability = await readJsonArtifact(record, TRACEABILITY_MATRIX_PATH)
  if (!traceability.ok) return `BeeGame traceability matrix is incomplete: ${TRACEABILITY_MATRIX_PATH} ${traceability.message}`

  const mappings = getTraceabilityMappings(traceability.value)
  if (mappings.length === 0) return 'BeeGame traceability matrix has no implementation mappings'

  const implementedIds = new Set(
    mappings
      .filter(item => getStringValue(item, 'status') === 'implemented')
      .map(item =>
        getStringValue(item, 'requirementId') ||
        getStringValue(item, 'requirement') ||
        getStringValue(item, 'id') ||
        getStringValue(item, 'description')
      )
      .filter(Boolean),
  )
  if (implementedIds.size === 0) {
    return 'BeeGame traceability matrix has no implemented requirement evidence'
  }

  const loopReview = await readPlayableLoopReviewArtifact(record)
  if (!loopReview.ok) return `BeeGame playable loop review is incomplete: ${loopReview.message}`

  const missingChecks = PLAYABLE_LOOP_CHECKS
    .filter(check => !loopReview.passedChecks.has(check))
  if (missingChecks.length > 0) {
    return `BeeGame playable loop review missing passing checks: ${missingChecks.join(', ')}`
  }

  const review = [
    '# BeeGame Playability Review',
    '',
    'Generated by BeeGame playable loop verifier.',
    '',
    `- Traceability: ${TRACEABILITY_MATRIX_PATH}`,
    `- Playable loop review: ${loopReview.path}`,
    `- Requirements mapped: ${implementedIds.size}`,
    `- Loop checks passed: ${[...loopReview.passedChecks].join(', ')}`,
    '',
    PLAYABILITY_CHECKS_PASSED_MARKER,
    '',
  ].join('\n')
  await writeFile(resolve(record.session.cwd, GENERATED_PLAYABILITY_REVIEW_PATH), review, 'utf8')
  return undefined
}

function getTraceabilityMappings(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const mappings = getRecordArray(value, 'mappings')
  if (mappings.length > 0) return mappings
  return getRecordArray(value, 'requirements')
}

async function readPlayableLoopReviewArtifact(
  record: SessionRecord,
): Promise<
  | { ok: true; path: string; passedChecks: Set<string> }
  | { ok: false; message: string }
> {
  const candidates = [
    PLAYABLE_LOOP_REVIEW_PATH,
    `docs/${PLAYABLE_LOOP_REVIEW_PATH}`,
    LEGACY_PLAYABLE_LOOP_REVIEW_JSON_PATH,
    `docs/${LEGACY_PLAYABLE_LOOP_REVIEW_JSON_PATH}`,
  ]
  const errors: string[] = []
  for (const path of candidates) {
    const canonicalPath = resolve(record.session.cwd, path)
    try {
      const content = await readFile(canonicalPath, 'utf8')
      const parsed = parsePlayableLoopReviewContent(content)
      if (!parsed.ok) {
        errors.push(`${path} ${parsed.message}`)
        continue
      }
      if (path !== PLAYABLE_LOOP_REVIEW_PATH) {
        await writeFile(resolve(record.session.cwd, PLAYABLE_LOOP_REVIEW_PATH), content, 'utf8')
      }
      return { ok: true, path, passedChecks: parsed.passedChecks }
    } catch {
      errors.push(`${path} is missing`)
    }
  }
  return { ok: false, message: errors[0] ?? `${PLAYABLE_LOOP_REVIEW_PATH} is missing` }
}

function parsePlayableLoopReviewContent(
  content: string,
): { ok: true; passedChecks: Set<string> } | { ok: false; message: string } {
  try {
    const json = parseJsonArtifactContent(content)
    if (json.ok) return parsePlayableLoopReviewRecord(json.value)
  } catch {}
  return parsePlayableLoopReviewMarkdown(content)
}

function parsePlayableLoopReviewRecord(
  value: Record<string, unknown>,
): { ok: true; passedChecks: Set<string> } | { ok: false; message: string } {
  if (getStringValue(value, 'verdict') !== 'pass') {
    return { ok: false, message: 'verdict is not pass' }
  }
  const evidence = getRecordArray(value, 'evidence')
  const passedChecks = new Set(
    evidence
      .filter(item => getStringValue(item, 'status') === 'pass')
      .map(item => getStringValue(item, 'check'))
      .filter(Boolean),
  )
  return { ok: true, passedChecks }
}

function parsePlayableLoopReviewMarkdown(
  content: string,
): { ok: true; passedChecks: Set<string> } | { ok: false; message: string } {
  const lines = content
    .split('\n')
    .map(normalizePlayableLoopReviewLine)
    .filter(Boolean)
  if (!lines.some(line => line === 'verdict: pass' || line === '- verdict: pass')) {
    return { ok: false, message: 'verdict is not pass' }
  }
  const passedChecks = new Set<string>()
  for (const check of PLAYABLE_LOOP_CHECKS) {
    if (lines.some(line => line === `${check}: pass` || line.startsWith(`${check}: pass `) || line.startsWith(`- ${check}: pass`))) {
      passedChecks.add(check)
    }
  }
  return { ok: true, passedChecks }
}

function normalizePlayableLoopReviewLine(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
}

async function readJsonArtifact(
  record: SessionRecord,
  path: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  const canonicalPath = resolve(record.session.cwd, path)
  try {
    const content = await readFile(canonicalPath, 'utf8')
    return parseJsonArtifactContent(content)
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: 'contains invalid JSON' }
  }

  const fallbackRelativePath = path.startsWith('docs/')
    ? basename(path)
    : `docs/${basename(path)}`
  const fallbackPath = resolve(record.session.cwd, fallbackRelativePath)
  try {
    const content = await readFile(fallbackPath, 'utf8')
    const parsed = parseJsonArtifactContent(content)
    if (!parsed.ok) return parsed
    mkdirSync(dirname(canonicalPath), { recursive: true })
    await writeFile(canonicalPath, content, 'utf8')
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: 'contains invalid JSON' }
    return { ok: false, message: 'is missing' }
  }
}

function parseJsonArtifactContent(
  content: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'must be a JSON object' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

function getRecordArray(value: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const item = value[key]
  if (!Array.isArray(item)) return []
  return item.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>>
}

function getStringValue(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  return typeof item === 'string' ? item.trim() : ''
}

async function persistPlayableSpec(record: SessionRecord): Promise<void> {
  try {
    const docContent = await readFile(resolve(record.session.cwd, 'docs/PLAYABLE_SPEC.md'), 'utf8')
    if (docContent.includes(PLAYABLE_SPEC_READY_MARKER)) {
      await writeFile(resolve(record.session.cwd, 'BEEGAME_PLAYABLE_SPEC.md'), `${docContent.trim()}\n`, 'utf8')
      return
    }
  } catch {
    // Fall back to the current turn transcript when no spec document exists yet.
  }
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

function getWorkspaceRelativeMutationPath(cwd: string, artifactPath: string): string {
  const targetPath = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(cwd, artifactPath)
  const rel = relative(cwd, targetPath)
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
  return `${request.toolName} requested access outside the configured workspace root: ${outsidePath}. The dashboard session is restricted to ${allowedRoot}.`
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
      return null
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
