import {
  validateFoundationAuthoritySidecar,
  type FoundationAuthorityRecord,
  type FoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

export type FoundationAuthorityProjection = Readonly<{
  targetPath: FoundationDocumentPath
  sourceDigests: Readonly<Record<string, string>>
  records: readonly FoundationAuthorityRecord[]
  byteLength: number
}>

function projectionPayload(input: {
  targetPath: FoundationDocumentPath
  sourceDigests: Readonly<Record<string, string>>
  records: readonly FoundationAuthorityRecord[]
}) {
  return {
    targetPath: input.targetPath,
    sourceDigests: input.sourceDigests,
    records: input.records,
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
  sidecars: ReadonlyMap<FoundationDocumentPath, FoundationAuthoritySidecar | unknown>
}): FoundationAuthorityProjection {
  const target = getGameDocumentContract(input.targetPath)
  const records: FoundationAuthorityRecord[] = []
  const sourceDigests: Record<string, string> = {}
  const seenAuthorityIds = new Set<string>()

  for (const source of target.upstreamSections) {
    const markdown = input.documents.get(source.path)
    if (markdown === undefined)
      throw new Error(`canonical upstream document is missing: ${source.path}`)
    const rawSidecar = input.sidecars.get(source.path)
    if (rawSidecar === undefined)
      throw new Error(`canonical upstream authority sidecar is missing: ${source.path}`)
    const sidecar = validateFoundationAuthoritySidecar({
      documentPath: source.path,
      markdown,
      value: rawSidecar,
    })
    sourceDigests[source.path] = sidecar.documentDigest
    const allowedSections = new Set(source.sectionIds)
    for (const record of sidecar.records) {
      if (!allowedSections.has(record.sectionId)) continue
      if (seenAuthorityIds.has(record.authorityId))
        throw new Error(
          `projected foundation authority ID is duplicated: ${record.authorityId}`,
        )
      seenAuthorityIds.add(record.authorityId)
      records.push(record)
    }
  }

  const frozenSourceDigests = Object.freeze({ ...sourceDigests })
  const frozenRecords = Object.freeze([...records])
  const payload = projectionPayload({
    targetPath: input.targetPath,
    sourceDigests: frozenSourceDigests,
    records: frozenRecords,
  })
  const byteLength = new TextEncoder().encode(
    `${JSON.stringify(payload, null, 2)}\n`,
  ).byteLength
  return Object.freeze({
    targetPath: input.targetPath,
    sourceDigests: frozenSourceDigests,
    records: frozenRecords,
    byteLength,
  })
}
