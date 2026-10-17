import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { digest, WorkflowError, type Run } from './state'
import { MANAGED_WEB_BOOT_PATHS, MANAGED_WEB_BOOT_VERSION } from './managed-web-boot'

export type WorkflowStore = {
  read(projectId: string, actorId: string): Promise<Run | undefined>
  commit(projectId: string, actorId: string, expectedVersion: number, next: Run, event: string): Promise<void>
}
// JSONB may reorder keys. Compare JSON values, normalizing optional fields
// as storage does, not the serialization order of an authorization.
export function sameJson(a: unknown, b: unknown): boolean {
  const value = (x: unknown) => x === undefined ? undefined : JSON.parse(JSON.stringify(x))
  return isDeepStrictEqual(value(a), value(b))
}
type RetiredTaskFields = { plans?: unknown; tasks?: unknown; attempts?: unknown }
function emptyRetiredTaskFields(run: Run): boolean {
  const { plans, tasks, attempts } = run as Run & RetiredTaskFields
  return (plans === undefined || Array.isArray(plans) && plans.length === 0) &&
    (tasks === undefined || tasks !== null && typeof tasks === 'object' && !Array.isArray(tasks) && Object.keys(tasks).length === 0) &&
    (attempts === undefined || Array.isArray(attempts) && attempts.length === 0)
}
function currentAgentRun(run: Run): Run {
  if (!Array.isArray(run.agentTurns) || !emptyRetiredTaskFields(run)) return run
  const { plans: _plans, tasks: _tasks, attempts: _attempts, ...current } = run as Run & RetiredTaskFields
  return current as Run
}
// Explicit single-process development backend. Never a fallback for a missing DB migration.
const queues = new Map<string, Promise<void>>()
export function createLocalWorkflowStore(dataRoot: string): WorkflowStore {
  mkdirSync(dataRoot, { recursive: true })
  const root = realpathSync(dataRoot)
  const filename = (projectId: string) => join(root, 'workflow-v3', digest(projectId)+'.json')
  const load = async (projectId: string): Promise<{ run: Run; events: unknown[] } | undefined> => {
    try { return JSON.parse(await readFile(filename(projectId), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  return {
    async read(projectId, actorId) {
      const value = await load(projectId)
      if (value && value.run.ownerId !== actorId) throw new WorkflowError('project-forbidden', 'Workflow belongs to another project owner', 403)
      return value?.run ? currentAgentRun(value.run) : undefined
    },
    async commit(projectId, actorId, expectedVersion, next, event) {
      const file = filename(projectId), lock = join(root, 'workflow-v3')+':'+next.workspacePath, prior = queues.get(lock) ?? Promise.resolve()
      const work = prior.catch(() => {}).then(async () => {
        const value = await load(projectId)
        if (value && value.run.ownerId !== actorId) throw new WorkflowError('project-forbidden', 'Workflow belongs to another project owner', 403)
        if ((value?.run.version ?? 0) !== expectedVersion) throw new WorkflowError('revision-conflict', 'Workflow changed; read the current revision')
        assertCommit(projectId, actorId, expectedVersion, next, value?.run)
        await mkdir(join(root, 'workflow-v3'), { recursive: true })
        if (next.writer) for (const name of await readdir(join(root, 'workflow-v3'))) {
          if (!name.endsWith('.json') || join(root, 'workflow-v3', name) === file) continue
          const other = JSON.parse(await readFile(join(root, 'workflow-v3', name), 'utf8')) as { run: Run }
          if (other.run.workspacePath === next.workspacePath && other.run.writer)
            throw new WorkflowError('workspace-busy', 'Another project owns the unresolved workspace writer')
        }
        const temporary = file+'.'+randomUUID()+'.tmp'
        await writeFile(temporary, JSON.stringify({ run: next, events: [...(value?.events ?? []),
          { version: next.version, event, createdAt: new Date().toISOString(), snapshot: next }] }), { mode: 0o600 })
        await rename(temporary, file)
      })
      const marker = work.then(() => {}, () => {}); queues.set(lock, marker)
      try { await work } finally { if (queues.get(lock) === marker) queues.delete(lock) }
    },
  }
}
export function assertCommit(projectId: string, actorId: string, version: number, next: Run, prior?: Run) {
  if (next.projectId !== projectId || next.ownerId !== actorId || next.protocol !== 'bgs.workflow.v3' || next.version !== version+1)
    throw new WorkflowError('invalid-commit', 'Invalid identity or revision', 400)
  if (prior && (prior.id !== next.id || prior.chatSessionId !== next.chatSessionId || prior.workspacePath !== next.workspacePath))
    throw new WorkflowError('immutable-source', 'Run identity and original requirements cannot be overwritten')
  if (prior && !sameJson(prior.creation, next.creation))
    throw new WorkflowError('immutable-source', 'Observed project creation facts cannot be rewritten')
  if (prior?.webBoot && !sameJson(prior.webBoot, next.webBoot))
    throw new WorkflowError('immutable-web-boot', 'Installed Web startup/storage wiring cannot be replaced by a follow-up')
  if (!prior?.webBoot && next.webBoot && (!prior?.writer ||
      next.creation?.webBoot !== MANAGED_WEB_BOOT_VERSION || next.webBoot.version !== MANAGED_WEB_BOOT_VERSION ||
      !next.designBaseline || next.writer?.attemptId !== prior.writer.attemptId ||
      !sameJson(next.webBoot.files.map(file => file.path), MANAGED_WEB_BOOT_PATHS) ||
      next.webBoot.files.some(file => !/^[a-f0-9]{64}$/.test(file.sha256))))
    throw new WorkflowError('invalid-web-boot', 'Managed Web entry requires the current implementation writer and host-installed file identities')
  if (prior && (!Array.isArray(prior.agentTurns) || !emptyRetiredTaskFields(prior)))
    throw new WorkflowError('task-mode-retired', 'This older Task Run is read-only; it cannot be migrated implicitly')
  if (!Array.isArray(next.agentTurns) || 'plans' in next || 'tasks' in next || 'attempts' in next)
    throw new WorkflowError('invalid-commit','Only Agent Runs without host Task execution are writable')
  if (prior?.designBaseline && !sameJson(prior.designBaseline,next.designBaseline)) {
    const added = next.agentTurns.length === (prior.agentTurns?.length ?? 0) + 1 ? next.agentTurns.at(-1) : undefined
    const explicitChange = !prior.writer && !next.designBaseline && added?.message?.intent === 'change'
    const baseline = next.designBaseline, old = prior.designBaseline
    const edit = next.sourceEdits?.find(edit => edit.attemptId === baseline?.sourceEditId)
    const oldEdit = prior.sourceEdits?.find(item => item.attemptId === edit?.attemptId)
    const path = edit ? relative(next.workspacePath,resolve(next.workspacePath,edit.sourceEdit.path)).split('\\').join('/') : ''
    const changed = baseline ? [...new Set([...Object.keys(old.supportingFiles),...Object.keys(baseline.supportingFiles)])]
      .filter(file=>old.supportingFiles[file]!==baseline.supportingFiles[file]) : []
    const exactSourceSave = baseline && edit?.sourceEdit.status === 'saved' && oldEdit?.status === 'running' &&
      prior.writer?.attemptId === edit.attemptId && !next.writer && changed.length === 1 && changed[0] === path &&
      baseline.attemptId === old.attemptId && baseline.capturedAt === old.capturedAt &&
      baseline.requirementsRevision === old.requirementsRevision && baseline.digestVersion === old.digestVersion &&
      baseline.registryRevision === old.registryRevision &&
      sameJson(baseline.protectedFiles,old.protectedFiles)
    if (!explicitChange && !exactSourceSave)
      throw new WorkflowError('design-baseline-locked','Implementation baseline cannot be replaced by native work or a plain message')
  } else if (!prior?.designBaseline && next.designBaseline) {
    const baseline = next.designBaseline
    if (!prior?.writer || next.writer?.attemptId !== prior.writer.attemptId || baseline.attemptId !== prior.writer.attemptId ||
        baseline.requirementsRevision !== prior.requirements.revision || !/^[a-f0-9]{64}$/.test(baseline.revision))
      throw new WorkflowError('invalid-design-baseline','Design baseline requires the current implementation writer')
  }
  if(next.agentTurns?.some(t=>t.notStarted!==undefined && t.notStarted!==true))
    throw new WorkflowError('invalid-exit-evidence','No-start proof must be the literal host fact, not a user string or false flag')
  const oldEdits = prior?.sourceEdits ?? [], edits = next.sourceEdits ?? []
  if (edits.length && !next.agentTurns || edits.length < oldEdits.length || edits.length > oldEdits.length + 1 ||
      new Set(edits.map(e => e.requestKey)).size !== edits.length || new Set(edits.map(e => e.attemptId)).size !== edits.length)
    throw new WorkflowError('immutable-source-edit', 'Host save history must remain append-only and separately identified')
  for (const [i, edit] of edits.entries()) {
    const old = oldEdits[i]
    const owns = (run: Run | undefined) => run?.writer?.attemptId === edit.attemptId &&
      run.writer.fence === edit.fence && run.writer.workerId === edit.workerId
    if (edit.status === 'running' && (!owns(next) || edit.sourceEdit.status !== 'reserved'))
      throw new WorkflowError('invalid-exit-evidence', 'An unresolved host save must retain its reserved writer')
    if (!old) {
      if (!prior || prior.writer || prior.paused || !owns(next) || edit.fence !== prior.fence + 1 ||
          edit.status !== 'running' || edit.sourceEdit.status !== 'reserved' || edit.quiescedAt || edit.finishedAt ||
          !edit.requestHash || edit.requirementsRevision !== prior.requirements.revision)
        throw new WorkflowError('invalid-source-edit', 'A host save must reserve the free current writer before writing')
      continue
    }
    if (['attemptId','requestKey','requestHash','sessionId','workerId','fence','startedAt','requirementsRevision'].some(k =>
        edit[k as keyof typeof edit] !== old[k as keyof typeof old]) ||
        ['path','before','after','archive'].some(k => edit.sourceEdit[k as keyof typeof edit.sourceEdit] !== old.sourceEdit[k as keyof typeof old.sourceEdit]) ||
        old.status !== 'running' && !sameJson(edit, old) || old.quiescedAt && edit.quiescedAt !== old.quiescedAt)
      throw new WorkflowError('immutable-source-edit', 'Host save identity, exact byte evidence and settled history cannot be rewritten')
    if (edit.quiescedAt && !old.quiescedAt && (!owns(prior) || !owns(next) || edit.status !== 'running'))
      throw new WorkflowError('invalid-exit-evidence', 'Host save quiescence must retain its writer until settlement')
    if (old.status === 'running' && edit.status !== 'running' && (!old.quiescedAt || !owns(prior) || next.writer ||
        !edit.finishedAt || edit.sourceEdit.status !== (edit.status === 'failed' ? 'failed' : 'saved')))
      throw new WorkflowError('invalid-exit-evidence', 'Host save settlement requires durable quiescence before releasing its writer')
  }
  if (prior?.agentTurns) for (const old of prior.agentTurns) {
    const turn=next.agentTurns?.find(t=>t.attemptId===old.attemptId)
    if(!turn || ['attemptId','requestKey','sessionId','workerId','fence','startedAt','requirementsRevision'].some(k=>turn[k as keyof typeof turn]!==old[k as keyof typeof old]) ||
        !sameJson(turn.message,old.message) ||
        old.status!=='running' && !sameJson(old,turn) || old.quiescedAt && turn.quiescedAt!==old.quiescedAt)
      throw new WorkflowError('immutable-exit-evidence','Native goal execution history cannot be removed or rewritten')
    if(turn.quiescedAt && !old.quiescedAt && (old.status!=='running' || turn.status!=='running' ||
        prior.writer?.attemptId!==turn.attemptId || next.writer?.attemptId!==turn.attemptId ||
        prior.writer.workerId!==turn.workerId || next.writer.workerId!==turn.workerId ||
        prior.writer.fence!==turn.fence || next.writer.fence!==turn.fence))
      throw new WorkflowError('invalid-exit-evidence','Native quiescence must retain the current writer until settlement')
    if (turn.notStarted && turn.status==='ended' || old.notStarted && (!turn.notStarted || turn.nativeSessionId!==old.nativeSessionId || turn.turnId || turn.measurements?.length) ||
        turn.notStarted && !old.notStarted && (old.quiescedAt || !turn.quiescedAt || turn.status!=='running' || turn.turnId ||
          turn.measurements?.length || turn.usage || turn.skillUses?.length))
      throw new WorkflowError('invalid-exit-evidence','No-start proof must be recorded with original quiescence before execution, and remain immutable')
  }
  if(next.agentTurns?.some(t=>t.notStarted && !prior?.agentTurns?.some(old=>old.attemptId===t.attemptId)))
    throw new WorkflowError('invalid-exit-evidence','No-start proof cannot be prefilled on a new native reservation')
  if (prior) {
    const history = prior.requirementChanges ?? [], changes = next.requirementChanges ?? []
    if (history.some((change, i) => !sameJson(change,changes[i])))
      throw new WorkflowError('immutable-source', 'Authorized requirement history cannot be removed or rewritten')
    const changed = !sameJson(prior.requirements,next.requirements), last = changes.at(-1)
    if (changed ? changes.length !== history.length+1 || prior.writer || !last || last.actorId !== actorId || !last.requestKey ||
        changes.slice(0,-1).some(c => c.requestKey === last.requestKey) || !sameJson(last.before,prior.requirements) ||
        !sameJson(last.after,next.requirements) || next.requirements.revision === prior.requirements.revision ||
        next.requirements.sha256 !== digest(JSON.stringify({text:next.requirements.text,constraints:next.requirements.constraints,ids:next.requirements.ids})) ||
        next.planRevision !== prior.planRevision+1
      : changes.length !== history.length)
      throw new WorkflowError('immutable-source', 'Original requirements cannot be overwritten. Authorized changes need an append-only before/after record')
  }
}
export function createRemoteWorkflowStore(config: { url: string; serviceKey: string; fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }): WorkflowStore {
  const call = async (name: string, payload: unknown): Promise<Run | null> => {
    const response = await (config.fetchImpl ?? fetch)(config.url.replace(/\/+$/, '')+'/rest/v1/rpc/'+name, {
      method: 'POST', headers: { apikey: config.serviceKey, authorization: 'Bearer '+config.serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      // Do not leak server credentials or the requirements/SQL response into Chat.
      const detail = await response.json().catch(() => ({})) as { message?: string; code?: string }
      // Missing migration does not route existing legacy projects into V3.
      // A create/commit still fails explicitly; no local-storage fallback.
      if (name === 'beegame_workflow_v3_read' && detail.code === 'PGRST202') return null
      if (detail.code === 'PGRST202' || detail.code === 'PGRST205' || detail.code === '42P01')
        throw new WorkflowError('workflow-migration-required', 'V3 database schema/RPC is missing. Apply supabase/migrations/20261010010000_workflow_v3_vertical_slice.sql, then 20261010020000_workflow_v3_authorized_changes.sql and 20261010030000_workflow_v3_conflict_http.sql, and refresh the PostgREST schema cache. No local fallback or task execution.', 503)
      if (detail.message === 'workflow_revision_conflict') throw new WorkflowError('revision-conflict', 'Workflow changed; read the current revision')
      if (detail.message === 'workflow_workspace_busy') throw new WorkflowError('workspace-busy', 'Another project owns the unresolved workspace writer')
      if (detail.code === '23505' && detail.message?.includes('beegame_workflow_v3_one_writer'))
        throw new WorkflowError('workspace-busy', 'Another project owns the unresolved workspace writer')
      if (detail.message === 'workflow_project_forbidden') throw new WorkflowError('project-forbidden', 'Project access denied', 403)
      if (detail.message === 'workflow_immutable_source') throw new WorkflowError('immutable-source',
        name === 'beegame_workflow_v3_commit' && (payload as { p_event?: string }).p_event === 'requirements.changed'
          ? 'Authorized requirement change rejected by the database. Verify 20261010020000_workflow_v3_authorized_changes.sql is applied and the append-only requirement history is valid; do not retry or overwrite the original requirements.'
          : 'Original requirements and Run identity cannot be overwritten')
      if (detail.message === 'workflow_invalid_commit' || detail.message === 'workflow_invalid_workspace') throw new WorkflowError('invalid-commit', 'Invalid workflow identity, revision or workspace binding', 400)
      throw new WorkflowError('workflow-storage-unavailable', 'V3 database operation failed ('+response.status+'); verify migration and server configuration', 503)
    }
    return response.json()
  }
  return {
    async read(projectId, actorId) {
      const run = await call('beegame_workflow_v3_read', { p_project_id: projectId, p_actor_id: actorId })
      return run ? currentAgentRun(run) : undefined
    },
    async commit(projectId, actorId, expectedVersion, next, event) {
      // Existing RPC atomically checks identity/revision/writer and requirement
      // changes, but predates native-turn history. Reuse the same application
      // invariants as the local backend; the RPC CAS still closes the read/write
      // race. No additional model work or schema migration.
      const prior = expectedVersion > 0
        ? await call('beegame_workflow_v3_read', { p_project_id: projectId, p_actor_id: actorId }) ?? undefined
        : undefined
      if (expectedVersion > 0 && prior?.version !== expectedVersion)
        throw new WorkflowError('revision-conflict', 'Workflow changed; read the current revision')
      assertCommit(projectId, actorId, expectedVersion, next, prior)
      await call('beegame_workflow_v3_commit', { p_project_id: projectId, p_actor_id: actorId,
        p_expected_version: expectedVersion, p_state: next, p_event: event })
    },
  }
}
