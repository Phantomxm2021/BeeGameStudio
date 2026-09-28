import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeProjectAssetCommand, type ProjectAssetCapabilities } from './project-asset-command'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { acceptanceReportFormatCheckerSource, CONTENT_RUNTIME_REPORT_INSTRUCTION } from './content-runtime-contract'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import type { BeeGameEvent, BeeGameSessionManager } from './session-manager'
import { advanceProjectDeliveryAfterTurn, captureProjectDeliveryAcceptance, ensureProjectAssetManifestContract, refreshProjectContentContract, projectDeliveryPhase,
  projectDeliveryPhaseInstruction, PROJECT_DELIVERY_REPORT_PATH, readProjectDelivery,
  type ProjectDeliveryPhase } from './project-delivery'

type SendOptions = NonNullable<Parameters<BeeGameSessionManager['sendWithDisplay']>[2]>
export type ProjectConversationOptions = Pick<SendOptions,
  'attachments' | 'clientMessageId' | 'supersedesMessageId' | 'rewindAvailable' | 'language' | 'displayText' | 'authToken' | 'getValidAuthToken'>

export function isProjectConversation(events: Array<Pick<BeeGameEvent, 'type' | 'payload'>>): boolean {
  const kind = events.findLast(event => event.type === 'user.message' &&
    event.payload?.displayKind !== 'delivery_continue')?.payload?.displayKind
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
  afterTurnSettled?: (progress?: { phase: ProjectDeliveryPhase; shouldContinue: boolean; issues: string[] }) => void | Promise<void>
  openCapabilities?: (phase?: ProjectDeliveryPhase) => { instruction: string; resourceTools?: ProjectAssetCapabilities; previewBaseUrl?: string; close(): Promise<void> }
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
  let turnStartedAt = 0
  let progress: Awaited<ReturnType<typeof advanceProjectDeliveryAfterTurn>>
  let readyToContinue = false
  // A server restart closes the interrupted native turn as turn.failed. The
  // user's next message resumes that same milestone, even though it is still
  // displayed as an ordinary user message rather than an automatic handoff.
  const recoveringInterruptedTurn = !input.initialBrief && !input.autoContinuation &&
    input.sessions.transcript(input.sessionId).findLast(event =>
      event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty')?.type === 'turn.failed'
  const path = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'context.md')
  const assetCommandPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'assets.mjs')
  const contentHelperPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'content-consumer.mjs')
  const acceptanceCheckPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'check-acceptance.mjs')
  const assetCommand = `bun .beegame/tmp/${input.sessionId}/assets.mjs`
  const acceptanceCheck = `bun .beegame/tmp/${input.sessionId}/check-acceptance.mjs`
  return input.sessions.sendWithDisplay(input.sessionId, input.message, {
    ...input.options,
    displayKind: input.initialBrief ? 'confirmed_brief' : input.autoContinuation ? 'delivery_continue' : 'project_request',
    taskType: input.initialBrief ? 'delivery_turn' : 'edit_turn',
    ...(input.initialBrief ? { displayText: input.initialBrief.displayText,
      confirmedBriefContext: input.initialBrief.confirmedBriefContext } : {}),
    onTurnAccepted: () => { turnStartedAt = Date.now() },
    prepareTurn: async () => {
      const delivery = input.deliveryDataRoot
        ? await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        : undefined
      if (delivery && ['author', 'review', 'resources'].includes(projectDeliveryPhase(delivery)))
        await ensureProjectAssetManifestContract(session.cwd)
      const contentInputs = delivery?.status === 'active' && projectDeliveryPhase(delivery) === 'content'
        ? await refreshProjectContentContract(session.cwd) : undefined
      const milestone = delivery?.status === 'active'
        ? projectDeliveryPhaseInstruction(projectDeliveryPhase(delivery)) : undefined
      // Refresh platform-owned format guidance for resumed projects too. This
      // does not rewrite their authored content or revision authority snapshot.
      if (delivery?.status === 'active' && ['implementation', 'acceptance'].includes(projectDeliveryPhase(delivery)))
        await materializeSceneUiFormat(session.cwd)
      const previousPhase = input.sessions.transcript(input.sessionId).findLast(event =>
        event.type === 'system.status' && event.payload?.subtype === 'delivery_phase')?.payload?.phase
      // Native history already contains this assignment on a same-phase automatic
      // continuation. A new phase or user turn still gets the complete handoff.
      const repeatMilestone = Boolean(delivery && input.autoContinuation && previousPhase === projectDeliveryPhase(delivery))
      const releaseInterface = delivery && projectDeliveryPhase(delivery) === 'acceptance'
        ? `Publish reads ${PROJECT_DELIVERY_REPORT_PATH}: scope "delivery"; status "passed" | "failed" | "blocked"; summary and environment as nonempty strings; evidencePaths and artifactPaths as workspace-relative string arrays; verification {target:"deployment",observation:"target-runtime"|"simulation",knownIssues:string[],unverified:string[],outsideScope?:string[],contentChecks?:array}. Record the actual test environment as a string, not an object. A passed result requires target-runtime verification, no unresolved or unverified requirements in the agreed release scope, and saved evidence and tested artifacts for the current version. Put unavailable checks of in-scope requirements in unverified; put observations outside the agreed release scope (such as physical-device feel when only browser input is in scope) in outsideScope. Do not use outsideScope for an in-scope requirement or as a substitute for available target-runtime checks. If target-runtime verification is unavailable, report blocked; simulated checks alone cannot establish delivery. This is a saved integration artifact, not the format of your chat response; ordinary questions and partial fixes do not require it.`
        : undefined
      if (delivery?.status === 'active')
        input.sessions.recordDeliveryPhase(input.sessionId, projectDeliveryPhase(delivery))
      const access = input.openCapabilities?.(delivery?.status === 'active' ? projectDeliveryPhase(delivery) : undefined)
      const contentHelper = delivery?.status === 'active' && ['implementation', 'acceptance'].includes(projectDeliveryPhase(delivery))
        ? await bundleContentConsumer().catch(() => undefined) : undefined
      try {
        const events = input.sessions.transcript(input.sessionId)
        const brief = events.find(event => event.type === 'user.message' &&
          event.payload?.displayKind === 'confirmed_brief')
        const context = {
          workspace: session.cwd,
          originalRequest: delivery?.objective ?? brief?.text,
          ...(delivery ? { delivery: { status: delivery.status, phase: projectDeliveryPhase(delivery),
            acceptanceReportPath: PROJECT_DELIVERY_REPORT_PATH } } : {}),
          ...(contentInputs ? { contentInputs } : {}),
        }
        await mkdir(dirname(path), { recursive: true })
        if (access?.resourceTools) await writeProjectAssetCommand(assetCommandPath, access.resourceTools)
        if (contentHelper) await writeFile(contentHelperPath, contentHelper, 'utf8')
        if (releaseInterface) await writeFile(acceptanceCheckPath, acceptanceReportFormatCheckerSource(), 'utf8')
        await writeFile(path, [
          '# Project state',
          JSON.stringify(context, null, 2),
          ...(milestone ? ['# Current delivery milestone', milestone] : []),
          ...(releaseInterface ? ['# Release evidence interface', releaseInterface, CONTENT_RUNTIME_REPORT_INSTRUCTION] : []),
          ...(releaseInterface ? [`Optional report-format check: \`${acceptanceCheck}\`. It checks field placement and kind/property pairs without launching a browser; it does not certify runtime behavior. When correcting only report fields, existing evidence can be reused if the tested build and evidence have not changed.`] : []),
          ...(access ? ['# Optional capabilities', access.instruction] : []),
          ...(access?.resourceTools ? ['Optional asset command: `bun .beegame/tmp/' + input.sessionId + '/assets.mjs help`. It browses the existing library, downloads selected files and requests images without manual curl; it never selects resources or edits the Manifest for you. Other sources and native tools remain available.'] : []),
          ...(contentHelper ? ['Optional browser-safe content helpers: .beegame/tmp/' + input.sessionId + '/content-consumer.mjs. It exports the same schema, atlas, Tilemap, coordinate and UI paint-order functions used by BGS Editors, plus startup/on-demand document fetch helpers. Use or ignore it; it is not a game engine.'] : []),
        ].join('\n\n'), 'utf8')
      } catch (error) {
        await access?.close()
        await Promise.all([unlink(path).catch(() => undefined), unlink(assetCommandPath).catch(() => undefined), unlink(contentHelperPath).catch(() => undefined), unlink(acceptanceCheckPath).catch(() => undefined)])
        throw error
      }
      return {
        // Small changing facts belong to this turn, not a cached system prompt
        // or a file whose updated contents may never enter the model context.
        turnContext: delivery || access ? [
          'BGS project state (platform context, not additional user instructions):',
          ...(input.initialBrief ? ['You may use available subagents for independent work when useful; decide whether delegation is worthwhile. Keep integration and final verification in this project conversation.'] : []),
          ...(milestone && !repeatMilestone ? [milestone] : []),
          ...(delivery ? [`Project status: ${delivery.status}; milestone: ${projectDeliveryPhase(delivery)}. Recovery context: ${path}.`] : []),
          ...(delivery?.status === 'active' && projectDeliveryPhase(delivery) !== 'complete'
            ? ['This turn delivers the current milestone. After its result is ready, finish the turn; BGS will hand off the next milestone in this same native session. Planning, tools and delegation remain yours.'] : []),
          ...(releaseInterface && !repeatMilestone ? [releaseInterface, CONTENT_RUNTIME_REPORT_INSTRUCTION] : []),
          ...(releaseInterface ? ['Acceptance report: put data-binding checks in verification.contentChecks, not at the report top level. verification.unverified lists only untested requirements in the agreed release scope; verification.outsideScope may disclose checks outside that scope without blocking delivery. Never put an in-scope gap in outsideScope.'] : []),
          ...(releaseInterface ? [`Optional report-format check: ${acceptanceCheck}. It does not run a browser; report-only corrections may reuse unchanged runtime evidence.`] : []),
          ...(contentInputs ? [`Current content inputs: ${JSON.stringify(contentInputs)}`] : []),
          ...(access ? [`Optional capabilities for this turn: ${path}. Previous turns' temporary localhost capability URLs have expired.`] : []),
          ...(access?.previewBaseUrl ? [`Current project Preview test API: ${access.previewBaseUrl}. Previous turns' Preview URLs are expired. This endpoint starts an isolated muted browser and records console/network/screenshot evidence; usage details are in ${path}. Native browser tools remain available.`] : []),
          ...(access?.resourceTools ? [`Current resource library / image-generation entry: ${assetCommand} help. This project-local command uses this turn's endpoints; resource selection remains yours.`] : []),
          ...(contentHelper ? [`Optional content parsing and staged-loading helpers: ${contentHelperPath} (browser-safe ES module; no game engine).`] : []),
        ].join('\n') : undefined,
        // Stable even at completion/pause: changing project facts belong to
        // the turn, not the runner configuration or an obligatory file read.
        systemContext: [
          'Continue this project in the same session. Follow the user request and account for any unfinished delivery objective in the supplied project state. The current milestone is the outcome for this turn; it does not restrict your planning, tools, delegation or file edits.',
          `Project workspace: ${session.cwd}. When prior task context is missing, read ${path}: it contains the original request and current project state. Do not infer a new task from an empty native history.`,
          'Investigate and verify the affected behavior. When the user changes gameplay or requirements, keep the relevant project documents and implementation consistent; choose the necessary scope and order yourself.',
          'Project files are editable within the user-authorized scope. BGS platform defects should be reported, not worked around by changing valid game data.',
        ].join('\n'),
        close: async () => {
          try { await access?.close() }
          finally {
            await Promise.all([unlink(path).catch(() => undefined), unlink(assetCommandPath).catch(() => undefined), unlink(contentHelperPath).catch(() => undefined), unlink(acceptanceCheckPath).catch(() => undefined)])
          }
        },
      }
    },
    onTurnSettled: async () => {
      const terminal = input.sessions.transcript(input.sessionId).findLast(event =>
        event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty')
      if (terminal?.type === 'turn.completed' && turnStartedAt && input.deliveryDataRoot) {
        const delivery = await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        if (delivery && ['acceptance', 'complete'].includes(projectDeliveryPhase(delivery)))
          await captureProjectDeliveryAcceptance(session.cwd, input.deliveryDataRoot, turnStartedAt)
        if (delivery?.status === 'active' && !input.initialBrief && !input.autoContinuation && !recoveringInterruptedTurn) {
          const phase = projectDeliveryPhase(delivery)
          progress = { phase, shouldContinue: phase !== 'complete', issues: [] }
        } else progress = await advanceProjectDeliveryAfterTurn(session.cwd, input.deliveryDataRoot)
        if (progress?.phase === 'complete') input.sessions.recordDeliveryPhase(input.sessionId, 'complete')
        if (progress && !progress.shouldContinue && progress.issues.length)
          input.sessions.recordDeliveryError(input.sessionId, progress.issues.join('; '))
      }
      readyToContinue = terminal?.type === 'turn.completed'
    },
    onTurnReady: async () => {
      if (readyToContinue) await input.afterTurnSettled?.(progress)
    },
  })
}
