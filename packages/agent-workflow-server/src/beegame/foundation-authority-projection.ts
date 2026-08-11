import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

export type FoundationAuthorityProjection = Readonly<{
  path: FoundationDocumentPath
  sectionId: string
  content: string
}>

export function projectFoundationAuthority(input: {
  targetPath: FoundationDocumentPath
  documents: ReadonlyMap<FoundationDocumentPath, string>
}): readonly FoundationAuthorityProjection[] {
  const target = getGameDocumentContract(input.targetPath)
  const result: FoundationAuthorityProjection[] = []

  for (const source of target.upstreamSections) {
    const document = input.documents.get(source.path)
    if (document === undefined)
      throw new Error(`canonical upstream document is missing: ${source.path}`)
    const contract = getGameDocumentContract(source.path)
    const lines = document.split('\n').map(line => line.trimEnd())
    const expectedMarkers = contract.sections.map(
      section => `<!-- beegame-section:${section.sectionId} -->`,
    )
    const actualMarkers = lines.filter(line =>
      line.startsWith('<!-- beegame-section:'),
    )
    if (
      actualMarkers.length !== expectedMarkers.length ||
      expectedMarkers.some((marker, index) => actualMarkers[index] !== marker)
    )
      throw new Error(
        `canonical upstream section markers are missing, duplicated, or out of order: ${source.path}`,
      )
    const productionIndex = lines.indexOf('<!-- beegame-production-materials -->')
    const lastMarkerIndex = lines.indexOf(expectedMarkers.at(-1)!)
    if (productionIndex <= lastMarkerIndex)
      throw new Error(`canonical upstream production boundary is invalid: ${source.path}`)

    for (const sectionId of source.sectionIds) {
      const sourceIndex = contract.sections.findIndex(
        section => section.sectionId === sectionId,
      )
      if (sourceIndex < 0)
        throw new Error(`canonical upstream section is not contracted: ${source.path}#${sectionId}`)
      const start = lines.indexOf(expectedMarkers[sourceIndex]!)
      const end =
        sourceIndex + 1 < expectedMarkers.length
          ? lines.indexOf(expectedMarkers[sourceIndex + 1]!)
          : productionIndex
      const content = lines.slice(start + 1, end).join('\n').trim()
      if (!content)
        throw new Error(`canonical upstream section is empty: ${source.path}#${sectionId}`)
      result.push(Object.freeze({ path: source.path, sectionId, content }))
    }
  }
  return Object.freeze(result)
}
