import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentIndexSchema, contentDocumentSchema } from '../game-content-schema'
import { digest, WorkflowError } from './state'
import { versionsMatch } from './checks'

/** A saved-source view, not an accepted package or a second design authority.
 * Uses the existing content contract, without legacy eight-document revisions. */
export async function readContentView(workspace: string, metadata = false) {
  const versions: { path: string; sha256: string }[] = []
  async function read(path: string) {
    if (!path.startsWith('content/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !path.endsWith('.json'))
      throw new WorkflowError('invalid-content-path', 'Registered JSON must be inside content/: '+path, 409)
    let target = workspace
    for (const part of path.split('/')) {
      target = resolve(target, part)
      if ((await lstat(target)).isSymbolicLink()) throw new WorkflowError('invalid-content-path', 'Content symlinks are not supported: '+path, 409)
    }
    if (!(await lstat(target)).isFile()) throw new WorkflowError('invalid-content-path', 'Registered content is not a regular file: '+path, 409)
    const bytes = await readFile(target)
    versions.push({ path, sha256: digest(bytes) })
    return JSON.parse(bytes.toString('utf8'))
  }
  const base = { protocol: 'bgs.workflow.v3' as const, readOnly: true as const,
    note: 'Current saved JSON only; not game acceptance or proof of runtime consumption. Changes require an authorized project edit; viewing does not authorize writes.' }
  let raw: unknown
  try { raw = await read('content/index.json') }
  catch (error) {
    // Only a genuinely absent index is pending, not an unsafe/malformed index.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...base, state: 'awaiting_content' as const }
    throw error
  }
  const index = contentIndexSchema.parse(raw), registry = index.documents
  if (!registry?.length || registry.length !== index.files.length || new Set(registry.map(d => d.id)).size !== registry.length ||
      new Set(registry.map(d => d.path)).size !== registry.length || index.files.some(path => !registry.some(d => d.path === path)))
    throw new WorkflowError('invalid-content-registry', 'Current v2 registry IDs/paths/files must agree', 409)
  const documents = []
  for (const entry of registry) {
    if (entry.path === 'index.json') throw new WorkflowError('invalid-content-registry', 'Registry cannot include its own index', 409)
    const document = contentDocumentSchema.parse(await read('content/'+entry.path))
    if (document.id !== entry.id || document.kind !== entry.kind)
      throw new WorkflowError('invalid-content-registry', 'Registry identity differs from saved JSON: '+entry.path, 409)
    const revision = versions.at(-1)!.sha256
    documents.push(metadata ? { path: entry.path, revision, id: document.id, kind: document.kind } : { path: entry.path, revision, document })
  }
  if (!await versionsMatch(workspace, versions)) throw new WorkflowError('content-changed', 'Saved content changed while loading; refresh after the writer stops', 409)
  return { ...base, state: 'draft' as const, contentRevision: digest(JSON.stringify(versions)), index, documents, sourceVersions: versions }
}
