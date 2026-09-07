import { z } from 'zod/v4'
import { applyFoundationRevisionSections, deriveRevisionPatchOperations, type PatchOperation, parseRevisionSections } from './markdown'
import { deriveRevisionDocumentPatchOperation } from './complete-document'
import { prepareRevisionRequest } from './request-preparation'
import { prepareRevisionWorkerInputs } from './worker-input'
import { revisionBytesDigest, revisionCanonicalJson } from './json-digest'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'
import { advanceRevisionDocumentMetadata } from './document-metadata'

/** The native Markdown body boundary shared with the worker stream. */
export const REVISION_WORKER_OUTPUT_MAX_BYTES = 2 * 1024 * 1024

const inputSchema = z.object({
  request: z.unknown(),
  documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  markdown: z.string(),
}).strict()

export type AcceptedRevisionWorkerOutput = Readonly<{
  requestDigest: string
  packetDigest: string
  documentPath: FoundationDocumentPath
  scope: 'document' | 'section'
  baseDocumentDigest: string
  markdown: string
  documentDigest: string
  operations: readonly PatchOperation[]
}>

function captureInput(value: unknown): z.infer<typeof inputSchema> {
  // Canonicalization validates descriptors and object prototypes before any
  // field is read. This keeps getters, hidden fields, symbols and foreign
  // object graphs outside the acceptance boundary.
  const canonical = revisionCanonicalJson(value)
  return inputSchema.parse(JSON.parse(canonical))
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Accepts one native Revision Markdown result and derives its complete
 * document and mechanical operations from the frozen request authority.
 * Workers never supply patch bodies, issue bindings or digests.
 */
export function acceptRevisionWorkerOutput(value: unknown, options: { updatedAt?: string } = {}): AcceptedRevisionWorkerOutput {
  const input = captureInput(value)
  if (Buffer.byteLength(input.markdown, 'utf8') > REVISION_WORKER_OUTPUT_MAX_BYTES)
    throw new Error('Revision Markdown exceeds infrastructure boundary')

  const prepared = prepareRevisionRequest(input.request)
  const works = prepareRevisionWorkerInputs(prepared.request)
  const work = works.find(entry => entry.packet.documentPath === input.documentPath)
  if (!work) throw new Error('Revision document has no dispatch authority')
  const batch = prepared.batches.find(entry => entry.documentPath === input.documentPath)
  if (!batch || batch.scope !== work.packet.scope)
    throw new Error('Revision worker packet scope authority is invalid')
  const base = prepared.staging.documents.find(document => document.path === input.documentPath)
  if (!base) throw new Error('Revision document base authority is missing')
  if (work.packet.baseDocumentDigest !== base.digest)
    throw new Error('Revision worker packet base digest is stale')

  let markdown = input.markdown
  let operations: PatchOperation[]
  if (batch.scope === 'document') {
    markdown = advanceRevisionDocumentMetadata({ baseMarkdown: base.content, candidateMarkdown: markdown, ...options })
    operations = [deriveRevisionDocumentPatchOperation({
      documentPath: input.documentPath,
      baseMarkdown: base.content,
      stagedMarkdown: markdown,
      issues: work.packet.issues,
    })]
  } else {
    // Section workers return only the complete set of authorized sections.
    // Reassemble those slices against the frozen base document before any
    // digest or operation is exposed to the owner.
    const replacements = parseRevisionSections({
      documentPath: input.documentPath,
      baseMarkdown: base.content,
      authorizedSectionIds: batch.sectionIds,
      output: markdown,
    })
    markdown = applyFoundationRevisionSections({
      documentPath: input.documentPath,
      baseMarkdown: base.content,
      authorizedSectionIds: batch.sectionIds,
      replacements,
    }).markdown
    markdown = advanceRevisionDocumentMetadata({ baseMarkdown: base.content, candidateMarkdown: markdown, ...options })
    const issueIdsBySection = new Map<string, string[]>()
    for (const issue of work.packet.issues) {
      if (issue.remediation.scope !== 'section' || issue.remediation.documentPath !== input.documentPath)
        throw new Error('Revision section worker issue authority is invalid')
      for (const sectionId of issue.remediation.sectionIds)
        issueIdsBySection.set(sectionId, [...(issueIdsBySection.get(sectionId) ?? []), issue.id])
    }
    operations = deriveRevisionPatchOperations({
      documentPath: input.documentPath,
      baseMarkdown: base.content,
      stagedMarkdown: markdown,
      authorizedSectionIds: batch.sectionIds,
      issueIdsBySection,
    })
  }

  return freeze({
    requestDigest: prepared.requestDigest,
    packetDigest: work.packetDigest,
    documentPath: input.documentPath,
    scope: batch.scope,
    baseDocumentDigest: base.digest,
    markdown,
    documentDigest: revisionBytesDigest(markdown),
    operations,
  })
}
