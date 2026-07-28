import { randomUUID } from 'node:crypto'
import type {
  DeliveryWorkerPort,
  DispatchRecord,
  WorkerDispatchRequest,
} from './delivery-workflow/types'
import type {
  BeeGameSessionManager,
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
  authToken?: string
  userDataRoot?: string
  modelConfigId?: string
  language?: BeeGameSessionLanguage
  resourceSelectionConfig?: ResourceSelectionRuntimeConfig
  confirmedBriefContext?: string
  getConfirmedBriefContext?: () => Promise<string | undefined>
}): DeliveryWorkerPort {
  const sessions = new Map<string, string>()
  const records = new Map<string, DispatchRecord>()
  return {
    async start(request: WorkerDispatchRequest) {
      const dispatchId = request.dispatchId ?? randomUUID()
      const session = input.sessions.start({
        workspacePath: request.workspacePath,
        projectId: request.projectId,
        userId: input.userId,
        ...(input.authToken ? { authToken: input.authToken } : {}),
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
        workflowAllowedPaths: request.allowedPaths ?? [],
      })
      sessions.set(dispatchId, session.id)
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
      const confirmedBriefContext =
        input.confirmedBriefContext ??
        (await input.getConfirmedBriefContext?.())
      const languageInstruction = input.language
        ? `User-facing status language: ${input.language}. Write any status/message text in this language; keep terminal JSON keys and enum values unchanged.`
        : ''
      const workerPrompt = [languageInstruction, confirmedBriefContext, prompt]
        .filter(Boolean)
        .join('\n\n')
      await input.sessions.sendWithDisplay(sessionId, workerPrompt, {
        taskType: taskTypeForWorker(
          records.get(dispatchId)?.workerType ?? 'question-answerer',
        ),
        displayKind: 'workflow_worker',
        ...(confirmedBriefContext ? { confirmedBriefContext } : {}),
        ...(input.authToken ? { authToken: input.authToken } : {}),
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
    async waitForTerminal(dispatchId) {
      const sessionId = sessions.get(dispatchId)
      if (!sessionId) throw new Error('worker session is not registered')
      // Recovery policy belongs to the dispatcher. A transport-level fixed
      // deadline would fail a worker that is still making durable progress.
      while (true) {
        const events = input.sessions.events(sessionId)
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
          const payload = result.payload
          if (
            payload &&
            typeof payload.result === 'string' &&
            payload.result.trim()
          )
            return payload.result
          // `result.text` is display prose and is not a workflow terminal
          // contract. Returning it here caused the dispatcher to parse chat
          // text as JSON and left the run looking permanently blocked. The
          // structured payload is the only terminal channel.
          throw new Error(
            'worker terminal result is missing structured payload',
          )
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
  }
}
