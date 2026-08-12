import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  canonicalizeCompleteGameDocumentMarkdown,
} from './complete-game-document'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createFoundationAuthoritySidecar,
  validateFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

const commitInputSchema = z
  .object({
    body: z.string().trim().min(1),
  })
  .strict()

const authoritySubmissionSchema = z
  .object({ records: z.array(z.unknown()).min(1) })
  .strict()

const completeDocumentCommitInputSchema = z.union([
  z
    .object({
      body: z.string().trim().min(1),
      authority: authoritySubmissionSchema,
    })
    .strict(),
  z.object({ authority: authoritySubmissionSchema }).strict(),
])

const legacyReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    baselineDigest: z.string().length(64).nullable(),
    finalDigest: z.string().length(64),
    documentId: z.string().min(1),
    version: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['prepared', 'committed']),
  })
  .strict()

const completeDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(2),
    dispatchId: z.string().min(1),
    targetPath: z.string().min(1),
    baselineDigest: z.string().length(64).nullable(),
    finalDigest: z.string().length(64),
    authorityPath: z.string().min(1),
    authorityDigest: z.string().length(64).nullable(),
    documentId: z.string().min(1),
    version: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['document_prepared', 'committed']),
  })
  .strict()

const receiptSchema = z.union([
  legacyReceiptSchema,
  completeDocumentReceiptSchema,
])

export type CanonicalDocumentCommitContract = {
  dispatchId: string
  targetPath: string
  documentId: string
  operation: 'create' | 'revise'
  baselineDigest: string | null
  baselineVersion?: string
  baselineUpdatedAt?: string
  submissionKind?: 'complete_game_document'
}

export type LegacyCanonicalDocumentCommitReceipt = {
  schemaVersion: 1
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  documentId: string
  version: string
  updatedAt: string
  status: 'prepared' | 'committed'
}

export type CompleteGameDocumentCommitReceipt = {
  schemaVersion: 2
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  authorityPath: string
  authorityDigest: string | null
  documentId: string
  version: string
  updatedAt: string
  status: 'document_prepared' | 'committed'
}

export type CanonicalDocumentCommitReceipt =
  | LegacyCanonicalDocumentCommitReceipt
  | CompleteGameDocumentCommitReceipt

type BuildTool = (definition: Record<string, unknown>) => unknown

const CANONICAL_DOCUMENT_PATHS = new Set<string>(
  Object.keys(CANONICAL_PROJECT_DOCUMENT_IDS),
)

export function createNativeCanonicalDocumentTool(options: {
  buildTool: BuildTool
  workspacePath: string
  contract: CanonicalDocumentCommitContract
}): unknown {
  const completeGameDocument =
    options.contract.submissionKind === 'complete_game_document'
  if (
    completeGameDocument &&
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(
      options.contract.targetPath as FoundationDocumentPath,
    )
  )
    throw new Error(
      'complete game document submission requires a Foundation target',
    )
  return options.buildTool({
    name: 'CommitCanonicalDocument',
    alwaysLoad: true,
    inputSchema: completeGameDocument
      ? completeDocumentCommitInputSchema
      : commitInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return completeGameDocument
        ? 'Validate and durably commit the complete game-development Markdown together with its compact authority records. The workflow service owns metadata, digest binding, persistence, and recovery.'
        : 'Atomically commit the complete Markdown body of the assigned canonical document. The workflow service owns front matter, version, timestamp, target path, and durable recovery.'
    },
    async prompt() {
      return completeGameDocument
        ? 'Call with {body, authority:{records}}. Body contains the complete Markdown document; records contain every downstream-relevant fact, decision, constraint, metric, dependency, risk, and open decision. If the service reports document_prepared with invalid authority, retry with {authority:{records}} only and do not resend or rewrite Markdown.'
        : 'Call exactly once with only the complete Markdown body, beginning with the document heading. Do not include YAML front matter, version, updated_at, path, finding IDs, or completion prose.'
    },
    async checkPermissions(input: unknown) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      const parsed = completeGameDocument
        ? completeDocumentCommitInputSchema.parse(input)
        : commitInputSchema.parse(input)
      return {
        data: await commitCanonicalDocument({
          workspacePath: options.workspacePath,
          contract: options.contract,
          ...('body' in parsed ? { body: parsed.body } : {}),
          ...('authority' in parsed ? { authority: parsed.authority } : {}),
        }),
      }
    },
    renderToolUseMessage() {
      return '提交权威文档'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

export async function commitCanonicalDocument(input: {
  workspacePath: string
  contract: CanonicalDocumentCommitContract
  body?: string
  authority?: unknown
}): Promise<CanonicalDocumentCommitReceipt> {
  const body = input.body?.trim()
  const completeGameDocument =
    input.contract.submissionKind === 'complete_game_document'
  if (!body && !completeGameDocument)
    throw new Error('canonical document body is required')
  if (body?.startsWith('---') && !completeGameDocument)
    throw new Error(
      'canonical document body must not include YAML front matter; metadata is service-owned',
    )
  if (!CANONICAL_DOCUMENT_PATHS.has(input.contract.targetPath))
    throw new Error('canonical document target is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      input.contract.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== input.contract.documentId
  )
    throw new Error('canonical document identity is invalid')
  const workspacePath = resolve(input.workspacePath)
  const targetPath = resolve(workspacePath, input.contract.targetPath)
  const projectRelative = relative(workspacePath, targetPath)
  if (
    !projectRelative ||
    projectRelative.startsWith('..') ||
    isAbsolute(projectRelative)
  )
    throw new Error('canonical document target is outside the workspace')
  const receiptPath = canonicalDocumentReceiptPath(
    input.workspacePath,
    input.contract.dispatchId,
  )
  const currentContent = await readOptionalFile(targetPath)
  const currentDigest = currentContent === undefined ? null : digest(currentContent)
  if (input.contract.operation === 'revise' && currentContent === undefined)
    throw new Error('canonical document revision requires an existing baseline')
  const existingReceipt = await readCanonicalDocumentCommitReceipt(
    input.workspacePath,
    input.contract.dispatchId,
  )
  if (completeGameDocument) {
    return commitCompleteGameDocument({
      workspacePath,
      targetPath,
      receiptPath,
      currentContent,
      currentDigest,
      existingReceipt,
      contract: input.contract,
      body,
      authority: input.authority,
    })
  }
  if (existingReceipt) {
    if (existingReceipt.schemaVersion !== 1)
      throw new Error('canonical document receipt kind does not match dispatch')
    assertReceiptMatchesContract(existingReceipt, input.contract)
    if (currentDigest === existingReceipt.finalDigest) {
      const committed = { ...existingReceipt, status: 'committed' as const }
      if (existingReceipt.status !== 'committed')
        await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
      return committed
    }
    if (currentDigest !== existingReceipt.baselineDigest)
      throw new Error(
        'canonical document changed outside the prepared commit; refusing to overwrite concurrent content',
      )
    const proposed = canonicalDocumentContent({
      documentId: existingReceipt.documentId,
      version: existingReceipt.version,
      updatedAt: existingReceipt.updatedAt,
      body: body!,
    })
    if (digest(proposed) !== existingReceipt.finalDigest)
      throw new Error(
        'canonical document commit was already prepared with different content',
      )
    await durableWrite(targetPath, proposed)
    const committed = { ...existingReceipt, status: 'committed' as const }
    await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
    return committed
  }

  if (currentDigest !== input.contract.baselineDigest)
    throw new Error(
      'canonical document baseline changed before commit; refusing to overwrite concurrent content',
    )
  const version = nextVersion(input.contract)
  const updatedAt = nextUpdatedAt(input.contract)
  const finalContent = canonicalDocumentContent({
    documentId: input.contract.documentId,
    version,
    updatedAt,
    body: body!,
  })
  const prepared: CanonicalDocumentCommitReceipt = {
    schemaVersion: 1,
    dispatchId: input.contract.dispatchId,
    targetPath: input.contract.targetPath,
    baselineDigest: input.contract.baselineDigest,
    finalDigest: digest(finalContent),
    documentId: input.contract.documentId,
    version,
    updatedAt,
    status: 'prepared',
  }
  await durableWrite(receiptPath, `${JSON.stringify(prepared, null, 2)}\n`)
  await durableWrite(targetPath, finalContent)
  const committed = { ...prepared, status: 'committed' as const }
  await durableWrite(receiptPath, `${JSON.stringify(committed, null, 2)}\n`)
  return committed
}

async function commitCompleteGameDocument(input: {
  workspacePath: string
  targetPath: string
  receiptPath: string
  currentContent: string | undefined
  currentDigest: string | null
  existingReceipt: CanonicalDocumentCommitReceipt | undefined
  contract: CanonicalDocumentCommitContract
  body: string | undefined
  authority: unknown
}): Promise<CompleteGameDocumentCommitReceipt> {
  const documentPath = input.contract.targetPath as FoundationDocumentPath
  let receipt: CompleteGameDocumentCommitReceipt
  let markdown: string

  if (input.existingReceipt) {
    if (input.existingReceipt.schemaVersion !== 2)
      throw new Error('canonical document receipt kind does not match dispatch')
    assertReceiptMatchesContract(input.existingReceipt, input.contract)
    receipt = input.existingReceipt
    if (input.currentDigest === receipt.finalDigest && input.currentContent) {
      markdown = input.currentContent
      if (input.body) {
        const proposed = canonicalizeCompleteGameDocumentMarkdown(
          documentPath,
          input.body,
          { version: receipt.version, updatedAt: receipt.updatedAt },
        )
        if (digest(proposed) !== receipt.finalDigest)
          throw new Error(
            'canonical document commit was already prepared with different content',
          )
      }
    } else {
      if (input.currentDigest !== receipt.baselineDigest)
        throw new Error(
          'canonical document changed outside the prepared commit; refusing to overwrite concurrent content',
        )
      if (!input.body)
        throw new Error(
          'prepared canonical document bytes are missing; resend body before authority repair',
        )
      markdown = canonicalizeCompleteGameDocumentMarkdown(
        documentPath,
        input.body,
        { version: receipt.version, updatedAt: receipt.updatedAt },
      )
      if (digest(markdown) !== receipt.finalDigest)
        throw new Error(
          'canonical document commit was already prepared with different content',
        )
      await durableWrite(input.targetPath, markdown)
    }
  } else {
    if (!input.body)
      throw new Error('complete game document body is required before authority repair')
    if (input.currentDigest !== input.contract.baselineDigest)
      throw new Error(
        'canonical document baseline changed before commit; refusing to overwrite concurrent content',
      )
    const version = nextVersion(input.contract)
    const updatedAt = nextUpdatedAt(input.contract)
    markdown = canonicalizeCompleteGameDocumentMarkdown(
      documentPath,
      input.body,
      { version, updatedAt },
    )
    receipt = {
      schemaVersion: 2,
      dispatchId: input.contract.dispatchId,
      targetPath: input.contract.targetPath,
      baselineDigest: input.contract.baselineDigest,
      finalDigest: digest(markdown),
      authorityPath: authoritySidecarPath(documentPath),
      authorityDigest: null,
      documentId: input.contract.documentId,
      version,
      updatedAt,
      status: 'document_prepared',
    }
    await durableWrite(
      input.receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
    )
    await durableWrite(input.targetPath, markdown)
  }

  const authorityTarget = resolve(input.workspacePath, receipt.authorityPath)
  if (receipt.status === 'committed') {
    const raw = await readOptionalFile(authorityTarget)
    if (
      raw === undefined ||
      receipt.authorityDigest === null ||
      digest(raw) !== receipt.authorityDigest
    )
      throw new Error('committed foundation authority sidecar is missing or stale')
    validateFoundationAuthoritySidecar({
      documentPath,
      markdown,
      value: JSON.parse(raw),
    })
    if (input.authority !== undefined) {
      const submitted = createFoundationAuthoritySidecar({
        documentPath,
        markdown,
        submission: input.authority,
      })
      if (
        digest(canonicalFoundationAuthoritySidecarBytes(submitted)) !==
        receipt.authorityDigest
      )
        throw new Error(
          'canonical document commit was already prepared with different authority',
        )
    }
    return receipt
  }

  if (input.authority === undefined)
    throw new Error('foundation authority records are required')
  const sidecar = createFoundationAuthoritySidecar({
    documentPath,
    markdown,
    submission: input.authority,
  })
  const sidecarBytes = canonicalFoundationAuthoritySidecarBytes(sidecar)
  await durableWrite(authorityTarget, sidecarBytes)
  const committed: CompleteGameDocumentCommitReceipt = {
    ...receipt,
    authorityDigest: digest(sidecarBytes),
    status: 'committed',
  }
  await durableWrite(
    input.receiptPath,
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

export async function readCanonicalDocumentCommitReceipt(
  workspacePath: string,
  dispatchId: string,
): Promise<CanonicalDocumentCommitReceipt | undefined> {
  const path = canonicalDocumentReceiptPath(workspacePath, dispatchId)
  const raw = await readOptionalFile(path)
  if (raw === undefined) return undefined
  const parsed = receiptSchema.parse(
    JSON.parse(raw),
  ) as CanonicalDocumentCommitReceipt
  if (parsed.dispatchId !== dispatchId)
    throw new Error('canonical document commit receipt is invalid')
  if (!CANONICAL_DOCUMENT_PATHS.has(parsed.targetPath))
    throw new Error('canonical document commit receipt target is invalid')
  if (
    CANONICAL_PROJECT_DOCUMENT_IDS[
      parsed.targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
    ] !== parsed.documentId
  )
    throw new Error('canonical document commit receipt identity is invalid')
  return parsed
}

export async function reconcileCanonicalDocumentCommitReceipt(input: {
  workspacePath: string
  dispatchId: string
}): Promise<CanonicalDocumentCommitReceipt | undefined> {
  const receipt = await readCanonicalDocumentCommitReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (!receipt) return undefined
  const target = await readOptionalFile(
    resolve(input.workspacePath, receipt.targetPath),
  )
  if (target === undefined || digest(target) !== receipt.finalDigest)
    return undefined
  if (receipt.schemaVersion === 2) {
    const authorityRaw = await readOptionalFile(
      resolve(input.workspacePath, receipt.authorityPath),
    )
    if (authorityRaw === undefined) return undefined
    let authority: unknown
    try {
      authority = JSON.parse(authorityRaw)
    } catch {
      return undefined
    }
    validateFoundationAuthoritySidecar({
      documentPath: receipt.targetPath as FoundationDocumentPath,
      markdown: target,
      value: authority,
    })
    const authorityDigest = digest(authorityRaw)
    if (
      receipt.authorityDigest !== null &&
      receipt.authorityDigest !== authorityDigest
    )
      return undefined
    if (
      receipt.status === 'committed' &&
      receipt.authorityDigest === authorityDigest
    )
      return receipt
    const committed: CompleteGameDocumentCommitReceipt = {
      ...receipt,
      authorityDigest,
      status: 'committed',
    }
    await durableWrite(
      canonicalDocumentReceiptPath(input.workspacePath, input.dispatchId),
      `${JSON.stringify(committed, null, 2)}\n`,
    )
    return committed
  }
  if (receipt.status === 'committed') return receipt
  const committed = { ...receipt, status: 'committed' as const }
  await durableWrite(
    canonicalDocumentReceiptPath(input.workspacePath, input.dispatchId),
    `${JSON.stringify(committed, null, 2)}\n`,
  )
  return committed
}

function canonicalDocumentReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('canonical document dispatch identity is invalid')
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'document-commits',
    `${dispatchId}.json`,
  )
}

function canonicalDocumentContent(input: {
  documentId: string
  version: string
  updatedAt: string
  body: string
}): string {
  return `---\ndocument_id: ${input.documentId}\nversion: ${input.version}\nupdated_at: ${input.updatedAt}\n---\n\n${input.body.trim()}\n`
}

function nextVersion(contract: CanonicalDocumentCommitContract): string {
  if (contract.operation === 'create') return '1.0.0'
  const parts = contract.baselineVersion?.split('.').map(Number)
  const sourceParts = contract.baselineVersion?.split('.')
  if (
    !parts ||
    !sourceParts ||
    parts.length !== 3 ||
    parts.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        String(part) !== sourceParts[index],
    )
  )
    throw new Error('canonical document revision requires valid baseline metadata')
  return `${parts[0]}.${parts[1]}.${parts[2]! + 1}`
}

function nextUpdatedAt(contract: CanonicalDocumentCommitContract): string {
  const previous = contract.baselineUpdatedAt
  const now = Date.now()
  const previousTime = previous ? Date.parse(previous) : Number.NaN
  if (
    contract.operation === 'revise' &&
    (previous === undefined || !Number.isFinite(previousTime))
  )
    throw new Error('canonical document revision requires valid baseline metadata')
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
  ).toISOString()
}

function assertReceiptMatchesContract(
  receipt: CanonicalDocumentCommitReceipt,
  contract: CanonicalDocumentCommitContract,
): void {
  if (
    receipt.dispatchId !== contract.dispatchId ||
    receipt.targetPath !== contract.targetPath ||
    receipt.documentId !== contract.documentId ||
    receipt.baselineDigest !== contract.baselineDigest
  )
    throw new Error('canonical document commit receipt does not match dispatch')
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
