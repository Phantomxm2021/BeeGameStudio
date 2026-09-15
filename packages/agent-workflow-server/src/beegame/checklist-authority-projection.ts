import { createHash } from 'node:crypto'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './foundation-documents'

const SHA256 = /^[a-f0-9]{64}$/u

/**
 * The small, immutable handoff that Checklist is allowed to consume.
 *
 * The documents are the content authority. `irModules` is only a stable
 * association to an already verified implementation/verification result; it
 * is intentionally limited to acceptance-scenario nodes and never replaces
 * document text.
 */
export type ChecklistAuthority = Readonly<{
  foundationRevision: string
  documentSetDigest?: string
  documents: readonly ChecklistAuthorityDocument[]
  irResultId: string
  irModules: readonly ChecklistAuthorityIrModule[]
}>

export type ChecklistAuthorityDocument = Readonly<{
  path: FoundationDocumentPath
  content: string
  digest: string
}>

export type ChecklistAuthorityIrModule = Readonly<{
  moduleId: string
  nodes: readonly ChecklistAuthorityIrNode[]
}>

export type ChecklistAuthorityIrNode = Readonly<{
  id: string
  /** The value of an implementation-verification.acceptance-scenario node. */
  value: Readonly<Record<string, unknown>>
  /** Optional source excerpt references copied from the verified IR node. */
  bindings?: Readonly<Record<string, unknown>>
  /** Accepted for callers that retain the node kind in the compact handoff. */
  kind?: string
}>

/**
 * Build the Checklist prompt authority from an accepted, self-contained
 * snapshot. This function deliberately has no workspace path: reading the
 * current project documents here would allow an unapproved edit to become
 * Checklist authority.
 */
export function buildChecklistAuthorityProjection(input: {
  checklistAuthority: ChecklistAuthority
  approvedDocumentRevision: string
}): string {
  const authority = validateChecklistAuthority(
    input.checklistAuthority,
    input.approvedDocumentRevision,
  )
  const scenarios = authority.irModules.flatMap(module =>
    module.nodes.map(node => ({ moduleId: module.moduleId, node })),
  )

  return [
    '# Checklist Authority Projection',
    '',
    `Approved foundation revision: ${authority.foundationRevision}`,
    `Verified IR result: ${authority.irResultId}`,
    '',
    'The eight documents below are the sole Checklist content authority. Preserve their meaning and wording; do not infer product behavior from omitted text, prior checklists, generic best practice, or verification metadata. The verified IR scenarios are stable associations for implementation verification, not additional product requirements.',
    '',
    ...authority.documents.flatMap(document => [
      `--- BEGIN FOUNDATION DOCUMENT ${document.path} (sha256:${document.digest}) ---`,
      document.content,
      `--- END FOUNDATION DOCUMENT ${document.path} ---`,
      '',
    ]),
    ...scenarios.flatMap(({ moduleId, node }) => [
      `--- BEGIN VERIFIED ACCEPTANCE SCENARIO ${moduleId}#${node.id} ---`,
      `id: ${node.id}`,
      `value: ${JSON.stringify(node.value)}`,
      ...(node.bindings === undefined
        ? []
        : [`source excerpt references: ${JSON.stringify(node.bindings)}`]),
      `--- END VERIFIED ACCEPTANCE SCENARIO ${moduleId}#${node.id} ---`,
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
  assertText(
    value.foundationRevision,
    'checklist authority foundation revision',
  )
  if (value.foundationRevision !== approvedDocumentRevision)
    throw new Error(
      'checklist authority foundation revision does not match approved document revision',
    )
  assertText(value.irResultId, 'checklist authority IR result ID')
  if (/[[\]{}\r\n]/u.test(value.irResultId))
    throw new Error(
      'checklist authority IR result ID contains unsafe characters',
    )

  if (
    !Array.isArray(value.documents) ||
    value.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length
  )
    throw new Error(
      'checklist authority must contain exactly eight foundation documents',
    )

  const documents = value.documents.map((document, index) => {
    assertPlainObject(document, `checklist authority document ${index}`)
    const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[index]
    if (document.path !== expectedPath)
      throw new Error(
        `checklist authority document order/path is invalid: expected ${expectedPath}`,
      )
    assertText(
      document.content,
      `checklist authority document ${document.path} content`,
    )
    assertDigest(
      document.digest,
      `checklist authority document ${document.path} digest`,
    )
    const digest = sha256(document.content)
    if (document.digest !== digest)
      throw new Error(
        `checklist authority document digest mismatch: ${document.path}`,
      )
    return {
      path: expectedPath,
      content: document.content,
      digest: document.digest,
    }
  })

  const calculatedDocumentSetDigest = sha256(
    JSON.stringify(documents.map(document => [document.path, document.digest])),
  )
  if (value.documentSetDigest !== undefined) {
    assertDigest(
      value.documentSetDigest,
      'checklist authority document set digest',
    )
    if (value.documentSetDigest !== calculatedDocumentSetDigest)
      throw new Error('checklist authority document set digest mismatch')
  }
  if (value.foundationRevision !== calculatedDocumentSetDigest)
    throw new Error(
      'checklist authority foundation revision is not the document set digest',
    )

  if (!Array.isArray(value.irModules))
    throw new Error('checklist authority IR modules are missing')
  const irModules = value.irModules.map((module, index) => {
    assertPlainObject(module, `checklist authority IR module ${index}`)
    assertText(module.moduleId, `checklist authority IR module ${index} ID`)
    if (module.moduleId !== 'implementation-verification')
      throw new Error(
        `checklist authority IR module ${module.moduleId} is not implementation-verification`,
      )
    if (!Array.isArray(module.nodes))
      throw new Error(
        `checklist authority IR module ${module.moduleId} nodes are missing`,
      )
    const nodes = module.nodes.map((node, nodeIndex) => {
      assertPlainObject(
        node,
        `checklist authority IR node ${module.moduleId}[${nodeIndex}]`,
      )
      assertText(
        node.id,
        `checklist authority IR node ${module.moduleId}[${nodeIndex}] ID`,
      )
      if (
        node.kind !== undefined &&
        node.kind !== 'implementation-verification.acceptance-scenario'
      )
        throw new Error(
          `checklist authority IR node ${node.id} is not an acceptance scenario`,
        )
      assertPlainObject(
        node.value,
        `checklist authority IR node ${node.id} value`,
      )
      if (node.bindings !== undefined)
        assertPlainObject(
          node.bindings,
          `checklist authority IR node ${node.id} bindings`,
        )
      return {
        id: node.id,
        value: node.value,
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        ...(node.bindings === undefined ? {} : { bindings: node.bindings }),
      }
    })
    return { moduleId: module.moduleId, nodes }
  })

  // Return a detached value after validation. The projection is a string, but
  // cloning also prevents a caller mutation from changing what was checked.
  return {
    foundationRevision: value.foundationRevision,
    ...(value.documentSetDigest
      ? { documentSetDigest: value.documentSetDigest }
      : {}),
    documents,
    irResultId: value.irResultId,
    irModules,
  }
}

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
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
