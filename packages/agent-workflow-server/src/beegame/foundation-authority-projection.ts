import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

export type FoundationAuthoritySource = Readonly<{
  path: FoundationDocumentPath
  sectionIds: readonly string[]
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
    for (const sectionId of source.sectionIds) {
      const section = sourceContract.sections.find(
        candidate => candidate.sectionId === sectionId,
      )
      const marker = `<!-- beegame-section:${sectionId} -->`
      if (!section || !markdown.split('\n').some(line => line.trim() === marker))
        throw new Error(
          `canonical upstream section is missing: ${source.path}#${sectionId}`,
        )
    }
    sources.push(
      Object.freeze({
        path: source.path,
        sectionIds: Object.freeze([...source.sectionIds]),
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
