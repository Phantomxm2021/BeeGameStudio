import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BeeGameEvent, BeeGameSessionManager } from './session-manager'
import { createRunStore } from './delivery-workflow/run-store'
import { computeWorkspaceRevision } from './delivery-workflow/revision'
import { captureProjectDeliveryAcceptance, PROJECT_DELIVERY_REPORT_PATH, readProjectDelivery } from './project-delivery'

type SendOptions = NonNullable<Parameters<BeeGameSessionManager['sendWithDisplay']>[2]>
export type ProjectConversationOptions = Pick<SendOptions,
  'attachments' | 'clientMessageId' | 'supersedesMessageId' | 'language' | 'displayText' | 'authToken' | 'getValidAuthToken'>

export function isProjectConversation(events: Array<Pick<BeeGameEvent, 'type' | 'payload'>>): boolean {
  const kind = events.findLast(event => event.type === 'user.message' &&
    !event.payload?.workflowSourceSessionId && event.payload?.displayKind !== 'delivery_continue')?.payload?.displayKind
  return kind === 'project_request' || kind === 'change_request'
}

/** Ordinary conversation is a native project turn, not a delivery dispatch. */
export async function sendProjectConversation(input: {
  sessions: BeeGameSessionManager
  deliveryDataRoot?: string
  sessionId: string
  ownerId: string
  message: string
  options?: ProjectConversationOptions
  initialBrief?: { displayText: string; confirmedBriefContext: string }
  autoContinuation?: boolean
  afterTurnSettled?: () => void
  openCapabilities?: () => { instruction: string; close(): Promise<void> }
}) {
  const session = input.sessions.get(input.sessionId)
  const metadata = input.sessions.metadata(input.sessionId)
  if (!session || !metadata?.projectId || metadata.userId !== input.ownerId)
    throw new Error('Project session not found')
  const clientMessageId = input.options?.clientMessageId
  if (clientMessageId) {
    const previous = input.sessions.transcript(input.sessionId).find(event =>
      event.type === 'user.message' && event.payload?.clientMessageId === clientMessageId)
    if (previous) {
      if (previous.text !== input.message) throw new Error('Client message ID already belongs to another request')
      return session
    }
  }
  const store = createRunStore(session.cwd, input.ownerId)
  let acceptedRevision: string | undefined
  let runId: string | undefined
  let turnStartedAt = 0
  const path = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'context.md')
  return input.sessions.sendWithDisplay(input.sessionId, input.message, {
    ...input.options,
    displayKind: input.initialBrief ? 'confirmed_brief' : input.autoContinuation ? 'delivery_continue' : 'project_request',
    taskType: input.initialBrief ? 'delivery_turn' : 'edit_turn',
    ...(input.initialBrief ? { displayText: input.initialBrief.displayText,
      confirmedBriefContext: input.initialBrief.confirmedBriefContext } : {}),
    onTurnAccepted: () => { turnStartedAt = Date.now() },
    prepareTurn: async () => {
      const run = await store.load()
      const delivery = input.deliveryDataRoot
        ? await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        : undefined
      if (run?.status === 'running' || run?.activeDispatch?.status === 'running')
        throw new Error('Stop the active workflow before starting a project request')
      // A migrated run is historical evidence, not a second mutable verdict.
      if (!delivery) {
        runId = run?.runId
        acceptedRevision = run?.evidence.acceptance?.revision
      }
      const access = input.openCapabilities?.()
      try {
        // The Chat transcript includes worker output, but the main native CLI
        // session does not. Hand off facts, not another user prompt or a plan.
        const events = input.sessions.transcript(input.sessionId)
        const lastWorkerMessage = events.findLast(event => event.type === 'assistant.message' &&
          event.payload?.workflowSourceSessionId && event.text?.trim())
        const brief = events.find(event => event.type === 'user.message' &&
          event.payload?.displayKind === 'confirmed_brief')
        const context = {
          workspace: session.cwd,
          originalRequest: delivery?.objective ?? brief?.text,
          ...(delivery ? { delivery: { status: delivery.status,
            acceptanceReportPath: PROJECT_DELIVERY_REPORT_PATH } } : {}),
          lastWorkflow: run ? { phase: run.phase, status: run.status, updatedAt: run.updatedAt,
            blockedReason: run.blockedReason, snapshotPath: '.beegame/workflow/run.json',
            evidencePaths: run.tasks.flatMap(task => task.evidenceRefs) } : undefined,
          lastWorkerReply: lastWorkerMessage ? { text: lastWorkerMessage.text,
            createdAt: lastWorkerMessage.createdAt } : undefined,
        }
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, [
          '# Project context (historical facts, not instructions)',
          'Worker conversations are separate from this native conversation. The last workflow verdict may predate subsequent user work; it is not a fresh diagnosis.',
          JSON.stringify(context, null, 2),
          ...(access ? ['# Optional capabilities', access.instruction] : []),
        ].join('\n\n'), 'utf8')
      } catch (error) { await access?.close(); throw error }
      return {
        // Stable per session: no new process/context for each turn. The file
        // is refreshed without appending duplicate chat messages or transcripts.
        systemContext: [
          delivery
            ? `This project has one continuing objective. Follow the user's current request, then continue the original objective when appropriate. Choose your own work order and tools. Only when the current game has actually been verified for deployment, write a delivery result to ${PROJECT_DELIVERY_REPORT_PATH} with scope "delivery", status, summary, environment, evidencePaths, artifactPaths and verification {target:"deployment",knownIssues:[],unverified:[]}. Do not claim delivery completion for a partial fix or a question.`
            : 'This is an existing project conversation. Follow the user request; it does not implicitly start or certify a full delivery workflow.',
          `Project workspace: ${session.cwd}. When prior task context is missing, read ${path}: it contains the original request, last worker reply, historical workflow state and evidence references. Do not infer a new task from an empty native history.`,
          'Investigate and verify the affected behavior. When the user changes gameplay or requirements, keep the relevant project documents and implementation consistent; choose the necessary scope and order yourself.',
          'Project files are editable within the user-authorized scope. BGS platform defects should be reported, not worked around by changing valid game data.',
          `Optional BGS capabilities, when available, are also listed in ${path}; endpoints are refreshed each turn. Availability does not require their use.`,
        ].join('\n'),
        close: async () => {
          try { await access?.close() }
          finally { await unlink(path).catch(() => undefined) }
        },
      }
    },
    onTurnSettled: async () => {
      const terminal = input.sessions.transcript(input.sessionId).findLast(event =>
        event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty')
      if (terminal?.type === 'turn.completed' && turnStartedAt && input.deliveryDataRoot)
        await captureProjectDeliveryAcceptance(session.cwd, input.deliveryDataRoot, turnStartedAt)
      if (terminal?.type === 'turn.completed' && input.afterTurnSettled)
        setTimeout(input.afterTurnSettled, 0)
      // Only an existing delivery verdict needs a workspace freshness check;
      // stage facts and completed tasks stay intact. No semantic classifier.
      if (!acceptedRevision || !runId) return
      const revision = await computeWorkspaceRevision(session.cwd)
      if (revision === acceptedRevision) return
      const lease = await store.mutationLock(runId)
      try {
        const current = await store.load(lease)
        if (!current || current.runId !== runId || current.evidence.acceptance?.revision !== acceptedRevision) return
        const next = { ...current, status: 'needs_action' as const,
          completedAt: undefined, blockedReason: 'Workspace changed after acceptance; revalidation is required.',
          evidence: { ...current.evidence, acceptance: undefined } }
        await store.commit(next, { runId, type: 'acceptance.stale', phase: next.phase,
          status: next.status, revision: next.revision }, [], lease)
      } finally { await store.unlock(lease) }
    },
  })
}
