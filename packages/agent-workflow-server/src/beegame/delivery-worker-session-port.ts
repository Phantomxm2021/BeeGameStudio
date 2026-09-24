import { randomUUID } from 'node:crypto'
import { responseLanguageInstruction } from './response-language'
import { openResourceLibraryAccess } from './resource-library-access'
import { PREVIEW_ENVIRONMENT } from '@bee-game-studio/agent-workflow/preview-environment'
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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
import { acceptanceValidatorTerminalSchema } from './delivery-workflow/worker-contracts'
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
import { CONTENT_CONSUMER_INSTRUCTION } from './game-content-consumer-cli'
import { isProjectChange } from './delivery-workflow/change-request'
import { readRuntimeAcceptance, runtimeAcceptancePath } from './delivery-workflow/runtime-acceptance'

// Forward user-confirmed choices, not the host's global delivery instructions.
function confirmedUserScope(context: string): string {
  try {
    const brief = JSON.parse(context)
    if (!brief || brief.kind !== 'confirmed_build_brief') return ''
    return 'Confirmed user scope (generated documents do not authorize expanding this request):\n' +
      JSON.stringify({
        idea: brief.idea,
        selected_option: brief.selected_option,
        settings: brief.settings,
      })
  } catch {
    return ''
  }
}

function taskTypeForWorker(
  workerType: WorkerDispatchRequest['workerType'],
): 'edit_turn' | 'agent_turn' {
  return workerType === 'document-author' ||
    workerType === 'resource-planner' ||
    workerType === 'content-author' ||
    workerType === 'implementation-worker' ||
    workerType === 'acceptance-validator'
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
    return projection
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
  getPreviewContext?: () => { status: string; url?: string; sessionId?: string }
  resourceLibraryBaseUrl?: string
  openImageAccess?: (projectId: string) => { instruction: string; close: () => void }
  openPreviewAccess?: (context: { projectId: string; workspacePath: string; sessionId: string }) => { instruction: string; close: () => Promise<void> }
}): DeliveryWorkerPort {
  const sessions = new Map<string, string>()
  const sharedProjectSessions = new Set<string>()
  const records = new Map<string, DispatchRecord>()
  const libraryAccess = new Map<string, ReturnType<typeof openResourceLibraryAccess>>()
  const catalogObservation = new Map<string, boolean>()
  const imageAccess = new Map<string, { instruction: string; close: () => void }>()
  const previewAccess = new Map<string, { instruction: string; close: () => Promise<void> }>()
  const closeLibraryAccess = async (dispatchId: string) => {
    if (libraryAccess.get(dispatchId)?.catalogObserved()) catalogObservation.set(dispatchId, true)
    libraryAccess.get(dispatchId)?.close()
    libraryAccess.delete(dispatchId)
    imageAccess.get(dispatchId)?.close()
    imageAccess.delete(dispatchId)
    const preview = previewAccess.get(dispatchId)
    previewAccess.delete(dispatchId)
    await preview?.close()
  }
  const requests = new Map<string, WorkerDispatchRequest>()
  const documentAuthorityBlocks = new Map<string, string>()
  const eventOffsets = new Map<string, number>()
  const sessionEvents = (sessionId: string) =>
    typeof input.sessions.events === 'function'
      ? input.sessions.events(sessionId)
      : []
  const dispatchEvents = (dispatchId: string, sessionId: string) => {
    const events = sessionEvents(sessionId)
    return sharedProjectSessions.has(dispatchId)
      ? events.filter(event => event.payload?.workflowDispatchId === dispatchId)
      : events.slice(eventOffsets.get(dispatchId) ?? 0)
  }
  const disposeWorkflowSession = async (sessionId: string) => {
    if (typeof input.sessions.disposeWorkflowWorker === 'function')
      await input.sessions.disposeWorkflowWorker(sessionId)
    else if (typeof input.sessions.stop === 'function')
      input.sessions.stop(sessionId, 'worker_disposed')
  }
  return {
    async start(request: WorkerDispatchRequest) {
      if (isProjectChange(request)) throw new Error('Project requests use the native project conversation, not worker sessions')
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
      let session
      const findProjectSession = input.sessions.projectConversationSessionId
      const projectSessionId = typeof findProjectSession === 'function'
        ? findProjectSession.call(input.sessions, input.userId, request.projectId, request.workspacePath)
        : undefined
      if (projectSessionId) {
        session = input.sessions.get(projectSessionId)
        if (!session || session.status !== 'running')
          throw new Error('Project conversation session is not available for the next production stage')
        sharedProjectSessions.add(dispatchId)
      } else if (typeof findProjectSession === 'function') {
        throw new Error('Project conversation session is required; refusing to start a separate workflow session')
      } else try { session = input.sessions.start({
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
        // Native implementation chooses when to coordinate targeted resource
        // repair; no extra host workflow or tool sequence.
        workflowWorker: true,
        workflowRunId: request.runId,
        workflowDispatchId: dispatchId,
        workflowWorkerType: request.workerType,
        ...(request.protectedPaths
          ? { workflowProtectedPaths: [...request.protectedPaths] }
          : {}),
      }) } catch (error) {
        throw error
      }
      sessions.set(dispatchId, session.id)
      requests.set(dispatchId, { ...request, dispatchId })
      documentAuthorityBlocks.set(dispatchId, documentAuthorityBlock)
      eventOffsets.set(dispatchId, projectSessionId ? sessionEvents(session.id).length : 0)
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
      try {
      let resourceAccessInstruction = ''
      if (request?.workerType === 'resource-planner' || request?.workerType === 'implementation-worker') {
        if (input.openImageAccess && !imageAccess.has(dispatchId))
          imageAccess.set(dispatchId, input.openImageAccess(request.projectId))
        if (input.resourceLibraryBaseUrl && input.getAuthToken) {
          if (!libraryAccess.has(dispatchId))
            libraryAccess.set(dispatchId, openResourceLibraryAccess({
              baseUrl: input.resourceLibraryBaseUrl,
              getAuthToken: input.getAuthToken,
            }))
          resourceAccessInstruction = libraryAccess.get(dispatchId)!.instruction
        } else {
          resourceAccessInstruction = 'Built-in resource library access is not configured for this run. This is a capability gap, not proof that no matching assets exist. Use native internet search/browser or Bash HTTP tools for external sources and report the library limitation accurately.'
        }
        resourceAccessInstruction += '\n\n' + (imageAccess.get(dispatchId)?.instruction
          ?? 'Platform AI image generation access is unavailable. Do not claim it was used.')
      }
      const confirmedBriefContext =
        input.confirmedBriefContext ??
        (await input.getConfirmedBriefContext?.())
      if ((request?.workerType === 'implementation-worker' || request?.workerType === 'acceptance-validator') &&
          input.openPreviewAccess && !previewAccess.has(dispatchId)) {
        previewAccess.set(dispatchId, input.openPreviewAccess({ projectId: request.projectId,
          workspacePath: request.workspacePath, sessionId }))
      }
      const languageInstruction = responseLanguageInstruction(input.language)
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
        request?.workerType === 'implementation-worker' ? CONTENT_CONSUMER_INSTRUCTION : '',
        ...(request?.workerType !== 'document-author' && confirmedBriefContext
          ? [confirmedUserScope(confirmedBriefContext)]
          : []),
        documentAuthorAuthorityBlock,
        prompt,
        resourceAccessInstruction,
        previewAccess.get(dispatchId)?.instruction,
        ...(request?.workerType === 'implementation-worker' || request?.workerType === 'acceptance-validator'
          ? [`Actual host Preview environment: ${JSON.stringify({
              ...PREVIEW_ENVIRONMENT,
              projectId: request.projectId,
              ...(input.getPreviewContext?.() ?? { status: 'not-running' }),
            })}`]
          : []),
        nativeToolAutonomyInstruction,
      ]
        .filter(Boolean)
        .join('\n\n')
      await input.sessions.sendWithDisplay(sessionId, workerPrompt, {
        taskType: taskTypeForWorker(
          records.get(dispatchId)?.workerType ?? 'question-answerer',
        ),
        displayKind: 'workflow_worker',
        workflowContext: {
          runId: request?.runId ?? '',
          dispatchId,
          workerType: request?.workerType ?? records.get(dispatchId)?.workerType ?? 'question-answerer',
          phase: request?.phase ?? records.get(dispatchId)?.phase ?? 'BRIEF_CONFIRMED',
          ...(request?.protectedPaths ? { protectedPaths: [...request.protectedPaths] } : {}),
        },
        ...(authToken ? { authToken } : {}),
        ...(input.language ? { language: input.language } : {}),
      })
      } catch (error) {
        await closeLibraryAccess(dispatchId)
        throw error
      }
    },
    async stop(dispatchId, reason) {
      const sessionId = sessions.get(dispatchId)
      // Stop model/tool work immediately, not after preview readiness/cleanup.
      if (sessionId) {
        if (sharedProjectSessions.has(dispatchId)) input.sessions.interruptTurn?.(sessionId, reason)
        else input.sessions.stop(sessionId, reason)
      }
      await closeLibraryAccess(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
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
      await closeLibraryAccess(dispatchId)
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) {
        await input.sessions.disposeWorkflowDispatch?.(dispatchId)
        return
      }
      let disposed = false
      try {
        if (sharedProjectSessions.has(dispatchId)) {
          // This dispatch borrowed the project's primary conversation. Closing
          // the phase must never dispose that project session.
        } else if (!options?.preserveSession) {
          const session = input.sessions.get(sessionId)
          if (
            session?.status === 'running' &&
            typeof input.sessions.stop === 'function'
          )
            input.sessions.stop(sessionId, 'worker_disposed')
          await disposeWorkflowSession(sessionId)
          disposed = true
        }
      } finally {
        sessions.delete(dispatchId)
        records.delete(dispatchId)
        requests.delete(dispatchId)
        catalogObservation.delete(dispatchId)
        documentAuthorityBlocks.delete(dispatchId)
        eventOffsets.delete(dispatchId)
        sharedProjectSessions.delete(dispatchId)
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
      let turnStarted = false
      // Recovery policy belongs to the dispatcher. A transport-level fixed
      // deadline would fail a worker that is still making durable progress.
      while (true) {
        const dispatch = records.get(dispatchId)
        if (dispatch?.status === 'interrupted') {
          const error = new Error('Production stage was interrupted')
          error.name = 'WorkerNeedsActionError'
          throw error
        }
        let events = dispatchEvents(dispatchId, sessionId)
        if (events.some(event => event.type === 'turn.started')) turnStarted = true
        const request = requests.get(dispatchId)
        let result = [...events]
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
          if (sharedProjectSessions.has(dispatchId))
            await input.sessions.waitForSessionIdle(sessionId)
          else if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
            await input.sessions.waitForWorkflowWorkerIdle(sessionId)
          await closeLibraryAccess(dispatchId)
          events = dispatchEvents(dispatchId, sessionId)
          result = [...events].reverse().find(event =>
            event.type === 'result' || event.type === 'turn.failed' || event.type === 'turn.empty')
          if (!result) throw new Error('worker completed without a terminal result')
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
              catalogObserved: catalogObservation.get(dispatchId) === true,
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
          !sharedProjectSessions.has(dispatchId) &&
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
        if (sharedProjectSessions.has(dispatchId) && turnStarted &&
            input.sessions.get(sessionId)?.turnStatus === 'idle' && !closedTurnDrained) {
          await input.sessions.waitForSessionIdle(sessionId)
          closedTurnDrained = true
          continue
        }
        if (sharedProjectSessions.has(dispatchId) && turnStarted &&
            input.sessions.get(sessionId)?.turnStatus === 'idle' && closedTurnDrained) {
          const error = new Error('Project conversation turn ended without a terminal result')
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
    case 'acceptance-validator': {
      const report = await readRuntimeAcceptance(input.request.workspacePath, input.request.dispatchId!)
      if (!report) throw new Error('Acceptance Agent did not save its runtime result')
      const evidencePath = `.beegame/delivery/evidence/acceptance-review-${input.request.dispatchId}.json`
      const terminal = acceptanceValidatorTerminalSchema.parse({ workerType: 'acceptance-validator',
        status: 'completed', revision: input.request.revision, evidencePath })
      await writeCanonicalTerminalEvidence({ workspacePath: input.request.workspacePath, evidencePath,
        value: { ...terminal, runtimeAcceptance: report } })
      return terminal
    }
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
  const evidencePath = `.beegame/delivery/evidence/change-impact-${input.request.dispatchId}.json`
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
  const evidencePath = `.beegame/delivery/evidence/question-answer-${input.request.dispatchId}.json`
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
  catalogObserved?: boolean
}) {
  const contract = auditAssetContract(input.request.workspacePath)
  const observedMutationPaths = completedProjectMutationPaths(
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
    catalogObserved: input.catalogObserved === true,
  })
}

function createDeterministicContentAuthorTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  if (input.request.workerType !== 'content-author')
    throw new Error('content author terminal received another worker type')
  const writtenPaths = [...new Set(
    completedProjectMutationPaths(input.request.workspacePath, input.events).filter(
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
    completedProjectMutationPaths(input.request.workspacePath, input.events),
  )]
  const evidencePath = `.beegame/delivery/evidence/implementation-${input.request.dispatchId}.json`
  return implementationWorkerTerminalSchema.parse({
    workerType: 'implementation-worker',
    taskId: input.request.taskId,
    revision: input.request.revision,
    status: 'completed',
    changedPaths,
    // Mutations are not verification evidence (the file may even be deleted).
    verifiedArtifacts: [],
    summary: finalResultText(input.events),
    verificationResults: [],
    evidenceRefs: [evidencePath],
    evidencePath,
  })
}

export function completedProjectMutationPaths(
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
      // changedPaths is a project-deliverable list, not the native activity log.
      // Native memory/tool scratch files remain in the transcript, but are not
      // game artifacts. Execution authority remains responsible for permissions.
      .filter(path => path !== '' && path !== '..' && !path.startsWith('../')
        && !isAbsolute(path) && path !== '.beegame/tmp' && !path.startsWith('.beegame/tmp/'))
  })
}
