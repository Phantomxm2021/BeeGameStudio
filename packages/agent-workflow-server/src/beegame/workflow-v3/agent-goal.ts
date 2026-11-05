import { randomUUID } from 'node:crypto'
import { messageProductionAssignment, initialProductionAssignment, productionAssignmentPrompt, DESIGN_DECISION_SCOPE, PRODUCTION_WORKFLOW_GUIDANCE, prepareProductionHandoff, verifyProductionHandoff, productionOutputSchema, parseProductionResult, prepareDesignDocumentHandoff, type ProductionAssignment } from './production-workflow'
import { z } from 'zod/v4'
import { readSessionTranscriptFactsFromDisk, type BeeGameAttachment, type BeeGameSessionManager, type StartBeeGameSessionInput, type BeeGameNativeGoalInput, type BeeGameEvent } from '../session-manager'
import { pauseRun, digest, isInitialSliceTurn, WorkflowError, type Run, type AgentTurn, type AgentMessage, type DesignFileChanges, type ProjectFileChanges } from './state'
import { sameJson, type WorkflowStore } from './store'
import { skillEvidence } from './context'
import { openAgentTools, type AgentImageAccess } from './agent-tools'
import { activeUserTask } from './agent-measurement'
import { readProjectGuide, projectGuideContext } from './project-guide'
import { saveHostExitReceipt, type HostExitReceipts, type HostExitFacts } from './host-exit-receipt'
import { isWebCodeTarget } from './web-project-start'
import { artifactDigest } from '../runtime-acceptance'
import { PROJECT_DESIGN_PATHS, snapshotDesignRevisionFiles, designRevisionFileDigest } from '../design-handoff'
import { projectFiles, projectDependencies, changedProjectPaths, AGENT_SOURCE_EXCLUSIONS } from './checks'
import { assertDesignReviewReady } from './design-review'
import { designDocumentSource, designDocumentSnapshot, productionAssignmentFacts } from './production-workflow'

type AgentExecutionOptions = Partial<StartBeeGameSessionInput> & {
  attachments?: BeeGameAttachment[]
  openImage?: (context: { stage: ProductionAssignment['stage'] | undefined; requirements: string; requireGdd: boolean }) => AgentImageAccess | Promise<AgentImageAccess>
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
const enginePlatformContext = 'Preserve the user-selected engine and platform in bgsConfirmedBrief.settings. These settings are fixed at project confirmation. Chat messages and design edits cannot change them; if a later request proposes a different target, explain this limitation and retain the confirmed platform and engine. For screen targets, orientation Auto means adapting the same game to landscape and portrait containers; Landscape and Portrait retain their explicitly selected direction. Reference/design dimensions are layout coordinates, not an implicit minimum playable window.'
const nativeRuntimeContext = 'When implementation is authorized, use the confirmed engine/platform native scene, UI and resource sources. BGS Scene/UI editor JSON and content/index.json are not production deliverables on any platform. Runtime choice does not determine composition or art style, or authorize coding in visual-only work.'
const resourceAuthorizationContext = 'Honor explicit resource sources, resource-library preferences, usage rights and suitable supplied assets. When producing or changing game or UI artwork, read the applicable artwork-production guidance in game-content-pipeline-engineer before choosing its source or representation; reuse guidance retained in context. Carry confirmed user source requirements, GDD appearance targets and any selected pictures into that choice. Resource-library usage optional permits other artwork sources; neither that setting nor the absence of user-named asset files makes required artwork optional or selects programmatic drawing. Decide fallback eligibility from actual source findings and current tool capabilities, not untested assumptions that generation is risky or slow. Failed sourcing does not authorize changing those requirements or calling placeholders final. Retain required licenses.'
// Native execution owns scheduling; the host supplies only shared-write and authority boundaries.
const limitedParallelWorkContext = 'BGS limited parallel work: delegate only useful independent work with ready inputs, within native capacity and the current authorization. Give children relevant constraints, source paths, allowed writes and the expected result. Avoid overlapping writers; the parent owns shared records and integration. Wait for child work and tools to stop before reassigning writes. Child completion is not verification of the integrated result.'
const webLibraryContext = 'For a new Web/React project, select the gameplay library internally from the confirmed presentation: Phaser for 2D and Three.js for 3D. React remains the confirmed application choice; retain the selected library in the project package/configuration. Preserve existing runtime dependencies when modifying a project. User Preview runs in a sandboxed opaque iframe inside a resizable panel. Its CSS viewport is the available game container, not the display resolution; use that container for layout and scaling. Preview may use a URL subpath; root-absolute asset/content URLs can escape that path, and native localStorage/sessionStorage can throw.'
// Native execution reads production guidance from the saved project guide once.
export const agentProfessionalContextForRun = (run: Pick<Run, 'visualHandoffVersion'> & Partial<Pick<Run, 'creation' | 'requirements'>>, followup = false) => [
  enginePlatformContext,
  nativeRuntimeContext,
  ...(isWebCodeTarget(run.requirements?.constraints) ? [webLibraryContext] : []),
  resourceAuthorizationContext,
  limitedParallelWorkContext,
].join('\n')
export function agentMessagePrompt(message: AgentMessage, edits: NonNullable<Run['sourceEdits']> = []): string {
  return [...(edits.length ? ['User-authorized source saves since the preceding native turn:\n'+
    JSON.stringify([...new Map(edits.map(e=>[e.sourceEdit.path,{path:e.sourceEdit.path,status:e.sourceEdit.status}])).values()])] : []),
    'User message:\n'+message.text].join('\n\n')
}
function agentRequestText(run: Run): string {
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

// The Agent owns implementation and verification; host completion records execution only.
const implementationHandoff = 'Complete the current authorized scope and settled product behavior, including the adopted visual treatment. Choose verification for required behavior and affected risks; provisional values and open hypotheses do not by themselves require additional experiments. Reuse valid observations and recheck affected behavior after changes. Judge completion against those requirements and repair observed deviations. Alternative cosmetic preferences within an already satisfied treatment remain follow-up suggestions unless refinement is requested. End with the implemented result, checks actually performed and remaining defects, unverified behavior or external blockers.'

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

const designAnswerSchema = z.object({
  status: z.literal('answered').describe('Answer the current message without changing or submitting the GDD'),
  summary: z.string().trim().min(1).describe('The answer in the response language'),
}).strict()

// Chat can carry a production binding without scheduling work or requiring a
// production result. Only an actual handoff advances it.
function productionMessage(run: Run, turn: AgentTurn): AgentMessage | undefined {
  if (!turn.production) return undefined
  let source = turn
  while (source.message?.intent === 'continue') {
    const previous = run.agentTurns!.find(t => t.attemptId === source.message!.continuationOf)
    if (!previous) throw new Error('Production continuation has no originating turn')
    source = previous
  }
  return source.message
}
function productionContextChanged(previous: AgentTurn | undefined, production: ProductionAssignment | undefined, message?: AgentMessage): boolean {
  return Boolean(previous && (previous.production || production) &&
    (previous.production?.stage !== production?.stage || previous.production?.originRequestKey !== production?.originRequestKey ||
      production && previous.message && !message))
}

// Same source boundary as retained execution evidence. Formal design documents
// have their own handoff; they are not evidence of runtime implementation.
function implementationInputsChanged(turn: AgentTurn) {
  const changes=turn.projectFileChanges
  return changes?.status==='observed' && (changes.dependenciesChanged ||
    changes.files.some(file=>!PROJECT_DESIGN_PATHS.includes(file.path)))
}
async function snapshotProjectInputs(root: string): Promise<NonNullable<AgentTurn['projectInputs']>> {
  try {
    const [files,dependencySha256]=await Promise.all([projectFiles(root,'',AGENT_SOURCE_EXCLUSIONS),projectDependencies(root)])
    return {files,dependencySha256}
  }catch(error) {return {error:error instanceof Error?error.message:String(error)}}
}
async function observeProjectFileChanges(run: Run, turn: AgentTurn): Promise<ProjectFileChanges | undefined> {
  if(!turn.projectInputs)return undefined // Historical turns have no before evidence.
  const identity={scope:'project-input-files' as const,attemptId:turn.attemptId,requestKey:turn.requestKey}
  if('error' in turn.projectInputs)return {...identity,status:'unverified',files:[],dependenciesChanged:false,error:turn.projectInputs.error}
  try {
    const [files,dependencySha256]=await Promise.all([
      projectFiles(run.workspacePath,'',AGENT_SOURCE_EXCLUSIONS),projectDependencies(run.workspacePath),
    ])
    const before=new Map(turn.projectInputs.files.map(file=>[file.path,file.sha256]))
    const after=new Map(files.map(file=>[file.path,file.sha256]))
    const changed=changedProjectPaths(turn.projectInputs.files,files)
    const within=(path:string,root:string)=>path===root || path.startsWith(root+'/')
    const index=run.agentTurns!.findIndex(item=>item.attemptId===turn.attemptId)
    const previousArtifacts=new Set(run.agentTurns!.slice(0,index).flatMap(item=>item.measurements??[])
      .flatMap(record=>record.checks.flatMap(check=>check.id==='build' && check.projectBuild?[check.projectBuild.artifact.path]:[])))
    const latest=new Map(run.agentTurns!.flatMap(item=>item.measurements??[]).map(record=>[record.runtimeArtifact,record]))
    const outputs:string[]=[]
    for(const record of latest.values()) {
      const build=record.checks.find(check=>check.id==='build' && check.status==='passed')?.projectBuild
      if(!build || !changed.some(path=>within(path,build.artifact.path)) ||
          !files.some(file=>within(file.path,build.artifact.path)))continue
      // A newly declared artifact cannot hide an existing source directory.
      if(!previousArtifacts.has(build.artifact.path) && turn.projectInputs.files.some(file=>within(file.path,build.artifact.path)))continue
      // Reuse the existing host output receipt only while its actual bytes match.
      if(await artifactDigest(run.workspacePath,build.artifact.path,true)===build.artifact.sha256)
        outputs.push(build.artifact.path)
    }
    return {...identity,status:'observed',dependenciesChanged:turn.projectInputs.dependencySha256!==dependencySha256,
      files:changed.filter(path=>!outputs.some(output=>within(path,output))).map(path=>({path,
        change:!before.has(path)?'added':!after.has(path)?'deleted':'modified'}))}
  }catch(error) {
    return {...identity,status:'unverified',files:[],dependenciesChanged:false,
      error:error instanceof Error?error.message:String(error)}
  }
}

// The initial build brief and its explicit interrupted continuations have a
// known implementation scope. Later work/change requests may be design-only;
// do not guess their deliverables from prose or the historical creation mode.
function hasImplementationWork(run: Run, turn: AgentTurn): boolean {
  if(implementationInputsChanged(turn) && (!turn.production || turn.production.stage==='implementation'))return true
  if(turn.message?.intent==='continue') {
    const previous=run.agentTurns!.find(t=>t.attemptId===turn.message!.continuationOf)
    if(previous && (hasImplementationWork(run,previous) ||
      !previous.projectInputs && previous.production?.stage==='implementation' && previous.message &&
      ['failed','interrupted'].includes(previous.status)))return true
  }
  if(turn.productionHandoff?.request.action==='implement' && !turn.productionHandoff.next)return true
  if(productionMessage(run,turn))return false
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

// A fresh-context selection survives failure before a native thread is bound.
// This accepts a new user message; it never retries the failed request.
function freshContextRequested(message: AgentMessage | undefined, previous: AgentTurn | undefined): boolean {
  return message?.contextMode==='focused' || Boolean(message && message.intent!=='continue' &&
    message.contextMode!=='resume' && previous?.message?.contextMode==='focused' &&
    previous.status==='failed' && previous.quiescedAt && !previous.nativeSessionId)
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
  if(productionMessage(run,turn) || turn.production && turn.production.stage!=='implementation')return undefined
  // Chat remains literal: a question must not resume unfinished production.
  if(message?.intent==='message' || message?.intent==='discuss')return undefined
  if(message && (message.intent==='continue' || message.intent==='change') && previousGoal && previousGoal.status!=='complete') {
    if(!focused)return {mode:'resume'}
    // Preserve only an existing explicit native budget; BGS assigns no limit.
    const remaining=previousGoal.tokenBudget == null ? undefined : previousGoal.tokenBudget-(previousGoal.tokensUsed ?? 0)
    if(remaining!==undefined && remaining<=0)throw new WorkflowError('goal-budget-exhausted','The native Goal budget is exhausted; a new context does not extend it')
    return {mode:'start',objective:previousGoal.objective,...(remaining!==undefined?{tokenBudget:remaining}:{})}
  }
  // New implementation work uses an ordinary native turn. Only an observed
  // historical Goal above can retain its existing continuation and budget.
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
    // Ordinary messages can carry choices absent from the confirmed brief.
    // Retain their literal source, not past work/continue instructions to replay.
    priorUserRequests:run.agentTurns!.slice(0,-1).flatMap(t=>t.message && ['message','discuss'].includes(t.message.intent) &&
      (t.message.text || t.message.attachmentDigests?.length) ? [{requestKey:t.requestKey,intent:t.message.intent,text:t.message.text,
        ...(t.message.attachmentDigests?.length?{attachments:t.message.attachmentDigests}:{})}] : []),
    otherUserMessages,
    answeredQuestions,
    previousExecution:previous?{attemptId:previous.attemptId,requestKey:previous.requestKey,turnId:previous.turnId,
      nativeSessionId:previous.nativeSessionId,status:previous.status,error:previous.error,notStarted:previous.notStarted,
      finishedAt:previous.finishedAt,quiescedAt:previous.quiescedAt,
      unconfirmedTools:[...unconfirmedTools.values()],externalOutcomes:'not-inferred'}:null,
    omitted:'Prior native assistant/tool/thinking history and session permissions; no generated summary or automatic replay. Assistant-only implicit choices and previously loaded Skill bodies are not transferred.'}
}

/** Final host receipt is computed after owned work stops. No model summary,
 * report rewrite or retry; semantic quality is still not certified. */
export async function agentTurnHandoffReason(run: Run, turn: AgentTurn) {
  if (turn.production?.stage === 'design' && turn.productionHandoff && !turn.productionHandoff.next)
    return 'Complete GDD saved to docs/GDD.md. The document task ended; game implementation and quality remain unverified.'
  return 'Agent execution ended; execution completion is not independent game-quality acceptance.'
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
  async function settle(run: Run, turn: AgentTurn, failed?: string, interrupted = false, nativeGoal?: NativeGoalObservation, blocked?: string) {
    // Preparatory tasks track cross-boundary writes. Native implementation and
    // answers finish without whole-project freshness; publication checks its own inputs.
    let projectChanges: ProjectFileChanges | undefined
    for (let i=0;i<2;i++) {
      const current = await read(run)
      if (!sameWriter(current, turn)) throw new WorkflowError('stale-attempt', 'Native goal writer changed')
      const saved = current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      if (!saved.quiescedAt) throw new WorkflowError('writer-unresolved', 'Native exit is not confirmed')
      if(i===0 && (saved.production?.stage==='visual' || saved.production?.stage==='resources'))
        projectChanges=await observeProjectFileChanges(current,saved)
      const failure=failed ?? (projectChanges?.status==='unverified' && saved.productionHandoff?.next?.stage!=='implementation'
        ? 'Project input changes could not be verified: '+projectChanges.error : undefined)
      const next = structuredClone(current), result = next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      if(projectChanges)result.projectFileChanges=projectChanges
      result.status = interrupted || current.paused ? 'interrupted' : failure ? 'failed' : 'ended'
      result.finishedAt = new Date().toISOString()
      if (failure) result.error = failure
      delete next.writer; next.version++
      const missingHandoff=Boolean(saved.production && saved.production.stage!=='implementation' && !saved.productionHandoff &&
        (!productionMessage(current,saved) || implementationInputsChanged(result)))
      const complete=!current.paused && !interrupted && !failure && !blocked && !missingHandoff &&
        (!nativeGoal || nativeGoal.status==='complete')
      const awaitingNext=complete && Boolean(saved.productionHandoff?.next)
      next.status=complete && !awaitingNext?'completed':'blocked'
      const handoffReason = (current.paused ? 'User paused; no automatic retry.' :
        failure ?? blocked ?? ((nativeGoal ? 'Codex Goal '+nativeGoal.status+'. ' : '') +
          (missingHandoff ? 'Current production assignment ended without its source-bound workflow handoff; no automatic continuation. ' : '') +
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
            missingHandoff && !failure && !blocked ? 'Current production assignment ended without its source-bound workflow handoff; no automatic continuation.' : handoffReason,
            'workflow-blocked')
        input.sessions.recordHostEvidence(run.chatSessionId, {attemptId:turn.attemptId,turnId:result.turnId,
          execution:result.status,
          note:handoffReason,designFileChanges:result.designFileChanges,projectFileChanges:result.projectFileChanges})
        return next
      }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
    throw new WorkflowError('revision-conflict','Native goal settlement changed concurrently')
  }
  async function execute(run: Run, turn: AgentTurn, options: AgentExecutionOptions) {
    let failed: string | undefined, blocked: string | undefined, turnId: string | undefined
    let nativeStarted = false
    let nativeGoal: NativeGoalObservation | undefined
    let tools: Awaited<ReturnType<typeof openAgentTools>> | undefined
    let image: AgentImageAccess | undefined
    let executionContext: Record<string, unknown> | undefined
  // Capture once for this user turn, not at compact, context read or finalize.
  let before: Record<string, string | null> | undefined, snapshotError: string | undefined
  try { before = snapshotDesignRevisionFiles(run.workspacePath) }
  catch (error) { snapshotError = error instanceof Error ? error.message : String(error) }
  function designFileChanges(): DesignFileChanges {
    const identity = {scope: 'design-revision-files' as const, attemptId: turn.attemptId, requestKey: turn.requestKey}
    try {
      if (!before) return {...identity, status: 'unverified', files: [], error: snapshotError}
      const after = snapshotDesignRevisionFiles(run.workspacePath)
      // A removed index/reference must not hide deletion or editing of an old input.
      for (const path of Object.keys(before)) after[path] = designRevisionFileDigest(run.workspacePath, path)
      const files: DesignFileChanges['files'] = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
        .filter(path => (before![path] ?? null) !== (after[path] ?? null))
        .map(path => ({path, change: before![path] == null ? 'added' : after[path] == null ? 'deleted' : 'modified'}))
      return {...identity, status: 'observed', files}
    } catch (error) { return {...identity, status: 'unverified', files: [], error: error instanceof Error ? error.message : String(error)} }
  }
    try {
      if (disposing || (await read(run)).paused) throw new Error('Worker stopped or user paused before dispatch')
      const previous=run.agentTurns!.filter(t=>t.attemptId!==turn.attemptId).at(-1)
      const previousSnapshot = previous?.status === 'failed' && previous.production?.stage === 'implementation'
        ? input.sessions.runtimeSnapshot(run.chatSessionId) : undefined
      const binding = previousSnapshot?.executionIdentity
      const startupOnlyFailure = Boolean(previous?.quiescedAt && previous.nativeSessionId &&
        previousSnapshot?.workspacePath === run.workspacePath && previousSnapshot.sessionId === run.chatSessionId &&
        previousSnapshot.nativeSessionId === previous.nativeSessionId && binding?.attemptId === previous.attemptId &&
        binding.workerId === previous.workerId && binding.fence === previous.fence && binding.turnId === previous.turnId &&
        binding.nativeSubmitted !== true && previousSnapshot.turnDiagnostics?.turnId === previous.turnId &&
        previousSnapshot.turnDiagnostics.agentCalls === 0 && previousSnapshot.turnDiagnostics.usage.total_tokens === 0)
      const taskChanged=productionContextChanged(previous,turn.production,turn.message)
      const focused=taskChanged || freshContextRequested(turn.message,previous) || Boolean(previous?.nativeSessionId && previous.nativeRuntime !== 'bgs')
      const history=focused || turn.message || previous && turn.production ? await readSessionTranscriptFactsFromDisk(run.chatSessionId,run.workspacePath) : []
      if(focused)executionContext=focusedExecutionFacts(run,history)
      const previousGoal=observedNativeGoal(history,previous?.nativeSessionId)
      if(focused && previousGoal?.tokenBudget != null && previousGoal.status==='active' &&
        ['continue','change'].includes(turn.message?.intent ?? ''))
        throw new WorkflowError('goal-budget-unverified','The previous native Goal has no final usage snapshot. Resume its original context to recover accounting before changing context.')
      const nativeRecovery=!taskChanged && turn.message?.intent==='continue' && !turn.message.text && !turn.message.attachmentDigests?.length
      if(nativeRecovery && (focused || previous?.nativeRuntime!=='bgs' || !previous.nativeSessionId))
        throw new WorkflowError('conversation-unavailable','Native recovery requires the original BGS conversation')
      // Retry the original assignment type. A later Chat/design turn must not
      // activate an unrelated Goal retained on the same native thread.
      let recoverySource=previous
      while(nativeRecovery && recoverySource?.message?.intent==='continue' && !recoverySource.message.text) {
        const index=run.agentTurns!.indexOf(recoverySource), priorId=recoverySource.message.continuationOf
        recoverySource=run.agentTurns!.slice(0,index).find(candidate=>candidate.attemptId===priorId)
      }
      const recoveryGoal=nativeRecovery && (observedNativeGoal(history.filter(event=>
        event.turnId===previous?.turnId || event.turnId===recoverySource?.turnId),previous?.nativeSessionId) ||
        recoverySource && nativeAssignment(run,recoverySource,previousGoal,false))
      const assignment=nativeRecovery ? recoveryGoal ? {mode:'resume' as const} : undefined : nativeAssignment(run,turn,previousGoal,focused)
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
      const productionChat = productionMessage(run,turn)
      const visualProduction = turn.production?.stage === 'visual'
      const prompt = nativeRecovery ? '' : turn.production?.stage === 'design' ? userPrompt || productionAssignmentPrompt(run,turn.production)
        : turn.production && !productionChat ? [productionAssignmentPrompt(run,turn.production),userPrompt].filter(Boolean).join('\n\n') : userPrompt || agentGoalPrompt(run)
      const internalProduction = Boolean(turn.production && previous && !turn.message)
      await input.sessions.sendWithDisplay(session.id, prompt, {
        messageOrigin:internalProduction ? 'workflow' : 'user',
        ...(internalProduction ? {resumeReason:'production-handoff' as const} : {}),
        displayKind:turn.message ? 'workflow_v3_'+turn.message.intent : 'workflow_v3_goal',
        displayText:nativeRecovery ? '恢复原生执行' : turn.message?.text ?? agentRequestText(run),
        attachments:options.attachments,
        clientMessageId:turn.message?.requestKey,
        executionIdentity:{attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence},
        confirmedBriefContext:run.requirements.text,
        ...(assignment ? {nativeGoal:assignment} : {}),
        ...(nativeRecovery ? {nativeRecovery:true} : {}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken, language:options.language,
        onNativeStart:()=>{nativeStarted=true},
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
            const designChat = productionMessage(run,turn)
            const designContext = [
              enginePlatformContext,
              designChat
                ? 'Current GDD handoff: the current document assignment and its affected design decisions. User assignment: ' + JSON.stringify(turn.message?.text || designChat.text)
                : 'Current design handoff: the confirmed game and its next authorized production work. docs/GDD.md records the decisions that work needs.',
            ].join('\n')
            const currentDesignWriter = async () => {
              const current = await read(run), saved = current.agentTurns!.find(t => t.attemptId === turn.attemptId)
              if (!sameWriter(current, turn) || current.paused || !saved || saved.quiescedAt)
                throw new WorkflowError('stale-attempt', 'Production writer changed or paused')
              if (saved.productionHandoff) throw new WorkflowError('request-conflict', 'GDD was already submitted')
              return current
            }
            return {
              turnContext: confirmedChanges,
              systemContext: designContext + '\n' + DESIGN_DECISION_SCOPE,
              finalOutput: { readOnly: true,
                ...(designChat ? { answer: async (value: unknown) => {
                  const answer = designAnswerSchema.safeParse(value)
                  if (!answer.success) return undefined
                  const current = await currentDesignWriter()
                  const changes = designFileChanges()
                  if (changes.status !== 'observed') throw Error('Cannot verify an unchanged design for an answer-only result')
                  if (changes.files.some(file => file.path === 'docs/GDD.md') ||
                      current.agentTurns!.find(t => t.attemptId === turn.attemptId)!.designReviews?.length)
                    throw Error('A changed design or reviewed candidate requires a ready/blocked result, not an answer-only result')
                  return answer.data.summary
                } } : {}),
                writeDocument: { path: 'docs/GDD.md', authorize: async () => { await currentDesignWriter() } },
                designReview: {
                  context: designContext + '\n' + DESIGN_DECISION_SCOPE,
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
                schema: designChat ? {anyOf:[productionOutputSchema(turn.production), z.toJSONSchema(designAnswerSchema, {target:'draft-7'})]}
                  : productionOutputSchema(turn.production), accept: async (value: unknown) => {
                  const request = parseProductionResult(turn.production!, value)
                  const current = await currentDesignWriter()
                  assertDesignReviewReady(designDocumentSource(run.workspacePath), current.agentTurns!.find(t => t.attemptId === turn.attemptId)!.designReviews ?? [])
                  const handoff = prepareDesignDocumentHandoff(run.workspacePath, request.summary)
                  if (!designChat && turn.production!.stopAfter)
                    handoff.next = {...turn.production!, stage: turn.production!.stopAfter === 'implementation' ? 'implementation' : 'visual'}
                  const next = structuredClone(current); next.version++
                  next.agentTurns!.find(t => t.attemptId === turn.attemptId)!.productionHandoff = handoff
                  await input.store.commit(run.projectId, run.ownerId, current.version, next, 'agent.production-handoff')
                  return request.summary
                } },
            }
          }
          const guide=projectGuideContext(await readProjectGuide(run.workspacePath))
          tools=await openAgentTools({ workspacePath:run.workspacePath, constraints:run.requirements.constraints,
            sessionId:session.id,
            libraryBaseUrl:input.resourceLibraryBaseUrl,
            getAuthToken:()=>options.getValidAuthToken?.() ?? options.authToken,
            workflow:async value=>{
              const current=await read(run)
              if(!sameWriter(current,turn) || current.paused)throw new WorkflowError('stale-attempt','Production writer changed or paused')
              const saved=current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
              if(saved.quiescedAt)throw new WorkflowError('stale-attempt','Production writer has stopped')
              if(value && typeof value==='object' && 'action' in value && value.action==='status')
                return {assignment:saved.production ?? null,handoff:saved.productionHandoff ?? null,quality:'unverified'}
              if (saved.production?.stage === 'visual' && value && typeof value === 'object' &&
                  'action' in value && value.action === 'advance')
                throw new WorkflowError('visual-handoff-result-required', 'Submit selected visual image sources through the final ready result')
              const handoff=prepareProductionHandoff(current,saved,value)
              if (handoff.request.action === 'select-visual') {
                if (sameJson(saved.visualSelection, handoff)) return { ...handoff, quality:'unverified', instruction:'Continue the current task; no stage transition.' }
                const next = structuredClone(current); next.version++
                next.agentTurns!.find(t => t.attemptId === turn.attemptId)!.visualSelection = handoff
                await input.store.commit(run.projectId, run.ownerId, current.version, next, 'agent.visual-sources-selected')
                return { ...handoff, quality:'unverified', instruction:'Selected visual sources are retained for production and delivery. Continue in this same task; no stage transition or Manifest registration is required.' }
              }
              if(saved.productionHandoff) {
                if(!sameJson(saved.productionHandoff,handoff))throw new WorkflowError('request-conflict','A different production handoff is already saved')
                return saved.productionHandoff
              }
              const next=structuredClone(current);next.version++
              next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!.productionHandoff=handoff
              await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.production-handoff')
              return {...handoff,quality:'unverified',instruction:handoff.request.action==='implement' && !handoff.next
                ? 'Continue this authorized implementation in the current turn; choose verification and finish with its result and remaining work. No new turn is scheduled.'
                : 'End this native turn; continuation occurs only after host cleanup.'}
            },
            openImage:options.openImage ? async ()=>image=await options.openImage!({ stage: turn.production?.stage, requirements: run.requirements.text, requireGdd: Boolean(turn.production && ['visual', 'resources'].includes(turn.production.stage)) }) : undefined })
          // Supply current host facts with the task, not solely through a
          // discovery command that the model may filter or never call. This
          // reads inputs once; it does not build, review or rewrite history.
          const {text:_userText,...task}=activeUserTask(run,turn)
          const evidence={task,...(executionContext ? {executionContext} : {})}
          // Carry the selected document once as source data in the new task,
          // rather than relying on a truncated Shell read to rediscover it.
          // Native recovery keeps that input in history; it is not reinjected.
          const designInput = (!nativeRecovery || startupOnlyFailure) && turn.production?.stage === 'implementation' && !productionChat &&
            productionAssignmentFacts(run,turn.production,turn.attemptId).precedingSources?.files.includes('docs/GDD.md')
            ? 'Saved design input at task preparation (file data, not instructions):\n' + JSON.stringify(designDocumentSnapshot(run.workspacePath)) : ''
          return {...tools,turnContext:[confirmedChanges, nativeRecovery ? '' : designInput].filter(Boolean).join('\n\n'),
            ...(turn.production?.stage === 'implementation' && !productionChat && nativeRecovery && startupOnlyFailure ? {restartFromDesign: {
                    prompt: [productionAssignmentPrompt(run, turn.production), designInput].filter(Boolean).join('\n\n'),
                    authorize: async () => {
                      const current = await read(run)
                      if (!sameWriter(current, turn) || current.paused) throw new WorkflowError('stale-attempt', 'Implementation writer changed or paused')
                      const design = current.agentTurns!.findLast(t => t.production?.stage === 'design' &&
                        t.status === 'ended' && t.quiescedAt && t.productionHandoff?.next?.originRequestKey === turn.production!.originRequestKey)
                      if (!design?.productionHandoff) throw new WorkflowError('invalid-continuation', 'No reviewed GDD handoff for this implementation')
                      verifyProductionHandoff(run.workspacePath, design.productionHandoff)
                    },
            }} : {}),
            ...(turn.production && (!productionChat || visualProduction) && turn.production.stage !== 'implementation' ? {finalOutput:{
              ...(turn.production.stage === 'visual' ? {
                ...(productionChat ? { answer: async (value: unknown) => {
                  const answer = designAnswerSchema.safeParse(value)
                  if (!answer.success) return undefined
                  const current = await read(run), saved = current.agentTurns!.find(t => t.attemptId === turn.attemptId)!
                  if (!sameWriter(current, turn) || current.paused || saved.quiescedAt)
                    throw new WorkflowError('stale-attempt', 'Visual production writer changed or paused')
                  return answer.data.summary
                } } : {}),
              } : {}),
              schema: productionChat ? {anyOf:[productionOutputSchema(turn.production), z.toJSONSchema(designAnswerSchema, {target:'draft-7'})]} : productionOutputSchema(turn.production),
              accept:async (value:unknown)=>{
                const request=parseProductionResult(turn.production!,value)
                const current=await read(run), saved=current.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
                if(!sameWriter(current,turn) || current.paused || saved.quiescedAt)
                  throw new WorkflowError('stale-attempt','Production writer changed or paused')
                // A compatible saved native session may still use its explicit
                // handoff tool. It must still survive the normal cleanup check.
                if(!saved.productionHandoff) {
                  if (turn.production?.stage === 'visual') {
                    // Publish saved sources through the existing final-result boundary.
                    // Historical review receipts remain on their original turns.
                    const handoff = prepareProductionHandoff(current, saved, request)
                    const next = structuredClone(current); next.version++
                    next.agentTurns!.find(t => t.attemptId === turn.attemptId)!.productionHandoff = handoff
                    await input.store.commit(run.projectId, run.ownerId, current.version, next, 'agent.production-handoff')
                  } else await tools!.workflow!(request)
                }
                return request.summary
              },
            }} : {}),
            systemContext:agentProfessionalContextForRun(run,Boolean(turn.message))+(productionChat && turn.production?.stage==='implementation' ? '\nThe current user message is the assignment boundary. Answer questions directly; carry out authorized implementation and choose its verification in this same turn. Finish with results and remaining work, without restarting earlier production stages. A BGS implementation handoff or delivery submission is not required.' : '')+(turn.production && !productionChat && turn.production.stage!=='implementation' ? '\n\n'+PRODUCTION_WORKFLOW_GUIDANCE : '')+'\n\n'+guide+'\n\n'+tools.systemContext+
              '\n'+tools.turnContext+(nativeRecovery ? confirmedChanges : '')+(!nativeRecovery && !turn.production && turn.message && !assignment && ['message','work','change','continue'].includes(turn.message.intent) ? '\nThis message starts without a native Goal. Answer questions or perform authorized work within the current user assignment. Choose implementation and verification methods and finish in this turn; no additional implementation handoff is required. Do not expand the assignment.' : '')+'\nBGS current assignment: '+JSON.stringify(evidence)}
        },
      })
      await input.sessions.waitForSessionIdle(session.id)
      const events=input.sessions.transcript(session.id).filter(e=>e.turnId===turnId)
      nativeGoal=assignment ? observedNativeGoal(events,input.sessions.runtimeSnapshot(session.id).nativeSessionId) : undefined
      blocked=events.findLast(e=>e.type==='turn.completed' && e.payload?.subtype==='production_blocked')?.text
      const failure=events.findLast(e=>e.type==='turn.failed')
      if(failure) throw new Error(failure.text || 'Agent turn failed; partial candidates are not accepted')
      if (!turnId || !events.some(e=>e.type==='turn.completed') || events.some(e=>e.type==='turn.failed'))
        throw new Error('Agent turn was interrupted or did not complete; existing work is retained')
      if (input.sessions.runtimeSnapshot(session.id).activeSubagentToolUseIds.length)
        throw new Error('Native background work is unfinished')
    } catch (error) { failed=error instanceof Error?error.message:'Agent execution failed' }
    finally {
      // Preserve conversation history; confirm process cleanup before unlock.
      if (input.sessions.get(turn.sessionId)?.status==='running')
        input.sessions.stop(turn.sessionId, 'agent_goal_settled')
      await input.sessions.waitForSessionIdle(turn.sessionId)
      // Native idle waits for settlement but intentionally consumes its rejected
      // promise. Independently confirm our capability cleanup before recording
      // quiescence. Preparation failures may have opened Preview without tools.
      if (tools) await tools.close()
      else await image?.close()
    }
    // The terminal native claim does not excuse a cleanup-time source/report
    // change. Validate the submitted bytes after all owned writers are stopped.
    if(!failed)try {
      const handoff=(await read(run)).agentTurns!.find(t=>t.attemptId===turn.attemptId)!.productionHandoff
      if(handoff)verifyProductionHandoff(run.workspacePath,handoff)
    }
    catch(error) {failed=error instanceof Error?error.message:'Delivery changed while closing'}
    const snapshot=input.sessions.runtimeSnapshot(turn.sessionId)
    observedExits.set(turn.attemptId,{runId:run.id,facts:{turnId,nativeRuntime:'bgs',nativeSessionId:snapshot.nativeSessionId,
      ...(!nativeStarted?{notStarted:true as const}:{}),
      usage:nativeStarted && turnId && snapshot.turnDiagnostics?.turnId===turnId ? snapshot.turnDiagnostics.usage : undefined,
      skillUses:skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)),
      designFileChanges:designFileChanges(),quiescedAt:new Date().toISOString()}})
    await saveHostExitReceipt(input.exitReceipts,run,observedExits.get(turn.attemptId)!.facts)
    await persistObservedExit(run,turn)
    const settled=await settle(run,turn,failed,false,nativeGoal,blocked)
    const settledTurn=settled.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
    const handoff=settledTurn.productionHandoff
    if(!failed && !blocked && settledTurn.status==='ended' && !settled.paused &&
        (!nativeGoal || nativeGoal.status==='complete') && handoff?.next && !disposing) {
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
      const pending = previous?.productionHandoff ? previous.productionHandoff.next
        : previous?.production?.stage !== 'implementation' ? previous?.production : undefined
      const settled = previous?.productionHandoff ? previous.status === 'ended'
        : previous && ['ended', 'failed', 'interrupted'].includes(previous.status)
      if(run.status!=='blocked' || !settled || previous?.attemptId!==continuation.after || !previous.quiescedAt ||
          !pending || !sameJson(pending,continuation.assignment))
        throw new WorkflowError('invalid-continuation','Production continuation requires the latest settled handoff or unfinished preparation assignment')
      if (previous.productionHandoff) verifyProductionHandoff(run.workspacePath,previous.productionHandoff)
    }
    const requestKey=continuation ? 'production:'+continuation.after : message?.requestKey ?? run.requestKey
    const previous=run.agentTurns.at(-1)
    const production=continuation?.assignment ?? (message
      ? messageProductionAssignment(run,requestKey,Boolean(previous && hasImplementationWork(run,previous) &&
        (run.status==='blocked' || ['failed','interrupted'].includes(previous.status)))) ?? (message.intent==='continue'
        ? previous?.status==='ended' && previous.productionHandoff ? previous.productionHandoff.next : previous?.production
        : undefined)
      : initialProductionAssignment(run))
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
      const focused=productionContextChanged(previous,production,message) || freshContextRequested(message,previous)
      // Native failure is not a live writer. Explicit fresh work may inspect
      // its retained outcomes after proven exit; continuation can explicitly
      // choose focused too. Same-task/stage follow-ups resume; stage changes retain source facts instead of native execution history.
      if(focused && (!previous || !['ended','failed','interrupted'].includes(previous.status)))
        throw new WorkflowError('unfinished-context','Focused work requires a settled native turn and confirmed exit evidence')
      if(!previous?.finishedAt || !previous.quiescedAt && (previous.status!=='interrupted' || focused) || !focused && !previous.nativeSessionId && previous.notStarted!==true)
        throw new WorkflowError('conversation-unavailable','No saved native conversation or settled turn; do not restart the original goal')
      if(message?.intent==='continue' && !message.text && !message.attachmentDigests?.length &&
          (!['failed','interrupted'].includes(previous.status) || previous.nativeRuntime!=='bgs'))
        throw new WorkflowError('invalid-continuation','Native recovery requires a failed or interrupted BGS turn',400)
      if(previous.notStarted===true && message?.intent==='continue')
        throw new WorkflowError('invalid-continuation','This request never started. Authorize new work with a new request identity; it is not an interrupted native continuation',400)
      const actual=input.sessions.runtimeSnapshot(run.chatSessionId)
      if(actual.activeSubagentToolUseIds.length)
        throw new WorkflowError('workspace-busy','Native background work is still active')
      if(!focused && actual.nativeSessionId && actual.nativeSessionId!==previous.nativeSessionId)
        throw new WorkflowError('conversation-changed','Native conversation differs from the saved turn; reconcile actual history before continuing')
      // Disk history is required even if a worker still has a Chat in memory.
      // Missing/corrupt history must not silently start a new conversation.
      try {
        const history=await readSessionTranscriptFactsFromDisk(run.chatSessionId,run.workspacePath)
        if(!focused && previous.nativeSessionId && !history.length)
          throw new Error('Saved project Chat history is empty')
        const baseline=previous.notStarted
          ? run.agentTurns.slice(0,-1).findLast(t=>!t.notStarted && t.nativeSessionId===previous.nativeSessionId) : previous
        if(!focused && previous.nativeSessionId && (!baseline ||
            !history.some(e=>(e.type==='user.message' ||
              (baseline.production && !baseline.message || baseline.message?.intent==='continue' &&
                !baseline.message.text && !baseline.message.attachmentDigests?.length) &&
              e.type==='turn.started' && e.payload?.messageOrigin==='workflow') && (!baseline.turnId || e.turnId===baseline.turnId))))
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
      if(message?.intent==='continue' && previous?.status==='ended' && previous.productionHandoff) {
        verifyProductionHandoff(run.workspacePath,previous.productionHandoff)
      }
      if(message?.intent==='continue' && (message.continuationOf!==previous.attemptId ||
          !['interrupted','failed'].includes(previous.status) && !(previous.status==='ended' && (previous.productionHandoff?.next || !previous.productionHandoff && previous.production && previous.production.stage!=='implementation'))))
        throw new WorkflowError('invalid-continuation','Continuation must address the latest interrupted or failed native turn',400)
    }
    const next=structuredClone(run);next.version++;next.fence++;next.status='running'
    if(message?.intent==='change') {
      const original=run.requirementChanges?.[0]?.before ?? run.requirements
      const allMessages=[...run.agentTurns.flatMap(t=>t.message ? [t.message]:[]),message]
      const {user_messages:_historicalConversation,...brief}=JSON.parse(original.text)
      const text=JSON.stringify({...brief,
        authorized_user_changes:allMessages.filter(m=>m.intent==='change').map(m=>({requestKey:m.requestKey,text:m.text})),
      })
      next.requirements={...run.requirements,revision:randomUUID(),text,
        sha256:digest(JSON.stringify({text,constraints:run.requirements.constraints,ids:run.requirements.ids}))}
      next.requirementChanges=[...(run.requirementChanges ?? []),{requestKey,actorId:run.ownerId,
        at:new Date().toISOString(),before:run.requirements,after:next.requirements}]
      // Only an explicit change revises the confirmed brief. Ordinary requests
      // remain in immutable turn messages; actual input changes stale evidence.
      next.planRevision++;next.deliveryEligible=false
    }
    const projectInputs=message && (production?.stage==='visual' || production?.stage==='resources')
      ? message.intent==='continue' && previous?.projectInputs && sameJson(previous.production,production)
        ? previous.projectInputs
        : await snapshotProjectInputs(run.workspacePath)
      : undefined
    const turn:AgentTurn={...(projectInputs?{projectInputs}:{}),...(production?{production}:{}),nativeRuntime:'bgs',attemptId:randomUUID(),requestKey,sessionId:run.chatSessionId,
      workerId,fence:next.fence,status:'running',startedAt:new Date().toISOString(),
      requirementsRevision:next.requirements.revision,...(message?{message}:{})}
    next.agentTurns!.push(turn);next.writer={attemptId:turn.attemptId,fence:turn.fence,workerId}
    // Preserve message/source identity with its writer; explicit requirement
    // changes alone append a requirement snapshot through the existing RPC.
    try {await input.store.commit(run.projectId,run.ownerId,run.version,next,
      message?.intent==='change'?'requirements.changed':'agent.turn-claimed')}
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
    continueProduction:(run: Run, afterAttemptId: string, options: AgentExecutionOptions)=>{
      const previous = run.agentTurns!.at(-1)
      const assignment = previous?.productionHandoff ? previous.productionHandoff.next
        : previous?.production?.stage !== 'implementation' ? previous?.production : undefined
      if(!assignment)throw new WorkflowError('invalid-continuation','No pending production stage')
      return dispatch(run,options,undefined,{after:afterAttemptId,assignment})
    },
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
