import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const specialistRoleSchema = z.enum([
  'contract-specialist',
  'integration-specialist',
])
const foundationPathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)

const evidenceSchema = z
  .object({
    path: foundationPathSchema,
    location: z.string().trim().min(1).max(300),
    observed: z.string().trim().min(1).max(1_200),
  })
  .strict()

const candidateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    problem: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceSchema).min(1).max(32),
    blockingReason: z.string().trim().min(1).max(1_200),
  })
  .strict()

export const foundationReviewEvidenceSchema = z
  .object({
    version: z.literal(1),
    scope: z.literal('foundation'),
    revision: digestSchema,
    role: specialistRoleSchema,
    candidates: z.array(candidateSchema).max(32),
  })
  .strict()

export type FoundationReviewSpecialistRole = z.infer<
  typeof specialistRoleSchema
>
export type FoundationReviewEvidencePacket = z.infer<
  typeof foundationReviewEvidenceSchema
>

function assertDigest(value: string): void {
  digestSchema.parse(value)
}

function assertRole(value: FoundationReviewSpecialistRole): void {
  specialistRoleSchema.parse(value)
}

function reviewDirectory(workspacePath: string, revision: string): string {
  assertDigest(revision)
  return resolve(
    workspacePath,
    '.beegame',
    'reviews',
    'foundation',
    revision,
  )
}

export function foundationReviewEvidencePath(
  workspacePath: string,
  revision: string,
  role: FoundationReviewSpecialistRole,
): string {
  assertRole(role)
  return resolve(reviewDirectory(workspacePath, revision), 'evidence', `${role}.json`)
}

export function foundationReviewEvidenceStagingPath(
  workspacePath: string,
  revision: string,
  role: FoundationReviewSpecialistRole,
): string {
  assertRole(role)
  return resolve(
    reviewDirectory(workspacePath, revision),
    '.staging',
    'evidence',
    `${role}.json`,
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readPacket(path: string): Promise<{
  bytes: Buffer
  packet: FoundationReviewEvidencePacket
}> {
  const file = await lstat(path)
  if (!file.isFile())
    throw new Error('foundation review evidence is not a regular file')
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('foundation review evidence is not valid UTF-8')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('foundation review evidence is not valid JSON')
  }
  return {
    bytes,
    packet: foundationReviewEvidenceSchema.parse(value),
  }
}

export async function acceptFoundationReviewEvidence(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  role: FoundationReviewSpecialistRole
}): Promise<{
  path: string
  digest: string
  packet: FoundationReviewEvidencePacket
}> {
  assertDigest(input.revision)
  assertDigest(input.currentRevision)
  assertRole(input.role)
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')

  const stagedPath = foundationReviewEvidenceStagingPath(
    input.workspacePath,
    input.revision,
    input.role,
  )
  const committedPath = foundationReviewEvidencePath(
    input.workspacePath,
    input.revision,
    input.role,
  )
  if (await exists(committedPath))
    throw new Error('foundation review evidence is already committed')

  const accepted = await readPacket(stagedPath)
  if (accepted.packet.revision !== input.revision)
    throw new Error('foundation review evidence revision does not match')
  if (accepted.packet.role !== input.role)
    throw new Error('foundation review evidence role does not match')

  const stagedFile = await open(stagedPath, 'r')
  try {
    await stagedFile.sync()
  } finally {
    await stagedFile.close()
  }
  await mkdir(dirname(committedPath), { recursive: true })
  await rename(stagedPath, committedPath)
  const directory = await open(dirname(committedPath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }

  return {
    path: relative(resolve(input.workspacePath), committedPath)
      .split('\\')
      .join('/'),
    digest: createHash('sha256').update(accepted.bytes).digest('hex'),
    packet: accepted.packet,
  }
}
