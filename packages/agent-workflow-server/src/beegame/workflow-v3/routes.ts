import type { Hono } from 'hono'
import { realpath } from 'node:fs/promises'
import { z } from 'zod/v4'
import type { BeeGameUserContext } from '../../auth/user-context'
import { hasBeeGamePermission } from '../../auth/user-context'
import type { BeeGameProjectMetadata } from '../../project-metadata-store'
import { readSessionTranscriptFromDisk, type BeeGameSessionManager } from '../session-manager'
import { validateBeeGameAttachments, BeeGameUploadPolicyError } from '../../security/upload-policy'
import { createV3Executor } from './execution'
import { createRun, digest, WorkflowError, type Run, type AgentTurn } from './state'
import { sameJson, type WorkflowStore } from './store'
import { readContentView } from './content-view'
import { versionsMatch } from './checks'
import type { MeasuredPreviewManager } from './measured-preview'
import { exportAgentMeasuredBuild, selectAgentMeasuredBuild, inspectAgentMeasurementInputs, measuredFiles,
  discussionMessagesSinceMeasurement } from './measured-build'
import { mergeDeploymentRecords, type BeeGameDeploymentManager, type BeeGameDeploymentRecord } from '../deployment-manager'
import { measurementSummary, activeUserTask, agentSkillFacts } from './agent-measurement'
import { agentGoalSchema, agentMessageSchema, createAgentGoalExecutor } from './agent-goal'
import type { AgentPreviewAccess, AgentImageAccess } from './agent-tools'
import { auditEventPage } from './event-page'
import type { HostExitReceipts } from './host-exit-receipt'
import { observeProjectCreation } from './web-project-start'

function imageScreenOrientation(run: Run): 'Landscape' | 'Portrait' | undefined {
  const value = run.requirements.constraints.orientation
  return value === 'Landscape' || value === 'Portrait' ? value : undefined
}

export function registerV3Routes(app: Hono, input: {
  store?: WorkflowStore; sessions: BeeGameSessionManager; preview?: MeasuredPreviewManager; exitReceipts?: HostExitReceipts;
  deployment?: () => BeeGameDeploymentManager;
  persistDeployment?(request:Request, user:BeeGameUserContext, record:BeeGameDeploymentRecord):Promise<unknown>;
  listDeployments?(request:Request, user:BeeGameUserContext, sessionId:string):Promise<BeeGameDeploymentRecord[] | undefined>;
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
  openAgentImage?: (value: {user: BeeGameUserContext; projectId: string; workspacePath: string; visualHandoffVersion?: 1; screenOrientation?: 'Landscape' | 'Portrait'}) => AgentImageAccess | Promise<AgentImageAccess>;
}) {
  const executor = input.store ? createV3Executor({ store: input.store, sessions: input.sessions, exitReceipts:input.exitReceipts }) : undefined
  const agentExecutor = input.store ? createAgentGoalExecutor({ store: input.store, sessions: input.sessions,
    resourceLibraryBaseUrl:input.resourceLibraryBaseUrl, exitReceipts:input.exitReceipts }) : undefined
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
    error instanceof BeeGameUploadPolicyError ? { error: error.message, code: 'invalid-attachment', status: 400 as const } :
    error instanceof z.ZodError ? { error: JSON.stringify(error.issues), code: 'invalid-request', status: 400 as const } :
      error instanceof SyntaxError ? { error: 'Invalid JSON request', code: 'invalid-request', status: 400 as const } :
      { error: 'V3 operation failed; no automatic retry.', code: 'workflow-operation-failed', status: 500 as const }
  async function current(request: Request, projectId: string, mutate: boolean) {
    const contextValue = await context(request, projectId, mutate), run = await contextValue.store.read(projectId, contextValue.user.id)
    if (!run) throw new WorkflowError('run-not-found', 'V3 run not found', 404)
    if (run.workspacePath !== contextValue.workspace) throw new WorkflowError('workspace-changed', 'Run workspace binding changed')
    if (!Array.isArray(run.agentTurns)) throw new WorkflowError('task-mode-retired', 'This older Task Run is retired. Start a new autonomous project; it cannot be silently migrated.', 409)
    return { ...contextValue, run }
  }
  function writerExecutor(ctx: Awaited<ReturnType<typeof current>>) {
    return ctx.run.agentTurns && !ctx.run.sourceEdits?.some(e => e.attemptId === ctx.run.writer?.attemptId)
      ? ctx.agentExecutor : ctx.executor
  }
  async function attemptEvents(run: Run, attempt: Pick<AgentTurn,'sessionId'|'attemptId'>) {
    if (input.sessions.get(attempt.sessionId)) return { events: input.sessions.transcriptFacts(attempt.sessionId) }
    try { return { events: await readSessionTranscriptFromDisk(attempt.sessionId, run.workspacePath) } }
    catch (error) {
      // A never-started attempt may have no transcript; corrupt/unavailable
      // history is not proof of no decision and must not hide live questions.
      return { events: [], unavailable: { attemptId: attempt.attemptId,
        code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-transcript' : 'unreadable-transcript' } }
    }
  }
  const agentSelection = z.object({measurementId:z.string().uuid(),requirementsRevision:z.string().min(1)}).strict()
  // Adapt existing dashboard endpoints on the server. Never enter legacy
  // scripts/acceptance restoration for a V3 project, or silently use older PASS.
  for (const suffix of ['preview', 'preview/restart', 'deployment-readiness', 'deployments']) {
    app.on(suffix === 'preview' ? ['GET','POST','DELETE'] : suffix === 'deployment-readiness' ? ['GET'] : suffix === 'deployments' ? ['GET','POST'] : ['POST'],
      '/api/projects/:id/' + suffix, async (c, next) => {
      try {
        const user = input.getUser(c.req.raw), project = await input.getProject(c.req.raw, user, c.req.param('id')!)
        if (!project) return next()
        const stored = await input.store?.read(project.id, user.id)
        if (!stored && project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return next()
        c.header('Cache-Control', 'no-store')
        const ctx = await current(c.req.raw, project.id, false)
        const permission = c.req.method === 'GET' ? 'project.read' : suffix === 'deployments' ? 'deployment.manage' : 'preview.manage'
        if (!hasBeeGamePermission(user, permission)) throw new WorkflowError('permission-denied', 'Operation permission denied', 403)
        if (suffix === 'deployment-readiness' || suffix === 'deployments') {
          const deployment = input.deployment?.()
          if (!deployment) throw new WorkflowError('deployment-unavailable','V3 publishing is not configured',503)
          if (suffix === 'deployments' && c.req.method === 'GET')
            return c.json(mergeDeploymentRecords(await deployment.list(ctx.run.chatSessionId),
              await input.listDeployments?.(c.req.raw,user,ctx.run.chatSessionId) ?? []))
          try {
            if (deployment.isPublishing(user.id,ctx.run.workspacePath))
              throw new WorkflowError('deployment-busy','Publication is already running; inspect its record')
            const requested = c.req.method === 'POST'
              ? z.object({measurementId:z.string().uuid().optional(),requirementsRevision:z.string().optional(),
                discussionConfirmation:z.object({messageRequestKeys:z.array(z.string().min(1)).min(1)}).strict().optional(),
              }).strict().parse(await input.readBody(c.req.raw))
              : undefined
            const latest = ctx.run.agentTurns?.flatMap(t=>t.measurements ?? []).at(-1)
            if (!latest) throw new WorkflowError('deployment-unverified','No measured build is available')
            if (requested?.measurementId && requested.measurementId !== latest.id ||
                requested?.requirementsRevision && requested.requirementsRevision !== ctx.run.requirements.revision)
              throw new WorkflowError('revision-conflict','Deployment selection changed; read current readiness')
            const discussion=discussionMessagesSinceMeasurement(ctx.run,latest)
            const expectedKeys=discussion?.map(item=>item.requestKey)
            const confirmedKeys=requested?.discussionConfirmation?.messageRequestKeys
            if (confirmedKeys && (!discussion?.length || !requested?.measurementId || !requested.requirementsRevision ||
                !sameJson(confirmedKeys,expectedKeys)))
              throw new WorkflowError('confirmation-conflict','The messages or measured version changed; read current readiness and confirm again')
            const busy = (run:Run) => input.sessions.hasActiveProjectTurn(run.ownerId,run.projectId,run.workspacePath)
            const selectionKeys=c.req.method === 'GET' ? expectedKeys : confirmedKeys
            const selected = await selectAgentMeasuredBuild(ctx.run,latest.id,busy(ctx.run),'publication',selectionKeys)
            await measuredFiles(ctx.run,selected)
            if (c.req.method === 'GET') return c.json(discussion?.length ? {allowed:false,
              issues:['Messages after this measurement need your confirmation that they did not change the game requirements.'],
              destination:deployment.destination,quality:'unverified',
              confirmationRequired:{measurementId:latest.id,requirementsRevision:ctx.run.requirements.revision,messages:discussion}}
              : {allowed:true,issues:[],destination:deployment.destination,
                measurementId:latest.id,requirementsRevision:ctx.run.requirements.revision,artifact:selected.artifact,
                quality:'unverified',scope:'Eligible for explicit publication of measured bytes, not game-quality certification.'})
            const validate = async () => {
              const current = await ctx.store.read(project.id,user.id)
              if (!current || current.id !== ctx.run.id || current.version !== ctx.run.version ||
                  current.workspacePath !== ctx.run.workspacePath)
                throw new WorkflowError('revision-conflict','Workflow changed while preparing publication')
              const checked = await selectAgentMeasuredBuild(current,latest.id,busy(current),'publication',confirmedKeys)
              if (checked.artifact.path !== selected.artifact.path || checked.artifact.sha256 !== selected.artifact.sha256)
                throw new WorkflowError('measurement-stale','Selected deployment bytes changed')
              await measuredFiles(current,checked)
            }
            // Selection above awaits file/database reads. Recheck synchronously
            // with start so a concurrent request gets 409, not a generic 500.
            if (deployment.isPublishing(user.id,ctx.run.workspacePath))
              throw new WorkflowError('deployment-busy','Publication is already running; inspect its record')
            return c.json(await deployment.start({sessionId:ctx.run.chatSessionId,userId:user.id,projectId:project.id,
              workspacePath:ctx.run.workspacePath,authToken:input.getAuthToken(c.req.raw),
              measured:{runId:ctx.run.id,measurementId:latest.id,artifact:selected.artifact,validate,
                ...(confirmedKeys?{discussionConfirmation:{requirementsRevision:ctx.run.requirements.revision,
                  messageRequestKeys:confirmedKeys}}:{})}},
              input.persistDeployment ? record=>input.persistDeployment!(c.req.raw,user,record) : undefined),202)
          } catch(error) {
            if (suffix !== 'deployment-readiness') throw error
            const detail = routeError(error)
            if (detail.status !== 409) throw error
            return c.json({allowed:false,issues:[detail.error],code:detail.code,destination:deployment.destination,quality:'unverified'})
          }
        }
        if (!input.preview) throw new WorkflowError('preview-unavailable', 'Measured Preview is not configured', 503)
        let state = await input.preview.status(project.id, user.id)
        if (c.req.method === 'DELETE') {
          if (state.preview) input.preview.close(project.id, user.id, state.preview.id)
          state = {preview:null}
        } else if (c.req.method === 'POST') {
          const body = await input.readBody(c.req.raw)
          z.object({}).strict().parse(body)
          const latest = ctx.run.agentTurns?.flatMap(turn => turn.measurements ?? []).at(-1)
          if (!latest) throw new WorkflowError('preview-unverified',
            'No host-measured build is saved for this Run. A browser test execution.json is not a measurement; run the supplied measure.mjs entry, then inspect its result. No build or test was started by this Preview request.')
          // openAgent rechecks writer, requirements, sources and artifact identity.
          // Restart does not rerun a build or model and reuses a valid capability.
          state = {preview:await input.preview.openAgent(ctx.run, latest.id)}
        }
        return c.json({sessionId:ctx.run.chatSessionId,workspacePath:ctx.run.workspacePath,
          status:state.preview ? 'running' : c.req.method === 'DELETE' ? 'stopped' : 'idle',
          url:state.preview?.url ?? '',mode:'production',updatedAt:new Date().toISOString(),
          message:state.preview ? state.preview.limitations.join(' ') : state.reason ?? 'No measured Preview is open'})
      } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
    })
  }
  app.get(prefix+'/agent/measurements/:measurement',async c=>{
    c.header('Cache-Control','no-store')
    try {
      const ctx=await current(c.req.raw,c.req.param('id')!,false),id=c.req.param('measurement')!
      const turn=ctx.run.agentTurns?.find(t=>t.measurements?.some(m=>m.id===id)),record=turn?.measurements?.find(m=>m.id===id)
      if(!turn || !record)throw new WorkflowError('measurement-not-found','No host measurement with this identity',404)
      // Input identity remains inspectable even when the writer/exit state
      // forbids selection. Never turn those diagnostics into export permission.
      const inputs=await inspectAgentMeasurementInputs(ctx.run,record)
      let freshness={...inputs,inputsCurrent:inputs.current}
      let selection:{eligible:boolean;code?:string;reason?:string}={eligible:true}
      try {await selectAgentMeasuredBuild(ctx.run,id,input.sessions.hasActiveProjectTurn(ctx.user.id,ctx.project.id,ctx.workspace))}
      catch(error) {
        if(!(error instanceof WorkflowError))throw error
        selection={eligible:false,reason:error.message,code:error.code}
        freshness={...freshness,current:false,reason:error.message,code:error.code}
      }
      let previewSelection:{eligible:boolean;code?:string;reason?:string}={eligible:true}
      try {await selectAgentMeasuredBuild(ctx.run,id,input.sessions.hasActiveProjectTurn(ctx.user.id,ctx.project.id,ctx.workspace),'preview')}
      catch(error) {
        if(!(error instanceof WorkflowError))throw error
        previewSelection={eligible:false,reason:error.message,code:error.code}
      }
      const currentTurn=ctx.run.agentTurns!.at(-1)!
      return c.json({...measurementSummary(record),freshness,selection,previewSelection,
        task:activeUserTask(ctx.run,currentTurn),skills:agentSkillFacts(ctx.run,currentTurn),
        measurementTask:{attemptId:turn.attemptId,requestKey:turn.requestKey,status:turn.status,requirementsRevision:turn.requirementsRevision},
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
      const body = agentSelection.extend(kind).parse(await input.readBody(c.req.raw))
      if (body.requirementsRevision!==ctx.run.requirements.revision)
        throw new WorkflowError('revision-conflict', 'Read the current version before exporting')
      const guard = {
        read: () => ctx.store.read(ctx.project.id, ctx.user.id),
        busy: (run:Run) => input.sessions.hasActiveProjectTurn(run.ownerId, run.projectId, run.workspacePath),
      }
      const result = await exportAgentMeasuredBuild(ctx.run,body.measurementId,guard,body.kind)
      return new Response(new Uint8Array(result.data), { headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="'+result.filename+'"', 'X-Content-Type-Options': 'nosniff',
        'X-BGS-Artifact-SHA256': result.artifact.sha256, 'X-BGS-Export-Kind': result.kind } })
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
      const body = agentSelection.parse(await input.readBody(c.req.raw))
      if(body.requirementsRevision!==ctx.run.requirements.revision)
        throw new WorkflowError('revision-conflict','Read current requirements before opening Preview')
      return c.json({ preview: await input.preview.openAgent(ctx.run,body.measurementId) })
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
      if (run && !Array.isArray(run.agentTurns)) throw new WorkflowError('task-mode-retired', 'This older Task Run is retired. Start a new autonomous project; it cannot be silently migrated.', 409)
      return c.json({ run: run ?? null, writerLiveness: run ? writerExecutor({ ...value, run }).writerLiveness(run) : 'none',
        recoveryEvidence:run ? await writerExecutor({...value,run}).recoveryEvidence(run):'unavailable',
        hostExitReceiptsConfigured:Boolean(input.exitReceipts) })
    }
    catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  async function startAgentGoal(request: Request, projectId: string, value: unknown) {
      const ctx=await context(request,projectId,true),body=agentGoalSchema.parse(value)
      const text=JSON.stringify(body.brief),constraints=body.brief.settings
      let run=await ctx.store.read(ctx.project.id,ctx.user.id)
      if(run && (run.workspacePath!==ctx.workspace || !Array.isArray(run.agentTurns) || run.requestKey!==body.requestKey ||
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
        run.creation=await observeProjectCreation(ctx.workspace,body.brief)
        await ctx.store.commit(ctx.project.id,ctx.user.id,0,run,'agent.goal-confirmed')
      }
      // Persist mode before any model dispatch; retry can reconcile this same
      // intake if mode persistence failed, never overwrite or create another Run.
      await input.persistMode(request,ctx.user,ctx.project,run)
      const turn=await ctx.agentExecutor.start(run,{
        openImage:input.openAgentImage ? ()=>input.openAgentImage!({user:ctx.user,projectId:ctx.project.id,workspacePath:ctx.workspace,visualHandoffVersion:run.visualHandoffVersion,screenOrientation:imageScreenOrientation(run)}) : undefined,
        modelConfigId:chat.modelConfigId,language:body.brief.agent_response_language,
        userDataRoot:input.getUserDataRoot?.(request),
        authToken:input.getAuthToken(request),getValidAuthToken:input.getValidAuthToken(request),
        openPreview:hasBeeGamePermission(ctx.user,'preview.manage') && input.openAgentPreview ?
          ()=>input.openAgentPreview!({request,user:ctx.user,workspacePath:ctx.workspace,sessionId:body.chatSessionId}) : undefined,
      })
      return {turn,runId:run.id,deliveryEligible:false}
  }
  app.post(prefix+'/agent/goal', async c => {
    c.header('Cache-Control','no-store')
    try {
      return c.json(await startAgentGoal(c.req.raw,c.req.param('id')!,await input.readBody(c.req.raw)),202)
    } catch(error) {const detail=routeError(error);return c.json(detail,detail.status)}
  })
  app.post(prefix+'/agent/messages', async c => {
    c.header('Cache-Control','no-store')
    try {
      const ctx=await current(c.req.raw,c.req.param('id')!,true)
      const {attachments: rawAttachments,...parsed}=agentMessageSchema.parse(await input.readBody(c.req.raw))
      const attachments=rawAttachments ? validateBeeGameAttachments(rawAttachments) : []
      const body={...parsed,...(attachments.length?{attachmentDigests:attachments.map(item=>({
        filename:item.filename,mediaType:item.mediaType,sha256:digest(item.data),
      }))}:{})}
      const metadata=input.sessions.metadata(body.chatSessionId),chat=input.sessions.get(body.chatSessionId)
      if(!metadata || !chat || metadata.workflowExecution || metadata.userId!==ctx.user.id ||
          metadata.projectId!==ctx.project.id || await realpath(metadata.workspacePath)!==ctx.workspace)
        throw new WorkflowError('invalid-chat-binding','Restore this project’s bound native Chat before messaging',400)
      await input.persistMode(c.req.raw,ctx.user,ctx.project,ctx.run)
      const turn=await ctx.agentExecutor.message(ctx.run,body,{
        attachments,
        openImage:input.openAgentImage ? ()=>input.openAgentImage!({user:ctx.user,projectId:ctx.project.id,workspacePath:ctx.workspace,visualHandoffVersion:ctx.run.visualHandoffVersion,screenOrientation:imageScreenOrientation(ctx.run)}) : undefined,
        modelConfigId:chat.modelConfigId,
        userDataRoot:input.getUserDataRoot?.(c.req.raw),
        authToken:input.getAuthToken(c.req.raw),getValidAuthToken:input.getValidAuthToken(c.req.raw),
        openPreview:hasBeeGamePermission(ctx.user,'preview.manage') && input.openAgentPreview ?
          ()=>input.openAgentPreview!({request:c.req.raw,user:ctx.user,workspacePath:ctx.workspace,sessionId:body.chatSessionId}) : undefined,
      })
      return c.json({turn,runId:ctx.run.id,deliveryEligible:false},202)
    } catch(error) {const detail=routeError(error);return c.json(detail,detail.status)}
  })
  app.get(prefix+'/events', async c => {
    try {
      const { run,agentExecutor } = await current(c.req.raw, c.req.param('id')!, false)
      const query=z.object({limit:z.coerce.number().int().min(1).max(200).default(100),
          beforeId:z.coerce.number().int().min(0).optional(),attemptId:z.string().min(1).optional()}).parse(c.req.query())
        const attemptId=query.attemptId??run.agentTurns!.find(t=>t.attemptId===run.writer?.attemptId)?.attemptId??run.agentTurns!.at(-1)?.attemptId
        const turn=run.agentTurns!.find(t=>t.attemptId===attemptId)
        if(!turn)throw new WorkflowError('attempt-missing','No such native attempt in this owned Run',404)
        const turnId=turn.turnId??agentExecutor.runningTurnId(run,turn)
        if(!turnId)return c.json({runId:run.id,attemptId,events:[],hasMore:false,nextBeforeId:null,
          historyUnavailable:[],note:'Native turn has not been bound; no earlier Chat events substituted.'})
        const selection={turnId,limit:query.limit,beforeId:query.beforeId}
        try {
          const page=input.sessions.get(run.chatSessionId) ? input.sessions.transcriptPage(run.chatSessionId,selection) :
            auditEventPage(await readSessionTranscriptFromDisk(run.chatSessionId,run.workspacePath),selection)
          return c.json({runId:run.id,attemptId,...page,historyUnavailable:[]})
        } catch {
          return c.json({runId:run.id,attemptId,events:[],hasMore:false,nextBeforeId:null,
            historyUnavailable:[{attemptId,reason:'Saved native history unavailable; no older success substituted'}]})
        }
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.get(prefix+'/questions', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, false)
      const turn=ctx.run.agentTurns!.find(t=>t.attemptId===ctx.run.writer?.attemptId)
        const questions=input.sessions.pendingPermissionsForProject(ctx.user.id,ctx.project.id,ctx.workspace)
          .filter(p=>p.toolName==='AskUserQuestion' && p.sessionId===turn?.sessionId)
          .map(p=>({toolUseID:p.toolUseID,sessionId:p.sessionId,attemptId:turn!.attemptId,input:p.input,message:p.message,
            canAnswer:!ctx.run.paused && turn?.status==='running' && input.sessions.get(p.sessionId)?.turnStatus==='running'}))
        const history=await attemptEvents(ctx.run,{sessionId:ctx.run.chatSessionId,
          attemptId:turn?.attemptId??ctx.run.agentTurns!.at(-1)?.attemptId??ctx.run.id})
        const decisions=history.events.filter(e=>e.type==='permission.resolved' && e.payload?.toolName==='AskUserQuestion')
          .map(e=>({turnId:e.turnId,type:e.type,payload:e.payload}))
        return c.json({runId:ctx.run.id,planRevision:ctx.run.planRevision,requirementsRevision:ctx.run.requirements.revision,
          questions,decisions,historyUnavailable:history.unavailable?[history.unavailable]:[]})
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  app.post(prefix+'/recover-writer', async c => {
    c.header('Cache-Control', 'no-store')
    try {
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
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
      const ctx = await current(c.req.raw, c.req.param('id')!, true)
      const body = z.object({ planRevision: z.number().int().nonnegative() }).strict().parse(await input.readBody(c.req.raw))
      if (body.planRevision !== ctx.run.planRevision) throw new WorkflowError('revision-conflict', 'Read the current workflow revision before resuming')
      const run = await ctx.agentExecutor.resume(ctx.run)
      return c.json({ run, dispatched: false, partialOutputsAccepted: false })
    } catch (error) { const detail = routeError(error); return c.json(detail, detail.status) }
  })
  return { startAgentGoal, async contentView(request: Request, projectId: string, metadata: boolean) {
    const user = input.getUser(request)
    if (!hasBeeGamePermission(user, 'project.read')) throw new WorkflowError('permission-denied', 'Project permission denied', 403)
    const project = await input.getProject(request, user, projectId)
    if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
    const stored = await input.store?.read(projectId, user.id)
    if (!stored && project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return undefined
    const ctx = await current(request, projectId, false)
    const snapshot = await readContentView(ctx.workspace, metadata)
    const after = await ctx.store.read(projectId, user.id)
    if (!after || after.id !== ctx.run.id || after.workspacePath !== ctx.workspace ||
        (snapshot.state === 'draft' && !await versionsMatch(ctx.workspace, snapshot.sourceVersions)))
      throw new WorkflowError('content-changed', 'Saved content changed while loading; refresh and retry', 409)
    // Run progress can advance while the saved files remain unchanged. That only invalidates edit authority, not a read-only view.
    const workflowChanged = after.version !== ctx.run.version
    const writerActive = Boolean(ctx.run.writer || after.writer || input.sessions.hasActiveProjectTurn(user.id, projectId, ctx.workspace))
    const editablePaths = snapshot.state === 'draft' && !ctx.run.paused ? snapshot.documents.filter(d =>
      ['scene-2d','scene-3d','ui-screen','ui-hud','ui-flow'].includes('kind' in d ? d.kind! : d.document!.kind)).map(d => d.path) : []
    const canEdit = !writerActive && !workflowChanged && hasBeeGamePermission(user, 'project.create') &&
      hasBeeGamePermission(user, 'agent.send_message') && editablePaths.length > 0
    return { ...snapshot, readOnly: !canEdit, ...(canEdit ? { editing: { version: ctx.run.version, planRevision: ctx.run.planRevision,
      requirementsRevision: ctx.run.requirements.revision, paths: editablePaths } } : {}),
      note: 'Saved source candidate, not game acceptance. Saving invalidates affected qualifications; rebuild and measure before new Preview/export.' }
  }, async saveContent(request: Request, projectId: string, value: unknown) {
    const user = input.getUser(request), project = await input.getProject(request, user, projectId)
    if (!project?.root_path) throw new WorkflowError('project-not-found', 'Owned project workspace not found', 404)
    const stored = await input.store?.read(projectId, user.id)
    if (!stored && project.runtime_snapshot?.workflow_protocol !== 'bgs.workflow.v3') return undefined
    const ctx = await current(request, projectId, true)
    if (!hasBeeGamePermission(user, 'project.create')) throw new WorkflowError('permission-denied', 'Source editing permission denied', 403)
    return ctx.executor.edit(ctx.run, value)
  }, async assertLegacy(projectId: string, ownerId: string, request: Request) {
    const project = await input.getProject(request, input.getUser(request), projectId)
    if (project?.runtime_snapshot?.workflow_protocol === 'bgs.workflow.v3' || (project && input.store && await input.store.read(projectId, ownerId)))
      throw new WorkflowError('v3-route-required', 'This project uses V3. Use its explicit V3 entry; legacy document scheduling is disabled.')
  } }
}
