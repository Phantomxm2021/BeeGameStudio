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
    const contract = getContractIfCanonical(path)
    const seenIds = new Set<string>()
    const sectionHeadings = markers.length
      ? headings.filter(heading =>
          markers.some(
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
    for (const heading of sectionHeadings) {
      const marker = markers.find(
        candidate =>
          candidate.index < heading.index &&
          heading.index - candidate.index <= 2,
      )
      const sectionId = marker?.sectionId ?? slugHeading(heading.heading)
      if (!sectionId || seenIds.has(sectionId))
        throw new Error(
          `duplicate foundation section id: ${rawPath}#${sectionId}`,
        )
      seenIds.add(sectionId)
      const nextHeading = sectionHeadings.find(
        candidate =>
          candidate.index > heading.index && candidate.level <= heading.level,
      )
      const nextMarker = markers.find(
        candidate => candidate.index > heading.index,
      )
      const boundary = [nextHeading?.index, nextMarker?.index]
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
    for (const marker of markers)
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
