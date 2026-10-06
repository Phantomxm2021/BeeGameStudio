import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { createHash } from 'node:crypto'
import { AUTHOR_BATCHES } from './project-author'
import { PROJECT_DOCUMENTS } from './project-content-authority'

type MarkdownNode = {
  type: string; url?: string; identifier?: string; value?: string
  position?: { start: { line: number } }; children?: MarkdownNode[]
}

/** Explicit design sources, not their semantics. Planned resources are checked at resource delivery. */
export function checkDesignDocumentReferences(workspacePath: string, authorBatch?: number, document?: string) {
  if (authorBatch !== undefined && (!Number.isInteger(authorBatch) || !AUTHOR_BATCHES[authorBatch]))
    throw new Error('Invalid author batch')
  const root = realpathSync(workspacePath)
  const batchFiles = authorBatch === undefined ? PROJECT_DOCUMENTS
    : [...new Set(AUTHOR_BATCHES.slice(0, authorBatch + 1).flat())]
  if (document !== undefined && (!PROJECT_DOCUMENTS.some(name => name === document) || !batchFiles.includes(document as typeof PROJECT_DOCUMENTS[number])))
    throw new Error('Document is not assigned to this reference-check scope')
  const files = document === undefined ? batchFiles : [document]
  const future = new Set(authorBatch === undefined ? [] : AUTHOR_BATCHES.slice(authorBatch + 1).flat()
    .filter(name => !batchFiles.includes(name)).map(name => join('docs', name)))
  // A local draft check may depend on an unfinished sibling. The host's
  // final batch check never uses this allowance or the narrowed source scope.
  const parallel = new Set(document !== undefined && authorBatch !== undefined
    ? AUTHOR_BATCHES[authorBatch]!.filter(name => name !== document).map(name => join('docs', name)) : [])
  const revision = createHash('sha256').update(JSON.stringify({ authorBatch, document }))
  const issues: string[] = [], pendingReferences: string[] = [], uncitedDocuments: string[] = []
  let checkedReferences = 0
  const inside = (path: string) => {
    const rel = relative(root, path)
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  }
  // This is the platform's existing transient namespace, not a project naming rule.
  // Existence during settlement cannot make its files durable delivery sources.
  const temporaryRoot = join(root, '.beegame', 'tmp')
  const temporary = (path: string) => path === temporaryRoot || path.startsWith(`${temporaryRoot}${sep}`)
  for (const name of files) {
    const source = join(root, 'docs', name)
    let tree: MarkdownNode
    try {
      const canonical = realpathSync(source)
      revision.update(JSON.stringify([name, canonical]))
      if (!inside(canonical)) { issues.push(`docs/${name}: source is outside the workspace`); continue }
      if (temporary(canonical)) { issues.push(`docs/${name}: source resolves to a platform-temporary file`); continue }
      const body = readFileSync(source, 'utf8')
      revision.update(JSON.stringify([name, canonical, body]))
      tree = fromMarkdown(body)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        revision.update(JSON.stringify([name, 'missing']))
        if (document !== undefined) issues.push(`docs/${name}: local draft is missing`)
        continue // The final delivery file check owns missing drafts.
      }
      throw error
    }
    const definitions = new Map<string, string>(), references: Array<{ path: string; line: number }> = []
    const walk = (node: MarkdownNode, visit: (node: MarkdownNode) => void) => {
      visit(node)
      for (const child of node.children ?? []) walk(child, visit)
    }
    walk(tree, node => {
      if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url)
    })
    walk(tree, node => {
      const path = ['link', 'image'].includes(node.type) ? node.url : ['linkReference', 'imageReference'].includes(node.type)
        ? definitions.get(node.identifier ?? '') : undefined
      if (path && !/^[a-z][a-z0-9+.-]*:/i.test(path))
        references.push({ path, line: node.position?.start.line ?? 1 })
    })
    let documentReferences = 0
    for (const reference of references) {
      const documentReference = /\.md(?:[?#].*)?$/i.test(reference.path)
      if (documentReference) { checkedReferences++; documentReferences++ }
      const location = `docs/${name}:${reference.line}`
      let path: string
      try { path = decodeURIComponent(reference.path.split(/[?#]/)[0]!) }
      catch { issues.push(`${location}: invalid document reference ${reference.path}`); continue }
      const target = resolve(dirname(source), path)
      // Retained calculation inputs/scripts are cited design evidence. Unlike
      // planned resources, they must exist when the document claims to use them.
      // An incorrect ../ must not turn cited evidence into an unchecked file.
      // Only the existing resource/content namespaces contain planned outputs;
      // other explicit file links claim a retained source now. Directory links
      // do not claim an individual evidence file.
      const stagedOutput = ['assets', 'content'].some(directory => {
        const namespace = join(root, directory)
        return target === namespace || target.startsWith(`${namespace}${sep}`)
      })
      const ownedUiLayout = name === 'UI_UX_SPEC.md' && /^content\/ui\/.+\.json$/.test(relative(root, target).split(sep).join('/'))
      const designEvidence = !documentReference && !path.endsWith('/') && (!stagedOutput || ownedUiLayout)
      const inspectTarget = documentReference || designEvidence
      if (designEvidence) checkedReferences++
      if (!inside(target)) { if (inspectTarget) issues.push(`${location}: ${documentReference ? 'document reference' : 'retained design evidence'} leaves the workspace: ${reference.path}`); continue }
      if (temporary(target)) {
        if (!inspectTarget) checkedReferences++
        issues.push(`${location}: platform-temporary reference cannot survive turn cleanup: ${reference.path}`)
        continue
      }
      try {
        const canonical = realpathSync(target)
        revision.update(JSON.stringify([target, canonical]))
        if (temporary(canonical)) {
          if (!inspectTarget) checkedReferences++
          issues.push(`${location}: reference resolves to a platform-temporary file: ${reference.path}`)
        } else if (inspectTarget) {
          const kind = documentReference ? 'document reference' : 'retained design evidence'
          if (!inside(canonical)) issues.push(`${location}: ${kind} resolves outside the workspace: ${reference.path}`)
          else {
            const file = statSync(target)
            revision.update(JSON.stringify([target, canonical, file.isFile()
              ? createHash('sha256').update(readFileSync(target)).digest('hex') : 'not-file']))
            if (!file.isFile() || !file.size) issues.push(`${location}: ${kind} is not a nonempty file: ${reference.path}`)
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        revision.update(JSON.stringify([target, 'missing']))
        if (designEvidence) {
          issues.push(`${location}: retained design evidence does not exist: ${reference.path}`)
          continue
        }
        if (!documentReference) continue // Persistent resource/contract checks belong to their existing validators.
        // Only an output genuinely assigned to a later batch may be absent. It is not current authority.
        if ((future.has(relative(root, target)) || parallel.has(relative(root, target))) && inside(realpathSync(dirname(target))))
          pendingReferences.push(`${location}: ${relative(root, target)} is assigned ${parallel.has(relative(root, target)) ? 'in parallel' : 'later'}, not delivered authority`)
        else issues.push(`${location}: document reference does not exist and is not assigned later: ${reference.path}`)
      }
    }
    if (!documentReferences) uncitedDocuments.push(`docs/${name}`)
  }
  return { valid: issues.length === 0, issues, checkedReferences,
    checkedDocuments: files.map(name => `docs/${name}`), inputRevision: revision.digest('hex'),
    pendingReferences: [...new Set(pendingReferences)], uncitedDocuments,
    note: 'Checks explicit local Markdown document references, retained file links outside planned assets/content and scheduled future documents; rejects links to platform-temporary files regardless of extension. Evidence existence is not evidence correctness. Unlinked titles, bare paths, section contents, decision ownership and semantic agreement remain unverified; no citations is not authority closure.' }
}
