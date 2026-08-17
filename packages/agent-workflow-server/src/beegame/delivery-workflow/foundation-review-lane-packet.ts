import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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

const priorConflictStatusSchema = z
  .object({
    id: z.string().regex(/^B[1-9][0-9]*$/u),
    status: z.enum(['closed', 'open']),
    note: z.string().trim().min(1).max(1_200),
  })
  .strict()

const basePacketSchema = z.object({
    version: z.literal(1),
    scope: z.literal('foundation'),
    revision: digestSchema,
    lane: laneSchema,
    candidates: z.array(candidateSchema).max(8),
  })

export const foundationReviewLanePacketSchema = z.discriminatedUnion('mode', [
  basePacketSchema.extend({ mode: z.literal('initial') }).strict(),
  basePacketSchema
    .extend({
      mode: z.literal('verification'),
      priorReviewDigest: digestSchema,
      priorConflictStatus: z.array(priorConflictStatusSchema).max(64),
    })
    .strict(),
])

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
  mode: 'initial' | 'verification'
  priorReviewDigest?: string
  priorConflictIds?: string[]
}): string {
  digestSchema.parse(input.revision)
  laneSchema.parse(input.laneId)
  if (input.mode === 'verification') {
    digestSchema.parse(input.priorReviewDigest)
    if (!input.priorConflictIds) throw new Error('verification packet requires prior conflicts')
  }
  const shape = JSON.stringify({
    version: 1,
    scope: 'foundation',
    revision: input.revision,
    lane: input.laneId,
    mode: input.mode,
    ...(input.mode === 'verification'
      ? {
          priorReviewDigest: input.priorReviewDigest,
          priorConflictStatus: (input.priorConflictIds ?? []).map(id => ({
            id,
            status: '<closed-or-open>',
            note: '<specific verification observation>',
          })),
        }
      : {}),
    candidates: [
      {
        title: '<specific blocking defect>',
        problem: '<why the contract cannot be implemented or verified>',
        evidence: [
          {
            path: '<assigned full document or projected source path>',
            location: '<heading, table row or stable locator>',
            observed: '<bounded observation derived from accepted source bytes>',
          },
        ],
        blockingReason: '<specific incompatible result or missing acceptance proof>',
      },
    ],
  })
  return [
    LANE_FOCUS[input.laneId],
    `Return exactly one JSON object with this exact shape and fixed identity: ${shape}`,
    `The object may contain only the fields shown in the shape. Each candidate may contain only title, problem, evidence and blockingReason. Each evidence item may contain only path, location and observed. Every evidence path must be one of these exact project-relative canonical paths: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}. Never write an absolute path. Report only the 8 highest-priority proven blockers; candidates may be empty when no blocking defect is proven.`,
    ...(input.mode === 'verification'
      ? [
          `Account for exactly these prior conflict IDs, in this order, and no others: ${(input.priorConflictIds ?? []).join(', ') || '<none>'}. A closed item is fixed in every assigned document; an open item remains a blocking candidate with evidence.`,
        ]
      : []),
    'Read the assigned full documents and the one assigned projection only. Do not inspect other canonical documents, .beegame workflow state or Bee Game Studio source code. Submit the object once through StructuredOutput. Do not emit prose, decide the final verdict, propose replacement text, modify source documents or launch another Agent or task.',
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

function normalizeEvidencePath(workspacePath: string, value: unknown): unknown {
  if (typeof value !== 'string' || !isAbsolute(value)) return value
  const projectRelative = relative(resolve(workspacePath), resolve(value))
    .split('\\')
    .join('/')
  return CANONICAL_FOUNDATION_DOCUMENTS.includes(
    projectRelative as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
  )
    ? projectRelative
    : value
}

function normalizePacketEvidencePaths(
  workspacePath: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const packet = value as Record<string, unknown>
  if (!Array.isArray(packet.candidates)) return value
  return {
    ...packet,
    candidates: packet.candidates.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        return candidate
      const record = candidate as Record<string, unknown>
      if (!Array.isArray(record.evidence)) return candidate
      return {
        ...record,
        evidence: record.evidence.map(evidence => {
          if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
            return evidence
          const item = evidence as Record<string, unknown>
          return {
            ...item,
            path: normalizeEvidencePath(workspacePath, item.path),
          }
        }),
      }
    }),
  }
}

async function readPacket(path: string, workspacePath: string): Promise<{
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
  const packet = foundationReviewLanePacketSchema.parse(
    normalizePacketEvidencePaths(workspacePath, value),
  )
  return {
    bytes: Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8'),
    packet,
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
  for (const candidate of input.packet.candidates) {
    for (const evidence of candidate.evidence) {
      if (
        !ownedPaths.has(evidence.path) &&
        !projectedByPath.has(evidence.path)
      )
        throw new Error('foundation review evidence path is outside lane authority')
    }
  }
}

function assertVerificationAuthority(input: {
  packet: FoundationReviewLanePacket
  mode: 'initial' | 'verification'
  priorReviewDigest?: string
  priorConflictIds?: string[]
}): void {
  if (input.packet.mode !== input.mode)
    throw new Error('foundation review lane packet mode does not match')
  if (input.mode === 'initial') return
  if (input.packet.mode !== 'verification') throw new Error('verification packet is invalid')
  if (input.packet.priorReviewDigest !== input.priorReviewDigest)
    throw new Error('foundation review lane packet prior digest does not match')
  const actual = input.packet.priorConflictStatus.map(item => item.id)
  const expected = input.priorConflictIds ?? []
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  )
    throw new Error('foundation review lane packet prior conflict coverage does not match')
}

export async function acceptFoundationReviewLanePacket(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  laneId: FoundationDocumentLaneId
  projectionDigest: string
  mode: 'initial' | 'verification'
  priorReviewDigest?: string
  priorConflictIds?: string[]
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
  const accepted = await readPacket(stagedPath, input.workspacePath)
  if (accepted.packet.revision !== input.revision)
    throw new Error('foundation review lane packet revision does not match')
  if (accepted.packet.lane !== input.laneId)
    throw new Error('foundation review lane packet lane does not match')
  assertVerificationAuthority({
    packet: accepted.packet,
    mode: input.mode,
    priorReviewDigest: input.priorReviewDigest,
    priorConflictIds: input.priorConflictIds,
  })
  await assertEvidenceAuthority({
    workspacePath: input.workspacePath,
    revision: input.revision,
    laneId: input.laneId,
    projectionDigest: input.projectionDigest,
    packet: accepted.packet,
  })

  await writeFile(stagedPath, accepted.bytes)

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
