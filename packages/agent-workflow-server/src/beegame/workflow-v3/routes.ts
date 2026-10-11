import type { Hono } from 'hono'
import { realpath } from 'node:fs/promises'
import { z } from 'zod/v4'
import type { BeeGameUserContext } from '../../auth/user-context'
import { hasBeeGamePermission } from '../../auth/user-context'
import type { BeeGameProjectMetadata } from '../../project-metadata-store'
import { readSessionTranscriptFromDisk, type BeeGameSessionManager } from '../session-manager'
import { createV3Executor } from './execution'
import { createRun, digest, publishPlan, WorkflowError, type Run, type Attempt } from './state'
import { sameJson, type WorkflowStore } from './store'
import { sourceIndex } from './context'
import { staleTaskIds } from './checks'
import { validateRepairPlans } from './review'
import { readContentView } from './content-view'
import type { MeasuredPreviewManager } from './measured-preview'
import { exportMeasuredBuild, exportAgentMeasuredBuild, selectAgentMeasuredBuild } from './measured-build'
import { measurementSummary } from './agent-measurement'
import { recordPreviewIssue, prepareIssueReview, prepareReviewedRepair } from './preview-issues'
import { changeRequirements, contentOwners } from './changes'
import { agentGoalSchema, agentMessageSchema, createAgentGoalExecutor } from './agent-goal'
import type { AgentPreviewAccess, AgentImageAccess } from './agent-tools'

const startSchema = z.object({ requestKey: z.string().min(1), chatSessionId: z.string().min(1),
  requirements: z.object({ text: z.string().trim().min(1), constraints: z.record(z.string(), z.unknown()), ids: z.array(z.string()).min(1) }).strict(),
}).strict()
export function registerV3Routes(app: Hono, input: {
  store?: WorkflowStore; sessions: BeeGameSessionManager; preview?: MeasuredPreviewManager;
  getUser(request: Request): BeeGameUserContext;
  getProject(request: Request, user: BeeGameUserContext, projectId: string): Promise<BeeGameProjectMetadata | undefined>;
  getAuthToken(request: Request): string | undefined;
  getValidAuthToken(request: Request): ((o?: { forceRefresh?: boolean }) => Promise<string | undefined>) | undefined;
  getUserDataRoot?(request: Request): string;
  assertNoLegacyRun(workspace: string): Promise<void>;
  persistMode(request: Request, user: BeeGameUserContext, project: BeeGameProjectMetadata, run: Run): Promise<void>;
  readBody(request: Request): Promise<unknown>;
  registerCleanup?: (fn: () => Promise<void>) => void;
  resourceLibraryBaseUrl?: string;
  openAgentPreview?: (value: {request: Request; user: BeeGameUserContext; workspacePath: string; sessionId: string}) => AgentPreviewAccess | Promise<AgentPreviewAccess>;
  openAgentImage?: (value: {user: BeeGameUserContext; projectId: string; workspacePath: string}) => AgentImageAccess | Promise<AgentImageAccess>;
}) {
  const executor = input.store ? createV3Executor({ store: input.store, sessions: input.sessions }) : undefined
  const agentExecutor = input.store ? createAgentGoalExecutor({ store: input.store, sessions: input.sessions,
    resourceLibraryBaseUrl:input.resourceLibraryBaseUrl }) : undefined
  input.registerCleanup?.(async () => { await Promise.all([executor?.dispose(),agentExecutor?.dispose()]) })
  const prefix = '/api/projects/:id/workflow-v3'
  async function context(request: Request, projectId: string, mutate: boolean) {
    const user = input.getUser(request)
    if (!hasBeeGamePermission(user, mutate ? 'agent.send_message' : 'project.read')) throw new WorkflowError('permission-denied', 'Project permission denied', 403)
    const project = await input.getProject(request, user, projectId)
    if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
    if (!input.store || !executor) throw new WorkflowError('workflow-unavailable', 'V3 store is not configured. Configure the migrated database, or explicitly select single-process development storage.', 503)
    return { user, project, store: input.store, workspace: await realpath(project.root_path), executor, agentExecutor:agentExecutor! }
  }
  const routeError = (error: unknown) => error instanceof WorkflowError ? { error: error.message, code: error.code, status: error.status } :
    error instanceof z.ZodError ? { error: JSON.stringify(error.issues), code: 'invalid-request', status: 400 as const } :
      error instanceof SyntaxError ? { error: 'Invalid JSON request', code: 'invalid-request', status: 400 as const } :
      { error: 'V3 operation failed; no automatic retry.', code: 'workflow-operation-failed', status: 500 as const }
  async function current(request: Request, projectId: string, mutate: boolean, allowAgent = false) {
    const contextValue = await context(request, projectId, mutate), run = await contextValue.store.read(projectId, contextValue.user.id)
    if (!run) throw new WorkflowError('run-not-found', 'V3 run not found', 404)
    if (run.workspacePath !== contextValue.workspace) throw new WorkflowError('workspace-changed', 'Run workspace binding changed')
    if (mutate && run.agentTurns && !allowAgent) throw new WorkflowError('agent-mode', 'This Run uses autonomous native goal execution, not host Task planning.')
    return { ...contextValue, run }
  }
  function writerExecutor(ctx: Awaited<ReturnType<typeof current>>) {
    return ctx.run.agentTurns && !ctx.run.sourceEdits?.some(e => e.attemptId === ctx.run.writer?.attemptId)
      ? ctx.agentExecutor : ctx.executor
  }
  async function attemptEvents(run: Run, attempt: Pick<Attempt,'sessionId'|'attemptId'>) {
    if (input.sessions.get(attempt.sessionId)) return { events: input.sessions.transcript(attempt.sessionId) }
    try { return { events: await readSessionTranscriptFromDisk(attempt.sessionId, run.workspacePath) } }
    catch (error) {
      // A never-started attempt may have no transcript; corrupt/unavailable
      // history is not proof of no decision and must not hide live questions.
      return { events: [], unavailable: { attemptId: attempt.attemptId,
        code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-transcript' : 'unreadable-transcript' } }
    }
  }
  const previewSelection = z.object({ taskId: z.string().min(1), attemptId: z.string().min(1),
    planRevision: z.number().int().positive() }).strict()
  const agentSelection = z.object({measurementId:z.string().uuid(),requirementsRevision:z.string().min(1)}).strict()
  app.get(prefix+'/agent/measurements/:measurement',async c=>{
    c.header('Cache-Control','no-store')
    try {
      const ctx=await current(c.req.raw,c.req.param('id')!,false),id=c.req.param('measurement')!
      const turn=ctx.run.agentTurns?.find(t=>t.measurements?.some(m=>m.id===id)),record=turn?.measurements?.find(m=>m.id===id)
      if(!turn || !record)throw new WorkflowError('measurement-not-found','No host measurement with this identity',404)
      let freshness:{current:boolean;reason?:string;code?:string}={current:true}
      try {await selectAgentMeasuredBuild(ctx.run,id,input.sessions.hasActiveProjectTurn(ctx.user.id,ctx.project.id,ctx.workspace))}
      catch(error) {
        if(!(error instanceof WorkflowError))throw error
        freshness={current:false,reason:error.message,code:error.code}
      }
      return c.json({...measurementSummary(record),freshness,
        execution:{attemptId:turn.attemptId,sessionId:turn.sessionId,turnId:turn.turnId,nativeSessionId:turn.nativeSessionId,status:turn.status},
        currentRequirements:ctx.run.requirements})
    }catch(error){const detail=routeError(error);return c.json(detail,detail.status)}
  })
  app.post(prefix+'/export', async c => {
    c.header('Cache-Control', 'private, no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      if (!hasBeeGamePermission(ctx.user, 'project.export')) throw new WorkflowError('permission-denied', 'Export permission denied', 403)
      const kind={kind:z.enum(['static','project']).optional()}
      const body = z.union([previewSelection.extend(kind),agentSelection.extend(kind)]).parse(await input.readBody(c.req.raw))
      if ('measurementId' in body ? body.requirementsRevision!==ctx.run.requirements.revision : body.planRevision!==ctx.run.planRevision)
        throw new WorkflowError('revision-conflict', 'Read the current version before exporting')
      const guard = {
        read: () => ctx.store.read(ctx.project.id, ctx.user.id),
        busy: (run:Run) => input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath),
      }
      const result = 'measurementId' in body ? await exportAgentMeasuredBuild(ctx.run,body.measurementId,guard,body.kind) :
        await exportMeasuredBuild(ctx.run, body.taskId, body.attemptId, guard,body.kind)
      return new Response(new Uint8Array(result.data), { headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="'+result.filename+'"', 'X-Content-Type-Options': 'nosniff',
        'X-BGS-Artifact-SHA256': result.artifact.sha256, 'X-BGS-Export-Kind': result.kind } })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/preview-issues', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      const result = await recordPreviewIssue(ctx.run, await input.readBody(c.req.raw),
        input.sessions.hasActiveProjectTurn(ctx.user.id, ctx.project.id, ctx.workspace))
      if (result.run !== ctx.run) await ctx.store.commit(ctx.project.id, ctx.user.id, ctx.run.version, result.run, 'preview.observation-recorded')
      return c.json({ issue: result.issue, dispatched: false })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  for (const action of ['review-plan', 'repair-plan'] as const) app.post(prefix+'/preview-issues/:identity/'+action, async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      const body = z.object({ planRevision: z.number().int().positive(), findingIds: z.array(z.string().min(1)).optional() }).strict().parse(await input.readBody(c.req.raw))
      if (body.planRevision !== ctx.run.planRevision) throw new WorkflowError('revision-conflict', 'Read the current plan before preparing review/repair')
      if (ctx.run.writer || input.sessions.hasActiveProjectTurn(ctx.user.id, ctx.project.id, ctx.workspace))
        throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before preparing review/repair')
      const next = action === 'review-plan' ? await prepareIssueReview(ctx.run, c.req.param('identity')!) :
        await prepareReviewedRepair(ctx.run, c.req.param('identity')!, body.findingIds ?? [])
      if (next !== ctx.run) await ctx.store.commit(ctx.project.id, ctx.user.id, ctx.run.version, next, 'preview.'+action)
      return c.json({ run: next, dispatched: false })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix+'/preview', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      return c.json(await input.preview?.status(ctx.project.id, ctx.user.id) ?? { preview: null })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/preview', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      if (!hasBeeGamePermission(ctx.user, 'preview.manage')) throw new WorkflowError('permission-denied', 'Preview permission denied', 403)
      if (!input.preview) throw new WorkflowError('preview-unavailable', 'Measured Preview is not configured', 503)
      const body = z.union([previewSelection,agentSelection]).parse(await input.readBody(c.req.raw))
      if('measurementId' in body && body.requirementsRevision!==ctx.run.requirements.revision)
        throw new WorkflowError('revision-conflict','Read current requirements before opening Preview')
      return c.json({ preview: 'measurementId' in body ? await input.preview.openAgent(ctx.run,body.measurementId) :
        await input.preview.open(ctx.run, body.taskId, body.attemptId, body.planRevision) })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.delete(prefix+'/preview', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      if (!hasBeeGamePermission(ctx.user, 'preview.manage')) throw new WorkflowError('permission-denied', 'Preview permission denied', 403)
      const body = z.object({ id: z.string().min(1) }).strict().parse(await input.readBody(c.req.raw))
      input.preview?.close(ctx.project.id, ctx.user.id, body.id)
      return c.json({ preview: null })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix, async c => {
    c.header('Cache-Control', 'no-store')
    try {
      // Legacy UI discovery is read-only and does not require a V3 database.
      // A persisted V3 project without its store must still report unavailable.
      if (!input.store) {
        const user = input.getUser(c.req.raw)
        if (!hasBeeGamePermission(user, 'project.read')) throw new WorkflowError('permission-denied', 'Project permission denied', 403)
        const project = await input.getProject(c.req.raw, user, c.req.param('id'))
        if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
        if (project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return c.json({ run: null, writerLiveness: 'none' })
      }
      const value = await context(c.req.raw, c.req.param('id'), false), run = await value.store.read(value.project.id, value.user.id)
      if (!run && value.project.runtime_snapshot?.workflow_protocol === 'bgs.workflow.v3')
        throw new WorkflowError('run-unavailable', 'Persisted V3 project has no available Run; do not use legacy execution.', 503)
      if (run && run.workspacePath !== value.workspace) throw new WorkflowError('workspace-changed', 'Run workspace binding changed')
      return c.json({ run: run ?? null, writerLiveness: run ? writerExecutor({ ...value, run }).writerLiveness(run) : 'none' })
    }
    catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix+'/sources', async c => {
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      return c.json({ requirementsRevision: ctx.run.requirements.revision, planRevision: ctx.run.planRevision, sources: sourceIndex(ctx.run),
        measurements:ctx.run.agentTurns?.flatMap(turn=>(turn.measurements ?? []).map(record=>({...measurementSummary(record),attemptId:turn.attemptId}))),
        note: 'Recorded source versions and checks, not a new current-file or release validation.' })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/runs', async c => {
    try {
      const ctx = await context(c.req.raw, c.req.param('id')!, true), body = startSchema.parse(await input.readBody(c.req.raw))
      const prior = await ctx.store.read(ctx.project.id, ctx.user.id)
      if (prior) {
        const requestDigest = digest(JSON.stringify({ text: body.requirements.text, constraints: body.requirements.constraints, ids: body.requirements.ids }))
        if (prior.requestKey === body.requestKey && prior.chatSessionId === body.chatSessionId && prior.requirements.sha256 === requestDigest) {
          await input.persistMode(c.req.raw, ctx.user, ctx.project, prior)
          return c.json({ run: prior })
        }
        throw new WorkflowError('run-exists', 'This slice preserves the existing Run; authorized change/migration belongs to V3-08')
      }
      await input.assertNoLegacyRun(ctx.workspace)
      const metadata = input.sessions.metadata(body.chatSessionId)
      if (!metadata || metadata.workflowExecution || metadata.userId !== ctx.user.id || metadata.projectId !== ctx.project.id || await realpath(metadata.workspacePath) !== ctx.workspace)
        throw new WorkflowError('invalid-chat-binding', 'Use this project’s real user Chat session', 400)
      if (input.sessions.hasActiveProjectTurn(ctx.user.id, ctx.project.id, ctx.workspace)) throw new WorkflowError('workspace-busy', 'Wait for the existing writer to stop')
      const run = createRun({ projectId: ctx.project.id, ownerId: ctx.user.id, workspacePath: ctx.workspace,
        chatSessionId: body.chatSessionId, requestKey: body.requestKey, ...body.requirements })
      await ctx.store.commit(ctx.project.id, ctx.user.id, 0, run, 'run.created')
      await input.persistMode(c.req.raw, ctx.user, ctx.project, run)
      return c.json({ run }, 201)
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/agent/goal', async c => {
    c.header('Cache-Control','no-store')
    try {
      const ctx=await context(c.req.raw,c.req.param('id')!,true),body=agentGoalSchema.parse(await input.readBody(c.req.raw))
      const text=JSON.stringify(body.brief),constraints=body.brief.settings
      let run=await ctx.store.read(ctx.project.id,ctx.user.id)
      if(run && (run.workspacePath!==ctx.workspace || !run.agentTurns || run.requestKey!==body.requestKey ||
          run.chatSessionId!==body.chatSessionId || !sameJson(JSON.parse((run.requirementChanges?.[0]?.before ?? run.requirements).text),body.brief)))
        throw new WorkflowError('run-exists','Existing Run or request identity differs; do not overwrite/restart it')
      const metadata=input.sessions.metadata(body.chatSessionId),chat=input.sessions.get(body.chatSessionId)
      if(!metadata || !chat || metadata.workflowExecution || metadata.userId!==ctx.user.id ||
          metadata.projectId!==ctx.project.id || await realpath(metadata.workspacePath)!==ctx.workspace)
        throw new WorkflowError('invalid-chat-binding','Restore this project’s real native Chat before goal intake',400)
      if(!run) {
        if(input.sessions.hasActiveProjectTurn(ctx.user.id,ctx.project.id,ctx.workspace))
          throw new WorkflowError('workspace-busy','Wait for the existing writer')
        await input.assertNoLegacyRun(ctx.workspace)
        if(ctx.project.runtime_snapshot?.workflow_protocol==='bgs.workflow.v3')
          throw new WorkflowError('run-unavailable','Persisted V3 Run is unavailable; do not create a replacement',503)
        run=createRun({projectId:ctx.project.id,ownerId:ctx.user.id,workspacePath:ctx.workspace,
          chatSessionId:body.chatSessionId,requestKey:body.requestKey,text,constraints,ids:['goal']})
        run.agentTurns=[]
        await ctx.store.commit(ctx.project.id,ctx.user.id,0,run,'agent.goal-confirmed')
      }
      // Persist mode before any model dispatch; retry can reconcile this same
      // intake if mode persistence failed, never overwrite or create another Run.
      await input.persistMode(c.req.raw,ctx.user,ctx.project,run)
      const turn=await ctx.agentExecutor.start(run,{
        openImage:input.openAgentImage ? ()=>input.openAgentImage!({user:ctx.user,projectId:ctx.project.id,workspacePath:ctx.workspace}) : undefined,
        modelConfigId:chat.modelConfigId,language:body.brief.agent_response_language,
        userDataRoot:input.getUserDataRoot?.(c.req.raw),
        authToken:input.getAuthToken(c.req.raw),getValidAuthToken:input.getValidAuthToken(c.req.raw),
        openPreview:hasBeeGamePermission(ctx.user,'preview.manage') && input.openAgentPreview ?
          ()=>input.openAgentPreview!({request:c.req.raw,user:ctx.user,workspacePath:ctx.workspace,sessionId:body.chatSessionId}) : undefined,
      })
      return c.json({turn,runId:run.id,deliveryEligible:false},202)
    } catch(error) {const detail=routeError(error);return c.json(detail,detail.status)}
  })
  app.post(prefix+'/agent/messages', async c => {
    c.header('Cache-Control','no-store')
    try {
      const ctx=await current(c.req.raw,c.req.param('id')!,true,true)
      const body=agentMessageSchema.parse(await input.readBody(c.req.raw))
      if(!ctx.run.agentTurns) throw new WorkflowError('agent-mode-required','This Run uses diagnostic Task execution, not native goal messages')
      const metadata=input.sessions.metadata(body.chatSessionId),chat=input.sessions.get(body.chatSessionId)
      if(!metadata || !chat || metadata.workflowExecution || metadata.userId!==ctx.user.id ||
          metadata.projectId!==ctx.project.id || await realpath(metadata.workspacePath)!==ctx.workspace)
        throw new WorkflowError('invalid-chat-binding','Restore this project’s bound native Chat before messaging',400)
      await input.persistMode(c.req.raw,ctx.user,ctx.project,ctx.run)
      const turn=await ctx.agentExecutor.message(ctx.run,body,{
        openImage:input.openAgentImage ? ()=>input.openAgentImage!({user:ctx.user,projectId:ctx.project.id,workspacePath:ctx.workspace}) : undefined,
        modelConfigId:chat.modelConfigId,
        userDataRoot:input.getUserDataRoot?.(c.req.raw),
        authToken:input.getAuthToken(c.req.raw),getValidAuthToken:input.getValidAuthToken(c.req.raw),
        openPreview:hasBeeGamePermission(ctx.user,'preview.manage') && input.openAgentPreview ?
          ()=>input.openAgentPreview!({request:c.req.raw,user:ctx.user,workspacePath:ctx.workspace,sessionId:body.chatSessionId}) : undefined,
      })
      return c.json({turn,runId:ctx.run.id,deliveryEligible:false},202)
    } catch(error) {const detail=routeError(error);return c.json(detail,detail.status)}
  })
  app.put(prefix+'/plan', async c => {
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      if (ctx.run.writer) throw new WorkflowError('writer-unresolved', 'Previous writer must be confirmed stopped before revising a plan')
      const next = publishPlan(ctx.run, await input.readBody(c.req.raw), await staleTaskIds(ctx.run))
      validateRepairPlans(next)
      await ctx.store.commit(ctx.project.id, ctx.user.id, ctx.run.version, next, 'plan.published')
      return c.json({ run: next })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/requirements', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      if (!hasBeeGamePermission(ctx.user, 'project.create')) throw new WorkflowError('permission-denied', 'Requirement change permission denied', 403)
      if (input.sessions.hasActiveProjectTurn(ctx.user.id, ctx.project.id, ctx.workspace)) throw new WorkflowError('workspace-busy', 'Wait for the active project turn before changing requirements')
      const next = changeRequirements(ctx.run, await input.readBody(c.req.raw))
      validateRepairPlans(next)
      if (next !== ctx.run) await ctx.store.commit(ctx.project.id, ctx.user.id, ctx.run.version, next, 'requirements.changed')
      return c.json({ run: next, dispatched: false, requiresRebuild: true })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/tasks/:taskId/execute', async c => {
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      const body = z.object({ requestKey: z.string().min(1), planRevision: z.number().int().positive() }).strict().parse(await input.readBody(c.req.raw))
      if (body.planRevision !== ctx.run.planRevision) throw new WorkflowError('revision-conflict', 'Read the current plan revision before dispatch')
      const chat = input.sessions.get(ctx.run.chatSessionId)
      if (!chat) throw new WorkflowError('chat-not-live', 'Restore the explicit user Chat binding before execution')
      const attempt = await ctx.executor.start(ctx.run, c.req.param('taskId')!, body.requestKey, {
        ...(chat.modelConfigId ? { modelConfigId: chat.modelConfigId } : {}),
        language: input.sessions.language(chat.id), authToken: input.getAuthToken(c.req.raw), getValidAuthToken: input.getValidAuthToken(c.req.raw),
      })
      return c.json({ attempt }, 202)
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix+'/events', async c => {
    try {
      const { run } = await current(c.req.raw, c.req.param('id')!, false)
      if(run.agentTurns) {
        const history=await attemptEvents(run,{sessionId:run.chatSessionId,attemptId:run.writer?.attemptId??run.agentTurns.at(-1)?.attemptId??run.id})
        return c.json({runId:run.id,events:history.events,historyUnavailable:history.unavailable?[history.unavailable]:[]})
      }
      const groups = await Promise.all(run.attempts.filter(attempt=>!attempt.sourceEdit).map(async attempt => {
        const history = await attemptEvents(run, attempt)
        return { events: history.events.map(event => ({ ...event, workflowExecution: { runId: run.id, taskId: attempt.taskId, attemptId: attempt.attemptId } })), unavailable: history.unavailable }
      }))
      return c.json({ runId: run.id, events: groups.flatMap(g => g.events), historyUnavailable: groups.flatMap(g => g.unavailable ? [g.unavailable] : []) })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix+'/questions', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      if(ctx.run.agentTurns) {
        const turn=ctx.run.agentTurns.find(t=>t.attemptId===ctx.run.writer?.attemptId)
        const questions=input.sessions.pendingPermissionsForProject(ctx.user.id,ctx.project.id,ctx.workspace)
          .filter(p=>p.toolName==='AskUserQuestion' && p.sessionId===turn?.sessionId)
          .map(p=>({toolUseID:p.toolUseID,sessionId:p.sessionId,attemptId:turn!.attemptId,input:p.input,message:p.message,
            canAnswer:!ctx.run.paused && turn?.status==='running' && input.sessions.get(p.sessionId)?.turnStatus==='running'}))
        const history=await attemptEvents(ctx.run,{sessionId:ctx.run.chatSessionId,
          attemptId:turn?.attemptId??ctx.run.agentTurns.at(-1)?.attemptId??ctx.run.id})
        const decisions=history.events.filter(e=>e.type==='permission.resolved' && e.payload?.toolName==='AskUserQuestion')
          .map(e=>({turnId:e.turnId,type:e.type,payload:e.payload}))
        return c.json({runId:ctx.run.id,planRevision:ctx.run.planRevision,requirementsRevision:ctx.run.requirements.revision,
          questions,decisions,historyUnavailable:history.unavailable?[history.unavailable]:[]})
      }
      const questions = input.sessions.pendingPermissionsForProject(ctx.user.id, ctx.project.id, ctx.workspace)
        .filter(p => p.toolName === 'AskUserQuestion').flatMap(p => {
          const attempt = ctx.run.attempts.find(a => a.sessionId === p.sessionId && a.attemptId === ctx.run.writer?.attemptId)
          const session = input.sessions.get(p.sessionId)
          if (!attempt || session?.workflowExecution?.runId !== ctx.run.id || session.workflowExecution.attemptId !== attempt.attemptId) return []
          const event = input.sessions.transcript(p.sessionId).findLast(e => e.type === 'permission.requested' && e.payload?.toolUseID === p.toolUseID)
          return [{ toolUseID: p.toolUseID, sessionId: p.sessionId, attemptId: attempt.attemptId,
            input: p.input, message: p.message, binding: event?.payload?.workflowQuestion,
            canAnswer: !ctx.run.paused && attempt.status === 'running' && attempt.planRevision === ctx.run.planRevision && session.turnStatus === 'running' }]
        })
      const groups = await Promise.all(ctx.run.attempts.filter(a => !a.sourceEdit).map(async a => {
        const history = await attemptEvents(ctx.run, a)
        return { decisions: history.events.filter(e => ['workflow.question.validated','workflow.question.rejected'].includes(e.type))
          .map(e => ({ attemptId: a.attemptId, type: e.type, payload: e.payload })), unavailable: history.unavailable }
      }))
      return c.json({ runId: ctx.run.id, planRevision: ctx.run.planRevision, requirementsRevision: ctx.run.requirements.revision, questions,
        decisions: groups.flatMap(g => g.decisions), historyUnavailable: groups.flatMap(g => g.unavailable ? [g.unavailable] : []) })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/recover-writer', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true, true)
      if (!hasBeeGamePermission(ctx.user, 'agent.cancel')) throw new WorkflowError('permission-denied', 'Writer recovery permission denied', 403)
      const body = z.object({ expectedVersion: z.number().int().positive(), attemptId: z.string().uuid(), fence: z.number().int().positive() }).strict().parse(await input.readBody(c.req.raw))
      const run = await writerExecutor(ctx).recover(ctx.run, body)
      return c.json({ run, dispatched: false, partialOutputsAccepted: false, externalOutcomesVerified: false })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/stop', async c => {
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      if (!hasBeeGamePermission(ctx.user, 'agent.cancel')) throw new WorkflowError('permission-denied', 'Cancel permission denied', 403)
      const run = await writerExecutor(ctx).stop(ctx.run)
      return c.json({ run, paused: true, stopping: Boolean(run.writer), partialOutputsAccepted: false }, 202)
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/resume', async c => {
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true, true)
      const body = z.object({ planRevision: z.number().int().nonnegative() }).strict().parse(await input.readBody(c.req.raw))
      if (body.planRevision !== ctx.run.planRevision) throw new WorkflowError('revision-conflict', 'Read the current plan revision before resuming')
      const run = await (ctx.run.agentTurns ? ctx.agentExecutor : ctx.executor).resume(ctx.run)
      return c.json({ run, dispatched: false, partialOutputsAccepted: false })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  return { async contentView(request: Request, projectId: string, metadata: boolean) {
    const user = input.getUser(request)
    if (!hasBeeGamePermission(user, 'project.read')) throw new WorkflowError('permission-denied', 'Project permission denied', 403)
    const project = await input.getProject(request, user, projectId)
    if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
    const stored = await input.store?.read(projectId, user.id)
    if (!stored && project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return undefined
    const ctx = await current(request, projectId, false)
    if (ctx.run.writer || input.sessions.hasActiveProjectTurn(user.id, projectId, ctx.workspace))
      throw new WorkflowError('workspace-busy', 'Wait for the current writer to stop before viewing saved content', 409)
    const snapshot = await readContentView(ctx.workspace, metadata)
    const after = await ctx.store.read(projectId, user.id)
    if (!after || after.version !== ctx.run.version || after.writer || input.sessions.hasActiveProjectTurn(user.id, projectId, ctx.workspace))
      throw new WorkflowError('content-changed', 'Workflow changed while loading; refresh after the writer stops', 409)
    const editablePaths = snapshot.state === 'draft' && !ctx.run.paused ? snapshot.documents.filter(d =>
      ['scene-2d','scene-3d','ui-screen','ui-hud','ui-flow'].includes('kind' in d ? d.kind! : d.document!.kind) &&
      (ctx.run.agentTurns || contentOwners(ctx.run, 'content/'+d.path).length)).map(d => d.path) : []
    const canEdit = hasBeeGamePermission(user, 'project.create') && hasBeeGamePermission(user, 'agent.send_message') && editablePaths.length > 0
    return { ...snapshot, readOnly: !canEdit, ...(canEdit ? { editing: { version: ctx.run.version, planRevision: ctx.run.planRevision,
      requirementsRevision: ctx.run.requirements.revision, paths: editablePaths } } : {}),
      note: 'Saved source candidate, not game acceptance. Saving invalidates affected qualifications; rebuild and measure before new Preview/export.' }
  }, async saveContent(request: Request, projectId: string, value: unknown) {
    const user = input.getUser(request), project = await input.getProject(request, user, projectId)
    if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
    const stored = await input.store?.read(projectId, user.id)
    if (!stored && project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return undefined
    const ctx = await current(request, projectId, true, true)
    if (!hasBeeGamePermission(user, 'project.create')) throw new WorkflowError('permission-denied', 'Source editing permission denied', 403)
    return ctx.executor.edit(ctx.run, value)
  }, async assertLegacy(projectId: string, ownerId: string, request: Request) {
    const project = await input.getProject(request, input.getUser(request), projectId)
    if (project?.runtime_snapshot?.workflow_protocol === 'bgs.workflow.v3' || (project && input.store && await input.store.read(projectId, ownerId)))
      throw new WorkflowError('v3-route-required', 'This project uses V3. Use its explicit V3 entry; legacy document scheduling is disabled.')
  } }
}
