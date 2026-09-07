import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { lstat, mkdir, open, link, unlink } from 'node:fs/promises'
import { parseRevisionCandidateResult, type RevisionCandidateResult } from './candidate-result'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const MAX_RESULT_BYTES = 32 * 1024 * 1024
const relativeResultsRoot = '.beegame/workflow/foundation-revision/results'

async function assertDirectories(path: string): Promise<void> {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const entry = await lstat(cursor)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Revision publication parent must be a real directory')
    cursor = dirname(cursor)
  }
}

async function workspaceRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Revision publication workspace must be absolute')
  const workspace = resolve(path)
  await assertDirectories(workspace)
  return workspace
}

async function ensureResultDirectory(workspace: string, root: string): Promise<void> {
  await assertDirectories(workspace)
  let cursor = workspace
  for (const segment of relative(workspace, root).split('/')) {
    cursor = join(cursor, segment)
    try { await mkdir(cursor, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await assertDirectories(cursor)
    const parent = await open(dirname(cursor), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
  }
}

async function readJson(path: string): Promise<unknown> {
  await assertDirectories(dirname(path))
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_RESULT_BYTES) throw new Error('Revision publication file has invalid size or kind')
    return JSON.parse(await file.readFile('utf8'))
  } finally { await file.close() }
}

async function publishJson(path: string, value: unknown): Promise<void> {
  const body = revisionCanonicalJson(value) + '\n'
  if (Buffer.byteLength(body) > MAX_RESULT_BYTES) throw new Error('Revision publication file is too large')
  await assertDirectories(dirname(path))
  const temporary = join(dirname(path), `.pending-${randomUUID()}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    try { await file.writeFile(body); await file.sync() } finally { await file.close() }
    await assertDirectories(dirname(path))
    try { await link(temporary, path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (revisionCanonicalJson(await readJson(path)) !== revisionCanonicalJson(value))
        throw new Error('Revision immutable publication conflict')
    }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary) }
}

function capture(value: unknown): RevisionCandidateResult {
  // Caller is the private state owner. Its expected result must already be
  // derived from accepted source/worker evidence, not a public submitted claim.
  const copy = JSON.parse(revisionCanonicalJson(value)) as RevisionCandidateResult
  return parseRevisionCandidateResult(copy, { ownerId: copy.ownerId, projectId: copy.projectId,
    resultId: copy.resultId, resultDigest: revisionDigest(copy) })
}

function marker(result: RevisionCandidateResult) {
  return { protocolVersion: 1, producer: 'foundation-revision', resultId: result.resultId,
    ownerId: result.ownerId, projectId: result.projectId, candidateId: result.candidateId,
    resultDigest: revisionDigest(result), documentSetDigest: result.documentSetDigest }
}

/** Private commit sink. It writes only a self-contained candidate in its own namespace. */
export async function publishRevisionDerivedCandidate(workspacePath: string, value: unknown) {
  const result = capture(value)
  // Fail before creating directories when the complete result cannot be stored.
  if (Buffer.byteLength(revisionCanonicalJson(result) + '\n') > MAX_RESULT_BYTES)
    throw new Error('Revision publication file is too large')
  const workspace = await workspaceRoot(workspacePath)
  const relativeRoot = `${relativeResultsRoot}/${result.resultId}`
  const root = join(workspace, relativeRoot)
  await ensureResultDirectory(workspace, root)
  await publishJson(join(root, 'result.json'), result)
  await publishJson(join(root, 'COMMITTED.json'), marker(result))
  if (!await readRevisionPublishedCandidate(workspace, result)) throw new Error('Revision publication marker disappeared')
  return { result, artifactPath: `${relativeRoot}/result.json`, commitPath: `${relativeRoot}/COMMITTED.json` }
}

/** Expected result comes from the owner's immutable input and accepted execution evidence. */
export async function readRevisionPublishedCandidate(workspacePath: string, value: unknown): Promise<RevisionCandidateResult | undefined> {
  const expected = capture(value)
  const workspace = await workspaceRoot(workspacePath)
  const root = join(workspace, relativeResultsRoot, expected.resultId)
  const commitPath = join(root, 'COMMITTED.json')
  try {
    const committed = await readJson(commitPath)
    if (revisionCanonicalJson(committed) !== revisionCanonicalJson(marker(expected)))
      throw new Error('Revision publication marker binding mismatch')
    const result = await readJson(join(root, 'result.json'))
    if (revisionCanonicalJson(result) !== revisionCanonicalJson(expected))
      throw new Error('Revision published candidate binding mismatch')
    return expected
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try { await lstat(commitPath) } catch (markerError) {
      if ((markerError as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw markerError
    }
    throw new Error('committed Revision publication is incomplete')
  }
}
