import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PreviewCapabilityManager } from '../../auth/preview-capability'
import { selectAgentMeasuredBuild, measuredFiles } from './measured-build'
import { digest, WorkflowError, type Run } from './state'
import { staticArtifactFiles } from './runtime-checks'
import { artifactDigest } from '../runtime-acceptance'
import { readVersion } from './checks'
import { handlePreviewStorageRequest, PreviewStorageError, PREVIEW_STORAGE_PATH, PREVIEW_STORAGE_HEADER, PREVIEW_STORAGE_VERSION } from '../preview-storage.mjs'
import type { createPreviewStorageStore } from '../preview-storage-store'
import type { PreviewRunState } from './store'

export type MeasuredPreview = {
  id: string; runId: string; attemptId: string; measurementId: string
  artifact: { path: string; sha256: string }; url: string; limitations: string[]
}
export type CandidatePreview = Omit<MeasuredPreview, 'attemptId' | 'measurementId'>
type Entry = { token: string; identity: string; projectId: string; ownerId: string
  workspace: string; files: Map<string, string> } &
  ({ kind: 'measured'; view: MeasuredPreview; run: Run; validation?: {version:number; result:Promise<void>} } | { kind: 'candidate'; view: CandidatePreview; writer?: NonNullable<Run['writer']> })

/** Serve isolated static bytes, not a project dev script or rewritten HTML.
 * A dedicated origin preserves root-absolute URLs and never exposes BGS routes.
 * Capabilities are ephemeral; restart requires explicit reopening, not work replay. */
export function createMeasuredPreview(input: {
  origin?: string; capabilities: PreviewCapabilityManager
  readRun(projectId: string, ownerId: string): Promise<Run | undefined>
  readPreviewState?(projectId: string, ownerId: string): Promise<PreviewRunState | undefined>
  isBusy(run: PreviewRunState): boolean
  storage?: Pick<ReturnType<typeof createPreviewStorageStore>, 'forProject'>
}) {
  let origin: URL | undefined
  if (input.origin) {
    const parsed = new URL(input.origin)
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' ||
        !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(parsed.hostname) ||
        /^[0-9.]+$/.test(parsed.hostname) || parsed.hostname.includes('..') ||
        !(parsed.protocol === 'https:' || parsed.protocol === 'http:' && parsed.hostname === 'localhost'))
      throw new Error('V3 Preview needs a bare HTTPS wildcard domain origin (HTTP localhost allowed)')
    origin = parsed
  }
  const byHost = new Map<string, Entry>(), byProject = new Map<string, Entry>()
  let disposed = false
  const readState = input.readPreviewState ?? input.readRun
  const key = (projectId: string, ownerId: string, kind: Entry['kind'] = 'measured', writerId?: string) => JSON.stringify([projectId, ownerId, kind, writerId])
  const writerMatches = (run: PreviewRunState, writer: NonNullable<Run['writer']>) => run.writer?.attemptId === writer.attemptId &&
    run.writer.fence === writer.fence && run.writer.workerId === writer.workerId
  const drop = (entry: Entry) => {
    byHost.delete(new URL(entry.view.url).hostname)
    const identity=key(entry.projectId,entry.ownerId,entry.kind,entry.kind==='candidate'?entry.writer?.attemptId:undefined)
    if (byProject.get(identity) === entry) byProject.delete(identity)
    input.capabilities.revokeSession(entry.identity)
  }
  async function validate(entry: Entry) {
    const capability = input.capabilities.resolveRoute(entry.token)
    if (capability?.sessionId !== entry.identity || capability.userId !== entry.ownerId)
      throw new WorkflowError('preview-revoked', 'Preview capability is no longer valid')
    const state = await readState(entry.projectId, entry.ownerId)
    if (!state || state.id !== entry.view.runId || state.projectId !== entry.projectId ||
        state.ownerId !== entry.ownerId || state.workspacePath !== entry.workspace)
      throw new WorkflowError('preview-stale', 'Preview Run or workspace changed')
    if (entry.kind === 'candidate') {
      if (entry.writer ? !writerMatches(state,entry.writer) : state.writer || input.isBusy(state))
        throw new WorkflowError('workspace-busy', entry.writer ? 'Preview belongs to a different or ended native writer' : 'Wait for the project writer to stop before opening Preview')
      return state
    }
    if (state.writer || input.isBusy(state)) throw new WorkflowError('workspace-busy', 'Wait for the native writer and owned tools to stop')
    // Resource fan-out shares only the check already running for this revision.
    // Never retain a freshness result: later requests must see external edits.
    if (!entry.validation || entry.validation.version !== state.version)
      entry.validation = {version:state.version,result:(async () => {
        // Reuse the opened measurement at the same committed revision. Disk input
        // checks below still run; a changed revision requires the current full Run.
        const run = state.version === entry.run.version ? entry.run : await input.readRun(entry.projectId, entry.ownerId)
        if (!run || run.id !== state.id || run.workspacePath !== state.workspacePath || run.version !== state.version ||
            run.projectId !== state.projectId || run.ownerId !== state.ownerId)
          throw new WorkflowError('preview-stale', 'Workflow changed while reading Preview evidence')
        const selected = await selectAgentMeasuredBuild(run,entry.view.measurementId,input.isBusy(run),'preview')
        if (selected.artifact.path !== entry.view.artifact.path || selected.artifact.sha256 !== entry.view.artifact.sha256)
          throw new WorkflowError('preview-stale', 'Measured artifact changed; explicitly reopen after verification')
        // A later plain message may keep the same measured URL inspectable.
        // Refresh its diagnostic caveats even when reusing an existing capability.
        for (const limitation of selected.limitations)
          if (!entry.view.limitations.includes(limitation)) entry.view.limitations.push(limitation)
        entry.run = run
      })()}
    const pending = entry.validation
    try { await pending.result }
    finally { if (entry.validation === pending) delete entry.validation }
    return state
  }
  async function open(run: Run, measurementId: string): Promise<MeasuredPreview> {
      if (disposed) throw new WorkflowError('preview-unavailable', 'Preview manager stopped', 503)
      if (!origin) throw new WorkflowError('preview-unavailable', 'Configure BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN and route its wildcard hosts to BGS; no dev-script fallback.', 503)
      const selected = await selectAgentMeasuredBuild(run,measurementId,input.isBusy(run),'preview')
      const files = await measuredFiles(run, selected)
      const latest = await input.readRun(run.projectId, run.ownerId)
      if (disposed || !latest || latest.version !== run.version || input.isBusy(latest) || latest.writer)
        throw new WorkflowError('preview-stale', 'Workflow changed while opening Preview; refresh')
      const prior = byProject.get(key(run.projectId, run.ownerId))
      if (prior?.kind === 'measured' && prior.view.attemptId === selected.turn.attemptId && prior.view.measurementId === measurementId &&
          prior.view.artifact.sha256 === selected.artifact.sha256) {
        try {
          await validate(prior)
          if (!disposed && byProject.get(key(run.projectId, run.ownerId)) === prior) return prior.view
        } catch { drop(prior) }
      } else if (prior) drop(prior)
      // Reuse the existing capability authority, without inventing a native session.
      if (disposed) throw new WorkflowError('preview-unavailable', 'Preview manager stopped', 503)
      if (byProject.has(key(run.projectId, run.ownerId)))
        throw new WorkflowError('preview-conflict', 'Preview changed while opening; refresh instead of replacing the newer capability')
      const identity = 'v3-preview:'+run.id+':'+crypto.randomUUID()
      const token = input.capabilities.issueRouteId(identity, run.ownerId)
      const hostname = digest(token).slice(0, 48)+'.'+origin.hostname
      const url = new URL(origin); url.hostname = hostname
      const view: MeasuredPreview = { id: hostname.split('.')[0]!, runId: run.id, attemptId:selected.turn.attemptId, measurementId,
        artifact: selected.artifact, url: url.toString(), limitations: [...(selected.smoke.coverage?.limitations ?? []),
          ...selected.limitations,
          ...(selected.turn.status !== 'ended'
            ? ['The native turn did not succeed. This Preview only inspects current measured bytes; export and publication remain unavailable.'] : []),
          'Sandbox Preview only. Native localStorage remains unavailable; the async Preview save API is separate from deployment saves. No same-origin privileges, HTML injection or new runtime verdict. Explicit user publication is separate.'] }
      const entry: Entry = { kind: 'measured', view, run: structuredClone(run), token, identity, projectId: run.projectId, ownerId: run.ownerId, workspace: run.workspacePath, files }
      byProject.set(key(run.projectId, run.ownerId), entry); byHost.set(hostname, entry)
      return view
  }
  return {
    openAgent: open,
    async openCandidate(run: Run, writer?: NonNullable<Run['writer']>): Promise<CandidatePreview> {
      if (disposed || !origin) throw new WorkflowError('preview-unavailable', 'Configure the isolated Preview origin before opening a static build', 503)
      if (writer ? !writerMatches(run,writer) : run.writer || input.isBusy(run))
        throw new WorkflowError('workspace-busy', 'Preview must belong to the current writer, or wait for the project writer to stop')
      // A recorded output path is only a discovery hint, never a prerequisite
      // or authority. Otherwise use existing conventional Web build folders.
      const hint = run.agentTurns?.flatMap(turn => turn.measurements ?? []).at(-1)?.runtimeArtifact
      let folder: string | undefined, paths: string[] = []
      for (const candidate of new Set([hint, 'dist', 'build', 'out', 'client/dist', 'client/build'].filter((path): path is string => Boolean(path)))) {
        if (candidate.includes('\\') || candidate.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules' || part === 'transcripts')) continue
        try {
          const files = await staticArtifactFiles(run.workspacePath, candidate)
          if (files.includes(candidate+'/index.html')) { folder = candidate; paths = files; break }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new WorkflowError('preview-build-invalid', candidate+': '+(error instanceof Error ? error.message : 'Cannot read static build'), 409)
        }
      }
      if (!folder) throw new WorkflowError('preview-build-missing',
        'No existing static Web build with index.html was found (dist, build, out or client/dist). Run the project normal build first; Measure is not required. Preview did not start a build, test or Agent.', 409)
      const files = new Map<string,string>()
      for (const path of paths) files.set(path.slice(folder.length+1), (await readVersion(run.workspacePath, path)).sha256)
      const artifact = {path:folder,sha256:await artifactDigest(run.workspacePath,folder,true)}
      const latest = await input.readRun(run.projectId,run.ownerId)
      if (disposed || !latest || latest.id !== run.id || latest.workspacePath !== run.workspacePath ||
          (writer ? !writerMatches(latest,writer) : latest.writer || input.isBusy(latest)))
        throw new WorkflowError('preview-stale', 'Project binding or writer changed while opening Preview')
      const candidateKey=key(run.projectId,run.ownerId,'candidate',writer?.attemptId)
      const prior = byProject.get(candidateKey)
      if (prior?.kind === 'candidate' && (writer ? prior.writer && writerMatches(run,prior.writer) : !prior.writer) &&
          prior.view.runId === run.id && prior.view.artifact.path === folder && prior.view.artifact.sha256 === artifact.sha256 && input.capabilities.resolveRoute(prior.token)?.sessionId === prior.identity) return prior.view
      if (prior) drop(prior)
      const identity = 'v3-candidate-preview:'+run.id+':'+crypto.randomUUID()
      const token = input.capabilities.issueRouteId(identity,run.ownerId)
      const url = new URL(origin); url.hostname = digest(token).slice(0,48)+'.'+origin.hostname
      const view: CandidatePreview = {id:url.hostname.split('.')[0]!,runId:run.id,artifact,url:url.toString(),limitations:[
        `Existing static build ${folder}; not measured delivery or game acceptance. Source/report/requirement changes do not block viewing this build; it may differ from current source. No build, test or Agent was started.`,
      ]}
      const entry: Entry = {kind:'candidate',view,token,identity,projectId:run.projectId,ownerId:run.ownerId,workspace:run.workspacePath,files,
        ...(writer?{writer:{...writer}}:{})}
      byProject.set(candidateKey,entry);byHost.set(url.hostname,entry)
      return view
    },
    async candidateStatus(projectId: string, ownerId: string): Promise<{preview:CandidatePreview|null;reason?:string}> {
      const entry = byProject.get(key(projectId,ownerId,'candidate'))
      if (entry?.kind !== 'candidate') return {preview:null}
      try { await validate(entry); return {preview:byProject.get(key(projectId,ownerId,'candidate'))===entry?entry.view:null} }
      catch (error) { drop(entry);return {preview:null,reason:error instanceof WorkflowError?error.message:'Candidate Preview is unavailable'} }
    },
    closeCandidate(projectId: string, ownerId: string, id: string, writerId?: string) {
      const entry = byProject.get(key(projectId,ownerId,'candidate',writerId))
      if (entry && entry.view.id !== id) throw new WorkflowError('preview-conflict','This is not the current Preview; refresh before closing')
      if (entry) drop(entry)
    },
    async status(projectId: string, ownerId: string): Promise<{ preview: MeasuredPreview | null; reason?: string }> {
      const entry = byProject.get(key(projectId, ownerId))
      if (entry?.kind !== 'measured') return { preview: null }
      try { await validate(entry); return { preview: byProject.get(key(projectId, ownerId)) === entry ? entry.view : null } }
      catch (error) { drop(entry); return { preview: null, reason: error instanceof WorkflowError ? error.message : 'Preview evidence is unavailable' } }
    },
    close(projectId: string, ownerId: string, id: string) {
      const entry = byProject.get(key(projectId, ownerId))
      if (entry && entry.view.id !== id) throw new WorkflowError('preview-conflict', 'This is not the current Preview; refresh before closing')
      if (entry) drop(entry)
    },
    async handle(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url)
      // All paths/methods on the configured preview origin are isolated from APIs.
      if (!origin || !(url.hostname === origin.hostname || url.hostname.endsWith('.'+origin.hostname))) return undefined
      // The localhost base origin is the BGS API too; only subdomains are Preview.
      if (url.hostname === 'localhost') return undefined
      const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Expose-Headers': 'X-BeeGame-Preview-Mode, '+PREVIEW_STORAGE_HEADER,
        ...(input.storage ? { [PREVIEW_STORAGE_HEADER]: PREVIEW_STORAGE_VERSION } : {}),
        'X-BeeGame-Preview-Mode': 'measured-static' }
      const failure = (status: number, message: string) => new Response(message, { status, headers })
      const entry = byHost.get(url.hostname)
      if (entry?.kind === 'candidate') headers['X-BeeGame-Preview-Mode'] = 'candidate-static'
      // A TLS reverse proxy may reach BGS over HTTP/a different internal port.
      // Match the configured host namespace and bearer, never trust forwarded
      // headers to select an origin or an upstream. HTTPS is in the issued URL.
      if (!entry) return failure(404, 'Preview not found or revoked')
      if (url.pathname === PREVIEW_STORAGE_PATH && input.storage) {
        return handlePreviewStorageRequest(request, input.storage.forProject(entry.ownerId, entry.projectId), async () => {
          try { await validate(entry) }
          catch { drop(entry); throw new PreviewStorageError('Preview capability expired; reopen Preview', 409) }
          if (disposed || byHost.get(url.hostname) !== entry) throw new PreviewStorageError('Preview capability revoked', 409)
        })
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return failure(405, 'Static Preview is read-only')
      try {
        const run = await validate(entry)
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
        let path: string
        try { path = decodeURIComponent(url.pathname).slice(1) || 'index.html' } catch { return failure(400, 'Invalid file path') }
        const missingFile = entry.kind === 'candidate' ? 'File not in the opened build' : 'File not measured'
        if (path.includes('\\') || path.split('/').some(p => !p || p === '..' || p.startsWith('.'))) return failure(404, missingFile)
        const expected = entry.files.get(path)
        if (!expected) return failure(404, missingFile)
        const file = resolve(entry.workspace, entry.view.artifact.path, path)
        if (await realpath(file) !== file) throw new WorkflowError('preview-stale', 'Preview file became an alias')
        const bytes = await readFile(file)
        if (digest(bytes) !== expected) throw new WorkflowError('preview-stale', 'Preview file changed')
        const after = await readState(entry.projectId, entry.ownerId)
        if (!after || after.id !== run.id || after.workspacePath !== run.workspacePath ||
            after.projectId !== entry.projectId || after.ownerId !== entry.ownerId ||
            (entry.kind==='candidate' && entry.writer ? !writerMatches(after,entry.writer) :
            after.version !== run.version || after.writer || input.isBusy(after)) ||
            byHost.get(url.hostname) !== entry || !input.capabilities.resolveRoute(entry.token))
          throw new WorkflowError('preview-stale', 'Workflow changed during file read')
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
          ...headers, 'Content-Type': Bun.file(file).type || 'application/octet-stream', 'Content-Length': String(bytes.length),
        } })
      } catch (error) {
        drop(entry)
        return failure(409, error instanceof WorkflowError ? error.message : entry.kind === 'candidate'
          ? 'Preview build is unavailable; reopen Preview after saving the build' : 'Preview evidence is unavailable; explicitly reopen after verification')
      }
    },
    dispose() { disposed = true; for (const entry of byProject.values()) drop(entry) },
  }
}
export type MeasuredPreviewManager = ReturnType<typeof createMeasuredPreview>
