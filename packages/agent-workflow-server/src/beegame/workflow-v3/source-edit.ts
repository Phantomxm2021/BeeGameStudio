import { mkdir, readFile, realpath, writeFile, rename, unlink, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { contentDocumentSchema } from '../game-content-schema'
import { readContentView } from './content-view'
import { versionsMatch } from './checks'
import { digest, WorkflowError, type Run } from './state'
import { sameJson } from './store'
import { findSourceEdit } from './changes'

export const editVersionSchema = z.object({ version: z.number().int().positive(), planRevision: z.number().int().nonnegative(),
  requirementsRevision: z.string().min(1) }).strict()
export const editSchema = z.object({ path: z.string().min(1), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  document: z.unknown(), workflow: editVersionSchema, requestKey: z.string().min(1).optional() }).strict()
export async function prepareSourceEdit(run: Run, value: unknown) {
  const body = editSchema.parse(value)
  if (body.workflow.version !== run.version || body.workflow.planRevision !== run.planRevision || body.workflow.requirementsRevision !== run.requirements.revision)
    throw new WorkflowError('revision-conflict', 'Run/requirements changed since this editor loaded. Reload current sources; saving cannot authorize a stale requirement version')
  const snapshot = await readContentView(run.workspacePath)
  if (snapshot.state !== 'draft') throw new WorkflowError('invalid-content-path', 'Registered formal content is not available', 400)
  const saved = snapshot.documents.find(d => d.path === body.path && 'document' in d)
  if (!saved || !('document' in saved) || !saved.document) throw new WorkflowError('invalid-content-path', 'Select an existing registered Scene/UI document', 400)
  if (saved.revision !== body.expectedRevision) throw new WorkflowError('content-changed', 'Saved document changed; reload before editing')
  const document = contentDocumentSchema.parse(body.document)
  if (!['scene-2d','scene-3d','ui-screen','ui-hud','ui-flow'].includes(document.kind) ||
      document.id !== saved.document.id || document.kind !== saved.document.kind)
    throw new WorkflowError('invalid-content-identity', 'Formal editing preserves registered document identity/kind. New content requires separately authorized project work', 400)
  const path = 'content/'+body.path, before = await readFile(join(run.workspacePath, path))
  if (digest(before) !== saved.revision) throw new WorkflowError('content-changed', 'Source changed while preparing the edit')
  const bytes = Buffer.from(JSON.stringify(document, null, 2)+'\n')
  // An unchanged editor save does not invalidate/rebuild the game.
  const unchanged = sameJson(document, saved.document)
  return { path, relativePath: body.path, before, bytes, document, beforeHash: saved.revision, afterHash: digest(bytes), unchanged,
    contentRevision: snapshot.contentRevision,
    nextContentRevision: digest(JSON.stringify(snapshot.sourceVersions.map(v => v.path === path ? { ...v, sha256: digest(bytes) } : v))),
    versions: snapshot.sourceVersions }
}
export async function writeSourceEdit(run: Run, attemptId: string, edit: Awaited<ReturnType<typeof prepareSourceEdit>>, signal: AbortSignal) {
  const record = findSourceEdit(run, attemptId)?.sourceEdit
  if (!record || run.writer?.attemptId !== attemptId || record.path !== edit.path || record.before !== edit.beforeHash || record.after !== edit.afterHash)
    throw new WorkflowError('invalid-edit', 'Source edit does not own this reserved writer')
  if (signal.aborted) throw new WorkflowError('edit-cancelled', 'Edit cancelled; candidate was not accepted')
  const root = run.workspacePath, target = join(root, edit.path), archive = join(root, record.archive)
  if (!await versionsMatch(root, edit.versions)) throw new WorkflowError('content-changed', 'Registered sources changed before saving; no blind overwrite')
  if (await realpath(target) !== target || (await lstat(target)).nlink !== 1)
    throw new WorkflowError('invalid-content-path', 'Source aliases/hard links are not supported')
  // Check each ancestor before creating descendants; recursive mkdir could
  // otherwise create an archive outside the project through an existing alias.
  let directory = root
  for (const part of dirname(record.archive).split('/')) {
    directory = join(directory, part)
    await mkdir(directory).catch(e => { if (e.code !== 'EEXIST') throw e })
    if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory())
      throw new WorkflowError('invalid-edit-archive', 'Host archive directory cannot be an alias')
  }
  await writeFile(archive, edit.before, { flag: 'wx', mode: 0o600 })
  if (digest(await readFile(archive)) !== record.before) throw new WorkflowError('invalid-edit-archive', 'Could not retain the exact prior source')
  const temporary = target+'.'+randomUUID()+'.tmp'
  try {
    await writeFile(temporary, edit.bytes, { flag: 'wx', mode: (await lstat(target)).mode & 0o777 })
    if (signal.aborted) throw new WorkflowError('edit-cancelled', 'Edit cancelled; candidate was not accepted')
    if (!await versionsMatch(root, edit.versions) || await realpath(target) !== target || (await lstat(target)).nlink !== 1)
      throw new WorkflowError('content-changed', 'Registered sources changed before replacement')
    await rename(temporary, target)
    if (!await versionsMatch(root, edit.versions.map(v => v.path === edit.path ? { ...v, sha256: record.after } : v)))
      throw new WorkflowError('content-changed', 'Registered sources changed before settlement; saved candidates are not accepted')
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e }) }
}
