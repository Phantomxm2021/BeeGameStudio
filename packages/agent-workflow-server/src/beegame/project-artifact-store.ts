import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  rename,
  rm,
  unlink,
  link,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path'

const STORE_DIRECTORY = '.beegame'
const ARTIFACTS_DIRECTORY = 'artifacts'
const SNAPSHOTS_DIRECTORY = 'snapshots'
const PUBLICATIONS_DIRECTORY = 'publications'
const PENDING_DIRECTORY = 'pending'
const CURRENT_POINTER_FILE = 'current.json'
const PUBLISH_LOCK_DIRECTORY = '.publish.lock'
const MATERIALIZATION_COMMIT_FILE = 'materialization.json'
const SNAPSHOT_VERSION = 1
// Infrastructure envelope ceiling, not a document-content policy. Keep this
// at least as large as the accepted public result envelopes used by the app.
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024

type ArtifactDocumentInput = {
  path: string
  content: string
  digest: string
  byteLength: number
}

export type CurrentProjectArtifact = Readonly<ArtifactDocumentInput>

export type ProjectArtifactIdentity = Readonly<{
  ownerId: string
  projectId: string
}>

export type ProjectWorkspaceDigest = Readonly<{
  path: string
  digest: string | null
}>

export type PublishProjectArtifactsInput = {
  workspacePath: string
  ownerId: string
  projectId: string
  publicationId: string
  documents: ArtifactDocumentInput[]
  /**
   * When supplied, publication succeeds only if the current publication still
   * has this id. An absent current publication is represented by undefined.
   */
  expectedPublicationId?: string
  /** Baseline bytes authorized for materializing project files. */
  expectedWorkspaceDigests?: readonly ProjectWorkspaceDigest[]
}

type SnapshotDocument = ArtifactDocumentInput

type SnapshotPayload = {
  version: typeof SNAPSHOT_VERSION
  ownerId: string
  projectId: string
  publicationId: string
  documents: SnapshotDocument[]
}

type Snapshot = SnapshotPayload & {
  snapshotDigest: string
}

type CurrentPointer = {
  version: typeof SNAPSHOT_VERSION
  ownerId: string
  projectId: string
  publicationId: string
  snapshotDigest: string
}

type PublicationMarker = {
  version: typeof SNAPSHOT_VERSION
  ownerId: string
  projectId: string
  publicationId: string
  snapshotDigest: string
}

type PendingTransactionEntry = {
  path: string
  baselineDigest: string | null
  desiredDigest: string
  byteLength: number
}

type PendingTransaction = {
  version: typeof SNAPSHOT_VERSION
  ownerId: string
  projectId: string
  publicationId: string
  snapshotDigest: string
  token: string
  entries: PendingTransactionEntry[]
}

type MaterializationCommit = {
  version: typeof SNAPSHOT_VERSION
  publicationId: string
  snapshotDigest: string
  token: string
}

/**
 * Publish an application-owned, immutable snapshot of project artifacts.
 *
 * The project itself is never written. The only writes are below
 * `<workspacePath>/.beegame/artifacts/`.
 */
export async function publishProjectArtifacts(
  input: PublishProjectArtifactsInput,
): Promise<void> {
  // Snapshot all caller-owned values before the first await.
  const requestedWorkspacePath = input.workspacePath
  const ownerId = requireIdentifier(input.ownerId, 'ownerId')
  const projectId = requireIdentifier(input.projectId, 'projectId')
  const publicationId = requireIdentifier(input.publicationId, 'publicationId')
  const documents = normalizeDocuments(input.documents)
  const expectedPublicationId = input.expectedPublicationId === undefined
    ? undefined
    : requireIdentifier(input.expectedPublicationId, 'expectedPublicationId')
  const expectedWorkspaceDigests = normalizeExpectedWorkspaceDigests(input.expectedWorkspaceDigests)
  const payload: SnapshotPayload = {
    version: SNAPSHOT_VERSION,
    ownerId,
    projectId,
    publicationId,
    documents,
  }
  const snapshotDigest = sha256(serialize(payload))
  const snapshot: Snapshot = { ...payload, snapshotDigest }
  const snapshotBytes = serialize(snapshot)
  assertSnapshotSize(snapshotBytes, 'new artifact snapshot')

  const workspacePath = await requireWorkspaceDirectory(requestedWorkspacePath)

  const artifactsPath = await ensureDirectoryTree(workspacePath, [
    STORE_DIRECTORY,
    ARTIFACTS_DIRECTORY,
  ])
  const snapshotsPath = await ensureDirectoryTree(artifactsPath, [
    SNAPSHOTS_DIRECTORY,
  ])
  const publicationsPath = await ensureDirectoryTree(artifactsPath, [
    PUBLICATIONS_DIRECTORY,
  ])
  const pendingPath = await ensureDirectoryTree(artifactsPath, [
    PENDING_DIRECTORY,
  ])

  const snapshotPath = join(snapshotsPath, `${snapshotDigest}.json`)
  const currentPath = join(artifactsPath, CURRENT_POINTER_FILE)
  const materializationPath = join(artifactsPath, MATERIALIZATION_COMMIT_FILE)
  const pendingTransactionPath = join(pendingPath, `${sha256(publicationId)}.json`)

  await withPublishLock(artifactsPath, async () => {
    await assertNoOtherPendingTransactions(pendingPath, publicationId)
    const current = await readCurrentState(currentPath, snapshotsPath)
    if (current && (current.pointer.ownerId !== ownerId || current.pointer.projectId !== projectId)) {
      throw new Error('Artifact current pointer belongs to a different owner or project')
    }
    if (expectedPublicationId !== undefined &&
        current?.pointer.publicationId !== expectedPublicationId) {
      throw new Error(
        `Artifact publication compare-and-swap failed: expected ${expectedPublicationId}`,
      )
    }

    const historical = await readPublicationMarker(publicationsPath, publicationId)
    if (historical && current?.pointer.publicationId !== publicationId) {
      if (historical.snapshotDigest !== snapshotDigest ||
          historical.ownerId !== ownerId || historical.projectId !== projectId) {
        throw new Error(`Publication ${publicationId} is already bound to a different snapshot`)
      }
      // Historical publications are audit records and must never roll current
      // project files or the current pointer backward.
      return
    }

    if (current?.pointer.publicationId === publicationId) {
      if (current.pointer.ownerId !== ownerId ||
          current.pointer.projectId !== projectId ||
          current.pointer.snapshotDigest !== snapshotDigest) {
        throw new Error(`Publication ${publicationId} is already bound to a different snapshot`)
      }
      const existingPending = await inspectPath(pendingTransactionPath)
      if (!existingPending && await projectFilesMatchSnapshot(workspacePath, snapshot) &&
          await hasMatchingMaterializationCommit(materializationPath, current.pointer)) {
        await syncDirectory(snapshotsPath)
        await syncDirectory(artifactsPath)
        return
      }
    }

    await ensureImmutableSnapshot(snapshotPath, snapshotsPath, snapshotBytes, snapshot)

    // A marker is created for the outgoing current publication before the
    // pointer changes. This makes committed publication identity durable while
    // keeping the current pointer small and bounded.
    if (current && current.pointer.publicationId !== publicationId) {
      await ensurePublicationMarker(publicationsPath, current.pointer)
    }

    const pending = await loadOrCreatePendingTransaction(
      pendingTransactionPath,
      pendingPath,
      snapshot,
      workspacePath,
      expectedWorkspaceDigests,
      current?.pointer.publicationId !== publicationId,
    )
    await materializePendingTransaction(workspacePath, snapshot, pending)
    await writeAtomicJson(materializationPath, artifactsPath, serialize({
      version: SNAPSHOT_VERSION,
      publicationId,
      snapshotDigest,
      token: pending.token,
    } satisfies MaterializationCommit))

    const pointer: CurrentPointer = {
      version: SNAPSHOT_VERSION,
      ownerId,
      projectId,
      publicationId,
      snapshotDigest,
    }
    if (current?.pointer.publicationId !== publicationId) {
      await writeAtomicCurrent(currentPath, artifactsPath, serialize(pointer))
    } else {
      await syncDirectory(snapshotsPath)
      await syncDirectory(artifactsPath)
    }
    await removePendingTransaction(pendingTransactionPath, pendingPath)
  })
}

/** Read one artifact from the current application-owned snapshot. */
export async function readCurrentProjectArtifact(
  workspacePath: string,
  artifactPath: string,
  expectedIdentity?: ProjectArtifactIdentity,
): Promise<string | undefined> {
  const safePath = validateRelativePath(artifactPath)
  const identity = normalizeExpectedIdentity(expectedIdentity)
  const documents = await readCurrentProjectArtifacts(workspacePath, identity)
  return documents?.find(document => document.path === safePath)?.content
}

/**
 * Read all artifacts from one validated current snapshot. Consumers that need
 * several files should use this API so they cannot observe mixed publications.
 */
export async function readCurrentProjectArtifacts(
  workspacePath: string,
  expectedIdentity?: ProjectArtifactIdentity,
): Promise<readonly CurrentProjectArtifact[] | undefined> {
  const identity = normalizeExpectedIdentity(expectedIdentity)
  const workspace = await findWorkspaceDirectory(workspacePath)
  if (!workspace) return undefined

  const storePath = await findDirectoryTree(workspace, [STORE_DIRECTORY])
  if (!storePath) return undefined
  const artifactsPath = await findDirectoryTree(storePath, [ARTIFACTS_DIRECTORY])
  if (!artifactsPath) return undefined
  const snapshotsPath = await findDirectoryTree(artifactsPath, [SNAPSHOTS_DIRECTORY])
  // Validate every application-owned store parent, including the publication
  // marker directory, before trusting current metadata.
  await findDirectoryTree(artifactsPath, [PUBLICATIONS_DIRECTORY])
  const currentPath = join(artifactsPath, CURRENT_POINTER_FILE)
  const currentStatus = await inspectPath(currentPath)
  if (!currentStatus) return undefined
  assertRegularFile(currentStatus, currentPath)
  if (!snapshotsPath) throw new Error('Artifact current pointer has no snapshots directory')

  const current = await readCurrentState(currentPath, snapshotsPath)
  if (!current) return undefined
  assertExpectedIdentity(current.pointer, identity)
  return current.snapshot.documents.map(document => ({ ...document }))
}

function normalizeDocuments(documents: ArtifactDocumentInput[]): SnapshotDocument[] {
  if (!Array.isArray(documents)) throw new Error('documents must be an array')
  const normalized = documents.map((document, index) => {
    if (!document || typeof document !== 'object') {
      throw new Error(`documents[${index}] must be an object`)
    }
    const path = validateRelativePath(document.path)
    if (typeof document.content !== 'string') {
      throw new Error(`documents[${index}].content must be a string`)
    }
    if (typeof document.digest !== 'string' || !/^[0-9a-f]{64}$/i.test(document.digest)) {
      throw new Error(`documents[${index}].digest must be a SHA-256 hex digest`)
    }
    const bytes = Buffer.from(document.content, 'utf8')
    const digest = sha256(bytes)
    if (document.digest.toLowerCase() !== digest) {
      throw new Error(`documents[${index}].digest does not match content`)
    }
    if (!Number.isSafeInteger(document.byteLength) || document.byteLength < 0) {
      throw new Error(`documents[${index}].byteLength must be a non-negative integer`)
    }
    if (document.byteLength !== bytes.byteLength) {
      throw new Error(`documents[${index}].byteLength does not match content`)
    }
    return {
      path,
      content: document.content,
      digest,
      byteLength: document.byteLength,
    }
  })
  normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(`Duplicate artifact path: ${normalized[index]?.path}`)
    }
  }
  return normalized
}

function validateRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Artifact path must be a non-empty relative path')
  }
  if (value.includes('\0') || value.includes('\\') ||
      posix.isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error(`Unsafe artifact path: ${value}`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe artifact path: ${value}`)
  }
  const reservedArtifactsPath = `${STORE_DIRECTORY}/${ARTIFACTS_DIRECTORY}`
  if (value === reservedArtifactsPath || value.startsWith(`${reservedArtifactsPath}/`)) {
    throw new Error(`Artifact path is reserved by the application: ${value}`)
  }
  return value
}

function normalizeExpectedIdentity(
  identity: ProjectArtifactIdentity | undefined,
): ProjectArtifactIdentity | undefined {
  if (!identity) return undefined
  return {
    ownerId: requireIdentifier(identity.ownerId, 'expected ownerId'),
    projectId: requireIdentifier(identity.projectId, 'expected projectId'),
  }
}

function normalizeExpectedWorkspaceDigests(
  values: readonly ProjectWorkspaceDigest[] | undefined,
): readonly ProjectWorkspaceDigest[] | undefined {
  if (values === undefined) return undefined
  if (!Array.isArray(values)) throw new Error('expectedWorkspaceDigests must be an array')
  const normalized = values.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`expectedWorkspaceDigests[${index}] must be an object`)
    const path = validateRelativePath(value.path)
    if (value.digest !== null &&
        (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/i.test(value.digest))) {
      throw new Error(`expectedWorkspaceDigests[${index}].digest must be SHA-256 hex or null`)
    }
    return { path, digest: value.digest === null ? null : value.digest.toLowerCase() }
  })
  normalized.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(`Duplicate expected workspace path: ${normalized[index]?.path}`)
    }
  }
  return normalized
}

function assertExpectedIdentity(
  pointer: CurrentPointer,
  expected: ProjectArtifactIdentity | undefined,
): void {
  if (!expected) return
  if (pointer.ownerId !== expected.ownerId || pointer.projectId !== expected.projectId) {
    throw new Error('Artifact current pointer does not match the expected owner or project')
  }
}

function expectedDigestForPath(
  expected: readonly ProjectWorkspaceDigest[] | undefined,
  path: string,
): string | null | undefined {
  return expected?.find(value => value.path === path)?.digest
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0 || value.includes('\0')) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

async function ensureImmutableSnapshot(
  snapshotPath: string,
  snapshotsPath: string,
  bytes: string,
  expected: Snapshot,
): Promise<void> {
  const existing = await inspectPath(snapshotPath)
  if (existing) {
    assertRegularFile(existing, snapshotPath)
    await assertSnapshotBytes(snapshotPath, expected)
    return
  }

  const temporaryPath = join(
    snapshotsPath,
    `.${expected.snapshotDigest}.${randomBytes(12).toString('hex')}.tmp`,
  )
  let temporaryExists = false
  try {
    const file = await open(temporaryPath, 'wx', 0o600)
    temporaryExists = true
    try {
      await file.writeFile(bytes, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    // link(2), unlike rename(2), cannot replace an existing immutable object.
    try {
      await link(temporaryPath, snapshotPath)
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
      const raced = await inspectPath(snapshotPath)
      if (!raced) throw error
      assertRegularFile(raced, snapshotPath)
      await assertSnapshotBytes(snapshotPath, expected)
    }
    await unlink(temporaryPath)
    temporaryExists = false
    await syncDirectory(snapshotsPath)
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true })
  }
}

async function writeAtomicCurrent(
  currentPath: string,
  artifactsPath: string,
  bytes: string,
): Promise<void> {
  const existing = await inspectPath(currentPath)
  if (existing) assertRegularFile(existing, currentPath)
  const temporaryPath = join(
    artifactsPath,
    `.${CURRENT_POINTER_FILE}.${randomBytes(12).toString('hex')}.tmp`,
  )
  let temporaryExists = false
  try {
    const file = await open(temporaryPath, 'wx', 0o600)
    temporaryExists = true
    try {
      await file.writeFile(bytes, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, currentPath)
    temporaryExists = false
    await syncDirectory(artifactsPath)
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true })
  }
}

async function readCurrentState(
  currentPath: string,
  snapshotsPath: string,
): Promise<{ pointer: CurrentPointer; snapshot: Snapshot } | undefined> {
  const currentStatus = await inspectPath(currentPath)
  if (!currentStatus) return undefined
  assertRegularFile(currentStatus, currentPath)
  const pointer = parseCurrentPointer(await readBoundedFile(currentPath, 'current pointer'), currentPath)
  const snapshotPath = join(snapshotsPath, `${pointer.snapshotDigest}.json`)
  const snapshotStatus = await inspectPath(snapshotPath)
  if (!snapshotStatus) throw new Error('Artifact current pointer references a missing snapshot')
  assertRegularFile(snapshotStatus, snapshotPath)
  const snapshot = parseSnapshot(await readBoundedFile(snapshotPath, 'snapshot'), snapshotPath)
  if (snapshot.snapshotDigest !== pointer.snapshotDigest ||
      snapshot.ownerId !== pointer.ownerId ||
      snapshot.projectId !== pointer.projectId ||
      snapshot.publicationId !== pointer.publicationId) {
    throw new Error('Artifact current pointer is not bound to its snapshot')
  }
  return { pointer, snapshot }
}

async function assertSnapshotBytes(path: string, expected: Snapshot): Promise<void> {
  const parsed = parseSnapshot(await readBoundedFile(path, 'snapshot'), path)
  if (parsed.snapshotDigest !== expected.snapshotDigest ||
      serialize(parsed) !== serialize(expected)) {
    throw new Error(`Immutable artifact snapshot is corrupted: ${path}`)
  }
}

async function ensurePublicationMarker(
  publicationsPath: string,
  pointer: CurrentPointer,
): Promise<void> {
  const path = join(publicationsPath, `${sha256(pointer.publicationId)}.json`)
  const bytes = serialize(pointer)
  assertSnapshotSize(bytes, 'publication marker')
  const existing = await inspectPath(path)
  if (existing) {
    assertRegularFile(existing, path)
    const marker = parsePublicationMarker(await readBoundedFile(path, 'publication marker'), path)
    if (serialize(marker) !== bytes) {
      throw new Error(`Publication marker is corrupted: ${path}`)
    }
    await syncDirectory(publicationsPath)
    return
  }
  await writeImmutableJson(path, publicationsPath, bytes, async () => {
    const marker = parsePublicationMarker(await readBoundedFile(path, 'publication marker'), path)
    if (serialize(marker) !== bytes) throw new Error(`Publication marker is corrupted: ${path}`)
  })
}

async function readPublicationMarker(
  publicationsPath: string,
  publicationId: string,
): Promise<PublicationMarker | undefined> {
  const path = join(publicationsPath, `${sha256(publicationId)}.json`)
  const status = await inspectPath(path)
  if (!status) return undefined
  assertRegularFile(status, path)
  const marker = parsePublicationMarker(await readBoundedFile(path, 'publication marker'), path)
  if (marker.publicationId !== publicationId) throw new Error(`Publication marker name mismatch: ${path}`)
  return marker
}

function parsePublicationMarker(raw: string, path: string): PublicationMarker {
  const value = parseCanonicalJson(raw, path)
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'ownerId', 'projectId', 'publicationId', 'snapshotDigest',
  ]) || value.version !== SNAPSHOT_VERSION ||
      typeof value.ownerId !== 'string' || typeof value.projectId !== 'string' ||
      typeof value.publicationId !== 'string' || typeof value.snapshotDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.snapshotDigest)) {
    throw new Error(`Invalid publication marker: ${path}`)
  }
  return {
    version: SNAPSHOT_VERSION,
    ownerId: value.ownerId,
    projectId: value.projectId,
    publicationId: value.publicationId,
    snapshotDigest: value.snapshotDigest,
  }
}

async function writeImmutableJson(
  targetPath: string,
  parentPath: string,
  bytes: string,
  validateExisting: () => Promise<void>,
): Promise<void> {
  const temporaryPath = join(parentPath, `.${randomBytes(12).toString('hex')}.tmp`)
  let temporaryExists = false
  try {
    const file = await open(temporaryPath, 'wx', 0o600)
    temporaryExists = true
    try {
      await file.writeFile(bytes, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      await link(temporaryPath, targetPath)
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
      const existing = await inspectPath(targetPath)
      if (!existing) throw error
      assertRegularFile(existing, targetPath)
      await validateExisting()
    }
    await unlink(temporaryPath)
    temporaryExists = false
    await syncDirectory(parentPath)
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true })
  }
}

async function loadOrCreatePendingTransaction(
  pendingPath: string,
  pendingDirectory: string,
  snapshot: Snapshot,
  workspacePath: string,
  expected: readonly ProjectWorkspaceDigest[] | undefined,
  allowInferredBaseline: boolean,
): Promise<PendingTransaction> {
  const existing = await inspectPath(pendingPath)
  if (existing) {
    assertRegularFile(existing, pendingPath)
    const pending = parsePendingTransaction(await readBoundedFile(pendingPath, 'pending transaction'), pendingPath)
    assertPendingMatchesSnapshot(pending, snapshot)
    return pending
  }
  const entries: PendingTransactionEntry[] = []
  for (const document of snapshot.documents) {
    const actual = await readProjectFileState(workspacePath, document.path)
    const expectedDigest = expectedDigestForPath(expected, document.path)
    if (expected && expectedDigest === undefined) {
      throw new Error(`Expected workspace baseline is missing path: ${document.path}`)
    }
    const actualDigest = actual?.digest ?? null
    if (expected && actualDigest !== expectedDigest && actualDigest !== document.digest) {
      throw new Error(`Workspace baseline conflict for ${document.path}`)
    }
    if (!expected && !allowInferredBaseline && actual?.digest !== document.digest) {
      throw new Error(`Current publication requires explicit workspace baselines for ${document.path}`)
    }
    entries.push({
      path: document.path,
      baselineDigest: expected ? expectedDigest! : actual?.digest ?? null,
      desiredDigest: document.digest,
      byteLength: document.byteLength,
    })
  }
  if (expected && expected.length !== entries.length) {
    throw new Error('Expected workspace baselines must cover exactly the published documents')
  }
  const pending: PendingTransaction = {
    version: SNAPSHOT_VERSION,
    ownerId: snapshot.ownerId,
    projectId: snapshot.projectId,
    publicationId: snapshot.publicationId,
    snapshotDigest: snapshot.snapshotDigest,
    token: randomBytes(32).toString('hex'),
    entries,
  }
  await writeAtomicJson(pendingPath, pendingDirectory, serialize(pending))
  return pending
}

function assertPendingMatchesSnapshot(pending: PendingTransaction, snapshot: Snapshot): void {
  if (pending.ownerId !== snapshot.ownerId || pending.projectId !== snapshot.projectId ||
      pending.publicationId !== snapshot.publicationId || pending.snapshotDigest !== snapshot.snapshotDigest) {
    throw new Error('Pending artifact transaction does not match its snapshot')
  }
  if (pending.entries.length !== snapshot.documents.length) {
    throw new Error('Pending artifact transaction has incomplete documents')
  }
  for (const document of snapshot.documents) {
    const entry = pending.entries.find(value => value.path === document.path)
    if (!entry || entry.desiredDigest !== document.digest || entry.byteLength !== document.byteLength) {
      throw new Error('Pending artifact transaction is corrupted')
    }
  }
}

function parsePendingTransaction(raw: string, path: string): PendingTransaction {
  const value = parseCanonicalJson(raw, path)
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'ownerId', 'projectId', 'publicationId', 'snapshotDigest', 'token', 'entries',
  ]) || value.version !== SNAPSHOT_VERSION || typeof value.ownerId !== 'string' ||
      typeof value.projectId !== 'string' || typeof value.publicationId !== 'string' ||
      typeof value.snapshotDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.snapshotDigest) ||
      typeof value.token !== 'string' || !/^[0-9a-f]{64}$/.test(value.token) ||
      !Array.isArray(value.entries)) {
    throw new Error(`Invalid pending artifact transaction: ${path}`)
  }
  const entries = value.entries.map((entry, index): PendingTransactionEntry => {
    const byteLength = isRecord(entry) && typeof entry.byteLength === 'number'
      ? entry.byteLength
      : undefined
    if (!isRecord(entry) || !hasExactKeys(entry, ['path', 'baselineDigest', 'desiredDigest', 'byteLength']) ||
        typeof entry.path !== 'string' ||
        (entry.baselineDigest !== null && (typeof entry.baselineDigest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.baselineDigest))) ||
        typeof entry.desiredDigest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.desiredDigest) ||
        byteLength === undefined || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`Invalid pending artifact entry ${index}: ${path}`)
    }
    return {
      path: validateRelativePath(entry.path),
      baselineDigest: entry.baselineDigest,
      desiredDigest: entry.desiredDigest,
      byteLength: byteLength as number,
    }
  })
  const pending: PendingTransaction = {
    version: SNAPSHOT_VERSION,
    ownerId: value.ownerId,
    projectId: value.projectId,
    publicationId: value.publicationId,
    snapshotDigest: value.snapshotDigest,
    token: value.token,
    entries,
  }
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) {
    throw new Error(`Duplicate pending artifact path: ${path}`)
  }
  return pending
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

async function materializePendingTransaction(
  workspacePath: string,
  snapshot: Snapshot,
  pending: PendingTransaction,
): Promise<void> {
  const documents = new Map(snapshot.documents.map(document => [document.path, document]))
  const currentStates = new Map<string, { digest: string; byteLength: number } | undefined>()
  for (const entry of pending.entries) {
    const actual = await readProjectFileState(workspacePath, entry.path)
    currentStates.set(entry.path, actual)
    if (actual?.digest === entry.desiredDigest) continue
    if ((entry.baselineDigest === null && actual !== undefined) ||
        (entry.baselineDigest !== null && actual?.digest !== entry.baselineDigest)) {
      throw new Error(`Workspace file changed during artifact publication: ${entry.path}`)
    }
  }
  for (const entry of pending.entries) {
    const document = documents.get(entry.path)
    if (!document) throw new Error(`Pending artifact has no snapshot document: ${entry.path}`)
    const actual = currentStates.get(entry.path)
    if (actual?.digest === entry.desiredDigest) continue
    await atomicallyMaterializeProjectFile(workspacePath, document, entry.baselineDigest)
  }
  for (const document of snapshot.documents) {
    const actual = await readProjectFileState(workspacePath, document.path)
    if (actual?.digest !== document.digest || actual.byteLength !== document.byteLength) {
      throw new Error(`Materialized artifact verification failed: ${document.path}`)
    }
  }
}

async function projectFilesMatchSnapshot(
  workspacePath: string,
  snapshot: Snapshot,
): Promise<boolean> {
  for (const document of snapshot.documents) {
    const actual = await readProjectFileState(workspacePath, document.path)
    if (actual?.digest !== document.digest || actual.byteLength !== document.byteLength) return false
  }
  return true
}

async function hasMatchingMaterializationCommit(
  path: string,
  pointer: CurrentPointer,
): Promise<boolean> {
  const status = await inspectPath(path)
  if (!status) return false
  assertRegularFile(status, path)
  const commit = parseMaterializationCommit(await readBoundedFile(path, 'materialization commit'), path)
  return commit.publicationId === pointer.publicationId && commit.snapshotDigest === pointer.snapshotDigest
}

async function readProjectFileState(
  workspacePath: string,
  relativePath: string,
): Promise<{ digest: string; byteLength: number } | undefined> {
  const path = resolveWorkspaceFile(workspacePath, relativePath)
  const segments = relativePath.split('/')
  let parent = workspacePath
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment)
    const status = await inspectPath(parent)
    if (!status) return undefined
    assertDirectory(status, parent)
  }
  const status = await inspectPath(path)
  if (!status) return undefined
  assertRegularFile(status, path)
  const content = await readBoundedFile(path, 'project artifact')
  return { digest: sha256(Buffer.from(content, 'utf8')), byteLength: Buffer.byteLength(content, 'utf8') }
}

function resolveWorkspaceFile(workspacePath: string, relativePath: string): string {
  validateRelativePath(relativePath)
  const path = join(workspacePath, ...relativePath.split('/'))
  const relative = posix.relative(workspacePath.split('\\').join('/'), path.split('\\').join('/'))
  if (!relative || relative.startsWith('../') || relative === '..' || posix.isAbsolute(relative)) {
    throw new Error(`Artifact path escaped workspace: ${relativePath}`)
  }
  return path
}

async function atomicallyMaterializeProjectFile(
  workspacePath: string,
  document: SnapshotDocument,
  baselineDigest: string | null,
): Promise<void> {
  const path = resolveWorkspaceFile(workspacePath, document.path)
  const segments = document.path.split('/')
  const parent = segments.length > 1
    ? await ensureDirectoryTree(workspacePath, segments.slice(0, -1))
    : workspacePath
  const current = await readProjectFileState(workspacePath, document.path)
  if (current?.digest === document.digest) return
  if ((current?.digest ?? null) !== baselineDigest) {
    throw new Error(`Workspace file changed during artifact publication: ${document.path}`)
  }
  const temporaryPath = join(parent, `.beegame-artifact-${randomBytes(12).toString('hex')}.tmp`)
  let temporaryExists = false
  try {
    const file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    temporaryExists = true
    try {
      await file.writeFile(document.content, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    const beforeRename = await readProjectFileState(workspacePath, document.path)
    const beforeRenameDigest = beforeRename?.digest ?? null
    if (beforeRenameDigest !== baselineDigest && beforeRenameDigest !== document.digest) {
      throw new Error(`Workspace file changed during artifact publication: ${document.path}`)
    }
    await rename(temporaryPath, path)
    temporaryExists = false
    await syncDirectory(parent)
    const verified = await readProjectFileState(workspacePath, document.path)
    if (verified?.digest !== document.digest) throw new Error(`Materialized artifact bytes differ: ${document.path}`)
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true })
  }
}

async function removePendingTransaction(path: string, parent: string): Promise<void> {
  const status = await inspectPath(path)
  if (!status) return
  assertRegularFile(status, path)
  await unlink(path)
  await syncDirectory(parent)
}

async function assertNoOtherPendingTransactions(
  pendingDirectory: string,
  publicationId: string,
): Promise<void> {
  const expectedName = `${sha256(publicationId)}.json`
  for (const entry of await readdir(pendingDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json') || entry.name === expectedName) continue
    const path = join(pendingDirectory, entry.name)
    const status = await inspectPath(path)
    if (status) {
      assertRegularFile(status, path)
      throw new Error('Another artifact publication has a pending transaction')
    }
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

async function writeAtomicJson(path: string, parent: string, bytes: string): Promise<void> {
  const temporaryPath = join(parent, `.${randomBytes(12).toString('hex')}.tmp`)
  let temporaryExists = false
  try {
    const file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    temporaryExists = true
    try {
      await file.writeFile(bytes, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporaryPath, path)
    temporaryExists = false
    await syncDirectory(parent)
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true })
  }
}

function parseSnapshot(raw: string, path: string): Snapshot {
  const value = parseCanonicalJson(raw, path)
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'ownerId', 'projectId', 'publicationId', 'documents', 'snapshotDigest',
  ])) throw new Error(`Invalid artifact snapshot: ${path}`)
  if (value.version !== SNAPSHOT_VERSION ||
      typeof value.ownerId !== 'string' || typeof value.projectId !== 'string' ||
      typeof value.publicationId !== 'string' || typeof value.snapshotDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.snapshotDigest) || !Array.isArray(value.documents)) {
    throw new Error(`Invalid artifact snapshot: ${path}`)
  }
  const payload: SnapshotPayload = {
    version: SNAPSHOT_VERSION,
    ownerId: value.ownerId,
    projectId: value.projectId,
    publicationId: value.publicationId,
    documents: normalizeDocuments(value.documents as ArtifactDocumentInput[]),
  }
  const digest = sha256(serialize(payload))
  if (digest !== value.snapshotDigest || serialize({ ...payload, snapshotDigest: digest }) !== raw) {
    throw new Error(`Corrupt artifact snapshot: ${path}`)
  }
  return { ...payload, snapshotDigest: digest }
}

function parseCurrentPointer(raw: string, path: string): CurrentPointer {
  const value = parseCanonicalJson(raw, path)
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'ownerId', 'projectId', 'publicationId', 'snapshotDigest',
  ]) || value.version !== SNAPSHOT_VERSION ||
      typeof value.ownerId !== 'string' || typeof value.projectId !== 'string' ||
      typeof value.publicationId !== 'string' ||
      typeof value.snapshotDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.snapshotDigest)) {
    throw new Error(`Invalid artifact current pointer: ${path}`)
  }
  return {
    version: SNAPSHOT_VERSION,
    ownerId: value.ownerId,
    projectId: value.projectId,
    publicationId: value.publicationId,
    snapshotDigest: value.snapshotDigest,
  }
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

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function withPublishLock<T>(
  artifactsPath: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = join(artifactsPath, PUBLISH_LOCK_DIRECTORY)
  let acquired = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 })
      acquired = true
      break
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
      const status = await inspectPath(lockPath)
      if (status && !status.isDirectory()) throw new Error('Artifact publication lock is not a directory')
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    }
  }
  if (!acquired) throw new Error('Artifact publication is already in progress')
  try {
    return await action()
  } finally {
    await rmdir(lockPath)
  }
}

async function requireWorkspaceDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Artifact workspace must be absolute')
  const workspace = resolve(path)
  await assertWorkspaceAncestors(workspace)
  const status = await inspectPath(workspace)
  if (!status) throw new Error(`Workspace directory does not exist: ${workspace}`)
  assertDirectory(status, workspace)
  return workspace
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

async function ensureDirectoryTree(base: string, components: string[]): Promise<string> {
  let current = base
  for (const component of components) {
    current = join(current, component)
    const status = await inspectPath(current)
    if (status) {
      assertDirectory(status, current)
      await syncDirectory(dirname(current))
      continue
    }
    try {
      await mkdir(current)
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
      const raced = await inspectPath(current)
      if (!raced) throw error
      assertDirectory(raced, current)
    }
    await syncDirectory(dirname(current))
  }
  return current
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

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
