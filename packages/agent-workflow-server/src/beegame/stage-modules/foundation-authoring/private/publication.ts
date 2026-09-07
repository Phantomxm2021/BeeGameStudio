import { createHash } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { authorDigest, type AuthorDocumentsResult, type AuthorStartInput } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { readAuthoredDocumentReceipt } from './domain/authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './domain/revision'
import { defaultAudit } from './domain/document-publication-protocol'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Immutable business artifacts only. No checkpoint/dispatch identity is exported. */
export async function publishAuthorDocuments(input: {
  start: AuthorStartInput
  workspacePath: string
  acceptedDispatches: Record<string, string>
}, testHooks?: { afterArtifacts?(): Promise<void> }): Promise<AuthorDocumentsResult> {
  const readiness = await defaultAudit(input.workspacePath, { includeChecklist: false, includeAssetManifest: false })
  if (!readiness.valid) throw new Error(`author readiness failed: ${readiness.issues.join('; ')}`)
  const workspace = await realpath(input.workspacePath)
  const receipts = []
  const bodies = []
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const dispatch = input.acceptedDispatches[path]
    if (!dispatch) throw new Error(`author accepted receipt missing: ${path}`)
    const receipt = await readAuthoredDocumentReceipt(workspace, dispatch)
    const actualPath = await realpath(resolve(workspace, path))
    const rel = relative(workspace, actualPath)
    if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('author document escapes workspace')
    const bytes = await readFile(actualPath)
    if (!receipt || receipt.status !== 'committed' || receipt.targetPath !== path || receipt.finalDigest !== digest(bytes) || receipt.byteLength !== bytes.byteLength)
      throw new Error(`author receipt/body binding mismatch: ${path}`)
    receipts.push(receipt)
    bodies.push({ path, bytes, digest: receipt.finalDigest, byteLength: receipt.byteLength })
  }
  const receiptSetDigest = authorDigest(receipts)
  const resultId = authorDigest({ producer: 'foundation-authoring', inputDigest: input.start.inputDigest, receiptSetDigest })
  const documentRevision = await computeDocumentRevision(workspace, input.start.input.confirmedBriefDigest)
  const workspaceRevision = await computeWorkspaceRevision(workspace)
  const documents = []
  for (const body of bodies) {
    const artifactPath = `.beegame/workflow/foundation-authoring/artifacts/${resultId}/${body.path}`
    await immutableWrite(workspace, artifactPath, body.bytes)
    documents.push({ path: body.path, digest: body.digest, byteLength: body.byteLength, artifactPath })
  }
  await testHooks?.afterArtifacts?.()
  // Detect canonical edits while copying the snapshot; no stale completion may publish.
  for (const body of bodies) {
    if (digest(await readFile(resolve(workspace, body.path))) !== body.digest)
      throw new Error(`author document changed during publication: ${body.path}`)
  }
  if (documentRevision !== await computeDocumentRevision(workspace, input.start.input.confirmedBriefDigest) || workspaceRevision !== await computeWorkspaceRevision(workspace))
    throw new Error('author revision changed during publication')
  return {
    protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents',
    resultId, inputDigest: input.start.inputDigest, ownerId: input.start.ownerId, projectId: input.start.projectId,
    confirmedBriefDigest: input.start.input.confirmedBriefDigest, documents, receiptSetDigest,
    documentRevision, workspaceRevision,
  }
}

async function immutableWrite(workspace: string, path: string, bytes: Uint8Array): Promise<void> {
  const destination = resolve(workspace, path)
  await mkdir(dirname(destination), { recursive: true })
  const parent = await realpath(dirname(destination))
  if (parent !== dirname(destination)) throw new Error('author artifact path contains a symbolic link')
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    try { await link(temporary, destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const target = await lstat(destination)
      if (target.isSymbolicLink() || !target.isFile()) throw new Error('author immutable artifact is not a regular file')
      if (!(await readFile(destination)).equals(Buffer.from(bytes))) throw new Error('author immutable artifact collision')
    }
    const directory = await open(parent, 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
}
