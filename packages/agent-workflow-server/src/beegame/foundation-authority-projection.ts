import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

export type FoundationAuthoritySource = Readonly<{
  path: FoundationDocumentPath
  sections: readonly Readonly<{
    sectionId: string
    startLine: number
    lineCount: number
    contentLines: readonly string[]
  }>[]
  digest: string
}>

export type FoundationAuthorityProjection = Readonly<{
  targetPath: FoundationDocumentPath
  sources: readonly FoundationAuthoritySource[]
  byteLength: number
}>

function projectionPayload(input: {
  targetPath: FoundationDocumentPath
  sources: readonly FoundationAuthoritySource[]
}) {
  return {
    targetPath: input.targetPath,
    sources: input.sources,
  }
}

export function canonicalFoundationAuthorityProjectionBytes(
  projection: FoundationAuthorityProjection,
): string {
  return `${JSON.stringify(projectionPayload(projection), null, 2)}\n`
}

export function projectFoundationAuthority(input: {
  targetPath: FoundationDocumentPath
  documents: ReadonlyMap<FoundationDocumentPath, string>
}): FoundationAuthorityProjection {
  const target = getGameDocumentContract(input.targetPath)
  const sources: FoundationAuthoritySource[] = []

  for (const source of target.upstreamSections) {
    const markdown = input.documents.get(source.path)
    if (markdown === undefined)
      throw new Error(`canonical upstream document is missing: ${source.path}`)
    const sourceContract = getGameDocumentContract(source.path)
    const lines = markdown.split('\n')
    const sectionMarkerLines = lines.flatMap((line, index) =>
      line.trim().startsWith('<!-- beegame-section:') ? [index] : [],
    )
    const productionMarkerLine = lines.findIndex(
      line => line.trim() === '<!-- beegame-production-materials -->',
    )
    const sections: Array<{
      sectionId: string
      startLine: number
      lineCount: number
      contentLines: readonly string[]
    }> = []
    for (const sectionId of source.sectionIds) {
      const section = sourceContract.sections.find(
        candidate => candidate.sectionId === sectionId,
      )
      const marker = `<!-- beegame-section:${sectionId} -->`
      const markerLine = lines.findIndex(line => line.trim() === marker)
      if (!section || markerLine < 0)
        throw new Error(
          `canonical upstream section is missing: ${source.path}#${sectionId}`,
        )
      const nextBoundary = [...sectionMarkerLines, productionMarkerLine]
        .filter(line => line > markerLine)
        .sort((left, right) => left - right)[0]
      const endLine = nextBoundary ?? lines.length
      sections.push(
        Object.freeze({
          sectionId,
          startLine: markerLine + 1,
          lineCount: endLine - markerLine,
          contentLines: Object.freeze(lines.slice(markerLine, endLine)),
        }),
      )
    }
    sources.push(
      Object.freeze({
        path: source.path,
        sections: Object.freeze(sections),
        digest: createHash('sha256').update(markdown).digest('hex'),
      }),
    )
  }

  const frozenSources = Object.freeze([...sources])
  const payload = projectionPayload({
    targetPath: input.targetPath,
    sources: frozenSources,
  })
  const byteLength = new TextEncoder().encode(
    `${JSON.stringify(payload, null, 2)}\n`,
  ).byteLength
  return Object.freeze({
    targetPath: input.targetPath,
    sources: frozenSources,
    byteLength,
  })
}
