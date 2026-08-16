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

const SPECIALIST_FOCUS: Record<FoundationReviewSpecialistRole, string> = {
  'contract-specialist':
    'Review authority, enumeration, cardinality, state and outcome totality, arithmetic, units, formulas, budgets, duplicate facts and owner-to-consumer references.',
  'integration-specialist':
    'Review runtime and production closure, asset ownership, art, UI, audio and accessibility mappings, unresolved assumptions, external dependencies and implementer usability.',
}

export function foundationReviewEvidenceContractInstruction(input: {
  revision: string
  role: FoundationReviewSpecialistRole
}): string {
  assertRole(input.role)
  const shape = JSON.stringify({
    version: 1,
    scope: 'foundation',
    revision: input.revision,
    role: input.role,
    candidates: [
      {
        title: '<specific defect>',
        problem: '<why the delivered contract is not implementable or verifiable>',
        evidence: [
          {
            path: '<assigned canonical relative path>',
            location: '<heading, table row or stable locator>',
            observed: '<bounded exact observation from source bytes>',
          },
        ],
        blockingReason: '<specific incompatible outcome or missing acceptance proof>',
      },
    ],
  })
  return [
    SPECIALIST_FOCUS[input.role],
    `Write exactly one JSON object with this exact shape and fixed identity: ${shape}`,
    'The object may contain only version, scope, revision, role and candidates. Each candidate may contain only title, problem, evidence and blockingReason. Each evidence item may contain only path, location and observed. Use at most 32 candidates; candidates may be empty when no defect is proven.',
    'Read only the assigned canonical source paths. Do not inspect .beegame workflow state or Bee Game Studio source code, and do not search for or infer the protocol. Write the JSON object once to the sole staging output path. Do not emit prose, modify source documents, decide the final verdict or launch another Agent or task.',
  ].join(' ')
}

function assertDigest(value: string): void {
  digestSchema.parse(value)
}

function assertRole(value: FoundationReviewSpecialistRole): void {
  specialistRoleSchema.parse(value)
}

function roleFileName(role: FoundationReviewSpecialistRole): string {
  return role === 'contract-specialist' ? 'contract.json' : 'integration.json'
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
  return resolve(
    reviewDirectory(workspacePath, revision),
    'parts',
    roleFileName(role),
  )
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
    'parts',
    roleFileName(role),
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
