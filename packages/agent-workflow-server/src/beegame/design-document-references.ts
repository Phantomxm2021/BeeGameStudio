import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { createHash } from 'node:crypto'
import { PROJECT_DOCUMENTS } from './project-content-authority'

type MarkdownNode = {
  type: string; url?: string; identifier?: string; value?: string
  position?: { start: { line: number } }; children?: MarkdownNode[]
}

/** Explicit design sources, not their semantics. Planned resources are checked separately. */
export function checkDesignDocumentReferences(workspacePath: string, document?: string) {
  const root = realpathSync(workspacePath)
  if (document !== undefined && !PROJECT_DOCUMENTS.some(name => name === document))
    throw new Error('Unknown design document')
  const files = document === undefined ? PROJECT_DOCUMENTS : [document]
  const revision = createHash('sha256').update(JSON.stringify({ document }))
  const issues: string[] = [], pendingReferences: string[] = [], uncitedDocuments: string[] = []
  let checkedReferences = 0
  const retainedFiles = new Set<string>()
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
      // Fragment-only links address this already-read document, not its
      // containing directory or a separate retained evidence file. This
      // checker verifies file references; it does not certify anchor targets.
      if (reference.path.startsWith('#')) continue
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
            else if (!PROJECT_DOCUMENTS.some(name => target === join(root, 'docs', name)))
              retainedFiles.add(relative(root, target).split(sep).join('/'))
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
        issues.push(`${location}: document reference does not exist: ${reference.path}`)
      }
    }
    if (!documentReferences) uncitedDocuments.push(`docs/${name}`)
  }
  return { valid: issues.length === 0, issues, checkedReferences,
    retainedFiles: [...retainedFiles].sort(),
    checkedDocuments: files.map(name => `docs/${name}`), inputRevision: revision.digest('hex'),
    pendingReferences: [...new Set(pendingReferences)], uncitedDocuments,
    note: 'Checks explicit local Markdown document references and retained file links outside planned assets/content; rejects links to platform-temporary files regardless of extension. Evidence existence is not evidence correctness. Unlinked titles, bare paths, section contents, decision ownership and semantic agreement remain unverified; no citations is not authority closure.' }
}
