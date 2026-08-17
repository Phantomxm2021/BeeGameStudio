import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import {
  assembleFoundationRemediationTransaction,
  type FoundationRemediationResult,
  type FoundationRemediationTransactionReceipt,
  type FoundationRemediationTransactionRequest,
} from './delivery-workflow/foundation-remediation-transaction'

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

async function durableReplace(
  target: string,
  content: string,
  dispatchId: string,
): Promise<void> {
  const temporary = `${target}.${dispatchId}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    const directory = await open(dirname(target), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
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
  const target = await resolveRegularTarget(
    input.workspacePath,
    input.request.sourcePath,
  )
  const current = await readFile(target, 'utf8')
  const currentDigest = digest(current)

  // A crash after rename but before the caller receives the receipt is replayable.
  if (currentDigest === assembled.receipt.finalDigest) return assembled.receipt
  if (currentDigest !== input.request.sourceDigest)
    throw new Error('foundation remediation target changed before commit')

  await durableReplace(target, assembled.markdown, input.dispatchId)
  return assembled.receipt
}
