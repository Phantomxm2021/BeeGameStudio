import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { readSessionTranscriptFromDisk, type BeeGameAttachment, type BeeGameSessionManager, type StartBeeGameSessionInput } from '../session-manager'
import { pauseRun, digest, isInitialSliceTurn, WorkflowError, type Run, type AgentTurn, type AgentMessage } from './state'
import { sameJson, type WorkflowStore } from './store'
import { skillEvidence } from './context'
import { openAgentTools, type AgentPreviewAccess, type AgentImageAccess } from './agent-tools'
import { createAgentMeasurement, AGENT_CONSUMPTION_CHECKS } from './agent-measurement'
import { blockingRegisteredContentChecks, inspectAgentMeasurementInputs } from './measured-build'
import { readProjectGuide, projectGuideContext, PROJECT_WORKING_CONVENTIONS } from './project-guide'
import { saveHostExitReceipt, type HostExitReceipts, type HostExitFacts } from './host-exit-receipt'
import { requiresBgsEditableContent } from './web-project-start'
import { inspectDesignAcceptance } from '../runtime-acceptance'
import { DESIGN_ACCEPTANCE_PATH } from '../design-handoff'

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

// Business data and authorization contracts only. Execution methods stay in Skills.
const professionalContextParagraphs = [
  'Preserve the user-selected engine and platform in bgsConfirmedBrief.settings. Choose architecture, entry points, source organization, build and verification methods in TECHNICAL_DESIGN.md. Consume applicable editable content in the actual runtime, without a second hardcoded layout. BGS Editor reads BGS Scene/UI JSON; Unity/Godot/Unreal retain native data and have no BGS native-editing adapter. Report an unmet BGS Editor requirement instead of switching engines or duplicating native content into Web JSON. Maintain resources and bindings together.',
  'Honor explicit resource sources and usage rights; AI is not the default for all core art. Obtain the actual read-only quote before authorized generation; respect exclusions and the project budget, including model work. Only disclosed charges are authorized; no redundant per-image approval, unknown paid replay or automatic paid retry. Procedural replacement of required art needs a concrete blocker and authorization; placeholders cannot replace final art. A temporary stop creates no permanent asset prohibition.',
  'Keep editable sources separate from publication output and retain required licenses.',
]
const firstVersionDeliveryContext = 'Deliver the confirmed scope using the design dependencies and professional methods in the project guide; design records live under docs/.'
const editableWebDeliveryContext = 'This project requires BGS visual editing: content/scenes/*.json and content/ui/*.json are editable data consumed by the confirmed engine, not a separate engine or required game scaffold. Register Scene/UI documents in content/index.json and resources in assets/asset-manifest.json. Scene data holds editable world layout and object/resource bindings; UI-only games without a world scene need no empty Scene. Canvas rendering or a single screen does not imply UI-only. Dynamic simulation state and game logic belong in code. The optional browser consumer supports a subset of this data; project code implements the remaining behavior.'
export const agentProfessionalContext = [PROJECT_WORKING_CONVENTIONS, ...professionalContextParagraphs, firstVersionDeliveryContext].join('\n')
// Native execution reads production guidance from the saved project guide once.
export const agentProfessionalContextForRun = (run: Pick<Run, 'visualHandoffVersion'> & Partial<Pick<Run, 'creation' | 'requirements'>>, followup = false) => [
  ...professionalContextParagraphs,
  ...(!followup && run.creation?.initialDelivery === 'design-led-first-version' ? [firstVersionDeliveryContext] : []),
  ...(requiresBgsEditableContent(run) ? [editableWebDeliveryContext] : []),
].join('\n')
export function agentMessagePrompt(message: AgentMessage, edits: NonNullable<Run['sourceEdits']> = []): string {
  return [...(message.intent==='discuss' ? ['This request authorizes discussion only, without changes or execution.'] : []),
    ...(edits.length ? ['User-authorized source saves since the preceding native turn:\n'+
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
    'This first assignment delivers one small, complete player experience for user playtesting, not the full game. Reduced content quantity does not waive the required design dependencies. Keep the complete confirmed goal unchanged for subsequent work.',
    'Reduce content quantity, not the controls, readability or audiovisual feedback needed to judge the chosen experience. Preserve confirmed core rules; a proposed rule change is not authorization to implement it. Record the experience focus and deferred content in the existing concise design record, implement and run it, and make the actual preview available. Retain observations and unresolved experience questions in that same record, then end this turn for user feedback. Do not expand the full content set in this assignment or claim game acceptance.',
    'Use the complete confirmed goal in bgsConfirmedBrief; its full scope is retained, not all due in this first assignment.',
  ].join('\n\n')
  return [
    'Complete the current user assignment in this project. Select relevant Skills, organize the work and self-check the requested deliverables. Respect the production dependencies for work in scope; do not infer additional deliverables from the project creation mode. Stop at the requested boundary.',
    'Use the complete confirmed goal supplied in bgsConfirmedBrief.',
  ].join('\n\n')
}

/** Literal saved inputs, not an LLM summary or replay of prior operations.
 * Assistant-only assumptions are deliberately not claimed as retained. */
export function focusedExecutionFacts(run: Run, events: Awaited<ReturnType<typeof readSessionTranscriptFromDisk>>) {
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
    // requests are execution history. Discussion may hold otherwise unsaved choices.
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
  // A follow-up need not build again merely to carry forward an unchanged
  // receipt. Inspect the newest actual record, including failed/pending ones.
  const record=run.agentTurns?.flatMap(t=>t.measurements??[]).at(-1)
  let acceptanceNote = ''
  if (record?.reportPaths.includes(DESIGN_ACCEPTANCE_PATH)) {
    const acceptance = await inspectDesignAcceptance(run.workspacePath,true,requiresBgsEditableContent(run),
      {runId:run.id,requirementsRevision:run.requirements.revision})
    const counts = ['passed','failed','unverified'].map(status =>
      status + '=' + acceptance.requirementChecks.filter(check=>check.status===status).length).join(', ')
    acceptanceNote = ' Runtime report: ' + (acceptance.valid ? 'reported checks/version/evidence validated; ' : acceptance.summary + ' ') + counts +
      '. Observation truth and visual/game quality are not host-certified.'
  }
  if(!record)return 'Native goal turn ended; execution completion is not acceptance. See saved files for the requested deliverables and unresolved work. No target-runtime measurement was recorded.'
  try {
    const freshness=await inspectAgentMeasurementInputs(run,record)
    const invalid=blockingRegisteredContentChecks(record)
    return (freshness.current && invalid.length ? 'Native goal turn ended; registered Scene/UI checks need repair before delivery: '+
      invalid.map(check=>check.id+' '+check.status).join(', ')+'. Inspect saved measurement findings; game-quality acceptance remains unverified.' :
      freshness.current ? 'Native goal turn ended; measured inputs are current. Game-quality acceptance remains unverified.' :
      'Native goal turn ended; '+freshness.code+': '+freshness.reason) + acceptanceNote
  } catch(error) {
    return 'Native goal turn ended; measurement freshness could not be verified'+
      (error instanceof WorkflowError ? ': '+error.message : '. Inspect current project inputs; no automatic retry.') + acceptanceNote
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
    if(active.has(turn.attemptId))return {evidence:'unavailable',code:'execution-active'}
    if(!input.exitReceipts)return {evidence:'unavailable',code:'exit-receipts-not-configured'}
    try {
      if(await input.exitReceipts.read(run))return {evidence:'host-receipt',code:'exit-receipt'}
      const code=await input.exitReceipts.rebootEvidence?.(run) ?? 'ownership-missing'
      return {evidence:code==='host-reboot'?'host-reboot':'unavailable',code}
    } catch(error) {
      return {evidence:'unavailable',code:error instanceof WorkflowError?error.code:'exit-evidence-read-failed'}
    }
  }
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
      next.blockedReason = (current.paused ? 'User paused; no automatic retry.' :
        failed ?? ((isInitialSliceTurn(current,result)
          ? 'Initial playable-slice turn ended; inspect the actual preview and give feedback before expanding content. This is not full-game completion. ' : '') +
          await agentTurnHandoffReason(current,saved)))
      try {
        await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.turn-settled')
        observedExits.delete(turn.attemptId)
        const measured = result.measurements?.at(-1)
        input.sessions.recordHostEvidence(run.chatSessionId, {attemptId:turn.attemptId,turnId:result.turnId,
          execution:result.status,measurementId:measured?.id,checkStatuses:measured?.checks.map(({id,status})=>({id,status})) ?? [],
          unmeasured:measured ? ['build','runtime-smoke',...AGENT_CONSUMPTION_CHECKS].filter(id=>!measured.checks.some(check=>check.id===id)) : [],
          note:next.blockedReason,designFileChanges:result.designFileChanges})
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
      skillUses:()=>turnId ? skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)) : [],
      onDesignLocked:()=>input.sessions.setProjectDesignLocked(run.chatSessionId,true)})
    try {
      if (disposing || (await read(run)).paused) throw new Error('Worker stopped or user paused before dispatch')
      const previous=run.agentTurns!.filter(t=>t.attemptId!==turn.attemptId).at(-1)
      const focused=turn.message?.contextMode==='focused' || Boolean(previous?.nativeSessionId && previous.nativeRuntime !== 'bgs')
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
        ...(focused ? {freshNativeContext:true} : turn.message && previous?.nativeRuntime === 'bgs' && previous.nativeSessionId ? {resumeNativeSessionId:previous.nativeSessionId}:{}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken,
        workflowQuestionGuard: async (request, decision) => {
          const current = await read(run)
          if (!sameWriter(current,turn) || current.paused)
            throw new WorkflowError('stale-attempt','This question no longer belongs to the active project turn')
          if (decision?.intent === 'change') {
            await measurement.authorizeDesignChange(request.toolUseID)
            input.sessions.setProjectDesignLocked(run.chatSessionId,false)
          }
          return {runId:run.id,attemptId:turn.attemptId,designChangeAllowed:Boolean(current.designBaseline)}
        } })
      if (session.id!==run.chatSessionId) throw new Error('Native goal must use the bound project conversation')
      input.sessions.setProjectDesignLocked(session.id,Boolean(run.designBaseline))
      const prompt = turn.message ? agentMessagePrompt(turn.message,
        run.sourceEdits?.filter(e=>e.fence>(run.agentTurns?.at(-2)?.fence??0))) : agentGoalPrompt(run)
      await input.sessions.sendWithDisplay(session.id, prompt, {
        displayKind:turn.message ? 'workflow_v3_'+turn.message.intent : 'workflow_v3_goal',
        displayText:turn.message?.text ?? agentGoalDisplayText(run),
        attachments:options.attachments,
        clientMessageId:turn.message?.requestKey,
        executionIdentity:{attemptId:turn.attemptId,workerId:turn.workerId,fence:turn.fence},
        confirmedBriefContext:run.requirements.text,
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken, language:options.language,
        onTurnAccepted:id=>{
          turnId=id
          const local=active.get(turn.attemptId)
          if(local?.runId===run.id)local.turnId=id
        },
        // The BGS adapter delivers this context through turn/start's application
        // slot, so resumed threads receive current capabilities and host facts.
        // Project conventions/navigation are one current file snapshot, including
        // discussion; production capabilities stay scoped to authorized work.
        prepareTurn:async ()=>{
          const savedGuide=await readProjectGuide(run.workspacePath)
          const guide=projectGuideContext(savedGuide)
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
          if(turn.message?.intent==='discuss')return {systemContext:guide,...(confirmedChanges?{turnContext:confirmedChanges}: {})}
          tools=await openAgentTools({ workspacePath:run.workspacePath, constraints:run.requirements.constraints,
            requireEditableContent:requiresBgsEditableContent(run),
            sessionId:session.id,openPreview:options.openPreview ? async ()=>preview=await options.openPreview!() : undefined,
            libraryBaseUrl:input.resourceLibraryBaseUrl,
            getAuthToken:()=>options.getValidAuthToken?.() ?? options.authToken, measurement,
            openImage:options.openImage ? async ()=>image=await options.openImage!() : undefined })
          // Supply current host facts with the task, not solely through a
          // discovery command that the model may filter or never call. This
          // reads inputs once; it does not build, review or rewrite history.
          const evidence=await measurement.context()
          return {...tools,turnContext:confirmedChanges,
            systemContext:agentProfessionalContextForRun(run,Boolean(turn.message))+'\n\n'+guide+'\n\n'+tools.systemContext+
              '\n'+tools.turnContext+'\nBGS saved evidence (not game acceptance): '+JSON.stringify(evidence)}
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
    observedExits.set(turn.attemptId,{runId:run.id,facts:{turnId,nativeRuntime:'bgs',nativeSessionId:snapshot.nativeSessionId,
      usage:turnId && snapshot.turnDiagnostics?.turnId===turnId ? snapshot.turnDiagnostics.usage : undefined,
      skillUses:skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId)),
      designFileChanges:measurement.designFileChanges(),quiescedAt:new Date().toISOString()}})
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
    // Only the explicit change route grants replanning. A question, ordinary
    // work or interrupted continuation does not release the design authority.
    if (message?.intent === 'change') delete next.designBaseline
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
    const turn:AgentTurn={nativeRuntime:'bgs',attemptId:randomUUID(),requestKey,sessionId:run.chatSessionId,
      workerId,fence:next.fence,status:'running',startedAt:new Date().toISOString(),
      requirementsRevision:next.requirements.revision,...(message?{message}:{})}
    next.agentTurns!.push(turn);next.writer={attemptId:turn.attemptId,fence:turn.fence,workerId}
    // Record the original host/boot before CAS and before any native work.
    // An unclaimed record is harmless; a failed record cannot launch paid work.
    await input.exitReceipts?.claim?.(next)
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
      if(!current.writer && turn?.fence===identity.fence && turn.quiescedAt && turn.status!=='running' && identity.expectedVersion<=current.version)
        return current // Lost HTTP acknowledgement never dispatches or repeats settlement.
      if(current.version!==identity.expectedVersion) throw new WorkflowError('revision-conflict','Read current Run before recovery')
      if(!turn || !sameWriter(current,turn) || turn.fence!==identity.fence) throw new WorkflowError('stale-attempt','Recovery does not address current writer')
      if(active.has(turn.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
        throw new WorkflowError('workspace-busy','Writer is still active')
      if(!turn.quiescedAt) {
        const original=turn.workerId===workerId && observedExits.get(turn.attemptId)?.runId===current.id
        let receipt=original?undefined:await input.exitReceipts?.read(current)
        if(!original && !receipt && await input.exitReceipts?.rebootEvidence?.(current)==='host-reboot') {
          // The recorded boot ended on this same machine: all its local
          // processes are gone, including detached shells. This establishes
          // local quiescence only, not external success, usage or acceptance.
          const snapshot=input.sessions.runtimeSnapshot(current.chatSessionId)
          const binding=snapshot.executionIdentity
          const submitted=snapshot.workspacePath===current.workspacePath && snapshot.sessionId===current.chatSessionId &&
            binding?.attemptId===turn.attemptId && binding.workerId===turn.workerId && binding.fence===turn.fence && binding.nativeSubmitted===true
          receipt={quiescedAt:new Date().toISOString(),
            ...(submitted && snapshot.nativeSessionId ? {nativeSessionId:snapshot.nativeSessionId,turnId:binding.turnId}:{})}
          await input.exitReceipts!.save(current,receipt)
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
