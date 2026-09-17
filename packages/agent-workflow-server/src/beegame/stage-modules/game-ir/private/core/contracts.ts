import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../../../../foundation-documents'

export const GAME_IR_SCHEMA_VERSION = 'game-ir.v2' as const
export const GAME_IR_PUBLICATION_ROOT =
  `.beegame/ir/${GAME_IR_SCHEMA_VERSION}` as const

export type FoundationReadyReceipt = Readonly<{
  schemaVersion: 'foundation-ready-receipt.v2'
  ownerId: string
  projectId: string
  foundationResultId: string
  foundationResultDigest: string
  foundationRevision: string
  documentSetDigest: string
  confirmedBriefDigest: string
  confirmedRequirementsDigest: string
  documentDigests: Readonly<Record<FoundationDocumentPath, string>>
  sourceIndexDigest: string
  sectionIndexDigest: string
  receiptDigest: string
}>

export type GameIrCompileRequest = Readonly<{
  schemaVersion: 'game-ir-compile-request.v2'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v2'
  foundation: FoundationReadyReceipt
}>

export type GameIrReadyReceipt = Readonly<{
  schemaVersion: 'game-ir-ready-receipt.v2'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v2'
  foundationRevision: string
  foundationReceiptDigest: string
  candidateDigest: string
  manifestDigest: string
  committedPath: string
}>

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const textSchema = z.string().refine(value => value.trim().length > 0)
const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
const documentDigestShape = Object.fromEntries(
  CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256Schema]),
) as Record<FoundationDocumentPath, typeof sha256Schema>

const foundationReadyReceiptSchema = z.object({
  schemaVersion: z.literal('foundation-ready-receipt.v2'),
  ownerId: textSchema,
  projectId: textSchema,
  foundationResultId: sha256Schema,
  foundationResultDigest: sha256Schema,
  foundationRevision: safeIdSchema,
  documentSetDigest: sha256Schema,
  confirmedBriefDigest: sha256Schema,
  confirmedRequirementsDigest: sha256Schema,
  documentDigests: z.object(documentDigestShape).strict(),
  sourceIndexDigest: sha256Schema,
  sectionIndexDigest: sha256Schema,
  receiptDigest: sha256Schema,
}).strict()

const gameIrCompileRequestSchema = z.object({
  schemaVersion: z.literal('game-ir-compile-request.v2'),
  taskId: safeIdSchema,
  publicationId: safeIdSchema,
  gameIrSchemaVersion: z.literal(GAME_IR_SCHEMA_VERSION),
  foundation: foundationReadyReceiptSchema,
}).strict()

const safeRelativePathSchema = z.string().refine(value =>
  value.length > 0 && !value.startsWith('/') && !value.startsWith('\\') &&
  !value.includes('\\') && !value.includes('\0') &&
  value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..'),
)

export const gameIrReadyReceiptSchema = z.object({
  schemaVersion: z.literal('game-ir-ready-receipt.v2'),
  taskId: safeIdSchema,
  publicationId: safeIdSchema,
  gameIrSchemaVersion: z.literal(GAME_IR_SCHEMA_VERSION),
  foundationRevision: safeIdSchema,
  foundationReceiptDigest: sha256Schema,
  candidateDigest: sha256Schema,
  manifestDigest: sha256Schema,
  committedPath: safeRelativePathSchema,
}).strict()

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function receiptDigest(
  value: Omit<FoundationReadyReceipt, 'receiptDigest'>,
): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export function gameIrRevisionPath(foundationRevision: string, publicationId?: string): string {
  if (!safeIdSchema.safeParse(foundationRevision).success)
    throw new Error('Game IR foundation revision is not a canonical path segment')
  if (publicationId !== undefined && !safeIdSchema.safeParse(publicationId).success)
    throw new Error('Game IR publication ID is not a canonical path segment')
  return `${GAME_IR_PUBLICATION_ROOT}/revisions/${foundationRevision}${publicationId ? `/publications/${publicationId}` : ''}`
}

export function gameIrCommittedPath(foundationRevision: string, publicationId?: string): string {
  return `${gameIrRevisionPath(foundationRevision, publicationId)}/COMMITTED.json`
}

export function parseFoundationReadyReceipt(value: unknown): FoundationReadyReceipt {
  const parsed = foundationReadyReceiptSchema.parse(value) as FoundationReadyReceipt
  const { receiptDigest: supplied, ...body } = parsed
  if (receiptDigest(body) !== supplied)
    throw new Error('Foundation ready receipt digest mismatch')
  return freeze(parsed)
}

export function parseGameIrCompileRequest(value: unknown): GameIrCompileRequest {
  const parsed = gameIrCompileRequestSchema.parse(value)
  return freeze({ ...parsed, foundation: parseFoundationReadyReceipt(parsed.foundation) }) as GameIrCompileRequest
}

export function parseGameIrReadyReceipt(value: unknown): GameIrReadyReceipt {
  const parsed = gameIrReadyReceiptSchema.parse(value) as GameIrReadyReceipt
  if (parsed.committedPath !== gameIrCommittedPath(parsed.foundationRevision) &&
      parsed.committedPath !== gameIrCommittedPath(parsed.foundationRevision, parsed.publicationId))
    throw new Error('Game IR committed path does not match foundation revision')
  return freeze(parsed)
}
