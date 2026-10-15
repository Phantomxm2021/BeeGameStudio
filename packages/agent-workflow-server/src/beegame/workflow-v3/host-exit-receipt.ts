import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, realpath, lstat, open, link, unlink } from 'node:fs/promises'
import { join, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod/v4'
import { digest, WorkflowError, type Run, type AgentTurn } from './state'
import { sameJson } from './store'

// Exit facts only: never checks, outputs, an acceptance verdict or a request
// to replay. Signature key stays in the host; project files are not evidence.
export type HostExitFacts = Pick<AgentTurn, 'quiescedAt' | 'notStarted' | 'turnId' | 'nativeSessionId' | 'usage' | 'skillUses'>
export type HostExitReceipts = {
  save(run: Run, facts: HostExitFacts): Promise<void>
  read(run: Run): Promise<HostExitFacts | undefined>
}
const factsSchema = z.object({
  quiescedAt: z.string().datetime(), notStarted: z.literal(true).optional(),
  turnId: z.string().optional(), nativeSessionId: z.string().optional(), usage: z.unknown().optional(),
  skillUses: z.array(z.unknown()).optional(),
}).strict()
const invalid = () => new WorkflowError('exit-receipt-invalid',
  'Host exit receipt is unreadable, untrusted or belongs to another writer; no unlock or automatic retry', 503)

export function createHostExitReceipts(input: { dataRoot: string; key?: Uint8Array }): HostExitReceipts | undefined {
  // Reuse existing host configuration key; do not silently create a project
  // key or make a plaintext project assertion into trusted evidence.
  if (!input.key) return undefined
  if (input.key.byteLength !== 32) throw invalid()
  const key = createHmac('sha256', input.key).update('bgs.workflow.v3.host-exit-receipt.1').digest()
  const binding = (run: Run) => {
    const writer = run.writer
    const record = writer && (run.sourceEdits?.find(a => a.attemptId === writer.attemptId) ??
      run.agentTurns?.find(a => a.attemptId === writer.attemptId))
    if (!writer || !record || record.status !== 'running' || writer.fence !== record.fence || writer.workerId !== record.workerId)
      throw invalid()
    return { runId: run.id, projectId: run.projectId, ownerId: run.ownerId, workspacePath: run.workspacePath,
      chatSessionId: run.chatSessionId, attemptId: record.attemptId, workerId: record.workerId, fence: record.fence,
      sessionId: record.sessionId, requestKey: record.requestKey, startedAt: record.startedAt,
      requirementsRevision: 'requirementsRevision' in record ? record.requirementsRevision : run.requirements.revision,
      sourceEdit: 'sourceEdit' in record ? record.sourceEdit && {path:record.sourceEdit.path,before:record.sourceEdit.before,
        after:record.sourceEdit.after,archive:record.sourceEdit.archive} : undefined,
      kind: run.sourceEdits?.some(a=>a.attemptId===record.attemptId) ? 'source-edit' :
        'agent' }
  }
  const rootFor = async (run: Run, create=false) => {
    // Resolve the existing host parent before creating anything: a configured
    // project path or parent alias must not place records inside game sources.
    const root = join(await realpath(input.dataRoot), 'workflow-v3-exits'), workspace = await realpath(run.workspacePath)
    const within = relative(workspace, root)
    if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..'+sep))
      throw invalid()
    if(create)await mkdir(root, { recursive: true, mode: 0o700 })
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid()
    return root
  }
  const filename = (run: Run) => digest(JSON.stringify(binding(run)))+'.json'
  const signature = (payload: string) => createHmac('sha256', key).update(payload).digest('hex')
  const readAt = async (run: Run, root: string): Promise<HostExitFacts | undefined> => {
    let file
    try {
      file = await open(join(root, filename(run)), constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 2*1024*1024) throw invalid()
      const value = JSON.parse(await file.readFile('utf8')) as { payload?: unknown; signature?: unknown }
      if (typeof value.payload !== 'string' || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature) ||
          !timingSafeEqual(Buffer.from(value.signature, 'hex'), Buffer.from(signature(value.payload), 'hex'))) throw invalid()
      const body = JSON.parse(value.payload)
      if (body.version !== 1 || !sameJson(body.binding, binding(run))) throw invalid()
      const facts = factsSchema.parse(body.facts) as HostExitFacts
      return facts
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw invalid()
    } finally { await file?.close() }
  }
  return {
    async read(run) {
      try { return await readAt(run, await rootFor(run)) }
      catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
    },
    async save(run, value) {
      const facts = factsSchema.parse(value), root = await rootFor(run,true), file = join(root, filename(run))
      const existing = await readAt(run, root)
      if (existing) { if (!sameJson(existing, facts)) throw invalid(); return }
      const payload = JSON.stringify({ version: 1, binding: binding(run), facts })
      const temporary = file+'.'+randomUUID()+'.tmp'
      const handle = await open(temporary, 'wx', 0o600)
      try {
        try { await handle.writeFile(JSON.stringify({ payload, signature: signature(payload) })); await handle.sync() }
        finally { await handle.close() }
        // Publish a complete fsynced receipt without replacing an earlier fact.
        try { await link(temporary, file) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !sameJson(await readAt(run, root), facts)) throw error
        }
        const directory = await open(root, 'r')
        try { await directory.sync() } finally { await directory.close() }
      } finally { await unlink(temporary) }
    },
  }
}

export async function saveHostExitReceipt(receipts: HostExitReceipts | undefined, run: Run, facts: HostExitFacts) {
  if (!receipts) return
  try { await receipts.save(run, facts) }
  catch {
    // This extra copy must not prevent the existing DB exit/settlement path.
    // The original in-memory observation remains; do not claim local durability.
    console.warn('[BGS V3] Host exit receipt unavailable', { attemptId: run.writer?.attemptId })
  }
}
