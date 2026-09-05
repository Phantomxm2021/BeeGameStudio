import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { foundationAuthoringMarker, foundationAuthoringSources } from './delivery-workflow/foundation-authoring-contract'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

export type FoundationAuthoritySource = Readonly<{
  path: FoundationDocumentPath
  selectionScope: 'sections' | 'document'
  sectionIds: readonly string[]
  content: string
  contentDigest: string
  documentDigest: string
}>

export type FoundationAuthorityProjection = Readonly<{
  targetPath: FoundationDocumentPath
  targetSectionIds: readonly string[]
  sources: readonly FoundationAuthoritySource[]
  byteLength: number
  rangeCount: number
  projectedLineCount: number
}>

export function foundationProjectionRelativePath(dispatchId: string): string {
  return `.beegame/workflow/document-projections/${dispatchId}.json`
}

function projectionPayload(input: {
  targetPath: FoundationDocumentPath
  targetSectionIds: readonly string[]
  sources: readonly FoundationAuthoritySource[]
}) {
  return {
    targetPath: input.targetPath,
    targetSectionIds: input.targetSectionIds,
    sources: input.sources,
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
  const pathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
  const sourceSchema = z.object({
    path: pathSchema,
    selectionScope: z.enum(['sections', 'document']),
    sectionIds: z.array(z.string()),
    content: z.string(),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()
  const schema = z.object({
    targetPath: pathSchema,
    targetSectionIds: z.array(z.string()),
    sources: z.array(sourceSchema),
  }).strict()
  const stored = schema.parse(parsed)
  const targetContract = getGameDocumentContract(stored.targetPath)
  if (stored.targetSectionIds.some(sectionId =>
    !targetContract.sections.some(section => section.sectionId === sectionId),
  ))
    throw new Error('committed upstream projection contains an invalid target section')
  const value = {
    ...stored,
    byteLength: new TextEncoder().encode(raw).byteLength,
    rangeCount: stored.sources.reduce((total, source) => total + (source.selectionScope === 'sections' ? source.sectionIds.length : 1), 0),
    projectedLineCount: stored.sources.reduce((total, source) => total + source.content.split('\n').length, 0),
  } as FoundationAuthorityProjection
  if (new Set(value.sources.map(source => source.path)).size !== value.sources.length)
    throw new Error('committed upstream projection contains duplicate sources')
  for (const source of value.sources) {
    const upstream = foundationAuthoringSources(stored.targetPath).find(candidate => candidate.path === source.path)
    if (!upstream)
      throw new Error(`committed upstream projection contains an undeclared source: ${source.path}`)
    if (
      source.sectionIds.length !== upstream.sectionIds.length ||
      source.sectionIds.some((sectionId, index) => sectionId !== upstream.sectionIds[index])
    ) throw new Error(`committed upstream projection contains undeclared section authority: ${source.path}`)
    if (createHash('sha256').update(source.content).digest('hex') !== source.contentDigest)
      throw new Error(`committed upstream projection contains an invalid content digest: ${source.path}`)
    if (source.selectionScope === 'sections' && source.sectionIds.some(sectionId => !source.content.includes(foundationAuthoringMarker(sectionId))))
      throw new Error(`committed upstream projection section content is incomplete: ${source.path}`)
  }
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
  return projection.sources
    .map(
      source => [
        `<!-- beegame-authority-source:${source.path} scope=${source.selectionScope} -->`,
        source.content.trimEnd(),
        `<!-- beegame-authority-source-end:${source.path} -->`,
      ].join('\n'),
    )
    .join('\n\n') + (projection.sources.length ? '\n' : '')
}

export function projectFoundationAuthority(input: {
  targetPath: FoundationDocumentPath
  targetSectionIds?: readonly string[]
  availableUpstreamPaths?: readonly FoundationDocumentPath[]
  documents: ReadonlyMap<FoundationDocumentPath, string>
}): FoundationAuthorityProjection {
  const target = getGameDocumentContract(input.targetPath)
  const contractedPaths = foundationAuthoringSources(input.targetPath).map(source => source.path)
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
  for (const source of foundationAuthoringSources(input.targetPath)) {
    if (!available.has(source.path)) continue
    const markdown = input.documents.get(source.path)
    if (markdown === undefined)
      throw new Error(`canonical upstream document is missing: ${source.path}`)
    const lines = markdown.split('\n')
    // Only service markers outside fenced examples identify source blocks.
    const boundaries: number[] = []
    let fence: string | undefined
    for (const [index, line] of lines.entries()) {
      const fenced = line.match(/^\s*(`{3,}|~{3,})/)
      if (fenced) {
        if (!fence) fence = fenced[1]!
        else if (fenced[1]![0] === fence[0] && fenced[1]!.length >= fence.length) fence = undefined
        continue
      }
      if (!fence && /^<!-- beegame-(?:section:[^>]+|material:[^>]+|production-materials) -->$/.test(line.trim()))
        boundaries.push(index)
    }
    const selectedSections = new Map<number, string>()
    let completeSelection = true
    for (const sectionId of source.sectionIds) {
      const marker = foundationAuthoringMarker(sectionId)
      const matches = boundaries.filter(index => lines[index]!.trim() === marker)
      const markerLine = matches[0]
      if (matches.length !== 1 || markerLine === undefined) {
        completeSelection = false
        break
      }
      const nextBoundary = boundaries
        .filter(line => line > markerLine)
        .sort((left, right) => left - right)[0]
      const endLine = nextBoundary ?? lines.length
      const content = lines.slice(markerLine, endLine).join('\n')
      selectedSections.set(markerLine, content)
    }
    const selectionScope = completeSelection ? 'sections' as const : 'document' as const
    const content = completeSelection
      ? [...selectedSections].sort(([left], [right]) => left - right).map(([, body]) => body).join('\n\n')
      : markdown
    sources.push(
      Object.freeze({
        path: source.path,
        selectionScope,
        sectionIds: Object.freeze([...source.sectionIds]),
        content,
        contentDigest: createHash('sha256').update(content).digest('hex'),
        documentDigest: createHash('sha256').update(markdown).digest('hex'),
      }),
    )
  }

  const frozenSources = Object.freeze([...sources])
  const payload = projectionPayload({
    targetPath: input.targetPath,
    targetSectionIds,
    sources: frozenSources,
  })
  const byteLength = new TextEncoder().encode(
    `${JSON.stringify(payload, null, 2)}\n`,
  ).byteLength
  return Object.freeze({
    targetPath: input.targetPath,
    targetSectionIds,
    sources: frozenSources,
    byteLength,
    rangeCount: frozenSources.reduce((total, source) => total + (source.selectionScope === 'sections' ? source.sectionIds.length : 1), 0),
    projectedLineCount: frozenSources.reduce((total, source) => total + source.content.split('\n').length, 0),
  })
}
