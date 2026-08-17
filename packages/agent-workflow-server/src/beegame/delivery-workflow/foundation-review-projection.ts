import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import { projectFoundationAuthority } from '../foundation-authority-projection'
import {
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const laneSchema = z.enum(['core-design', 'technical-assets', 'presentation'])
const pathSchema = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const sourceSchema = z
  .object({
    path: pathSchema,
    sectionId: z.string().min(1),
    startLine: z.number().int().positive(),
    lineCount: z.number().int().positive(),
    content: z.string().min(1),
    digest: digestSchema,
  })
  .strict()

const projectionDescriptorSchema = z
  .object({
    path: z.string().min(1),
    digest: digestSchema,
    byteLength: z.number().int().positive(),
  })
  .strict()

export const foundationReviewProjectionSchema = z
  .object({
    version: z.literal(1),
    revision: digestSchema,
    lane: laneSchema,
    sources: z.array(sourceSchema),
  })
  .strict()

export type FoundationReviewProjection = z.infer<
  typeof foundationReviewProjectionSchema
>

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function projectionPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  digestSchema.parse(revision)
  laneSchema.parse(laneId)
  return resolve(
    workspacePath,
    '.beegame',
    'reviews',
    'foundation',
    revision,
    'projections',
    `${laneId}.json`,
  )
}

function stagingProjectionPath(
  workspacePath: string,
  revision: string,
  laneId: FoundationDocumentLaneId,
): string {
  return resolve(
    workspacePath,
    '.beegame',
    'reviews',
    'foundation',
    revision,
    '.staging',
    'projections',
    `${laneId}.json`,
  )
}

function canonicalBytes(projection: FoundationReviewProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function buildProjection(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
}): Promise<FoundationReviewProjection> {
  digestSchema.parse(input.revision)
  const lane = foundationDocumentLaneById(input.laneId)
  const documents = new Map<FoundationDocumentPath, string>()
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
    documents.set(
      path,
      await readFile(resolve(input.workspacePath, path), 'utf8'),
    )
  const owned = new Set(lane.ownedPaths)
  const selected = new Map<
    string,
    FoundationReviewProjection['sources'][number]
  >()
  for (const targetPath of lane.ownedPaths) {
    const projection = projectFoundationAuthority({ targetPath, documents })
    for (const source of projection.sources) {
      if (owned.has(source.path)) continue
      for (const section of source.sections) {
        const key = `${source.path}#${section.sectionId}`
        selected.set(key, {
          path: source.path,
          sectionId: section.sectionId,
          startLine: section.startLine,
          lineCount: section.lineCount,
          content: section.content,
          digest: section.digest,
        })
      }
    }
  }
  const sources = [...selected.entries()]
    .sort(([left], [right]) => bytewise(left, right))
    .map(([, source]) => source)
  return foundationReviewProjectionSchema.parse({
    version: 1,
    revision: input.revision,
    lane: input.laneId,
    sources,
  })
}

export async function writeFoundationReviewProjection(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
}): Promise<{ path: string; digest: string; byteLength: number }> {
  const projection = await buildProjection(input)
  const bytes = canonicalBytes(projection)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const committed = projectionPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  if (!(await isFile(committed))) {
    const staging = stagingProjectionPath(
      input.workspacePath,
      input.revision,
      input.laneId,
    )
    await mkdir(dirname(staging), { recursive: true })
    await writeFile(staging, bytes, 'utf8')
    const stagedFile = await open(staging, 'r')
    try {
      await stagedFile.sync()
    } finally {
      await stagedFile.close()
    }
    await mkdir(dirname(committed), { recursive: true })
    await rename(staging, committed)
    const directory = await open(dirname(committed), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } else {
    const existing = await readFile(committed)
    if (createHash('sha256').update(existing).digest('hex') !== digest)
      throw new Error(
        'foundation review projection already exists with different bytes',
      )
  }
  return {
    path: relative(resolve(input.workspacePath), committed)
      .split('\\')
      .join('/'),
    digest,
    byteLength: Buffer.byteLength(bytes),
  }
}

export async function readFoundationReviewProjection(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
  expectedDigest: string
}): Promise<{
  path: string
  digest: string
  byteLength: number
  projection: FoundationReviewProjection
}> {
  digestSchema.parse(input.expectedDigest)
  const absolute = projectionPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  let bytes: Buffer
  try {
    if (!(await isFile(absolute)))
      throw new Error('foundation review projection is unavailable')
    bytes = await readFile(absolute)
  } catch (error) {
    if (
      (error as Error).message === 'foundation review projection is unavailable'
    )
      throw error
    throw new Error('foundation review projection is unavailable')
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== input.expectedDigest)
    throw new Error('foundation review projection digest changed')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('foundation review projection is invalid')
  }
  const projection = foundationReviewProjectionSchema.parse(value)
  if (
    projection.revision !== input.revision ||
    projection.lane !== input.laneId
  )
    throw new Error('foundation review projection identity changed')
  for (const source of projection.sources) {
    const contract = getGameDocumentContract(source.path)
    if (
      !contract.sections.some(section => section.sectionId === source.sectionId)
    )
      throw new Error('foundation review projection source contract changed')
    if (
      createHash('sha256').update(source.content).digest('hex') !==
      source.digest
    )
      throw new Error('foundation review projection source digest changed')
  }
  return {
    path: relative(resolve(input.workspacePath), absolute)
      .split('\\')
      .join('/'),
    digest,
    byteLength: bytes.byteLength,
    projection,
  }
}

export async function readFoundationReviewProjectionAuthority(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
  descriptor: unknown
}): Promise<{
  path: string
  digest: string
  byteLength: number
  projection: FoundationReviewProjection
  allowedEvidencePaths: FoundationDocumentPath[]
}> {
  const descriptor = projectionDescriptorSchema.parse(input.descriptor)
  const expectedPath = relative(
    resolve(input.workspacePath),
    projectionPath(input.workspacePath, input.revision, input.laneId),
  )
    .split('\\')
    .join('/')
  if (descriptor.path !== expectedPath)
    throw new Error('foundation review projection path is not canonical')
  const validated = await readFoundationReviewProjection({
    workspacePath: input.workspacePath,
    revision: input.revision,
    laneId: input.laneId,
    expectedDigest: descriptor.digest,
  })
  if (validated.path !== descriptor.path)
    throw new Error('foundation review projection path changed')
  if (validated.byteLength !== descriptor.byteLength)
    throw new Error('foundation review projection byte length changed')
  return {
    ...validated,
    allowedEvidencePaths: [
      ...new Set(validated.projection.sources.map(source => source.path)),
    ],
  }
}
