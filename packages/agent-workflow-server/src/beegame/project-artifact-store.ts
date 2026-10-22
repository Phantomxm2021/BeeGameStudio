import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const STORE_DIRECTORY = '.beegame'
const ARTIFACTS_DIRECTORY = 'artifacts'
const PENDING_DIRECTORY = 'pending'
const MATERIALIZATION_COMMIT_FILE = 'materialization.json'
const SNAPSHOT_VERSION = 1
// Infrastructure envelope ceiling, not a document-content policy. Keep this
// at least as large as the accepted public result envelopes used by the app.
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024

export type ProjectArtifactIdentity = Readonly<{
  ownerId: string
  projectId: string
}>

type MaterializationCommit = {
  version: typeof SNAPSHOT_VERSION
  publicationId: string
  snapshotDigest: string
  token: string
}

function parseMaterializationCommit(raw: string, path: string): MaterializationCommit {
  const value = parseCanonicalJson(raw, path)
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'publicationId', 'snapshotDigest', 'token']) ||
      value.version !== SNAPSHOT_VERSION || typeof value.publicationId !== 'string' ||
      typeof value.snapshotDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.snapshotDigest) ||
      typeof value.token !== 'string' || !/^[0-9a-f]{64}$/.test(value.token)) {
    throw new Error(`Invalid artifact materialization commit: ${path}`)
  }
  return {
    version: SNAPSHOT_VERSION,
    publicationId: value.publicationId,
    snapshotDigest: value.snapshotDigest,
    token: value.token,
  }
}

/** Return a fail-closed token for reader-side multi-file consistency checks. */
export async function readProjectArtifactPublicationToken(
  workspacePath: string,
): Promise<string | undefined> {
  const workspace = await findWorkspaceDirectory(workspacePath)
  if (!workspace) return undefined
  const storePath = await findDirectoryTree(workspace, [STORE_DIRECTORY])
  if (!storePath) return undefined
  const artifactsPath = await findDirectoryTree(storePath, [ARTIFACTS_DIRECTORY])
  if (!artifactsPath) return undefined
  const pendingPath = await findDirectoryTree(artifactsPath, [PENDING_DIRECTORY])
  if (pendingPath) {
    for (const entry of await readdir(pendingPath, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json')) continue
      const path = join(pendingPath, entry.name)
      const status = await inspectPath(path)
      if (status) {
        assertRegularFile(status, path)
        throw new Error('Artifact publication has a pending transaction')
      }
    }
  }
  const commitPath = join(artifactsPath, MATERIALIZATION_COMMIT_FILE)
  const commitStatus = await inspectPath(commitPath)
  if (!commitStatus) return undefined
  assertRegularFile(commitStatus, commitPath)
  const commit = parseMaterializationCommit(await readBoundedFile(commitPath, 'materialization commit'), commitPath)
  return commit.token
}

export async function readCanonicalProjectArtifactConsistently<T>(
  workspacePath: string,
  reader: () => Promise<T>,
): Promise<T> {
  const before = await readProjectArtifactPublicationToken(workspacePath)
  const value = await reader()
  const after = await readProjectArtifactPublicationToken(workspacePath)
  if (before !== after) throw new Error('Artifact publication changed during canonical read')
  return value
}

function parseCanonicalJson(raw: string, path: string): unknown {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`Corrupt artifact metadata: ${path}`)
  }
  if (serialize(value) !== raw) throw new Error(`Non-canonical artifact metadata: ${path}`)
  return value
}

async function readBoundedFile(path: string, kind: string): Promise<string> {
  const status = await inspectPath(path)
  if (!status) throw new Error(`Missing artifact ${kind}: ${path}`)
  assertRegularFile(status, path)
  if (status.size > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Artifact ${kind} exceeds the maximum size: ${path}`)
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_SNAPSHOT_BYTES)
      throw new Error(`Artifact ${kind} has invalid size or kind`)
    const content = await file.readFile('utf8')
    assertSnapshotSize(content, kind)
    return content
  } finally { await file.close() }
}

function assertSnapshotSize(bytes: string, label: string): void {
  if (Buffer.byteLength(bytes, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error(`${label} exceeds the maximum size of ${MAX_SNAPSHOT_BYTES} bytes`)
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function serialize(value: unknown): string {
  const result = JSON.stringify(value)
  if (result === undefined) throw new Error('Cannot serialize artifact metadata')
  return result
}

async function findWorkspaceDirectory(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) throw new Error('Artifact workspace must be absolute')
  const workspace = resolve(path)
  await assertWorkspaceAncestors(workspace)
  const status = await inspectPath(workspace)
  if (!status) return undefined
  assertDirectory(status, workspace)
  return workspace
}

async function assertWorkspaceAncestors(workspace: string): Promise<void> {
  const segments = workspace.split('/').filter(Boolean)
  let current = '/'
  for (const segment of segments) {
    current = join(current, segment)
    const status = await inspectPath(current)
    if (!status) return
    if (status.isSymbolicLink()) {
      // macOS exposes the temporary directory through /var -> /private/var;
      // this system alias is safe and unavoidable for Bun's mkdtemp paths.
      if (current === '/var' && await realpath(current) === '/private/var') continue
      throw new Error(`Symlink is not allowed in workspace ancestors: ${current}`)
    }
  }
}

async function findDirectoryTree(base: string, components: string[]): Promise<string | undefined> {
  let current = base
  for (const component of components) {
    current = join(current, component)
    const status = await inspectPath(current)
    if (!status) return undefined
    assertDirectory(status, current)
  }
  return current
}

async function inspectPath(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

function assertDirectory(status: Awaited<ReturnType<typeof lstat>>, path: string): void {
  if (status.isSymbolicLink()) throw new Error(`Symlink is not allowed in artifact store: ${path}`)
  if (!status.isDirectory()) throw new Error(`Artifact store parent is not a directory: ${path}`)
}

function assertRegularFile(status: Awaited<ReturnType<typeof lstat>>, path: string): void {
  if (status.isSymbolicLink()) throw new Error(`Symlink is not allowed in artifact store: ${path}`)
  if (!status.isFile()) throw new Error(`Artifact store object is not a regular file: ${path}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
