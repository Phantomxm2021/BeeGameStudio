import { randomUUID } from 'node:crypto'
import { initialProductionAssignment, productionAssignmentPrompt, PRODUCTION_WORKFLOW_GUIDANCE, prepareProductionHandoff, verifyProductionHandoff, productionOutputSchema, parseProductionResult, prepareDesignDocumentHandoff, type ProductionAssignment } from './production-workflow'
import { z } from 'zod/v4'
import { readSessionTranscriptFactsFromDisk, type BeeGameAttachment, type BeeGameSessionManager, type StartBeeGameSessionInput, type BeeGameNativeGoalInput, type BeeGameEvent } from '../session-manager'
import { pauseRun, digest, isInitialSliceTurn, WorkflowError, type Run, type AgentTurn, type AgentMessage } from './state'
import { sameJson, type WorkflowStore } from './store'
import { skillEvidence } from './context'
import { openAgentTools, type AgentPreviewAccess, type AgentImageAccess } from './agent-tools'
import { createAgentMeasurement, AGENT_CONSUMPTION_CHECKS, type AgentDeliverySubmission } from './agent-measurement'
import { blockingRegisteredContentChecks, inspectAgentMeasurementInputs } from './measured-build'
import { readProjectGuide, projectGuideContext } from './project-guide'
import { saveHostExitReceipt, type HostExitReceipts, type HostExitFacts } from './host-exit-receipt'
import { requiresWebVisualComparison, isWebReactTarget } from './web-project-start'
import { inspectDesignAcceptance } from '../runtime-acceptance'
import { DESIGN_ACCEPTANCE_PATH } from '../design-handoff'
import { assertDesignReviewReady, DESIGN_REVIEW_AUTHOR_GUIDANCE } from './design-review'
import { designDocumentSource } from './production-workflow'

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
  intent:z.enum(['message','work','change','continue']).default('message'),text:z.string().trim(),
  attachments:z.array(z.unknown()).max(8).optional(),
  continuationOf:z.string().min(1).optional(),
  contextMode:z.enum(['resume','focused']).optional(),
}).strict().refine(value=>Boolean(value.text || value.attachments?.length || value.intent==='continue' && value.contextMode!=='focused'),
  {message:'A message needs text or an attachment, except native continuation in the original context'}).refine(value=>value.intent==='continue' ? Boolean(value.continuationOf) : value.continuationOf===undefined,
  {message:'Only explicit continuation requires continuationOf'}).refine(value=>value.contextMode!=='focused'||['work','change','continue'].includes(value.intent),
  {message:'Focused execution requires work, change or continuation'})

// Business data, authorization and shared coordination; specialist methods stay in Skills.
const enginePlatformContext = 'Preserve the user-selected engine and platform in bgsConfirmedBrief.settings. These settings are fixed at project confirmation. Chat messages and design edits cannot change them; if a later request proposes a different target, explain this limitation and retain the confirmed platform and engine. Choose architecture, entry points, source organization, build and verification methods in the technical sections of docs/GDD.md.'
const savedContentContext = 'Consume applicable editable content in the actual runtime, without a second hardcoded layout. BGS Editor reads BGS Scene/UI JSON; Unity/Godot/Unreal retain native data and have no BGS native-editing adapter. Report an unmet BGS Editor requirement instead of switching engines or duplicating native content into Web JSON. Maintain resources and bindings together.'
const professionalContextParagraphs = [
  'When starting concrete resource production, gameplay programming, technical art, feel tuning, debugging or verification work, select applicable Skills from the installed catalog for that problem. Reuse relevant guidance still in context; read missing guidance and references as needed, without loading all methods at stage entry. Apply the selected method to the actual outputs. Inspect produced resources; when work affects implementation, verify the affected code and behavior in the target runtime. Record findings, evidence and unresolved gaps in the existing work or verification record; reading a Skill or naming it does not establish effective application. Stay within the current authorized assignment.',
  'For implementation and delivery, complete and check the confirmed behavior: build/load, resources, rules, controls and their required visible/audible presentation, including state transitions and recovery. Confirmed visual/audio requirements remain implementation responsibilities. Missing behavior is unfinished; behavior without runtime observation remains unverified. User playtesting judges how clear, satisfying or enjoyable the result is; pending subjective feedback alone does not keep implementation running. Hand off implemented scope, actual observations and unresolved issues. Full-game bot navigation and route optimization are not default deliverables. Honor explicitly requested playtests and performance investigations without claiming unverified outcomes.',
  'Honor explicit resource sources and usage rights, and reuse suitable user-provided assets. Default sourcing order: built-in resource library, then suitable public resources, then an available AI production method appropriate to the required asset type. Move on when earlier sources do not yield a usable match; unavailable access is not an empty search result. Obtain the actual read-only quote before authorized generation; respect exclusions and the project budget, including model work. Only disclosed charges are authorized; no redundant per-image approval, unknown paid replay or automatic paid retry. Failed sourcing or AI generation does not authorize automatic procedural replacement of required art; that needs a concrete blocker and user authorization. Simple controls and geometric effects may use code directly; procedural core artwork requires an explicit user choice of that aesthetic, not an Agent-authored design decision. Placeholders cannot replace final art. A temporary stop creates no permanent asset prohibition.',
  'Keep editable sources separate from publication output and retain required licenses.',
]
// Shared on every workflow turn, including preparation and resumed projects.
// Native child tools provide execution; this assigns responsibility, not locks.
const limitedParallelWorkContext = 'BGS limited parallel work: use native child agents for substantial independent work whose inputs are ready and whose output avoids serial delay; keep coupled decisions and the current critical path with the parent. Usually use one child, at most two concurrently; small tasks and tool batches stay local. Do not require delegation or a review for every task. Prefer spawn_agent with fork_context:false for self-contained work. Pass the current authorized goal/stage, relevant constraints and budget, exact source/image paths and headings, established interfaces, current partial work, allowed write files (or read-only), current tool entries and the expected result. Children read the original sources and pictures; do not copy full history, GDDs, Skills or logs, lower the model to save tokens, or assume a summary covers the design. Give each concurrently edited file one writer. The parent owns shared GDD/progress records, shared interfaces, Manifest/index, dependency configuration and application wiring; delegate disjoint modules/resources or read-only findings once dependencies are settled. Children report needed shared changes to the parent, preserve others’ edits, and return changed/output paths, actual checks and unresolved issues; they do not spawn further agents, advance production or finish the project. Record ownership in the existing task record when one is already needed, not a new registry. The parent continues independent work, waits for all children and their tools to stop, inspects partial work after failure/interruption, and integrates actual files before affected verification. Reassign only after the prior writer stops; reuse an existing child for follow-up or release it through native tools before replacement when capacity is occupied. Do not blindly repeat failed or paid work. Validate integrated outputs within the current assignment: design/resource-only work checks its actual deliverables and source agreement without adding game implementation or runtime playtests. For work affecting runtime implementation, preserve selected visual designs, animation timing/lifecycle and gameplay rules; verify affected interfaces and the resulting combined scene/UI, normal-speed motion and ordinary-input player loop in the target runtime. Missing observations remain unverified; child completion and module tests are not full delivery. Only the parent submits the existing workflow handoff or validated delivery after integration; no extra approval stage.'
const firstVersionDeliveryContext = 'Deliver the confirmed scope using the design dependencies and professional methods in the project guide; design records live under docs/.'
const webReactRuntimeContext = 'For Web/React, implement UI and scenes in project-native code and data. BGS Scene/UI editing is not part of this target: do not create proprietary Scene/UI documents or a content/index.json merely for BGS editing. For new projects, prefer Phaser for real-time 2D worlds, Three.js with React Three Fiber for actual 3D, and React alone for UI-led games. Choose from the confirmed gameplay needs and explicit user preferences, not dimension labels alone; record the choice in the GDD technical section. Preserve existing runtime dependencies when modifying a project. Keep resources registered in assets/asset-manifest.json and verify actual rendering, input, motion and selected visual designs in the running game.'
// Native execution reads production guidance from the saved project guide once.
export const agentProfessionalContextForRun = (run: Pick<Run, 'visualHandoffVersion'> & Partial<Pick<Run, 'creation' | 'requirements'>>, followup = false) => [
  enginePlatformContext,
  isWebReactTarget(run.requirements?.constraints) ? webReactRuntimeContext : savedContentContext,
  ...professionalContextParagraphs,
  limitedParallelWorkContext,
  ...(!followup && run.creation?.initialDelivery === 'design-led-first-version' ? [firstVersionDeliveryContext] : []),
].join('\n')
export function agentMessagePrompt(message: AgentMessage, edits: NonNullable<Run['sourceEdits']> = []): string {
  return [...(edits.length ? ['User-authorized source saves since the preceding native turn:\n'+
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

// The Goal and follow-up assignments share the same BGS delivery endpoint.
const implementationHandoff = 'Complete the confirmed implementation scope and required technical observations. Reuse valid evidence for unchanged inputs; after changes, recheck affected behavior and integration. Submit the existing acceptance report through BgsFinishDelivery (or measure.mjs --finish when unavailable). A valid passed report completes delivery; an explicit blocked or failed report ends this execution as blocked, retaining the remaining scope and reason. Use that stop path when an external dependency, unavailable required observation or needed user decision prevents further authorized progress after independent work is exhausted; do not keep iterating on the same unchanged blocker. Tool coverage limitations and post-handoff subjective feedback alone do not create missing requirements. Native Goal completion alone is not delivery.'

export function agentGoalPrompt(run: Run): string {
  if (run.creation?.initialDelivery === 'playable-slice') return [
    'This first assignment delivers one small, complete player experience for user playtesting, not the full game. Reduced content quantity does not waive the required design dependencies. Keep the complete confirmed goal unchanged for subsequent work.',
    'Reduce content quantity, not the controls, readability or audiovisual feedback needed to judge the chosen experience. Preserve confirmed core rules; a proposed rule change is not authorization to implement it. Record the experience focus and deferred content in the existing concise design record, implement and run it, and make the actual preview available. Retain observations and unresolved experience questions in that same record, then end this turn for user feedback. Do not expand the full content set in this assignment or claim game acceptance.',
    'Use the complete confirmed goal in bgsConfirmedBrief; its full scope is retained, not all due in this first assignment.',
    implementationHandoff,
  ].join('\n\n')
  return [
    'Complete the current user assignment in this project. Select relevant Skills, organize the work and self-check the requested deliverables. Respect the production dependencies for work in scope; do not infer additional deliverables from the project creation mode. Stop at the requested boundary.',
    'Use the complete confirmed goal supplied in bgsConfirmedBrief.',
    implementationHandoff,
  ].join('\n\n')
}

// The initial build brief and its explicit interrupted continuations have a
// known implementation scope. Later work/change requests may be design-only;
// do not guess their deliverables from prose or the historical creation mode.
function requiresBuildDelivery(run: Run, turn: AgentTurn): boolean {
  if(turn.production)return turn.production.stage==='implementation'
  if(turn.productionHandoff)return false
  let current = turn
  while (current.message?.intent === 'continue') {
    const index = run.agentTurns!.findIndex(candidate => candidate.attemptId === current.attemptId)
    if (index <= 0) return false
    const previous = run.agentTurns!.slice(0, index).find(candidate => candidate.attemptId === current.message!.continuationOf)
    if (!previous) return false
    current = previous
  }
  return current.message === undefined
}

type NativeGoalObservation = { status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  objective: string; tokenBudget?: number | null; tokensUsed?: number }

// Read native lifecycle observations, never an assistant's completion claim.
function observedNativeGoal(events: readonly Pick<BeeGameEvent,'type'|'payload'>[], nativeSessionId?: string) {
  const value=events.findLast(event=>event.type==='system.status' && event.payload?.runtime==='bgs' &&
    event.payload?.subtype==='native_goal' && (!nativeSessionId || event.payload?.threadId===nativeSessionId))?.payload?.nativeGoal
  return value && typeof value==='object' && 'objective' in value && typeof value.objective==='string' &&
    'status' in value && typeof value.status==='string' &&
    ['active','paused','blocked','usageLimited','budgetLimited','complete'].includes(value.status)
    ? value as NativeGoalObservation : undefined
}

function nativeAssignment(run: Run, turn: AgentTurn, previousGoal: NativeGoalObservation | undefined,
  focused: boolean): BeeGameNativeGoalInput | undefined {
  const message=turn.message
  if(turn.production && turn.production.stage!=='implementation')return undefined
  // Chat remains literal: a question must not resume unfinished production.
  if(message?.intent==='message' || message?.intent==='discuss')return undefined
  if(message && (message.intent==='continue' || message.intent==='change') && previousGoal && previousGoal.status!=='complete') {
    if(!focused)return {mode:'resume'}
    // Preserve only an existing explicit native budget; BGS assigns no limit.
    const remaining=previousGoal.tokenBudget == null ? undefined : previousGoal.tokenBudget-(previousGoal.tokensUsed ?? 0)
    if(remaining!==undefined && remaining<=0)throw new WorkflowError('goal-budget-exhausted','The native Goal budget is exhausted; a new context does not extend it')
    return {mode:'start',objective:previousGoal.objective,...(remaining!==undefined?{tokenBudget:remaining}:{})}
  }
  if(turn.production)return {mode:'start',objective:'Implement the authorized assignment identified by '+turn.production.originRequestKey+' in the current production prompt. '+implementationHandoff+' Preparation handoffs do not certify game quality.'}
  if(!message)return {mode:'start',objective:agentGoalPrompt(run)}
  return undefined
}

/** Literal saved inputs, not an LLM summary or replay of prior operations.
 * Assistant-only assumptions are deliberately not claimed as retained. */
export function focusedExecutionFacts(run: Run, events: Awaited<ReturnType<typeof readSessionTranscriptFactsFromDisk>>) {
  const {text: _confirmedBrief, ...requirements} = run.requirements
  const questions=new Map(events.filter(e=>e.type==='permission.requested' && e.payload?.toolName==='AskUserQuestion')
    .map(e=>[e.payload?.toolUseID,e.payload?.input as {questions?:unknown}|undefined]))
  const answeredQuestions=events.filter(e=>e.type==='permission.resolved' && e.payload?.toolName==='AskUserQuestion')
    .flatMap(e=>{
      const value=e.payload?.input as {questions?: unknown;answers?: unknown}|undefined
      return [{eventId:e.id,turnId:e.turnId,status:e.payload?.decision,
        ...(e.payload?.intent === 'change' ? {intent:'change'} : {}),
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
    // The literal current requirements are supplied once through bgsConfirmedBrief.
    requirements,
    // Message/change text already belongs to requirements; old work/continue
    // requests are execution history. Legacy discuss records may hold choices
    // absent from requirements; retain their original text when reading history.
    priorUserRequests:run.agentTurns!.slice(0,-1).flatMap(t=>t.message?.intent==='discuss'?[{requestKey:t.requestKey,intent:t.message.intent,text:t.message.text}]:[]),
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
  if (turn.production?.stage === 'design' && turn.productionHandoff && !turn.productionHandoff.next)
    return 'Complete GDD saved to docs/GDD.md. The document task ended; game implementation and quality remain unverified.'
  // A follow-up need not build again merely to carry forward an unchanged
  // receipt. Inspect the newest actual record, including failed/pending ones.
  const record=run.agentTurns?.flatMap(t=>t.measurements??[]).at(-1)
  let acceptanceNote = ''
  if (record?.reportPaths.includes(DESIGN_ACCEPTANCE_PATH)) {
    const acceptance = await inspectDesignAcceptance(run.workspacePath,true,false,
      {runId:run.id,requirementsRevision:run.requirements.revision},
        {requireVisualComparison:requiresWebVisualComparison(run)})
    const verification = acceptance.verification
    const counts = (checks: {status:string}[] | undefined) => checks?.length
      ? ['passed','failed','unverified'].map(status => status + '=' + checks.filter(check=>check.status===status).length).join(', ')
      : 'not provided (coverage unverified)'
    // Report declarations and host measurements have different authority. Do
    // not reproduce an author's optimistic summary as the host's conclusion.
    // Keep counts and the full-report reference ahead of potentially long
    // diagnostics; the host display retains only the first 800 characters.
    acceptanceNote = '\n'+[
      `Author report: scope=${acceptance.scope ?? 'not recorded'}; declared=${acceptance.declaredStatus ?? 'not recorded'}; checked=${acceptance.status}; delivery checks=${acceptance.valid ? 'passed' : 'not passed'}.`,
      `Author-reported known issues: ${verification?.knownIssues.length ?? 'not provided'}; unverified items: ${verification?.unverified.length ?? 'not provided'}.`,
      'Content checks: '+counts(verification?.contentChecks)+'.',
      'Indexed requirement checks: '+counts(verification?.requirementChecks)+'.',
      'Author visual comparisons: '+(verification?.visualComparisons?.length
        ? ['matched','different','unverified'].map(status=>status+'='+verification.visualComparisons!.filter(check=>check.status===status).length).join(', ')
        : 'not recorded (visual agreement unverified)')+'.',
      `Author details: ${acceptance.path}#verification. Empty declarations do not establish coverage; game quality remains unverified.`,
      // A blocked/failed author's diagnostic repeats its summary. Only these
      // branches contain a host validation error rather than that declaration.
      ...(acceptance.diagnostic && (acceptance.diagnostic.category === 'report-invalid' || acceptance.declaredStatus === 'passed')
        ? ['Report validation: '+acceptance.diagnostic.category+': '+acceptance.diagnostic.message] : []),
    ].join('\n')
  }
  if(!record)return 'Native goal turn ended; execution completion is not acceptance. See saved files for the requested deliverables and unresolved work. No target-runtime measurement was recorded.'
  try {
    const freshness=await inspectAgentMeasurementInputs(run,record)
    const invalid=blockingRegisteredContentChecks(record)
    const status = freshness.current ? invalid.length ? 'registered Scene/UI checks need repair before delivery' : 'measured inputs are current' : freshness.code
    const detail = freshness.current ? invalid.length
      ? invalid.map(check=>check.id+' '+check.status).join(', ')+'. Inspect saved measurement findings; game-quality acceptance remains unverified.'
      : 'Game-quality acceptance remains unverified.' : freshness.reason
    return 'Native goal turn ended; '+status+'.'+acceptanceNote+'\nMeasurement details: '+detail
  } catch(error) {
    return 'Native goal turn ended; measurement freshness could not be verified.'+acceptanceNote+'\nMeasurement details: '+
      (error instanceof WorkflowError ? error.message : 'Inspect current project inputs; no automatic retry.')
  }
}

/** Native owns planning/tools/delegation; existing CAS store owns the writer.
 * No automatic model retries or stage advancement. */
export function createAgentGoalExecutor(input: { store: WorkflowStore; sessions: BeeGameSessionManager; resourceLibraryBaseUrl?: string; exitReceipts?: HostExitReceipts }) {
  const workerId = randomUUID(), active = new Map<string,{sessionId:string;runId:string;turnId?:string;work?:Promise<void>}>(), pending = new Set<Promise<void>>()
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
  async function recoveryState(run: Run) {
    const turn=run.agentTurns?.find(t=>t.attemptId===run.writer?.attemptId)
    if(!turn || !sameWriter(run,turn))return {evidence:'unavailable',code:'no-current-writer'}
    if(turn.quiescedAt)return {evidence:'persisted',code:'exit-persisted'}
    if(turn.workerId===workerId && observedExits.get(turn.attemptId)?.runId===run.id)
      return {evidence:'original-host',code:'exit-observed'}
    if(active.has(turn.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
      return {evidence:'unavailable',code:'execution-active'}
    // A failed cleanup on this executor is not a host restart. Keep its writer.
    if(turn.workerId===workerId)return {evidence:'unavailable',code:'execution-unresolved'}
    try {
      if(await input.exitReceipts?.read(run))return {evidence:'host-receipt',code:'exit-receipt'}
      return {evidence:'host-idle',code:'native-exit-unobserved'}
    } catch(error) {
      return {evidence:'unavailable',code:error instanceof WorkflowError?error.code:'exit-evidence-read-failed'}
    }
  }
  async function settle(run: Run, turn: AgentTurn, failed?: string, interrupted = false, nativeGoal?: NativeGoalObservation, deliverySubmission?: AgentDeliverySubmission) {
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
      delete next.writer; next.version++
      const missingDelivery=requiresBuildDelivery(current,saved) && !deliverySubmission
      const missingHandoff=Boolean(saved.production && saved.production.stage!=='implementation' && !saved.productionHandoff)
      const complete=!current.paused && !interrupted && !failed && !missingHandoff && !missingDelivery && (!deliverySubmission || deliverySubmission.status==='passed') &&
        (!nativeGoal || nativeGoal.status==='complete')
      const awaitingNext=complete && Boolean(saved.productionHandoff?.next)
      next.status=complete && !awaitingNext?'completed':'blocked'
      const handoffReason = (current.paused ? 'User paused; no automatic retry.' :
        failed ?? (deliverySubmission && deliverySubmission.status!=='passed' ? deliverySubmission.summary : undefined) ?? ((nativeGoal ? 'Codex Goal '+nativeGoal.status+'. ' : '') +
          (missingHandoff ? 'Current production assignment ended without its source-bound workflow handoff; no automatic continuation. ' : '') +
          (missingDelivery ? 'Implementation delivery was not submitted through the current BgsFinishDelivery / --finish capability. Inspect retained evidence and submit the existing delivery; no automatic test or model retry. ' : '') +
          (isInitialSliceTurn(current,result)
          ? 'Initial playable-slice assignment ended; inspect the actual preview and give feedback before expanding content. This is not full-game completion. ' : '') +
          await agentTurnHandoffReason(current,saved)))
      if(complete && !awaitingNext)delete next.blockedReason
      else next.blockedReason=awaitingNext ? 'Current production assignment handed off; waiting for its next assignment. Implementation is not complete.' : handoffReason
      try {
        await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.turn-settled')
        observedExits.delete(turn.attemptId)
        if (next.status === 'blocked' && !awaitingNext && !current.paused && !interrupted)
          input.sessions.recordDeliveryError(run.chatSessionId,
            missingHandoff && !failed ? 'Current production assignment ended without its source-bound workflow handoff; no automatic continuation.' : handoffReason,
            'workflow-blocked')
        const measured = result.measurements?.at(-1)
        input.sessions.recordHostEvidence(run.chatSessionId, {attemptId:turn.attemptId,turnId:result.turnId,
          execution:result.status,measurementId:measured?.id,checkStatuses:measured?.checks.map(({id,status})=>({id,status})) ?? [],
          unmeasured:measured ? ['build','runtime-smoke',...AGENT_CONSUMPTION_CHECKS].filter(id=>!measured.checks.some(check=>check.id===id)) : [],
          note:handoffReason,designFileChanges:result.designFileChanges})
        return next
      }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
    throw new WorkflowError('revision-conflict','Native goal settlement changed concurrently')
  }
  async function execute(run: Run, turn: AgentTurn, options: AgentExecutionOptions) {
    let failed: string | undefined, turnId: string | undefined
    let nativeGoal: NativeGoalObservation | undefined, deliverySubmission: AgentDeliverySubmission|undefined, hasImplementationGoal = false
    let tools: Awaited<ReturnType<typeof openAgentTools>> | undefined
    let preview: AgentPreviewAccess | undefined
    let image: AgentImageAccess | undefined
    let executionContext: Record<string, unknown> | undefined
    const measurement = createAgentMeasurement({run,turn,store:input.store,executionContext:()=>executionContext,
      skillUses:()=>turnId ? skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)) : [],
      onDeliverySubmitted:async submission=>{
        if(!hasImplementationGoal)
          throw new WorkflowError('delivery-unavailable','Enter the authorized implementation assignment through workflow.mjs before delivery')
        if(!turnId)throw new WorkflowError('delivery-unavailable','The native task has not started')
        await input.sessions.completeNativeGoal(turn.sessionId,turnId,submission)
      }})
    try {
      if (disposing || (await read(run)).paused) throw new Error('Worker stopped or user paused before dispatch')
      const previous=run.agentTurns!.filter(t=>t.attemptId!==turn.attemptId).at(-1)
      const focused=turn.message?.contextMode==='focused' || Boolean(previous?.nativeSessionId && previous.nativeRuntime !== 'bgs')
      const history=focused || turn.message || previous && turn.production ? await readSessionTranscriptFactsFromDisk(run.chatSessionId,run.workspacePath) : []
      if(focused)executionContext=focusedExecutionFacts(run,history)
      const previousGoal=observedNativeGoal(history,previous?.nativeSessionId)
      if(focused && previousGoal?.tokenBudget != null && previousGoal.status==='active' &&
        ['continue','change'].includes(turn.message?.intent ?? ''))
        throw new WorkflowError('goal-budget-unverified','The previous native Goal has no final usage snapshot. Resume its original context to recover accounting before changing context.')
      const nativeRecovery=turn.message?.intent==='continue' && !turn.message.text && !turn.message.attachmentDigests?.length
      if(nativeRecovery && (focused || previous?.nativeRuntime!=='bgs' || !previous.nativeSessionId))
        throw new WorkflowError('conversation-unavailable','Native recovery requires the original BGS conversation')
      // Retry the original assignment type. A later Chat/design turn must not
      // activate an unrelated Goal retained on the same native thread.
      let recoverySource=previous
      while(nativeRecovery && recoverySource?.message?.intent==='continue' && !recoverySource.message.text) {
        const index=run.agentTurns!.indexOf(recoverySource), priorId=recoverySource.message.continuationOf
        recoverySource=run.agentTurns!.slice(0,index).find(candidate=>candidate.attemptId===priorId)
      }
      const recoveryGoal=nativeRecovery && (observedNativeGoal(history.filter(event=>event.turnId===previous?.turnId),previous?.nativeSessionId) ||
        recoverySource && nativeAssignment(run,recoverySource,previousGoal,false))
      const assignment=nativeRecovery ? recoveryGoal ? {mode:'resume' as const} : undefined : nativeAssignment(run,turn,previousGoal,focused)
      hasImplementationGoal=Boolean(assignment)
      if(previous && input.sessions.get(turn.sessionId)?.status==='running') {
        // A restored idle Chat may lack its runtime snapshot. start() otherwise
        // reuses it and ignores resumeNativeSessionId, silently losing history.
        input.sessions.stop(turn.sessionId,'agent_message_resume')
        await input.sessions.waitForSessionIdle(turn.sessionId)
      }
      const session = input.sessions.start({ workspacePath:run.workspacePath, projectId:run.projectId, userId:run.ownerId,
        transcriptSessionId:run.chatSessionId, modelConfigId:options.modelConfigId, language:options.language,
        userDataRoot:options.userDataRoot,
        ...(focused ? {freshNativeContext:true} : previous?.nativeRuntime === 'bgs' && previous.nativeSessionId ? {resumeNativeSessionId:previous.nativeSessionId}:{}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken,
        workflowQuestionGuard: async () => {
          const current = await read(run)
          if (!sameWriter(current,turn) || current.paused)
            throw new WorkflowError('stale-attempt','This question no longer belongs to the active project turn')
          return {runId:run.id,attemptId:turn.attemptId}
        } })
      if (session.id!==run.chatSessionId) throw new Error('Native goal must use the bound project conversation')
      const userPrompt = turn.message ? agentMessagePrompt(turn.message,
        run.sourceEdits?.filter(e=>e.fence>(run.agentTurns?.at(-2)?.fence??0))) : ''
      const prompt = nativeRecovery ? '' : turn.production ? [userPrompt,productionAssignmentPrompt(run,turn.production)].filter(Boolean).join('\n\n') : userPrompt || agentGoalPrompt(run)
      const internalProduction = Boolean(turn.production && previous && !turn.message)
      await input.sessions.sendWithDisplay(session.id, prompt, {
        messageOrigin:internalProduction ? 'workflow' : 'user',
        ...(internalProduction ? {resumeReason:'production-handoff' as const} : {}),
        displayKind:turn.message ? 'workflow_v3_'+turn.message.intent : 'workflow_v3_goal',
        displayText:nativeRecovery ? '恢复原生执行' : turn.message?.text ?? agentGoalDisplayText(run),
        attachments:options.attachments,
        clientMessageId:turn.message?.requestKey,
        executionIdentity:{attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence},
        confirmedBriefContext:run.requirements.text,
        ...(assignment ? {nativeGoal:assignment} : {}),
        ...(nativeRecovery ? {nativeRecovery:true} : {}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken, language:options.language,
        onTurnAccepted:id=>{
          turnId=id
          const local=active.get(turn.attemptId)
          if(local?.runId===run.id)local.turnId=id
        },
        // The BGS adapter delivers this context through turn/start's application
        // slot, so resumed threads receive current capabilities and host facts.
        // Project conventions/navigation are one current file snapshot.
        prepareTurn:async ()=>{
          // A committed change whose native submission never started is not
          // in resumed model history. Carry its literal user data under this
          // new authorization. bgsConfirmedBrief supplies the current aggregate
          // requirements; these entries preserve which changes were not submitted.
          const preceding=run.agentTurns!.slice(0,-1),lastSubmitted=preceding.findLastIndex(t=>!t.notStarted)
          const pendingChanges=preceding.slice(lastSubmitted+1).filter(t=>t.notStarted===true &&
            (t.message?.intent==='change' || t.message?.intent==='message'))
            .map(t=>({requestKey:t.requestKey,intent:t.message!.intent,text:t.message!.text}))
          const confirmedChanges=pendingChanges.length?'\nConfirmed user data not previously submitted to native: '+JSON.stringify({
            requirementsRevision:run.requirements.revision,
            authorized_user_changes:pendingChanges.filter(item=>item.intent==='change').map(({requestKey,text})=>({requestKey,text})),
            user_messages:pendingChanges.filter(item=>item.intent==='message').map(({requestKey,text})=>({requestKey,text})),
          }):''
          if (turn.production?.stage === 'design') {
            const currentDesignWriter = async () => {
              const current = await read(run), saved = current.agentTurns!.find(t => t.attemptId === turn.attemptId)
              if (!sameWriter(current, turn) || current.paused || !saved || saved.quiescedAt)
                throw new WorkflowError('stale-attempt', 'Production writer changed or paused')
              if (saved.productionHandoff) throw new WorkflowError('request-conflict', 'GDD was already submitted')
              return current
            }
            return {
              turnContext: confirmedChanges,
              systemContext: enginePlatformContext + '\n' + (isWebReactTarget(run.requirements.constraints) ? webReactRuntimeContext : savedContentContext) + '\n' + DESIGN_REVIEW_AUTHOR_GUIDANCE + '\nThe current assignment is one GDD document task. Use the confirmed brief and necessary professional guidance. Maintain docs/GDD.md with WriteProjectFile/EditProjectFile; Shell and other project files remain read-only. This is a working document: interrupted work may leave a draft, not a completed handoff. End with only ready/blocked and a summary; do not repeat the document in the final result. BGS records the saved source and ends the task. Research only unresolved decisions; unavailable required sources are gaps, not reasons for repeated retrieval.' + confirmedChanges + (nativeRecovery ? '\n' + productionAssignmentPrompt(run, turn.production) : ''),
              finalOutput: { readOnly: true,
                writeDocument: { path: 'docs/GDD.md', authorize: async () => { await currentDesignWriter() } },
                designReview: {
                  candidate: async value => {
                    const request = parseProductionResult(turn.production!, value)
                    await currentDesignWriter()
                    return { source: designDocumentSource(run.workspacePath), summary: request.summary,
                      ...('reviewResponses' in request ? { reviewResponses: request.reviewResponses } : {}) }
                  },
                  record: async receipt => {
                    const current = await currentDesignWriter()
                    const next = structuredClone(current); next.version++
                    const saved = next.agentTurns!.find(t => t.attemptId === turn.attemptId)!
                    ;(saved.designReviews ??= []).push(receipt)
                    await input.store.commit(run.projectId, run.ownerId, current.version, next, 'agent.design-reviewed')
                  },
                },
                schema: productionOutputSchema(turn.production), accept: async (value: unknown) => {
                  const request = parseProductionResult(turn.production!, value)
                  const current = await currentDesignWriter()
                  assertDesignReviewReady(designDocumentSource(run.workspacePath), current.agentTurns!.find(t => t.attemptId === turn.attemptId)!.designReviews ?? [])
                  const handoff = prepareDesignDocumentHandoff(run.workspacePath, request.summary)
                  const next = structuredClone(current); next.version++
                  next.agentTurns!.find(t => t.attemptId === turn.attemptId)!.productionHandoff = handoff
                  await input.store.commit(run.projectId, run.ownerId, current.version, next, 'agent.production-handoff')
                  return request.summary
                } },
            }
          }
          const guide=projectGuideContext(await readProjectGuide(run.workspacePath))
          tools=await openAgentTools({ workspacePath:run.workspacePath, constraints:run.requirements.constraints,
            requireVisualComparison:requiresWebVisualComparison(run),
            sessionId:session.id,openPreview:options.openPreview ? async ()=>preview=await options.openPreview!() : undefined,
            libraryBaseUrl:input.resourceLibraryBaseUrl,
            getAuthToken:()=>options.getValidAuthToken?.() ?? options.authToken, measurement,
            workflow:async value=>{
              const current=await read(run)
              if(!sameWriter(current,turn) || current.paused)throw new WorkflowError('stale-attempt','Production writer changed or paused')
              const saved=current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
              if(saved.quiescedAt)throw new WorkflowError('stale-attempt','Production writer has stopped')
              if(value && typeof value==='object' && 'action' in value && value.action==='status')
                return {assignment:saved.production ?? null,handoff:saved.productionHandoff ?? null,quality:'unverified'}
              const handoff=prepareProductionHandoff(current,saved,value)
              if(saved.productionHandoff) {
                if(!sameJson(saved.productionHandoff,handoff))throw new WorkflowError('request-conflict','A different production handoff is already saved')
                return saved.productionHandoff
              }
              const next=structuredClone(current);next.version++
              next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!.productionHandoff=handoff
              await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.production-handoff')
              return {...handoff,quality:'unverified',instruction:'End this native turn; continuation occurs only after host cleanup.'}
            },
            openImage:options.openImage ? async ()=>image=await options.openImage!() : undefined })
          // Supply current host facts with the task, not solely through a
          // discovery command that the model may filter or never call. This
          // reads inputs once; it does not build, review or rewrite history.
          const evidence=await measurement.context()
          return {...tools,turnContext:confirmedChanges,
            ...(turn.production && turn.production.stage !== 'implementation' ? {finalOutput:{
              schema:productionOutputSchema(turn.production),
              accept:async (value:unknown)=>{
                const request=parseProductionResult(turn.production!,value)
                const current=await read(run), saved=current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
                if(!sameWriter(current,turn) || current.paused || saved.quiescedAt)
                  throw new WorkflowError('stale-attempt','Production writer changed or paused')
                // A compatible saved native session may still use its explicit
                // handoff tool. It must still survive the normal cleanup check.
                if(!saved.productionHandoff) await tools!.workflow!(request)
                return request.summary
              },
            }} : {}),
            systemContext:agentProfessionalContextForRun(run,Boolean(turn.message))+(turn.production && turn.production.stage!=='implementation' ? '\n\n'+PRODUCTION_WORKFLOW_GUIDANCE : '')+'\n\n'+guide+'\n\n'+tools.systemContext+
              '\n'+tools.turnContext+(nativeRecovery ? confirmedChanges : '')+(!nativeRecovery && !turn.production && turn.message && !assignment && ['message','work','change','continue'].includes(turn.message.intent) ? '\nThis message starts without a native Goal. Answer questions and complete design/resource work within the requested boundary. If the current request authorizes Scene/UI assembly, runtime or gameplay implementation, prefer BgsWorkflow({action:"implement", ...handoff fields}) when it is exposed; otherwise submit workflow.mjs --implement with the relevant existing sources and end this turn; BGS continues that same request with a Goal. Do not expand the assignment.' : '')+'\nBGS saved evidence (not game acceptance): '+JSON.stringify(evidence)}
        },
      })
      await input.sessions.waitForSessionIdle(session.id)
      const events=input.sessions.transcript(session.id).filter(e=>e.turnId===turnId)
      nativeGoal=observedNativeGoal(events,input.sessions.runtimeSnapshot(session.id).nativeSessionId)
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
    // The terminal native claim does not excuse a cleanup-time source/report
    // change. Validate the submitted bytes after all owned writers are stopped.
    if(!failed)try {
      deliverySubmission=await measurement.verifyDelivery()
      const handoff=(await read(run)).agentTurns!.find(t=>t.attemptId===turn.attemptId)!.productionHandoff
      if(handoff)verifyProductionHandoff(run.workspacePath,handoff)
    }
    catch(error) {failed=error instanceof Error?error.message:'Delivery changed while closing'}
    const snapshot=input.sessions.runtimeSnapshot(turn.sessionId)
    observedExits.set(turn.attemptId,{runId:run.id,facts:{turnId,nativeRuntime:'bgs',nativeSessionId:snapshot.nativeSessionId,
      usage:turnId && snapshot.turnDiagnostics?.turnId===turnId ? snapshot.turnDiagnostics.usage : undefined,
      skillUses:skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)),
      designFileChanges:measurement.designFileChanges(),quiescedAt:new Date().toISOString()}})
    await saveHostExitReceipt(input.exitReceipts,run,observedExits.get(turn.attemptId)!.facts)
    await persistObservedExit(run,turn)
    const settled=await settle(run,turn,failed,false,nativeGoal,deliverySubmission)
    const handoff=settled.agentTurns!.find(t=>t.attemptId===turn.attemptId)!.productionHandoff
    if(!failed && !settled.paused && (!nativeGoal || nativeGoal.status==='complete') && handoff?.next && !disposing) {
      // CAS reservation prevents a pause, source edit or user request from being
      // overwritten between settlement and automatic continuation. No replay.
      await dispatch(settled,{...options,attachments:undefined},undefined,{after:turn.attemptId,assignment:handoff.next})
    }
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
  async function dispatch(run: Run, options: AgentExecutionOptions, message?: AgentMessage, continuation?: {after:string;assignment:ProductionAssignment}) {
    if (disposing) throw new WorkflowError('worker-stopping','Worker is shutting down')
    if (!run.agentTurns) throw new WorkflowError('agent-mode-required','Use full-goal intake, not a Task run')
    if(continuation) {
      const previous=run.agentTurns.at(-1)
      if(run.status!=='blocked' || previous?.status!=='ended' || previous?.attemptId!==continuation.after || !previous.quiescedAt ||
          !previous.productionHandoff || !sameJson(previous.productionHandoff.next,continuation.assignment))
        throw new WorkflowError('invalid-continuation','Production continuation requires the latest settled handoff')
      verifyProductionHandoff(run.workspacePath,previous.productionHandoff)
    }
    const requestKey=continuation ? 'production:'+continuation.after : message?.requestKey ?? run.requestKey
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
    if(message && !run.agentTurns.length && (message.intent==='continue' || message.contextMode==='focused'))
      throw new WorkflowError('invalid-continuation','This project has not executed yet; send a new task instead of resuming a turn',400)
    if((message || continuation) && run.agentTurns.length) {
      const previous=run.agentTurns.at(-1)
      // Native failure is not a live writer. Explicit fresh work may inspect
      // its retained outcomes after proven exit; continuation can explicitly
      // choose focused too. Default remains resume; no automatic reset/replay.
      if(message?.contextMode==='focused' && (!previous || !['ended','failed','interrupted'].includes(previous.status)))
        throw new WorkflowError('unfinished-context','Focused work requires a settled native turn and confirmed exit evidence')
      if(!previous?.finishedAt || !previous.quiescedAt && (previous.status!=='interrupted' || message?.contextMode==='focused') || !previous.nativeSessionId && previous.notStarted!==true)
        throw new WorkflowError('conversation-unavailable','No saved native conversation or settled turn; do not restart the original goal')
      if(message?.intent==='continue' && !message.text && !message.attachmentDigests?.length &&
          (!['failed','interrupted'].includes(previous.status) || previous.nativeRuntime!=='bgs'))
        throw new WorkflowError('invalid-continuation','Native recovery requires a failed or interrupted BGS turn',400)
      if(previous.notStarted===true && message?.intent==='continue')
        throw new WorkflowError('invalid-continuation','This request never started. Authorize new work with a new request identity; it is not an interrupted native continuation',400)
      const actual=input.sessions.runtimeSnapshot(run.chatSessionId)
      if(actual.activeSubagentToolUseIds.length)
        throw new WorkflowError('workspace-busy','Native background work is still active')
      if(actual.nativeSessionId && actual.nativeSessionId!==previous.nativeSessionId)
        throw new WorkflowError('conversation-changed','Native conversation differs from the saved turn; reconcile actual history before continuing')
      // Disk history is required even if a worker still has a Chat in memory.
      // Missing/corrupt history must not silently start a new conversation.
      try {
        const history=await readSessionTranscriptFactsFromDisk(run.chatSessionId,run.workspacePath)
        if(previous.nativeSessionId && !history.length)
          throw new Error('Saved project Chat history is empty')
        if(previous.nativeSessionId ? !history.some(e=>(e.type==='user.message' ||
            previous.production && !previous.message && e.type==='turn.started' && e.payload?.messageOrigin==='workflow') &&
            (!previous.turnId || e.turnId===previous.turnId)) :
            history.some(e=>e.type==='user.message' || e.type==='assistant.message' || e.type==='tool.started' ||
              e.type==='turn.started' && e.payload?.messageOrigin==='workflow'))
          throw new WorkflowError('conversation-history-mismatch',
            'Project Chat history does not cover the latest saved execution. The project directory may have been restored from an older backup; restoring files does not roll back workflow or native conversation history. Reconcile the histories before continuing; no automatic restart or replay.',409)
        if(history.some(e=>e.sessionId && e.sessionId!==run.chatSessionId))
          throw new WorkflowError('conversation-history-mismatch',
            'Project Chat history belongs to a different session than the saved workflow. Reconcile the histories before continuing; no automatic restart or replay.',409)
      }
      catch(error) {
        if(error instanceof WorkflowError)throw error
        // A proven first no-start request may have no native history yet.
        // Any other missing/corrupt history remains a failure, not a fresh start.
        if(!(previous.notStarted===true && !previous.nativeSessionId && (error as NodeJS.ErrnoException).code==='ENOENT'))
          throw new WorkflowError('conversation-unavailable','Saved project conversation is unavailable; restore it before continuing',503)
      }
      if(message?.intent==='continue' && previous?.status==='ended' && previous.productionHandoff)
        verifyProductionHandoff(run.workspacePath,previous.productionHandoff)
      if(message?.intent==='continue' && (message.continuationOf!==previous.attemptId ||
          !['interrupted','failed'].includes(previous.status) && !(previous.status==='ended' && (previous.productionHandoff?.next || !previous.productionHandoff && previous.production && previous.production.stage!=='implementation'))))
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
    const previous=run.agentTurns.at(-1)
    const production=continuation?.assignment ?? (message?.intent==='continue'
      ? previous?.status==='ended' && previous.productionHandoff ? previous.productionHandoff.next : previous?.production
      : !message ? initialProductionAssignment(run) : undefined)
    const turn:AgentTurn={...(production?{production}:{}),nativeRuntime:'bgs',attemptId:randomUUID(),requestKey,sessionId:run.chatSessionId,
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
    active.get(turn.attemptId)!.work=work
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
    async recoveryEvidence(run:Run) { return (await recoveryState(run)).evidence },
    recoveryDiagnostic:recoveryState,
    start:(run: Run, options: AgentExecutionOptions)=>dispatch(run,options),
    message:(run: Run, message: AgentMessage, options: AgentExecutionOptions)=>dispatch(run,options,message),
    async stop(run: Run): Promise<Run> {
      for(let i=0;i<2;i++) {
        const current=await read(run),next=pauseRun(current)
        try {
          if(next!==current) await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.run-paused')
          const local=next.writer && active.get(next.writer.attemptId)
          if(local) {
            input.sessions.stop(next.chatSessionId,'user_pause')
            // Stop is complete only after native/tools cleanup and writer settlement.
            // Waiting reuses this attempt's existing work; it never dispatches work.
            await local.work?.catch(()=>undefined)
          }
          const stopped=await read(run)
          if(stopped.writer && (await recoveryState(stopped)).evidence!=='unavailable')
            return this.recover(stopped,{expectedVersion:stopped.version,...stopped.writer})
          return stopped
        } catch(error) {
          if(!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1)throw error
        }
      }
      throw new WorkflowError('revision-conflict','Pause could not be recorded')
    },
    async resume(run: Run): Promise<Run> {
      let current=await read(run)
      if(current.version!==run.version) throw new WorkflowError('revision-conflict','Read current Run before resuming')
      if(current.writer && current.paused) {
        await active.get(current.writer.attemptId)?.work?.catch(()=>undefined)
        current=await read(run)
      }
      if(current.writer)current=await this.recover(current,{expectedVersion:current.version,...current.writer})
      if(!current.paused)return current
      const next=structuredClone(current);next.version++;delete next.paused
      next.blockedReason='Resumed; no automatic retry or dispatch.'
      await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.run-resumed');return next
    },
    async recover(run: Run, identity:{expectedVersion:number;attemptId:string;fence:number}) {
      if(disposing)throw new WorkflowError('worker-stopping','Worker is shutting down')
      const current=await read(run),turn=current.agentTurns?.find(t=>t.attemptId===identity.attemptId)
      if(!current.writer && turn?.fence===identity.fence && turn.finishedAt && turn.status!=='running' && identity.expectedVersion<=current.version)
        return current // Lost HTTP acknowledgement never dispatches or repeats settlement.
      if(current.version!==identity.expectedVersion) throw new WorkflowError('revision-conflict','Read current Run before recovery')
      if(!turn || !sameWriter(current,turn) || turn.fence!==identity.fence) throw new WorkflowError('stale-attempt','Recovery does not address current writer')
      if(active.has(turn.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
        throw new WorkflowError('workspace-busy','Writer is still active')
      if(!turn.quiescedAt) {
        const original=turn.workerId===workerId && observedExits.get(turn.attemptId)?.runId===current.id
        const receipt=original?undefined:await input.exitReceipts?.read(current)
        if(!original && !receipt) {
          if(turn.workerId===workerId)
            throw new WorkflowError('writer-unresolved','Current worker cleanup is unresolved')
          // BGS records an interrupted request; CLI owns its execution lifecycle.
          // This fallback is for the single BGS service that owns this workspace.
          // It does not prove native exit or settle accounting/external outcomes.
          const next=structuredClone(current),record=next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
          let snapshot:ReturnType<typeof input.sessions.runtimeSnapshot>|undefined
          try {snapshot=input.sessions.runtimeSnapshot(current.chatSessionId)}
          catch(error) {if(!(error instanceof Error) || error.message!=='Session not found')throw error}
          const binding=snapshot?.executionIdentity
          if(snapshot?.workspacePath===current.workspacePath && snapshot.sessionId===current.chatSessionId &&
              binding?.attemptId===turn.attemptId && binding.workerId===turn.workerId && binding.fence===turn.fence &&
              binding.nativeSubmitted===true && snapshot.nativeSessionId) {
            record.nativeSessionId=snapshot.nativeSessionId;record.turnId=binding.turnId
          }
          record.status='interrupted';record.finishedAt=new Date().toISOString()
          record.error='BGS host interrupted; native exit, partial outputs and external outcomes remain unverified.'
          next.version++;delete next.writer;next.paused??={at:record.finishedAt};next.status='blocked'
          next.deliveryEligible=false;next.blockedReason=record.error+' No automatic dispatch.'
          await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.writer-recovered')
          return next
        }
        await persistObservedExit(current,turn,receipt)
      }
      const proven=await read(current),paused=pauseRun(proven)
      if(paused!==proven)await input.store.commit(run.projectId,run.ownerId,proven.version,paused,'agent.run-paused')
      return settle(paused,turn,'Recovered interrupted settlement; outputs and external outcomes remain unverified; no automatic dispatch',true)
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
