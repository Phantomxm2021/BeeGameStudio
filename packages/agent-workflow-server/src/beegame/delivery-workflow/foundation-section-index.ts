import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import type { FoundationDocumentPath } from './types'

export type SectionRef = {
  documentPath: FoundationDocumentPath
  sectionId: string
  heading: string
  startLine: number
  endLine: number
  digest: string
}

export type FoundationSectionIndex = SectionRef[]

type DocumentInput = ReadonlyMap<string, string> | Record<string, string>

function documentsFrom(input: DocumentInput): Array<readonly [string, string]> {
  const entries =
    input instanceof Map ? [...input.entries()] : Object.entries(input)
  return entries
    .map(([path, content]) => [path.replaceAll('\\', '/'), content] as const)
    .sort(([left], [right]) => left.localeCompare(right))
}

function slugHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Stable block IDs accepted by the single Foundation revision authority. */
export function canonicalFoundationBlockIds(
  path: FoundationDocumentPath,
): string[] {
  const contract = getGameDocumentContract(path)
  return [
    'executive_summary',
    ...contract.sections.map(section => section.sectionId),
    ...contract.productionMaterials.map(material => `material.${material.materialId}`),
  ]
}

/** Indexes authored Markdown using the immutable contract when the path is canonical. */
export function buildFoundationSectionIndex(input: {
  documents: DocumentInput
}): FoundationSectionIndex {
  const output: FoundationSectionIndex = []
  for (const [rawPath, markdown] of documentsFrom(input.documents)) {
    if (!markdown || typeof markdown !== 'string')
      throw new Error(`foundation document content is invalid: ${rawPath}`)
    const path = rawPath as FoundationDocumentPath
    const lines = markdown.split('\n')
    const headings = lines.flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      return match
        ? [{ index, heading: match[2]!, level: match[1]!.length }]
        : []
    })
    const markers = lines.flatMap((line, index) => {
      const match = /^<!--\s*beegame-section:([a-z0-9._-]+)\s*-->$/.exec(
        line.trim(),
      )
      return match ? [{ index, sectionId: match[1]! }] : []
    })
    const summaryMarkers = lines.flatMap((line, index) =>
      line.trim() === '<!-- beegame-executive-summary -->'
        ? [{ index, sectionId: 'executive_summary' }]
        : [],
    )
    const materialMarkers = lines.flatMap((line, index) => {
      const match = /^<!--\s*beegame-material:([a-z0-9._-]+)\s*-->$/.exec(
        line.trim(),
      )
      return match
        ? [{ index, sectionId: `material.${match[1]!}` }]
        : []
    })
    const blockMarkers = [...summaryMarkers, ...markers, ...materialMarkers].sort(
      (left, right) => left.index - right.index,
    )
    const boundaryMarkers = lines.flatMap((line, index) =>
      /^(?:<!--\s*beegame-(?:executive-summary|section:[a-z0-9._-]+|production-materials|material:[a-z0-9._-]+|audit-appendix)\s*-->)$/.test(line.trim())
        ? [index]
        : [],
    )
    const contract = getContractIfCanonical(path)
    const seenIds = new Set<string>()
    if (contract && (summaryMarkers.length > 0 || materialMarkers.length > 0)) {
      const expectedMaterials = contract.productionMaterials.map(
        material => `material.${material.materialId}`,
      )
      const actualMaterials = materialMarkers.map(marker => marker.sectionId)
      if (
        summaryMarkers.length !== 1 ||
        actualMaterials.length !== expectedMaterials.length ||
        actualMaterials.some((id, index) => id !== expectedMaterials[index])
      )
        throw new Error(
          `foundation document derived block markers do not satisfy their immutable contract: ${rawPath}`,
        )
    }
    const sectionHeadings = blockMarkers.length
      ? headings.filter(heading =>
          blockMarkers.some(
            marker =>
              marker.index < heading.index && heading.index - marker.index <= 2,
          ),
        )
      : headings.filter(heading => heading.level > 1)
    if (contract) {
      const required = contract.sections
      const requiredIds = new Set(required.map(section => section.sectionId))
      const sectionMarkers = markers.filter(marker =>
        requiredIds.has(marker.sectionId),
      )
      if (
        markers.some(marker => !requiredIds.has(marker.sectionId)) ||
        sectionMarkers.length !== required.length ||
        new Set(sectionMarkers.map(marker => marker.sectionId)).size !==
          required.length ||
        !sectionMarkers.every(
          (marker, index) => marker.sectionId === required[index]?.sectionId,
        )
      )
        throw new Error(
          `foundation document does not satisfy its immutable section contract: ${rawPath}`,
        )
      for (const section of required) {
        const marker = sectionMarkers.find(
          candidate => candidate.sectionId === section.sectionId,
        )
        const heading = marker
          ? headings.find(
              candidate =>
                candidate.index > marker.index &&
                candidate.index - marker.index <= 2,
            )
          : undefined
        if (
          !marker ||
          !heading ||
          heading.level !== 2 ||
          heading.heading !== section.title
        )
          throw new Error(
            `foundation document section marker or heading does not satisfy its immutable contract: ${rawPath}#${section.sectionId}`,
          )
      }
    }
    const selectedHeadings = blockMarkers.length
      ? blockMarkers.map(marker => ({
          marker,
          heading: headings.find(
            candidate =>
              candidate.index > marker.index &&
              candidate.index - marker.index <= 2,
          ),
        }))
      : sectionHeadings.map(heading => ({ heading, marker: undefined }))
    for (const { heading, marker } of selectedHeadings) {
      if (!heading) {
        throw new Error(
          `foundation service marker has no heading: ${rawPath}#${marker?.sectionId ?? 'unknown'}`,
        )
      }
      const sectionId = marker?.sectionId ?? slugHeading(heading.heading)
      if (contract && marker) {
        const material = contract.productionMaterials.find(
          candidate => `material.${candidate.materialId}` === sectionId,
        )
        const expectedHeading = sectionId === 'executive_summary'
          ? { level: 2, heading: 'Executive Summary' }
          : material
              ? {
                  level: 3,
                  heading: material.title,
                }
              : undefined
        if (
          expectedHeading &&
          (heading.level !== expectedHeading.level || heading.heading !== expectedHeading.heading)
        )
          throw new Error(
            `foundation document derived block marker or heading does not satisfy its immutable contract: ${rawPath}#${sectionId}`,
          )
      }
      if (!sectionId || seenIds.has(sectionId))
        throw new Error(
          `duplicate foundation section id: ${rawPath}#${sectionId}`,
        )
      seenIds.add(sectionId)
      // Contract markers select immutable sections; any following same-level
      // heading still terminates the selected section (appendices are not
      // indexed, but must not be swallowed into the preceding section).
      const nextHeading = headings.find(
        candidate =>
          candidate.index > heading.index && candidate.level <= heading.level,
      )
      const nextMarker = markers.find(
        candidate => candidate.index > heading.index,
      )
      const nextBoundaryMarker = boundaryMarkers.find(
        candidate => candidate > heading.index,
      )
      const boundary = [nextHeading?.index, nextBoundaryMarker, nextMarker?.index]
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)[0]
      const endExclusive = boundary ?? lines.length
      const sectionText = lines.slice(heading.index, endExclusive).join('\n')
      output.push({
        documentPath: path,
        sectionId,
        heading: heading.heading,
        startLine: heading.index + 1,
        endLine: endExclusive,
        digest: digest(sectionText),
      })
    }
    // A marker without its required heading is a malformed committed document,
    // not an inferred section.
    for (const marker of blockMarkers)
      if (
        !headings.some(
          heading =>
            heading.index > marker.index && heading.index - marker.index <= 2,
        )
      )
        throw new Error(
          `foundation section marker has no heading: ${rawPath}#${marker.sectionId}`,
        )
  }
  return output
}

function getContractIfCanonical(path: FoundationDocumentPath) {
  try {
    return getGameDocumentContract(path)
  } catch {
    return undefined
  }
}

export function digestSectionIndex(index: readonly SectionRef[]): string {
  const canonical = [...index]
    .map(section => ({ ...section }))
    .sort((left, right) =>
      `${left.documentPath}\0${left.startLine}\0${left.sectionId}`.localeCompare(
        `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
      ),
    )
  return digest(JSON.stringify(canonical))
}
