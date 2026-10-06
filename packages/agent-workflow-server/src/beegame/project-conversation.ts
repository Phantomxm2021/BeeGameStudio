import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readMilestoneResult, type MilestoneResult } from './milestone-result'
import { designSupportingFiles, designHandoffPath, DESIGN_HANDOFF_DIRECTORY, designReviewSourceHeadings,
  snapshotDesignDocuments, designReviewIndexes, type DesignDocumentSnapshot } from './design-handoff'
import { writeProjectAssetCommand, type ProjectAssetCapabilities } from './project-asset-command'
import { bundleContentConsumer } from './game-content-consumer-cli'
import { CONTENT_RUNTIME_REPORT_INSTRUCTION } from './content-runtime-contract'
import { DESIGN_RUNTIME_REPORT_INSTRUCTION } from './runtime-acceptance'
import { bundleAcceptanceChecker } from './acceptance-check-bundle'
import { materializeSceneUiFormat, DESIGN_CALCULATION_INSTRUCTION, SPATIAL_CALCULATION_INSTRUCTION, DESIGN_INSPECTOR_PATH } from './scene-ui-content-authoring'
import { AUTHOR_BATCHES, authorBatchInstruction, authorBatchReviewInstruction, authorDocumentResponsibility } from './project-author'
import { nativeWritingAuthors, type NativeWritingBatch, type NativeDirectionAuthorInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { runGameContentCommand } from './game-content-validation-cli'
import { BALANCE_CALCULATION_INSTRUCTION, BALANCE_REVIEW_INSTRUCTION, materializeBalanceCalculator } from './balance-calculation'
import type { BeeGameEvent, BeeGameSessionManager } from './session-manager'
import { advanceProjectDeliveryAfterTurn, captureProjectDeliveryAcceptance, ensureProjectAssetManifestContract, refreshProjectContentContract, projectDeliveryPhase,
  projectDeliveryPhaseInstruction, PROJECT_DELIVERY_REPORT_PATH, readProjectDelivery,
  prepareProjectDesignReview, checkProjectDesignBaseline, projectDesignReleaseDiagnostics,
  PROJECT_DOCUMENTS, type ProjectDeliveryPhase } from './project-delivery'

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
  let acceptedTurnId: string | undefined
  let progress: Awaited<ReturnType<typeof advanceProjectDeliveryAfterTurn>>
  let readyToContinue = false
  let resultPhase: MilestoneResult['phase'] | undefined
  let preparedDelivery: Awaited<ReturnType<typeof readProjectDelivery>>
  let documentTurn: { snapshot: DesignDocumentSnapshot; authorBatch?: number; scheduledAuthors: boolean } | undefined
  const resultRelativePath = `.beegame/tmp/${input.sessionId}/milestone-${randomUUID()}.txt`
  const resultPath = join(session.cwd, resultRelativePath)
  // Restart records turn.failed; an actual Stop records session.stopped and
  // does not fabricate a native final result. The next user request resumes
  // that interrupted milestone with the same trusted dispatch boundary.
  const previousTerminal = input.sessions.transcript(input.sessionId).findLast(event =>
    event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty' || event.type === 'session.stopped')?.type
  const recoveringInterruptedTurn = !input.initialBrief && !input.autoContinuation &&
    (previousTerminal === 'turn.failed' || previousTerminal === 'session.stopped')
  const deliveryDispatch = Boolean(input.initialBrief || input.autoContinuation || recoveringInterruptedTurn)
  const path = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'context.md')
  const assetCommandPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'assets.mjs')
  const contentHelperPath = join(session.cwd, '.beegame', 'tmp', input.sessionId, 'content-consumer.mjs')
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
    onTurnAccepted: turnId => { acceptedTurnId = turnId; turnStartedAt = Date.now() },
    prepareTurn: async () => {
      let delivery = input.deliveryDataRoot
        ? await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        : undefined
      if (deliveryDispatch && delivery?.status === 'active' && projectDeliveryPhase(delivery) === 'review' && input.deliveryDataRoot)
        delivery = await prepareProjectDesignReview(session.cwd, input.deliveryDataRoot)
      if (deliveryDispatch && delivery?.status === 'active') {
        if (!delivery.designBaseline && !['author', 'review'].includes(projectDeliveryPhase(delivery)))
          throw new Error('This delivery has no reviewed design baseline. Prepare the saved design handoff and explicitly inspect through design-resolution before dependent work.')
        const issues = checkProjectDesignBaseline(session.cwd, delivery)
        if (issues.length) throw new Error(issues.join('; '))
      }
      if (delivery && ['author', 'review', 'resources'].includes(projectDeliveryPhase(delivery)))
        await ensureProjectAssetManifestContract(session.cwd)
      const contentInputs = delivery?.status === 'active' && projectDeliveryPhase(delivery) === 'content'
        ? await refreshProjectContentContract(session.cwd) : undefined
      const reviewDocuments = deliveryDispatch && delivery?.status === 'active' && projectDeliveryPhase(delivery) === 'review' && delivery.designReview ? delivery.designReview.step === 'inspect'
        ? [...PROJECT_DOCUMENTS]
        : delivery.designReview.writableDocuments ?? [...new Set(delivery.designReview.findings.filter(f => f.severity === 'blocker').flatMap(f => f.documents))]
        : undefined
      if (delivery?.status === 'active' && ['author', 'review'].includes(projectDeliveryPhase(delivery)))
        await mkdir(join(session.cwd, DESIGN_HANDOFF_DIRECTORY), { recursive: true })
      const reviewWritableFiles = delivery?.designReview?.step === 'revise' && reviewDocuments
        ? [...reviewDocuments.map(designHandoffPath), ...designSupportingFiles(session.cwd, reviewDocuments)] : []
      const milestone = delivery?.status === 'active'
        ? projectDeliveryPhase(delivery) === 'review' && deliveryDispatch
          ? authorBatchReviewInstruction(delivery.authorBatch ?? AUTHOR_BATCHES.length - 1, delivery.designReview?.step, delivery.designReview?.findings, delivery.designReview?.instruction, reviewDocuments)
          : projectDeliveryPhase(delivery) === 'review' ? undefined : projectDeliveryPhaseInstruction(projectDeliveryPhase(delivery), delivery.authorBatch) : undefined
      const designDiagnostics = deliveryDispatch && delivery?.designReview
        ? projectDesignReleaseDiagnostics(session.cwd, delivery)
        : undefined
      const phase = delivery?.status === 'active' ? projectDeliveryPhase(delivery) : undefined
      const authorDocuments = phase === 'author' ? AUTHOR_BATCHES[delivery?.authorBatch ?? 0] : undefined
      const authorNeedsSpatial = authorDocuments?.some(name =>
        name === 'LEVEL_SCENE_DESIGN.md' || name === 'UI_UX_SPEC.md')
      const authorNeedsFormat = authorNeedsSpatial || [...authorDocuments ?? [], ...reviewDocuments ?? []].some(name => name === 'TECHNICAL_DESIGN.md')
      const reviewInputs = [...reviewDocuments ?? [], ...delivery?.designReview?.findings.flatMap(f => f.sources.map(source => source.document)) ?? []]
      const reviewNeedsSpatial = phase === 'review' && reviewInputs.some(name => ['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md'].includes(name))
      const spatialCalculation = reviewNeedsSpatial || phase === 'content' || phase === 'implementation' ||
        authorNeedsSpatial
        ? (phase === 'author' || phase === 'review' ? DESIGN_CALCULATION_INSTRUCTION : SPATIAL_CALCULATION_INSTRUCTION)
        : undefined
      const numericalCalculation = phase === 'review' && reviewInputs.includes('BALANCE_DESIGN.md') ? BALANCE_REVIEW_INSTRUCTION(delivery?.designReview?.step === 'revise') : phase === 'author' &&
        AUTHOR_BATCHES[delivery?.authorBatch ?? 0]?.some(name => name === 'BALANCE_DESIGN.md')
        ? BALANCE_CALCULATION_INSTRUCTION : undefined
      if (numericalCalculation) await materializeBalanceCalculator(session.cwd)
      resultPhase = deliveryDispatch && (phase === 'review' || phase === 'author' && (delivery?.authorBatch ?? 0) === 0) ||
        phase === 'implementation' ? phase : undefined
      const resultInstruction = resultPhase
        ? resultPhase === 'review'
          ? `Write the exact step receipt at ${resultRelativePath}, using the bounded review JSON format in the assignment. complete means this step executed, not documents released; blocked still requires the JSON findings. Only the host releases documents.`
          : `Record your ${resultPhase} conclusion in ${resultRelativePath}: first line complete only when this milestone's stated outcome is met, or blocked followed by a short reason on the next line. This small handoff prevents a finished chat turn being mistaken for finished work; your normal reply, methods and delegation remain unrestricted. Do not mark incomplete work complete.`
        : undefined
      // Refresh platform-owned format guidance for resumed projects too. This
      // does not rewrite their authored content or revision authority snapshot.
      if (phase === 'review' || spatialCalculation || authorNeedsFormat || (delivery?.status === 'active' && ['implementation', 'acceptance'].includes(projectDeliveryPhase(delivery))))
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
      const writingBatch = delivery?.authorBatch as NativeWritingBatch | undefined
      const scheduledAuthors = writingBatch && [1, 2, 3, 4].includes(writingBatch)
        ? nativeWritingAuthors(writingBatch) : undefined
      const directionAuthors: NativeDirectionAuthorInput | undefined = deliveryDispatch && phase === 'author' && scheduledAuthors && !repeatMilestone
        ? { batch: writingBatch, contextPath: path,
          responsibilities: Object.fromEntries(scheduledAuthors.map(({ document }) =>
            [document, authorDocumentResponsibility(writingBatch!, document)])),
          contextPaths: Object.fromEntries(scheduledAuthors.map(({ document }) =>
            [document, join(dirname(path), document + '.context.md')])) }
        : undefined
      preparedDelivery = delivery
      const turnDocuments = deliveryDispatch && phase === 'author' && ((delivery?.authorBatch ?? 0) === 0 || directionAuthors)
        ? [...authorDocuments ?? []] : deliveryDispatch && phase === 'review' && delivery?.designReview?.step === 'revise' ? [...reviewDocuments ?? []] : undefined
      if (turnDocuments) documentTurn = {
        snapshot: snapshotDesignDocuments(session.cwd, turnDocuments),
        ...(phase === 'author' ? { authorBatch: delivery?.authorBatch ?? 0 } : {}), scheduledAuthors: !!directionAuthors }
      const temporaryContextPaths = [path, ...Object.values(directionAuthors?.contextPaths ?? {})]
      const releaseInterface = delivery && projectDeliveryPhase(delivery) === 'acceptance'
        ? `Publish reads ${PROJECT_DELIVERY_REPORT_PATH}: scope "delivery"; status "passed" | "failed" | "blocked"; summary and environment as nonempty strings; evidencePaths and artifactPaths as workspace-relative string arrays; verification {target:"deployment",observation:"target-runtime"|"simulation",knownIssues:string[],unverified:string[],outsideScope?:string[],contentChecks?:array,requirementChecks?:array}. Record the actual test environment as a string, not an object. A passed result requires target-runtime verification, no unresolved or unverified requirements in the agreed release scope, and saved evidence and tested artifacts for the current version. Put unavailable checks of in-scope requirements in unverified; put observations outside the agreed release scope (such as physical-device feel when only browser input is in scope) in outsideScope. Do not use outsideScope for an in-scope requirement or as a substitute for available target-runtime checks. If target-runtime verification is unavailable, report blocked; simulated checks alone cannot establish delivery. This is a saved integration artifact, not the format of your chat response; ordinary questions and partial fixes do not require it.`
        : undefined
      if (delivery?.status === 'active')
        input.sessions.recordDeliveryPhase(input.sessionId, projectDeliveryPhase(delivery))
      const access = input.openCapabilities?.(delivery?.status === 'active' ? projectDeliveryPhase(delivery) : undefined)
      const contentHelper = delivery?.status === 'active' && phase === 'acceptance'
        ? await bundleContentConsumer().catch(() => undefined) : undefined
      const spatialEntry = `Spatial tools: bun .beegame/delivery/check-content.mjs --help includes commands, a minimal draft and result shapes. Run bun .beegame/delivery/check-content.mjs --format to list actual format sections; run bun .beegame/delivery/check-content.mjs --format coordinates to read the coordinates section without the full specification. Full supported fields: .beegame/delivery/content-format.json. Calculation scope is in ${path}; geometry is not visual acceptance.` +
        (phase === 'author' || phase === 'review'
          ? ' Eight-document author/review delivers planning documents and the UI owner begins the actual content/ui layout files. Review uses those same linked files; resources, Scene/VFX, package registration and runtime work remain later. Minimal calculations may substantiate other specific design claims; a temporary game, full package or delivered-font proof is not required. Partial static samples are not mandatory and cannot replace layout calculation.'
          : ` UI layout files begun during planning remain the same editable sources; Content completes their resource/action bindings alongside Scene/VFX. Stable browser helper: .beegame/delivery/content-consumer.mjs; its API and return shapes are in the format. Browser entry: node ${DESIGN_INSPECTOR_PATH} --help measures text/geometry and optionally captures an existing composition; it does not itself render one or certify aesthetics. Use actual saved JSON to render complete UI compositions with delivered resources/fonts before Content handoff; gameplay/interaction remains runtime acceptance.`)
      const formatEntry = 'Content format reference: bun .beegame/delivery/check-content.mjs --format coordinates runtimeConsumption reads the runtime/data baseline together. Use --format without section names only to discover an additional section needed by a current decision; read those additional sections together, without truncating the result with head. The CLI --help documents checks and their limits; its bundled implementation is not a design input. Full reference remains available at .beegame/delivery/content-format.json; technical authoring does not produce formal Content.'
      const sampleEntry = access?.previewBaseUrl
        ? `Static visual sample inspection: node ${DESIGN_INSPECTOR_PATH} --visual-sample docs/visual/OWNER/sample.html WIDTH HEIGHT --preview-api ${access.previewBaseUrl}. OWNER is ART_DIRECTION or UI_UX_SPEC; SVG is also supported. Use actual saved paths and positive pixel dimensions. The trusted helper renders self-contained static markup with scripts and external requests disabled, captures to a private tool cache and returns the path/source hash. Read that image to judge the sample. It does not generate a design, run the game or certify aesthetics; raster references can be read directly. Do not cite its temporary captures as durable design sources.`
        : 'Static sample browser capability is unavailable. Raster samples can be inspected with Read; distinguish source-only inspection from an observed render and report unavailable required visual checks.'
      try {
        const events = input.sessions.transcript(input.sessionId)
        const brief = events.find(event => event.type === 'user.message' &&
          event.payload?.displayKind === 'confirmed_brief')
        const originalRequest = delivery?.objective ?? brief?.text
        const confirmedBriefContext = brief?.payload?.confirmedBriefContext
        const context = {
          workspace: session.cwd,
          originalRequest,
          ...(typeof confirmedBriefContext === 'string' && confirmedBriefContext !== originalRequest
            ? { confirmedBriefContext } : {}),
          ...(delivery ? { delivery: { status: delivery.status, phase: projectDeliveryPhase(delivery),
            ...(projectDeliveryPhase(delivery) === 'author' ? { authorBatch: (delivery.authorBatch ?? 0) + 1 } : {}),
            ...(delivery.designBaseline ? { designBaselineRevision: delivery.designBaseline.revision,
              knownFollowUps: delivery.designBaseline.followUps,
              ...(delivery.designBaseline.change ? { affectedDesignChange: delivery.designBaseline.change } : {}) } : {}),
            ...(delivery.designReview?.instruction ? { ownerResolution: { instruction: delivery.designReview.instruction,
              affectedDocuments: delivery.designReview.writableDocuments ?? [...new Set(delivery.designReview.findings.flatMap(f => f.documents))] } } : {}),
            acceptanceReportPath: PROJECT_DELIVERY_REPORT_PATH } } : {}),
          ...(contentInputs ? { contentInputs } : {}),
        }
        await mkdir(dirname(path), { recursive: true })
        if (access?.resourceTools) await writeProjectAssetCommand(assetCommandPath, access.resourceTools)
        if (contentHelper) await writeFile(contentHelperPath, contentHelper, 'utf8')
        if (releaseInterface) await writeFile(acceptanceCheckPath, await bundleAcceptanceChecker(), 'utf8')
        await writeFile(path, [
          '# Temporary project state (input only; removed at turn end, not a retained document source)',
          JSON.stringify(context, null, 2),
          ...(delivery?.designBaseline?.change && phase !== 'review'
            ? ['# Reviewed affected design change\nUse affectedDesignChange above to update only impacted resources/data/implementation. Reuse unaffected valid work; rebind the formal Content revision before implementation. The retained review history is audit evidence, not a request to rerun eight-document authoring.'] : []),
          ...(milestone ? ['# Current delivery milestone', milestone] : []),
          ...(reviewDocuments ? ['# Exact saved source locations',
            reviewDocuments.map(name => `docs/${name}; handoff: ${designHandoffPath(name)}`).join('\n'),
            ...(reviewWritableFiles.length ? ['Authorized revision files (exact paths, not directory grants): ' + JSON.stringify([
              ...reviewDocuments.map(name => 'docs/' + name), ...reviewWritableFiles,
            ])] : []),
            ...(reviewWritableFiles.some(file => file.startsWith('docs/calc/')) ? [
              'When numerical source/model changes, correct the authorized model and regenerate its authorized appendix with bun .beegame/delivery/calculate-balance.mjs MODEL_PATH OUTPUT_PATH before handoff. This runs project code with the existing native execution permissions, not in the BGS server. Do not create another verifier.'] : []),
          ] : []),
          ...(reviewDocuments?.some(name => ['ART_DIRECTION.md', 'UI_UX_SPEC.md'].includes(name))
            ? [sampleEntry] : []),
          // Inspect owns semantic comparison, not another interpretation of
          // known field/link errors. The host still retains and checks those
          // errors and supplies them to the existing bounded revision step.
          ...(designDiagnostics && delivery!.designReview!.step === 'inspect' ? [
            '# Host deterministic check status (not a semantic verdict)',
            'The host already executed handoff-table and explicit-reference checks for source revision ' + delivery!.designReview!.revision +
              '. Failure details go directly to the existing revision step after semantic inspection; they are not semantic findings to reconstruct here. The host checks saved corrections again before release. Reuse unchanged results; inspect the actual saved drafts and relevant sources for semantic completeness, rule consistency and fact/evidence adequacy.',
          ] : designDiagnostics ? ['# Host deterministic check result (not a semantic verdict)',
            'The host already executed handoff-table and explicit-reference checks for source revision ' + delivery!.designReview!.revision +
              '. These are actual check results, not author claims. Reuse unchanged results; do not rerun merely to claim tool use. The host checks saved corrections again before release.',
            ...(delivery!.designReview!.step === 'revise' ? ['Correct the supplied deterministic failures within the exact authorized revision scope even if recorded findings are empty or labelled follow-up. Preserve recorded finding IDs and severity; do not invent semantic findings for program diagnostics. A missing necessary owner decision or evidence requires blocked, not a guessed fix.'] : []),
            designDiagnostics.length ? designDiagnostics.join('\n') : 'No deterministic issues reported for this source version. Semantic completeness, rule consistency and fact/evidence adequacy still require inspection.'] : []),
          ...(phase === 'review' ? ['# Current saved handoff pointers (not a semantic verdict)',
            'Use these current source pointers instead of serially reading every metadata sidecar. Inspect their actual saved prose and retained source files; no hash or pointer proves meaning or coverage. Read a sidecar only for a concrete unresolved question or to revise its affected pointers.',
            JSON.stringify(designReviewIndexes(session.cwd, [...new Set(reviewInputs)]))] : []),
          ...(phase === 'author' || phase === 'review' ? ['Document reference check: bun .beegame/delivery/check-content.mjs --design-references' +
            ` --author-batch ${(delivery?.authorBatch ?? (phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0)) + 1}` +
            '. This read-only check shares the host handoff validator; it checks explicit local file references, not prose authority or design quality. Cite actual source file links/sections and inspect their decisions; scheduled future references remain pending until delivered.'] : []),
          ...(spatialCalculation ? [spatialCalculation, spatialEntry] : []),
          ...(!spatialCalculation && authorNeedsFormat ? [formatEntry] : []),
          ...(numericalCalculation ? [numericalCalculation] : []),
          ...(resultInstruction ? [resultInstruction] : []),
          ...(releaseInterface ? ['# Release evidence interface', releaseInterface, CONTENT_RUNTIME_REPORT_INSTRUCTION, DESIGN_RUNTIME_REPORT_INSTRUCTION] : []),
          ...(releaseInterface ? [`Before submission, run the read-only acceptance check: \`${acceptanceCheck}\` from the project root. It uses the delivery validator for report, content references and evidence files without launching a browser or recording acceptance. Correct report errors or fill verification gaps as appropriate; unchanged valid evidence can be reused. Passing this check does not independently certify gameplay or publish the project.`] : []),
          ...(access ? ['# Optional capabilities', access.instruction] : []),
          ...(access?.resourceTools ? ['Optional asset command: `bun .beegame/tmp/' + input.sessionId + '/assets.mjs help`. It browses the existing library, downloads selected files and requests images without manual curl; it never selects resources or edits the Manifest for you. Other sources and native tools remain available.'] : []),
          ...(contentHelper ? ['Optional browser-safe content helpers: .beegame/tmp/' + input.sessionId + '/content-consumer.mjs. It exports the same schema, atlas, Tilemap, coordinate and UI paint-order functions used by BGS Editors, plus startup/on-demand document fetch helpers. contentDocumentPath resolves exact registered IDs; fetch helpers resolve document paths against the actual index URL and report the failing document. Resource dependencies still need loading, including atlases referenced by TileSets. Use or ignore it; it is not a game engine.'] : []),
        ].join('\n\n'), 'utf8')
        if (directionAuthors) {
          for (const { document } of scheduledAuthors!) {
            await writeFile(directionAuthors.contextPaths![document]!, [
              '# Temporary project state (input only; removed at turn end, not a retained document source)',
              JSON.stringify(context, null, 2),
              authorBatchInstruction(writingBatch!, document),
              ...(document === 'TECHNICAL_DESIGN.md' ? [formatEntry,
                '# Current platform runtime/data baseline (verbatim selected format sections, not game design)',
                JSON.stringify(runGameContentCommand(session.cwd, ['--format', 'coordinates', 'runtimeConsumption']), null, 2),
                'These selected source sections are already supplied. Inspect more only for a specific unresolved decision, not to prepare future Content implementation.',
              ] : []),
              ...(['LEVEL_SCENE_DESIGN.md', 'UI_UX_SPEC.md'].includes(document) ? [
                DESIGN_CALCULATION_INSTRUCTION, spatialEntry,
                '# Supplied spatial command interface (reuse; do not rediscover through source/log probes)',
                JSON.stringify(runGameContentCommand(session.cwd, ['--help']), null, 2),
                '# Selected coordinates/layout contract',
                JSON.stringify(runGameContentCommand(session.cwd, ['--format', 'coordinates',
                  ...(document === 'UI_UX_SPEC.md' ? ['uiLayoutContract'] : [])]), null, 2),
              ] : []),
              ...(document === 'BALANCE_DESIGN.md' ? [BALANCE_CALCULATION_INSTRUCTION] : []),
              ...(['ART_DIRECTION.md', 'UI_UX_SPEC.md'].includes(document) ? [
                sampleEntry,
                ...(access?.resourceTools ? [
                  'Optional image/reference command: ' + assetCommand + ' help. This command exports images to assets/; if used for a design reference, retain a copy under your docs/visual/<document stem>/ directory and link that copy. It does not establish production resources or a completed asset manifest. AI generation is optional.',
                ] : []),
              ] : []),
              'Finish related edits before rechecking. A static check result covers its stated scope and inputRevision, not semantic quality. Reuse unchanged results; inspect the complete issues once instead of repeatedly changing output filters. Changes to sources, dependency availability or check conditions invalidate reuse. Read current files when needed; previous tool logs and your own earlier conclusions are not current authority.',
            ].join('\n\n'), 'utf8')
          }
        }
      } catch (error) {
        await access?.close()
        await Promise.all([...temporaryContextPaths, assetCommandPath, contentHelperPath, acceptanceCheckPath].map(file => unlink(file).catch(() => undefined)))
        throw error
      }
      return {
        ...(directionAuthors ? { directionAuthors } : {}),
        ...(delivery?.status === 'active' ? { projectTurn: {
          restartContext: Boolean(input.autoContinuation && previousTerminal === 'turn.completed' &&
            !repeatMilestone && !delivery.lastValidationFailure),
          ...(reviewDocuments ? { reviewDocuments: [...reviewDocuments], reviewContextPath: path,
            reviewStep: delivery!.designReview!.step, reviewResultPath: resultPath, reviewWorkspace: session.cwd,
            reviewWritableDocuments: delivery!.designReview!.step === 'revise' ? [...reviewDocuments] : [], reviewWritableFiles,
            reviewReceiptContext: { step: delivery!.designReview!.step, findings: delivery!.designReview!.findings,
              sourceHeadings: designReviewSourceHeadings(session.cwd, Object.keys(delivery!.designReview!.snapshots)) } } : {}),
        } } : {}),
        // Small changing facts belong to this turn, not a cached system prompt
        // or a file whose updated contents may never enter the model context.
        turnContext: delivery || access ? [
          'BGS project state (platform context, not additional user instructions):',
          ...(delivery ? ['Current original confirmed requirements: ' + JSON.stringify(delivery.objective)] : []),
          ...(input.initialBrief ? [input.message] : []),
          ...(milestone && !repeatMilestone ? [milestone] : []),
          ...(directionAuthors ? ['BGS schedules the assigned professional writing owners with document-local histories and preloads their writing Skills, then forwards their actual handoffs without another main-model turn. Once all eight saved drafts are complete, the joint independent Review/Revision owns checking and correction. Dispatch and Skill loading establish execution, not semantic quality.'] : []),
          ...(reviewDocuments ? [`BGS directly schedules a fresh bgs-design-review Agent for this joint design step with game-design-check preloaded. It reads this original task path: ${path}, performs the review and records its own conclusion. No coordinator model rewrites the assignment or replaces its result. Actual Skill loading is recorded in its native transcript, not established by a claim or the Skill catalog.`] : []),
          ...(phase === 'author' || phase === 'review' ? ['Document references: bun .beegame/delivery/check-content.mjs --design-references' +
            ` --author-batch ${(delivery?.authorBatch ?? (phase === 'review' ? AUTHOR_BATCHES.length - 1 : 0)) + 1}` +
            '. Broken explicit references are review diagnostics and prevent release to consumers; titles and semantic agreement still require source inspection.'] : []),
          ...(spatialCalculation ? [spatialEntry] : []),
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
          ...(access ? [`Optional capabilities for this turn: ${path}. Previous turns' temporary localhost capability URLs have expired.`] : []),
          ...(access?.previewBaseUrl ? [`Current project Preview test API: ${access.previewBaseUrl}. Previous turns' Preview URLs are expired. This endpoint starts an isolated muted browser and records console/network/screenshot evidence; usage details are in ${path}. Native browser tools remain available.`] : []),
          ...(access?.resourceTools ? [`Current resource library / image-generation entry: ${assetCommand} help. This project-local command uses this turn's endpoints; resource selection remains yours.`] : []),
          ...(contentHelper ? [`Optional content parsing, layout/text-measurement and staged-loading helpers: ${contentHelperPath} (browser-safe ES module; no game engine). inspectUiLayoutInBrowser awaits fonts and checks the authored text and legal textSamples using the shared layout. Candidate versus registered fonts are explicit. Copy it to a project-owned module for retained use; this turn's temporary file is cleaned up at turn end. A math helper is not a renderer or visual-quality proof: verify complete Scene/UI composition, actual fonts and interaction in the target runtime.`] : []),
        ].join('\n') : undefined,
        // Stable even at completion/pause: changing project facts belong to
        // the turn, not the runner configuration or an obligatory file read.
        systemContext: [
          'Keep user-facing progress and final replies concise, in the user’s preferred language. Summarize the outcome, checks and unresolved issues; link to saved project artifacts for detailed reports instead of repeating them in chat. Do not omit failures or verification limits. This is a presentation preference, not a limit on investigation, deliverable detail, or an explicit request for explanation.',
          'Continue this project in the same session. Follow the user request and account for any unfinished delivery objective in the supplied project state. The current milestone is the outcome for this turn; choose your planning, tools and delegation. Delegate outcomes, owned scope and source-backed constraints, not an undecided specialist solution or arbitrary word quota. In a delegated assignment, distinguish confirmed user/source decisions from coordinator suggestions; investigate an unsupported constraint rather than silently treating it as an upstream agreement.',
          'Within the current authorized task, the main Agent also owns production priorities: distinguish required outcomes, optional polish and consequential uncertainties; prioritize the player promise and real dependencies under stated time/cost constraints. Repeated failures require reassessing the cause before expanding mechanisms or experiments. Do not remove a required treatment as a cost shortcut, expand scope/cost without user agreement, or keep polishing after the requested outcome is met. Use existing decisions and task records rather than another management framework.',
          'Work from the current task and relevant source clauses, not every available contract. Finish related edits before rechecking; reuse deterministic static results only while their relevant inputs and check conditions remain unchanged, unless the user requests a fresh check. Inspect complete diagnostics once instead of repeated filtered reruns. Dependency arrival or source changes invalidate previous checks. Runtime observations still require their actual environment and current-version evidence; file stability alone is not runtime verification. Project files retain decisions; old tool logs and prior conclusions are not current authority.',
          'Across all project work, verify that a cited authority exists, contains the relevant decision and owns that subject. Identify it by actual file path and section, not an unresolvable title. Explicit user requirements and actual platform constraints apply across disciplines; distinguish them from author-chosen decisions. GDD owns the player promise, release scope and core gameplay contract, not every professional choice. Being written first or appearing in GDD does not promote a non-owner proposal into a confirmed constraint. During author/review, resolve such choices in their responsible existing document and reconcile affected references through integration; preserve reviewed baselines in later milestones. Guidance, examples and tool names do not establish project decisions or promised deliverables. Do not invent another authority artifact; reconcile an absent and unplanned owner in the existing responsible document before handoff.',
          'Delegate or defer required work only to an identified responsible role or task within the agreed workflow, with a concrete expected output and the point where it is needed. An assigned future dependency is still unresolved until delivered and checked; an unassigned promise is not a handoff. Include these dependency boundaries in subagent assignments. Resolve gaps within your responsibility or report their impact and the needed decision; continue independent work where possible, but do not claim affected work complete. Distinguish required decisions from optional work and hypotheses awaiting runtime verification.',
          'When a decision changes, the current integration/revision role reconciles its authoritative source and affected consumers, including superseded statements and open items, within the authorized editing scope. Do not send handed-off work back to its writing Agent for revision. Otherwise report the inconsistency rather than editing protected sources. Check the resulting files and combined outputs before handoff: reading a dependency, making a local edit or receiving an owner summary does not establish closure. Use existing artifacts and task records; no extra review stage is required. Preserve the delivered version and known limits as the baseline. For an authorized change, check the changed decision and affected consumers, not automatically all eight documents; a design defect that requires a new owner decision is not implementation freedom.',
          'During initial delivery, writing Agents own initial planning drafts and basic delivery correctness, not a formal semantic self-check. Dependent writing reads previously saved drafts; those drafts have not yet passed independent review. After all five writing batches complete the eight documents, one joint independent inspection owns semantic checking, followed by at most one grouped revision and targeted verification when correction is needed. The main Agent coordinates handoff, not a duplicate review or document revision. Review is not formal Content production. Necessary decisions belong in their responsible documents; an unresolved dependency is not completed work. Completing the scheduled technical baseline is initial authoring. Content later translates reviewed documents and resources into formal Scene/UI/VFX data. After joint review, the eight design documents are the downstream baseline: absent an explicit user-requested design change, report design defects rather than editing them in resources, content, implementation or acceptance.',
          `Project workspace: ${session.cwd}. When prior task context is missing, read ${path}: it contains the original request and current project state. Do not infer a new task from an empty native history.`,
          'Investigate and verify the affected behavior. For an explicit user-requested design change, revise the affected document baseline before implementing that change; choose the implementation methods, task breakdown and delegation yourself. A defect fix that restores the existing design does not require rewriting the documents.',
          'Project files are editable within the user-authorized scope. BGS platform defects should be reported, not worked around by changing valid game data.',
        ].join('\n'),
        close: async () => {
          try { await access?.close() }
          finally {
            await unlink(resultPath).catch(() => undefined)
            await Promise.all([...temporaryContextPaths, assetCommandPath, contentHelperPath, acceptanceCheckPath].map(file => unlink(file).catch(() => undefined)))
          }
        },
      }
    },
    onTurnSettled: async () => {
      const terminal = input.sessions.transcript(input.sessionId).findLast(event =>
        acceptedTurnId !== undefined && event.turnId === acceptedTurnId &&
        (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.empty'))
      if (terminal?.type === 'turn.completed' && turnStartedAt && input.deliveryDataRoot) {
        const delivery = await readProjectDelivery(session.cwd, input.deliveryDataRoot)
        const conclusion = resultPhase ? await readMilestoneResult(resultPath, resultPhase) : undefined
        const phase = delivery && projectDeliveryPhase(delivery)
        // Bind the saved result and writable scope to this prepared turn. An
        // owner action or another turn cannot let an old result stamp new state.
        const staleTurn = preparedDelivery?.status === 'active' && JSON.stringify(delivery) !== JSON.stringify(preparedDelivery)
        if (!staleTurn && delivery && ['acceptance', 'complete'].includes(projectDeliveryPhase(delivery)))
          await captureProjectDeliveryAcceptance(session.cwd, input.deliveryDataRoot, turnStartedAt)
        // A reviewer may stop at its effort ceiling without a conclusion. An
        // explicit user turn is not permission to relaunch that review silently.
        if (staleTurn && phase) progress = { phase, shouldContinue: false,
          issues: ['Delivery changed during this turn; its result cannot finalize or advance the new state.'] }
        else if (delivery?.status === 'active' && !input.initialBrief && !input.autoContinuation && !recoveringInterruptedTurn && !conclusion && resultPhase !== 'author' && resultPhase !== 'review') {
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
