import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ZodError } from 'zod/v4'
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
    return bytes.toString('utf8')
  }
  const base = { protocol: 'bgs.workflow.v3' as const, readOnly: true as const,
    note: 'Current saved JSON only; not game acceptance or proof of runtime consumption. Changes require an authorized project edit; viewing does not authorize writes.' }
  const describe = (error: unknown) => error instanceof ZodError
    ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')
    : error instanceof WorkflowError || error instanceof SyntaxError ? error.message
    : `Cannot read content (${(error as NodeJS.ErrnoException).code ?? 'read-error'})`
  let index: ReturnType<typeof contentIndexSchema.parse> | undefined
  const indexIssues: string[] = []
  try {
    index = contentIndexSchema.parse(JSON.parse(await read('content/index.json')))
    const registry = index.documents
    if (!registry?.length || registry.length !== index.files.length || new Set(registry.map(d => d.id)).size !== registry.length ||
        new Set(registry.map(d => d.path)).size !== registry.length || index.files.some(path => !registry.some(d => d.path === path)) ||
        registry.some(d => d.path === 'index.json'))
      throw new WorkflowError('invalid-content-registry', 'Current v2 registry IDs/paths/files must agree and cannot include its own index', 409)
  } catch (error) {
    if (!metadata) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...base, state: 'awaiting_content' as const }
      throw error
    }
    index = undefined
    indexIssues.push('content/index.json: '+describe(error))
  }
  // Navigation only: discover the two authoring directories without trusting a
  // broken registry or following links. Strict reads/saves still need the index.
  const discovered: { path: string; id: string; kind: string }[] = []
  async function discover(path: string, kind: 'scene' | 'ui') {
    try {
      let target = workspace
      for (const part of ('content/'+path).split('/')) {
        target = resolve(target, part)
        if ((await lstat(target)).isSymbolicLink()) throw new WorkflowError('invalid-content-path', 'Content symlinks are not supported: content/'+path, 409)
      }
      const stat = await lstat(target)
      if (stat.isDirectory()) {
        for (const child of (await readdir(target)).sort()) await discover(path+'/'+child, kind)
      } else if (stat.isFile() && path.endsWith('.json')) {
        discovered.push({ path, id: path.slice(path.lastIndexOf('/')+1, -5), kind })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') indexIssues.push(describe(error))
    }
  }
  if (!index) { await discover('scenes', 'scene'); await discover('ui', 'ui') }
  const registry = index?.documents ?? discovered
  const documents = []
  for (const entry of registry) {
    let revision: string | undefined
    try {
      const text = await read('content/'+entry.path)
      revision = versions.at(-1)!.sha256
      const document = contentDocumentSchema.parse(JSON.parse(text))
      if (index && (document.id !== entry.id || document.kind !== entry.kind))
        throw new WorkflowError('invalid-content-registry', 'Registry identity differs from saved JSON: '+entry.path, 409)
      documents.push(metadata ? { path: entry.path, revision, id: document.id, kind: document.kind } : { path: entry.path, revision, document })
    } catch (error) {
      // Browsing the registry must remain possible while one draft is invalid.
      // Full document reads and saves still require the existing strict contract.
      if (!metadata) throw error
      const message = describe(error)
      documents.push({ path: entry.path, revision, id: entry.id, kind: entry.kind, error: message })
    }
  }
  if (!await versionsMatch(workspace, versions)) throw new WorkflowError('content-changed', 'Saved content changed while loading; refresh after the writer stops', 409)
  return { ...base, state: 'draft' as const, contentRevision: digest(JSON.stringify(versions)), index, indexIssues, documents, sourceVersions: versions }
}
