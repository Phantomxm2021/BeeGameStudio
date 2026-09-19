import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { resolveWorkflowEvidencePath } from './delivery-workflow/evidence'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_PROJECT_DOCUMENTS,
  type DeliveryWorkerPort,
  type DispatchRecord,
  type WorkerDispatchRequest,
} from './delivery-workflow/types'
import { implementationWorkerTerminalSchema } from './delivery-workflow/worker-contracts'
import {
  changeImpactTerminalSchema,
  contentAuthorTerminalSchema,
  documentAuthorTerminalSchema,
  questionAnswerTerminalSchema,
  resourcePlannerTerminalSchema,
} from './delivery-workflow/worker-contracts'
import type {
  BeeGameSessionManager,
  BeeGameEvent,
  BeeGameSessionLanguage,
} from './session-manager'
import { assertSharedDocumentWorker } from './delivery-workflow/retired-foundation-author'
import {
  buildChecklistAuthorityProjection,
  type ChecklistAuthority,
} from './checklist-authority-projection'
import { documentAuthoringMetrics } from './document-authoring-metrics'

function taskTypeForWorker(
  workerType: WorkerDispatchRequest['workerType'],
): 'edit_turn' | 'agent_turn' {
  return workerType === 'document-author' ||
    workerType === 'resource-planner' ||
    workerType === 'content-author' ||
    workerType === 'implementation-worker'
    ? 'edit_turn'
    : 'agent_turn'
}

export async function buildDocumentAuthorAuthorityBlock(
  request: WorkerDispatchRequest,
): Promise<string> {
  if (request.workerType !== 'document-author') return ''
  assertSharedDocumentWorker(request)
  if (
    request.contract.authoringMode === undefined &&
    request.contract.documentSet === 'checklist'
  ) {
    const targetPath = request.allowedPaths?.[0]
    if (
      typeof targetPath !== 'string' ||
      targetPath !== request.contract.checklistCandidatePath
    )
      throw new Error('checklist author target is invalid')
    const checklistAuthority = request.contract.checklistAuthority
    if (!checklistAuthority || typeof checklistAuthority !== 'object')
      throw new Error('checklist authority snapshot is missing')
    const projection = buildChecklistAuthorityProjection({
      checklistAuthority: checklistAuthority as ChecklistAuthority,
      approvedDocumentRevision: request.revision,
    })
    return [
      `Write the Checklist candidate only at ${targetPath}. The service will validate it and atomically publish it to ${String(request.contract.checklistCanonicalPath)} only when valid. A failed candidate is diagnostic-only and cannot become authority.`,
      projection,
    ].join('\n\n')
  }
  throw new Error('Checklist authoringMode must be absent')
}



export function createBeeGameDeliveryWorkerPort(input: {
  sessions: BeeGameSessionManager
  userId: string
  getAuthToken?: (options?: {
    forceRefresh?: boolean
  }) => string | undefined | Promise<string | undefined>
  userDataRoot?: string
  modelConfigId?: string
  language?: BeeGameSessionLanguage
  confirmedBriefContext?: string
  getConfirmedBriefContext?: () => Promise<string | undefined>
}): DeliveryWorkerPort {
  const sessions = new Map<string, string>()
  const records = new Map<string, DispatchRecord>()
  const requests = new Map<string, WorkerDispatchRequest>()
  const documentAuthorityBlocks = new Map<string, string>()
  const eventOffsets = new Map<string, number>()
  const sessionEvents = (sessionId: string) =>
    typeof input.sessions.events === 'function'
      ? input.sessions.events(sessionId)
      : []
  const disposeWorkflowSession = async (sessionId: string) => {
    if (typeof input.sessions.disposeWorkflowWorker === 'function')
      await input.sessions.disposeWorkflowWorker(sessionId)
    else if (typeof input.sessions.stop === 'function')
      input.sessions.stop(sessionId)
  }
  return {
    async start(request: WorkerDispatchRequest) {
      assertSharedDocumentWorker(request)
      const dispatchId = request.dispatchId ?? randomUUID()
      const requestedResumeSession = request.contract.resumeWorkerSessionId
      if (
        requestedResumeSession !== undefined &&
        (typeof requestedResumeSession !== 'string' || !requestedResumeSession)
      )
        throw new Error('worker resume session id must be a non-empty string')
      const documentAuthorityBlock =
        request.workerType === 'document-author' &&
        request.contract.documentSet === 'checklist'
          ? await buildDocumentAuthorAuthorityBlock(request)
          : ''
      const authToken = await input.getAuthToken?.()
      const session = input.sessions.start({
        workspacePath: request.workspacePath,
        projectId: request.projectId,
        userId: input.userId,
        ...(authToken ? { authToken } : {}),
        ...(input.getAuthToken
          ? { getValidAuthToken: input.getAuthToken }
          : {}),
        ...(input.userDataRoot ? { userDataRoot: input.userDataRoot } : {}),
        ...(input.modelConfigId ? { modelConfigId: input.modelConfigId } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(typeof requestedResumeSession === 'string'
          ? { resumeNativeSessionId: requestedResumeSession }
          : {}),
        // Resource selection is a dedicated post-review capability. All
        // other workers consume the resulting manifest as read-only input.
        workflowWorker: true,
        workflowRunId: request.runId,
        workflowDispatchId: dispatchId,
        workflowWorkerType: request.workerType,
        ...(request.workerType === 'document-author' &&
        request.contract.documentSet === 'checklist'
          ? { workflowAllowedTools: ['Write', 'Edit'] }
          : {}),
        workflowAllowedPaths: request.allowedPaths ?? [],
        ...(request.projectReadScope
          ? { workflowProjectReadScope: request.projectReadScope }
          : {}),
        ...(request.protectedPaths
          ? { workflowProtectedPaths: [...request.protectedPaths] }
          : {}),
      })
      sessions.set(dispatchId, session.id)
      requests.set(dispatchId, { ...request, dispatchId })
      documentAuthorityBlocks.set(dispatchId, documentAuthorityBlock)
      eventOffsets.set(dispatchId, 0)
      records.set(dispatchId, {
        dispatchId,
        workerType: request.workerType,
        phase: request.phase,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        revision: request.revision,
        status: 'running',
        startedAt: new Date().toISOString(),
      })
      return { sessionId: session.id, dispatchId }
    },
    async submit(dispatchId, prompt) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      const authToken = await input.getAuthToken?.()
      input.sessions.updateAuthToken(sessionId, authToken)
      const request = requests.get(dispatchId)
      const confirmedBriefContext =
        input.confirmedBriefContext ??
        (await input.getConfirmedBriefContext?.())
      const workerBriefContext =
        request?.workerType === 'document-author'
          ? confirmedBriefContext
          : undefined
      const languageInstruction = input.language
        ? `User-facing status language: ${input.language}. Write status and final-response prose in this language; keep contract identifiers and enum values unchanged.`
        : ''
      const documentAuthorAuthorityBlock =
        documentAuthorityBlocks.get(dispatchId) ||
        (request
          ? await buildDocumentAuthorAuthorityBlock(request)
          : '')
      const nativeToolAutonomyInstruction =
        request && request.workerType !== 'document-author'
          ? "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged. Use native capabilities as needed to complete and verify this task."
          : ''
      const workerPrompt = [
        languageInstruction,
        workerBriefContext,
        documentAuthorAuthorityBlock,
        prompt,
        nativeToolAutonomyInstruction,
      ]
        .filter(Boolean)
        .join('\n\n')
      await input.sessions.sendWithDisplay(sessionId, workerPrompt, {
        taskType: taskTypeForWorker(
          records.get(dispatchId)?.workerType ?? 'question-answerer',
        ),
        displayKind: 'workflow_worker',
        ...(workerBriefContext
          ? { confirmedBriefContext: workerBriefContext }
          : {}),
        ...(authToken ? { authToken } : {}),
        ...(input.language ? { language: input.language } : {}),
      })
    },
    async stop(dispatchId, reason) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
      input.sessions.stop(sessionId)
      records.set(dispatchId, {
        ...(records.get(dispatchId) ?? {
          dispatchId,
          workerType: 'question-answerer',
          phase: 'BRIEF_CONFIRMED',
          revision: 'unknown',
          startedAt: new Date().toISOString(),
        }),
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
        terminalEvidencePath: reason,
      })
    },
    async close(dispatchId, options) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
      try {
        if (!options?.preserveSession) {
          const session = input.sessions.get(sessionId)
          if (
            session?.status === 'running' &&
            typeof input.sessions.stop === 'function'
          )
            input.sessions.stop(sessionId)
          await disposeWorkflowSession(sessionId)
        }
      } finally {
        sessions.delete(dispatchId)
        records.delete(dispatchId)
        requests.delete(dispatchId)
        documentAuthorityBlocks.delete(dispatchId)
        eventOffsets.delete(dispatchId)
      }
    },
    async status(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      const session = sessionId ? input.sessions.get(sessionId) : undefined
      const record = records.get(dispatchId)
      if (record)
        return {
          ...record,
          ...(session?.status === 'stopped'
            ? { status: 'interrupted' as const }
            : {}),
        }
      if (!session) throw new Error('worker session is not registered')
      return {
        dispatchId,
        workerType: 'question-answerer',
        phase: 'BRIEF_CONFIRMED',
        revision: 'unknown',
        status: session.turnStatus === 'running' ? 'running' : 'completed',
        startedAt: session.createdAt.toISOString(),
      }
    },
    async hasInFlightMutation(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) return false
      return hasInFlightResourceMutation(input.sessions.events(sessionId))
    },
    async waitForTerminal(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      let closedTurnDrained = false
      // Recovery policy belongs to the dispatcher. A transport-level fixed
      // deadline would fail a worker that is still making durable progress.
      while (true) {
        const eventOffset = eventOffsets.get(dispatchId) ?? 0
        const events = sessionEvents(sessionId).slice(eventOffset)
        const request = requests.get(dispatchId)
        const result = [...events]
          .reverse()
          .find(
            event =>
              event.type === 'result' ||
              event.type === 'turn.failed' ||
              event.type === 'turn.empty',
          )
        if (result) {
          // A foreground result does not end a native turn that launched
          // background subagents. Their files and usage must settle before the
          // host validates and accepts the worker output.
          if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
            await input.sessions.waitForWorkflowWorkerIdle(sessionId)
          const terminalEvents = events
          const drainedFailure = [...terminalEvents]
            .reverse()
            .find(event => event.type === 'turn.failed')
          if (drainedFailure) {
            const error = new Error(
              drainedFailure.text || 'document author stream commit failed',
            )
            if (error.message.startsWith('foundation_transport_needs_action:'))
              error.name = 'WorkerNeedsActionError'
            throw error
          }
          if (result.type !== 'result')
          {
            const error = new Error(
              result.text || 'worker turn did not produce a terminal result',
            )
            if (error.message.startsWith('foundation_transport_needs_action:'))
              error.name = 'WorkerNeedsActionError'
            throw error
          }
          if (request?.workerType === 'resource-planner') {
            return createDeterministicResourcePlannerTerminal({
              request,
              events,
            })
          }
          if (request?.workerType === 'content-author') {
            return createDeterministicContentAuthorTerminal({ request, events })
          }
          if (request && isDocumentAuthor(request)) {
            const targetPath = request.allowedPaths?.[0]
            if (!targetPath)
              throw new Error('document author target is missing')
            let body: string
            try {
              body = await readFile(
                resolve(request.workspacePath, targetPath),
                'utf8',
              )
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new Error(
                  `document author output is missing: ${targetPath}`,
                )
              throw error
            }
            if (!body.trim())
              throw new Error(
                `document author output is missing: ${targetPath}`,
              )
            return createDeterministicDocumentAuthorTerminal(
              request,
              [targetPath],
              documentAuthoringMetrics(sessionEvents(sessionId)),
            )
          }
          if (request)
            return createDeterministicStructuredTerminal({ request, events })
          throw new Error('worker has no terminal result handler')
        }
        if (
          typeof input.sessions.isWorkflowWorkerOpen === 'function' &&
          !input.sessions.isWorkflowWorkerOpen(dispatchId)
        ) {
          if (!closedTurnDrained) {
            if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
              await input.sessions.waitForWorkflowWorkerIdle(sessionId)
            closedTurnDrained = true
            continue
          }
          const error = new Error(
            'worker stopped before producing a durable terminal result',
          )
          error.name = 'WorkerNeedsActionError'
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
  }
}

function isDocumentAuthor(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'document-author'
}




function createDeterministicDocumentAuthorTerminal(
  request: WorkerDispatchRequest,
  writtenPaths: string[],
  authoringMetrics?: ReturnType<typeof documentAuthoringMetrics>,
) {
  if (!isDocumentAuthor(request))
    throw new Error('document author contract is invalid')
  return documentAuthorTerminalSchema.parse({
    workerType: 'document-author',
    status: 'completed',
    writtenPaths,
    resolvedFindingIds: [],
    ...(authoringMetrics ? { authoringMetrics } : {}),
  })
}

async function createDeterministicStructuredTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  switch (input.request.workerType) {
    case 'document-author':
      throw new Error(
        'canonical document completion must use its commit receipt',
      )
    case 'implementation-worker':
      return createDeterministicImplementationWorkerTerminal(input)
    case 'change-impact-analyzer':
      return createNaturalChangeImpactTerminal(input)
    case 'question-answerer':
      return createNaturalQuestionAnswerTerminal(input)
    case 'resource-planner':
      return createDeterministicResourcePlannerTerminal(input)
    case 'content-author':
      return createDeterministicContentAuthorTerminal(input)
    default:
      throw new Error(`retired delivery worker: ${input.request.workerType}`)
  }
}

async function writeCanonicalTerminalEvidence(input: {
  workspacePath: string
  evidencePath: string
  value: unknown
}): Promise<void> {
  const absolutePath = resolveWorkflowEvidencePath(
    input.workspacePath,
    input.evidencePath,
  )
  if (!absolutePath) throw new Error('workflow evidence path is invalid')
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(
    absolutePath,
    `${JSON.stringify(input.value, null, 2)}\n`,
    'utf8',
  )
}

function finalResultText(
  events: ReturnType<BeeGameSessionManager['events']>,
): string {
  const text = [...events]
    .reverse()
    .find(event => event.type === 'result' && event.text.trim())
    ?.text.trim()
  if (!text) throw new Error('worker completed without a final response')
  return text
}

function parseIdLine(report: string, label: string): string[] {
  const value = report.match(new RegExp(`(?:^|\\n)${label}:\\s*(.+?)\\s*$`, 'imu'))?.[1]?.trim()
  if (!value) throw new Error(`change impact report is missing ${label}`)
  if (value.toUpperCase() === 'NONE') return []
  return [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))]
}

async function createNaturalChangeImpactTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const report = finalResultText(input.events)
  const classification = report.match(
    /(?:^|\n)CLASSIFICATION:\s*(question|implementation_only|documents_required)\s*$/imu,
  )?.[1]?.toLowerCase()
  const rationale = report.match(/(?:^|\n)RATIONALE:\s*(.+?)\s*$/imu)?.[1]?.trim()
  if (!classification || !rationale)
    throw new Error('change impact worker completed without the required final report')
  const evidencePath = `.beegame/workflow/evidence/change-impact-${input.request.dispatchId}.json`
  const terminal = changeImpactTerminalSchema.parse({
    workerType: 'change-impact-analyzer',
    classification,
    affectedRequirementIds: parseIdLine(report, 'AFFECTED_REQUIREMENTS'),
    affectedChecklistIds: parseIdLine(report, 'AFFECTED_CHECKLIST'),
    rationale,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

async function createNaturalQuestionAnswerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const answer = finalResultText(input.events)
  const evidencePath = `.beegame/workflow/evidence/question-answer-${input.request.dispatchId}.json`
  const terminal = questionAnswerTerminalSchema.parse({
    workerType: 'question-answerer',
    answer,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

const WORKSPACE_MUTATION_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

function hasInFlightResourceMutation(events: BeeGameEvent[]): boolean {
  const active = new Map<string, boolean>()
  for (const event of events) {
    const toolUseId = String(event.payload?.toolUseID ?? '')
    if (!toolUseId) continue
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      active.delete(toolUseId)
      continue
    }
    if (event.type !== 'tool.started') continue
    const toolName = String(event.payload?.toolName ?? '')
    if (
      WORKSPACE_MUTATION_TOOLS.has(toolName)
    )
      active.set(toolUseId, true)
  }
  return active.size > 0
}

async function createDeterministicResourcePlannerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const contract = auditAssetContract(input.request.workspacePath)
  const observedMutationPaths = completedMutationPaths(
    input.request.workspacePath,
    input.events,
  )
  const writtenPaths = [
    ...new Set([
      ...(contract.present ? ['assets/asset-manifest.json'] : []),
      ...contract.resources.flatMap(resource => resource.filePaths),
      ...observedMutationPaths,
    ]),
  ]
  if (input.request.workerType !== 'resource-planner')
    throw new Error('resource planner terminal received another worker type')
  // A terminal means the CLI turn ended, not that its artifacts passed.
  // completeResourceTask owns acceptance and recoverable artifact diagnostics.
  return resourcePlannerTerminalSchema.parse({
    revision: input.request.revision,
    workerType: 'resource-planner' as const,
    status: 'completed' as const,
    writtenPaths,
  })
}

function createDeterministicContentAuthorTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  if (input.request.workerType !== 'content-author')
    throw new Error('content author terminal received another worker type')
  const writtenPaths = [...new Set(
    completedMutationPaths(input.request.workspacePath, input.events).filter(
      path => path === 'content' || path.startsWith('content/'),
    ),
  )]
  return contentAuthorTerminalSchema.parse({
    workerType: 'content-author',
    revision: input.request.revision,
    status: 'completed',
    writtenPaths,
  })
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function createDeterministicImplementationWorkerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const changedPaths = [...new Set(
    completedMutationPaths(input.request.workspacePath, input.events),
  )]
  const evidencePath = `.beegame/workflow/evidence/implementation-${input.request.dispatchId}.json`
  return implementationWorkerTerminalSchema.parse({
    workerType: 'implementation-worker',
    taskId: input.request.taskId,
    revision: input.request.revision,
    status: 'completed',
    changedPaths,
    verifiedArtifacts: changedPaths,
    summary: finalResultText(input.events),
    verificationResults: [],
    evidenceRefs: [evidencePath],
    evidencePath,
  })
}

function completedMutationPaths(
  workspacePath: string,
  events: ReturnType<BeeGameSessionManager['events']>,
): string[] {
  const completedToolUseIds = new Set(
    events.flatMap(event => {
      if (event.type !== 'tool.completed') return []
      const toolUseID = event.payload?.toolUseID
      return typeof toolUseID === 'string' && toolUseID ? [toolUseID] : []
    }),
  )
  return events.flatMap(event => {
    if (event.type !== 'tool.started') return []
    const toolUseID = event.payload?.toolUseID
    if (typeof toolUseID !== 'string' || !completedToolUseIds.has(toolUseID))
      return []
    if (
      !['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(
        String(event.payload?.toolName),
      )
    )
      return []
    const toolInput = event.payload?.input
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput))
      return []
    const record = toolInput as Record<string, unknown>
    return [record.file_path, record.path, record.notebook_path]
      .filter(
        (value): value is string =>
          typeof value === 'string' && Boolean(value.trim()),
      )
      .map(value =>
        relative(
          resolve(workspacePath),
          resolve(workspacePath, value),
        ).replaceAll('\\', '/'),
      )
  })
}
