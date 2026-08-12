import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  GAME_DOCUMENT_RESPONSIBILITIES,
  getGameDocumentContract,
  type GameDocumentResponsibility,
} from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

export const FOUNDATION_AUTHORITY_KINDS = [
  'fact',
  'decision',
  'constraint',
  'metric',
  'dependency',
  'risk',
  'open_decision',
] as const

export type FoundationAuthorityRecord = Readonly<{
  authorityId: string
  sectionId: string
  kind: (typeof FOUNDATION_AUTHORITY_KINDS)[number]
  state: 'confirmed' | 'assumed' | 'deferred'
  statement: string
  responsibilityIds: readonly GameDocumentResponsibility[]
  value?: string | number | boolean
  unit?: string
}>

export type FoundationAuthoritySidecar = Readonly<{
  schemaVersion: 1
  documentPath: FoundationDocumentPath
  documentDigest: string
  records: readonly FoundationAuthorityRecord[]
}>

const optionalNonEmptyString = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const optionalAuthorityValue = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.union([z.string().trim().min(1), z.number().finite(), z.boolean()]).optional(),
)

const authorityRecordSchema = z
  .object({
    authorityId: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    sectionId: z.string().trim().min(1),
    kind: z.enum(FOUNDATION_AUTHORITY_KINDS),
    state: z.enum(['confirmed', 'assumed', 'deferred']),
    statement: z.string().trim().min(1).max(600),
    responsibilityIds: z
      .array(z.enum(GAME_DOCUMENT_RESPONSIBILITIES))
      .min(1),
    value: optionalAuthorityValue,
    unit: optionalNonEmptyString,
  })
  .strict()

export const foundationAuthoritySubmissionSchema = z
  .object({ records: z.array(authorityRecordSchema).min(1) })
  .strict()

const storedAuthoritySidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(authorityRecordSchema).min(1),
  })
  .strict()

const MAX_SIDECAR_BYTES = 96 * 1024

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function assertCanonicalIdentifiers(
  values: readonly string[],
  label: string,
): void {
  if (new Set(values).size !== values.length)
    throw new Error(`foundation authority ${label} values are duplicated`)
  const sorted = [...values].sort(bytewise)
  if (sorted.some((value, index) => value !== values[index]))
    throw new Error(`foundation authority ${label} order is not canonical`)
}

function assertRecordContract(
  documentPath: FoundationDocumentPath,
  records: readonly z.infer<typeof authorityRecordSchema>[],
): void {
  const contract = getGameDocumentContract(documentPath)
  const sectionById = new Map(
    contract.sections.map(section => [section.sectionId, section] as const),
  )
  const authorityPrefix = `${CANONICAL_PROJECT_DOCUMENT_IDS[
    documentPath
  ].toLowerCase()}.`
  assertCanonicalIdentifiers(
    records.map(record => record.authorityId),
    'record ID',
  )

  for (const record of records) {
    const section = sectionById.get(record.sectionId)
    if (!section)
      throw new Error(
        `foundation authority section is not contracted: ${record.sectionId}`,
      )
    if (!record.authorityId.startsWith(`${authorityPrefix}${record.sectionId}.`))
      throw new Error(
        `foundation authority ID is outside its document section: ${record.authorityId}`,
      )
    assertCanonicalIdentifiers(record.responsibilityIds, 'responsibility ID')
    const ownedResponsibilities = new Set(section.responsibilityIds)
    if (
      record.responsibilityIds.some(
        responsibilityId => !ownedResponsibilities.has(responsibilityId),
      )
    )
      throw new Error(
        `foundation authority responsibility is not owned by section: ${record.authorityId}`,
      )
    if (/\r|\n/.test(record.statement))
      throw new Error(
        `foundation authority statement must be one declarative line: ${record.authorityId}`,
      )
    if (record.kind === 'open_decision' && record.state !== 'deferred')
      throw new Error(
        `foundation authority open decision must be deferred: ${record.authorityId}`,
      )
    if (
      record.kind === 'metric' &&
      typeof record.value === 'number' &&
      !record.unit
    )
      throw new Error(
        `foundation authority numeric metric requires a unit: ${record.authorityId}`,
      )
  }

  const coveredSections = new Set(records.map(record => record.sectionId))
  const missingSections = contract.sections.filter(
    section => !coveredSections.has(section.sectionId),
  )
  if (missingSections.length)
    throw new Error(
      `foundation authority section coverage is incomplete: ${missingSections
        .map(section => section.sectionId)
        .join(', ')}`,
    )
}

function freezeSidecar(
  parsed: z.infer<typeof storedAuthoritySidecarSchema>,
): FoundationAuthoritySidecar {
  const records = parsed.records.map(record =>
    Object.freeze({
      ...record,
      responsibilityIds: Object.freeze([...record.responsibilityIds]),
    }),
  )
  return Object.freeze({
    schemaVersion: 1 as const,
    documentPath: parsed.documentPath,
    documentDigest: parsed.documentDigest,
    records: Object.freeze(records),
  })
}

export function authoritySidecarPath(path: FoundationDocumentPath): string {
  return path.endsWith('.md')
    ? `${path.slice(0, -'.md'.length)}.authority.json`
    : `${path}.authority.json`
}

export function foundationDocumentDigest(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex')
}

export function canonicalFoundationAuthoritySidecarBytes(
  sidecar: FoundationAuthoritySidecar,
): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`
}

export function validateFoundationAuthoritySidecar(input: {
  documentPath: FoundationDocumentPath
  markdown: string
  value: unknown
}): FoundationAuthoritySidecar {
  const parsed = storedAuthoritySidecarSchema.parse(input.value)
  if (parsed.documentPath !== input.documentPath)
    throw new Error('foundation authority sidecar path does not match document')
  if (parsed.documentDigest !== foundationDocumentDigest(input.markdown))
    throw new Error('foundation authority sidecar digest does not match document')
  assertRecordContract(input.documentPath, parsed.records)
  const frozen = freezeSidecar(parsed)
  if (
    new TextEncoder().encode(canonicalFoundationAuthoritySidecarBytes(frozen))
      .byteLength > MAX_SIDECAR_BYTES
  )
    throw new Error('foundation authority sidecar exceeds the 96 KiB size limit')
  return frozen
}

export function createFoundationAuthoritySidecar(input: {
  documentPath: FoundationDocumentPath
  markdown: string
  submission: unknown
}): FoundationAuthoritySidecar {
  const submission = foundationAuthoritySubmissionSchema.parse(input.submission)
  return validateFoundationAuthoritySidecar({
    documentPath: input.documentPath,
    markdown: input.markdown,
    value: {
      schemaVersion: 1,
      documentPath: input.documentPath,
      documentDigest: foundationDocumentDigest(input.markdown),
      records: submission.records,
    },
  })
}
