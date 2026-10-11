import { fromMarkdown } from 'mdast-util-from-markdown'
import { createHash } from 'node:crypto'

/** Source locations, not a semantic dependency graph. Duplicate headings are ambiguous. */
export function designDocumentSections(body: string) {
  const lines = body.replace(/\r(?=\n|$)/g, '').split('\n')
  const tree = fromMarkdown(body)
  const words = (node: any): string => node.value ?? (node.children ?? []).map(words).join('')
  const headings = tree.children.filter(node => node.type === 'heading')
  return headings.map((node, index) => {
    const start = index === 0 ? 1 : node.position!.start.line
    const ownEnd = (headings[index + 1]?.position!.start.line ?? lines.length + 1) - 1
    const next = headings.slice(index + 1).find(candidate => candidate.depth <= node.depth)
    const end = (next?.position!.start.line ?? lines.length + 1) - 1
    const own = lines.slice(start - 1, ownEnd).join('\n')
      .replace(/^\s*-\s*(?:Version|版本)\s*[:：].*$/gim, '').trim()
    return { heading: words(node), start, end,
      hash: createHash('sha256').update(own).digest('hex') }
  })
}

export function designSectionHashes(body: string): Record<string, string> | undefined {
  const sections = designDocumentSections(body)
  if (!sections.length || new Set(sections.map(section => section.heading)).size !== sections.length) return
  return Object.fromEntries(sections.map(section => [section.heading, section.hash]))
}
