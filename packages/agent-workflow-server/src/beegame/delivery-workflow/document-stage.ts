import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  commitRemediatedDocumentMetadata,
  commitAuthoredFoundationDocument,
  readAuthoredDocumentReceipt,
} from '../authored-document-receipt'
import { validateCompleteGameDocumentMarkdown } from '../complete-game-document'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import { INITIAL_FOUNDATION_UPSTREAM_PATHS } from './foundation-document-topology'
import { getGameDocumentContract } from './game-document-contracts'
import {
  beginParallelFoundationAuthoring,
  recordFoundationCommit,
  readyDraftPaths,
} from './foundation-authoring-batch'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { readFoundationReviewArtifact } from './foundation-review'
import {
  commitFoundationRemediationReceipt,
  foundationRemediationReadyForVerification,
  pendingFoundationRemediationLanes,
} from './foundation-remediation'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryRun,
  type FoundationDocumentPath,
  type FoundationRemediationLaneId,
  type WorkerDispatchRequest,
} from './types'

import type { WorkerTerminalResult } from './worker-contracts'

type ReadinessAudit = (
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
    requireCompleteFoundation?: boolean
  },
) => { valid: boolean; issues: string[] }

type Dispatcher = {
  dispatch(request: WorkerDispatchRequest): Promise<unknown>
}

const CHECKLIST_PATH = 'docs/acceptance/gameplay-checklist.md'

async function defaultAudit(
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
    requireCompleteFoundation?: boolean
  },
): Promise<ReturnType<ReadinessAudit>> {
  const { auditDocumentReadiness } = await import('../document-readiness-audit')
  return auditDocumentReadiness(workspacePath, options)
}

function exactStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

type DocumentMetadata = { version: string; updatedAt: string }

function frontmatterValue(content: string, field: string): string | undefined {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return undefined
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') return undefined
    const separator = line.indexOf(':')
    if (separator < 1 || line.slice(0, separator).trim() !== field) continue
    const raw = line.slice(separator + 1).trim()
    if (!raw) return undefined
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    return quoted ? raw.slice(1, -1).trim() : raw
  }
  return undefined
}

function readDocumentMetadata(
  workspacePath: string,
  path: string,
): DocumentMetadata | undefined {
  try {
    const content = readFileSync(join(workspacePath, path), 'utf8')
    const version = frontmatterValue(content, 'version')
    const updatedAt = frontmatterValue(content, 'updated_at')
    return version && updatedAt ? { version, updatedAt } : undefined
  } catch {
    return undefined
  }
}

function readDocumentDigest(workspacePath: string, path: string): string {
  return createHash('sha256')
    .update(readFileSync(join(workspacePath, path)))
    .digest('hex')
}

function parseSemanticVersion(
  value: string,
): [number, number, number] | undefined {
  const parts = value.split('.')
  if (parts.length !== 3) return undefined
  const numbers = parts.map(part => Number(part))
  if (
    numbers.some(
      (part, index) =>
        !Number.isInteger(part) || part < 0 || String(part) !== parts[index],
    )
  )
    return undefined
  return [numbers[0]!, numbers[1]!, numbers[2]!]
}

function documentMetadataIssues(input: {
  workspacePath: string
  writtenPaths: string[]
  previous: unknown
}): string[] {
  if (
    !input.previous ||
    typeof input.previous !== 'object' ||
    Array.isArray(input.previous)
  )
    return []
  const snapshots = input.previous as Record<string, unknown>
  const issues: string[] = []
  for (const path of input.writtenPaths) {
    const before = snapshots[path]
    if (!before || typeof before !== 'object' || Array.isArray(before)) continue
    const previousVersion = (before as Record<string, unknown>).version
    const previousUpdatedAt = (before as Record<string, unknown>).updatedAt
    const current = readDocumentMetadata(input.workspacePath, path)
    const previousParts =
      typeof previousVersion === 'string'
        ? parseSemanticVersion(previousVersion)
        : undefined
    const currentParts = current
      ? parseSemanticVersion(current.version)
      : undefined
    if (
      !previousParts ||
      !currentParts ||
      currentParts[0] !== previousParts[0] ||
      currentParts[1] !== previousParts[1] ||
      currentParts[2] !== previousParts[2] + 1
    )
      issues.push(`${path}: remediation must increment the PATCH version once`)
    if (
      !current ||
      typeof previousUpdatedAt !== 'string' ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      !Number.isFinite(Date.parse(previousUpdatedAt)) ||
      Date.parse(current.updatedAt) <= Date.parse(previousUpdatedAt)
    )
      issues.push(`${path}: remediation must update updated_at`)
  }
  return issues
}

export async function startDocumentStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error(
      `document stage requires DOCUMENT_DRAFTING, got ${input.run.phase}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  const remediationState = input.run.foundationRemediationState
  if (remediationState) {
    const accepted = await readFoundationReviewArtifact({
      workspacePath: input.workspacePath,
      path: remediationState.reviewPath,
      expectedDigest: remediationState.reviewDigest,
    })
    const repairPaths = remediationState.lanes.flatMap(
      lane => lane.affectedPaths,
    )
    if (
      !exactStringSet(repairPaths, accepted.affectedPaths) ||
      accepted.review.revision !== remediationState.sourceRevision
    )
      throw new Error('foundation remediation paths do not match accepted review')
    const pending = pendingFoundationRemediationLanes(remediationState)
    if (!pending.length) return remediationState
    return Promise.all(
      pending.map(lane => {
        const previousDocumentMetadata = Object.fromEntries(
          lane.affectedPaths.flatMap(path => {
            const metadata = readDocumentMetadata(input.workspacePath, path)
            return metadata ? [[path, metadata]] : []
          }),
        )
        const previousDocumentDigests = Object.fromEntries(
          lane.ownedPaths.map(path => [
            path,
            readDocumentDigest(input.workspacePath, path),
          ]),
        )
        return input.dispatcher.dispatch({
          runId: input.run.runId,
          ownerId: input.run.ownerId,
          projectId: input.run.projectId,
          workspacePath: input.workspacePath,
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: `foundation-remediation:${lane.id}`,
          revision: remediationState.sourceRevision,
          allowedPaths: [...lane.affectedPaths],
          contract: {
            confirmedBriefDigest: input.run.confirmedBriefDigest,
            confirmedBriefContext: input.run.confirmedBriefContext,
            documentSet: 'foundation',
            systemDeliveryContract: buildSystemDeliveryContract(),
            authoringMode: 'remediation',
            remediation: {
              laneId: lane.id,
              reviewPath: accepted.path,
              reviewDigest: accepted.digest,
              affectedPaths: [...lane.affectedPaths],
              sourceRevision: remediationState.sourceRevision,
            },
            previousDocumentDigests,
            ...(Object.keys(previousDocumentMetadata).length
              ? { previousDocumentMetadata }
              : {}),
          },
        })
      }),
    )
  }
  if (input.run.foundationDraftState.documents) {
    const pendingDrafts = readyDraftPaths(input.run.foundationDraftState)
    if (pendingDrafts.length) {
      return Promise.all(
        pendingDrafts.map(path =>
          input.dispatcher.dispatch({
            runId: input.run.runId,
            ownerId: input.run.ownerId,
            projectId: input.run.projectId,
            workspacePath: input.workspacePath,
            workerType: 'document-author',
            phase: 'DOCUMENT_DRAFTING',
            taskId: path,
            revision: input.run.revision.document,
            allowedPaths: [path],
            contract: {
              confirmedBriefDigest: input.run.confirmedBriefDigest,
              confirmedBriefContext: input.run.confirmedBriefContext,
              documentSet: 'foundation',
              systemDeliveryContract: buildSystemDeliveryContract(),
              authoringMode: 'parallel-draft',
              foundationDocumentPath: path,
              completeDocumentContract: getGameDocumentContract(path),
              availableUpstreamPaths: getGameDocumentContract(
                path,
              ).upstreamSections.map(section => section.path),
            },
          }),
        ),
      )
    }
    const hasUnsettledDraft = input.run.foundationDraftState.documents.some(
      document => document.status === 'drafting',
    )
    if (hasUnsettledDraft) return input.run.foundationDraftState
    return input.run.foundationDraftState
  }
  const initialPath =
    CANONICAL_FOUNDATION_DOCUMENTS[
      input.run.foundationDraftState.completedPaths.length
    ]
  if (!initialPath)
    throw new Error(
      'foundation drafting has no remaining canonical document task',
    )
  const previousDocumentMetadata = input.run.changeRequest
      ? (() => {
          const metadata = readDocumentMetadata(
            input.workspacePath,
            initialPath,
          )
          return metadata ? { [initialPath]: metadata } : undefined
        })()
      : undefined
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: initialPath,
    revision: input.run.revision.document,
    allowedPaths: [initialPath],
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      confirmedBriefContext: input.run.confirmedBriefContext,
      ...(input.run.changeRequest
        ? { changeRequest: input.run.changeRequest }
        : {}),
      documentSet: 'foundation',
      systemDeliveryContract: buildSystemDeliveryContract(),
      authoringMode: 'initial',
      foundationDocumentPath: initialPath,
      completeDocumentContract: getGameDocumentContract(initialPath),
      upstreamDocumentPaths: [
        ...INITIAL_FOUNDATION_UPSTREAM_PATHS[initialPath],
      ],
      ...(previousDocumentMetadata ? { previousDocumentMetadata } : {}),
    },
  })
}

export async function startChecklistDraftStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (
    input.run.phase !== 'DOCUMENT_REVIEW' ||
    input.run.documentStep !== 'CHECKLIST_DRAFTING'
  )
    throw new Error('checklist drafting is not the active document step')
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_REVIEW',
    revision: input.run.revision.document,
    allowedPaths: [CHECKLIST_PATH],
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      documentSet: 'checklist',
      approvedDocumentRevision:
        input.run.foundationReviewState?.revision ??
        input.run.revision.document,
    },
  })
}

export async function completeFoundationRemediationLane(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
}): Promise<DeliveryRun> {
  const state = input.run.foundationRemediationState
  const dispatch = state?.lanes.find(
    lane => lane.dispatch?.dispatchId === input.run.activeDispatch?.dispatchId,
  )?.dispatch ?? input.run.activeDispatch
  const remediation = dispatch?.request?.contract.remediation as
    | { laneId?: unknown }
    | undefined
  const laneId = remediation?.laneId
  if (
    !state ||
    typeof laneId !== 'string' ||
    !['core-design', 'technical-assets', 'presentation'].includes(laneId) ||
    !dispatch
  )
    throw new Error('foundation remediation terminal has no lane authority')
  const lane = state.lanes.find(candidate => candidate.id === laneId)
  if (!lane || lane.status !== 'running')
    throw new Error('foundation remediation lane is not running')
  const accepted = await readFoundationReviewArtifact({
    workspacePath: input.workspacePath,
    path: state.reviewPath,
    expectedDigest: state.reviewDigest,
  })
  if (
    accepted.review.revision !== state.sourceRevision ||
    !exactStringSet(
      accepted.affectedPaths,
      state.lanes.flatMap(candidate => candidate.affectedPaths),
    )
  )
    throw new Error('foundation remediation review authority changed')
  const normalizedWrittenPaths = input.terminal.writtenPaths.map(path =>
    path.split('\\').join('/'),
  )
  if (!exactStringSet(normalizedWrittenPaths, lane.affectedPaths))
    throw new Error('mutation paths do not match the lane assignment')
  if ((input.terminal.resolvedFindingIds?.length ?? 0) > 0)
    throw new Error('document remediation cannot declare finding closure')
  const previousMetadata = dispatch.request?.contract.previousDocumentMetadata
  if (
    previousMetadata &&
    typeof previousMetadata === 'object' &&
    !Array.isArray(previousMetadata)
  )
    for (const path of lane.affectedPaths) {
      const previous = (previousMetadata as Record<string, unknown>)[path]
      if (!previous || typeof previous !== 'object' || Array.isArray(previous))
        continue
      const version = (previous as Record<string, unknown>).version
      const updatedAt = (previous as Record<string, unknown>).updatedAt
      if (typeof version === 'string' && typeof updatedAt === 'string')
        await commitRemediatedDocumentMetadata({
          workspacePath: input.workspacePath,
          targetPath: path,
          previousVersion: version,
          previousUpdatedAt: updatedAt,
        })
    }
  const contentIssues = lane.affectedPaths.flatMap(path =>
    completeFoundationDocumentIssues(input.workspacePath, path),
  )
  const metadataIssues = documentMetadataIssues({
    workspacePath: input.workspacePath,
    writtenPaths: [...lane.affectedPaths],
    previous: previousMetadata,
  })
  if (contentIssues.length || metadataIssues.length)
    throw new Error([...contentIssues, ...metadataIssues].join('; '))
  const beforeDigests = dispatch.request?.contract.previousDocumentDigests
  if (
    !beforeDigests ||
    typeof beforeDigests !== 'object' ||
    Array.isArray(beforeDigests)
  )
    throw new Error('foundation remediation before digests are missing')
  const afterDigests = Object.fromEntries(
    lane.ownedPaths.map(path => [
      path,
      readDocumentDigest(input.workspacePath, path),
    ]),
  )
  for (const path of lane.ownedPaths) {
    const before = (beforeDigests as Record<string, unknown>)[path]
    const after = afterDigests[path]
    if (typeof before !== 'string' || !/^[a-f0-9]{64}$/u.test(before))
      throw new Error('foundation remediation before digests are invalid')
    if (!lane.affectedPaths.includes(path) && before !== after)
      throw new Error(`foundation remediation changed an unassigned path: ${path}`)
    if (lane.affectedPaths.includes(path) && before === after)
      throw new Error(`foundation remediation did not change assigned path: ${path}`)
  }
  const nextState = commitFoundationRemediationReceipt(state, {
    laneId: laneId as FoundationRemediationLaneId,
    dispatchId: dispatch.dispatchId,
    writtenPaths: [...lane.affectedPaths],
    beforeDigests: beforeDigests as Record<string, string>,
    afterDigests,
    committedAt: new Date().toISOString(),
  })
  if (!foundationRemediationReadyForVerification(nextState))
    return {
      ...input.run,
      activeDispatch: undefined,
      foundationRemediationState: nextState,
      status: 'running',
      blockedReason: undefined,
      updatedAt: new Date().toISOString(),
    }
  for (const completedLane of nextState.lanes) {
    if (completedLane.status === 'not_required') continue
    if (!completedLane.receipt)
      throw new Error('foundation remediation receipt is missing')
    for (const path of completedLane.ownedPaths)
      if (
        readDocumentDigest(input.workspacePath, path) !==
        completedLane.receipt.afterDigests[path]
      )
        throw new Error(
          `foundation remediation receipt no longer matches current bytes: ${path}`,
        )
  }
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
        requireCompleteFoundation: true,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
        requireCompleteFoundation: true,
      })
  if (!readiness.valid) throw new Error(readiness.issues.join('; '))
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  return {
    ...input.run,
    activeDispatch: undefined,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    foundationRemediationState: {
      ...nextState,
      resultingRevision: documentRevision,
    },
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    status: 'running',
    blockedReason: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export async function completeDocumentDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
  documentSet?: 'foundation' | 'checklist'
}): Promise<DeliveryRun> {
  const documentSet = input.documentSet ?? 'foundation'
  if (
    input.run.phase !== 'DOCUMENT_DRAFTING' &&
    !(documentSet === 'checklist' && input.run.phase === 'DOCUMENT_REVIEW')
  )
    throw new Error('document draft is not the active phase')
  if (documentSet === 'foundation')
    return completeInitialFoundationDocumentDraft(input)

  const allowedPaths = new Set([CHECKLIST_PATH])
  const outOfScope = input.terminal.writtenPaths.filter(path => {
    const normalized = path.split('\\').join('/')
    return (
      isAbsolute(path) ||
      normalized.split('/').includes('..') ||
      !allowedPaths.has(normalized as never)
    )
  })
  const resolvedFindingIssue =
    (input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? 'canonical document commit cannot declare finding closure'
      : undefined
  const metadataCommitIssues: string[] = []
  const previousMetadata = input.run.activeDispatch?.request?.contract
    .previousDocumentMetadata
  if (
    outOfScope.length === 0 &&
    !resolvedFindingIssue &&
    previousMetadata &&
    typeof previousMetadata === 'object' &&
    !Array.isArray(previousMetadata)
  ) {
    for (const path of input.terminal.writtenPaths) {
      const previous = (previousMetadata as Record<string, unknown>)[path]
      if (!previous || typeof previous !== 'object' || Array.isArray(previous))
        continue
      const previousVersion = (previous as Record<string, unknown>).version
      const previousUpdatedAt = (previous as Record<string, unknown>).updatedAt
      if (
        typeof previousVersion !== 'string' ||
        typeof previousUpdatedAt !== 'string'
      )
        continue
      try {
        await commitRemediatedDocumentMetadata({
          workspacePath: input.workspacePath,
          targetPath: path,
          previousVersion,
          previousUpdatedAt,
        })
      } catch (error) {
        metadataCommitIssues.push(
          `${path}: ${error instanceof Error ? error.message : 'service-owned metadata commit failed'}`,
        )
      }
    }
  }
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
        includeAssetManifest: false,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
        includeAssetManifest: false,
      })
  const metadataIssues = documentMetadataIssues({
    workspacePath: input.workspacePath,
    writtenPaths: input.terminal.writtenPaths,
    previous:
      input.run.activeDispatch?.request?.contract.previousDocumentMetadata,
  })
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const issues = [
    ...readiness.issues,
    ...(outOfScope.length
      ? [
          `document author wrote outside the document scope: ${outOfScope.join(', ')}`,
        ]
      : []),
    ...(resolvedFindingIssue ? [resolvedFindingIssue] : []),
    ...metadataCommitIssues,
    ...metadataIssues,
  ]
  let updated: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    activeDispatch: issues.length ? input.run.activeDispatch : undefined,
    status: issues.length ? 'needs_action' : input.run.status,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return updated

  return {
    ...updated,
    phase: 'RESOURCE_PREPARATION',
    documentStep: undefined,
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
  }
}

async function completeInitialFoundationDocumentDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
}): Promise<DeliveryRun> {
  const authoringMode =
    input.run.activeDispatch?.request?.contract.authoringMode
  if (authoringMode === 'parallel-draft')
    return completeParallelFoundationDraft(input)
  const completedPaths = input.run.foundationDraftState.completedPaths
  const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[completedPaths.length]
  if (!expectedPath)
    throw new Error('foundation initial-authoring cursor is already complete')

  const normalizedWrittenPaths = input.terminal.writtenPaths.map(path =>
    path.split('\\').join('/'),
  )
  const dispatchId = input.run.activeDispatch?.dispatchId
  let commitReceipt = dispatchId
    ? await readAuthoredDocumentReceipt(input.workspacePath, dispatchId)
    : undefined
  let authoredCommitIssue: string | undefined
  if (!commitReceipt && dispatchId) {
    try {
      commitReceipt = await commitAuthoredFoundationDocument({
        workspacePath: input.workspacePath,
        dispatchId,
        targetPath: expectedPath,
      })
    } catch (error) {
      authoredCommitIssue =
        error instanceof Error
          ? error.message
          : 'authored document validation failed'
    }
  }
  const hasCommittedDocument =
    commitReceipt !== undefined &&
    commitReceipt.status === 'committed' &&
    commitReceipt.targetPath === expectedPath &&
    Boolean(commitReceipt.finalDigest)
  const canonicalizationIssues = authoredCommitIssue
    ? [`${expectedPath}: ${authoredCommitIssue}`]
    : []
  const metadata = readDocumentMetadata(input.workspacePath, expectedPath)
  const version = metadata ? parseSemanticVersion(metadata.version) : undefined
  const issues = [
    ...(!hasCommittedDocument
      ? [`${expectedPath}: committed canonical Markdown receipt is missing`]
      : []),
    ...(!exactStringSet(normalizedWrittenPaths, [expectedPath])
      ? [
          `initial document author must write exactly the active canonical document: ${expectedPath}`,
        ]
      : []),
    ...(normalizedWrittenPaths.some(
      path => isAbsolute(path) || path.split('/').includes('..'),
    )
      ? ['initial document author returned an unsafe document path']
      : []),
    ...canonicalizationIssues,
    ...(!metadata ||
    !version ||
    !Number.isFinite(Date.parse(metadata.updatedAt))
      ? [`${expectedPath}: canonical front matter is incomplete or invalid`]
      : []),
    ...documentMetadataIssues({
      workspacePath: input.workspacePath,
      writtenPaths: normalizedWrittenPaths,
      previous:
        input.run.activeDispatch?.request?.contract.previousDocumentMetadata,
    }),
    ...completeFoundationDocumentIssues(input.workspacePath, expectedPath),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['initial document author cannot resolve review findings']
      : []),
  ]
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const base: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    // Keep the completed author handoff when only Studio-side validation or
    // receipt creation failed. A retry can then replay the exact terminal
    // result and re-run the local commit boundary without starting another
    // model turn. Successful validation clears it through the same branch.
    activeDispatch: issues.length ? input.run.activeDispatch : undefined,
    currentItemId: expectedPath,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return base

  const nextCompletedPaths = [...completedPaths, expectedPath]
  if (nextCompletedPaths.length === 1)
    return {
      ...base,
      foundationDraftState:
        beginParallelFoundationAuthoring(nextCompletedPaths),
      currentItemId: undefined,
      blockedReason: undefined,
    }
  if (nextCompletedPaths.length < CANONICAL_FOUNDATION_DOCUMENTS.length)
    return {
      ...base,
      foundationDraftState: { completedPaths: nextCompletedPaths },
      currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[nextCompletedPaths.length],
      blockedReason: undefined,
    }

  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
        requireCompleteFoundation: true,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
        requireCompleteFoundation: true,
      })
  if (!readiness.valid)
    return {
      ...base,
      foundationDraftState: { completedPaths: nextCompletedPaths },
      blockedReason: readiness.issues.join('; '),
    }
  return {
    ...base,
    foundationDraftState: { completedPaths: nextCompletedPaths },
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    currentItemId: undefined,
    blockedReason: undefined,
  }
}

async function completeParallelFoundationDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
}): Promise<DeliveryRun> {
  const path =
    input.run.activeDispatch?.request?.contract.foundationDocumentPath
  if (
    typeof path !== 'string' ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(path as FoundationDocumentPath)
  )
    throw new Error('parallel foundation draft path is invalid')
  const canonicalPath = path as FoundationDocumentPath
  const normalizedWrittenPaths = input.terminal.writtenPaths.map(value =>
    value.split('\\').join('/'),
  )
  const dispatchId = input.run.activeDispatch?.dispatchId
  const receipt = dispatchId
    ? await readAuthoredDocumentReceipt(input.workspacePath, dispatchId)
    : undefined
  const issues = [
    ...(!receipt ||
    receipt.status !== 'committed' ||
    receipt.targetPath !== canonicalPath
      ? [`${canonicalPath}: committed Markdown stream receipt is missing`]
      : []),
    ...(!exactStringSet(normalizedWrittenPaths, [canonicalPath])
      ? [`parallel document author must write exactly ${canonicalPath}`]
      : []),
    ...(normalizedWrittenPaths.some(
      value => isAbsolute(value) || value.split('/').includes('..'),
    )
      ? ['parallel document author returned an unsafe document path']
      : []),
    ...completeFoundationDocumentIssues(input.workspacePath, canonicalPath),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['parallel document author cannot resolve review findings']
      : []),
  ]
  if (issues.length)
    return {
      ...input.run,
      activeDispatch: undefined,
      status: 'needs_action',
      blockedReason: issues.join('; '),
    }
  const foundationDraftState = recordFoundationCommit(
    input.run.foundationDraftState,
    canonicalPath,
  )
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const base: DeliveryRun = {
    ...input.run,
    activeDispatch: undefined,
    foundationDraftState,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    currentItemId: undefined,
    blockedReason: undefined,
    updatedAt: new Date().toISOString(),
  }
  if (
    foundationDraftState.completedPaths.length <
    CANONICAL_FOUNDATION_DOCUMENTS.length
  )
    return base
  const readiness = await defaultAudit(input.workspacePath, {
    includeChecklist: false,
    includeAssetManifest: false,
    requireCompleteFoundation: true,
  })
  if (!readiness.valid)
    return {
      ...base,
      status: 'needs_action',
      blockedReason: readiness.issues.join('; '),
    }
  return {
    ...base,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
  }
}

function completeFoundationDocumentIssues(
  workspacePath: string,
  path: FoundationDocumentPath,
): string[] {
  try {
    const content = readFileSync(join(workspacePath, path), 'utf8')
    const lines = content.split('\n')
    if (lines[0]?.trim() !== '---')
      return [`${path}: canonical front matter is missing`]
    const closingIndex = lines.findIndex(
      (line, index) => index > 0 && line.trim() === '---',
    )
    if (closingIndex < 0)
      return [`${path}: canonical front matter is incomplete`]
    validateCompleteGameDocumentMarkdown(
      path,
      lines
        .slice(closingIndex + 1)
        .join('\n')
        .trimStart(),
    )
    return []
  } catch (error) {
    return [
      `${path}: ${error instanceof Error ? error.message : 'complete document validation failed'}`,
    ]
  }
}
