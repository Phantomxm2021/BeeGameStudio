import { parseWorkerTerminalResult } from './worker-contracts'
import type { DeliveryRun, WorkerDispatchRequest } from './types'
import type { RunStore } from './run-store'

export type ChangeRoute =
  | 'question'
  | 'implementation_only'
  | 'documents_required'

export type PersistedChangeRequest = {
  requestId: string
  message: string
  revision: string
  route: ChangeRoute
  affectedRequirementIds: string[]
  affectedChecklistIds: string[]
  rationale: string
  createdAt: string
}

function now() {
  return new Date().toISOString()
}

export function classifyChangeResult(value: unknown): {
  route: ChangeRoute
  affectedRequirementIds: string[]
  affectedChecklistIds: string[]
  rationale: string
} {
  const parsed = parseWorkerTerminalResult(value)
  if (parsed.workerType !== 'change-impact-analyzer')
    throw new Error('change impact result has the wrong worker type')
  return {
    route: parsed.classification,
    affectedRequirementIds: parsed.affectedRequirementIds,
    affectedChecklistIds: parsed.affectedChecklistIds,
    rationale: parsed.rationale,
  }
}

export async function createChangeRequest(input: {
  store: RunStore
  run: DeliveryRun
  message: string
  impactResult: unknown
}): Promise<PersistedChangeRequest> {
  if (!input.message.trim()) throw new Error('change request message is empty')
  const classification = classifyChangeResult(input.impactResult)
  const request: PersistedChangeRequest = {
    requestId: randomUUID(),
    message: input.message,
    revision: input.run.revision.workspace,
    ...classification,
    createdAt: now(),
  }
  await input.store.appendEvent({
    runId: input.run.runId,
    type: 'change.requested',
    phase: input.run.phase,
    status: input.run.status,
    revision: input.run.revision,
    requestId: request.requestId,
    message: input.message,
    route: request.route,
    affectedRequirementIds: request.affectedRequirementIds,
    affectedChecklistIds: request.affectedChecklistIds,
  })
  return request
}

export function buildChangeImpactDispatch(
  run: DeliveryRun,
  workspacePath: string,
  message: string,
): WorkerDispatchRequest {
  return {
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    workspacePath,
    workerType: 'change-impact-analyzer',
    phase: run.phase,
    revision: run.revision.workspace,
    allowedPaths: [],
    contract: { message, currentRevision: run.revision },
  }
}

export function buildQuestionAnswerDispatch(
  run: DeliveryRun,
  workspacePath: string,
  message: string,
): WorkerDispatchRequest {
  return {
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    workspacePath,
    workerType: 'question-answerer',
    phase: run.phase,
    revision: run.revision.workspace,
    allowedPaths: [],
    contract: { message, currentRevision: run.revision },
  }
}
import { randomUUID } from 'node:crypto'
