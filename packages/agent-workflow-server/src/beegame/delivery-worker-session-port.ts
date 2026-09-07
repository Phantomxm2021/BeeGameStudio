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
import { atomicTaskPlannerTerminalSchema } from './delivery-workflow/worker-contracts'
import { implementationWorkerTerminalSchema } from './delivery-workflow/worker-contracts'
import {
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  documentAuthorTerminalSchema,
  implementationAuditorTerminalSchema,
  questionAnswerTerminalSchema,
  resourceCuratorTerminalSchema,
  resourcePlannerTerminalSchema,
} from './delivery-workflow/worker-contracts'
import type {
  BeeGameSessionManager,
  BeeGameEvent,
  BeeGameSessionLanguage,
} from './session-manager'
import type { ResourceSelectionRuntimeConfig } from './resource-selection-config'
import {
  createResourceContentTerminalFromReceipt,
  readResourceContentCommitReceipt,
  resourceContentCommitContractSchema,
} from './native-resource-content-tool'
import { readCurrentCommittedResourceInventoryReceipt } from './resource-inventory-commit'
import { assertSharedDocumentWorker } from './delivery-workflow/retired-foundation-author'
import { buildChecklistAuthorityProjection } from './checklist-authority-projection'
import { documentAuthoringMetrics } from './document-authoring-metrics'

function taskTypeForWorker(
  workerType: WorkerDispatchRequest['workerType'],
): 'edit_turn' | 'agent_turn' {
  return workerType === 'document-author' ||
    workerType === 'resource-planner' ||
    workerType === 'resource-curator' ||
    workerType === 'resource-content-author' ||
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
    if (typeof request.contract.approvedDocumentRevision !== 'string')
      throw new Error('checklist authority revision is missing')
    const projection = await buildChecklistAuthorityProjection({
      workspacePath: request.workspacePath,
      approvedDocumentRevision: request.contract.approvedDocumentRevision,
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
  resourceSelectionConfig?: ResourceSelectionRuntimeConfig
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
      if (['foundation-fact-extractor', 'foundation-semantic-reviewer', 'foundation-document-reviser'].includes(request.workerType))
        throw new Error('Legacy Foundation workers are retired; use the stage public host')
      assertSharedDocumentWorker(request)
      const dispatchId = request.dispatchId ?? randomUUID()
      const requestedResumeSession = request.contract.resumeWorkerSessionId
      if (requestedResumeSession !== undefined)
        throw new Error('document author session resume is not supported')
      const documentAuthorityBlock =
        request.workerType === 'document-author' &&
        request.contract.documentSet === 'checklist'
          ? await buildDocumentAuthorAuthorityBlock(request)
          : ''
      if (request.workerType === 'atomic-task-planner') {
        await mkdir(join(request.workspacePath, '.beegame/workflow/evidence'), {
          recursive: true,
        })
      }
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
        // Resource selection is a dedicated post-review capability. All
        // other workers consume the resulting manifest as read-only input.
        ...(request.workerType === 'resource-curator'
          ? { resourceSelectionConfig: input.resourceSelectionConfig }
          : {}),
        workflowWorker: true,
        workflowRunId: request.runId,
        workflowDispatchId: dispatchId,
        workflowWorkerType: request.workerType,
        ...(request.workerType === 'document-author' && request.contract.documentSet === 'checklist'
          ? { workflowAllowedTools: ['Write', 'Edit'] }
          : {}),
        ...(request.contract.modelTier === 'fast' || request.contract.modelTier === 'balanced' || request.contract.modelTier === 'strong' ? { workflowModelTier: request.contract.modelTier } : {}),
        workflowAllowedPaths: request.allowedPaths ?? [],
        ...(request.projectReadScope
          ? { workflowProjectReadScope: request.projectReadScope }
          : {}),
        ...(request.workerType !== 'resource-content-author' &&
        request.protectedPaths
          ? { workflowProtectedPaths: [...request.protectedPaths] }
          : {}),
        ...(request.workerType === 'resource-content-author'
            ? {
                workflowReadOnlyPaths: [
                  ...(Array.isArray(request.contract.authorityPaths)
                    ? request.contract.authorityPaths.filter(
                        (path): path is string => typeof path === 'string',
                      )
                    : []),
                  ...(Array.isArray(request.contract.repairPaths)
                    ? request.contract.repairPaths.filter(
                        (path): path is string => typeof path === 'string',
                      )
                    : []),
                ],
              }
            : {}),
        ...(request.workerType === 'resource-content-author'
          ? {
              workflowResourceContentCommitContract:
                resourceContentCommitContractSchema.parse({
                  dispatchId,
                  inventoryRevision: request.contract.inventoryRevision,
                  baselineResourceRevision:
                    request.contract.baselineResourceRevision,
                  requiredRequirementIds:
                    request.contract.requiredRequirementIds,
                  verifiedResourceIds: request.contract.verifiedResourceIds,
                  inventoryBindings: request.contract.inventoryBindings,
                  writablePaths: request.contract.repairPaths ?? [],
                }),
            }
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
      const languageInstruction = input.language
        ? `User-facing status language: ${input.language}. Write any status/message text in this language; keep structured tool enum values unchanged.`
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
      const atomicTaskEvidenceInstruction =
        request?.workerType === 'atomic-task-planner'
          ? 'Submit the complete plan through SubmitAtomicTaskPlan exactly once. The workflow service persists the accepted plan as canonical evidence.'
          : ''
      const implementationResultInstruction =
        request?.workerType === 'implementation-worker'
          ? 'Submit the final result through SubmitImplementationResult exactly once. Validate the active contract and current project files; the workflow service owns task identity, revision, and canonical evidence persistence.'
          : ''
      const validationResultInstruction =
        request?.workerType === 'implementation-auditor' ||
        request?.workerType === 'acceptance-validator'
          ? 'Submit the final verdict through SubmitValidationResult exactly once. Do not author workflow evidence or return terminal JSON. The workflow service owns revision, complete contract ID coverage, and canonical evidence persistence.'
          : ''
      const workflowResultInstruction =
        request?.workerType === 'document-author'
          ? ''
          : request?.workerType === 'change-impact-analyzer'
              ? 'Submit the analysis through SubmitChangeImpactResult exactly once. Do not author workflow evidence or return terminal JSON.'
              : request?.workerType === 'question-answerer'
                ? 'Submit the answer through SubmitQuestionAnswerResult exactly once. Do not author workflow evidence or return terminal JSON.'
                : ''
      const assetManifestInstruction =
        request?.workerType === 'resource-planner'
          ? 'Use AssetManifest submit_resource_plan as the only mutation and stop after it is accepted.'
          : request?.workerType === 'resource-curator'
            ? 'Use ResourceLibrary match_requirements once, then CommitResourceInventory as the only mutation and terminal operation.'
            : ''
      const workerPrompt = [
        languageInstruction,
        confirmedBriefContext,
        documentAuthorAuthorityBlock,
        prompt,
        nativeToolAutonomyInstruction,
        atomicTaskEvidenceInstruction,
        implementationResultInstruction,
        validationResultInstruction,
        workflowResultInstruction,
        assetManifestInstruction,
      ]
        .filter(Boolean)
        .join('\n\n')
      await input.sessions.sendWithDisplay(sessionId, workerPrompt, {
        taskType: taskTypeForWorker(
          records.get(dispatchId)?.workerType ?? 'question-answerer',
        ),
        displayKind: 'workflow_worker',
        ...(confirmedBriefContext ? { confirmedBriefContext } : {}),
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
    async hasInFlightTerminalSubmission(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      const request = requests.get(dispatchId)
      if (!sessionId || !request) return false
      const terminalToolName = structuredSubmissionToolName(request)
      if (!terminalToolName) return false
      return (
        Boolean(
          input.sessions.hasInFlightToolSubmission?.(
            sessionId,
            terminalToolName,
          ),
        ) ||
        hasInFlightTool(
          sessionEvents(sessionId).slice(eventOffsets.get(dispatchId) ?? 0),
          terminalToolName,
        )
      )
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
        if (request?.workerType === 'resource-curator') {
          const receipt = await readCurrentCommittedResourceInventoryReceipt(
            request.workspacePath,
          )
          if (receipt) {
            const contract = auditAssetContract(request.workspacePath)
            return resourceCuratorTerminalSchema.parse({
              revision: request.revision,
              workerType: 'resource-curator',
              status: 'completed',
              catalogObserved: true,
              resourceIds: contract.resources.map(resource => resource.id),
              bindings: receipt.bindings,
              writtenPaths: [
                'assets/asset-manifest.json',
                ...contract.resources.flatMap(resource => resource.filePaths),
              ],
              taskMetrics: resourceTaskMetrics(events),
            })
          }
        }
        if (request?.workerType === 'resource-content-author') {
          const receipt = readResourceContentCommitReceipt(
            request.workspacePath,
            request.dispatchId ?? dispatchId,
          )
          if (receipt?.status === 'committed')
            return createResourceContentTerminalFromReceipt({
              workspacePath: request.workspacePath,
              revision: request.revision,
              receipt,
            })
          if (receipt?.status === 'prepared') {
            await new Promise(resolve => setTimeout(resolve, 250))
            continue
          }
        }
        // The accepted structured submission is durable workflow evidence, but
        // Bee Game Studio still owns its normal turn completion. Drain the native
        // turn before the workflow controller is allowed to close the session.
        if (request && hasCompletedStructuredSubmission(request, events)) {
          if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
            await input.sessions.waitForWorkflowWorkerIdle(sessionId)
          return createDeterministicStructuredTerminal({ request, events })
        }
        const result = [...events]
          .reverse()
          .find(
            event =>
              event.type === 'result' ||
              event.type === 'turn.failed' ||
              event.type === 'turn.empty',
          )
        if (result) {
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
          if (result.type === 'result' || result.type === 'turn.empty') {
            const missingTerminal = request
              ? missingStructuredTerminalError(request, events)
              : undefined
            if (missingTerminal) throw missingTerminal
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
          if (request?.workerType === 'resource-curator')
            throw new Error(
              'resource curator completed without an accepted durable inventory receipt',
            )
          if (request?.workerType === 'resource-content-author')
            throw new Error(
              'resource content author completed without an accepted durable receipt',
            )
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
            if (typeof input.sessions.waitForWorkflowWorkerIdle === 'function')
              await input.sessions.waitForWorkflowWorkerIdle(sessionId)
            return createDeterministicDocumentAuthorTerminal(
              request,
              [targetPath],
              documentAuthoringMetrics(sessionEvents(sessionId)),
            )
          }
          if (request)
            return createDeterministicStructuredTerminal({ request, events })
          throw new Error('worker has no structured terminal result channel')
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

function structuredSubmissionToolName(
  request: WorkerDispatchRequest,
): string | undefined {
  switch (request.workerType) {
    case 'document-author':
      return undefined
    case 'atomic-task-planner':
      return 'SubmitAtomicTaskPlan'
    case 'implementation-worker':
      return 'SubmitImplementationResult'
    case 'implementation-auditor':
    case 'acceptance-validator':
      return 'SubmitValidationResult'
    case 'change-impact-analyzer':
      return 'SubmitChangeImpactResult'
    case 'question-answerer':
      return 'SubmitQuestionAnswerResult'
    case 'resource-content-author':
      return undefined
    case 'resource-planner':
    case 'resource-curator':
      return undefined
  }
}

function hasCompletedStructuredSubmission(
  request: WorkerDispatchRequest,
  events: ReturnType<BeeGameSessionManager['events']>,
): boolean {
  const toolName = structuredSubmissionToolName(request)
  return Boolean(
    toolName &&
      events.some(
        event =>
          event.type === 'tool.completed' &&
          event.payload?.toolName === toolName,
      ),
  )
}

function missingStructuredTerminalError(
  request: WorkerDispatchRequest,
  events: ReturnType<BeeGameSessionManager['events']>,
): Error | undefined {
  const toolName = structuredSubmissionToolName(request)
  if (!toolName) return undefined
  if (
    events.some(
      event =>
        event.type === 'tool.failed' && event.payload?.toolName === toolName,
    )
  )
    return undefined
  const error = new Error(`missing_required_terminal_submission: ${toolName}`)
  error.name = 'WorkerNeedsActionError'
  return error
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
    case 'atomic-task-planner':
      return createDeterministicAtomicTaskPlannerTerminal(input)
    case 'implementation-worker':
      return createDeterministicImplementationWorkerTerminal(input)
    case 'implementation-auditor':
    case 'acceptance-validator':
      return createDeterministicValidationTerminal(input)
    case 'change-impact-analyzer':
      return createDeterministicChangeImpactTerminal(input)
    case 'question-answerer':
      return createDeterministicQuestionAnswerTerminal(input)
    case 'resource-planner':
      return createDeterministicResourcePlannerTerminal(input)
    case 'resource-curator':
      throw new Error(
        'resource curator terminal requires a committed durable inventory receipt',
      )
    case 'resource-content-author':
      throw new Error(
        'resource content terminal requires a committed durable content receipt',
      )
  }
}

function completedToolInputs(
  events: ReturnType<BeeGameSessionManager['events']>,
  toolName: string,
): Record<string, unknown>[] {
  return [...events].reverse().flatMap(event => {
    if (event.type !== 'tool.completed' || event.payload?.toolName !== toolName)
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
}

function failedToolCount(
  events: ReturnType<BeeGameSessionManager['events']>,
  toolName: string,
): number {
  return events.filter(
    event =>
      event.type === 'tool.failed' && event.payload?.toolName === toolName,
  ).length
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

async function createDeterministicChangeImpactTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidate = completedToolInputs(
    input.events,
    'SubmitChangeImpactResult',
  )[0]
  if (!candidate)
    throw new Error(
      'worker terminal result is missing a valid SubmitChangeImpactResult call',
    )
  const evidencePath = `.beegame/workflow/evidence/change-impact-${input.request.dispatchId}.json`
  const terminal = changeImpactTerminalSchema.parse({
    workerType: 'change-impact-analyzer',
    ...candidate,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

async function createDeterministicQuestionAnswerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidate = completedToolInputs(
    input.events,
    'SubmitQuestionAnswerResult',
  )[0]
  if (!candidate)
    throw new Error(
      'worker terminal result is missing a valid SubmitQuestionAnswerResult call',
    )
  const evidencePath = `.beegame/workflow/evidence/question-answer-${input.request.dispatchId}.json`
  const terminal = questionAnswerTerminalSchema.parse({
    workerType: 'question-answerer',
    ...candidate,
    evidencePath,
  })
  await writeCanonicalTerminalEvidence({
    workspacePath: input.request.workspacePath,
    evidencePath,
    value: terminal,
  })
  return terminal
}

async function createDeterministicValidationTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitValidationResult'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const contract = input.request.contract
      const taskIds = submittedStringArray(contract.taskIds)
      const checklistIds = submittedStringArray(contract.checklistIds)
      const resourceIds = submittedStringArray(contract.resourceIds)
      const contentIds = submittedStringArray(contract.contentIds)
      const evidencePath = `.beegame/workflow/evidence/${input.request.workerType}-${input.request.dispatchId}.json`
      const findings = deriveValidationFindings(
        candidate.findings,
        contract.tasks,
      )
      const common = {
        workerType: input.request.workerType,
        revision: input.request.revision,
        status: candidate.status,
        checklistIds,
        resourceIds,
        contentIds,
        findings,
        evidencePath,
      }
      const terminal =
        input.request.workerType === 'implementation-auditor'
          ? implementationAuditorTerminalSchema.parse({
              ...common,
              auditedTaskIds: taskIds,
            })
          : acceptanceValidatorTerminalSchema.parse({
              ...common,
              validatedTaskIds: taskIds,
            })
      const absolutePath = resolveWorkflowEvidencePath(
        input.request.workspacePath,
        evidencePath,
      )
      if (!absolutePath) throw new Error('validation evidence path is invalid')
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, `${JSON.stringify(terminal)}\n`, 'utf8')
      return terminal
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `validation result does not match the active contract: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitValidationResult call',
  )
}

function deriveValidationFindings(
  value: unknown,
  taskValue: unknown,
): unknown[] {
  const tasks = Array.isArray(taskValue)
    ? taskValue.flatMap(task => {
        if (!task || typeof task !== 'object' || Array.isArray(task)) return []
        const record = task as Record<string, unknown>
        if (typeof record.id !== 'string') return []
        return [
          {
            id: record.id,
            allowedPaths: submittedStringArray(record.allowedPaths),
            checklistIds: submittedStringArray(record.checklistIds),
          },
        ]
      })
    : []
  return Array.isArray(value)
    ? value.map(finding => {
        const record = finding as Record<string, unknown>
        const artifactPaths = submittedStringArray(record.artifactPaths)
        const owners = tasks.filter(task =>
          artifactPaths.some(artifactPath =>
            task.allowedPaths.some(scope =>
              validationScopeContains(scope, artifactPath),
            ),
          ),
        )
        return {
          artifactPaths,
          description: record.description,
          requiredAction: record.requiredAction,
          taskIds: [...new Set(owners.map(owner => owner.id))],
          checklistIds: [
            ...new Set(owners.flatMap(owner => owner.checklistIds)),
          ],
        }
      })
    : []
}

function validationScopeContains(scope: string, artifactPath: string): boolean {
  const normalize = (value: string): string => {
    let normalized = value.replaceAll('\\', '/')
    while (normalized.startsWith('./')) normalized = normalized.slice(2)
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  }
  const normalizedScope = normalize(scope)
  const normalizedArtifact = normalize(artifactPath)
  return (
    normalizedArtifact === normalizedScope ||
    normalizedArtifact.startsWith(`${normalizedScope}/`)
  )
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
      WORKSPACE_MUTATION_TOOLS.has(toolName) ||
      toolName === 'CommitResourceInventory' ||
      toolName === 'AssetManifest' ||
      toolName === 'CommitResourceContent'
    )
      active.set(toolUseId, true)
  }
  return active.size > 0
}

function hasInFlightTool(
  events: BeeGameEvent[],
  expectedToolName: string,
): boolean {
  const active = new Set<string>()
  for (const event of events) {
    const toolUseId = String(event.payload?.toolUseID ?? '')
    if (!toolUseId) continue
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      active.delete(toolUseId)
      continue
    }
    if (
      event.type === 'tool.started' &&
      String(event.payload?.toolName ?? '') === expectedToolName
    )
      active.add(toolUseId)
  }
  return active.size > 0
}

async function createDeterministicResourcePlannerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const taskMetrics = resourceTaskMetrics(input.events)
  const contract = auditAssetContract(input.request.workspacePath)
  const observedMutationPaths = completedMutationPaths(
    input.request.workspacePath,
    input.events,
  )
  const writtenPaths = [
    ...new Set([
      ...(contract.present ? ['assets/asset-manifest.json'] : []),
      ...contract.resources.flatMap(resource => resource.filePaths),
      ...contract.content.files.map(file => file.path),
      ...observedMutationPaths,
    ]),
  ]
  if (input.request.workerType !== 'resource-planner')
    throw new Error('resource planner terminal received another worker type')
  const submission = completedToolInputs(input.events, 'AssetManifest').find(
    candidate => candidate.action === 'submit_resource_plan',
  )
  if (!submission || !contract.present || contract.requirements.length === 0)
    throw new Error(
      'resource planner completed without an accepted canonical resource plan',
    )
  return resourcePlannerTerminalSchema.parse({
    revision: input.request.revision,
    workerType: 'resource-planner' as const,
    status: 'completed' as const,
    writtenPaths: ['assets/asset-manifest.json'],
    taskMetrics,
  })
}

function resourceTaskMetrics(
  events: ReturnType<BeeGameSessionManager['events']>,
) {
  const completed = events.filter(event => event.type === 'tool.completed')
  const catalogCalls = completed.flatMap(event => {
    if (event.payload?.toolName !== 'ResourceLibrary') return []
    const input = event.payload.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) return []
    const action = (input as Record<string, unknown>).action
    if (typeof action !== 'string' || !action) return []
    const output = event.payload.output
    const serialized =
      typeof output === 'string' ? output : JSON.stringify(output ?? null)
    return [{ action, bytes: new TextEncoder().encode(serialized).byteLength }]
  })
  const canonicalMutationCount = completed.filter(event => {
    const toolName = String(event.payload?.toolName ?? '')
    if (WORKSPACE_MUTATION_TOOLS.has(toolName)) return true
    const input = event.payload?.input
    const action =
      input && typeof input === 'object' && !Array.isArray(input)
        ? String((input as Record<string, unknown>).action ?? '')
        : ''
    if (toolName === 'CommitResourceInventory') return true
    return toolName === 'AssetManifest' && action === 'submit_resource_plan'
  }).length
  return {
    catalogPayloadBytes: catalogCalls.reduce(
      (total, call) => total + call.bytes,
      0,
    ),
    catalogCallTypes: [...new Set(catalogCalls.map(call => call.action))],
    canonicalMutationCount,
  }
}

async function createDeterministicAtomicTaskPlannerTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitAtomicTaskPlan'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const evidencePath = `.beegame/workflow/evidence/atomic-task-plan-${input.request.dispatchId}.json`
      const ownership = normalizeSubmittedOwnership(candidate.ownership)
      const terminal = atomicTaskPlannerTerminalSchema.parse({
        workerType: 'atomic-task-planner',
        revision: input.request.revision,
        status: 'completed',
        tasks: normalizePlannedAtomicTasks(candidate.tasks, ownership),
        evidencePath,
      })
      const absolutePath = resolveWorkflowEvidencePath(
        input.request.workspacePath,
        evidencePath,
      )
      if (!absolutePath) throw new Error('atomic task evidence path is invalid')
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(
        absolutePath,
        `${JSON.stringify({
          workerType: 'atomic-task-planner',
          status: 'completed',
          revision: input.request.revision,
          tasks: candidate.tasks,
          ownership,
        })}\n`,
        'utf8',
      )
      return terminal
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `atomic task evidence does not match the executable task schema: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitAtomicTaskPlan call',
  )
}

function submittedStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
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
  const candidates = [...input.events].reverse().flatMap(event => {
    if (
      event.type !== 'tool.completed' ||
      event.payload?.toolName !== 'SubmitImplementationResult'
    )
      return []
    const toolInput = event.payload.input
    return toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
      ? [toolInput as Record<string, unknown>]
      : []
  })
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const evidencePath = `.beegame/workflow/evidence/implementation-${input.request.dispatchId}.json`
      const task =
        input.request.contract.task &&
        typeof input.request.contract.task === 'object' &&
        !Array.isArray(input.request.contract.task)
          ? (input.request.contract.task as Record<string, unknown>)
          : {}
      const verificationObservations = Array.isArray(
        candidate.verificationObservations,
      )
        ? candidate.verificationObservations
        : []
      const verificationCount = Array.isArray(task.verification)
        ? task.verification.length
        : 0
      if (verificationObservations.length !== verificationCount)
        throw new Error(
          `verification observations must contain exactly ${verificationCount} entries`,
        )
      const {
        verificationObservations: _verificationObservations,
        ...candidateTerminal
      } = candidate
      return implementationWorkerTerminalSchema.parse({
        ...candidateTerminal,
        verifiedArtifacts: submittedStringArray(task.expectedArtifacts),
        verificationResults: (
          task.verification as Array<Record<string, unknown>>
        ).map((verification, verificationIndex) => ({
          verificationIndex,
          status: verification.kind === 'runtime' ? 'deferred' : 'passed',
          observations: [verificationObservations[verificationIndex]],
        })),
        workerType: 'implementation-worker',
        taskId: input.request.taskId,
        revision: input.request.revision,
        evidenceRefs: [evidencePath],
        evidencePath,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `implementation result does not match the active task schema: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitImplementationResult call',
  )
}

function normalizeSubmittedOwnership(
  value: unknown,
): Record<string, Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('atomic task ownership must be an object')
  const record = value as Record<string, unknown>
  const fields = ['checklistItems'] as const
  if (
    Object.keys(record).some(
      key => !fields.includes(key as (typeof fields)[number]),
    )
  )
    throw new Error('atomic task ownership contains unknown fields')
  return Object.fromEntries(
    fields.map(field => {
      const entries = record[field]
      if (!Array.isArray(entries))
        throw new Error(`atomic task ownership.${field} must be an array`)
      const mapping: Record<string, string> = {}
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error(
            `atomic task ownership.${field} entries must be objects`,
          )
        const item = entry as Record<string, unknown>
        if (
          typeof item.id !== 'string' ||
          !item.id ||
          typeof item.taskId !== 'string' ||
          !item.taskId
        )
          throw new Error(
            `atomic task ownership.${field} entries require id and taskId`,
          )
        if (mapping[item.id])
          throw new Error(
            `atomic task ownership.${field} duplicates ${item.id}`,
          )
        mapping[item.id] = item.taskId
      }
      return [field, mapping]
    }),
  )
}

function normalizePlannedAtomicTasks(
  value: unknown,
  ownershipValue: unknown,
): unknown {
  if (!Array.isArray(value)) return value
  if (
    !ownershipValue ||
    typeof ownershipValue !== 'object' ||
    Array.isArray(ownershipValue)
  )
    throw new Error('atomic task ownership must be an object')
  const ownership = ownershipValue as Record<string, unknown>
  const ownershipFields = [['checklistItems', 'checklistIds']] as const
  if (
    Object.keys(ownership).some(
      key => !ownershipFields.some(([field]) => field === key),
    )
  )
    throw new Error('atomic task ownership contains unknown fields')
  const taskIds = new Set(
    value.flatMap(task =>
      task && typeof task === 'object' && !Array.isArray(task)
        ? [String((task as Record<string, unknown>).id ?? '')]
        : [],
    ),
  )
  const owned = new Map<string, Record<string, string[]>>()
  for (const [ownershipField, taskField] of ownershipFields) {
    const mapping = ownership[ownershipField]
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
      throw new Error(
        `atomic task ownership.${ownershipField} must be an object`,
      )
    for (const [id, taskIdValue] of Object.entries(mapping)) {
      if (!id || typeof taskIdValue !== 'string' || !taskIdValue)
        throw new Error(
          `atomic task ownership.${ownershipField} must map non-empty IDs to task IDs`,
        )
      if (!taskIds.has(taskIdValue))
        throw new Error(
          `atomic task ownership assigns ${id} to unknown task ${taskIdValue}`,
        )
      const taskOwnership = owned.get(taskIdValue) ?? {}
      taskOwnership[taskField] = [...(taskOwnership[taskField] ?? []), id]
      owned.set(taskIdValue, taskOwnership)
    }
  }
  return value.map(task => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return task
    const record = task as Record<string, unknown>
    const forbiddenWorkerOwnedFields = [
      'checklistIds',
      'status',
      'attempt',
      'startedRevision',
      'completedRevision',
      'evidenceRefs',
      'kind',
      'summary',
      'requirementIds',
      'deliverables',
      'acceptanceCriteria',
    ]
    if (forbiddenWorkerOwnedFields.some(field => field in record)) return task
    return {
      ...task,
      checklistIds: owned.get(String(record.id))?.checklistIds ?? [],
      status: 'pending',
      attempt: 0,
      evidenceRefs: [],
    }
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
