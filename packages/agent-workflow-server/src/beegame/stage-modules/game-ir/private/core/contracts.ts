import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../../../../foundation-documents'

export const GAME_IR_SCHEMA_VERSION = 'game-ir.v1' as const
export const GAME_IR_PUBLICATION_ROOT =
  `.beegame/ir/${GAME_IR_SCHEMA_VERSION}` as const
export const GAME_IR_CANONICAL_MODULE_IDS = Object.freeze([
  'balance',
  'gameplay',
  'implementation-verification',
  'presentation',
  'resource-realization',
  'world-scene',
] as const)
export type GameIrModuleId = (typeof GAME_IR_CANONICAL_MODULE_IDS)[number]

export type FoundationReadyReceipt = Readonly<{
  schemaVersion: 'foundation-ready-receipt.v2'
  /** Trusted application identity copied from the accepted public result. */
  ownerId: string
  projectId: string
  foundationResultId: string
  foundationResultDigest: string
  /** The accepted public document-set revision; used as IR revision identity. */
  foundationRevision: string
  documentSetDigest: string
  confirmedBriefDigest: string
  confirmedRequirementsDigest: string
  documentDigests: Readonly<Record<FoundationDocumentPath, string>>
  sourceIndexDigest: string
  /** Derived structural index digest used by the IR domain envelopes. */
  sectionIndexDigest: string
  receiptDigest: string
}>

export type GameIrCompileRequest = Readonly<{
  schemaVersion: 'game-ir-compile-request.v1'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v1'
  foundation: FoundationReadyReceipt
}>

export type FoundationDefectReport = Readonly<{
  schemaVersion: 'foundation-defect-report.v1'
  taskId: string
  foundationRevision: string
  reasonCode: string
  expected: string
  actual: string
  source: Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
    digest: string
  }>
  target: Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
  }>
  sourceBindingPointers: readonly string[]
}>

export type GameIrReadyReceipt = Readonly<{
  schemaVersion: 'game-ir-ready-receipt.v1'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v1'
  foundationRevision: string
  foundationReceiptDigest: string
  manifestDigest: string
  moduleDigests: Readonly<Record<GameIrModuleId, string>>
  sourceMapDigests: Readonly<Record<GameIrModuleId, string>>
  dependencyGraphDigest: string
  committedPath: string
}>

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'expected a SHA-256 digest')
const nonEmptyTextSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'must not be empty',
})
const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const foundationRevisionSchema = safeIdSchema
const foundationDocumentPathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)

export function gameIrCommittedPath(foundationRevision: string): string {
  return `${gameIrRevisionPath(foundationRevision)}/COMMITTED.json`
}

export function gameIrRevisionPath(foundationRevision: string): string {
  if (!safeIdSchema.safeParse(foundationRevision).success)
    throw new Error(
      'Game IR foundation revision is not a canonical path segment',
    )
  return `${GAME_IR_PUBLICATION_ROOT}/revisions/${foundationRevision}`
}

const safeRelativeArtifactPathSchema = z.string().refine(value => {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes('\\') ||
    value.includes('\0')
  )
    return false
  return value
    .split('/')
    .every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}, 'must be a safe relative artifact path')

const documentDigestShape = Object.fromEntries(
  CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256Schema]),
) as Record<FoundationDocumentPath, typeof sha256Schema>
const documentDigestsSchema = z.object(documentDigestShape).strict()

const foundationReadyReceiptSchema = z
  .object({
    schemaVersion: z.literal('foundation-ready-receipt.v2'),
    ownerId: nonEmptyTextSchema,
    projectId: nonEmptyTextSchema,
    foundationResultId: sha256Schema,
    foundationResultDigest: sha256Schema,
    foundationRevision: foundationRevisionSchema,
    documentSetDigest: sha256Schema,
    confirmedBriefDigest: sha256Schema,
    confirmedRequirementsDigest: sha256Schema,
    documentDigests: documentDigestsSchema,
    sourceIndexDigest: sha256Schema,
    sectionIndexDigest: sha256Schema,
    receiptDigest: sha256Schema,
  })
  .strict()

const gameIrCompileRequestSchema = z
  .object({
    schemaVersion: z.literal('game-ir-compile-request.v1'),
    taskId: safeIdSchema,
    publicationId: safeIdSchema,
    gameIrSchemaVersion: z.literal(GAME_IR_SCHEMA_VERSION),
    foundation: foundationReadyReceiptSchema,
  })
  .strict()

const sourceSchema = z
  .object({
    documentPath: foundationDocumentPathSchema,
    sectionId: nonEmptyTextSchema,
    digest: sha256Schema,
  })
  .strict()

const targetSchema = z
  .object({
    documentPath: foundationDocumentPathSchema,
    sectionId: nonEmptyTextSchema,
  })
  .strict()

const sourceBindingPointersSchema = z
  .array(nonEmptyTextSchema)
  .nonempty()
  .superRefine((pointers, context) => {
    for (let index = 1; index < pointers.length; index += 1) {
      if (pointers[index - 1]! >= pointers[index]!) {
        context.addIssue({
          code: 'custom',
          message: 'sourceBindingPointers must be unique and sorted',
        })
        return
      }
    }
  })

const foundationDefectReportSchema = z
  .object({
    schemaVersion: z.literal('foundation-defect-report.v1'),
    taskId: safeIdSchema,
    foundationRevision: foundationRevisionSchema,
    reasonCode: nonEmptyTextSchema,
    expected: nonEmptyTextSchema,
    actual: nonEmptyTextSchema,
    source: sourceSchema,
    target: targetSchema,
    sourceBindingPointers: sourceBindingPointersSchema,
  })
  .strict()

const digestRecordSchema = z.record(z.string().min(1), sha256Schema)

export const gameIrReadyReceiptSchema = z
  .object({
    schemaVersion: z.literal('game-ir-ready-receipt.v1'),
    taskId: safeIdSchema,
    publicationId: safeIdSchema,
    gameIrSchemaVersion: z.literal(GAME_IR_SCHEMA_VERSION),
    foundationRevision: foundationRevisionSchema,
    foundationReceiptDigest: sha256Schema,
    manifestDigest: sha256Schema,
    moduleDigests: digestRecordSchema,
    sourceMapDigests: digestRecordSchema,
    dependencyGraphDigest: sha256Schema,
    committedPath: safeRelativeArtifactPathSchema,
  })
  .strict()

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function receiptDigest(
  value: Omit<FoundationReadyReceipt, 'receiptDigest'>,
): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export { receiptDigest }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export function parseFoundationReadyReceipt(
  value: unknown,
): FoundationReadyReceipt {
  const parsed = foundationReadyReceiptSchema.parse(
    value,
  ) as FoundationReadyReceipt
  const { receiptDigest: suppliedDigest, ...withoutReceiptDigest } = parsed
  if (receiptDigest(withoutReceiptDigest) !== suppliedDigest)
    throw new Error('Foundation ready receipt digest mismatch')
  return deepFreeze(parsed)
}

export function parseGameIrCompileRequest(
  value: unknown,
): GameIrCompileRequest {
  const parsed = gameIrCompileRequestSchema.parse(value)
  const foundation = parseFoundationReadyReceipt(parsed.foundation)
  return deepFreeze({ ...parsed, foundation }) as GameIrCompileRequest
}

export function parseFoundationDefectReport(
  value: unknown,
): FoundationDefectReport {
  return deepFreeze(
    foundationDefectReportSchema.parse(value),
  ) as FoundationDefectReport
}

export function parseGameIrReadyReceipt(value: unknown): GameIrReadyReceipt {
  const parsed = gameIrReadyReceiptSchema.parse(value) as GameIrReadyReceipt
  const expectedKeys = [...GAME_IR_CANONICAL_MODULE_IDS].sort()
  const moduleKeys = Object.keys(parsed.moduleDigests).sort()
  const sourceMapKeys = Object.keys(parsed.sourceMapDigests).sort()
  if (
    moduleKeys.length !== expectedKeys.length ||
    moduleKeys.some((key, index) => key !== expectedKeys[index])
  )
    throw new Error(
      'Game IR ready receipt has missing or unknown canonical modules',
    )
  if (
    sourceMapKeys.length !== expectedKeys.length ||
    sourceMapKeys.some((key, index) => key !== expectedKeys[index])
  )
    throw new Error(
      'Game IR ready receipt has missing or unknown canonical source maps',
    )
  if (moduleKeys.some((moduleId, index) => moduleId !== sourceMapKeys[index]))
    throw new Error(
      'Game IR ready receipt module and source-map digest keys must match',
    )
  if (parsed.committedPath !== gameIrCommittedPath(parsed.foundationRevision))
    throw new Error('Game IR ready receipt committed path is not canonical')
  return deepFreeze(parsed)
}
