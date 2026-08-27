import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  collectCompleteGameDocumentAuthoritySymbols,
  type CompleteGameDocumentAuthoritySymbol,
} from './complete-game-document'

export type FoundationAuthoritySource = Readonly<{
  path: FoundationDocumentPath
  sections: readonly Readonly<{
    sectionId: string
    startLine: number
    lineCount: number
    content: string
    digest: string
  }>[]
  digest: string
}>

export type FoundationAuthorityProjection = Readonly<{
  targetPath: FoundationDocumentPath
  targetSectionIds: readonly string[]
  sources: readonly FoundationAuthoritySource[]
  byteLength: number
  rangeCount: number
  projectedLineCount: number
  symbols: readonly CompleteGameDocumentAuthoritySymbol[]
}>

export function foundationProjectionRelativePath(dispatchId: string): string {
  return `.beegame/workflow/document-projections/${dispatchId}.json`
}

function projectionPayload(input: {
  targetPath: FoundationDocumentPath
  targetSectionIds: readonly string[]
  sources: readonly FoundationAuthoritySource[]
  symbols: readonly CompleteGameDocumentAuthoritySymbol[]
}) {
  return {
    targetPath: input.targetPath,
    targetSectionIds: input.targetSectionIds,
    sources: input.sources,
    symbols: input.symbols,
  }
}

export function canonicalFoundationAuthorityProjectionBytes(
  projection: FoundationAuthorityProjection,
): string {
  return `${JSON.stringify(projectionPayload(projection), null, 2)}\n`
}

export function parseFoundationAuthorityProjectionBytes(
  raw: string,
): FoundationAuthorityProjection {
  const parsed: unknown = JSON.parse(raw)
  const sourceSchema = z.object({
    path: z.string(),
    sections: z.array(z.object({
      sectionId: z.string(),
      startLine: z.number().int().positive(),
      lineCount: z.number().int().positive(),
      content: z.string(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict()),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()
  const schema = z.object({
    targetPath: z.string(),
    targetSectionIds: z.array(z.string()),
    sources: z.array(sourceSchema),
    symbols: z.array(z.object({
      id: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
      documentPath: z.string(),
      sectionId: z.string(),
    }).strict()),
  }).strict()
  const stored = schema.parse(parsed)
  const value = {
    ...stored,
    byteLength: new TextEncoder().encode(raw).byteLength,
    rangeCount: stored.sources.reduce((total, source) => total + source.sections.length, 0),
    projectedLineCount: stored.sources.reduce((total, source) => total + source.sections.reduce((sum, section) => sum + section.lineCount, 0), 0),
  } as FoundationAuthorityProjection
  if (new Set(value.sources.map(source => source.path)).size !== value.sources.length)
    throw new Error('committed upstream projection contains duplicate sources')
  if (new Set(value.symbols.map(symbol => symbol.id)).size !== value.symbols.length)
    throw new Error('committed upstream projection contains duplicate symbols')
  if (canonicalFoundationAuthorityProjectionBytes(value) !== raw)
    throw new Error('committed upstream projection bytes are not canonical')
  return value
}

/**
 * The model needs the selected authority text and its stable semantic labels,
 * not the line/digest/size bookkeeping used to validate the durable artifact.
 */
export function modelFoundationAuthorityProjectionBytes(
  projection: FoundationAuthorityProjection,
): string {
  return `${JSON.stringify({
    targetPath: projection.targetPath,
    targetSectionIds: projection.targetSectionIds,
    sources: projection.sources.map(source => ({
      path: source.path,
      sections: source.sections.map(section => ({
        sectionId: section.sectionId,
        content: section.content,
      })),
    })),
    symbols: projection.symbols,
  }, null, 2)}\n`
}

export function projectFoundationAuthority(input: {
  targetPath: FoundationDocumentPath
  targetSectionIds?: readonly string[]
  availableUpstreamPaths?: readonly FoundationDocumentPath[]
  documents: ReadonlyMap<FoundationDocumentPath, string>
}): FoundationAuthorityProjection {
  const target = getGameDocumentContract(input.targetPath)
  const contractedPaths = target.upstreamSections.map(source => source.path)
  const availableUpstreamPaths =
    input.availableUpstreamPaths ?? []
  if (
    new Set(availableUpstreamPaths).size !== availableUpstreamPaths.length ||
    availableUpstreamPaths.some(path => !contractedPaths.includes(path))
  )
    throw new Error(
      'available upstream authority must be unique and declared by the document contract',
    )
  const available = new Set(availableUpstreamPaths)
  const targetSectionIds = Object.freeze(
    input.targetSectionIds === undefined
      ? target.sections.map(section => section.sectionId)
      : [...input.targetSectionIds],
  )
  if (
    new Set(targetSectionIds).size !== targetSectionIds.length ||
    targetSectionIds.some(
      sectionId =>
        !target.sections.some(section => section.sectionId === sectionId),
    )
  )
    throw new Error('foundation authority target sections are invalid')
  const sources: FoundationAuthoritySource[] = []
  const symbols: CompleteGameDocumentAuthoritySymbol[] = []

  for (const source of target.upstreamSections) {
    if (!available.has(source.path)) continue
    const markdown = input.documents.get(source.path)
    if (markdown === undefined)
      throw new Error(`canonical upstream document is missing: ${source.path}`)
    const sourceContract = getGameDocumentContract(source.path)
    symbols.push(...collectCompleteGameDocumentAuthoritySymbols(source.path, markdown))
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
      content: string
      digest: string
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
      const content = lines.slice(markerLine, endLine).join('\n')
      sections.push(
        Object.freeze({
          sectionId,
          startLine: markerLine + 1,
          lineCount: endLine - markerLine,
          content,
          digest: createHash('sha256').update(content).digest('hex'),
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
    targetSectionIds,
    sources: frozenSources,
    symbols: Object.freeze([...symbols]),
  })
  const byteLength = new TextEncoder().encode(
    `${JSON.stringify(payload, null, 2)}\n`,
  ).byteLength
  return Object.freeze({
    targetPath: input.targetPath,
    targetSectionIds,
    sources: frozenSources,
    byteLength,
    rangeCount: frozenSources.reduce(
      (total, source) => total + source.sections.length,
      0,
    ),
    projectedLineCount: frozenSources.reduce(
      (total, source) =>
        total +
        source.sections.reduce((sum, section) => sum + section.lineCount, 0),
      0,
    ),
    symbols: Object.freeze([...symbols]),
  })
}
