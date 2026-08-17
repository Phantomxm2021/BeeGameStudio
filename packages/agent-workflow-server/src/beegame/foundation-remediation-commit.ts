import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod/v4'
import {
  assembleFoundationRemediationTransaction,
  foundationRemediationTransactionReceiptSchema,
  type FoundationRemediationResult,
  type FoundationRemediationTransactionReceipt,
  type FoundationRemediationTransactionRequest,
} from './delivery-workflow/foundation-remediation-transaction'

const durableCommitSchema = z
  .object({
    version: z.literal(1),
    state: z.enum(['prepared', 'committed']),
    dispatchId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    stagedRelativePath: z.string().min(1),
    receipt: foundationRemediationTransactionReceiptSchema,
  })
  .strict()

type DurableFoundationRemediationCommit = z.infer<
  typeof durableCommitSchema
>

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function validateDispatchId(dispatchId: string): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(dispatchId))
    throw new Error('foundation remediation dispatch identity is invalid')
}

async function resolveRegularTarget(
  workspacePath: string,
  sourcePath: string,
): Promise<string> {
  const workspace = await realpath(resolve(workspacePath))
  const target = resolve(workspace, sourcePath)
  const confined = relative(workspace, target)
  if (!confined || confined.startsWith('..') || resolve(workspace, confined) !== target)
    throw new Error('foundation remediation target is outside the project')
  const metadata = await lstat(target)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('foundation remediation target must be a regular project file')
  const canonicalTarget = await realpath(target)
  const canonicalRelative = relative(workspace, canonicalTarget)
  if (
    !canonicalRelative ||
    canonicalRelative.startsWith('..') ||
    resolve(workspace, canonicalRelative) !== canonicalTarget
  )
    throw new Error('foundation remediation target resolves outside the project')
  return canonicalTarget
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function durableWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function commitDirectory(workspacePath: string): string {
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'foundation-remediation-commits',
  )
}

function commitReceiptPath(workspacePath: string, dispatchId: string): string {
  return join(commitDirectory(workspacePath), `${dispatchId}.json`)
}

function stagedRelativePath(dispatchId: string): string {
  return join(
    '.beegame',
    'workflow',
    'foundation-remediation-commits',
    `${dispatchId}.staging.md`,
  )
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function readDurableCommit(
  workspacePath: string,
  dispatchId: string,
): Promise<DurableFoundationRemediationCommit | undefined> {
  const raw = await readOptional(commitReceiptPath(workspacePath, dispatchId))
  if (raw === undefined) return undefined
  const parsed = durableCommitSchema.parse(JSON.parse(raw))
  if (
    parsed.dispatchId !== dispatchId ||
    parsed.stagedRelativePath !== stagedRelativePath(dispatchId)
  )
    throw new Error('foundation remediation durable receipt identity is invalid')
  return parsed
}

async function writeDurableCommit(
  workspacePath: string,
  commit: DurableFoundationRemediationCommit,
): Promise<void> {
  await durableWrite(
    commitReceiptPath(workspacePath, commit.dispatchId),
    `${JSON.stringify(commit, null, 2)}\n`,
  )
}

export async function reconcileFoundationRemediationTransactionCommit(input: {
  workspacePath: string
  dispatchId: string
}): Promise<FoundationRemediationTransactionReceipt | undefined> {
  validateDispatchId(input.dispatchId)
  const persisted = await readDurableCommit(
    input.workspacePath,
    input.dispatchId,
  )
  if (!persisted) return undefined
  const target = await resolveRegularTarget(
    input.workspacePath,
    persisted.receipt.targetPath,
  )
  const currentDigest = digest(await readFile(target, 'utf8'))
  if (currentDigest === persisted.receipt.finalDigest) {
    if (persisted.state === 'prepared')
      await writeDurableCommit(input.workspacePath, {
        ...persisted,
        state: 'committed',
      })
    return persisted.receipt
  }
  if (
    persisted.state !== 'prepared' ||
    currentDigest !== persisted.receipt.sourceDigest
  )
    throw new Error('foundation remediation durable receipt target mismatch')

  const staged = resolve(input.workspacePath, persisted.stagedRelativePath)
  const stagedMarkdown = await readOptional(staged)
  if (
    stagedMarkdown === undefined ||
    digest(stagedMarkdown) !== persisted.receipt.finalDigest
  )
    throw new Error('foundation remediation prepared bytes are unavailable')
  await rename(staged, target)
  await syncDirectory(dirname(target))
  await writeDurableCommit(input.workspacePath, {
    ...persisted,
    state: 'committed',
  })
  return persisted.receipt
}

export async function commitFoundationRemediationTransaction(input: {
  workspacePath: string
  dispatchId: string
  request: FoundationRemediationTransactionRequest
  result: FoundationRemediationResult | unknown
  previousMetadata: { version: string; updatedAt: string }
  committedAt: string
}): Promise<FoundationRemediationTransactionReceipt> {
  validateDispatchId(input.dispatchId)
  if (digest(input.request.sourceMarkdown) !== input.request.sourceDigest)
    throw new Error('foundation remediation request source digest is invalid')

  // Validate and assemble the complete final bytes before touching the target.
  const assembled = assembleFoundationRemediationTransaction({
    request: input.request,
    result: input.result,
    previousMetadata: input.previousMetadata,
    committedAt: input.committedAt,
  })
  const existing = await readDurableCommit(
    input.workspacePath,
    input.dispatchId,
  )
  if (existing) {
    if (
      JSON.stringify(existing.receipt) !== JSON.stringify(assembled.receipt)
    )
      throw new Error('foundation remediation durable receipt does not match request')
    const reconciled =
      await reconcileFoundationRemediationTransactionCommit(input)
    if (!reconciled)
      throw new Error('foundation remediation durable receipt is unavailable')
    return reconciled
  }
  const target = await resolveRegularTarget(
    input.workspacePath,
    input.request.sourcePath,
  )
  const current = await readFile(target, 'utf8')
  const currentDigest = digest(current)

  if (currentDigest !== input.request.sourceDigest)
    throw new Error('foundation remediation target changed before commit')

  const stagedPath = stagedRelativePath(input.dispatchId)
  const staged = resolve(input.workspacePath, stagedPath)
  await durableWrite(staged, assembled.markdown)
  const prepared: DurableFoundationRemediationCommit = {
    version: 1,
    state: 'prepared',
    dispatchId: input.dispatchId,
    stagedRelativePath: stagedPath,
    receipt: assembled.receipt,
  }
  await writeDurableCommit(input.workspacePath, prepared)
  if (digest(await readFile(target, 'utf8')) !== input.request.sourceDigest)
    throw new Error('foundation remediation target changed before commit')
  await rename(staged, target)
  await syncDirectory(dirname(target))
  await writeDurableCommit(input.workspacePath, {
    ...prepared,
    state: 'committed',
  })
  return assembled.receipt
}
