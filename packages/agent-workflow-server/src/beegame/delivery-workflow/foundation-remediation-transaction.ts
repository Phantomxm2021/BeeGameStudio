import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { renderRemediatedDocumentMetadata } from '../authored-document-receipt'
import { validateCompleteGameDocumentMarkdown } from '../complete-game-document'
import {
  FOUNDATION_REVIEW_VERSION,
  foundationReviewSchema,
  type FoundationReview,
} from './foundation-review'
import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const pathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)

export type FoundationRemediationBodyUnit = {
  unitId: 'executive-summary' | `section:${string}` | `material:${string}`
  bodyDigest: string
  startLine: number
  endLine: number
}

export type FoundationRemediationTransactionRequest = {
  version: 1
  sourcePath: FoundationDocumentPath
  sourceDigest: string
  sourceMarkdown: string
  reviewDigest: string
  sourceRevision: string
  conflicts: FoundationReview['conflicts']
  units: FoundationRemediationBodyUnit[]
}

export const foundationRemediationResultSchema = z
  .object({
    version: z.literal(1),
    sourcePath: pathSchema,
    sourceDigest: digestSchema,
    resolvedConflictIds: z.array(z.string().min(1)),
    patches: z
      .array(
        z
          .object({
            unitId: z.string().min(1),
            expectedBodyDigest: digestSchema,
            replacementBody: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type FoundationRemediationResult = z.infer<
  typeof foundationRemediationResultSchema
>

export const foundationRemediationTransactionReceiptSchema = z
  .object({
    reviewDigest: digestSchema,
    sourceRevision: digestSchema,
    targetPath: pathSchema,
    sourceDigest: digestSchema,
    patchedUnitIds: z.array(z.string().min(1)).min(1),
    finalDigest: digestSchema,
    committedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type FoundationRemediationTransactionReceipt = z.infer<
  typeof foundationRemediationTransactionReceiptSchema
>

type InternalBodyUnit = FoundationRemediationBodyUnit & {
  startIndex: number
  endIndex: number
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function documentBody(lines: readonly string[]): string {
  if (lines[0]?.trim() !== '---')
    throw new Error('foundation remediation source front matter is missing')
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  )
  if (closingIndex < 1)
    throw new Error('foundation remediation source front matter is invalid')
  return lines.slice(closingIndex + 1).join('\n').trimStart()
}

function nextNonBlankIndex(lines: readonly string[], start: number): number {
  for (let index = start + 1; index < lines.length; index += 1)
    if (lines[index]!.trim()) return index
  throw new Error('foundation remediation canonical unit heading is missing')
}

function extractBodyUnits(
  sourcePath: FoundationDocumentPath,
  sourceMarkdown: string,
): InternalBodyUnit[] {
  const contract = getGameDocumentContract(sourcePath)
  const lines = sourceMarkdown.split('\n')
  validateCompleteGameDocumentMarkdown(sourcePath, documentBody(lines))

  const descriptors: Array<{
    unitId: InternalBodyUnit['unitId']
    marker: string
    heading: string
    nextMarker: string | undefined
  }> = []
  const summaryMarker = '<!-- beegame-executive-summary -->'
  const productionMarker = '<!-- beegame-production-materials -->'
  const auditMarker = '<!-- beegame-audit-appendix -->'
  const sectionMarkers = contract.sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  const materialMarkers = contract.productionMaterials.map(
    material => `<!-- beegame-material:${material.materialId} -->`,
  )

  descriptors.push({
    unitId: 'executive-summary',
    marker: summaryMarker,
    heading: '## Executive Summary',
    nextMarker: sectionMarkers[0],
  })
  contract.sections.forEach((section, index) => {
    descriptors.push({
      unitId: `section:${section.sectionId}`,
      marker: sectionMarkers[index]!,
      heading: `## ${section.title}`,
      nextMarker: sectionMarkers[index + 1] ?? productionMarker,
    })
  })
  contract.productionMaterials.forEach((material, index) => {
    descriptors.push({
      unitId: `material:${material.materialId}`,
      marker: materialMarkers[index]!,
      heading: `### ${material.title}`,
      nextMarker: materialMarkers[index + 1] ?? auditMarker,
    })
  })

  return descriptors.map(descriptor => {
    const markerIndex = lines.indexOf(descriptor.marker)
    const headingIndex = nextNonBlankIndex(lines, markerIndex)
    if (lines[headingIndex] !== descriptor.heading)
      throw new Error(
        `foundation remediation canonical unit heading is invalid: ${descriptor.unitId}`,
      )
    const startIndex = headingIndex + 1
    const locatedNextIndex = descriptor.nextMarker
      ? lines.indexOf(descriptor.nextMarker, startIndex)
      : lines.length
    const nextIndex =
      locatedNextIndex < 0 && descriptor.nextMarker === auditMarker
        ? lines.length
        : locatedNextIndex
    if (markerIndex < 0 || nextIndex < startIndex)
      throw new Error(
        `foundation remediation canonical unit range is invalid: ${descriptor.unitId}`,
      )
    const body = lines.slice(startIndex, nextIndex).join('\n').trim()
    if (!body)
      throw new Error(
        `foundation remediation canonical unit body is empty: ${descriptor.unitId}`,
      )
    return {
      unitId: descriptor.unitId,
      bodyDigest: digest(body),
      startLine: startIndex + 1,
      endLine: nextIndex,
      startIndex,
      endIndex: nextIndex,
    }
  })
}

export function buildFoundationRemediationTransactionRequest(input: {
  sourcePath: FoundationDocumentPath
  sourceMarkdown: string
  reviewDigest: string
  sourceRevision: string
  conflicts: FoundationReview['conflicts']
}): FoundationRemediationTransactionRequest {
  const sourcePath = pathSchema.parse(input.sourcePath)
  const reviewDigest = digestSchema.parse(input.reviewDigest)
  const sourceRevision = digestSchema.parse(input.sourceRevision)
  const review = foundationReviewSchema.parse({
    version: FOUNDATION_REVIEW_VERSION,
    scope: 'foundation',
    revision: sourceRevision,
    verdict: 'NEEDS_REVISION',
    priorConflictStatus: [],
    conflicts: input.conflicts,
  })
  if (
    review.conflicts.some(
      conflict =>
        conflict.changes.length !== 1 ||
        conflict.changes[0]?.path !== sourcePath,
    )
  )
    throw new Error(
      'foundation remediation conflicts must be scoped to one target path',
    )
  const conflicts = [...review.conflicts].sort((left, right) =>
    bytewise(left.id, right.id),
  )
  const units = extractBodyUnits(sourcePath, input.sourceMarkdown).map(
    ({ startIndex: _startIndex, endIndex: _endIndex, ...unit }) => unit,
  )
  return {
    version: 1,
    sourcePath,
    sourceDigest: digest(input.sourceMarkdown),
    sourceMarkdown: input.sourceMarkdown,
    reviewDigest,
    sourceRevision,
    conflicts,
    units,
  }
}

function assertExactIds(
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== expected.length ||
    expected.some((value, index) => actual[index] !== value)
  )
    throw new Error('foundation remediation conflict closure is incomplete')
}

function canonicalHeadings(path: FoundationDocumentPath): Set<string> {
  const contract = getGameDocumentContract(path)
  return new Set([
    '## Executive Summary',
    ...contract.sections.map(section => `## ${section.title}`),
    '## Production Materials',
    ...contract.productionMaterials.map(material => `### ${material.title}`),
  ])
}

function assertReplacementBody(
  path: FoundationDocumentPath,
  replacementBody: string,
): void {
  const lines = replacementBody.split('\n').map(line => line.trim())
  if (lines.some(line => /^#\s/u.test(line)))
    throw new Error(
      'foundation remediation replacement contains a document title',
    )
  if (lines.some(line => line.startsWith('<!-- beegame-')))
    throw new Error(
      'foundation remediation replacement contains a protocol marker',
    )
  const headings = canonicalHeadings(path)
  if (lines.some(line => headings.has(line)))
    throw new Error(
      'foundation remediation replacement contains a canonical unit heading',
    )
}

export function assembleFoundationRemediationTransaction(input: {
  request: FoundationRemediationTransactionRequest
  result: unknown
  previousMetadata: { version: string; updatedAt: string }
  committedAt: string
}): {
  markdown: string
  receipt: FoundationRemediationTransactionReceipt
} {
  const result = foundationRemediationResultSchema.parse(input.result)
  if (result.sourcePath !== input.request.sourcePath)
    throw new Error('foundation remediation target path changed')
  if (result.sourceDigest !== input.request.sourceDigest)
    throw new Error('foundation remediation source digest changed')
  assertExactIds(
    result.resolvedConflictIds,
    input.request.conflicts.map(conflict => conflict.id),
  )

  const units = extractBodyUnits(
    input.request.sourcePath,
    input.request.sourceMarkdown,
  )
  const unitIndex = new Map<
    string,
    { unit: InternalBodyUnit; index: number }
  >(
    units.map((unit, index) => [unit.unitId, { unit, index }]),
  )
  const patchIds = result.patches.map(patch => patch.unitId)
  if (new Set(patchIds).size !== patchIds.length)
    throw new Error('foundation remediation patch units must be unique')
  const indexes = result.patches.map(patch => {
    const entry = unitIndex.get(patch.unitId)
    if (!entry)
      throw new Error(
        `foundation remediation patch unit is unknown: ${patch.unitId}`,
      )
    if (patch.expectedBodyDigest !== entry.unit.bodyDigest)
      throw new Error('foundation remediation body digest changed')
    assertReplacementBody(input.request.sourcePath, patch.replacementBody)
    return entry.index
  })
  if (indexes.some((value, index) => index > 0 && value <= indexes[index - 1]!))
    throw new Error('foundation remediation patches are not in canonical order')

  const lines = input.request.sourceMarkdown.split('\n')
  for (let index = result.patches.length - 1; index >= 0; index -= 1) {
    const patch = result.patches[index]!
    const unit = units[indexes[index]!]!
    lines.splice(
      unit.startIndex,
      unit.endIndex - unit.startIndex,
      '',
      ...patch.replacementBody.trim().split('\n'),
      '',
    )
  }
  const markdown = renderRemediatedDocumentMetadata({
    markdown: lines.join('\n'),
    previousVersion: input.previousMetadata.version,
    previousUpdatedAt: input.previousMetadata.updatedAt,
    updatedAt: input.committedAt,
  })
  validateCompleteGameDocumentMarkdown(
    input.request.sourcePath,
    documentBody(markdown.split('\n')),
  )
  const receipt = foundationRemediationTransactionReceiptSchema.parse({
    reviewDigest: input.request.reviewDigest,
    sourceRevision: input.request.sourceRevision,
    targetPath: input.request.sourcePath,
    sourceDigest: input.request.sourceDigest,
    patchedUnitIds: patchIds,
    finalDigest: digest(markdown),
    committedAt: input.committedAt,
  })
  return { markdown, receipt }
}
