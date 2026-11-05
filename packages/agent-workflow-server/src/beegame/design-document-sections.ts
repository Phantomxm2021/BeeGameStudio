import { fromMarkdown } from 'mdast-util-from-markdown'

/** Source locations, not a semantic dependency graph. Duplicate headings are ambiguous. */
export function designDocumentSections(body: string) {
  const lines = body.replace(/\r(?=\n|$)/g, '').split('\n')
  const tree = fromMarkdown(body)
  const words = (node: any): string => node.value ?? (node.children ?? []).map(words).join('')
  const headings = tree.children.filter(node => node.type === 'heading')
  return headings.map((node, index) => {
    const start = index === 0 ? 1 : node.position!.start.line
    const next = headings.slice(index + 1).find(candidate => candidate.depth <= node.depth)
    const end = (next?.position!.start.line ?? lines.length + 1) - 1
    return { heading: words(node), start, end }
  })
}

/** Resolve presentation markup with the same parser as document headings. */
export function renderDesignHeading(heading: string): string {
  if (/[\r\n]/.test(heading)) return heading
  const parsed = designDocumentSections(/^#{1,6}(?:[ \t]|$)/.test(heading) ? heading : '# ' + heading)
  return parsed.length === 1 && parsed[0]!.heading ? parsed[0]!.heading : heading
}

/** Literal titles win; presentation markup never selects between duplicate titles. */
export function findDesignSections<T extends { heading: string }>(sections: readonly T[], heading: string): T[] {
  const literal = sections.filter(section => section.heading === heading)
  if (literal.length) return literal
  const rendered = renderDesignHeading(heading)
  return sections.filter(section => section.heading === rendered)
}
