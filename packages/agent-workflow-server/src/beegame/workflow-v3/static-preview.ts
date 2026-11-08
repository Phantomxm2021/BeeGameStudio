import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PreviewCapabilityManager } from '../../auth/preview-capability'
import { digest, WorkflowError, type Run } from './state'
import { readArtifactSnapshot } from '../runtime-acceptance'
import { handlePreviewStorageRequest, PreviewStorageError, PREVIEW_STORAGE_PATH, PREVIEW_STORAGE_HEADER, PREVIEW_STORAGE_VERSION } from '../preview-storage.mjs'
import type { createPreviewStorageStore } from '../preview-storage-store'
import type { PreviewRunState } from './store'

export type CandidatePreview = {
  id: string; runId: string
  artifact: { path: string; sha256: string }; url: string; limitations: string[]
}
type Entry = { token: string; identity: string; projectId: string; ownerId: string
  workspace: string; files: Map<string, string>; view: CandidatePreview }

/** Serve isolated static bytes, not a project dev script or rewritten HTML.
 * A dedicated origin preserves root-absolute URLs and never exposes BGS routes.
 * Capabilities are ephemeral; restart requires explicit reopening, not work replay. */
export function createStaticPreview(input: {
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
  const key = (projectId: string, ownerId: string) => JSON.stringify([projectId, ownerId])
  const drop = (entry: Entry) => {
    byHost.delete(new URL(entry.view.url).hostname)
    const identity=key(entry.projectId,entry.ownerId)
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
    if (state.writer || input.isBusy(state))
      throw new WorkflowError('workspace-busy', 'Wait for the project writer to stop before opening Preview')
    return state
  }
  return {
    async openCandidate(run: Run): Promise<CandidatePreview> {
      if (disposed || !origin) throw new WorkflowError('preview-unavailable', 'Configure the isolated Preview origin before opening a static build', 503)
      if (run.writer || input.isBusy(run))
        throw new WorkflowError('workspace-busy', 'Wait for the project writer to stop')
      // A recorded output path is only a discovery hint, never a prerequisite
      // or authority. Otherwise use existing conventional Web build folders.
      const hint = run.agentTurns?.flatMap(turn => turn.measurements ?? []).at(-1)?.runtimeArtifact
      let folder: string | undefined, snapshot: Awaited<ReturnType<typeof readArtifactSnapshot>> | undefined
      for (const candidate of new Set([hint, 'dist', 'build', 'out', 'client/dist', 'client/build'].filter((path): path is string => Boolean(path)))) {
        if (candidate.includes('\\') || candidate.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules' || part === 'transcripts')) continue
        try {
          const observed = await readArtifactSnapshot(run.workspacePath, candidate)
          if (observed.files.has(candidate+'/index.html')) { folder = candidate; snapshot = observed; break }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new WorkflowError('preview-build-invalid', candidate+': '+(error instanceof Error ? error.message : 'Cannot read static build'), 409)
        }
      }
      if (!folder || !snapshot) throw new WorkflowError('preview-build-missing',
        'No existing static Web build with index.html was found (dist, build, out or client/dist). Run the project normal build first; Measure is not required. Preview did not start a build, test or Agent.', 409)
      const files = new Map<string,string>()
      for (const [path,sha256] of snapshot.files) files.set(path.slice(folder.length+1),sha256)
      const artifact = {path:folder,sha256:snapshot.sha256}
      const latest = await readState(run.projectId,run.ownerId)
      if (disposed || !latest || latest.id !== run.id || latest.workspacePath !== run.workspacePath ||
          (latest.writer || input.isBusy(latest)))
        throw new WorkflowError('preview-stale', 'Project binding or writer changed while opening Preview')
      const candidateKey=key(run.projectId,run.ownerId)
      const prior = byProject.get(candidateKey)
      if (prior &&
          prior.view.runId === run.id && prior.view.artifact.path === folder && prior.view.artifact.sha256 === artifact.sha256 && input.capabilities.resolveRoute(prior.token)?.sessionId === prior.identity) return prior.view
      if (prior) drop(prior)
      const identity = 'v3-candidate-preview:'+run.id+':'+crypto.randomUUID()
      const token = input.capabilities.issueRouteId(identity,run.ownerId)
      const url = new URL(origin); url.hostname = digest(token).slice(0,48)+'.'+origin.hostname
      const view: CandidatePreview = {id:url.hostname.split('.')[0]!,runId:run.id,artifact,url:url.toString(),limitations:[
        `Existing static build ${folder}; not measured delivery or game acceptance. Source/report/requirement changes do not block viewing this build; it may differ from current source. No build, test or Agent was started.`,
      ]}
      const entry: Entry = {view,token,identity,projectId:run.projectId,ownerId:run.ownerId,workspace:run.workspacePath,files}
      byProject.set(candidateKey,entry);byHost.set(url.hostname,entry)
      return view
    },
    async candidateStatus(projectId: string, ownerId: string): Promise<{preview:CandidatePreview|null;reason?:string}> {
      const entry = byProject.get(key(projectId,ownerId))
      if (!entry) return {preview:null}
      try { await validate(entry); return {preview:byProject.get(key(projectId,ownerId))===entry?entry.view:null} }
      catch (error) { drop(entry);return {preview:null,reason:error instanceof WorkflowError?error.message:'Candidate Preview is unavailable'} }
    },
    closeCandidate(projectId: string, ownerId: string, id: string) {
      const entry = byProject.get(key(projectId,ownerId))
      if (entry && entry.view.id !== id) throw new WorkflowError('preview-conflict','This is not the current Preview; refresh before closing')
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
        'X-BeeGame-Preview-Mode': 'candidate-static' }
      const failure = (status: number, message: string) => new Response(message, { status, headers })
      const entry = byHost.get(url.hostname)
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
        const missingFile = 'File not in the opened build'
        if (path.includes('\\') || path.split('/').some(p => !p || p === '..' || p.startsWith('.'))) return failure(404, missingFile)
        const expected = entry.files.get(path)
        if (!expected) return failure(404, missingFile)
        const file = resolve(entry.workspace, entry.view.artifact.path, path)
        if (await realpath(file) !== file) throw new WorkflowError('preview-stale', 'Preview file became an alias')
        const bytes = await readFile(file)
        if (digest(bytes) !== expected) throw new WorkflowError('preview-stale', 'Preview file changed')
        const after = await readState(entry.projectId, entry.ownerId)
        if (!after || after.id !== entry.view.runId || after.workspacePath !== entry.workspace ||
            after.projectId !== entry.projectId || after.ownerId !== entry.ownerId ||
            (after.version !== run.version || after.writer || input.isBusy(after)) ||
            byHost.get(url.hostname) !== entry || !input.capabilities.resolveRoute(entry.token))
          throw new WorkflowError('preview-stale', 'Workflow changed during file read')
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
          ...headers, 'Content-Type': Bun.file(file).type || 'application/octet-stream', 'Content-Length': String(bytes.length),
        } })
      } catch (error) {
        drop(entry)
        return failure(409, error instanceof WorkflowError ? error.message : 'Preview build is unavailable; reopen Preview after saving the build')
      }
    },
    dispose() { disposed = true; for (const entry of byProject.values()) drop(entry) },
  }
}
export type StaticPreviewManager = ReturnType<typeof createStaticPreview>
