import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import { readFoundationReviewProjection } from './foundation-review-projection'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const laneSchema = z.enum(['core-design', 'technical-assets', 'presentation'])
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

export const foundationReviewLanePacketSchema = z
  .object({
    version: z.literal(1),
    scope: z.literal('foundation'),
    revision: digestSchema,
    lane: laneSchema,
    candidates: z.array(candidateSchema).max(24),
  })
  .strict()

export type FoundationReviewLanePacket = z.infer<
  typeof foundationReviewLanePacketSchema
>

const LANE_FOCUS: Record<FoundationDocumentLaneId, string> = {
  'core-design':
    'Review only game rules, progression, level structure and balance authority for blocking implementation or verification defects.',
  'technical-assets':
    'Review only runtime architecture, production feasibility and asset responsibilities for blocking implementation or verification defects.',
  presentation:
    'Review only art, UI/UX and audio experience contracts for blocking implementation or verification defects.',
}

export function foundationReviewLanePacketContractInstruction(input: {
  revision: string
  laneId: FoundationDocumentLaneId
}): string {
  digestSchema.parse(input.revision)
  laneSchema.parse(input.laneId)
  const shape = JSON.stringify({
    version: 1,
    scope: 'foundation',
    revision: input.revision,
    lane: input.laneId,
    candidates: [
      {
        title: '<specific blocking defect>',
        problem: '<why the contract cannot be implemented or verified>',
        evidence: [
          {
            path: '<assigned full document or projected source path>',
            location: '<heading, table row or stable locator>',
            observed: '<bounded exact observation from accepted source bytes>',
          },
        ],
        blockingReason: '<specific incompatible result or missing acceptance proof>',
      },
    ],
  })
  return [
    LANE_FOCUS[input.laneId],
    `Write exactly one JSON object with this exact shape and fixed identity: ${shape}`,
    'The object may contain only version, scope, revision, lane and candidates. Each candidate may contain only title, problem, evidence and blockingReason. Each evidence item may contain only path, location and observed. Use at most 24 candidates; candidates may be empty when no blocking defect is proven.',
    'Read the assigned full documents and the one assigned projection only. Do not inspect other canonical documents, .beegame workflow state or Bee Game Studio source code. Write the JSON object once to the sole staging output path. Do not emit prose, decide the final verdict, propose replacement text, modify source documents or launch another Agent or task.',
  ].join(' ')
}

function reviewDirectory(workspacePath: string, revision: string): string {
  digestSchema.parse(revision)
  return resolve(
    workspacePath,
    '.beegame',
    'reviews',
    'foundation',
    revision,
  )
}

export function foundationReviewLanePacketPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  laneSchema.parse(laneId)
  return resolve(reviewDirectory(workspacePath, revision), 'parts', `${laneId}.json`)
}

export function foundationReviewLanePacketStagingPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  laneSchema.parse(laneId)
  return resolve(
    reviewDirectory(workspacePath, revision),
    '.staging',
    'parts',
    `${laneId}.json`,
  )
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readPacket(path: string): Promise<{
  bytes: Buffer
  packet: FoundationReviewLanePacket
}> {
  if (!(await isFile(path)))
    throw new Error('foundation review lane packet is not a regular file')
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('foundation review lane packet is not valid UTF-8')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('foundation review lane packet is not valid JSON')
  }
  return {
    bytes,
    packet: foundationReviewLanePacketSchema.parse(value),
  }
}

async function assertEvidenceAuthority(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
  projectionDigest: string
  packet: FoundationReviewLanePacket
}): Promise<void> {
  const lane = foundationDocumentLaneById(input.laneId)
  const ownedPaths = new Set(lane.ownedPaths)
  const projection = await readFoundationReviewProjection({
    workspacePath: input.workspacePath,
    revision: input.revision,
    laneId: input.laneId,
    expectedDigest: input.projectionDigest,
  })
  const projectedByPath = new Map<string, string[]>()
  for (const source of projection.projection.sources) {
    const contents = projectedByPath.get(source.path) ?? []
    contents.push(source.content)
    projectedByPath.set(source.path, contents)
  }
  const ownedBytes = new Map<string, string>()
  for (const path of lane.ownedPaths)
    ownedBytes.set(path, await readFile(resolve(input.workspacePath, path), 'utf8'))

  for (const candidate of input.packet.candidates) {
    for (const evidence of candidate.evidence) {
      const acceptedBytes = ownedPaths.has(evidence.path)
        ? [ownedBytes.get(evidence.path)!]
        : projectedByPath.get(evidence.path)
      if (!acceptedBytes)
        throw new Error('foundation review evidence path is outside lane authority')
      if (!acceptedBytes.some(bytes => bytes.includes(evidence.observed)))
        throw new Error(
          'foundation review evidence is absent from accepted source bytes',
        )
    }
  }
}

export async function acceptFoundationReviewLanePacket(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  laneId: FoundationDocumentLaneId
  projectionDigest: string
}): Promise<{
  path: string
  digest: string
  packet: FoundationReviewLanePacket
}> {
  digestSchema.parse(input.revision)
  digestSchema.parse(input.currentRevision)
  digestSchema.parse(input.projectionDigest)
  laneSchema.parse(input.laneId)
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')

  const committedPath = foundationReviewLanePacketPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  if (await isFile(committedPath))
    throw new Error('foundation review lane packet is already committed')
  const stagedPath = foundationReviewLanePacketStagingPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  const accepted = await readPacket(stagedPath)
  if (accepted.packet.revision !== input.revision)
    throw new Error('foundation review lane packet revision does not match')
  if (accepted.packet.lane !== input.laneId)
    throw new Error('foundation review lane packet lane does not match')
  await assertEvidenceAuthority({
    workspacePath: input.workspacePath,
    revision: input.revision,
    laneId: input.laneId,
    projectionDigest: input.projectionDigest,
    packet: accepted.packet,
  })

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
