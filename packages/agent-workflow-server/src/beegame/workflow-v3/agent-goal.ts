import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { readSessionTranscriptFromDisk, type BeeGameAttachment, type BeeGameSessionManager, type StartBeeGameSessionInput } from '../session-manager'
import { pauseRun, digest, isInitialSliceTurn, WorkflowError, type Run, type AgentTurn, type AgentMessage } from './state'
import { sameJson, type WorkflowStore } from './store'
import { skillEvidence } from './context'
import { openAgentTools, type AgentPreviewAccess, type AgentImageAccess } from './agent-tools'
import { createAgentMeasurement, AGENT_CONSUMPTION_CHECKS } from './agent-measurement'
import { blockingRegisteredContentChecks, inspectAgentMeasurementInputs } from './measured-build'
import { readProjectGuide, projectGuideContext } from './project-guide'
import { saveHostExitReceipt, type HostExitReceipts, type HostExitFacts } from './host-exit-receipt'
import { installWebStarter } from './web-project-start'

type AgentExecutionOptions = Partial<StartBeeGameSessionInput> & {
  attachments?: BeeGameAttachment[]
  openPreview?: () => AgentPreviewAccess | Promise<AgentPreviewAccess>
  openImage?: () => AgentImageAccess | Promise<AgentImageAccess>
}

// Preserve actual intake. No user-written milestones, Task or check schemas.
const language=z.enum(['en','zh','zh-TW','ja','ko','fr','de','es','it','pt'])
export const agentGoalSchema = z.object({
  requestKey: z.string().trim().min(1), chatSessionId: z.string().min(1),
  brief: z.object({ kind:z.literal('confirmed_build_brief'), idea: z.string().trim().min(1),
    selected_option: z.record(z.string(), z.unknown()), settings: z.record(z.string(), z.unknown()),
    document_language:language, game_user_visible_language:language,
    agent_response_language:language, resource_library_usage:z.enum(['optional','preferred','required']),
  }).passthrough(),
}).strict()
export const agentMessageSchema = z.object({
  requestKey:z.string().trim().min(1),runId:z.string().min(1),chatSessionId:z.string().min(1),
  expectedVersion:z.number().int().positive(),requirementsRevision:z.string().min(1),
  intent:z.enum(['message','discuss','work','change','continue']).default('message'),text:z.string().trim(),
  attachments:z.array(z.unknown()).max(8).optional(),
  continuationOf:z.string().min(1).optional(),
  contextMode:z.enum(['resume','focused']).optional(),
}).strict().refine(value=>Boolean(value.text || value.attachments?.length),
  {message:'A message needs text or an attachment'}).refine(value=>value.intent==='continue' ? Boolean(value.continuationOf) : value.continuationOf===undefined,
  {message:'Only explicit continuation requires continuationOf'}).refine(value=>value.contextMode!=='focused'||['work','change','continue'].includes(value.intent),
  {message:'Focused execution requires work, change or continuation, not discussion'})

// One responsibility definition for native production and follow-ups, not a
// second plan or a host document gate. Skills supply methods, not ownership.
const professionalContextParagraphs = [
  'Professional coverage: gameplay, technology, art, audio, UI/UX, levels/scenes, numbers/balance and resources. New design records belong together under docs/: GDD.md, TECHNICAL_DESIGN.md, ART_DIRECTION.md, AUDIO_DESIGN.md, UI_UX_SPEC.md, LEVEL_SCENE_DESIGN.md, BALANCE_DESIGN.md and ASSET_PLAN.md. Domain labels are not directories. These are default design records, not stages or eight separate assignments. Simple projects may use explicitly mapped merged records only when each affected domain has concrete decisions; headings alone are not coverage. Preserve existing paths/references on continuation; do not migrate unrelated work. No economy or external images does not remove numerical or resource planning.',
  'Decide order and delegation from actual dependencies; do not turn the eight records into sequential assignments. Before making design decisions or drafting each affected domain, invoke its relevant available professional Skills through the native Skill tool. When delegating design work, explicitly include this Skill-use requirement in the author assignment. Reuse methods already loaded in that working context; do not load the whole catalog or reload for every edit. Report unavailable methods honestly; a catalog listing is not invocation. Before implementing or producing resources for the current slice, save its concrete decisions, reasons and source paths in the existing design records under docs/ or their established mapped paths: controls, core loop, progression/failure rules, initial values affecting the interaction, required screens/states/actions, and resource representation (single image, separate parts or animation frames). A concise merged record is sufficient; mark unresolved assumptions for validation. Only the current affected decisions are needed, not completion of all eight records; a todo list or chat declaration is not a saved design record. Then, before multiplying similar scenes, screens or assets, observe one representative playable and visible interaction using the lowest-cost representation adequate for that validation. Use the observations to update only affected decisions and determine subsequent resource production. Keep a single source for runtime values/bindings; update only changed records and affected checks.',
  'For a visual game, resource production follows the recorded decisions and representative interaction above; do not produce a complete asset set first and document the design afterward. A small visual experiment or a few real assets may precede that interaction when needed to answer a specific visual or resource-feasibility question; record that purpose and limit production to what the experiment needs. Such an experiment does not replace gameplay validation or authorize bulk production. Temporary representations are for validation, not substitutes for required final artwork. Use reference boards when they resolve an actual layout/style question, not as a blanket prerequisite for the playable slice. Derive the needed screen/state and scene/prop inventory for that slice before estimating image requests. Do not assign an image count from the number of objects or reserve separate requests per resource. When references are needed, save and inspect complete-screen UI references as assets/visual/ui-board.png and any distinct scene/prop references as assets/visual/scene-board.png. The UI reference must show complete screen layouts and key states with readable hierarchy, spacing and style; isolated button or icon studies alone do not establish a UI layout. Use the structured uiReference input of assets.mjs generate for UI reference boards, not a free-form board prompt. Read the project UI specification and confirmed Landscape or Portrait setting: supply its project reference viewport width and height, shared style, and an explicit list of the screens and distinct layout states in the current slice with its HUD over gameplay. Derive the panel count from that list; do not invent a start menu or extra screens, or infer aspect ratio from orientation alone. Run assets.mjs ui-board-plan to inspect the computed equal-cell grid, panel rectangles and selected canvas size before quoting and submitting the same structured request. The system chooses rows and columns from the viewport ratio and actual list length; do not add hero panels, merged cells, scene studies or a controls strip to the UI board. The outer AI image size need not match the internal screen ratio. For each distinct scene type and representative prop, use separate scene references when needed. An existing assets/visual/design-board.png counts as UI evidence only after its actual screen coverage, grid and proportions have been inspected. If panels are too small to read, divide the actual inventory into explicit subsets and recompute each board before estimating requests; do not shrink or drop screens silently. Inspect the generated image against the computed rectangles and UI specification: file/schema success does not prove coverage, ratio or readability. A material mismatch remains unresolved; do not accept it merely as style guidance or automatically pay for another attempt. Map each panel to the owning design record; if the pictures reveal a conflict, revise only affected records. Choose a reference source only when it resolves the scoped question; AI is optional, not the default. If AI is suitable, declare purpose: reference or experiment and obtain a read-only quote for the actual low-quality variant, respecting user exclusions and the configured project image budget. The confirmed build already authorizes image charges disclosed at build start; do not ask for redundant per-image or visual-direction approval. If a necessary image cannot be sourced within the authorized budget and choices, disclose that specific blocker; an unavailable AI bridge alone does not rule out suitable existing references. Inspect the board or boards, resolve material conflicts, and continue only within the current assignment scope. For AI-produced bitmap UI elements, use the inspected UI design board only as appearance guidance via referenceImagePath and request a separate shared PNG sheet with background: transparent when the elements fit legibly. Ask for isolated, unrotated, nonoverlapping elements in a regular grid with transparent gutters; the elements themselves retain their intended opacity. Inspect actual alpha and bounds rather than assuming the model separated them precisely. Keep dynamic text, values, progress fills and hit areas in runtime UI. Give the delivered runtime atlas exact named frames: register measured rectangles if the sheet is clean, or crop and use the existing fixed-order shelf packer with no rotation or trim and edge-copy padding for linear filtering. Registration alone is not packing, and the model does not supply frame coordinates. A board is appearance guidance, not gameplay authority, exact UI coordinates or production atlas; do not claim the user approved its aesthetic quality.',
  'For each needed runtime resource, record its purpose, state, layer and style in the resource plan; choose a suitable source per item, not a mandatory source-by-source tour. Honor explicit user source choices. Distinguish static decoration, independently moving parts, models/rigs/clips, material/texture dependencies, effects and sound only where the design requires them. Trace their state/space/timing relationships to the existing Manifest requirement IDs and Scene nodes/components or the native-engine/procedural implementation; do not add a second assembly document, require every object to animate, or turn procedural behavior into fake file assets. For AI bitmap production declare purpose: production and existing requirementIds for the actual bitmap parts; a reference or one PNG does not complete an interactive object. Registered files and metadata are not runtime evidence. XR uses applicable 3D resources plus device/space/input observations; absent device evidence stays unverified. For common sounds, icons and environment assets, first consider suitable supplied or built-in licensed resources. For continuous character motion, prefer an existing complete animation when suitable; one generated sheet does not guarantee distinct poses or temporal continuity. Consider AI generation for distinctive artwork when existing candidates do not fit, not as the default for all core art. Use focused web sourcing for a concrete gap and use web resources only after verifying usage rights and download/format feasibility; stop when a suitable candidate is found. Browse relevant library facets and inspect a small sample, not the whole catalog. Empty usageTags means unclassified, not unavailable; access errors are not no-match, and no-match is not proof the library has no files. Record actual candidate/download evidence and the concrete reason for a consequential rejection in the existing resource plan; do not invent a sourcing history or add a procurement report. Simple buttons and geometric effects may be procedural, but a button role does not justify replacing its distinctive artwork with generic CSS. In the existing UI specification and resource plan, trace the main UI visual families (controls, panels, decoration and icons as applicable) from the selected design to bitmap or procedural representation and their actual UI nodes. For bitmaps, record the production resource and named frame and include the need in the existing Manifest requirements; for procedural work, record the renderer path and why it preserves the intended appearance. Do this before estimating production requests; after reference inspection, update only affected records and budget. Do not create a second inventory document or require a separate UI atlas file. Procedurally replacing required core artwork remains a fallback requiring a concrete blocker and user authorization; an explicitly chosen procedural aesthetic is different. A total spending cap does not mean zero image charges; account for model work as well as image quotes. For AI sprite animation, use game-technical-artist and its ai-sprite-animation reference with the existing generation, media/atlas and Preview tools. For compatible small bitmap UI and scene elements, plan a shared transparent sheet request and exact atlas frames; split image generation only for a concrete legibility, scale, transparency or independent-editing need. An atlas assembled after many separate generations does not save generation cost. Estimate requests after the scoped resource plan and any needed reference inspection, then quote the actual low-quality variants before generation. Make and inspect each slice of production resources before finalizing its UI/Scene JSON; record source files and rights, or the renderer path for procedural work, without fake assetRefs. Verify actual files and applicable Scene/UI bindings, then observe each required resource in its reachable game state; unobserved use stays unverified. A feasibility sketch is not delivered content, and a temporary stop from a prior turn is not a permanent asset prohibition. Static cover art may be reused only when its crop and baked-in objects suit that screen; moving world elements need separate sources. When bitmap UI elements are chosen, keep them independently addressable and inspect transparency/state variants; use the existing deterministic atlas packer only when the chosen runtime benefits. When a visual reference exists, compare actual screenshots of required screens and representative scenes with it, reporting material differences and unverified aesthetic judgment; image generation, schema and build success alone are not quality.',
  'For visual games, finalize editable Scene/UI JSON after the needed production visuals for that slice are ready. New BGS Web games deliver editable content/scenes/*.json and content/ui/*.json with the existing content/index.json registry unless the user explicitly excludes BGS visual editing. React/Canvas does not waive this delivery; the actual runtime must consume the saved data, including relevant visual nodes and asset bindings, not just settings or a second hardcoded layout. Bind image/sprite nodes through their assetRef and frame locators, and button artwork through existing data.image references while preserving text, actions and state bindings. Reuse the current atlas, registration and content-binding tools; registration is not runtime use. Use existing schema/layout tools and verify saved-data changes in the real build. Read the existing measurement report node-level UI binding coverage: a missing binding is neither automatic failure nor proof of intentional procedural rendering, and layout evidence does not verify image/frame use. Compare required actual screens with the design reference; structural success cannot establish visual restoration, including elements omitted from JSON. Unity/Godot use native scene/UI data, not duplicate Web JSON. Do not silently convert an existing source-only project; disclose the delivery gap and obtain migration authorization.',
  'Separate editable project sources from static publication output. In the existing build script, select bundler-generated HTML/JS/CSS, content/index.json and its registered documents, AssetManifest and its modules, every registered resource file_paths entry and dependency local_path, required licenses, and any other explicitly needed runtime static files. Do not prune registered resources merely because current Scene/UI references omit them: dynamic and on-demand resources must remain available. Keep production originals, crop intermediates, reference boards and prompts in the editable project, but out of the static build unless actually needed at runtime. Do not copy the entire assets directory by default or exclude a file solely because it is under assets/source or assets/visual. Reuse the existing registries and build script, not a second publication manifest or packaging framework. Inspect packageComposition in the existing measurement report: it covers all built files, raw byte totals, exact duplicates and possible production-material carryover. These are advisory facts, not deletion authority or proof that every extra file is unused; null or unverified means evidence is unavailable. Resolve confirmed accidental inclusion in the build file selection and remeasure affected output; do not auto-delete source files.',
  'Trace original requirements to design and the actual runtime: playable rules/challenge, visual direction/readability, UI and action/state feedback, audio behavior, level flow, numerical pacing and resource use. Check deterministic facts with tools and experience with actual observations. Build success, eight files or reviewer PASS cannot prove quality; missing viewing/listening/play evidence stays unverified. Review real dependencies, fix material findings, and recheck affected results; optional polish does not automatically reopen work. Handoff source/evidence paths, tested version and limitations, not repeated documents.',
  'When the project requires pause on focus loss, cover the opening countdown as well as active play: losing focus must stop countdown progress and prevent delayed callbacks from starting gameplay while unfocused. Follow the project requirements for recovery; restoring focus must not hide an earlier background start. Use the supplied preview.mjs --countdown-blur-sample with actual CSS indicators and source-derived full countdown duration to retain observations before focus is restored. Sampling completion is not pause/resume acceptance: inspect the evidence against the requirement; missing or ambiguous evidence remains unverified. This visible iframe-blur sample does not cover hidden-tab behavior, and Preview must not pause the game on its behalf.',
  'Use scoped source/test batches rather than recursive project/history searches or repeated tiny handoff edits; the current tools expose batch source snapshots and exact saved Scene points. Choose focused delegation when it avoids carrying unrelated history; BGS does not reset the conversation or choose your agents. Finish all report-writing verification and affected revisions before final measurement. Rerunnable tests must save new runs separately from retained evidence; do not overwrite a measured report to verify it. Measurement itself builds the source copy; a separate build immediately before it is needed only for a distinct check, not to read a receipt.',
]
export const agentProfessionalContext = professionalContextParagraphs.join('\n')
const existingRunProfessionalContext = professionalContextParagraphs.filter((_, index) => index !== 2).join('\n')
export const agentProfessionalContextForRun = (run: Pick<Run, 'visualHandoffVersion'>) =>
  run.visualHandoffVersion===1 ? agentProfessionalContext : existingRunProfessionalContext

export function agentMessagePrompt(message: AgentMessage, edits: NonNullable<Run['sourceEdits']> = []): string {
  const context = message.intent==='discuss' ?
    'Discuss the user’s question in this existing project. This message does not authorize changes or execution; answer only. Ask for authorization if changes are needed.' :
    message.intent==='message' ?
      'This is the user’s direct message in the existing project. Interpret its actual wording: answer questions without changing files; carry out clearly requested work or requirement changes within that wording; ask before taking a material action the user did not authorize or when the request is ambiguous. Preserve unrelated work. Do not treat this routing label as permission to modify the project.' :
    message.intent==='work' ?
      'The user authorizes work on the existing confirmed goal, not a requirement change or restart. Preserve the confirmed choices. Reuse applicable evidence and revise/retest actual affected results; ask before changing the goal or scope.' :
    message.intent==='change' ?
      'This is an explicitly authorized requirement change in the existing project, not a restart of the original goal. Read current affected sources, update their actual authority and consumers, preserve unrelated work, and rebuild/retest changed results. Earlier checks do not accept the changed version. Latest explicit user changes supersede conflicting original choices; ask when a material choice is missing.' :
      'The user explicitly authorizes continuing the interrupted work below in this same project. Inspect saved partial results and actual external outcomes first. Do not blindly replay commands or unknown paid operations, resend the original goal, or redo unrelated work. Recheck affected results; partial work and old checks are not acceptance.'
  return [context, ...(edits.length ? ['User-authorized source saves since the preceding native turn (not acceptance; inspect current files):\n'+
    JSON.stringify([...new Map(edits.map(e=>[e.sourceEdit.path,{path:e.sourceEdit.path,status:e.sourceEdit.status}])).values()])] : []),
    'User message:\n'+message.text].join('\n\n')
}
function agentGoalDisplayText(run: Run): string {
  try {
    const brief: unknown = JSON.parse(run.requirements.text)
    if (brief && typeof brief === 'object' && !Array.isArray(brief) &&
      'kind' in brief && brief.kind === 'confirmed_build_brief' &&
      'idea' in brief && typeof brief.idea === 'string' && brief.idea.trim()) return brief.idea.trim()
  } catch {
    // Older runs can store a plain-text goal instead of a confirmed brief.
  }
  return run.requirements.text
}

export function agentGoalPrompt(run: Run): string {
  if (run.creation?.initialDelivery === 'playable-slice') return [
    'This first assignment delivers one representative playable and visible slice for user playtesting, not the full game. Keep the complete confirmed goal below unchanged for subsequent work.',
    'Implement and run the smallest interaction that exposes the core controls, feedback, challenge and necessary HUD. Save only the decisions needed for it. Show the actual preview and observations, identify unresolved experience questions, then end this turn for user feedback. Do not expand the full content set in this assignment or claim game acceptance.',
    ...(run.creation.webStarter ? ['The host supplied a generic React/Canvas connection scaffold: content/ is consumed by src/main.jsx, src/game.js owns simulation and UI state/actions. It is not gameplay or an approved art style. Extend the connected sources; do not replace saved Scene/UI data with a second hardcoded layout.'] : []),
    'Confirmed full goal (scope retained, not all due in this first assignment):\n'+run.requirements.text,
  ].join('\n\n')
  return [
    'Develop the game from this complete confirmed goal in the current project. Plan and execute autonomously; do not wait for BGS milestones or a host Task plan.',
    ...(run.visualHandoffVersion===1 ? ['For a visual game, first save the current slice decisions in the existing design records as specified in the professional context; this does not require completing all eight documents. Validate a representative playable interaction using the lowest-cost adequate representation, then use observations to determine subsequent resource production. Small visual experiments or necessary real assets may come earlier only for a recorded, scoped validation need, not to complete the asset set before design or gameplay validation. Use complete-screen UI layout references and distinct scene/prop references when they resolve an actual layout/style question, not as a blanket prerequisite for starting the slice. Use structured uiReference inputs and ui-board-plan so project screen proportions and the selected screen/state list determine the equal-cell grid. Then continue through implementation and actual runtime checks in this same assignment. Do not precommit an image count, stop at visual-direction handoff or request a second production authorization.'] : []),
    'Preserve explicit user choices. Ask the user when a material choice or authorization is missing. Do not claim unperformed checks or game acceptance.',
    'Confirmed goal:\n'+run.requirements.text,
  ].join('\n\n')
}

/** Literal saved inputs, not an LLM summary or replay of prior operations.
 * Assistant-only assumptions are deliberately not claimed as retained. */
export function focusedExecutionFacts(run: Run, events: Awaited<ReturnType<typeof readSessionTranscriptFromDisk>>) {
  const questions=new Map(events.filter(e=>e.type==='permission.requested' && e.payload?.toolName==='AskUserQuestion')
    .map(e=>[e.payload?.toolUseID,e.payload?.input as {questions?:unknown}|undefined]))
  const answeredQuestions=events.filter(e=>e.type==='permission.resolved' && e.payload?.toolName==='AskUserQuestion')
    .flatMap(e=>{
      const value=e.payload?.input as {questions?: unknown;answers?: unknown}|undefined
      return [{eventId:e.id,turnId:e.turnId,status:e.payload?.decision,
        questions:value?.questions??questions.get(e.payload?.toolUseID)?.questions,
        ...(e.payload?.decision==='allow'&&value?.answers?{answers:value.answers}:{})}]
    })
  const workflowTurnIds=new Set(run.agentTurns!.map(t=>t.turnId).filter(Boolean))
  const otherUserMessages=events.filter(e=>e.type==='user.message' && !workflowTurnIds.has(e.turnId) &&
    (typeof e.payload?.displayText==='string' || !e.payload?.displayKind)).map(e=>({eventId:e.id,turnId:e.turnId,
      text:typeof e.payload?.displayText==='string'?e.payload.displayText:e.text}))
  const previous=run.agentTurns!.at(-2)
  const unconfirmedTools=new Map<string,{toolUseID:string;toolName:string;eventId:number;status:'no-terminal-event'|'failed'}>()
  for(const event of events) {
    if(!previous?.turnId || event.turnId!==previous.turnId)continue
    const id=event.payload?.toolUseID
    if(typeof id!=='string')continue
    if(event.type==='tool.started' && typeof event.payload?.toolName==='string')
      unconfirmedTools.set(id,{toolUseID:id,toolName:event.payload.toolName,eventId:event.id,status:'no-terminal-event'})
    else if(event.type==='tool.completed')unconfirmedTools.delete(id)
    else if(event.type==='tool.failed' && unconfirmedTools.has(id))
      Object.assign(unconfirmedTools.get(id)!,{eventId:event.id,status:'failed'})
  }
  return {mode:'focused',source:'saved-user-inputs-and-current-requirements',
    ...(run.agentTurns?.at(-1) && isInitialSliceTurn(run,run.agentTurns.at(-1)!)
      ? {initialAssignment:agentGoalPrompt(run)} : {}),
    requirements:run.requirements,
    priorUserRequests:run.agentTurns!.slice(0,-1).flatMap(t=>t.message?[{requestKey:t.requestKey,intent:t.message.intent,text:t.message.text}]:[]),
    otherUserMessages,
    answeredQuestions,
    previousExecution:previous?{attemptId:previous.attemptId,requestKey:previous.requestKey,turnId:previous.turnId,
      nativeSessionId:previous.nativeSessionId,status:previous.status,error:previous.error,notStarted:previous.notStarted,
      finishedAt:previous.finishedAt,quiescedAt:previous.quiescedAt,
      measurements:previous.measurements?.map(m=>({id:m.id,requestKey:m.requestKey,startedAt:m.startedAt,finishedAt:m.finishedAt,error:m.error})),
      unconfirmedTools:[...unconfirmedTools.values()],externalOutcomes:'not-inferred'}:null,
    omitted:'Prior native assistant/tool/thinking history and session permissions; no generated summary or automatic replay. Assistant-only implicit choices and previously loaded Skill bodies are not transferred.'}
}

/** Final host receipt is computed after owned work stops. No model summary,
 * report rewrite or retry; semantic quality is still not certified. */
export async function agentTurnHandoffReason(run: Run, turn: AgentTurn) {
  // A follow-up need not build again merely to carry forward an unchanged
  // receipt. Inspect the newest actual record, including failed/pending ones.
  const record=run.agentTurns?.flatMap(t=>t.measurements??[]).at(-1)
  if(!record)return 'Native goal turn ended; game delivery and target-runtime evidence remain unverified.'
  try {
    const freshness=await inspectAgentMeasurementInputs(run,record)
    const invalid=blockingRegisteredContentChecks(record)
    return freshness.current && invalid.length ? 'Native goal turn ended; registered Scene/UI checks need repair before delivery: '+
      invalid.map(check=>check.id+' '+check.status).join(', ')+'. Inspect saved measurement findings; game-quality acceptance remains unverified.' :
      freshness.current ? 'Native goal turn ended; measured inputs are current. Game-quality acceptance remains unverified.' :
      'Native goal turn ended; '+freshness.code+': '+freshness.reason
  } catch(error) {
    return 'Native goal turn ended; measurement freshness could not be verified'+
      (error instanceof WorkflowError ? ': '+error.message : '. Inspect current project inputs; no automatic retry.')
  }
}

/** Native owns planning/tools/delegation; existing CAS store owns the writer.
 * No automatic model retries or stage advancement. */
export function createAgentGoalExecutor(input: { store: WorkflowStore; sessions: BeeGameSessionManager; resourceLibraryBaseUrl?: string; exitReceipts?: HostExitReceipts }) {
  const workerId = randomUUID(), active = new Map<string,{sessionId:string;runId:string;turnId?:string}>(), pending = new Set<Promise<void>>()
  // Live original-host observations; never loaded from project files,
  // user claims or process liveness. Lost on host restart intentionally.
  const observedExits=new Map<string,{runId:string;facts:Partial<AgentTurn>}>()
  let disposing = false
  const read = async (run: Run) => {
    const current = await input.store.read(run.projectId, run.ownerId)
    if (!current || current.id !== run.id) throw new WorkflowError('run-changed', 'Run binding changed')
    return current
  }
  const sameWriter = (run: Run, turn: AgentTurn) => run.writer?.attemptId === turn.attemptId &&
    run.writer.fence === turn.fence && run.writer.workerId === turn.workerId
  async function settle(run: Run, turn: AgentTurn, failed?: string, interrupted = false) {
    // Retry pure CAS settlement only, never model/tool execution.
    for (let i=0;i<2;i++) {
      const current = await read(run)
      if (!sameWriter(current, turn)) throw new WorkflowError('stale-attempt', 'Native goal writer changed')
      const saved = current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      if (!saved.quiescedAt) throw new WorkflowError('writer-unresolved', 'Native exit is not confirmed')
      const next = structuredClone(current), result = next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      result.status = interrupted || current.paused ? 'interrupted' : failed ? 'failed' : 'ended'
      result.finishedAt = new Date().toISOString()
      if (failed) result.error = failed
      delete next.writer; next.version++; next.status = 'blocked'
      next.blockedReason = current.paused ? 'User paused; no automatic retry.' :
        failed ?? ((isInitialSliceTurn(current,result)
          ? 'Initial playable-slice turn ended; inspect the actual preview and give feedback before expanding content. This is not full-game completion. ' : '') +
          await agentTurnHandoffReason(current,saved))
      try {
        await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.turn-settled')
        observedExits.delete(turn.attemptId)
        const measured = next.agentTurns!.flatMap(value => value.measurements ?? []).at(-1)
        input.sessions.recordHostEvidence(run.chatSessionId, {attemptId:turn.attemptId,turnId:result.turnId,
          execution:result.status,measurementId:measured?.id,checkStatuses:measured?.checks.map(({id,status})=>({id,status})) ?? [],
          unmeasured:['build','runtime-smoke',...AGENT_CONSUMPTION_CHECKS].filter(id=>!measured?.checks.some(check=>check.id===id)),
          note:next.blockedReason})
        return next
      }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
    throw new WorkflowError('revision-conflict','Native goal settlement changed concurrently')
  }
  async function execute(run: Run, turn: AgentTurn, options: AgentExecutionOptions) {
    let failed: string | undefined, turnId: string | undefined
    let tools: Awaited<ReturnType<typeof openAgentTools>> | undefined
    let preview: AgentPreviewAccess | undefined
    let image: AgentImageAccess | undefined
    let executionContext: Record<string, unknown> | undefined
    const measurement = createAgentMeasurement({run,turn,store:input.store,executionContext:()=>executionContext,
      skillUses:()=>turnId ? skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)) : []})
    try {
      if (disposing || (await read(run)).paused) throw new Error('Worker stopped or user paused before dispatch')
      const previous=run.agentTurns!.filter(t=>t.attemptId!==turn.attemptId).at(-1)
      if (!turn.message) await installWebStarter(run)
      const focused=turn.message?.contextMode==='focused'
      if(focused)executionContext=focusedExecutionFacts(run,await readSessionTranscriptFromDisk(run.chatSessionId,run.workspacePath))
      if(turn.message && input.sessions.get(turn.sessionId)?.status==='running') {
        // A restored idle Chat may lack its runtime snapshot. start() otherwise
        // reuses it and ignores resumeNativeSessionId, silently losing history.
        input.sessions.stop(turn.sessionId,'agent_message_resume')
        await input.sessions.waitForSessionIdle(turn.sessionId)
      }
      const session = input.sessions.start({ workspacePath:run.workspacePath, projectId:run.projectId, userId:run.ownerId,
        transcriptSessionId:run.chatSessionId, modelConfigId:options.modelConfigId, language:options.language,
        userDataRoot:options.userDataRoot,
        ...(focused ? {freshNativeContext:true} : turn.message && previous?.nativeSessionId ? {resumeNativeSessionId:previous.nativeSessionId}:{}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken })
      if (session.id!==run.chatSessionId) throw new Error('Native goal must use the bound project conversation')
      await input.sessions.sendWithDisplay(session.id, turn.message ? agentMessagePrompt(turn.message,
        run.sourceEdits?.filter(e=>e.fence>(run.agentTurns?.at(-2)?.fence??0))) : agentGoalPrompt(run), {
        displayKind:turn.message ? 'workflow_v3_'+turn.message.intent : 'workflow_v3_goal',
        displayText:turn.message?.text ?? agentGoalDisplayText(run),
        attachments:options.attachments,
        clientMessageId:turn.message?.requestKey,
        confirmedBriefContext:run.requirements.text,
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken, language:options.language,
        onTurnAccepted:id=>{
          turnId=id
          const local=active.get(turn.attemptId)
          if(local?.runId===run.id)local.turnId=id
        },
        // Stable responsibilities belong to the existing system-context slot,
        // not another full copy in each resumed user message/history entry.
        // Navigation is a single current file snapshot in the system slot,
        // including discussion; production requirements/tools stay separate.
        prepareTurn:async ()=>{
          const guide=projectGuideContext(await readProjectGuide(run.workspacePath))
          // A committed change whose native submission never started is not
          // in resumed model history. Carry its literal user data under this
          // new authorization; metadata-only confirmedBriefContext is not a
          // model message, and replaying the old request would be incorrect.
          const preceding=run.agentTurns!.slice(0,-1),lastSubmitted=preceding.findLastIndex(t=>!t.notStarted)
          const pendingChanges=preceding.slice(lastSubmitted+1).filter(t=>t.notStarted===true &&
            (t.message?.intent==='change' || t.message?.intent==='message'))
            .map(t=>({requestKey:t.requestKey,intent:t.message!.intent,text:t.message!.text}))
          const confirmedChanges=pendingChanges.length?'\nConfirmed user data not previously submitted to native: '+JSON.stringify({
            requirementsRevision:run.requirements.revision,
            authorized_user_changes:pendingChanges.filter(item=>item.intent==='change').map(({requestKey,text})=>({requestKey,text})),
            user_messages:pendingChanges.filter(item=>item.intent==='message').map(({requestKey,text})=>({requestKey,text})),
          }):''
          if(turn.message?.intent==='discuss')return {systemContext:guide,...(confirmedChanges?{turnContext:confirmedChanges}: {})}
          tools=await openAgentTools({ workspacePath:run.workspacePath, constraints:run.requirements.constraints,
            sessionId:session.id,openPreview:options.openPreview ? async ()=>preview=await options.openPreview!() : undefined,
            libraryBaseUrl:input.resourceLibraryBaseUrl,
            readInitialCatalog:!turn.message,
            getAuthToken:()=>options.getValidAuthToken?.() ?? options.authToken, measurement,
            openImage:options.openImage ? async ()=>image=await options.openImage!() : undefined })
          // Supply current host facts with the task, not solely through a
          // discovery command that the model may filter or never call. This
          // reads inputs once; it does not build, review or rewrite history.
          const evidence=await measurement.context()
          return {...tools,turnContext:tools.turnContext+confirmedChanges+'\nBGS saved evidence (not game acceptance): '+JSON.stringify(evidence),
            systemContext:agentProfessionalContextForRun(run)+'\n\n'+guide+'\n\n'+tools.systemContext}
        },
      })
      await input.sessions.waitForSessionIdle(session.id)
      const events=input.sessions.transcript(session.id).filter(e=>e.turnId===turnId)
      const failure=events.findLast(e=>e.type==='turn.failed')
      if(failure) throw new Error(failure.text || 'Native goal turn failed; partial candidates are not accepted')
      if (!turnId || !events.some(e=>e.type==='turn.completed') || events.some(e=>e.type==='turn.failed'))
        throw new Error('Native goal turn did not complete; partial candidates are not accepted')
      if (input.sessions.runtimeSnapshot(session.id).activeSubagentToolUseIds.length)
        throw new Error('Native background work is unfinished')
    } catch (error) { failed=error instanceof Error?error.message:'Native goal execution failed' }
    finally {
      // Preserve conversation history; confirm process cleanup before unlock.
      if (input.sessions.get(turn.sessionId)?.status==='running')
        input.sessions.stop(turn.sessionId, 'agent_goal_settled')
      await input.sessions.waitForSessionIdle(turn.sessionId)
      // Native idle waits for settlement but intentionally consumes its rejected
      // promise. Independently confirm our capability cleanup before recording
      // quiescence. Preparation failures may have opened Preview without tools.
      if (tools) await tools.close()
      else {try {await measurement.close()} finally {try {await preview?.close()} finally {await image?.close()}}}
    }
    const snapshot=input.sessions.runtimeSnapshot(turn.sessionId)
    observedExits.set(turn.attemptId,{runId:run.id,facts:{turnId,nativeSessionId:snapshot.nativeSessionId,
      usage:turnId && snapshot.turnDiagnostics?.turnId===turnId ? snapshot.turnDiagnostics.usage : undefined,
      skillUses:skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)),quiescedAt:new Date().toISOString()}})
    await saveHostExitReceipt(input.exitReceipts,run,observedExits.get(turn.attemptId)!.facts)
    await persistObservedExit(run,turn)
    await settle(run,turn,failed)
  }
  async function persistObservedExit(run:Run,turn:AgentTurn,receipt?:HostExitFacts) {
    const exit=observedExits.get(turn.attemptId)
    if(!receipt && (!exit || exit.runId!==run.id || turn.workerId!==workerId))
      throw new WorkflowError('writer-unresolved','No durable native exit evidence or original-host observation; missing session or elapsed time cannot unlock writer')
    for (let i=0;i<2;i++) {
      const current=await read(run)
      if (!sameWriter(current,turn)) throw new WorkflowError('stale-attempt','Native goal writer changed')
      const next=structuredClone(current), result=next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      if(result.quiescedAt)return
      Object.assign(result,structuredClone(receipt ?? exit!.facts));next.version++
      try { await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.writer-quiesced');break }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
  }
  async function dispatch(run: Run, options: AgentExecutionOptions, message?: AgentMessage) {
    if (disposing) throw new WorkflowError('worker-stopping','Worker is shutting down')
    if (!run.agentTurns) throw new WorkflowError('agent-mode-required','Use full-goal intake, not a Task run')
    const requestKey=message?.requestKey ?? run.requestKey
    const duplicate=run.agentTurns.find(t=>t.requestKey===requestKey)
    if (duplicate) {
      if(!sameJson(duplicate.message,message))
        throw new WorkflowError('request-conflict','Request identity already belongs to a different message')
      return duplicate // an identical retry never replays model work
    }
    if (message) {
      if(message.runId!==run.id || message.chatSessionId!==run.chatSessionId)
        throw new WorkflowError('invalid-chat-binding','Message must address this Run and its native conversation',400)
      if(message.expectedVersion!==run.version || message.requirementsRevision!==run.requirements.revision)
        throw new WorkflowError('revision-conflict','Read the current project version before authorizing a new message')
    }
    if (run.paused) throw new WorkflowError('run-paused','Explicitly resume before dispatch')
    if (run.writer || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
      throw new WorkflowError('workspace-busy','Wait for the existing writer')
    if(message) {
      const previous=run.agentTurns.at(-1)
      // Native failure is not a live writer. Explicit fresh work may inspect
      // its retained outcomes after proven exit; continuation can explicitly
      // choose focused too. Default remains resume; no automatic reset/replay.
      if(message.contextMode==='focused' && (!previous || !['ended','failed','interrupted'].includes(previous.status)))
        throw new WorkflowError('unfinished-context','Focused work requires a settled native turn and confirmed exit evidence')
      if(!previous?.quiescedAt || !previous.finishedAt || !previous.nativeSessionId && previous.notStarted!==true)
        throw new WorkflowError('conversation-unavailable','No saved native conversation/exit evidence; do not restart the original goal')
      if(previous.notStarted===true && message.intent==='continue')
        throw new WorkflowError('invalid-continuation','This request never started. Authorize new work with a new request identity; it is not an interrupted native continuation',400)
      const actual=input.sessions.runtimeSnapshot(run.chatSessionId)
      if(actual.activeSubagentToolUseIds.length)
        throw new WorkflowError('workspace-busy','Native background work is still active')
      if(actual.nativeSessionId && actual.nativeSessionId!==previous.nativeSessionId)
        throw new WorkflowError('conversation-changed','Native conversation differs from the saved turn; reconcile actual history before continuing')
      // Disk history is required even if a worker still has a Chat in memory.
      // Missing/corrupt history must not silently start a new conversation.
      try {
        const history=await readSessionTranscriptFromDisk(run.chatSessionId,run.workspacePath)
        if(previous.nativeSessionId ? !history.some(e=>e.type==='user.message' && (!previous.turnId || e.turnId===previous.turnId)) :
            history.some(e=>e.type==='user.message' || e.type==='assistant.message' || e.type==='tool.started'))
          throw new Error('Saved conversation does not cover the previous native turn')
        if(history.some(e=>e.sessionId && e.sessionId!==run.chatSessionId))
          throw new Error('Saved conversation does not cover the previous native turn')
      }
      catch(error) {
        // A proven first no-start request may have no native history yet.
        // Any other missing/corrupt history remains a failure, not a fresh start.
        if(!(previous.notStarted===true && !previous.nativeSessionId && (error as NodeJS.ErrnoException).code==='ENOENT'))
          throw new WorkflowError('conversation-unavailable','Saved project conversation is unavailable; restore it before continuing',503)
      }
      if(message.intent==='continue' && (message.continuationOf!==previous.attemptId ||
          !['interrupted','failed'].includes(previous.status)))
        throw new WorkflowError('invalid-continuation','Continuation must address the latest interrupted or failed native turn',400)
    }
    const next=structuredClone(run);next.version++;next.fence++;next.status='running'
    if(message && ['change','message'].includes(message.intent)) {
      const original=run.requirementChanges?.[0]?.before ?? run.requirements
      const allMessages=[...run.agentTurns.flatMap(t=>t.message ? [t.message]:[]),message]
      const text=JSON.stringify({...JSON.parse(original.text),
        authorized_user_changes:allMessages.filter(m=>m.intent==='change').map(m=>({requestKey:m.requestKey,text:m.text})),
        user_messages:allMessages.filter(m=>m.intent==='message').map(m=>({requestKey:m.requestKey,text:m.text,
          ...(m.attachmentDigests?.length?{attachments:m.attachmentDigests}:{})})),
      })
      next.requirements={...run.requirements,revision:randomUUID(),text,
        sha256:digest(JSON.stringify({text,constraints:run.requirements.constraints,ids:run.requirements.ids}))}
      next.requirementChanges=[...(run.requirementChanges ?? []),{requestKey,actorId:run.ownerId,
        at:new Date().toISOString(),before:run.requirements,after:next.requirements}]
      // A natural-language message might change the goal. Invalidate older
      // evidence conservatively instead of guessing intent from keywords.
      next.planRevision++;next.deliveryEligible=false
    }
    const turn:AgentTurn={attemptId:randomUUID(),requestKey,sessionId:run.chatSessionId,
      workerId,fence:next.fence,status:'running',startedAt:new Date().toISOString(),
      requirementsRevision:next.requirements.revision,...(message?{message}:{})}
    next.agentTurns!.push(turn);next.writer={attemptId:turn.attemptId,fence:turn.fence,workerId}
    // Change + writer + request identity are one CAS, using the existing RPC.
    // The default Chat intent also records an append-only requirement snapshot:
    // its wording might change the goal, so the database requires this event.
    try {await input.store.commit(run.projectId,run.ownerId,run.version,next,
      message && ['message','change'].includes(message.intent)?'requirements.changed':'agent.turn-claimed')}
    catch(error) {
      // The ORIGINAL caller has not started execute()/native tools. If the
      // claim reached storage but its response was lost, record that no-start
      // fact for this exact reservation, not inferred exit for an old worker.
      observedExits.set(turn.attemptId,{runId:run.id,facts:{notStarted:true,quiescedAt:new Date().toISOString(),
        nativeSessionId:(input.sessions.get(run.chatSessionId)?input.sessions.runtimeSnapshot(run.chatSessionId).nativeSessionId:undefined) ?? run.agentTurns.at(-1)?.nativeSessionId}})
      await saveHostExitReceipt(input.exitReceipts,next,observedExits.get(turn.attemptId)!.facts)
      const current=await read(run)
      if(sameWriter(current,turn)) {
        await persistObservedExit(run,turn)
        await settle(run,turn,'Reservation response failed before execution. Original host confirmed no native work started; no automatic retry.')
      }else observedExits.delete(turn.attemptId)
      throw error
    }
    active.set(turn.attemptId,{sessionId:turn.sessionId,runId:next.id})
    const work=execute(next,turn,options).finally(()=>{pending.delete(work);active.delete(turn.attemptId)})
    pending.add(work);void work.catch(error=>console.error('[BGS V3] Native goal settlement incomplete', {
      attemptId:turn.attemptId,code:error instanceof WorkflowError?error.code:'settlement-error',
    }))
    return turn
  }
  return {
    /** Read-only event scope from THIS host's actual turn callback, not the
     * latest Chat snapshot. It is not native acceptance or writer-exit proof. */
    runningTurnId(run:Run,turn:AgentTurn) {
      const local=active.get(turn.attemptId)
      return local?.runId===run.id && local.sessionId===run.chatSessionId && turn.sessionId===run.chatSessionId &&
        turn.workerId===workerId && sameWriter(run,turn) ? local.turnId : undefined
    },
    writerLiveness(run: Run) { return !run.writer ? 'none' : active.has(run.writer.attemptId)?'local-active':'unknown' },
    async recoveryEvidence(run:Run) {
      const turn=run.agentTurns?.find(t=>t.attemptId===run.writer?.attemptId)
      if(!turn || !sameWriter(run,turn))return 'unavailable'
      if(turn.quiescedAt)return 'persisted'
      if(turn.workerId===workerId && observedExits.get(turn.attemptId)?.runId===run.id)return 'original-host'
      try {return await input.exitReceipts?.read(run)?'host-receipt':'unavailable'} catch {return 'unavailable'}
    },
    start:(run: Run, options: AgentExecutionOptions)=>dispatch(run,options),
    message:(run: Run, message: AgentMessage, options: AgentExecutionOptions)=>dispatch(run,options,message),
    async stop(run: Run) {
      for(let i=0;i<2;i++) {
        const current=await read(run),next=pauseRun(current)
        try {
          if(next!==current) await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.run-paused')
          if(next.writer && active.has(next.writer.attemptId)) input.sessions.stop(next.chatSessionId,'user_pause')
          return next
        } catch(error) {
          if(!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1)throw error
        }
      }
      throw new WorkflowError('revision-conflict','Pause could not be recorded')
    },
    async resume(run: Run) {
      const current=await read(run)
      if(current.version!==run.version) throw new WorkflowError('revision-conflict','Read current Run before resuming')
      if(current.writer) throw new WorkflowError('writer-unresolved','Resume cannot release an unknown writer')
      if(!current.paused)return current
      const next=structuredClone(current);next.version++;delete next.paused
      next.blockedReason='Resumed; no automatic retry or dispatch.'
      await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.run-resumed');return next
    },
    async recover(run: Run, identity:{expectedVersion:number;attemptId:string;fence:number}) {
      if(disposing)throw new WorkflowError('worker-stopping','Worker is shutting down')
      const current=await read(run),turn=current.agentTurns?.find(t=>t.attemptId===identity.attemptId)
      if(current.version!==identity.expectedVersion) throw new WorkflowError('revision-conflict','Read current Run before recovery')
      if(!turn || !sameWriter(current,turn) || turn.fence!==identity.fence) throw new WorkflowError('stale-attempt','Recovery does not address current writer')
      if(active.has(turn.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
        throw new WorkflowError('workspace-busy','Writer is still active')
      if(!turn.quiescedAt) {
        const original=turn.workerId===workerId && observedExits.get(turn.attemptId)?.runId===current.id
        const receipt=original?undefined:await input.exitReceipts?.read(current)
        await persistObservedExit(current,turn,receipt)
      }
      return settle(current,turn,'Recovered interrupted settlement; outputs and external outcomes remain unverified',true)
    },
    async dispose() {
      disposing=true
      for(const {sessionId} of active.values())
        if(input.sessions.get(sessionId)?.status==='running') input.sessions.stop(sessionId,'service_shutdown')
      await Promise.allSettled([...pending])
      observedExits.clear()
    },
  }
}
