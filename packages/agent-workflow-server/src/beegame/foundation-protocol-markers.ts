import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

type MarkerHeading = {
  marker: string
  heading: string
}

/**
 * Inject invisible service-owned block identities when the author returned the
 * complete canonical heading sequence exactly once and in contract order.
 *
 * This is deliberately fail-open for Stage 2: ambiguous, missing, reordered,
 * or already-authored protocol comments leave the Markdown body unchanged so
 * Stage 3 can publish the one authoritative format Issue. No heading aliases
 * or heuristic matching are used.
 */
export function injectFoundationProtocolMarkers(
  path: FoundationDocumentPath,
  markdown: string,
): string {
  const lines = markdown.split('\n')
  if (lines.some(line => line.trim().startsWith('<!-- beegame-')))
    return markdown

  const expected = markerHeadings(path)
  const headings = markdownHeadingLines(lines)
  const indexes: number[] = []
  let previous = -1
  for (const entry of expected) {
    const matches = headings
      .filter(candidate => candidate.heading === entry.heading)
      .map(candidate => candidate.index)
    if (matches.length !== 1 || matches[0]! <= previous) return markdown
    previous = matches[0]!
    indexes.push(previous)
  }

  for (let index = expected.length - 1; index >= 0; index -= 1)
    lines.splice(indexes[index]!, 0, expected[index]!.marker)
  return lines.join('\n')
}

/** Remove only exact service-owned block identity lines from a model view. */
export function stripFoundationProtocolMarkers(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => !/^\s*<!--\s*beegame-(?:executive-summary|production-materials|section:[a-z0-9._-]+|material:[a-z0-9._-]+)\s*-->\s*$/i.test(line))
    .join('\n')
}

function markerHeadings(path: FoundationDocumentPath): MarkerHeading[] {
  const contract = getGameDocumentContract(path)
  return [
    {
      marker: '<!-- beegame-executive-summary -->',
      heading: '## Executive Summary',
    },
    ...contract.sections.map(section => ({
      marker: `<!-- beegame-section:${section.sectionId} -->`,
      heading: `## ${section.title}`,
    })),
    {
      marker: '<!-- beegame-production-materials -->',
      heading: '## Production Materials',
    },
    ...contract.productionMaterials.map(material => ({
      marker: `<!-- beegame-material:${material.materialId} -->`,
      heading: `### ${material.title}`,
    })),
  ]
}

function markdownHeadingLines(
  lines: readonly string[],
): Array<{ index: number; heading: string }> {
  const headings: Array<{ index: number; heading: string }> = []
  let fence: { character: '`' | '~'; length: number } | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const candidate = /^(?<marker>`{3,}|~{3,})(?:[^`]*)$/.exec(line)
      ?.groups?.marker
    if (candidate) {
      const character = candidate[0] as '`' | '~'
      if (!fence) fence = { character, length: candidate.length }
      else if (character === fence.character && candidate.length >= fence.length)
        fence = undefined
      continue
    }
    if (!fence && /^#{2,3} [^#].*$/.test(line))
      headings.push({ index, heading: line })
  }
  return headings
}
