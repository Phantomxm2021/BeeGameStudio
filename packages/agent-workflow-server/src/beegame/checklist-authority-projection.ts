import { createHash } from 'node:crypto'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './foundation-documents'

const SHA256 = /^[a-f0-9]{64}$/u

/** Immutable document snapshot used to author the implementation checklist. */
export type ChecklistAuthority = Readonly<{
  foundationRevision: string
  documentSetDigest?: string
  documents: readonly ChecklistAuthorityDocument[]
}>

export type ChecklistAuthorityDocument = Readonly<{
  path: FoundationDocumentPath
  content: string
  digest: string
}>

export function buildChecklistAuthorityProjection(input: {
  checklistAuthority: ChecklistAuthority
  approvedDocumentRevision: string
}): string {
  const authority = validateChecklistAuthority(
    input.checklistAuthority,
    input.approvedDocumentRevision,
  )
  return [
    '# Checklist Authority',
    '',
    `Approved foundation revision: ${authority.foundationRevision}`,
    '',
    'The eight documents below are the sole content authority. Produce the implementation checklist from them. Do not invent requirements from generic best practices or prior runs.',
    '',
    ...authority.documents.flatMap(document => [
      `--- BEGIN FOUNDATION DOCUMENT ${document.path} (sha256:${document.digest}) ---`,
      document.content,
      `--- END FOUNDATION DOCUMENT ${document.path} ---`,
      '',
    ]),
  ].join('\n')
}

function validateChecklistAuthority(
  value: ChecklistAuthority,
  approvedDocumentRevision: string,
): ChecklistAuthority {
  assertPlainObject(value, 'checklist authority')
  assertText(approvedDocumentRevision, 'approved document revision')
  assertText(value.foundationRevision, 'checklist authority foundation revision')
  if (value.foundationRevision !== approvedDocumentRevision)
    throw new Error('checklist authority foundation revision does not match approved document revision')
  if (!Array.isArray(value.documents) || value.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length)
    throw new Error('checklist authority must contain exactly eight foundation documents')

  const documents = value.documents.map((document, index) => {
    assertPlainObject(document, `checklist authority document ${index}`)
    const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[index]
    if (document.path !== expectedPath)
      throw new Error(`checklist authority document order/path is invalid: expected ${expectedPath}`)
    assertText(document.content, `checklist authority document ${document.path} content`)
    assertDigest(document.digest, `checklist authority document ${document.path} digest`)
    if (document.digest !== sha256(document.content))
      throw new Error(`checklist authority document digest mismatch: ${document.path}`)
    return { path: expectedPath, content: document.content, digest: document.digest }
  })

  const documentSetDigest = sha256(
    JSON.stringify(documents.map(document => [document.path, document.digest])),
  )
  if (value.documentSetDigest !== undefined) {
    assertDigest(value.documentSetDigest, 'checklist authority document set digest')
    if (value.documentSetDigest !== documentSetDigest)
      throw new Error('checklist authority document set digest mismatch')
  }
  if (value.foundationRevision !== documentSetDigest)
    throw new Error('checklist authority foundation revision is not the document set digest')

  return {
    foundationRevision: value.foundationRevision,
    ...(value.documentSetDigest ? { documentSetDigest: value.documentSetDigest } : {}),
    documents,
  }
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error(`${label} must be a plain object`)
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be non-empty text`)
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new Error(`${label} must be a SHA-256 digest`)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
