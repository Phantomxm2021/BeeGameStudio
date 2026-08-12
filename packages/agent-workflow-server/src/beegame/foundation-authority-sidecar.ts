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

export const FOUNDATION_AUTHORITY_SOURCES = [
  'user_setting',
  'confirmed_brief',
  'upstream_authority',
  'model_estimate',
  'measured_evidence',
  'external_evidence',
] as const

export const FOUNDATION_AUTHORITY_STATES = [
  'confirmed',
  'assumed',
  'deferred',
  'verified',
] as const

export const AUTHORITY_EVIDENCE_KINDS = [
  'file',
  'receipt',
  'test',
  'measurement',
  'license',
  'url',
] as const

export type AuthoritySource = (typeof FOUNDATION_AUTHORITY_SOURCES)[number]
export type AuthorityState = (typeof FOUNDATION_AUTHORITY_STATES)[number]

export type AuthorityEvidenceRef = Readonly<{
  kind: (typeof AUTHORITY_EVIDENCE_KINDS)[number]
  locator: string
  digest?: string
}>

export type FoundationAuthorityRecord = Readonly<{
  authorityId: string
  sectionId: string
  kind: (typeof FOUNDATION_AUTHORITY_KINDS)[number]
  state: AuthorityState
  source: AuthoritySource
  evidenceRefs: readonly AuthorityEvidenceRef[]
  statement: string
  responsibilityIds: readonly GameDocumentResponsibility[]
  value?: string | number | boolean
  unit?: string
  decision?: Readonly<{
    owner: string
    neededBy: string
  }>
}>

export type FoundationAuthoritySidecar = Readonly<{
  schemaVersion: 1 | 2
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

const authorityRecordV1Schema = z
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

export const authorityEvidenceRefSchema = z
  .object({
    kind: z.enum(AUTHORITY_EVIDENCE_KINDS),
    locator: z.string().trim().min(1).max(1_024),
    digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.kind === 'file' && reference.digest === undefined)
      context.addIssue({
        code: 'custom',
        message: 'foundation authority file evidence requires a SHA-256 digest',
        path: ['digest'],
      })
  })

const authorityDecisionSchema = z
  .object({
    owner: z.string().trim().min(1).max(160),
    neededBy: z.string().trim().min(1).max(160),
  })
  .strict()

const authorityRecordV2Schema = authorityRecordV1Schema
  .extend({
    state: z.enum(FOUNDATION_AUTHORITY_STATES),
    source: z.enum(FOUNDATION_AUTHORITY_SOURCES),
    evidenceRefs: z.array(authorityEvidenceRefSchema),
    decision: authorityDecisionSchema.optional(),
  })
  .strict()

export const foundationAuthoritySubmissionSchema = z
  .object({ records: z.array(authorityRecordV2Schema).min(1) })
  .strict()

const storedAuthoritySidecarV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(authorityRecordV1Schema).min(1),
  })
  .strict()

const storedAuthoritySidecarV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(authorityRecordV2Schema).min(1),
  })
  .strict()

const readableAuthoritySidecarSchema = z.discriminatedUnion('schemaVersion', [
  storedAuthoritySidecarV1Schema,
  storedAuthoritySidecarV2Schema,
])

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
  records: readonly FoundationAuthorityRecord[],
  schemaVersion: 1 | 2,
): void {
  const contract = getGameDocumentContract(documentPath)
  const sectionById = new Map(
    contract.sections.map(section => [section.sectionId, section] as const),
  )
  const authorityPrefix = `${CANONICAL_PROJECT_DOCUMENT_IDS[
    documentPath
  ].toLowerCase()}.`
  assertNoLowerPriorityReplacement(records)
  assertCanonicalIdentifiers(records.map(record => record.authorityId), 'record ID')

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
      schemaVersion === 2 &&
      record.kind === 'open_decision' &&
      record.decision === undefined
    )
      throw new Error(
        `foundation authority open decision requires owner and needed-by metadata: ${record.authorityId}`,
      )
    if (record.kind !== 'open_decision' && record.decision !== undefined)
      throw new Error(
        `foundation authority decision metadata is only allowed for open decisions: ${record.authorityId}`,
      )
    if (
      record.kind === 'metric' &&
      typeof record.value === 'number' &&
      !record.unit
    )
      throw new Error(
        `foundation authority numeric metric requires a unit: ${record.authorityId}`,
      )
    assertAuthorityTrust(record)
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

function authorityPriority(source: AuthoritySource): number {
  switch (source) {
    case 'user_setting':
      return 6
    case 'confirmed_brief':
      return 5
    case 'measured_evidence':
    case 'external_evidence':
      return 4
    case 'upstream_authority':
      return 3
    case 'model_estimate':
      return 1
  }
}

function assertNoLowerPriorityReplacement(
  records: readonly FoundationAuthorityRecord[],
): void {
  const byId = new Map<string, FoundationAuthorityRecord>()
  for (const record of records) {
    const prior = byId.get(record.authorityId)
    if (!prior) {
      byId.set(record.authorityId, record)
      continue
    }
    if (authorityPriority(prior.source) !== authorityPriority(record.source))
      throw new Error(
        `foundation authority lower-priority source cannot replace authority ID: ${record.authorityId}`,
      )
  }
}

function assertAuthorityTrust(record: FoundationAuthorityRecord): void {
  if (
    (record.source === 'user_setting' || record.source === 'confirmed_brief') &&
    record.state !== 'confirmed' &&
    record.state !== 'deferred'
  )
    throw new Error(
      `foundation authority ${record.source} record must be confirmed or deferred: ${record.authorityId}`,
    )
  if (
    record.source === 'model_estimate' &&
    record.state !== 'assumed' &&
    record.state !== 'deferred'
  )
    throw new Error(
      `foundation authority model estimate cannot be ${record.state}: ${record.authorityId}`,
    )
  if (record.state === 'verified' && record.evidenceRefs.length === 0)
    throw new Error(
      `foundation authority verified record requires evidence: ${record.authorityId}`,
    )
}

function freezeSidecar(
  parsed: z.infer<typeof readableAuthoritySidecarSchema>,
): FoundationAuthoritySidecar {
  const normalizedRecords: FoundationAuthorityRecord[] =
    parsed.schemaVersion === 1
      ? parsed.records.map(record => ({
          ...record,
          source: 'upstream_authority' as const,
          evidenceRefs: [],
        }))
      : parsed.records
  const records = normalizedRecords.map(normalized => {
    return Object.freeze({
      ...normalized,
      responsibilityIds: Object.freeze([...normalized.responsibilityIds]),
      evidenceRefs: Object.freeze(
        normalized.evidenceRefs.map(reference => Object.freeze({ ...reference })),
      ),
      ...(normalized.decision
        ? { decision: Object.freeze({ ...normalized.decision }) }
        : {}),
    })
  })
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
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
  const parsed = readableAuthoritySidecarSchema.parse(input.value)
  if (parsed.documentPath !== input.documentPath)
    throw new Error('foundation authority sidecar path does not match document')
  if (parsed.documentDigest !== foundationDocumentDigest(input.markdown))
    throw new Error('foundation authority sidecar digest does not match document')
  const frozen = freezeSidecar(parsed)
  assertRecordContract(input.documentPath, frozen.records, parsed.schemaVersion)
  if (
    new TextEncoder().encode(`${JSON.stringify(parsed, null, 2)}\n`).byteLength >
    MAX_SIDECAR_BYTES
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
  const records = submission.records
    .map(record => ({
      ...record,
      responsibilityIds: [...record.responsibilityIds].sort(bytewise),
      evidenceRefs: [...record.evidenceRefs].sort((left, right) =>
        bytewise(
          `${left.kind}\u0000${left.locator}\u0000${left.digest ?? ''}`,
          `${right.kind}\u0000${right.locator}\u0000${right.digest ?? ''}`,
        ),
      ),
    }))
    .sort((left, right) => bytewise(left.authorityId, right.authorityId))
  return validateFoundationAuthoritySidecar({
    documentPath: input.documentPath,
    markdown: input.markdown,
    value: {
      schemaVersion: 2,
      documentPath: input.documentPath,
      documentDigest: foundationDocumentDigest(input.markdown),
      records,
    },
  })
}
