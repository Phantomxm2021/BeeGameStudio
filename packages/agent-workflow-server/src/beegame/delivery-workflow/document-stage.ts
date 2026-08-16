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
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryRun,
  type FoundationDocumentPath,
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
  const review = input.run.documentReviewState.activeRun
  const repairPaths =
    review?.status === 'completed' && review.verdict === 'NEEDS_REVISION'
      ? (review.affectedPaths?.filter(path =>
          CANONICAL_FOUNDATION_DOCUMENTS.includes(
            path as FoundationDocumentPath,
          ),
        ) ?? [])
      : []
  const repairPath = repairPaths.find(
    path => !review?.remediatedPaths?.includes(path),
  ) as FoundationDocumentPath | undefined
  const initialPath = review
    ? undefined
    : CANONICAL_FOUNDATION_DOCUMENTS[
        input.run.foundationDraftState.completedPaths.length
      ]
  if (!review && !initialPath)
    throw new Error(
      'foundation drafting has no remaining canonical document task',
    )
  if (review && !repairPath)
    throw new Error('foundation remediation has no remaining affected path')
  const allowedPaths = review ? [repairPath!] : [initialPath!]
  const previousDocumentMetadata = review
    ? repairPath
      ? (() => {
          const metadata = readDocumentMetadata(input.workspacePath, repairPath)
          return metadata ? { [repairPath]: metadata } : undefined
        })()
      : undefined
    : input.run.changeRequest && initialPath
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
    taskId: review ? repairPath : initialPath,
    revision: input.run.revision.document,
    allowedPaths,
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      confirmedBriefContext: input.run.confirmedBriefContext,
      ...(input.run.changeRequest
        ? { changeRequest: input.run.changeRequest }
        : {}),
      documentSet: 'foundation',
      systemDeliveryContract: buildSystemDeliveryContract(),
      ...(review
        ? {
            authoringMode: 'remediation',
            foundationDocumentPath: repairPath,
            completeDocumentContract: getGameDocumentContract(repairPath!),
            remediation: {
              reviewReportPath: review.finalReportPath,
              affectedPaths: repairPaths,
              sourceRevision: review.revision,
            },
          }
        : initialPath
          ? {
              authoringMode: 'initial',
              foundationDocumentPath: initialPath,
              completeDocumentContract: getGameDocumentContract(initialPath),
              upstreamDocumentPaths: [
                ...INITIAL_FOUNDATION_UPSTREAM_PATHS[initialPath],
              ],
            }
          : {}),
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
  const review = input.run.documentReviewState.activeRun
  const isRemediation =
    review?.scope === 'checklist' && review.verdict === 'NEEDS_REVISION'
  const previousChecklistMetadata = isRemediation
    ? readDocumentMetadata(input.workspacePath, CHECKLIST_PATH)
    : undefined
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
        input.run.documentReviewState.approvals?.foundation?.revision ??
        input.run.revision.document,
      ...(isRemediation
        ? {
            remediation: {
              reviewReportPath: review.finalReportPath,
              affectedPaths: review.affectedPaths,
              sourceRevision: review.revision,
            },
          }
        : {}),
      ...(previousChecklistMetadata
        ? {
            previousDocumentMetadata: {
              [CHECKLIST_PATH]: previousChecklistMetadata,
            },
          }
        : {}),
    },
  })
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
  const review = input.run.documentReviewState.activeRun
  const remediation =
    review?.status === 'completed' && review.verdict === 'NEEDS_REVISION'
      ? review
      : undefined
  if (documentSet === 'foundation' && !remediation)
    return completeInitialFoundationDocumentDraft(input)

  const allowedPaths = new Set(
    documentSet === 'checklist'
      ? [CHECKLIST_PATH]
      : CANONICAL_FOUNDATION_DOCUMENTS,
  )
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
  const missingRemediationIssue =
    remediation && input.terminal.writtenPaths.length === 0
      ? 'document remediation completed without changing a canonical artifact'
      : undefined
  const metadataCommitIssues: string[] = []
  const previousMetadata = input.run.activeDispatch?.request?.contract
    .previousDocumentMetadata
  if (
    remediation &&
    outOfScope.length === 0 &&
    !resolvedFindingIssue &&
    !missingRemediationIssue &&
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
    ...(missingRemediationIssue ? [missingRemediationIssue] : []),
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

  if (remediation) {
    const normalizedWrittenPaths = input.terminal.writtenPaths.map(path =>
      path.split('\\').join('/'),
    )
    const remediatedPaths = [
      ...(remediation.remediatedPaths ?? []),
      ...normalizedWrittenPaths,
    ].filter((path, index, all) => all.indexOf(path) === index)
    const affectedPaths = remediation.affectedPaths ?? []
    const remainingFoundationPaths = affectedPaths.filter(
      path =>
        CANONICAL_FOUNDATION_DOCUMENTS.includes(
          path as FoundationDocumentPath,
        ) && !remediatedPaths.includes(path),
    )
    const checklistRemaining =
      affectedPaths.includes(CHECKLIST_PATH) &&
      !remediatedPaths.includes(CHECKLIST_PATH)
    const resourceRemaining = affectedPaths.some(
      path => path.startsWith('assets/') && !remediatedPaths.includes(path),
    )
    if (documentSet === 'foundation' && remainingFoundationPaths.length)
      return {
        ...updated,
        documentReviewState: {
          ...updated.documentReviewState,
          activeRun: { ...remediation, remediatedPaths },
        },
      }
    if (remediation.scope === 'complete' && checklistRemaining)
      return {
        ...updated,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
        documentReviewState: {
          ...updated.documentReviewState,
          activeRun: { ...remediation, remediatedPaths },
        },
      }
    if (remediation.scope === 'complete' && resourceRemaining)
      return {
        ...updated,
        phase: 'RESOURCE_PREPARATION',
        documentStep: undefined,
        resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
        documentReviewState: {
          ...updated.documentReviewState,
          activeRun: { ...remediation, remediatedPaths },
        },
      }
    return {
      ...updated,
      phase: 'DOCUMENT_REVIEW',
      documentStep:
        remediation.scope === 'complete'
          ? 'COMPREHENSIVE_REVIEW'
          : documentSet === 'checklist'
            ? 'CHECKLIST_REVIEW'
            : 'FOUNDATION_REVIEW',
      documentReviewState: {
        ...updated.documentReviewState,
        activeRun: undefined,
      },
    }
  }

  return documentSet === 'checklist'
    ? {
        ...updated,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_REVIEW',
        documentReviewState: {
          ...updated.documentReviewState,
          activeRun: undefined,
        },
      }
    : {
        ...updated,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
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
