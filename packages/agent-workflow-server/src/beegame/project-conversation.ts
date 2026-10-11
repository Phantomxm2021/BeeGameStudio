import { prepareImplementation } from './delivery/stages/implementation'
import { prepareAcceptance } from './delivery/stages/acceptance'
import { prepareReviewAssignment } from './delivery/stages/review'
import { preparePlanningAssignment } from './delivery/stages/planning'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { parseDesignCalculationCommand } from '@bee-game-studio/agent-workflow/design-calculation-command'
import { prepareContent, prepareContentContract } from './delivery/stages/content'
import { prepareResources, resourceWorkBoundaries } from './delivery/stages/resources'
import { dirname, join, relative, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { publishProjectPreviewCapability } from './project-preview-capability'
import { readMilestoneResult, parseMilestoneResult, PRODUCTION_HANDOFF_INSTRUCTION, type MilestoneResult } from './milestone-result'
import { designSupportingFiles, designHandoffPath, DESIGN_HANDOFF_DIRECTORY,
  snapshotDesignDocuments, snapshotDesignRevisionFiles, designRevisionFileDigest, designReviewIndexes, readDesignImplementationChecklist, type DesignDocumentSnapshot } from './design-handoff'
import { writeProjectAssetCommand, type ProjectAssetCapabilities } from './project-asset-command'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { CONTENT_RUNTIME_REPORT_INSTRUCTION } from './content-runtime-contract'
import { DESIGN_RUNTIME_REPORT_INSTRUCTION } from './runtime-acceptance'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'
import { CONTENT_CONSUMER_PATH, materializeContentCheckerEntry, materializeSceneUiFormat, DESIGN_CALCULATION_INSTRUCTION, SPATIAL_CALCULATION_INSTRUCTION, DESIGN_INSPECTOR_PATH } from './scene-ui-content-authoring'
import { AUTHOR_BATCHES, authorBatchInstruction, authorDocumentResponsibility } from './project-author'
import { checkDesignDocumentReferences } from './design-document-references'
import type { NativeDirectionAuthorInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { CONTENT_DRAFT_EXAMPLES, runGameContentCommand } from './game-content-validation-cli'
import { formatLayoutReport, retainLayoutReport } from './layout-report'
import { designSourceLocations } from './design-source-reading'
import { COMPOSE_DRAFT_HELP } from './draft-composition'
import { BALANCE_CALCULATION_INSTRUCTION, BALANCE_REVIEW_INSTRUCTION, SCENE_CALCULATION_INSTRUCTION, materializeBalanceCalculator } from './balance-calculation'
import type { BeeGameEvent, BeeGameSessionManager } from './session-manager'
import { advanceProjectDeliveryAfterTurn, captureProjectDeliveryAcceptance, ensureProjectAssetManifestContract, projectDeliveryPhase,
  projectDeliveryPhaseInstruction, PROJECT_DELIVERY_REPORT_PATH, readProjectDelivery,
  prepareProjectDesignReview, recordInterruptedDesignRevision, checkProjectDesignBaseline, projectDesignReleaseReport,
  PROJECT_DOCUMENTS, type ProjectDeliveryPhase } from './project-delivery'

type SendOptions = NonNullable<Parameters<BeeGameSessionManager['sendWithDisplay']>[2]>
export type ProjectConversationOptions = Pick<SendOptions,
  'attachments' | 'clientMessageId' | 'supersedesMessageId' | 'rewindAvailable' | 'language' | 'displayText' | 'authToken' | 'getValidAuthToken'>

/** Keep original input readable by native line-range reads, not a long escaped
 * JSON string that truncates the very task the reviewer is required to inspect. */
export function projectSourceText(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2) }
  catch { return value }
}

/** Strip only an identical structured Brief suffix, never its instructions. */
export function projectInitialInstruction(message: string, objective: string): string {
  if (projectSourceText(message) === projectSourceText(objective)) return ''
  const marker = '\nConfirmed brief:\n', at = message.lastIndexOf(marker)
  if (at < 0) return message
  try {
    const original = JSON.parse(objective), repeated = JSON.parse(message.slice(at + marker.length))
    if (original.kind === 'confirmed_build_brief' && JSON.stringify(original) === JSON.stringify(repeated)) return message.slice(0, at)
  } catch { /* Non-JSON and distinct user additions stay intact. */ }
  return message
}

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
  let acceptedTurnId: string | undefined
  let progress: Awaited<ReturnType<typeof advanceProjectDeliveryAfterTurn>>
  let readyToContinue = false
  let resultPhase: MilestoneResult['phase'] | undefined
  let authorFinalResponse = false
  let preparedDelivery: Awaited<ReturnType<typeof readProjectDelivery>>
  let documentTurn: { snapshot: DesignDocumentSnapshot; authorBatch?: number; scheduledAuthors: boolean } | undefined
  let revisionWrites: { before: Record<string, string | null>; completed: Record<string, string | null>; allowed: Set<string> } | undefined
  let unsubscribeWrites: (() => void) | undefined
  const resultRelativePath = `.beegame/tmp/${input.sessionId}/milestone-${randomUUID()}.txt`
  const resultPath = join(session.cwd, resultRelativePath)
  const productionCheckInputPath = resultPath + '.production-input.json'
  // An interrupted task is not authorization to resume it. Only the initial
  // brief or a trusted Continue/automatic continuation dispatches production.
  const deliveryDispatch = Boolean(input.initialBrief || input.autoContinuation)
  const path = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'context.md')
  const assetCommandPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'assets.mjs')
  const contentHelperPath = join(session.cwd, CONTENT_CONSUMER_PATH)
  const acceptanceCheckPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'check-acceptance.mjs')
  const assetCommand = `bun .beegame/tmp/${input.sessionId}/assets.mjs`
  const acceptanceCheck = `bun .beegame/tmp/${input.sessionId}/check-acceptance.mjs`
  const userMessage = input.initialBrief?.displayText ?? input.message
  return input.sessions.sendWithDisplay(input.sessionId, userMessage, {
    ...input.options,
    displayKind: input.initialBrief ? 'confirmed_brief' : input.autoContinuation ? 'delivery_continue' : 'project_request',
    taskType: input.initialBrief ? 'delivery_turn' : 'edit_turn',
    ...(input.initialBrief ? { displayText: input.initialBrief.displayText,
      confirmedBriefContext: input.initialBrief.confirmedBriefContext } : {}),
    onTurnAccepted: turnId => {
      acceptedTurnId = turnId; turnStartedAt = Date.now()
      if (revisionWrites) unsubscribeWrites = input.sessions.subscribeEvents(input.sessionId, event => {
        if (event.turnId !== turnId || event.type !== 'tool.completed') return
        const tool = event.payload?.toolName, args = event.payload?.input as Record<string, unknown> | undefined
        const calculation = tool === 'Bash' && typeof args?.command === 'string'
          ? parseDesignCalculationCommand(args.command) : undefined
        if (calculation?.cwd) {
          try { if (realpathSync(resolve(session.cwd, calculation.cwd)) !== realpathSync(session.cwd)) return }
          catch { return }
        }
        const path = ['Write', 'Edit'].includes(String(tool)) && typeof args?.file_path === 'string'
          ? relative(session.cwd, resolve(session.cwd, args.file_path)) : calculation?.output
        if (!path || !revisionWrites!.allowed.has(path)) return
        // Capture at tool completion, not settlement after unrelated edits.
        try { revisionWrites!.completed[path] = designRevisionFileDigest(session.cwd, path) }
        catch { delete revisionWrites!.completed[path] }
      })
    },
    prepareTurn: async () => {
      let delivery = input.deliveryDataRoot
        ? await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        : undefined
      if (deliveryDispatch && delivery?.designRepair?.status === 'stopped')
        throw new Error(delivery.lastValidationFailure ?? 'Design repair is stopped pending explicit resolution.')
      if (deliveryDispatch && delivery?.status === 'active' && projectDeliveryPhase(delivery) === 'review' && input.deliveryDataRoot)
        delivery = await prepareProjectDesignReview(session.cwd, input.deliveryDataRoot)
      let baselineIssues: string[] | undefined
      if (deliveryDispatch && delivery?.status === 'active') {
        if (!delivery.designBaseline && !['author', 'review'].includes(projectDeliveryPhase(delivery)))
          throw new Error('This delivery has no reviewed design baseline. Prepare the saved design handoff and explicitly inspect through design-resolution before dependent work.')
        const phase = projectDeliveryPhase(delivery)
        if ((phase === 'content' || phase === 'resources') && delivery.designBaseline) {
          const prepared = (phase === 'content' ? prepareContent : prepareResources)(session.cwd, { objective: delivery.objective,
            baseline: { ...delivery.designBaseline, digestVersion: delivery.designBaseline.digestVersion ?? 1 } })
          if (!prepared.ready) throw new Error([...prepared.issues, prepared.recovery].join('; '))
          baselineIssues = []
        } else baselineIssues = checkProjectDesignBaseline(session.cwd, delivery)
        if (baselineIssues.length) throw new Error(baselineIssues.join('; '))
      }
      if (delivery?.status === 'active') await materializeContentCheckerEntry(session.cwd)
      if (delivery && ['author', 'review', 'resources'].includes(projectDeliveryPhase(delivery)))
        await ensureProjectAssetManifestContract(session.cwd)
      const contentInputs = delivery?.status === 'active' && (projectDeliveryPhase(delivery) === 'content' ||
        delivery.designBaseline?.change && ['implementation', 'acceptance'].includes(projectDeliveryPhase(delivery)))
        ? await prepareContentContract(session.cwd) : undefined
      const reviewAssignment = deliveryDispatch && delivery ? prepareReviewAssignment(session.cwd, delivery) : undefined
      const reviewDocuments = reviewAssignment?.documents
      if (delivery?.status === 'active' && ['author', 'review'].includes(projectDeliveryPhase(delivery)))
        await mkdir(join(session.cwd, DESIGN_HANDOFF_DIRECTORY), { recursive: true })
      const reviewWritableFiles = reviewAssignment?.writableFiles ?? []
      const reviewReadScope = reviewAssignment?.readScope
      const reviewInputs = reviewAssignment?.inputs ?? []
      const milestone = delivery?.status === 'active'
        ? projectDeliveryPhase(delivery) === 'review' && deliveryDispatch
          ? reviewAssignment?.instruction
          : projectDeliveryPhase(delivery) === 'review' ? undefined
          : projectDeliveryPhase(delivery) === 'author' && (delivery.authorBatch ?? 0) === 0
            ? authorBatchInstruction(0, 'GDD.md') : projectDeliveryPhaseInstruction(projectDeliveryPhase(delivery), delivery.authorBatch) : undefined
      const designDiagnostics = deliveryDispatch && delivery?.designReview
        ? projectDesignReleaseReport(session.cwd, delivery)
        : undefined
      const phase = delivery?.status === 'active' ? projectDeliveryPhase(delivery) : undefined
      const gddAuthor = phase === 'author' && (delivery?.authorBatch ?? 0) === 0
      authorFinalResponse = deliveryDispatch && gddAuthor
      if (authorFinalResponse) await mkdir(join(session.cwd, 'docs'), { recursive: true })
      // This is the reviewed task input, not a model-produced summary or Todo.
      // Validate before opening execution capabilities for a delivery dispatch.
      let implementationChecklist: ReturnType<typeof readDesignImplementationChecklist> | undefined
      let checklistDiagnostic: string | undefined
      if (phase === 'implementation' || phase === 'acceptance') {
        try {
          implementationChecklist = (phase === 'implementation' ? prepareImplementation : prepareAcceptance)(session.cwd, delivery!)
        }
        catch (error) {
          if (deliveryDispatch) throw error
          checklistDiagnostic = error instanceof Error ? error.message : String(error)
        }
      }
      const planningAssignment = phase === 'author' && delivery ? preparePlanningAssignment(delivery) : undefined
      const authorDocuments = planningAssignment?.documents
      const authorNeedsSpatial = planningAssignment?.needsSpatial
      const authorNeedsFormat = planningAssignment?.needsFormat || reviewAssignment?.needsFormat
      const spatialCalculation = reviewAssignment?.needsSpatial || phase === 'content' || phase === 'implementation' || authorNeedsSpatial
        ? (phase === 'author' || phase === 'review' ? DESIGN_CALCULATION_INSTRUCTION : SPATIAL_CALCULATION_INSTRUCTION)
        : undefined
      const numericalCalculation = reviewAssignment?.needsCalculation ? BALANCE_REVIEW_INSTRUCTION(delivery?.designReview?.step === 'revise')
        : planningAssignment?.needsCalculation ? BALANCE_CALCULATION_INSTRUCTION : undefined
      if (numericalCalculation || planningAssignment?.needsSceneCalculation)
        await materializeBalanceCalculator(session.cwd)
      resultPhase = deliveryDispatch && (phase === 'review' || phase === 'resources' || phase === 'content' || phase === 'author' && (delivery?.authorBatch ?? 0) === 0) ||
        phase === 'implementation' ? phase : undefined
      const resultInstruction = resultPhase
        ? resultPhase === 'review'
          ? `Write the exact step receipt at ${resultRelativePath}, using the bounded review JSON format in the assignment. complete means this step executed, not documents released; blocked still requires the JSON findings. Only the host releases documents.`
          : gddAuthor
            ? 'After successful draft saves, use the final response as your only completion conclusion: first line complete, then saved paths and unresolved dependencies/limits only; otherwise first line blocked followed by the actual reason. No separate receipt or repeated document summary. This author conclusion is not semantic approval; saved drafts alone are not completion.'
            : `Record your ${resultPhase} conclusion in ${resultRelativePath}: first line complete only when this milestone's stated outcome is met, or blocked followed by a short reason on the next line. ${PRODUCTION_HANDOFF_INSTRUCTION} Report issues rather than editing reviewed design. Ordinary binding errors remain your own repair work. This is a handoff, not permission or a quality verdict.`
        : undefined
      // Refresh platform-owned format guidance for resumed projects too. This
      // does not rewrite their authored content or revision authority snapshot.
      if (phase === 'resources' || phase === 'review' || spatialCalculation || authorNeedsFormat || (delivery?.status === 'active' && ['implementation', 'acceptance'].includes(projectDeliveryPhase(delivery))))
        await materializeSceneUiFormat(session.cwd)
      const previousPhase = input.sessions.transcript(input.sessionId).findLast(event =>
        event.type === 'system.status' && event.payload?.subtype === 'delivery_phase')?.payload?.phase
      // Native history already contains this assignment on a same-phase automatic
      // continuation. A new phase or user turn still gets the complete handoff.
      // A new author batch keeps the phase name but needs a new assignment.
      // An unchanged validation retry already has that assignment in native history.
      const repeatMilestone = Boolean(delivery && input.autoContinuation &&
        previousPhase === projectDeliveryPhase(delivery) &&
        (projectDeliveryPhase(delivery) !== 'author' || delivery.lastValidationFailure))
      // Dispatch existing writing owners with document-local histories. Retries
      // and explicit user edits do not automatically regenerate a whole batch.
      const writingBatch = planningAssignment?.batch
      const scheduledAuthors = planningAssignment?.authors
      const directionAuthors: NativeDirectionAuthorInput | undefined = deliveryDispatch && phase === 'author' && scheduledAuthors
        ? { batch: writingBatch, contextPath: path,
          inputRevision: createHash('sha256').update(JSON.stringify([delivery?.objective, writingBatch,
            snapshotDesignDocuments(session.cwd, AUTHOR_BATCHES.slice(0, writingBatch!).flat()
              .filter(name => !scheduledAuthors.some(author => author.document === name))).documents])).digest('hex'),
          responsibilities: Object.fromEntries(scheduledAuthors.map(({ document }) =>
            [document, authorDocumentResponsibility(writingBatch!, document)])),
          contextPaths: Object.fromEntries(scheduledAuthors.map(({ document }) =>
            [document, join(dirname(path), document + '.context.md')])) }
        : undefined
      preparedDelivery = delivery
      let reviewSettings: { orientation?: unknown; dimension?: unknown } | undefined
      try {
        const settings = JSON.parse(delivery?.objective ?? '').settings
        if (settings && typeof settings === 'object') reviewSettings = { orientation: settings.orientation, dimension: settings.dimension }
      } catch { /* Legacy plain-text brief. */ }
      const turnDocuments = deliveryDispatch && phase === 'author' && ((delivery?.authorBatch ?? 0) === 0 || directionAuthors)
        ? [...authorDocuments ?? []] : deliveryDispatch && phase === 'review' && delivery?.designReview?.step === 'revise' ? [...reviewDocuments ?? []] : undefined
      if (turnDocuments) documentTurn = {
        snapshot: snapshotDesignDocuments(session.cwd, turnDocuments),
        ...(phase === 'author' ? { authorBatch: delivery?.authorBatch ?? 0 } : {}), scheduledAuthors: !!directionAuthors }
      if (documentTurn && phase === 'review' && delivery?.designReview?.step === 'revise')
        revisionWrites = { before: snapshotDesignRevisionFiles(session.cwd), completed: {},
          allowed: new Set([...turnDocuments!.map(name => `docs/${name}`), ...reviewWritableFiles]) }
      const resourceContextPaths = deliveryDispatch && phase === 'resources'
        ? { visual: join(dirname(path), 'resources-visual.context.md'),
            audio: join(dirname(path), 'resources-audio.context.md') } : undefined
      const temporaryContextPaths = [path, productionCheckInputPath, ...Object.values(directionAuthors?.contextPaths ?? {}),
        ...Object.values(resourceContextPaths ?? {})]
      const releaseInterface = delivery && projectDeliveryPhase(delivery) === 'acceptance'
        ? `Publish reads ${PROJECT_DELIVERY_REPORT_PATH}: scope "delivery"; status "passed" | "failed" | "blocked"; summary and environment as nonempty strings; evidencePaths and artifactPaths as workspace-relative string arrays; verification {target:"deployment",observation:"target-runtime"|"simulation",knownIssues:string[],unverified:string[],outsideScope?:string[],contentChecks?:array,requirementChecks?:array}. Record the actual test environment as a string, not an object. A passed result requires target-runtime verification, no unresolved or unverified requirements in the agreed release scope, and saved evidence and tested artifacts for the current version. Put unavailable checks of in-scope requirements in unverified; put observations outside the agreed release scope (such as physical-device feel when only browser input is in scope) in outsideScope. Do not use outsideScope for an in-scope requirement or as a substitute for available target-runtime checks. If target-runtime verification is unavailable, report blocked; simulated checks alone cannot establish delivery. This is a saved integration artifact, not the format of your chat response; ordinary questions and partial fixes do not require it.`
        : undefined
      if (delivery?.status === 'active')
        input.sessions.recordDeliveryPhase(input.sessionId, projectDeliveryPhase(delivery))
      const access = input.openCapabilities?.(delivery?.status === 'active' ? projectDeliveryPhase(delivery) : undefined)
      const revokePreview = access?.previewBaseUrl
        ? await publishProjectPreviewCapability(session.cwd, input.sessionId, access.previewBaseUrl) : undefined
      const contentHelper = delivery?.status === 'active' && phase === 'acceptance'
        ? await bundleContentConsumer().catch(() => undefined) : undefined
      const spatialEntry = `Spatial tools: bun .beegame/delivery/check-content.mjs --help includes commands, a minimal draft and result shapes. Run bun .beegame/delivery/check-content.mjs --format to list actual format sections; run bun .beegame/delivery/check-content.mjs --format coordinates to read the coordinates section without the full specification. Full supported fields: .beegame/delivery/content-format.json. Calculation scope is in ${path}; geometry is not visual acceptance.` +
        (phase === 'author' || phase === 'review'
          ? ' Eight-document author/review delivers planning documents and owner-linked content/scenes and content/ui layout files. Review uses those same sources; full resource production, bindings, VFX, registration and runtime remain later. Minimal critical samples may resolve a concrete layout dependency; a temporary game, full asset batch/package or delivered-font proof is not required. Partial static samples are not mandatory and cannot replace layout calculation.'
          : ` UI layout files begun during planning remain the same editable sources. Use bun .beegame/delivery/bind-content.mjs --help for explicit batch resource/action assignments that preserve design fields. node ${DESIGN_INSPECTOR_PATH} --ui-all --report loads final resources/fonts and uses the Editor's shared static renderer for every declared viewport; inspect its captures and coverage gaps. node ${DESIGN_INSPECTOR_PATH} --resources --report decodes registered assets. These commands read the current browser capability automatically; no URL copying, custom server or generic Playwright driver is needed. Unsupported states/world composition and runtime interaction remain explicitly unverified, not a quality PASS.`)
      const formatEntry = 'Content format reference: bun .beegame/delivery/check-content.mjs --format coordinates runtimeConsumption reads the runtime/data baseline together. Use --format without section names only to discover an additional section needed by a current decision; read those additional sections together, without truncating the result with head. The CLI --help documents checks and their limits; its bundled implementation is not a design input. Full reference remains available at .beegame/delivery/content-format.json; technical authoring does not produce formal Content.'
      // Old projects may already cite static references. Preserve their review
      // support without advertising another deliverable to new writing owners.
      const retainedSamples = reviewDocuments?.flatMap(name => designSupportingFiles(session.cwd, [name]))
        .filter(file => /^docs\/visual\/(ART_DIRECTION|UI_UX_SPEC)\/.*\.(html|svg)$/.test(file)) ?? []
      const sampleEntry = retainedSamples.length ? access?.previewBaseUrl
        ? `Existing retained references only: ${JSON.stringify(retainedSamples)}. Inspect a relevant reference with node ${DESIGN_INSPECTOR_PATH} --visual-sample SAVED_PATH WIDTH HEIGHT, using its actual dimensions. This renders static markup without scripts/external requests, not the game or actual JSON layout. Read the returned capture; do not cite its private cache as a retained source. Do not create new mockups.`
        : 'Existing static references cannot be rendered with the current browser capability. Disclose this observation limit; do not create replacement mockups.'
        : undefined
      try {
        const events = input.sessions.transcript(input.sessionId)
        const brief = events.find(event => event.type === 'user.message' &&
          event.payload?.displayKind === 'confirmed_brief')
        const originalRequest = delivery?.objective ?? brief?.text
        const confirmedBriefContext = brief?.payload?.confirmedBriefContext
        const context = {
          workspace: phase === 'author' || phase === 'review' ? '.' : session.cwd,
          ...(delivery ? { delivery: { status: delivery.status, phase: projectDeliveryPhase(delivery),
            ...(projectDeliveryPhase(delivery) === 'author' ? { authorBatch: (delivery.authorBatch ?? 0) + 1 } : {}),
            ...(delivery.designBaseline ? { designBaselineRevision: delivery.designBaseline.revision,
              knownFollowUps: delivery.designBaseline.followUps,
              ...(delivery.designBaseline.change ? { affectedDesignChange: delivery.designBaseline.change } : {}) } : {}),
            ...(delivery.designReview?.instruction ? { ownerResolution: { instruction: delivery.designReview.instruction,
              affectedDocuments: delivery.designReview.writableDocuments ?? [...new Set(delivery.designReview.findings.flatMap(f => f.documents))] } } : {}),
            ...(delivery.designReview?.userDecisions?.length ? { userDecisions: delivery.designReview.userDecisions } : {}),
            acceptanceReportPath: PROJECT_DELIVERY_REPORT_PATH } } : {}),
          ...(contentInputs ? { contentInputs } : {}),
        }
        const originalInputs = [
          ...(typeof originalRequest === 'string' ? ['# Original confirmed request', projectSourceText(originalRequest)] : []),
          ...(typeof confirmedBriefContext === 'string' && confirmedBriefContext !== originalRequest
            ? ['# Confirmed brief context', projectSourceText(confirmedBriefContext)] : []),
        ]
        await mkdir(dirname(path), { recursive: true })
        if (resourceContextPaths) for (const group of ['visual', 'audio'] as const) {
          const documents = group === 'visual'
            ? ['ASSET_PLAN.md', 'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'LEVEL_SCENE_DESIGN.md', 'TECHNICAL_DESIGN.md'] as const
            : ['ASSET_PLAN.md', 'AUDIO_DESIGN.md', 'TECHNICAL_DESIGN.md'] as const
          await writeFile(resourceContextPaths[group], [
            '# Temporary resource-group input (not a design source or milestone receipt)',
            JSON.stringify(context, null, 2), ...originalInputs,
            '# Saved requirement locations',
            JSON.stringify(designSourceLocations(session.cwd, [...documents])),
            'Read the current ASSET_PLAN and the actual owner clauses your outputs consume; expand dependencies for a concrete unresolved requirement. Locations do not prove completeness or quality.',
            '# Installed production interfaces',
            'bun .beegame/delivery/resources.mjs --help exposes exact production and registration-request fields. Workers supply resources only; the shared owner establishes projectTarget and requirements. No hashes or global formats need manual copying.',
            ...(group === 'visual' ? [
              'bun .beegame/delivery/media.mjs --help exposes crop/resize/composition and atlas packing. resources.mjs atlas returns frame metadata and a registration request. resources.mjs fonts downloads direct fonts with source/licence retention; no custom decoder or font toolchain is needed.',
            ] : [
              'resources.mjs audio renders explicit synthesis recipes to WAV, not arbitrary music. Use it only when it meets the reviewed audio direction; otherwise use an authorized source or report the actual missing capability. Listen to the resulting clips and disclose loop/perceptual limits.',
            ]),
            'Preserve the reviewed dimensions, variants, provenance and design requirements. Reuse valid saved outputs. Return saved paths, registration requests, actual checks and unresolved limits, not generation history. Registration/decoding belongs to the shared resources owner; final bound UI fit belongs to Content. Do not create a game or edit Content to complete this resource group.',
            ...(access ? ['# Available capabilities', access.instruction] : []),
            ...(access?.resourceTools ? ['Optional resource interface: bun .beegame/tmp/' + input.sessionId + '/assets.mjs help'] : []),
          ].join('\n\n'), 'utf8')
        }
        if (access?.resourceTools || phase === 'resources' || phase === 'content') await writeProjectAssetCommand(assetCommandPath, access?.resourceTools ?? {})
        if (contentHelper) {
          await mkdir(dirname(contentHelperPath), { recursive: true })
          await writeFile(contentHelperPath, contentHelper, 'utf8')
        }
        if (releaseInterface) await writeFile(acceptanceCheckPath, await bundleAcceptanceChecker(), 'utf8')
        if ((phase === 'content' || phase === 'resources') && delivery?.designBaseline) await writeFile(productionCheckInputPath, JSON.stringify({
          objective: delivery.objective,
          baseline: { digestVersion: delivery.designBaseline.digestVersion ?? 1,
            snapshots: delivery.designBaseline.snapshots, evidenceHashes: delivery.designBaseline.evidenceHashes,
            followUps: delivery.designBaseline.followUps },
        }), 'utf8')
        await writeFile(path, [
          '# Temporary project state (input only; removed at turn end, not a retained document source)',
          JSON.stringify(context, null, 2),
          ...originalInputs,
          ...(delivery?.designBaseline?.change && phase !== 'review'
            ? ['# Reviewed affected design change\nUpdate only impacted resources/data/implementation and reuse unaffected valid work. Rebind content/index.json documentRevision to the supplied current contentInputs when design metadata changed; this does not authorize changing protected layout or gameplay. A runtime-only design correction may refresh that index binding without reproducing unchanged resources or layouts. In acceptance, such rebinding invalidates earlier evidence claims until the affected runtime checks are current. Retained review history is audit evidence, not a request to rerun eight-document authoring.'] : []),
          ...(milestone ? ['# Current delivery milestone', milestone] : []),
          ...(phase === 'content' || phase === 'resources' ? ['# Production handoff preflight',
            'Before submitting complete, run bun .beegame/delivery/check-content.mjs --' + phase + '-handoff ' +
            relative(session.cwd, productionCheckInputPath) +
            '. This uses the same saved-source checks as the native completion and host handoff. The supplied input is a temporary copy, not an editable authority; do not change its hashes. Local format/layout checks remain diagnostic tools, not a complete handoff verdict.'] : []),
          ...(phase === 'resources' || phase === 'content' ? ['# Production tools',
            'Use bun .beegame/delivery/media.mjs --help for installed image crop/resize/padding/composition and fixed-order atlas packing. Pass a JSON request with explicit source regions, output paths and filtering. It uses the shared decoder and runtime frame format; do not rewrite PNG encoding or atlas packing for these supported operations. It produces files only, not resource registration or quality approval.',
            'Use bun .beegame/delivery/resources.mjs --capabilities and --help for direct font downloads with source/licence retention, explicit synthesis recipes exported to WAV, and batch local resource registration. Submit a request JSON; hashes, registry modules and repeat-file reuse are tool work, not hand-entered values. Register downloaded fonts as web sources, not agent-authored. Reuse installed tooling; do not install per-project font/audio toolchains. Synthesis is not a general music composer: choose it only when it can meet the audio direction, otherwise use an available authorized production source or report the missing capability. Validate actual text coverage and listen to resulting audio; generated bytes do not prove quality.',
            phase === 'resources'
              ? 'node .beegame/delivery/inspect-design.mjs --resources --report checks registered asset decoding and saved-label cmap coverage. Final bound-font UI fit is a Content check; do not run --ui-all or bind Content as a prerequisite for resource handoff. Candidate comparisons and unbound labels are not a final-font PASS. Current Preview access is resolved automatically; no custom browser driver is needed.'
              : 'node .beegame/delivery/inspect-design.mjs --resources --report checks registered asset decoding. node .beegame/delivery/inspect-design.mjs --ui-all --report renders saved UI with delivered assets/fonts at declared viewports; --help documents individual checks and coverage limits. Current Preview access is resolved automatically. Do not write a substitute layout or browser driver for checks these entries already cover.',
            ...(phase === 'content' ? ['Use bun .beegame/delivery/bind-content.mjs mapping.json for explicit batch node/component resource/action bindings; --help gives the mapping format and conflict behavior. It cannot change protected design or certify semantics.'] : []),
            'Resource command inspect accepts multiple asset paths and returns machine-computed hashes without changing provenance or verification status.'] : []),
          ...(phase === 'resources' ? ['# Resource work boundaries', resourceWorkBoundaries] : []),
          ...(phase === 'content' ? ['# Current UI binding format (verbatim platform source)',
            'Read current resource binding operands with bun .beegame/delivery/resources.mjs --list; then --list ID ... for exact member paths. This omits replaying every hash/licence annotation. Read atlas metadata and owner source clauses for the frames/properties you actually consume. --details remains available for a concrete provenance/integrity question; do not cat all registry modules or full worker histories to discover IDs.',
            JSON.stringify(runGameContentCommand(session.cwd, ['--format', 'uiVocabulary'])),
            'Use this supplied binding interface without probing the bundled consumer implementation. Read binding operands and current hashes together with bind-content.mjs --inspect FILE ...; use check-content.mjs --inspect-draft for unresolved full-node details. Do not infer node/component IDs from display names. Other format sections remain available for specific unresolved inputs.'] : []),
          ...(implementationChecklist ? ['# Reviewed implementation checklist',
            'Required tasks from the reviewed technical index. Original owner clauses and global constraints remain authoritative; working Todos cannot replace these tasks. Existing results are at the supplied resultPath; reuse only still-valid actual evidence.',
            JSON.stringify(implementationChecklist, null, 2)] : checklistDiagnostic ? ['# Implementation checklist unavailable', checklistDiagnostic] : []),
          ...(reviewDocuments ? ['# Exact saved source locations',
            reviewDocuments.map(name => `docs/${name}; handoff: ${designHandoffPath(name)}`).join('\n'),
            ...(reviewReadScope ? ['Required saved source headings for this affected assignment (null means full file; [] means only later actual edits). Read changed clauses and their consumers; an absent/moved heading requires the resulting file. These are locations, not a semantic verdict:', JSON.stringify(reviewReadScope, null, 2)] : []),
            ...(delivery?.designReview?.step === 'revise' ? [
              'Writable scope and mandatory reading are different: permission to synchronize a delivered consumer is not a demand to reread or rewrite its entire document. Start from finding clauses and inspect actual dependent behavior wherever it is defined, not only implementationItems. Saved edits outside the initial reading selection are included in independent verification. Unrelated decisions and confirmed user requirements remain unchanged.',
            ] : []),
            ...(reviewWritableFiles.length ? ['Authorized revision files (exact paths, not directory grants): ' + JSON.stringify([
              ...reviewDocuments.map(name => 'docs/' + name), ...reviewWritableFiles,
            ])] : []),
            ...(reviewWritableFiles.some(file => file.startsWith('docs/calc/')) ? [
              'When numerical source/model changes, correct the authorized model and regenerate its authorized appendix with bun .beegame/delivery/calculate-balance.mjs MODEL_PATH OUTPUT_PATH before handoff. This runs project code with the existing native execution permissions, not in the BGS server. Do not create another verifier.'] : []),
          ] : []),
          ...(sampleEntry ? [sampleEntry] : []),
          ...(designDiagnostics ? ['# Host deterministic check result (not a semantic verdict)',
            'The host already executed handoff-table and explicit-reference checks for source revision ' + delivery!.designReview!.revision +
              '. These are actual check results, not author claims. Reuse unchanged results; do not rerun merely to claim tool use. The host checks saved corrections again before release.',
            ...(delivery!.designReview!.step === 'revise' ? ['Correct the supplied deterministic failures within the exact authorized revision scope even if recorded findings are empty or labelled follow-up. Preserve recorded finding IDs and severity; do not invent semantic findings for program diagnostics. A missing necessary owner decision or evidence requires blocked, not a guessed fix.'] : []),
            formatLayoutReport({ ...designDiagnostics, valid: !designDiagnostics.issues.length },
              retainLayoutReport(session.cwd, designDiagnostics))] : []),
          ...(phase === 'review' ? ['# Current saved handoff pointers (not a semantic verdict)',
            'Use these current source pointers instead of serially reading every metadata sidecar. Inspect their actual saved prose and retained source files; no hash or pointer proves meaning or coverage. Read a sidecar only for a concrete unresolved question or to revise its affected pointers.',
            '[\n' + designReviewIndexes(session.cwd, [...new Set(reviewInputs)], reviewReadScope).map(index => JSON.stringify(index)).join(',\n') + '\n]',
            'sourceReads supplies native Read arguments for the assigned saved source ranges. Retrieve independent ranges together; subdivide an oversized range against the same original file. These locations are snapshots, not read evidence: after edits relocate changed clauses in the current source. Expand beyond the initial ranges for a concrete dependency.'] : []),
          ...(phase === 'review' && deliveryDispatch ? ['# Existing retained linked files (existence only)',
            'The host resolved explicit Markdown links relative to their source document, not the project root. These nonempty files exist at the following workspace-relative paths. Inspect relevant contents; existence does not establish calculation correctness or semantic adequacy. Use the reference checker for an unresolved link; a Glob in a different directory cannot prove that a cited file is missing.',
            JSON.stringify(checkDesignDocumentReferences(session.cwd, delivery?.authorBatch ?? AUTHOR_BATCHES.length - 1).retainedFiles)] : []),
          ...(!gddAuthor && (phase === 'author' || phase === 'review') ? ['Document reference check: bun .beegame/delivery/check-content.mjs --design-references' +
            ` --author-batch ${(delivery?.authorBatch ?? (phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0)) + 1}` +
            '. This read-only check shares the host handoff validator; it checks explicit local file references, not prose authority or design quality. Cite actual source file links/sections and inspect their decisions; scheduled future references remain pending until delivered.'] : []),
          ...(spatialCalculation ? [spatialCalculation, spatialEntry,
            'Use the supplied host geometry report while its inputs are unchanged. If a new batch calculation is needed, pass the confirmed settings: bun .beegame/delivery/check-content.mjs ' +
              (phase === 'content' ? '--design-layouts' : '--review-layouts') + ' --report' +
              (['Landscape', 'Portrait'].includes(String(reviewSettings?.orientation)) ? ' --orientation ' + reviewSettings!.orientation : '') +
              (['2D', '3D', 'VR', 'AR'].includes(String(reviewSettings?.dimension)) ? ' --dimension ' + reviewSettings!.dimension : '') +
              '. The readable report includes failures, measurements, closure conditions, coverage and a retained full JSON path. Host release recomputes saved corrections; a design fingerprint alone does not certify changed resource bindings.'] : []),
          ...(!spatialCalculation && authorNeedsFormat ? [formatEntry] : []),
          ...(numericalCalculation ? [numericalCalculation] : []),
          ...(resultInstruction ? [resultInstruction] : []),
          ...(releaseInterface ? ['# Release evidence interface', releaseInterface, CONTENT_RUNTIME_REPORT_INSTRUCTION, DESIGN_RUNTIME_REPORT_INSTRUCTION,
            'For a source-backed design issue, acceptance.json may include designIssues using the existing finding fields {id,severity,action,owner,documents,sources:[{document,section:exact heading}],impact,closeWhen,neededBefore}. Report failed/blocked, not passed. This records the decision needed; it does not automatically reopen frozen design. Correct implementation defects against the baseline; request explicit direction only for a necessary change beyond existing authority.'] : []),
          ...(releaseInterface ? [`Before submission, run the read-only acceptance check: \`${acceptanceCheck}\` from the project root. It uses the delivery validator for report, content references and evidence files without launching a browser or recording acceptance. Correct report errors or fill verification gaps as appropriate; unchanged valid evidence can be reused. Passing this check does not independently certify gameplay or publish the project.`] : []),
          ...(access && phase !== 'review' && !gddAuthor ? ['# Optional capabilities', access.instruction] : []),
          ...(access?.resourceTools && phase !== 'review' && !gddAuthor ? ['Optional asset command: `bun .beegame/tmp/' + input.sessionId + '/assets.mjs help`. It browses the existing library, downloads selected files and requests images without manual curl; it never selects resources or edits the Manifest for you. Other sources and native tools remain available.'] : []),
          ...(contentHelper ? ['Optional browser-safe content helpers: ' + CONTENT_CONSUMER_PATH + '. It exports the same schema, atlas, Tilemap, coordinate and UI paint-order functions used by BGS Editors, plus startup/on-demand document fetch helpers. contentDocumentPath resolves exact registered IDs; fetch helpers resolve document paths against the actual index URL and report the failing document. Resource dependencies still need loading, including atlases referenced by TileSets. Use or ignore it; it is not a game engine.'] : []),
        ].join('\n\n'), 'utf8')
        if (directionAuthors) {
          for (const { document } of scheduledAuthors!) {
            let integrationPointers: ReturnType<typeof designReviewIndexes> | undefined
            if (document === 'TECHNICAL_DESIGN.md' && writingBatch === AUTHOR_BATCHES.length - 1) {
              const owners = PROJECT_DOCUMENTS.filter(name => name !== 'ASSET_PLAN.md')
              const indexes = designReviewIndexes(session.cwd, owners)
              const clauses = Object.fromEntries(indexes.map(index => [index.document, 'outputs' in index
                ? [...new Set(index.outputs.flatMap(output => [output.section, ...output.acceptance ? [output.acceptance.section] : []]))]
                : null]))
              integrationPointers = designReviewIndexes(session.cwd, owners, clauses)
            }
            await writeFile(directionAuthors.contextPaths![document]!, [
              '# Temporary project state (input only; removed at turn end, not a retained document source)',
              JSON.stringify(context, null, 2),
              ...originalInputs,
              authorBatchInstruction(writingBatch!, document),
              ...(['UI_UX_SPEC.md', 'ASSET_PLAN.md'].includes(document) ? [
                '# Saved upstream requirement locations',
                'Actual prose chapter locations, including unindexed clauses; not an instruction to read every chapter. Start from the original brief and GDD, then retrieve the specialist interfaces you consume together: bun .beegame/delivery/check-content.mjs --read-design \'[{"document":"ART_DIRECTION.md","sections":["Exact heading"]}]\'. This returns current original prose, not a summary. Native Read remains available. Expand for uncertain dependencies; missing pointers never excuse omissions. Do not read whole siblings merely to discover headings. Refresh locations after edits.',
                JSON.stringify(designSourceLocations(session.cwd, [...new Set(AUTHOR_BATCHES.slice(0, writingBatch!).flat())])),
              ] : []),
              ...(['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md'].includes(document) ||
                  document === 'TECHNICAL_DESIGN.md' && writingBatch === AUTHOR_BATCHES.length - 1 ? [
                '# Existing-draft edits (mechanical helper, no new design authority)',
                'Batch known exact changes directly: bun .beegame/delivery/edit-drafts.mjs --json \'[{"file":"docs/' + document + '","replacements":[{"old":"unique saved text","new":"replacement text"}]}]\'. The same request accepts your existing content/ui or content/scenes JSON paths: use one entry per file and combine its known replacements in order. Correct the related reported failures together, then run the affected batch check; do not read/recheck after each independent scalar change. Do not guess a fix or suppress unresolved diagnostics. Use assigned paths and valid shell quoting; no request file is needed. All files share preflight. Match/JSON failures write nothing; I/O failures report written/pending, not a multi-file transaction. Append by replacing a unique end paragraph with itself plus additions. Preserve unchanged prose. Native Edit/Write remain for individual changes/new files/genuine structural changes; no semantic approval or new edit authority is granted.',
              ] : []),
              ...(document === 'TECHNICAL_DESIGN.md' && writingBatch === AUTHOR_BATCHES.length - 1 ? [
                '# Earlier owner requirement pointers for final task organization',
                'These are snapshots taken before this writing batch, not reviewed completeness or runtime success. ASSET_PLAN runs before you in this same batch: read its newly saved docs/ASSET_PLAN.md and .beegame/design-handoffs/ASSET_PLAN.json now, not an earlier snapshot. Read actual owner prose and refresh any changed input; index your own completed technical outcomes before organizing all eight owners into implementationItems.',
                '[\n' + integrationPointers!.map(index => JSON.stringify(index)).join(',\n') + '\n]',
                'sourceReads locates the registered owner decision/acceptance clauses in the original files. Retrieve these ranges together instead of searching headings or rereading every source from the top; expand for an actual unresolved dependency. Locations are a pre-batch snapshot, invalid after source edits. Read the current technical baseline/index and newly saved Asset Plan as assigned.',
                'After saving the final task paragraphs and index, run bun .beegame/delivery/check-content.mjs --check-handoff-drafts docs/TECHNICAL_DESIGN.md --final-technical. This shares the completion check for all declared requirement references, duplicates and uncovered owner outcomes, without requiring host versions. Do not recreate coverage checking in temporary scripts; inspect actual owner prose for semantic decisions. Group related known edits before this check and correct its reported issues together.',
              ] : []),
              ...(document === 'TECHNICAL_DESIGN.md' && writingBatch === 1 ? [formatEntry,
                '# Current platform runtime/data baseline (verbatim selected format sections, not game design)',
                JSON.stringify(runGameContentCommand(session.cwd, ['--format', 'coordinates', 'runtimeConsumption']), null, 2),
                'These selected source sections are already supplied. Inspect more only for a specific unresolved decision, not to prepare future Content implementation.',
              ] : []),
              ...(document === 'TECHNICAL_DESIGN.md' && writingBatch === AUTHOR_BATCHES.length - 1 ? [
                '# Platform reference for unresolved integration questions',
                'The saved technical baseline is the starting point; the initial platform-format packet is not repeated here. If an interface needs clarification, read only its relevant sections with bun .beegame/delivery/check-content.mjs --format SECTION ...; --format lists available section names. The current reference is .beegame/delivery/content-format.json. Do not infer an unsupported API from the baseline.',
              ] : []),
              ...(['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md'].includes(document) ? [
                '# Mechanical draft construction', COMPOSE_DRAFT_HELP,
                DESIGN_CALCULATION_INSTRUCTION,
                '# Supplied spatial command interface (reuse; do not rediscover through source/log probes)',
                'Save all required actual sources and batch independent writes; do not add a mandatory first-screen check/rewrite loop. ' +
                  (document === 'UI_UX_SPEC.md'
                    ? 'Use bun .beegame/delivery/check-content.mjs --design-layouts --draft --report' +
                      (['Landscape', 'Portrait'].includes(String(reviewSettings?.orientation)) ? ' --orientation ' + reviewSettings!.orientation : '') +
                      (['2D', '3D', 'VR', 'AR'].includes(String(reviewSettings?.dimension)) ? ' --dimension ' + reviewSettings!.dimension : '') +
                      '. The readable report includes grouped failures, actual geometry and close conditions, and the saved full-result path. Read that result for additional details; no output-parsing script is needed. Parent geometry is parent-local; bounds/corners are host-space.'
                    : 'Use bun .beegame/delivery/check-content.mjs --scene-layouts --report. It discovers every saved Scene, including nested paths, and checks each at its own saved Camera viewport without a cross-product of unrelated sizes. Explicit WIDTH HEIGHT pairs are only for an additional intended common viewport requirement, not a list of per-level sizes. Actual UI game-view framing is checked once those compositions exist.') +
                  ' Geometry is not visual acceptance or rule correctness; the joint host check supplies failures for grouped Revision.',
                'Read exact saved draft nodes/fields together with bun .beegame/delivery/check-content.mjs --inspect-draft FILE --node ID --pointer /data/settings; no content index or assets needed. Omit selectors for a short overview. --help provides other signatures/result meanings, --details includes computed geometry. ok means execution, not quality. Keep runtime/resource limitations explicit.',
                'Minimal ' + (document === 'UI_UX_SPEC.md' ? 'UI' : 'Scene') + ' draft (platform example, not a game layout):\n' +
                  JSON.stringify(document === 'UI_UX_SPEC.md' ? CONTENT_DRAFT_EXAMPLES.ui : CONTENT_DRAFT_EXAMPLES.scene),
                '# Selected coordinates/layout contract',
                ...(document === 'UI_UX_SPEC.md' ? [JSON.stringify(runGameContentCommand(session.cwd, ['--format', 'uiVocabulary']))] : []),
                'Read additional fields for the actual chosen composition via bun .beegame/delivery/check-content.mjs --format ' +
                  (document === 'UI_UX_SPEC.md' ? 'coordinates uiDocument uiVocabulary uiLayoutContract' : 'coordinates sceneDocument sceneVocabulary sceneVisibilityContract') +
                  '. Closed role/component vocabularies and units remain authoritative; do not invent values or infer engine defaults. Related sections can be retrieved in one call. Full field examples need not be replayed in the task input. Saving tools automatically return structural issues for changed Scene/UI sources; these are not geometry or quality clearance, and unavailable checks remain explicit.',
                ...(document === 'LEVEL_SCENE_DESIGN.md' ? [
                  'If using Tilemap, --format tilemap supplies examples.scene: a complete draft with Grid ancestry and TilemapRenderer, built from the same component examples. Reuse its structure, not its sample cells, dimensions or resource IDs. Grid references alone do not establish parentage. Keep generator output in the supplied sceneDocument envelope; batch-check resulting files with the command above.',
                ] : []),
              ] : []),
              ...(document === 'BALANCE_DESIGN.md' ? [BALANCE_CALCULATION_INSTRUCTION] : []),
              ...(document === 'LEVEL_SCENE_DESIGN.md' ? [SCENE_CALCULATION_INSTRUCTION] : []),
              ...(document === 'LEVEL_SCENE_DESIGN.md' && access?.resourceTools ? [
                'Use existing assets or minimal critical samples only if actual resource geometry is necessary to settle this layout. Optional resource command: ' + assetCommand + ' help. Retain a cited reference under docs/visual/LEVEL_SCENE_DESIGN/ with provenance and scope; it is not a completed asset manifest or full resource batch.',
              ] : []),
              'Retrieve independent source clauses together, using exact saved draft selectors for data questions rather than reading whole expanded Scene files. Finish related edits before rechecking. A static check result covers its stated scope and inputRevision, not semantic quality. Reuse unchanged results; inspect the complete issues once instead of repeatedly changing output filters. Changes to sources, dependency availability or check conditions invalidate reuse. Read current files when needed; previous tool logs and your own earlier conclusions are not current authority.',
            ].join('\n\n'), 'utf8')
          }
        }
      } catch (error) {
        await revokePreview?.()
        await access?.close()
        await Promise.all([...temporaryContextPaths, assetCommandPath, acceptanceCheckPath].map(file => unlink(file).catch(() => undefined)))
        throw error
      }
      return {
        ...(directionAuthors ? { directionAuthors } : {}),
        ...(delivery?.status === 'active' ? { projectTurn: {
          ...(resultPhase && resultPhase !== 'review' && !authorFinalResponse ? { milestoneResult: { phase: resultPhase, path: resultPath,
            ...(resultPhase === 'content' ? { objective: delivery.objective } : {}),
            ...(resultPhase !== 'author' && delivery?.designBaseline ? { designBaseline: {
              digestVersion: delivery.designBaseline.digestVersion ?? 1, snapshots: delivery.designBaseline.snapshots,
              evidenceHashes: delivery.designBaseline.evidenceHashes,
              followUps: delivery.designBaseline.followUps,
            } } : {}),
          } } : {}),
          ...(deliveryDispatch && (phase === 'resources' || phase === 'content') ? {
            production: { phase, contextPath: path, ...(resourceContextPaths ? { resourceContextPaths } : {}),
              inputRevision: createHash('sha256').update(JSON.stringify([delivery.objective,
                delivery.designBaseline?.revision, phase === 'content' ? contentInputs : null])).digest('hex') },
          } : {}),
          ...(phase === 'author' && !directionAuthors && (delivery.authorBatch ?? 0) === 0 && deliveryDispatch
            ? { authorDocument: 'GDD.md' as const } : {}),
          ...(reviewDocuments ? { reviewDocuments: [...reviewDocuments], reviewContextPath: path,
            ...(reviewReadScope ? { reviewReadScope } : {}),
            reviewStep: delivery!.designReview!.step, reviewResultPath: resultPath, reviewWorkspace: session.cwd,
            ...(reviewSettings ? { reviewSettings } : {}),
            reviewRevision: delivery!.designReview!.revision,
            reviewUserDecisions: delivery!.designReview!.step === 'revise' ? delivery!.designReview!.userDecisions ?? [] : [],
            reviewWritableDocuments: delivery!.designReview!.step === 'revise' ? [...reviewDocuments] : [], reviewWritableFiles,
            reviewReceiptContext: reviewAssignment!.receiptContext } : {}),
        } } : {}),
        // Small changing facts belong to this turn, not a cached system prompt
        // or a file whose updated contents may never enter the model context.
        turnContext: delivery || access ? [
          'BGS project state (platform context, not additional user instructions):',
          ...(delivery ? ['Current original confirmed requirements: ' + (gddAuthor
            ? projectSourceText(delivery.objective) : JSON.stringify(delivery.objective))] : []),
          ...(input.initialBrief && (!gddAuthor || projectInitialInstruction(input.message, delivery?.objective ?? ''))
            ? [gddAuthor ? projectInitialInstruction(input.message, delivery?.objective ?? '') : input.message] : []),
          ...(milestone && !repeatMilestone ? [milestone] : []),
          ...(implementationChecklist && !repeatMilestone ? [
            'Reviewed implementation checklist (required execution input, not a new scope): ' + JSON.stringify(implementationChecklist),
          ] : implementationChecklist ? [`Reviewed task checklist remains in ${path}; preserve original IDs and requirement references when continuing.`]
            : checklistDiagnostic ? ['Implementation checklist unavailable: ' + checklistDiagnostic] : []),
          ...(directionAuthors ? ['BGS schedules the assigned professional writing owners with document-local histories and preloads their writing Skills, then forwards their actual handoffs without another main-model turn. Once all eight saved drafts are complete, the joint independent Review/Revision owns checking and correction. Dispatch and Skill loading establish execution, not semantic quality.'] : []),
          ...(reviewDocuments ? [`BGS schedules an independent ordinary CLI task for this design step with source-backed game-design-check methods. It reads this original task path: ${path}, performs the review and records its own conclusion. No coordinator model rewrites the assignment or replaces its result. Methods are supplied through the standard system-prompt option; a Skill tool call is not fabricated.`] : []),
          ...(gddAuthor ? ['The complete GDD assignment and original requirements are supplied above. The target docs/ and .beegame/design-handoffs/ directories already exist. The task file is recovery input if context is missing; no directory discovery or duplicate read is required merely to begin. BGS checks the terminal conclusion and saved index/references after this ordinary native turn; a native completion is not document acceptance.'] : []),
          ...(!gddAuthor && (phase === 'author' || phase === 'review') ? ['Document references: bun .beegame/delivery/check-content.mjs --design-references' +
            ` --author-batch ${(delivery?.authorBatch ?? (phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0)) + 1}` +
            '. Broken explicit references are review diagnostics and prevent release to consumers; titles and semantic agreement still require source inspection.'] : []),
          ...(spatialCalculation ? [spatialEntry] : []),
          ...(phase === 'implementation' ? ['Runtime parsing/layout helper remains available at .beegame/delivery/content-consumer.mjs; its actual API is in the format reference. This helper does not implement gameplay.'] : []),
          ...(!spatialCalculation && authorNeedsFormat ? [formatEntry] : []),
          ...(numericalCalculation ? [numericalCalculation] : []),
          ...(resultInstruction ? [resultInstruction] : []),
          ...(delivery ? [`Project status: ${delivery.status}; milestone: ${projectDeliveryPhase(delivery)}. Recovery context: ${path} (temporary input, removed at turn end; not a retained document source).`] : []),
          ...(delivery?.status === 'active' && projectDeliveryPhase(delivery) !== 'complete'
            ? ['This turn delivers the current milestone. After its result is ready, finish the turn; BGS will hand off the next milestone in this same native session. Planning, tools and delegation remain yours.'] : []),
          ...(releaseInterface && !repeatMilestone ? [releaseInterface, CONTENT_RUNTIME_REPORT_INSTRUCTION, DESIGN_RUNTIME_REPORT_INSTRUCTION] : []),
          ...(releaseInterface && repeatMilestone ? [`The acceptance report contract remains in ${path}; reuse it when correcting the report.`] : []),
          ...(releaseInterface ? [`Read-only acceptance check before submission: ${acceptanceCheck} (run from the project root). It shares the delivery validator, does not run a browser or record acceptance, and does not replace actual runtime verification.`] : []),
          ...(contentInputs ? [`Current content inputs: ${JSON.stringify(contentInputs)}`] : []),
          ...(access && !gddAuthor ? [`Optional capabilities for this turn: ${path}. Previous turns' temporary localhost capability URLs have expired.`] : []),
          ...(access?.previewBaseUrl && !gddAuthor ? [`Current project Preview test API: ${access.previewBaseUrl}. Previous turns' Preview URLs are expired. This endpoint starts an isolated muted browser and records console/network/screenshot evidence; usage details are in ${path}. Native browser tools remain available.`] : []),
          ...(access?.resourceTools && !gddAuthor ? [`Current resource library / image-generation entry: ${assetCommand} help. This project-local command uses this turn's endpoints; resource selection remains yours.`] : []),
          ...(contentHelper ? [`Optional content parsing, layout/text-measurement and staged-loading helpers: ${CONTENT_CONSUMER_PATH} (stable browser-safe ES module; no game engine). inspectUiLayoutInBrowser awaits fonts and checks the authored text and legal textSamples using the shared layout. Candidate versus registered fonts are explicit. The same module remains available after this turn; no temporary copy is required. If the game uses it, include it in the deployable build. A math helper is not a renderer or visual-quality proof: verify complete Scene/UI composition, actual fonts and interaction in the target runtime.`] : []),
        ].join('\n') : undefined,
        // Stable even at completion/pause: changing project facts belong to
        // the turn, not the runner configuration or an obligatory file read.
        systemContext: [
          'Keep user-facing progress and final replies concise, in the user’s preferred language. Link to saved artifacts; report outcomes, failures and verification limits. This is a presentation preference, not a limit on investigation or requested explanations.',
          'Continue this project in the same session. Follow the user request and account for any unfinished delivery objective in the supplied project state. The current milestone is the outcome for this turn; choose your planning, tools and delegation. Delegate outcomes, owned scope and source-backed constraints, not an undecided specialist solution or arbitrary word quota. In a delegated assignment, distinguish confirmed user/source decisions from coordinator suggestions; investigate an unsupported constraint rather than silently treating it as an upstream agreement.',
          'Prioritize required outcomes and actual dependencies. Reassess repeated failures before expanding mechanisms or experiments; do not drop required work as a cost shortcut, expand scope/cost without user agreement or polish after the requested outcome is met.',
          'Work from the current task and relevant sources, not every available contract. Finish related edits before rechecking. Reuse static results only while their inputs and conditions are unchanged; source changes invalidate reuse. Inspect complete diagnostics once. Runtime claims need current environment evidence, not file stability or old logs.',
          'Across all project work, verify that a cited authority exists, contains the relevant decision and owns that subject. Identify it by actual file path and section, not an unresolvable title. Explicit user requirements and actual platform constraints apply across disciplines; distinguish them from author-chosen decisions. GDD owns the player promise, release scope and core gameplay contract, not every professional choice. Being written first or appearing in GDD does not promote a non-owner proposal into a confirmed constraint. During author/review, resolve such choices in their responsible existing document and reconcile affected references through integration; preserve reviewed baselines in later milestones. Guidance, examples and tool names do not establish project decisions or promised deliverables. Do not invent another authority artifact; reconcile an absent and unplanned owner in the existing responsible document before handoff.',
          'Delegate or defer required work only to an identified responsible role or task within the agreed workflow, with a concrete expected output and the point where it is needed. An assigned future dependency is still unresolved until delivered and checked; an unassigned promise is not a handoff. Include these dependency boundaries in subagent assignments. Resolve gaps within your responsibility or report their impact and the needed decision; continue independent work where possible, but do not claim affected work complete. Distinguish required decisions from optional work and hypotheses awaiting runtime verification.',
          'When a decision changes, the current integration/revision role reconciles its authoritative source and affected consumers, including superseded statements and open items, within the authorized editing scope. Do not send handed-off work back to its writing Agent for revision. Otherwise report the inconsistency rather than editing protected sources. Check the resulting files and combined outputs before handoff: reading a dependency, making a local edit or receiving an owner summary does not establish closure. Use existing artifacts and task records; no extra review stage is required. Preserve the delivered version and known limits as the baseline. For an authorized change, check the changed decision and affected consumers, not automatically all eight documents; a design defect that requires a new owner decision is not implementation freedom.',
          `Project workspace: ${session.cwd}. When prior task context is missing, read ${path}: it contains the original request and current project state. Do not infer a new task from an empty native history.`,
          'Investigate and verify the affected behavior. For an explicit user-requested design change, revise the affected document baseline before implementing that change; choose the implementation methods, task breakdown and delegation yourself. A defect fix that restores the existing design does not require rewriting the documents.',
          'Project files are editable within the user-authorized scope. BGS platform defects should be reported, not worked around by changing valid game data.',
        ].join('\n'),
        close: async () => {
          unsubscribeWrites?.()
          try { try { await revokePreview?.() } finally { await access?.close() } }
          finally {
            await unlink(resultPath).catch(() => undefined)
            await Promise.all([...temporaryContextPaths, assetCommandPath, acceptanceCheckPath].map(file => unlink(file).catch(() => undefined)))
          }
        },
      }
    },
    onTurnSettled: async () => {
      const terminal = input.sessions.transcript(input.sessionId).findLast(event =>
        acceptedTurnId !== undefined && event.turnId === acceptedTurnId &&
        (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty' || event.type === 'session.stopped'))
      if (terminal && terminal.type !== 'turn.completed' && documentTurn && revisionWrites && preparedDelivery?.designReview?.step === 'revise' && input.deliveryDataRoot) {
        await recordInterruptedDesignRevision(session.cwd, input.deliveryDataRoot, preparedDelivery, documentTurn.snapshot, revisionWrites)
      }
      if (terminal?.type === 'turn.completed' && turnStartedAt && input.deliveryDataRoot) {
        const delivery = await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        // Only the root native terminal result for this accepted dispatch is a
        // GDD conclusion. Intermediate chat, child results and old receipts do
        // not count; other phases retain their existing receipt contracts.
        const final = authorFinalResponse ? input.sessions.transcript(input.sessionId).findLast(event =>
          event.turnId === acceptedTurnId && event.type === 'result' && !event.payload?.parent_tool_use_id) : undefined
        const conclusion = authorFinalResponse
          ? final?.payload?.subtype === 'success' && final.payload.is_error !== true
            ? parseMilestoneResult(final.text, 'author', 'Author final response') : undefined
          : resultPhase ? await readMilestoneResult(resultPath, resultPhase) : undefined
        const phase = delivery && projectDeliveryPhase(delivery)
        // Bind the saved result and writable scope to this prepared turn. An
        // owner action or another turn cannot let an old result stamp new state.
        // The broker appends genuine answers while this Revision is waiting.
        // That authorized input and its newly registered decision finding are
        // not a new delivery task. Ignore only those appends; changed scope,
        // versions, prior decisions or owner requests
        // still invalidate the prepared turn.
        const previousAnswers = preparedDelivery?.designReview?.userDecisions ?? []
        const answersAppended = preparedDelivery?.designReview?.step === 'revise' && delivery?.designReview?.step === 'revise' &&
          preparedDelivery.designReview.revision === delivery.designReview.revision &&
          JSON.stringify(delivery.designReview.userDecisions?.slice(0, previousAnswers.length) ?? []) === JSON.stringify(previousAnswers)
        const previousFindings = preparedDelivery?.designReview?.findings ?? []
        const questionFindingsAppended = answersAppended &&
          JSON.stringify(delivery!.designReview!.findings.slice(0, previousFindings.length)) === JSON.stringify(previousFindings) &&
          delivery!.designReview!.findings.slice(previousFindings.length).every(f => f.owner === 'user' && f.action === 'decide' && f.severity === 'blocker' &&
            delivery!.designReview!.userDecisions?.slice(previousAnswers.length).some(d => d.id === f.id && d.revision === delivery!.designReview!.revision))
        const currentForTurn = answersAppended ? { ...delivery, designReview: { ...delivery!.designReview!,
          ...(questionFindingsAppended ? { findings: previousFindings } : {}), userDecisions: preparedDelivery!.designReview!.userDecisions } } : delivery
        const staleTurn = preparedDelivery?.status === 'active' && JSON.stringify(currentForTurn) !== JSON.stringify(preparedDelivery)
        if (!staleTurn && delivery && ['acceptance', 'complete'].includes(projectDeliveryPhase(delivery)))
          await captureProjectDeliveryAcceptance(session.cwd, input.deliveryDataRoot, turnStartedAt)
        // A reviewer may stop at its effort ceiling without a conclusion. An
        // explicit user turn is not permission to relaunch that review silently.
        if (staleTurn && phase) progress = { phase, shouldContinue: false,
          issues: ['Delivery changed during this turn; its result cannot finalize or advance the new state.'] }
        else if (delivery?.status === 'active' && !deliveryDispatch && !conclusion && resultPhase !== 'author' && resultPhase !== 'review') {
          const phase = projectDeliveryPhase(delivery)
          progress = { phase, shouldContinue: false, issues: [] }
        } else progress = await advanceProjectDeliveryAfterTurn(session.cwd, input.deliveryDataRoot, conclusion,
          documentTurn?.scheduledAuthors ? documentTurn.authorBatch : undefined, documentTurn?.snapshot)
        if (progress?.phase === 'complete') input.sessions.recordDeliveryPhase(input.sessionId, 'complete')
        if (progress && !progress.shouldContinue && progress.issues.length)
          input.sessions.recordDeliveryError(input.sessionId, progress.issues.join('; '), progress.diagnostic?.category)
      }
      readyToContinue = terminal?.type === 'turn.completed'
    },
    onTurnReady: async () => {
      if (readyToContinue) await input.afterTurnSettled?.(progress)
    },
  })
}
