import { posix } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { SingleReviewInput } from './single-agent-contract'

type Node = { type: string; children?: Node[]; url?: string; identifier?: string;
  position?: { start: { line: number } } }
const identifier = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** File facts only. No network/filesystem probing, inferred prose references,
 * semantic findings, severity assignments or acceptance decisions. */
export function buildReviewFileChecks(source: SingleReviewInput) {
  const files = [...source.documents.map(document => ({ path: document.path, role: 'deliverable' })),
    { path: 'requirements.md', role: 'host_evidence' }]
  const available = new Set(files.map(file => file.path))
  const links: { documentPath: string; line?: number; href: string; targetPath?: string;
    status: 'present' | 'absent_from_document_set' | 'outside_snapshot' | 'external' | 'unsupported' }[] = []
  for (const document of source.documents) {
    const tree = fromMarkdown(document.content)
    const definitions = new Map<string, string>()
    walk(tree, node => {
      if (node.type === 'definition' && node.identifier && node.url !== undefined && !definitions.has(identifier(node.identifier)))
        definitions.set(identifier(node.identifier), node.url)
    })
    walk(tree, node => {
      const href = node.type === 'link' || node.type === 'image' ? node.url
        : node.type === 'linkReference' || node.type === 'imageReference' ? definitions.get(identifier(node.identifier ?? '')) : undefined
      if (href === undefined) return
      const entry = { documentPath: document.path, line: node.position?.start.line, href }
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) { links.push({ ...entry, status: 'external' }); return }
      let path: string
      try { path = decodeURIComponent(href.split(/[?#]/, 1)[0]!) }
      catch { links.push({ ...entry, status: 'unsupported' }); return }
      if (/[\x00-\x1f\\]/.test(path)) { links.push({ ...entry, status: 'unsupported' }); return }
      // Web-root URLs cannot be interpreted as filesystem-root paths.
      if (path.startsWith('/')) { links.push({ ...entry, status: 'outside_snapshot' }); return }
      const targetPath = path ? posix.normalize(posix.join(posix.dirname(document.path), path)) : document.path
      const status = available.has(targetPath) ? 'present'
        : /^docs\/[^/]+\.md$/i.test(targetPath) || targetPath === 'requirements' ? 'absent_from_document_set' : 'outside_snapshot'
      links.push({ ...entry, targetPath, status })
    })
  }
  return { version: 1, files, requirementsStatus: source.requirements.status,
    scope: 'Explicit Markdown links only; file presence in the supplied foundation snapshot. No anchor, external-resource or semantic validation. Unprovided resources are not proven missing.', links }
}
