import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  gameIrCommittedPath,
  gameIrRevisionPath,
  parseGameIrReadyReceipt,
  type GameIrCompileRequest,
  type GameIrReadyReceipt,
} from './core/contracts'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
} from './core/model'

export type DirectPublicationAuthority = Readonly<{
  workspacePath: string
  publicationId: string
  request: GameIrCompileRequest
  candidate: GameIrCandidate
}>

function bytes(value: unknown): string { return `${canonicalGameIrJson(value)}\n` }
function safePath(workspacePath: string, relative: string): string {
  const root = resolve(workspacePath), target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error('Game IR publication path escapes workspace')
  return target
}
async function write(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes(value), { flag: 'wx', mode: 0o600 })
}
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function artifacts(authority: DirectPublicationAuthority, legacy = false) {
  const candidate = parseGameIrCandidate(authority.candidate, { request: authority.request })
  const candidateDigest = digestGameIrValue(candidate)
  const manifest = {
    schemaVersion: 'game-ir-manifest.v2',
    taskId: candidate.taskId,
    publicationId: authority.publicationId,
    gameIrSchemaVersion: 'game-ir.v2',
    sourceRevision: candidate.sourceRevision,
    sourceInputDigest: authority.request.foundation.receiptDigest,
    candidateDigest,
  }
  const ready = parseGameIrReadyReceipt({
    schemaVersion: 'game-ir-ready-receipt.v2',
    taskId: candidate.taskId,
    publicationId: authority.publicationId,
    gameIrSchemaVersion: 'game-ir.v2',
    foundationRevision: candidate.sourceRevision,
    foundationReceiptDigest: authority.request.foundation.receiptDigest,
    candidateDigest,
    manifestDigest: digestGameIrValue(manifest),
    committedPath: gameIrCommittedPath(candidate.sourceRevision, legacy ? undefined : authority.publicationId),
  })
  return { candidate, manifest, ready }
}

export async function validateDirectGameIrPublication(
  authority: DirectPublicationAuthority,
): Promise<Readonly<{ ready: GameIrReadyReceipt; candidate: GameIrCandidate }>> {
  let root = safePath(authority.workspacePath,
    gameIrRevisionPath(authority.request.foundation.foundationRevision, authority.publicationId))
  let committed: GameIrReadyReceipt
  let legacy = false
  try { committed = parseGameIrReadyReceipt(await readJson(join(root, 'COMMITTED.json'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    root = safePath(authority.workspacePath, gameIrRevisionPath(authority.request.foundation.foundationRevision))
    committed = parseGameIrReadyReceipt(await readJson(join(root, 'COMMITTED.json')))
    // A different legacy publication is not this revision.
    if (committed.publicationId !== authority.publicationId)
      throw Object.assign(new Error('Game IR publication not found'), { code: 'ENOENT' })
    legacy = true
  }
  const expected = artifacts(authority, legacy)
  const candidate = parseGameIrCandidate(await readJson(join(root, 'game-ir.json')),
    { request: authority.request })
  const manifest = await readJson(join(root, 'manifest.json'))
  if (canonicalGameIrJson(committed) !== canonicalGameIrJson(expected.ready))
    throw new Error('Game IR committed receipt changed')
  if (digestGameIrValue(candidate) !== committed.candidateDigest ||
      canonicalGameIrJson(candidate) !== canonicalGameIrJson(expected.candidate))
    throw new Error('Game IR candidate changed')
  if (digestGameIrValue(manifest) !== committed.manifestDigest ||
      canonicalGameIrJson(manifest) !== canonicalGameIrJson(expected.manifest))
    throw new Error('Game IR manifest changed')
  return Object.freeze({ ready: committed, candidate })
}

export async function commitDirectGameIrPublication(
  authority: DirectPublicationAuthority,
): Promise<GameIrReadyReceipt> {
  const built = artifacts(authority)
  const final = safePath(authority.workspacePath,
    gameIrRevisionPath(built.ready.foundationRevision, authority.publicationId))
  try {
    return (await validateDirectGameIrPublication(authority)).ready
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staging = safePath(authority.workspacePath,
    `.beegame/.game-ir-private/direct-v2-${authority.publicationId}-${randomUUID()}`)
  await mkdir(dirname(staging), { recursive: true })
  await mkdir(staging, { recursive: false })
  try {
    await write(join(staging, 'game-ir.json'), built.candidate)
    await write(join(staging, 'manifest.json'), built.manifest)
    await write(join(staging, 'COMMITTED.json'), built.ready)
    await mkdir(dirname(final), { recursive: true })
    await rename(staging, final)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' &&
        (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
  }
  return (await validateDirectGameIrPublication(authority)).ready
}
