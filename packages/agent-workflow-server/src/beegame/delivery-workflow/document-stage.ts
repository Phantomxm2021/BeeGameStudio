import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { GameIrOperations } from '../stage-modules/game-ir/public'
import { foundationPublicDigest } from '../foundation-public-result'
import type { ChecklistAuthority } from '../checklist-authority-projection'
import { readFile } from '../stage-runtime/files'
import { isAbsolute, join } from 'node:path'
import { commitRemediatedDocumentMetadata } from '../authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import type { DeliveryRun } from './types'
import {
  CHECKLIST_PATH,
  checklistCandidatePath,
  commitChecklistCandidate,
  readChecklistCandidate,
} from '../checklist-candidate'
import { parseAcceptanceChecklist } from '../acceptance-checklist'
import type { WorkerTerminalResult } from './worker-contracts'
import {
  defaultAudit,
  documentMetadataIssues,
  type Dispatcher,
  type ReadinessAudit,
} from './document-publication-protocol'

export async function startChecklistDraftStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
  ir?: GameIrOperations
}): Promise<unknown> {
  if (
    input.run.phase !== 'DOCUMENT_REVIEW' ||
    input.run.documentStep !== 'CHECKLIST_DRAFTING'
  )
    throw new Error('checklist drafting is not the active document step')
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  const checklistAuthority = await verifiedChecklistAuthority(input)
  const dispatchId = randomUUID()
  const candidatePath = checklistCandidatePath(dispatchId)
  return input.dispatcher.dispatch({
    dispatchId,
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_REVIEW',
    revision: input.run.revision.document,
    allowedPaths: [candidatePath],
    projectReadScope: 'empty',
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      documentSet: 'checklist',
      approvedDocumentRevision: input.run.revision.document,
      checklistCanonicalPath: CHECKLIST_PATH,
      checklistCandidatePath: candidatePath,
      checklistAuthority,
    },
  })
}

export async function completeDocumentDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
  documentSet?: 'foundation' | 'checklist'
  ir?: GameIrOperations
}): Promise<DeliveryRun> {
  // The only production caller is the controller's checklist terminal branch.
  // Foundation completion is owned by the isolated Author public module.
  if (input.documentSet !== 'checklist' || input.run.phase !== 'DOCUMENT_REVIEW')
    throw new Error('document draft is not the active phase')
  const authority = await verifiedChecklistAuthority(input)
  const dispatchedAuthority = input.run.activeDispatch?.request?.contract.checklistAuthority
  if (foundationPublicDigest(dispatchedAuthority) !== foundationPublicDigest(authority))
    throw new Error('Checklist completion does not bind the dispatched Foundation and IR result')

  const candidatePath =
    input.run.activeDispatch?.request?.contract.checklistCandidatePath
  const allowedPaths = new Set(
    typeof candidatePath === 'string' ? [candidatePath] : [],
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
  const metadataCommitIssues: string[] = []
  const previousMetadata =
    input.run.activeDispatch?.request?.contract.previousDocumentMetadata
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
        includeChecklist: false,
        includeAssetManifest: false,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
      })
  const candidateIssues =
    typeof candidatePath !== 'string' || outOfScope.length
      ? ['checklist author candidate is missing']
      : await readChecklistCandidate({
          workspacePath: input.workspacePath,
          candidatePath,
        })
          .then(
            content => parseAcceptanceChecklist(content, CHECKLIST_PATH).issues,
          )
          .catch(error => [
            `checklist candidate is unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
          ])
  const metadataIssues = documentMetadataIssues({
    workspacePath: input.workspacePath,
    writtenPaths: input.terminal.writtenPaths,
    previous:
      input.run.activeDispatch?.request?.contract.previousDocumentMetadata,
  })
  const issues = [
    ...readiness.issues,
    ...candidateIssues,
    ...(outOfScope.length
      ? [
          `document author wrote outside the document scope: ${outOfScope.join(', ')}`,
        ]
      : []),
    ...(resolvedFindingIssue ? [resolvedFindingIssue] : []),
    ...metadataCommitIssues,
    ...metadataIssues,
  ]
  if (issues.length)
    return {
      ...input.run,
      activeDispatch: issues.length ? input.run.activeDispatch : undefined,
      status: issues.length ? 'needs_action' : input.run.status,
      blockedReason: issues.length ? issues.join('; ') : undefined,
      updatedAt: new Date().toISOString(),
    }

  await commitChecklistCandidate({
    workspacePath: input.workspacePath,
    candidatePath: candidatePath as string,
  })
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const updated: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    activeDispatch: undefined,
    updatedAt: new Date().toISOString(),
  }

  return {
    ...updated,
    phase: 'RESOURCE_PREPARATION',
    documentStep: undefined,
    resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' },
  }
}

async function verifiedChecklistAuthority(input: {
  run: DeliveryRun; workspacePath: string; ir?: GameIrOperations
}): Promise<ChecklistAuthority> {
  const link = input.run.gameIrStage, outcome = link?.outcome
  if (!input.ir || !link?.handle || outcome?.status !== 'completed' || outcome.billingStatus !== 'settled' ||
      link.control.action !== 'run' || input.run.revision.document !== link.foundationRevision)
    throw new Error('Checklist requires the current completed and settled IR result')
  const view = await input.ir.readResult({ handle: link.handle, foundationRevision: link.foundationRevision })
  if (foundationPublicDigest(view.ready) !== foundationPublicDigest(outcome.result) ||
      view.input.foundationResultId !== input.run.foundationReviewStage?.acceptedReview?.resultId ||
      foundationPublicDigest(view.input) !== link.inputDigest)
    throw new Error('Checklist IR public result binding changed')
  // Observe working files only to detect drift, never to substitute input.
  for (const document of view.input.documents) {
    const current = await readFile(join(input.workspacePath, document.path), 'utf8')
    if (createHash('sha256').update(current, 'utf8').digest('hex') !== document.digest)
      throw new Error(`Accepted Foundation document changed before Checklist publication: ${document.path}`)
  }
  const module = view.candidate.modules.find(value => value.moduleId === 'implementation-verification')
  if (!module) throw new Error('Verified IR does not contain implementation verification')
  return { foundationRevision: link.foundationRevision, documentSetDigest: view.input.documentSetDigest,
    documents: view.input.documents.map(({ path, content, digest }) => ({ path, content, digest })),
    irResultId: foundationPublicDigest(view.ready), irModules: [{ moduleId: module.moduleId,
      nodes: module.nodes.filter(node => node.kind === 'implementation-verification.acceptance-scenario')
        .map(node => ({ id: node.id, kind: node.kind, value: node.value, bindings: node.bindings })) }] }
}
