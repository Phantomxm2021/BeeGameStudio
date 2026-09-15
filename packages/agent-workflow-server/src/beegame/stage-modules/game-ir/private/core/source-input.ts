import { createHash } from 'node:crypto'
import type {
  FoundationIrInput,
  FoundationIrSourceDocument,
  FoundationIrSourceSection,
} from '../../input'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../../../../foundation-documents'
import { foundationPublicDigest } from '../../../../foundation-public-result'
import {
  digestGameIrSourceSectionIndex,
  type GameIrSourceSection,
} from './model'
import { receiptDigest, type FoundationReadyReceipt } from './contracts'

const SHA256 = /^[a-f0-9]{64}$/u

function fail(message: string): never {
  throw new Error(`invalid Game IR Foundation input: ${message}`)
}

function digestBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function lineAtByte(content: string, offset: number): number {
  const bytes = Buffer.from(content, 'utf8')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength)
    fail('source section byte range is invalid')
  return bytes.subarray(0, offset).toString('utf8').split(/\r\n|\r|\n/u).length
}

function endLineAtByte(content: string, offset: number): number {
  const bytes = Buffer.from(content, 'utf8')
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > bytes.byteLength)
    fail('source section byte range is invalid')
  const prefix = bytes.subarray(0, offset).toString('utf8')
  const lines = prefix.match(/\r\n|\r|\n/gu) ?? []
  return /(?:\r\n|\r|\n)$/u.test(prefix) ? lines.length : lines.length + 1
}

function sectionId(section: FoundationIrSourceSection): string {
  // This is an IR structural key, not a Foundation semantic section ID.
  return `ordinal-${section.ordinal}`
}

function toGameIrSection(
  document: FoundationIrSourceDocument,
  section: FoundationIrSourceSection,
): GameIrSourceSection {
  const bytes = Buffer.from(document.content, 'utf8')
  if (
    section.startByte < 0 ||
    section.endByte <= section.startByte ||
    section.endByte > bytes.byteLength ||
    digestBytes(bytes.subarray(section.startByte, section.endByte)) !== section.digest
  )
    fail(`source section bytes are stale: ${document.path}#${section.ordinal}`)
  return Object.freeze({
    documentPath: document.path,
    sectionId: sectionId(section),
    heading: section.kind === 'preamble' ? '[preamble]' : section.headingText,
    startLine: lineAtByte(document.content, section.startByte),
    endLine: endLineAtByte(document.content, section.endByte),
    digest: section.digest,
  })
}

export function gameIrSourceSections(
  input: FoundationIrInput,
): readonly GameIrSourceSection[] {
  if (!input || input.protocolVersion !== 1) fail('unsupported input protocol')
  if (input.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length)
    fail('input must contain exactly eight canonical documents')
  const paths = input.documents.map(document => document.path)
  if (paths.some((path, index) => path !== CANONICAL_FOUNDATION_DOCUMENTS[index]))
    fail('input documents are not in canonical order')
  const sections = input.documents.flatMap(document => {
    const contentBytes = Buffer.from(document.content, 'utf8')
    if (document.byteLength !== contentBytes.byteLength || digestBytes(contentBytes) !== document.digest)
      fail(`accepted Foundation document bytes are stale: ${document.path}`)
    let cursor = 0
    const converted = document.sections.map((section, index) => {
      if (section.ordinal !== index || section.startByte !== cursor)
        fail(`source sections are not contiguous: ${document.path}`)
      cursor = section.endByte
      return toGameIrSection(document, section)
    })
    if (cursor !== contentBytes.byteLength)
      fail(`source sections do not cover the document: ${document.path}`)
    return converted
  })
  if (sections.length === 0) fail('input source index is empty')
  return Object.freeze([...sections].sort((left, right) => {
    const leftKey = `${left.documentPath}\0${left.startLine}\0${left.sectionId}`
    const rightKey = `${right.documentPath}\0${right.startLine}\0${right.sectionId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  }))
}

function sourceIndexDigest(input: FoundationIrInput): string {
  if (!SHA256.test(input.sourceIndexDigest)) fail('sourceIndexDigest is invalid')
  const sourceIndex = input.documents.map(document => ({
    path: document.path,
    digest: document.digest,
    byteLength: document.byteLength,
    sections: document.sections,
  }))
  if (foundationPublicDigest(sourceIndex) !== input.sourceIndexDigest)
    fail('sourceIndexDigest is stale')
  return input.sourceIndexDigest
}

/**
 * Project the accepted public Foundation result into the v2 IR source
 * receipt consumed by domain code. No workspace path, audit state, Review
 * Issue Registry, or private SectionIndex participates in this projection.
 */
export function foundationReadyReceiptFromInput(
  input: FoundationIrInput,
): FoundationReadyReceipt {
  const sections = gameIrSourceSections(input)
  const documentDigests = Object.fromEntries(
    input.documents.map(document => [document.path, document.digest]),
  ) as Record<FoundationDocumentPath, string>
  const foundationRevision = input.publishedDocumentRevision
  for (const digest of [
    input.foundationResultId,
    input.foundationResultDigest,
    input.documentSetDigest,
    input.confirmedBriefDigest,
    input.confirmedRequirementsDigest,
    foundationRevision,
    ...Object.values(documentDigests),
  ])
    if (!SHA256.test(digest)) fail('accepted Foundation digest is invalid')
  if (foundationRevision !== input.documentSetDigest)
    fail('published document revision is not the accepted document set digest')
  if (input.confirmedBriefDigest !== input.confirmedRequirementsDigest)
    fail('confirmed brief and requirements digests are inconsistent')
  const expectedDocumentSetDigest = foundationPublicDigest(
    input.documents.map(document => [document.path, document.digest]),
  )
  if (expectedDocumentSetDigest !== input.documentSetDigest)
    fail('documentSetDigest is stale')
  const body: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v2',
    ownerId: input.ownerId,
    projectId: input.projectId,
    foundationResultId: input.foundationResultId,
    foundationResultDigest: input.foundationResultDigest,
    foundationRevision,
    documentSetDigest: input.documentSetDigest,
    confirmedBriefDigest: input.confirmedBriefDigest,
    confirmedRequirementsDigest: input.confirmedRequirementsDigest,
    documentDigests,
    sourceIndexDigest: sourceIndexDigest(input),
    // Kept as a derived IR index digest for the existing domain identity
    // contracts; unlike v1 it is not a path-backed Foundation artifact.
    sectionIndexDigest: digestGameIrSourceSectionIndex(sections),
  }
  return { ...body, receiptDigest: receiptDigest(body) }
}

export function foundationDocumentByPath(
  input: FoundationIrInput,
  path: FoundationDocumentPath,
): FoundationIrSourceDocument {
  const document = input.documents.find(candidate => candidate.path === path)
  if (!document) fail(`accepted Foundation document is missing: ${path}`)
  return document
}

export function sourceBytesForSections(
  input: FoundationIrInput,
  sections: readonly GameIrSourceSection[],
): Readonly<Record<string, string>> {
  const documents = new Map(input.documents.map(document => [document.path, document]))
  const entries = sections.map(section => {
    const document = documents.get(section.documentPath)
    if (!document) fail(`accepted Foundation document is missing: ${section.documentPath}`)
    const structural = document.sections.find(candidate => sectionId(candidate) === section.sectionId)
    if (!structural) fail(`accepted Foundation section is missing: ${section.documentPath}#${section.sectionId}`)
    const bytes = Buffer.from(document.content, 'utf8').subarray(structural.startByte, structural.endByte).toString('utf8')
    if (digestBytes(bytes) !== section.digest) fail(`accepted Foundation section digest mismatch: ${section.documentPath}#${section.sectionId}`)
    return [`${section.documentPath}#${section.sectionId}`, bytes] as const
  })
  return Object.freeze(Object.fromEntries(entries))
}
