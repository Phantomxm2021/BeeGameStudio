import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import {
  FOUNDATION_DOCUMENT_LANES,
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import { assembleFoundationReview } from './foundation-review-assembly'
import {
  parseFoundationReviewLaneMarkdown,
  parseFoundationReviewSelectionMarkdown,
  type FoundationReviewLaneReceipt,
  type FoundationReviewSelection,
} from './foundation-review-markdown'
import {
  readFoundationReviewProjection,
  writeFoundationReviewProjection,
} from './foundation-review-projection'
import {
  commitAssembledFoundationReview,
  foundationReviewLaneReceiptPath,
  foundationReviewLaneReceiptStagingPath,
  foundationReviewSelectionPath,
  foundationReviewSelectionStagingPath,
} from './foundation-review'
import {
  assertFoundationReviewState,
  type FoundationReviewRole,
  type FoundationReviewState,
} from './foundation-review-state'
import { foundationReviewWorkerTerminalSchema } from './worker-contracts'

const digestPattern = /^[a-f0-9]{64}$/u
const laneIds = new Set<FoundationReviewRole>(
  FOUNDATION_DOCUMENT_LANES.map(lane => lane.id),
)

function isLaneRole(role: FoundationReviewRole): role is FoundationDocumentLaneId {
  return laneIds.has(role)
}

export type FoundationReviewAssignment = {
  scope: 'foundation'
  role: FoundationReviewRole
  sourcePaths: string[]
  stagingOutputPaths: [string]
  committedOutputPaths: [string]
}

export type FoundationReviewDispatch = {
  idempotencyKey: string
  taskId: string
  role: FoundationReviewRole
  assignment: FoundationReviewAssignment
  contract: {
    reviewScope: 'foundation'
    reviewMode: 'initial'
    reviewRole: FoundationReviewRole
    assignment: FoundationReviewAssignment
    confirmedBriefDigest: string
    packetDigests: Partial<Record<FoundationDocumentLaneId, string>>
    projection?: { path: string; digest: string; byteLength: number }
    candidateReferences?: string[]
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function projectRelativePath(workspacePath: string, path: string): string {
  return relative(resolve(workspacePath), path).split('\\').join('/')
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function atomicCommitReceipt(input: {
  stagingPath: string
  committedPath: string
  bytes: Buffer
}): Promise<void> {
  await mkdir(dirname(input.committedPath), { recursive: true })
  const temporaryPath = `${input.committedPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const receiptFile = await open(temporaryPath, 'wx')
    try {
      await receiptFile.writeFile(input.bytes)
      await receiptFile.sync()
    } finally {
      await receiptFile.close()
    }
    try {
      await link(temporaryPath, input.committedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await readFile(input.committedPath)
      if (!existing.equals(input.bytes))
        throw new Error(
          'foundation review Markdown receipt already exists with different bytes',
        )
    }
    await rm(temporaryPath)
    const directory = await open(dirname(input.committedPath), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
  await rm(input.stagingPath, { force: true }).catch(() => undefined)
}

async function readLaneReceipt(input: {
  state: FoundationReviewState
  workspacePath: string
  laneId: FoundationDocumentLaneId
}): Promise<FoundationReviewLaneReceipt> {
  const report = input.state.reports.find(
    candidate => candidate.role === input.laneId,
  )
  if (report?.status !== 'completed' || !report.digest)
    throw new Error('foundation synthesis requires completed lane receipts')
  const projection = await writeFoundationReviewProjection({
    workspacePath: input.workspacePath,
    revision: input.state.revision,
    laneId: input.laneId,
  })
  const validatedProjection = await readFoundationReviewProjection({
    workspacePath: input.workspacePath,
    revision: input.state.revision,
    laneId: input.laneId,
    expectedDigest: projection.digest,
  })
  const path = foundationReviewLaneReceiptPath(
    input.workspacePath,
    input.state.revision,
    input.laneId,
  )
  if (!(await isRegularFile(path)))
    throw new Error('foundation review lane receipt is unavailable')
  const bytes = await readFile(path)
  if (sha256(bytes) !== report.digest)
    throw new Error('foundation review lane receipt digest changed')
  return parseFoundationReviewLaneMarkdown(bytes.toString('utf8'), {
    revision: input.state.revision,
    lane: input.laneId,
    projectionDigest: projection.digest,
    allowedEvidencePaths: validatedProjection.projection.sources.map(
      source => source.path,
    ),
  })
}

async function readLaneReceipts(input: {
  state: FoundationReviewState
  workspacePath: string
}): Promise<FoundationReviewLaneReceipt[]> {
  const receipts: FoundationReviewLaneReceipt[] = []
  for (const lane of FOUNDATION_DOCUMENT_LANES)
    receipts.push(
      await readLaneReceipt({
        ...input,
        laneId: lane.id,
      }),
    )
  return receipts
}

function candidateReferences(
  receipts: readonly FoundationReviewLaneReceipt[],
): string[] {
  return receipts.flatMap(receipt =>
    receipt.candidates.map(candidate => candidate.reference),
  )
}

async function acceptLaneReceipt(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  laneId: FoundationDocumentLaneId
  projectionDigest: string
  allowedEvidencePaths: readonly string[]
}): Promise<{
  receipt: FoundationReviewLaneReceipt
  path: string
  digest: string
}> {
  if (input.revision !== input.currentRevision)
    throw new Error('canonical artifacts changed during foundation review')
  const stagingPath = foundationReviewLaneReceiptStagingPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  if (!(await isRegularFile(stagingPath)))
    throw new Error('foundation review lane receipt is unavailable')
  const bytes = await readFile(stagingPath)
  const receipt = parseFoundationReviewLaneMarkdown(bytes.toString('utf8'), {
    revision: input.revision,
    lane: input.laneId,
    projectionDigest: input.projectionDigest,
    allowedEvidencePaths: input.allowedEvidencePaths,
  })
  const committedPath = foundationReviewLaneReceiptPath(
    input.workspacePath,
    input.revision,
    input.laneId,
  )
  await atomicCommitReceipt({ stagingPath, committedPath, bytes })
  return {
    receipt,
    path: projectRelativePath(input.workspacePath, committedPath),
    digest: sha256(bytes),
  }
}

async function acceptSelectionReceipt(input: {
  workspacePath: string
  revision: string
  dispatchId: string
  candidateReferences: string[]
}): Promise<{
  selection: FoundationReviewSelection
  path: string
  digest: string
}> {
  const stagingPath = foundationReviewSelectionStagingPath(
    input.workspacePath,
    input.revision,
    input.dispatchId,
  )
  if (!(await isRegularFile(stagingPath)))
    throw new Error('foundation review selection receipt is unavailable')
  const bytes = await readFile(stagingPath)
  const selection = parseFoundationReviewSelectionMarkdown(
    bytes.toString('utf8'),
    {
      revision: input.revision,
      candidateReferences: input.candidateReferences,
    },
  )
  const committedPath = foundationReviewSelectionPath(
    input.workspacePath,
    input.revision,
  )
  await atomicCommitReceipt({ stagingPath, committedPath, bytes })
  return {
    selection,
    path: projectRelativePath(input.workspacePath, committedPath),
    digest: sha256(bytes),
  }
}

function reportIsDispatchable(
  state: FoundationReviewState,
  role: FoundationReviewRole,
): boolean {
  const report = state.reports.find(candidate => candidate.role === role)
  return report?.status === 'pending' && !report.dispatch
}

function pendingRoles(state: FoundationReviewState): FoundationReviewRole[] {
  const lanes = state.reports.slice(0, 3)
  if (
    lanes.every(report => report.status === 'completed' && report.digest) &&
    reportIsDispatchable(state, 'synthesis')
  )
    return ['synthesis']
  return lanes
    .filter(report => reportIsDispatchable(state, report.role))
    .map(report => report.role)
}

function completedPacketDigests(
  state: FoundationReviewState,
): Partial<Record<FoundationDocumentLaneId, string>> {
  return Object.fromEntries(
    state.reports.flatMap(report =>
      isLaneRole(report.role) && typeof report.digest === 'string'
        ? [[report.role, report.digest]]
        : [],
    ),
  ) as Partial<Record<FoundationDocumentLaneId, string>>
}

export async function buildFoundationReviewDispatches(input: {
  state: FoundationReviewState
  workspacePath: string
  confirmedBriefDigest: string
}): Promise<FoundationReviewDispatch[]> {
  const state = assertFoundationReviewState(input.state)
  if (!digestPattern.test(input.confirmedBriefDigest))
    throw new Error('foundation review confirmed brief digest is invalid')
  const roles = pendingRoles(state)
  const packetDigests = completedPacketDigests(state)
  const synthesisReceipts = roles.includes('synthesis')
    ? await readLaneReceipts({ state, workspacePath: input.workspacePath })
    : []
  const synthesisCandidateReferences = candidateReferences(synthesisReceipts)

  return Promise.all(
    roles.map(async role => {
      const taskId = `review:foundation:${role}:${state.attempt}`
      let projection: FoundationReviewDispatch['contract']['projection']
      let sourcePaths: string[]
      let stagingPath: string
      let committedPath: string
      if (isLaneRole(role)) {
        const lane = foundationDocumentLaneById(role)
        projection = await writeFoundationReviewProjection({
          workspacePath: input.workspacePath,
          revision: state.revision,
          laneId: role,
        })
        sourcePaths = [
          ...lane.ownedPaths.map(path => resolve(input.workspacePath, path)),
          resolve(input.workspacePath, projection.path),
        ]
        stagingPath = foundationReviewLaneReceiptStagingPath(
          input.workspacePath,
          state.revision,
          role,
        )
        committedPath = foundationReviewLaneReceiptPath(
          input.workspacePath,
          state.revision,
          role,
        )
      } else {
        sourcePaths = FOUNDATION_DOCUMENT_LANES.map(lane =>
          foundationReviewLaneReceiptPath(
            input.workspacePath,
            state.revision,
            lane.id,
          ),
        )
        stagingPath = foundationReviewSelectionStagingPath(
          input.workspacePath,
          state.revision,
          `foundation-initial-${state.attempt}-${role}`,
        )
        committedPath = foundationReviewSelectionPath(
          input.workspacePath,
          state.revision,
        )
      }
      const assignment: FoundationReviewAssignment = {
        scope: 'foundation',
        role,
        sourcePaths,
        stagingOutputPaths: [stagingPath],
        committedOutputPaths: [committedPath],
      }
      await rm(stagingPath, { force: true })
      return {
        idempotencyKey: taskId,
        taskId,
        role,
        assignment,
        contract: {
          reviewScope: 'foundation',
          reviewMode: 'initial',
          reviewRole: role,
          assignment,
          confirmedBriefDigest: input.confirmedBriefDigest,
          packetDigests,
          ...(projection ? { projection } : {}),
          ...(role === 'synthesis'
            ? { candidateReferences: synthesisCandidateReferences }
            : {}),
        },
      }
    }),
  )
}

export async function acceptFoundationReviewWorkerTerminal(input: {
  state: FoundationReviewState
  workspacePath: string
  currentRevision: string
  terminal: unknown
}): Promise<FoundationReviewState> {
  const state = assertFoundationReviewState(input.state)
  const terminal = foundationReviewWorkerTerminalSchema.parse(input.terminal)
  if (
    terminal.revision !== state.revision ||
    terminal.mode !== 'initial' ||
    terminal.revision !== input.currentRevision
  )
    throw new Error('canonical artifacts changed during foundation review')
  const report = state.reports.find(candidate => candidate.role === terminal.role)
  if (!report || terminal.reportPath !== report.path)
    throw new Error('foundation review terminal does not match its assigned role')
  if (report.status === 'completed')
    throw new Error('foundation review report is already completed')

  if (isLaneRole(terminal.role)) {
    const projection = await writeFoundationReviewProjection({
      workspacePath: input.workspacePath,
      revision: state.revision,
      laneId: terminal.role,
    })
    const validatedProjection = await readFoundationReviewProjection({
      workspacePath: input.workspacePath,
      revision: state.revision,
      laneId: terminal.role,
      expectedDigest: projection.digest,
    })
    const accepted = await acceptLaneReceipt({
      workspacePath: input.workspacePath,
      revision: state.revision,
      currentRevision: input.currentRevision,
      laneId: terminal.role,
      projectionDigest: projection.digest,
      allowedEvidencePaths: validatedProjection.projection.sources.map(
        source => source.path,
      ),
    })
    return assertFoundationReviewState({
      ...state,
      status: 'running',
      reports: state.reports.map(candidate =>
        candidate.role === terminal.role
          ? {
              ...candidate,
              path: accepted.path,
              digest: accepted.digest,
              status: 'completed' as const,
              failureReason: undefined,
            }
          : candidate,
      ),
      failureReason: undefined,
    })
  }

  const dispatchId = `foundation-initial-${state.attempt}-${terminal.role}`
  const initialReceipts = await readLaneReceipts({
    state,
    workspacePath: input.workspacePath,
  })
  const acceptedSelection = await acceptSelectionReceipt({
    workspacePath: input.workspacePath,
    revision: state.revision,
    dispatchId,
    candidateReferences: candidateReferences(initialReceipts),
  })
  const laneReceipts = await readLaneReceipts({
    state,
    workspacePath: input.workspacePath,
  })
  const review = assembleFoundationReview({
    revision: state.revision,
    laneReceipts,
    selection: acceptedSelection.selection,
  })
  const accepted = await commitAssembledFoundationReview({
    workspacePath: input.workspacePath,
    revision: state.revision,
    currentRevision: input.currentRevision,
    dispatchId,
    review,
  })
  return assertFoundationReviewState({
    ...state,
    status: 'completed',
    reports: state.reports.map(candidate =>
      candidate.role === terminal.role
        ? {
            ...candidate,
            path: acceptedSelection.path,
            digest: acceptedSelection.digest,
            status: 'completed' as const,
            failureReason: undefined,
          }
        : candidate,
    ),
    finalReportPath: accepted.path,
    finalReportDigest: accepted.digest,
    verdict: accepted.review.verdict,
    failureReason: undefined,
  })
}
