import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { readSessionTranscriptFromDisk, type BeeGameSessionManager, type StartBeeGameSessionInput } from '../session-manager'
import { pauseRun, digest, WorkflowError, type Run, type AgentTurn, type AgentMessage } from './state'
import { sameJson, type WorkflowStore } from './store'
import { skillEvidence } from './context'
import { openAgentTools, type AgentPreviewAccess, type AgentImageAccess } from './agent-tools'
import { createAgentMeasurement } from './agent-measurement'
import { inspectAgentMeasurementInputs } from './measured-build'

type AgentExecutionOptions = Partial<StartBeeGameSessionInput> & {
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
  intent:z.enum(['discuss','change','continue']),text:z.string().trim().min(1),
  continuationOf:z.string().min(1).optional(),
}).strict().refine(value=>value.intent==='continue' ? Boolean(value.continuationOf) : value.continuationOf===undefined,
  {message:'Only explicit continuation requires continuationOf'})

// One responsibility definition for native production and follow-ups, not a
// second plan or a host document gate. Skills supply methods, not ownership.
export const agentProfessionalContext = [
  'Professional coverage: gameplay, technology, art, audio, UI/UX, levels/scenes, numbers/balance and resources. New design records belong together under docs/: GDD.md, TECHNICAL_DESIGN.md, ART_DIRECTION.md, AUDIO_DESIGN.md, UI_UX_SPEC.md, LEVEL_SCENE_DESIGN.md, BALANCE_DESIGN.md and ASSET_PLAN.md. Domain labels are not directories. These are default design records, not stages or eight separate assignments. Simple projects may use explicitly mapped merged records; retain all domains. Preserve existing paths/references on continuation; do not migrate unrelated work. No economy or external images does not remove numerical or resource planning.',
  'Decide order, prototypes, delegation and tools from actual dependencies; do not wait for all eight drafts. Before related professional work or review, invoke the relevant available Skills through the native Skill tool; reuse methods already loaded, not the whole catalog. Report unavailable methods honestly. Record concrete decisions, reasons, current source paths and unresolved assumptions so implementation and later edits need not guess. Keep a single source for runtime values/bindings, not duplicate tables. Update only changed records and their versions; group related edits and reuse valid checks.',
  'For new BGS Web games, deliver editable content/scenes/*.json and content/ui/*.json with the existing content/index.json registry unless the user explicitly excludes BGS visual editing. React/Canvas does not waive this delivery; the actual runtime must consume the saved data, not a second hardcoded layout. Use existing schema/layout tools and verify saved-data changes in the real build. Unity/Godot use native scene/UI data, not duplicate Web JSON. Do not silently convert an existing source-only project; disclose the delivery gap and obtain migration authorization.',
  'Art/UI decisions must guide composition, visual hierarchy, key objects and screen/state feedback; check a representative real game view and interaction against that direction. Choose library, generated or procedural resources from the required appearance/sound and confirmed resource policy, not tool absence alone. Missing services are not empty catalogs or permission to lower quality. Distinguish placeholders from final assets and record actual sources, bindings and limitations; resource acquisition or image generation alone is not quality.',
  'Trace original requirements to design and the actual runtime: playable rules/challenge, visual direction/readability, UI and action/state feedback, audio behavior, level flow, numerical pacing and resource use. Check deterministic facts with tools and experience with actual observations. Build success, eight files or reviewer PASS cannot prove quality; missing viewing/listening/play evidence stays unverified. Review real dependencies, fix material findings, and recheck affected results; optional polish does not automatically reopen work. Handoff source/evidence paths, tested version and limitations, not repeated documents.',
  'Use scoped source/test batches rather than recursive project/history searches or repeated tiny handoff edits; the current tools expose batch source snapshots and exact saved Scene points. Choose focused delegation when it avoids carrying unrelated history; BGS does not reset the conversation or choose your agents. Finish all report-writing verification and affected revisions before final measurement. Rerunnable tests must save new runs separately from retained evidence; do not overwrite a measured report to verify it. Measurement itself builds the source copy; a separate build immediately before it is needed only for a distinct check, not to read a receipt.',
].join('\n')

export function agentMessagePrompt(message: AgentMessage, edits: NonNullable<Run['sourceEdits']> = []): string {
  const context = message.intent==='discuss' ?
    'Discuss the user’s question in this existing project. This message does not authorize changes or execution; answer only. Ask for authorization if changes are needed.' :
    message.intent==='change' ?
      'This is an explicitly authorized requirement change in the existing project, not a restart of the original goal. Read current affected sources, update their actual authority and consumers, preserve unrelated work, and rebuild/retest changed results. Earlier checks do not accept the changed version. Latest explicit user changes supersede conflicting original choices; ask when a material choice is missing.' :
      'The user explicitly authorizes continuing the interrupted work below in this same project and native conversation. Inspect saved partial results and actual external outcomes first. Do not blindly replay commands or unknown paid operations, resend the original goal, or redo unrelated work. Recheck affected results; partial work and old checks are not acceptance.'
  return [context, ...(message.intent==='discuss' ? [] : [
    'For this follow-up, apply the professional responsibilities to only affected domains and dependencies; preserve unrelated results, not a new eight-document production run.',
  ]), ...(edits.length ? ['User-authorized source saves since the preceding native turn (not acceptance; inspect current files):\n'+
    JSON.stringify([...new Map(edits.map(e=>[e.sourceEdit.path,{path:e.sourceEdit.path,status:e.sourceEdit.status}])).values()])] : []),
    'User message:\n'+message.text].join('\n\n')
}
export function agentGoalPrompt(run: Run): string {
  return [
    'Develop the game from this complete confirmed goal in the current project. Plan and execute autonomously; do not wait for BGS milestones or a host Task plan.',
    'Preserve explicit user choices. Ask the user when a material choice or authorization is missing. Do not claim unperformed checks or game acceptance.',
    'Confirmed goal:\n'+run.requirements.text,
  ].join('\n\n')
}

/** Final host receipt is computed after owned work stops. No model summary,
 * report rewrite or retry; semantic quality is still not certified. */
export async function agentTurnHandoffReason(run: Run, turn: AgentTurn) {
  const record=turn.measurements?.at(-1)
  if(!record)return 'Native goal turn ended; game delivery and target-runtime evidence remain unverified.'
  try {
    const freshness=await inspectAgentMeasurementInputs(run,record)
    return freshness.current ? 'Native goal turn ended; measured inputs are current. Game-quality acceptance remains unverified.' :
      'Native goal turn ended; '+freshness.code+': '+freshness.reason
  } catch(error) {
    return 'Native goal turn ended; measurement freshness could not be verified'+
      (error instanceof WorkflowError ? ': '+error.message : '. Inspect current project inputs; no automatic retry.')
  }
}

/** Native owns planning/tools/delegation; existing CAS store owns the writer.
 * No automatic model retries or stage advancement. */
export function createAgentGoalExecutor(input: { store: WorkflowStore; sessions: BeeGameSessionManager; resourceLibraryBaseUrl?: string }) {
  const workerId = randomUUID(), active = new Map<string,string>(), pending = new Set<Promise<void>>()
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
        failed ?? await agentTurnHandoffReason(current,saved)
      try { await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.turn-settled');return next }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
    throw new WorkflowError('revision-conflict','Native goal settlement changed concurrently')
  }
  async function execute(run: Run, turn: AgentTurn, options: AgentExecutionOptions) {
    let failed: string | undefined, turnId: string | undefined
    let tools: Awaited<ReturnType<typeof openAgentTools>> | undefined
    let preview: AgentPreviewAccess | undefined
    let image: AgentImageAccess | undefined
    const measurement = createAgentMeasurement({run,turn,store:input.store})
    try {
      if (disposing || (await read(run)).paused) throw new Error('Worker stopped or user paused before dispatch')
      const previous=run.agentTurns!.filter(t=>t.attemptId!==turn.attemptId).at(-1)
      if(turn.message && input.sessions.get(turn.sessionId)?.status==='running') {
        // A restored idle Chat may lack its runtime snapshot. start() otherwise
        // reuses it and ignores resumeNativeSessionId, silently losing history.
        input.sessions.stop(turn.sessionId,'agent_message_resume')
        await input.sessions.waitForSessionIdle(turn.sessionId)
      }
      const session = input.sessions.start({ workspacePath:run.workspacePath, projectId:run.projectId, userId:run.ownerId,
        transcriptSessionId:run.chatSessionId, modelConfigId:options.modelConfigId, language:options.language,
        userDataRoot:options.userDataRoot,
        ...(turn.message && previous?.nativeSessionId ? {resumeNativeSessionId:previous.nativeSessionId}:{}),
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken })
      if (session.id!==run.chatSessionId) throw new Error('Native goal must use the bound project conversation')
      await input.sessions.sendWithDisplay(session.id, turn.message ? agentMessagePrompt(turn.message,
        run.sourceEdits?.filter(e=>e.fence>(run.agentTurns?.at(-2)?.fence??0))) : agentGoalPrompt(run), {
        displayKind:turn.message ? 'workflow_v3_'+turn.message.intent : 'workflow_v3_goal',
        displayText:turn.message?.text ?? run.requirements.text,
        confirmedBriefContext:run.requirements.text,
        authToken:options.authToken, getValidAuthToken:options.getValidAuthToken, language:options.language,
        onTurnAccepted:id=>{turnId=id},
        // Stable responsibilities belong to the existing system-context slot,
        // not another full copy in each resumed user message/history entry.
        // Discussion explicitly clears production context and opens no tools.
        prepareTurn:turn.message?.intent==='discuss' ? async ()=>({systemContext:undefined}) : async ()=>{
          tools=await openAgentTools({ workspacePath:run.workspacePath,
            sessionId:session.id,openPreview:options.openPreview ? async ()=>preview=await options.openPreview!() : undefined,
            libraryBaseUrl:input.resourceLibraryBaseUrl,
            getAuthToken:()=>options.getValidAuthToken?.() ?? options.authToken, measurement,
            openImage:options.openImage ? async ()=>image=await options.openImage!() : undefined })
          return {...tools,systemContext:agentProfessionalContext}
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
    for (let i=0;i<2;i++) {
      const current=await read(run)
      if (!sameWriter(current,turn)) throw new WorkflowError('stale-attempt','Native goal writer changed')
      const next=structuredClone(current), result=next.agentTurns!.find(t=>t.attemptId===turn.attemptId)!
      const snapshot=input.sessions.runtimeSnapshot(turn.sessionId)
      result.turnId=turnId; result.nativeSessionId=snapshot.nativeSessionId
      result.usage=turnId && snapshot.turnDiagnostics?.turnId===turnId ? snapshot.turnDiagnostics.usage : undefined
      result.skillUses=skillEvidence(input.sessions.transcript(turn.sessionId).filter(e=>e.turnId===turnId))
      result.quiescedAt=new Date().toISOString(); next.version++
      try { await input.store.commit(run.projectId,run.ownerId,current.version,next,'agent.writer-quiesced');break }
      catch(error) { if (!(error instanceof WorkflowError) || error.code!=='revision-conflict' || i===1) throw error }
    }
    await settle(run,turn,failed)
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
      if(!previous?.quiescedAt || !previous.nativeSessionId)
        throw new WorkflowError('conversation-unavailable','No saved native conversation/exit evidence; do not restart the original goal')
      const actual=input.sessions.runtimeSnapshot(run.chatSessionId)
      if(actual.activeSubagentToolUseIds.length)
        throw new WorkflowError('workspace-busy','Native background work is still active')
      if(actual.nativeSessionId && actual.nativeSessionId!==previous.nativeSessionId)
        throw new WorkflowError('conversation-changed','Native conversation differs from the saved turn; reconcile actual history before continuing')
      // Disk history is required even if a worker still has a Chat in memory.
      // Missing/corrupt history must not silently start a new conversation.
      try {
        const history=await readSessionTranscriptFromDisk(run.chatSessionId,run.workspacePath)
        if(!history.some(e=>e.type==='user.message' && (!previous.turnId || e.turnId===previous.turnId)) ||
            history.some(e=>e.sessionId && e.sessionId!==run.chatSessionId))
          throw new Error('Saved conversation does not cover the previous native turn')
      }
      catch { throw new WorkflowError('conversation-unavailable','Saved project conversation is unavailable; restore it before continuing',503) }
      if(message.intent==='continue' && (message.continuationOf!==previous.attemptId ||
          !['interrupted','failed'].includes(previous.status)))
        throw new WorkflowError('invalid-continuation','Continuation must address the latest interrupted or failed native turn',400)
    }
    const next=structuredClone(run);next.version++;next.fence++;next.status='running'
    if(message?.intent==='change') {
      const original=run.requirementChanges?.[0]?.before ?? run.requirements
      const text=JSON.stringify({...JSON.parse(original.text),authorized_user_changes:[
        ...run.agentTurns.flatMap(t=>t.message?.intent==='change' ? [{requestKey:t.requestKey,text:t.message.text}]:[]),
        {requestKey,text:message.text},
      ]})
      next.requirements={...run.requirements,revision:randomUUID(),text,
        sha256:digest(JSON.stringify({text,constraints:run.requirements.constraints,ids:run.requirements.ids}))}
      next.requirementChanges=[...(run.requirementChanges ?? []),{requestKey,actorId:run.ownerId,
        at:new Date().toISOString(),before:run.requirements,after:next.requirements}]
      // Existing persisted revision counter only; no Task plan is generated.
      next.planRevision++;next.deliveryEligible=false
    }
    const turn:AgentTurn={attemptId:randomUUID(),requestKey,sessionId:run.chatSessionId,
      workerId,fence:next.fence,status:'running',startedAt:new Date().toISOString(),
      requirementsRevision:next.requirements.revision,...(message?{message}:{})}
    next.agentTurns!.push(turn);next.writer={attemptId:turn.attemptId,fence:turn.fence,workerId}
    // Change + writer + request identity are one CAS, using the existing RPC.
    await input.store.commit(run.projectId,run.ownerId,run.version,next,message?.intent==='change'?'requirements.changed':'agent.turn-claimed')
    active.set(turn.attemptId,turn.sessionId)
    const work=execute(next,turn,options).finally(()=>{pending.delete(work);active.delete(turn.attemptId)})
    pending.add(work);void work.catch(error=>console.error('[BGS V3] Native goal settlement incomplete', {
      attemptId:turn.attemptId,code:error instanceof WorkflowError?error.code:'settlement-error',
    }))
    return turn
  }
  return {
    writerLiveness(run: Run) { return !run.writer ? 'none' : active.has(run.writer.attemptId)?'local-active':'unknown' },
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
      const current=await read(run),turn=current.agentTurns?.find(t=>t.attemptId===identity.attemptId)
      if(current.version!==identity.expectedVersion) throw new WorkflowError('revision-conflict','Read current Run before recovery')
      if(!turn || !sameWriter(current,turn) || turn.fence!==identity.fence) throw new WorkflowError('stale-attempt','Recovery does not address current writer')
      if(active.has(turn.attemptId) || input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath))
        throw new WorkflowError('workspace-busy','Writer is still active')
      if(!turn.quiescedAt) throw new WorkflowError('writer-unresolved','No durable native exit evidence; missing session or elapsed time cannot unlock writer')
      return settle(current,turn,'Recovered interrupted settlement; outputs and external outcomes remain unverified',true)
    },
    async dispose() {
      disposing=true
      for(const sessionId of active.values())
        if(input.sessions.get(sessionId)?.status==='running') input.sessions.stop(sessionId,'service_shutdown')
      await Promise.allSettled([...pending])
    },
  }
}
