import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { authorDigest, authorHandleSchema, authorStartSchema, parseAuthorStart, type AuthorHandle, type AuthorStartInput, type AuthorDocumentsResult } from './contract'
import { readAuthoredDocumentReceipt, type AuthoredDocumentReceipt } from './domain/authored-document-receipt'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DispatchRecord, type FoundationAuthoringContext, type FoundationDocumentPath, type FoundationDraftState } from './domain/types'
import { foundationAuthoringSources } from './domain/foundation-authoring-contract'
import type { AuthorAcceptanceJournal } from './acceptance-journal'

export type Registration = {
  handle: AuthorHandle
  start: AuthorStartInput
  createdAt: string
  workspacePath: string
}

export type AuthorCheckpoint = {
  registration: Registration
  context: FoundationAuthoringContext
  appliedSequence: number
  acceptedDispatches: Record<string, string>
  sessions: Record<string, string>
  usage: Record<string, unknown>
  result?: AuthorDocumentsResult
}

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const businessIdentity = z.string().min(1).max(256)
const opaqueIdentity = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/)
const pathValue = z.string().min(1).max(512)
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValue), z.record(z.string(), jsonValue),
]))
const jsonRecord = z.record(z.string(), jsonValue)

const authoringContractSchema = z.strictObject({
  confirmedBriefDigest: digest,
  confirmedBriefContext: z.string().min(1).optional(),
  documentSet: z.literal('foundation'),
  authoringMode: z.enum(['initial', 'parallel-draft']),
  foundationDocumentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  availableUpstreamPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)).optional(),
  completeDocumentContract: jsonValue.optional(),
  systemDeliveryContract: jsonValue.optional(),
  authoringDeliveryContract: jsonValue.optional(),
  previousDocumentMetadata: z.record(z.string(), jsonValue).optional(),
  changeRequest: jsonValue.optional(),
  priorFailureReason: z.string().optional(),
})

const workerRequestSchema = z.strictObject({
  runId: opaqueIdentity,
  dispatchId: opaqueIdentity.optional(),
  ownerId: businessIdentity,
  projectId: businessIdentity,
  workspacePath: z.string().min(1),
  workerType: z.literal('document-author'),
  phase: z.literal('DOCUMENT_DRAFTING'),
  taskId: pathValue.optional(),
  revision: z.string().min(1).max(256),
  allowedPaths: z.array(pathValue).optional(),
  contract: authoringContractSchema,
})

const dispatchSchema = z.strictObject({
  dispatchId: opaqueIdentity,
  workerType: z.literal('document-author'),
  phase: z.literal('DOCUMENT_DRAFTING'),
  taskId: pathValue.optional(),
  revision: z.string().min(1).max(256),
  status: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted', 'invalid']),
  request: workerRequestSchema.optional(),
  terminalResult: jsonRecord.optional(),
  failureReason: z.string().optional(),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).optional(),
})

const documentCheckpointSchema = z.strictObject({
  path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  status: z.enum(['pending', 'drafting', 'committed', 'needs_action']),
  upstreamDigests: z.record(z.string(), digest).optional(),
  dispatch: dispatchSchema.optional(),
  failureReason: z.string().optional(),
})

const draftStateSchema = z.strictObject({
  completedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
  documents: z.array(documentCheckpointSchema).length(CANONICAL_FOUNDATION_DOCUMENTS.length).optional(),
})

const contextSchema = z.strictObject({
  runId: opaqueIdentity,
  ownerId: businessIdentity,
  projectId: businessIdentity,
  confirmedBriefDigest: digest,
  confirmedBriefContext: z.string().min(1),
  phase: z.enum(['DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW']),
  documentStep: z.enum(['FOUNDATION_DRAFTING', 'FOUNDATION_REVIEW']),
  status: z.enum(['running', 'needs_action', 'completed', 'failed', 'stopped']),
  foundationDraftState: draftStateSchema,
  activeDispatch: dispatchSchema.optional(),
  changeRequest: jsonValue.optional(),
  currentItemId: pathValue.optional(),
  blockedReason: z.string().optional(),
  updatedAt: z.string().datetime({ offset: true }),
  revision: z.strictObject({ document: z.string().min(1).max(256), workspace: z.string().min(1).max(256) }),
})

const usageSchema = z.strictObject({
  prompt_tokens: z.number().finite().nonnegative(),
  completion_tokens: z.number().finite().nonnegative(),
  cache_read_tokens: z.number().finite().nonnegative(),
  cache_creation_tokens: z.number().finite().nonnegative(),
  total_tokens: z.number().finite().nonnegative(),
})

const artifactSchema = z.strictObject({
  path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  digest,
  byteLength: z.number().int().positive(),
  artifactPath: z.string().min(1).max(1024),
})
const resultSchema = z.strictObject({
  protocolVersion: z.literal(1),
  producer: z.literal('foundation-authoring'),
  kind: z.literal('foundation_documents'),
  resultId: digest,
  inputDigest: digest,
  ownerId: businessIdentity,
  projectId: businessIdentity,
  confirmedBriefDigest: digest,
  documents: z.array(artifactSchema).length(CANONICAL_FOUNDATION_DOCUMENTS.length),
  documentRevision: digest,
  workspaceRevision: digest,
  receiptSetDigest: digest,
})

const registrationSchema = z.strictObject({
  handle: authorHandleSchema,
  start: authorStartSchema,
  createdAt: z.string().datetime({ offset: true }),
  workspacePath: z.string().min(1),
})
const acceptedDispatchesSchema = z.record(z.string(), opaqueIdentity).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (!canonicalPath(key)) ctx.addIssue({ code: 'custom', message: 'accepted dispatch key is not canonical' })
  }
})
const checkpointSchema = z.strictObject({
  registration: registrationSchema,
  context: contextSchema,
  appliedSequence: z.number().int().nonnegative(),
  acceptedDispatches: acceptedDispatchesSchema,
  sessions: z.record(opaqueIdentity, z.string().uuid()),
  usage: z.record(opaqueIdentity, usageSchema),
  result: resultSchema.optional(),
})

function canonicalPath(value: string): value is FoundationDocumentPath {
  return (CANONICAL_FOUNDATION_DOCUMENTS as readonly string[]).includes(value)
}

function assertPrefix(paths: readonly FoundationDocumentPath[]): void {
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== CANONICAL_FOUNDATION_DOCUMENTS[index]))
    throw new Error('author checkpoint completed document paths are not a canonical prefix')
}

function assertJsonContract(value: unknown): void {
  jsonValue.parse(value)
}

function assertDispatchBinding(record: DispatchRecord, context: FoundationAuthoringContext, registration: Registration): void {
  if (!record.request) throw new Error('author checkpoint dispatch request is missing')
  {
    const request = record.request
    if (request.dispatchId !== record.dispatchId) throw new Error('author checkpoint dispatch identity mismatch')
    if (request.runId !== context.runId || request.ownerId !== context.ownerId || request.projectId !== context.projectId) throw new Error('author checkpoint request identity mismatch')
    if (request.workspacePath !== registration.workspacePath || request.taskId !== record.taskId || request.revision !== record.revision) throw new Error('author checkpoint request binding mismatch')
    if (!record.taskId || request.contract.foundationDocumentPath !== record.taskId || request.allowedPaths?.length !== 1 || request.allowedPaths[0] !== record.taskId)
      throw new Error('author checkpoint dispatch contract does not authorize its document')
    if (request.contract.confirmedBriefDigest !== context.confirmedBriefDigest || request.contract.confirmedBriefContext !== context.confirmedBriefContext)
      throw new Error('author checkpoint dispatch brief binding mismatch')
    const expectedUpstreamPaths = foundationAuthoringSources(request.contract.foundationDocumentPath).map(source => source.path)
    if (!request.contract.availableUpstreamPaths || request.contract.availableUpstreamPaths.length !== expectedUpstreamPaths.length ||
        request.contract.availableUpstreamPaths.some((path, index) => path !== expectedUpstreamPaths[index]))
      throw new Error('author checkpoint dispatch upstream source set mismatch')
    if (request.contract.authoringMode === 'initial' && record.taskId !== CANONICAL_FOUNDATION_DOCUMENTS[0]) throw new Error('author checkpoint initial dispatch path is invalid')
    if (request.contract.authoringMode === 'parallel-draft' && record.taskId === CANONICAL_FOUNDATION_DOCUMENTS[0]) throw new Error('author checkpoint parallel dispatch path is invalid')
    if (request.contract.authoringMode === 'initial' && record.status === 'running' && record.revision !== context.revision.document)
      throw new Error('author checkpoint initial dispatch revision mismatch')
  }
}

function assertDocumentState(state: FoundationDraftState, context: FoundationAuthoringContext, registration: Registration, accepted: Record<string, string>): void {
  assertPrefix(state.completedPaths)
  const docs = state.documents
  if (!docs) {
    if (state.completedPaths.length !== 0 && state.completedPaths.length !== 1) throw new Error('author checkpoint serial state has an invalid prefix')
    if (context.phase !== 'DOCUMENT_DRAFTING') throw new Error('author checkpoint without documents is not drafting')
    if (context.activeDispatch && context.activeDispatch.taskId !== CANONICAL_FOUNDATION_DOCUMENTS[0]) throw new Error('author checkpoint serial dispatch path is invalid')
    for (const path of Object.keys(accepted)) throw new Error(`author checkpoint accepted proof is not valid for ${path}`)
    return
  }
  if (docs.some((doc, index) => doc.path !== CANONICAL_FOUNDATION_DOCUMENTS[index])) throw new Error('author checkpoint document order is invalid')
  const committedPrefix = state.completedPaths.length
  const firstUncommitted = docs.findIndex(doc => doc.status !== 'committed')
  if (committedPrefix !== (firstUncommitted < 0 ? docs.length : firstUncommitted))
    throw new Error('author checkpoint committed prefix does not match document states')
  for (const doc of docs) {
    // Parallel authors may commit beyond a gap in the canonical prefix.
    const isCommitted = doc.status === 'committed'
    if (doc.dispatch) {
      assertDispatchBinding(doc.dispatch, context, registration)
      if (doc.status === 'drafting' && doc.dispatch.status !== 'running') throw new Error('author checkpoint drafting document lacks running dispatch')
      if (doc.status !== 'drafting' && !(doc.status === 'needs_action' && doc.dispatch.status === 'interrupted')) throw new Error('author checkpoint non-drafting document has a dispatch')
    }
    if (isCommitted) {
      if (doc.failureReason) throw new Error('author checkpoint committed document has a failure')
      if (!accepted[doc.path]) throw new Error(`author checkpoint committed document lacks accepted proof: ${doc.path}`)
    } else if (accepted[doc.path]) {
      throw new Error(`author checkpoint has proof for uncommitted document: ${doc.path}`)
    }
  }
  if (context.activeDispatch) throw new Error('author checkpoint parallel state has an active serial dispatch')
  if (context.phase === 'DOCUMENT_REVIEW' && committedPrefix !== CANONICAL_FOUNDATION_DOCUMENTS.length) throw new Error('author checkpoint review phase lacks all documents')
}

async function assertRealWorkspaceFile(workspace: string, path: string): Promise<Buffer> {
  const candidate = resolve(workspace, path)
  const rel = relative(workspace, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('author checkpoint artifact escapes workspace')
  const info = await lstat(candidate)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('author checkpoint artifact must be a regular file')
  const actual = await realpath(candidate)
  if (actual !== candidate) throw new Error('author checkpoint artifact contains a symlink')
  return readFile(candidate)
}

async function receiptFor(workspace: string, dispatchId: string): Promise<AuthoredDocumentReceipt> {
  if (!(await assertRealReceiptPath(workspace, dispatchId))) throw new Error(`author checkpoint receipt is missing: ${dispatchId}`)
  const receipt = await readAuthoredDocumentReceipt(workspace, dispatchId)
  if (!receipt || receipt.status !== 'committed') throw new Error(`author checkpoint receipt is not committed: ${dispatchId}`)
  return receipt
}

async function assertRealReceiptPath(workspace: string, dispatchId: string): Promise<boolean> {
  const path = resolve(workspace, '.beegame/workflow/foundation-authoring/receipts', `${dispatchId}.json`)
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('author checkpoint receipt must be a regular file')
    if (await realpath(path) !== path) throw new Error('author checkpoint receipt contains a symlink')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function assertUnfinishedProofs(checkpoint: AuthorCheckpoint, acceptanceJournal?: AuthorAcceptanceJournal): Promise<void> {
  const docs = checkpoint.context.foundationDraftState.documents ?? []
  for (const doc of docs.filter(value => value.status === 'committed')) {
    const dispatchId = checkpoint.acceptedDispatches[doc.path]
    if (!(await assertRealReceiptPath(checkpoint.registration.workspacePath, dispatchId))) throw new Error(`author checkpoint receipt/body proof is invalid: ${doc.path}`)
    const receipt = await readAuthoredDocumentReceipt(checkpoint.registration.workspacePath, dispatchId)
    if (!receipt || receipt.status !== 'committed' || receipt.targetPath !== doc.path) throw new Error(`author checkpoint receipt/body proof is invalid: ${doc.path}`)
    if (!acceptanceJournal) throw new Error(`author checkpoint acceptance proof is missing: ${doc.path}`)
    await acceptanceJournal.validate(doc.path, dispatchId, receipt)
    const body = await assertRealWorkspaceFile(checkpoint.registration.workspacePath, doc.path)
    if (body.byteLength !== receipt.byteLength || createHash('sha256').update(body).digest('hex') !== receipt.finalDigest)
      throw new Error(`author checkpoint receipt/body proof is invalid: ${doc.path}`)
  }
}

async function assertCompletedResult(checkpoint: AuthorCheckpoint, acceptanceJournal?: AuthorAcceptanceJournal): Promise<void> {
  const result = checkpoint.result
  if (!result) return
  if (result.resultId !== authorDigest({ producer: 'foundation-authoring', inputDigest: result.inputDigest, receiptSetDigest: result.receiptSetDigest })) throw new Error('author checkpoint result ID is invalid')
  if (result.inputDigest !== checkpoint.registration.start.inputDigest || result.ownerId !== checkpoint.registration.start.ownerId || result.projectId !== checkpoint.registration.start.projectId || result.confirmedBriefDigest !== checkpoint.registration.start.input.confirmedBriefDigest)
    throw new Error('author checkpoint result identity mismatch')
  const receipts: AuthoredDocumentReceipt[] = []
  for (const [index, doc] of result.documents.entries()) {
    const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[index]
    if (doc.path !== expectedPath || doc.artifactPath !== `.beegame/workflow/foundation-authoring/artifacts/${result.resultId}/${expectedPath}`) throw new Error('author checkpoint result document binding is invalid')
    const dispatchId = checkpoint.acceptedDispatches[doc.path]
    if (!dispatchId) throw new Error(`author checkpoint result lacks accepted dispatch: ${doc.path}`)
    const receipt = await receiptFor(checkpoint.registration.workspacePath, dispatchId)
    if (receipt.targetPath !== doc.path || receipt.finalDigest !== doc.digest || receipt.byteLength !== doc.byteLength) throw new Error(`author checkpoint result receipt binding is invalid: ${doc.path}`)
    if (!acceptanceJournal) throw new Error(`author checkpoint acceptance proof is missing: ${doc.path}`)
    await acceptanceJournal.validate(doc.path, dispatchId, receipt)
    receipts.push(receipt)
    const bytes = await assertRealWorkspaceFile(checkpoint.registration.workspacePath, doc.artifactPath)
    if (bytes.byteLength !== doc.byteLength || createHash('sha256').update(bytes).digest('hex') !== doc.digest) throw new Error(`author checkpoint immutable artifact proof is invalid: ${doc.path}`)
  }
  if (authorDigest(receipts) !== result.receiptSetDigest) throw new Error('author checkpoint receipt set digest is invalid')
}

export async function parseAuthorCheckpoint(value: unknown, input: { handle: AuthorHandle; workspacePath: string; acceptanceJournal?: AuthorAcceptanceJournal }): Promise<AuthorCheckpoint> {
  const parsed = checkpointSchema.parse(value) as AuthorCheckpoint
  const handle = authorHandleSchema.parse(input.handle)
  const workspace = await realpath(input.workspacePath)
  if (parsed.registration.handle.protocolVersion !== handle.protocolVersion || parsed.registration.handle.producer !== handle.producer || parsed.registration.handle.id !== handle.id)
    throw new Error('author checkpoint handle identity mismatch')
  parseAuthorStart(parsed.registration.start)
  if (parsed.registration.workspacePath !== workspace) throw new Error('author checkpoint workspace mismatch')
  const { context, registration } = parsed
  if (context.runId !== handle.id || context.ownerId !== registration.start.ownerId || context.projectId !== registration.start.projectId || context.confirmedBriefDigest !== registration.start.input.confirmedBriefDigest || context.confirmedBriefContext !== registration.start.input.confirmedBrief)
    throw new Error('author checkpoint context identity mismatch')
  if (context.changeRequest !== undefined) assertJsonContract(context.changeRequest)
  if (context.activeDispatch) assertDispatchBinding(context.activeDispatch, context, registration)
  assertDocumentState(context.foundationDraftState, context, registration, parsed.acceptedDispatches)
  for (const [key, dispatchId] of Object.entries(parsed.acceptedDispatches)) {
    if (!canonicalPath(key) || !opaqueIdentity.safeParse(dispatchId).success) throw new Error('author checkpoint accepted dispatch map is invalid')
  }
  if (parsed.result) {
    if (context.status !== 'completed' || context.phase !== 'DOCUMENT_REVIEW' || context.documentStep !== 'FOUNDATION_REVIEW') throw new Error('author checkpoint completed result has an invalid context')
    if (parsed.context.foundationDraftState.completedPaths.length !== CANONICAL_FOUNDATION_DOCUMENTS.length) throw new Error('author checkpoint completed result lacks all documents')
    await assertCompletedResult(parsed, input.acceptanceJournal)
  } else {
    if (context.status === 'completed') throw new Error('author checkpoint completed context lacks result')
    await assertUnfinishedProofs(parsed, input.acceptanceJournal)
  }
  return structuredClone(parsed)
}
