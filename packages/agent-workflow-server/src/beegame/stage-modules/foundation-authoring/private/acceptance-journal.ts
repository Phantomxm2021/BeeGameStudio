import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { authorDigest } from './contract'
import type { AuthorPersistence } from './persistence'
import type { AuthoredDocumentReceipt } from './domain/authored-document-receipt'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DispatchRecord,
  type FoundationDocumentPath,
} from './domain/types'
import { foundationAuthoringRecordedSourcesMatch } from './domain/foundation-authoring-contract'

export type AuthorAcceptanceJournalBinding = {
  runId: string
  ownerId: string
  projectId: string
  inputDigest: string
  confirmedBriefDigest: string
  workspacePath: string
}

export type AuthorAcceptanceJournal = Readonly<{
  accept(record: DispatchRecord, receipt: AuthoredDocumentReceipt): Promise<void>
  validate(path: FoundationDocumentPath, dispatchId: string, receipt: AuthoredDocumentReceipt): Promise<void>
}>

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identity = z.string().min(1).max(256)
const pathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const receiptSchema = z.strictObject({
  schemaVersion: z.literal(5), dispatchId: identity, targetPath: pathSchema,
  finalDigest: digest, byteLength: z.number().int().positive(),
  documentId: identity, version: z.literal('1.0.0'),
  updatedAt: z.string().datetime({ offset: true }), status: z.literal('committed'),
})
const requestSchema = z.strictObject({
  runId: identity, dispatchId: identity, ownerId: identity, projectId: identity,
  workspacePath: z.string().min(1), workerType: z.literal('document-author'),
  phase: z.literal('DOCUMENT_DRAFTING'), taskId: pathSchema, revision: identity,
  allowedPaths: z.tuple([pathSchema]),
  contract: z.strictObject({
    confirmedBriefDigest: digest, confirmedBriefContext: z.string().min(1),
    documentSet: z.literal('foundation'), authoringMode: z.enum(['initial', 'parallel-draft']),
    foundationDocumentPath: pathSchema,
    availableUpstreamPaths: z.array(pathSchema),
  }).passthrough(),
})
const journalEntrySchema = z.strictObject({
  runId: identity, ownerId: identity, projectId: identity,
  inputDigest: digest, confirmedBriefDigest: digest, workspacePath: z.string().min(1),
  path: pathSchema, dispatchId: identity, request: requestSchema, receiptDigest: digest,
})

type JournalEntry = z.infer<typeof journalEntrySchema>
type AcceptedRequest = z.infer<typeof requestSchema>

/**
 * Durable, immutable proof that one committed authored document was accepted
 * for this exact author run. The journal is intentionally separate from the
 * checkpoint map: a path-to-dispatch projection alone is not authority.
 */
export function createAuthorAcceptanceJournal(
  store: AuthorPersistence,
  binding: AuthorAcceptanceJournalBinding,
): AuthorAcceptanceJournal {
  assertBinding(binding)
  const identityBinding = structuredClone(binding)

  async function accept(record: DispatchRecord, receipt: AuthoredDocumentReceipt): Promise<void> {
    const entry = buildEntry(record, receipt, identityBinding)
    const key = journalKey(identityBinding.runId, entry.path)
    if (await store.create(key, entry)) return
    const existing = journalEntrySchema.parse(await store.load<unknown>(key))
    if (authorDigest(existing) !== authorDigest(entry)) {
      throw new Error('author acceptance evidence conflicts with an existing dispatch')
    }
  }

  async function validate(
    path: FoundationDocumentPath,
    dispatchId: string,
    receipt: AuthoredDocumentReceipt,
  ): Promise<void> {
    pathSchema.parse(path)
    identity.parse(dispatchId)
    const checkedReceipt = receiptSchema.parse(receipt) as AuthoredDocumentReceipt
    if (checkedReceipt.dispatchId !== dispatchId || checkedReceipt.targetPath !== path) {
      throw new Error('author acceptance receipt does not match dispatch')
    }
    const key = journalKey(identityBinding.runId, path)
    const raw = await store.load<unknown>(key)
    if (raw === undefined) throw new Error(`author acceptance evidence is missing: ${path}`)
    const entry = journalEntrySchema.parse(raw)
    assertEntryBinding(entry, identityBinding)
    if (entry.path !== path || entry.dispatchId !== dispatchId || entry.receiptDigest !== authorDigest(checkedReceipt)) {
      throw new Error(`author acceptance evidence does not match receipt: ${path}`)
    }
    assertRequest(entry.request, entry, identityBinding)
  }

  return Object.freeze({ accept, validate })
}

function buildEntry(
  record: DispatchRecord,
  receipt: AuthoredDocumentReceipt,
  binding: AuthorAcceptanceJournalBinding,
): JournalEntry {
  const request = validateAcceptedRecord(record, receipt, binding)
  const path = request.taskId
  return {
    ...binding,
    path,
    dispatchId: record.dispatchId,
    request: structuredClone(request),
    receiptDigest: authorDigest(receiptSchema.parse(receipt)),
  }
}

function validateAcceptedRecord(
  record: DispatchRecord,
  receipt: AuthoredDocumentReceipt,
  binding: AuthorAcceptanceJournalBinding,
): AcceptedRequest {
  if (!record || typeof record !== 'object') throw new Error('author acceptance dispatch is invalid')
  if (record.request === undefined) throw new Error('author acceptance dispatch request is missing')
  if (record.request.dispatchId !== record.dispatchId) throw new Error('author acceptance dispatch identity mismatch')
  const request = requestSchema.parse(record.request) as AcceptedRequest
  if (record.workerType !== request.workerType || record.phase !== request.phase ||
      record.taskId !== request.taskId || record.revision !== request.revision ||
      (record.status !== 'running' && record.status !== 'completed')) {
    throw new Error('author acceptance dispatch record binding mismatch')
  }
  const parsedReceipt = receiptSchema.parse(receipt) as AuthoredDocumentReceipt
  const entry = {
    ...binding,
    path: request.taskId,
    dispatchId: record.dispatchId,
    request,
    receiptDigest: authorDigest(parsedReceipt),
  }
  assertEntryBinding(entry, binding)
  if (parsedReceipt.dispatchId !== record.dispatchId || parsedReceipt.targetPath !== request.taskId) {
    throw new Error('author acceptance receipt does not match dispatch')
  }
  assertRequest(request, entry, binding)
  return request
}

function assertEntryBinding(
  entry: Pick<JournalEntry, 'runId' | 'ownerId' | 'projectId' | 'inputDigest' | 'confirmedBriefDigest' | 'workspacePath'>,
  binding: AuthorAcceptanceJournalBinding,
): void {
  if (entry.runId !== binding.runId || entry.ownerId !== binding.ownerId || entry.projectId !== binding.projectId ||
      entry.inputDigest !== binding.inputDigest || entry.confirmedBriefDigest !== binding.confirmedBriefDigest ||
      resolve(entry.workspacePath) !== resolve(binding.workspacePath)) {
    throw new Error('author acceptance evidence identity mismatch')
  }
}

function assertRequest(
  request: AcceptedRequest,
  entry: Pick<JournalEntry, 'path' | 'dispatchId'>,
  binding: AuthorAcceptanceJournalBinding,
): void {
  if (request.dispatchId !== entry.dispatchId || request.runId !== binding.runId || request.ownerId !== binding.ownerId ||
      request.projectId !== binding.projectId || resolve(request.workspacePath) !== resolve(binding.workspacePath) ||
      request.taskId !== entry.path || request.contract.foundationDocumentPath !== entry.path ||
      request.allowedPaths?.length !== 1 || request.allowedPaths[0] !== entry.path ||
      request.contract.confirmedBriefDigest !== binding.confirmedBriefDigest ||
      createHash('sha256').update(request.contract.confirmedBriefContext).digest('hex') !== binding.confirmedBriefDigest) {
    throw new Error('author acceptance dispatch request binding mismatch')
  }
  if (!foundationAuthoringRecordedSourcesMatch(entry.path, request.contract.availableUpstreamPaths, request.contract.authorBodyVersion)) {
    throw new Error('author acceptance dispatch upstream source set mismatch')
  }
  if (request.contract.authoringMode === 'initial' && entry.path !== CANONICAL_FOUNDATION_DOCUMENTS[0]) {
    throw new Error('author acceptance initial dispatch path is invalid')
  }
  if (request.contract.authoringMode === 'parallel-draft' && entry.path === CANONICAL_FOUNDATION_DOCUMENTS[0]) {
    throw new Error('author acceptance parallel dispatch path is invalid')
  }
  if ('priorFailureReason' in request.contract) {
    throw new Error('author acceptance dispatch contract contains deprecated failure state')
  }
}

function journalKey(runId: string, path: FoundationDocumentPath): string {
  return authorDigest(['author-accepted', runId, path])
}

function assertBinding(binding: AuthorAcceptanceJournalBinding): void {
  identity.parse(binding.runId)
  identity.parse(binding.ownerId)
  identity.parse(binding.projectId)
  digest.parse(binding.inputDigest)
  digest.parse(binding.confirmedBriefDigest)
  if (typeof binding.workspacePath !== 'string' || binding.workspacePath.length === 0) {
    throw new Error('author acceptance workspace path is invalid')
  }
}
