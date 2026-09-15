import { createHash } from 'node:crypto'
import type { ReviewerReviewResult } from '../foundation-reviewer/public'
import { foundationPublicDigest, foundationResultBinding } from '../../foundation-public-result'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from '../../foundation-documents'

const SHA256 = /^[a-f0-9]{64}$/

export type FoundationIrSourceSection = Readonly<{
  /** Structural identity only; it is never a legacy semantic section ID. */
  ordinal: number
  kind: 'preamble' | 'heading'
  headingLevel: number
  headingText: string
  startByte: number
  endByte: number
  digest: string
}>

export type FoundationIrSourceDocument = Readonly<{
  path: FoundationDocumentPath
  content: string
  digest: string
  byteLength: number
  sections: readonly FoundationIrSourceSection[]
}>

/**
 * The only input handoff currently prepared for Game IR.  It owns neither a
 * workflow phase nor a publication; it is an immutable projection of the
 * already accepted public Reviewer result.
 */
export type FoundationIrInput = Readonly<{
  protocolVersion: 1
  ownerId: string
  projectId: string
  foundationResultId: string
  foundationResultDigest: string
  publishedDocumentRevision: string
  documentSetDigest: string
  confirmedBriefDigest: string
  confirmedRequirementsDigest: string
  documents: readonly FoundationIrSourceDocument[]
  sourceIndexDigest: string
}>

function digestBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function digestJson(value: unknown): string {
  return digestBytes(Buffer.from(JSON.stringify(value), 'utf8'))
}

type SourceLine = Readonly<{
  text: string
  startByte: number
  endByte: number
}>

function splitSourceLines(content: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  let startChar = 0
  let startByte = 0
  while (startChar < content.length) {
    const newline = content.slice(startChar).search(/[\r\n]/u)
    if (newline < 0) {
      const text = content.slice(startChar)
      lines.push({ text, startByte, endByte: startByte + Buffer.byteLength(text, 'utf8') })
      break
    }
    const newlineChar = startChar + newline
    const newlineLength = content[newlineChar] === '\r' && content[newlineChar + 1] === '\n' ? 2 : 1
    const lineEndChar = newlineChar + newlineLength
    const line = content.slice(startChar, lineEndChar)
    lines.push({ text: line.replace(/[\r\n]+$/u, ''), startByte,
      endByte: startByte + Buffer.byteLength(line, 'utf8') })
    startChar = lineEndChar
    startByte += Buffer.byteLength(line, 'utf8')
  }
  if (content.length === 0 || (lines.length > 0 && lines.at(-1)!.endByte < Buffer.byteLength(content, 'utf8')))
    lines.push({ text: '', startByte: Buffer.byteLength(content, 'utf8'), endByte: Buffer.byteLength(content, 'utf8') })
  return lines
}

function structuralSections(content: string): readonly FoundationIrSourceSection[] {
  const bytes = Buffer.from(content, 'utf8')
  const lines = splitSourceLines(content)
  const headings: Array<{ line: SourceLine; level: number; text: string }> = []
  let fence: { character: '`' | '~'; length: number } | undefined
  for (const line of lines) {
    if (fence) {
      const closingFence = line.text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)
      if (closingFence && closingFence[1]![0] === fence.character && closingFence[1]!.length >= fence.length)
        fence = undefined
      continue
    }
    const fenceMatch = line.text.match(/^ {0,3}(`{3,}|~{3,})/u)
    if (fenceMatch) {
      fence = { character: fenceMatch[1]![0] as '`' | '~', length: fenceMatch[1]!.length }
      continue
    }
    const heading = line.text.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/u)
    if (heading)
      headings.push({ line, level: heading[1]!.length, text: heading[2]!.replace(/[ \t]+#+[ \t]*$/u, '').trim() })
  }
  const boundaries = headings.map(heading => heading.line.startByte)
  const sections: FoundationIrSourceSection[] = []
  const add = (kind: FoundationIrSourceSection['kind'], level: number, text: string, ordinal: number,
    startByte: number, endByte: number) => {
    const slice = bytes.subarray(startByte, endByte)
    sections.push({ ordinal, kind, headingLevel: level, headingText: text,
      startByte, endByte, digest: digestBytes(slice) })
  }
  let ordinal = 0
  if (boundaries[0] !== 0) add('preamble', 0, '', ordinal++, 0, boundaries[0] ?? bytes.byteLength)
  for (const [index, heading] of headings.entries())
    add('heading', heading.level, heading.text, ordinal++, heading.line.startByte,
      boundaries[index + 1] ?? bytes.byteLength)
  if (sections.length === 0) add('preamble', 0, '', ordinal, 0, bytes.byteLength)
  return sections
}

function assertCompleteSections(path: FoundationDocumentPath, content: string, sections: readonly FoundationIrSourceSection[]): void {
  const total = Buffer.byteLength(content, 'utf8')
  let cursor = 0
  for (const [index, section] of sections.entries()) {
    if (section.ordinal !== index || section.startByte !== cursor || section.endByte <= section.startByte || section.endByte > total)
      throw new Error(`IR source index has a non-contiguous range: ${path}`)
    const actual = digestBytes(Buffer.from(content, 'utf8').subarray(section.startByte, section.endByte))
    if (actual !== section.digest) throw new Error(`IR source index digest mismatch: ${path}`)
    cursor = section.endByte
  }
  if (cursor !== total) throw new Error(`IR source index does not cover the document: ${path}`)
}

function documentSetDigest(documents: readonly { path: string; digest: string }[]): string {
  return digestJson(documents.map(document => [document.path, document.digest]))
}

/**
 * Capture exact accepted Reviewer bytes into an IR-owned structural index.
 * There is deliberately no workspacePath: the accepted result is the source
 * and a changed workspace cannot replace it.
 */
export function captureFoundationIrInput(input: {
  ownerId: string
  projectId: string
  acceptedReview: ReviewerReviewResult
  publishedDocumentRevision: string
}): FoundationIrInput {
  const { acceptedReview } = input
  const binding = foundationResultBinding({ ownerId: input.ownerId, projectId: input.projectId }, acceptedReview)
  if (!SHA256.test(input.publishedDocumentRevision) || input.publishedDocumentRevision !== acceptedReview.documentSetDigest)
    throw new Error('Published document revision is not bound to the accepted Reviewer document set')
  if (acceptedReview.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length ||
      acceptedReview.documents.some((document, index) => document.path !== CANONICAL_FOUNDATION_DOCUMENTS[index]))
    throw new Error('Accepted Reviewer result does not contain the canonical eight documents')
  if (acceptedReview.requirements.status !== 'available')
    throw new Error('Accepted Reviewer result does not contain the confirmed requirements summary')
  const requirements = acceptedReview.requirements
  if (acceptedReview.subject.confirmedBriefDigest !== requirements.digest ||
      digestBytes(Buffer.from(requirements.content, 'utf8')) !== requirements.digest)
    throw new Error('Accepted Reviewer result does not contain the confirmed requirements summary')
  const documents = acceptedReview.documents.map(document => {
    const byteLength = Buffer.byteLength(document.content, 'utf8')
    const digest = digestBytes(Buffer.from(document.content, 'utf8'))
    if (!SHA256.test(document.digest) || document.digest !== digest || document.byteLength !== byteLength)
      throw new Error(`Accepted Reviewer document bytes are not self-consistent: ${document.path}`)
    const sections = Object.freeze(structuralSections(document.content).map(section => Object.freeze(section)))
    assertCompleteSections(document.path, document.content, sections)
    return Object.freeze({ path: document.path, content: document.content, digest, byteLength, sections })
  })
  if (documentSetDigest(documents) !== acceptedReview.documentSetDigest)
    throw new Error('Accepted Reviewer document set digest mismatch')
  const sourceIndex = documents.map(document => ({ path: document.path,
    digest: document.digest, byteLength: document.byteLength, sections: document.sections }))
  return Object.freeze({ protocolVersion: 1, ownerId: input.ownerId, projectId: input.projectId,
    foundationResultId: binding.resultId, foundationResultDigest: binding.resultDigest,
    publishedDocumentRevision: input.publishedDocumentRevision, documentSetDigest: acceptedReview.documentSetDigest,
    confirmedBriefDigest: acceptedReview.subject.confirmedBriefDigest,
    confirmedRequirementsDigest: acceptedReview.requirements.digest, documents: Object.freeze(documents),
    sourceIndexDigest: foundationPublicDigest(sourceIndex) })
}
