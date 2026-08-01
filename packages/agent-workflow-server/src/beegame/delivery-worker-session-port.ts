import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { resolveWorkflowEvidencePath } from './delivery-workflow/evidence'
import type {
  DeliveryWorkerPort,
  DispatchRecord,
  WorkerDispatchRequest,
} from './delivery-workflow/types'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  DOCUMENT_REVIEW_OWNER_BY_CHECK_ID,
  type DocumentReviewCheckId,
} from './delivery-workflow/types'
import { atomicTaskPlannerTerminalSchema } from './delivery-workflow/worker-contracts'
import { implementationWorkerTerminalSchema } from './delivery-workflow/worker-contracts'
import {
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  documentAuthorSubmissionSchema,
  documentAuthorTerminalSchema,
  documentReviewSubmissionSchemaForMode,
  documentReviewerTerminalSchema,
  implementationAuditorTerminalSchema,
  questionAnswerTerminalSchema,
} from './delivery-workflow/worker-contracts'
import { readAcceptanceChecklistIds } from './document-readiness-audit'
import type {
  BeeGameSessionManager,
  BeeGameEvent,
  BeeGameSessionLanguage,
} from './session-manager'
import type { ResourceSelectionRuntimeConfig } from './resource-selection-config'

function taskTypeForWorker(
  workerType: WorkerDispatchRequest['workerType'],
): 'edit_turn' | 'agent_turn' {
  return workerType === 'document-author' ||
    workerType === 'resource-preparer' ||
    workerType === 'implementation-worker'
    ? 'edit_turn'
    : 'agent_turn'
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
  resourceLimits?: {
    maxToolCalls?: number
    repeatedReadResultLimit?: number
  }
}): DeliveryWorkerPort {
  const sessions = new Map<string, string>()
  const records = new Map<string, DispatchRecord>()
  const requests = new Map<string, WorkerDispatchRequest>()
  return {
    async start(request: WorkerDispatchRequest) {
      const dispatchId = request.dispatchId ?? randomUUID()
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
        ...(request.workerType === 'resource-preparer'
          ? { resourceSelectionConfig: input.resourceSelectionConfig }
          : {}),
        workflowWorker: true,
        workflowRunId: request.runId,
        workflowDispatchId: dispatchId,
        workflowWorkerType: request.workerType,
        ...(request.workerType === 'document-reviewer' &&
        (request.contract.reviewMode === 'initial' ||
          request.contract.reviewMode === 'closure')
          ? { workflowDocumentReviewMode: request.contract.reviewMode }
          : {}),
        ...(request.workerType === 'document-reviewer' &&
        (request.contract.reviewScope === 'foundation' ||
          request.contract.reviewScope === 'complete')
          ? { workflowDocumentReviewScope: request.contract.reviewScope }
          : {}),
        workflowAllowedPaths: request.allowedPaths ?? [],
        ...(request.workerType === 'resource-preparer' &&
        Array.isArray(request.contract.existingUnregisteredResourcePaths)
          ? {
              workflowResourceRegistrationBarrierPaths:
                request.contract.existingUnregisteredResourcePaths.filter(
                  (value): value is string =>
                    typeof value === 'string' && value.trim().length > 0,
                ),
            }
          : {}),
        ...(request.workerType === 'resource-preparer' &&
        isDocumentReviewResourceRemediation(request.contract.remediation)
          ? { workflowAllowResourceCatalogWithExistingInventory: true }
          : {}),
      })
      sessions.set(dispatchId, session.id)
      requests.set(dispatchId, request)
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
      const reviewAuthority =
        request?.workerType === 'document-reviewer' &&
        request.contract.reviewAuthority &&
        typeof request.contract.reviewAuthority === 'object' &&
        !Array.isArray(request.contract.reviewAuthority)
          ? (request.contract.reviewAuthority as Record<string, unknown>)
          : undefined
      const confirmedBriefContext =
        request?.workerType === 'document-reviewer'
          ? typeof reviewAuthority?.confirmedBriefContext === 'string'
            ? reviewAuthority.confirmedBriefContext
            : undefined
          : (input.confirmedBriefContext ??
              (await input.getConfirmedBriefContext?.()))
      if (request?.workerType === 'document-reviewer' && !confirmedBriefContext)
        throw new Error('document reviewer authority is missing')
      const languageInstruction = input.language
        ? `User-facing status language: ${input.language}. Write any status/message text in this language; keep structured tool enum values unchanged.`
        : ''
      const atomicTaskEvidenceInstruction =
        request?.workerType === 'atomic-task-planner'
          ? 'Submit the complete plan through SubmitAtomicTaskPlan exactly once. Do not create, inspect, read, or overwrite an evidence file; the workflow service owns its canonical persistence.'
          : ''
      const implementationResultInstruction =
        request?.workerType === 'implementation-worker'
          ? 'Submit the final result through SubmitImplementationResult exactly once. Do not return a terminal JSON object and do not inspect workflow logs, transcripts, or historical evidence to infer prior failures. Validate only the active contract and current project files; the workflow service owns task identity, revision, and canonical evidence persistence.'
          : ''
      const validationResultInstruction =
        request?.workerType === 'implementation-auditor' ||
        request?.workerType === 'acceptance-validator'
          ? 'Submit the final verdict through SubmitValidationResult exactly once. Do not author workflow evidence or return terminal JSON. The workflow service owns revision, complete contract ID coverage, and canonical evidence persistence.'
          : ''
      const workflowResultInstruction =
        request?.workerType === 'document-author'
          ? 'Submit completion through SubmitDocumentAuthorResult exactly once. Do not return terminal JSON; the workflow service derives written paths from completed file mutations.'
          : request?.workerType === 'document-reviewer'
            ? 'Submit the verdict through SubmitDocumentReviewResult exactly once. Do not author workflow evidence or return terminal JSON; the workflow service owns document coverage, checklist coverage, revision, finding identity, and evidence.'
            : request?.workerType === 'change-impact-analyzer'
              ? 'Submit the analysis through SubmitChangeImpactResult exactly once. Do not author workflow evidence or return terminal JSON.'
              : request?.workerType === 'question-answerer'
                ? 'Submit the answer through SubmitQuestionAnswerResult exactly once. Do not author workflow evidence or return terminal JSON.'
                : ''
      const assetManifestInstruction =
        request?.workerType === 'resource-preparer'
          ? 'Use AssetManifest for every manifest mutation. Establish or reconcile the complete v7 resource plan, acquire or author independent resources, and write JSON/YAML content under the declared roots. Do not write assets/asset-manifest.json with a generic file tool.'
          : ''
      const workerPrompt = [
        languageInstruction,
        request?.workerType === 'document-reviewer'
          ? undefined
          : confirmedBriefContext,
        prompt,
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
        ...(confirmedBriefContext && request?.workerType !== 'document-reviewer'
          ? { confirmedBriefContext }
          : {}),
        ...(authToken ? { authToken } : {}),
        ...(input.language ? { language: input.language } : {}),
      })
    },
    async stop(dispatchId, reason) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) return
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
    async close(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) return
      try {
        const session = input.sessions.get(sessionId)
        if (session?.status === 'running') input.sessions.stop(sessionId)
        await input.sessions.disposeWorkflowWorker(sessionId)
      } finally {
        sessions.delete(dispatchId)
        records.delete(dispatchId)
        requests.delete(dispatchId)
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
      const terminalToolName = structuredSubmissionToolName(request.workerType)
      if (!terminalToolName) return false
      return Boolean(input.sessions.hasInFlightToolSubmission?.(
        sessionId,
        terminalToolName,
      )) || hasInFlightTool(input.sessions.events(sessionId), terminalToolName)
    },
    async waitForTerminal(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      // Recovery policy belongs to the dispatcher. A transport-level fixed
      // deadline would fail a worker that is still making durable progress.
      while (true) {
        const events = input.sessions.events(sessionId)
        const request = requests.get(dispatchId)
        // The accepted structured submission is the workflow terminal event.
        // Waiting for the SDK turn/result envelope after that point creates a
        // race where a valid submission can be overwritten by a wall-clock
        // timeout while the transport is still closing the model turn.
        if (
          request &&
          hasCompletedStructuredSubmission(request.workerType, events)
        )
          return createDeterministicStructuredTerminal({ request, events })
        const result = [...events]
          .reverse()
          .find(
            event =>
              event.type === 'result' ||
              event.type === 'turn.failed' ||
              event.type === 'turn.empty',
          )
        if (result) {
          if (result.type !== 'result')
            throw new Error(
              result.text || 'worker turn did not produce a terminal result',
            )
          if (request?.workerType === 'resource-preparer') {
            return createDeterministicResourceTerminal({
              request,
              dispatchId,
              events,
            })
          }
          if (request)
            return createDeterministicStructuredTerminal({ request, events })
          throw new Error('worker has no structured terminal result channel')
        }
        if (
          request?.workerType === 'resource-preparer'
        ) {
          const guardIssue = resourceWorkerGuardIssue(events, {
            maxToolCalls: input.resourceLimits?.maxToolCalls ?? 80,
            repeatedReadResultLimit:
              input.resourceLimits?.repeatedReadResultLimit ?? 4,
          })
          if (guardIssue) throw workerNeedsActionError(guardIssue)
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
  }
}

function isDocumentReviewResourceRemediation(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind === 'document_review',
  )
}

function structuredSubmissionToolName(
  workerType: WorkerDispatchRequest['workerType'],
): string | undefined {
  switch (workerType) {
    case 'document-author':
      return 'SubmitDocumentAuthorResult'
    case 'document-reviewer':
      return 'SubmitDocumentReviewResult'
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
    case 'resource-preparer':
      return undefined
  }
}

function hasCompletedStructuredSubmission(
  workerType: WorkerDispatchRequest['workerType'],
  events: ReturnType<BeeGameSessionManager['events']>,
): boolean {
  const toolName = structuredSubmissionToolName(workerType)
  return Boolean(
    toolName &&
      events.some(
        event =>
          event.type === 'tool.completed' &&
          event.payload?.toolName === toolName,
      ),
  )
}

async function createDeterministicStructuredTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  switch (input.request.workerType) {
    case 'document-author':
      return createDeterministicDocumentAuthorTerminal(input)
    case 'document-reviewer':
      return createDeterministicDocumentReviewTerminal(input)
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
    case 'resource-preparer':
      throw new Error('worker has no structured terminal result channel')
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

function createDeterministicDocumentAuthorTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = completedToolInputs(
    input.events,
    'SubmitDocumentAuthorResult',
  )
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const submission = documentAuthorSubmissionSchema.parse(candidate)
      const expectedFindingIds = documentAuthorRemediationFindingIds(
        input.request,
      )
      if (
        new Set(submission.resolvedFindingIds).size !==
          submission.resolvedFindingIds.length ||
        !sameStringSet(submission.resolvedFindingIds, expectedFindingIds)
      )
        throw new Error(
          'resolvedFindingIds must exactly match contract.remediation finding IDs; checklistRemediation issues are not semantic finding IDs',
        )
      return documentAuthorTerminalSchema.parse({
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [
          ...new Set(
            completedMutationPaths(input.request.workspacePath, input.events),
          ),
        ],
        resolvedFindingIds: expectedFindingIds,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `document author result does not match the active contract: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitDocumentAuthorResult call',
  )
}

function documentAuthorRemediationFindingIds(
  request: WorkerDispatchRequest,
): string[] {
  const remediation = request.contract.remediation
  if (remediation === undefined) return []
  if (!remediation || typeof remediation !== 'object' || Array.isArray(remediation))
    throw new Error('contract.remediation is invalid')
  const findings = (remediation as Record<string, unknown>).findings
  if (!Array.isArray(findings) || findings.length === 0)
    throw new Error('contract.remediation findings are invalid')
  const ids = findings.map(finding => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding))
      throw new Error('contract.remediation finding is invalid')
    const findingId = (finding as Record<string, unknown>).findingId
    if (typeof findingId !== 'string' || findingId.trim().length === 0)
      throw new Error('contract.remediation findingId is invalid')
    return findingId
  })
  if (new Set(ids).size !== ids.length)
    throw new Error('contract.remediation findingIds must be unique')
  return ids
}

async function createDeterministicDocumentReviewTerminal(input: {
  request: WorkerDispatchRequest
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const candidates = completedToolInputs(
    input.events,
    'SubmitDocumentReviewResult',
  )
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const reviewMode =
        input.request.contract.reviewMode === 'closure'
          ? 'closure'
          : 'initial'
      const scope =
        input.request.contract.reviewScope === 'foundation'
          ? 'foundation'
          : 'complete'
      const submission = documentReviewSubmissionSchemaForMode(
        reviewMode,
        scope,
      ).parse(candidate)
      const findings = submission.findings.map(finding => ({
        ...finding,
        severity: 'blocking' as const,
        owner: DOCUMENT_REVIEW_OWNER_BY_CHECK_ID[
          finding.checkId as DocumentReviewCheckId
        ],
      }))
      const evidencePath = `.beegame/workflow/evidence/document-review-${scope}-${input.request.dispatchId}.json`
      const terminal = documentReviewerTerminalSchema.parse({
        workerType: 'document-reviewer',
        revision: input.request.revision,
        verdict: submission.verdict,
        checks: submission.checks,
        reviewedDocumentPaths:
          scope === 'foundation'
            ? CANONICAL_FOUNDATION_DOCUMENTS
            : [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST],
        checklistIds:
          scope === 'foundation'
            ? []
            : await readAcceptanceChecklistIds(input.request.workspacePath),
        findings,
        evidencePath,
      })
      return terminal
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    errors.length
      ? `document review result does not match the active contract: ${errors.join('; ')}`
      : 'worker terminal result is missing a valid SubmitDocumentReviewResult call',
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

const RESOURCE_MUTATION_ACTIONS = new Set([
  'import_resources',
  'refresh_resource_metadata',
])

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
    const toolInput = event.payload?.input
    const resourceAction =
      toolName === 'ResourceLibrary' &&
      toolInput &&
      typeof toolInput === 'object' &&
      !Array.isArray(toolInput)
        ? String((toolInput as Record<string, unknown>).action ?? '')
        : ''
    if (
      WORKSPACE_MUTATION_TOOLS.has(toolName) ||
      RESOURCE_MUTATION_ACTIONS.has(resourceAction) ||
      toolName === 'AssetManifest'
    )
      active.set(toolUseId, true)
  }
  return active.size > 0
}

function hasInFlightTool(events: BeeGameEvent[], expectedToolName: string): boolean {
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

const RESOURCE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ResourceLibrary'])

function resourceWorkerGuardIssue(
  events: BeeGameEvent[],
  limits: {
    maxToolCalls: number
    repeatedReadResultLimit: number
  },
): string | undefined {
  // Tool-use ids are SDK-local and may be reused after context compaction.
  // Terminal events are emitted for every real invocation, so counting them
  // prevents a compacted session from silently bypassing convergence limits.
  const toolTerminals = events.filter(isToolTerminalEvent)
  if (limits.maxToolCalls > 0 && toolTerminals.length >= limits.maxToolCalls) {
    return `resource worker reached its ${limits.maxToolCalls} tool-call limit without a terminal result`
  }
  const lastMutationIndex = events.findLastIndex(isDurableResourceMutation)
  const eventsSinceMutation = events.slice(lastMutationIndex + 1)
  if (limits.repeatedReadResultLimit <= 0) return undefined
  const repeatedReads = new Map<string, number>()
  for (const event of eventsSinceMutation) {
    // A rejected call did not read the catalog and must not count as a
    // repeated result.
    if (event.type !== 'tool.completed') continue
    const toolName = String(event.payload?.toolName ?? '')
    if (!RESOURCE_READ_TOOLS.has(toolName)) continue
    const output = event.payload?.output
    if (typeof output !== 'string' || !output) continue
    const input = event.payload?.input
    const digest = createHash('sha256')
      .update(JSON.stringify(input ?? null))
      .update('\0')
      .update(output)
      .digest('hex')
    const count = (repeatedReads.get(digest) ?? 0) + 1
    repeatedReads.set(digest, count)
    if (count >= limits.repeatedReadResultLimit) {
      return `resource worker repeated the same read result ${count} times without a durable resource mutation`
    }
  }
  return undefined
}

function isToolTerminalEvent(event: BeeGameEvent): boolean {
  return event.type === 'tool.completed' || event.type === 'tool.failed'
}

function isDurableResourceMutation(event: BeeGameEvent): boolean {
  if (event.type !== 'tool.completed') return false
  const toolName = String(event.payload?.toolName ?? '')
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName))
    return true
  if (toolName === 'AssetManifest') return true
  if (toolName !== 'ResourceLibrary') return false
  const toolInput = event.payload?.input
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput))
    return false
  const action = (toolInput as Record<string, unknown>).action
  return action === 'import_resources' || action === 'refresh_resource_metadata'
}

function workerNeedsActionError(reason: string): Error {
  const error = new Error(reason)
  error.name = 'WorkerNeedsActionError'
  return error
}

async function createDeterministicResourceTerminal(input: {
  request: WorkerDispatchRequest
  dispatchId: string
  events: ReturnType<BeeGameSessionManager['events']>
}) {
  const contract = auditAssetContract(input.request.workspacePath)
  const evidencePath = `.beegame/workflow/evidence/resource-preparation-${input.dispatchId}.json`
  const resourceIds = contract.resources.map(resource => resource.id)
  const contentIds = contract.content.files.map(file => file.id)
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
      evidencePath,
    ]),
  ]
  const terminal = {
    workerType: 'resource-preparer' as const,
    revision: input.request.revision,
    status:
      contract.present && contract.valid
        ? ('completed' as const)
        : ('failed' as const),
    writtenPaths,
    resourceIds,
    contentIds,
    evidencePath,
  }
  const absoluteEvidencePath = join(input.request.workspacePath, evidencePath)
  await mkdir(dirname(absoluteEvidencePath), { recursive: true })
  await writeFile(
    absoluteEvidencePath,
    `${JSON.stringify(
      {
        kind: 'resource_preparation',
        runId: input.request.runId,
        dispatchId: input.dispatchId,
        revision: input.request.revision,
        status: terminal.status,
        manifestPresent: contract.present,
        manifestValid: contract.valid,
        issues: contract.issues,
        resourceIds,
        contentIds,
        observedMutationPaths,
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return terminal
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
