import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { readAcceptanceChecklistIds } from '../document-readiness-audit'
import { isWorkflowEvidenceFile } from './evidence'
import {
  checkEvidenceDigests,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
  requiredDocumentReviewCheckIds,
  validateDocumentReviewChecks,
  validateDocumentReviewFindingSubjects,
  type DocumentReviewArtifact,
  type ReviewAuthority,
} from './document-review-input'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
  type DocumentReviewCheck,
  type DocumentReviewCheckId,
  type DocumentReviewCycle,
  type DocumentReviewFinding,
  type DocumentReviewScope,
  type WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type ReadinessAudit = (
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
  },
) => { valid: boolean; issues: string[] }

type Dispatcher = {
  dispatch(request: WorkerDispatchRequest): Promise<unknown>
}

type RemediationTarget = 'foundation' | 'checklist' | 'resource'

const MAX_CHECKLIST_REMEDIATION_ATTEMPTS = 3
const MAX_DOCUMENT_REPAIR_PASSES = 2
const CHECKLIST_PATH = 'docs/acceptance/gameplay-checklist.md'

const CLOSURE_CHECKS: Record<
  RemediationTarget,
  readonly DocumentReviewCheckId[]
> = {
  foundation: FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  checklist: [
    'cross_document_consistency',
    'acceptance_observability',
    'checklist_traceability',
    'implementation_readiness',
  ],
  resource: [
    'technical_feasibility',
    'resource_semantic_fitness',
    'content_structure_fitness',
    'resource_content_consistency',
    'implementation_readiness',
  ],
}

async function defaultAudit(
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
  },
): Promise<ReturnType<ReadinessAudit>> {
  const { auditDocumentReadiness } = await import('../document-readiness-audit')
  return auditDocumentReadiness(workspacePath, options)
}

function reviewAuthority(run: DeliveryRun): ReviewAuthority {
  return {
    confirmedBriefContext: run.confirmedBriefContext,
    confirmedBriefDigest: run.confirmedBriefDigest,
  }
}

function findingsForTarget(
  cycle: DocumentReviewCycle | undefined,
  target: RemediationTarget,
): DocumentReviewFinding[] {
  return (
    cycle?.findings.filter(finding => finding.owner === target) ??
    []
  )
}

function nextTarget(findings: DocumentReviewFinding[]): RemediationTarget {
  if (findings.some(finding => finding.owner === 'foundation'))
    return 'foundation'
  if (findings.some(finding => finding.owner === 'checklist'))
    return 'checklist'
  return 'resource'
}

function routeToRemediation(
  run: DeliveryRun,
  target: RemediationTarget,
): DeliveryRun {
  const completedPasses = run.documentReviewState.repairPasses[target]
  if (completedPasses >= MAX_DOCUMENT_REPAIR_PASSES)
    return {
      ...run,
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: `document ${target} remediation exhausted its bounded repair passes`,
      updatedAt: new Date().toISOString(),
    }
  return {
    ...run,
    phase:
      target === 'foundation'
        ? 'DOCUMENT_DRAFTING'
        : target === 'checklist'
          ? 'DOCUMENT_REVIEW'
          : 'RESOURCE_PREPARATION',
    documentStep:
      target === 'foundation'
        ? 'FOUNDATION_DRAFTING'
        : target === 'checklist'
          ? 'CHECKLIST_DRAFTING'
          : undefined,
    status: 'running',
    activeDispatch: undefined,
    blockedReason: undefined,
    tasks: [],
    documentReviewState: {
      ...run.documentReviewState,
      repairPasses: {
        ...run.documentReviewState.repairPasses,
        [target]: completedPasses + 1,
      },
    },
    updatedAt: new Date().toISOString(),
  }
}

function exactStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function artifactDigestChanges(
  before: Record<string, string>,
  artifacts: DocumentReviewArtifact[],
): Array<{
  path: string
  beforeDigest: string | null
  afterDigest: string | null
}> {
  const after = documentReviewArtifactDigests(artifacts)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
    path => {
      const beforeDigest = before[path] ?? null
      const afterDigest = after[path] ?? null
      return beforeDigest !== afterDigest
        ? [{ path, beforeDigest, afterDigest }]
        : []
    },
  )
}

function expectedReviewPaths(scope: DocumentReviewScope): string[] {
  return scope === 'foundation'
    ? [...CANONICAL_FOUNDATION_DOCUMENTS]
    : [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST]
}

function normalizedReviewFindings(
  _cycle: DocumentReviewCycle,
  findings: Extract<
    WorkerTerminalResult,
    { workerType: 'document-reviewer' }
  >['findings'],
): DocumentReviewFinding[] {
  return findings
}

function closureContractIssues(input: {
  cycle: DocumentReviewCycle
  findings: Extract<
    WorkerTerminalResult,
    { workerType: 'document-reviewer' }
  >['findings']
}): string[] {
  const issues: string[] = []
  if (input.cycle.mode === 'initial') {
    if (input.findings.some(finding => finding.regressionPaths?.length))
      issues.push(
        'initial review cannot reference repair regressions',
      )
    return issues
  }
  const target = input.cycle.activeTarget
  const priorIds = new Set(
    findingsForTarget(input.cycle, target ?? 'foundation').map(
      finding => finding.findingId,
    ),
  )
  const changedPaths = new Set(input.cycle.changedPaths)
  for (const finding of input.findings) {
    if (finding.owner !== target)
      issues.push(
        'closure review finding is outside the active remediation owner',
      )
    const priorFindingValid = priorIds.has(finding.findingId)
    const regressionValid =
      Boolean(finding.regressionPaths?.length) &&
      finding.regressionPaths!.every(path => changedPaths.has(path))
    if (!priorFindingValid && !regressionValid)
      issues.push(
        'closure review finding must reference an active prior finding or a changed-path regression',
      )
  }
  return issues
}

function mergeChecks(
  existing: DocumentReviewCheck[],
  replacements: DocumentReviewCheck[],
): DocumentReviewCheck[] {
  const replaced = new Set(replacements.map(check => check.id))
  return [...existing.filter(check => !replaced.has(check.id)), ...replacements]
}

function mergeCheckDigests(
  existing: Record<string, Record<string, string>>,
  replacements: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  return { ...existing, ...replacements }
}

function approvalIssues(input: {
  scope: DocumentReviewScope
  checks: DocumentReviewCheck[]
  checkEvidenceDigests: Record<string, Record<string, string>>
  artifacts: DocumentReviewArtifact[]
}): string[] {
  const required = requiredDocumentReviewCheckIds(input.scope)
  const currentDigests = documentReviewArtifactDigests(input.artifacts)
  const issues: string[] = []
  for (const id of required) {
    const check = input.checks.find(candidate => candidate.id === id)
    if (!check || check.status !== 'pass') {
      issues.push(`document review approval is missing passing check ${id}`)
      continue
    }
    const evidenceDigests = input.checkEvidenceDigests[id]
    if (
      !evidenceDigests ||
      Object.entries(evidenceDigests).some(
        ([path, digest]) => currentDigests[path] !== digest,
      )
    )
      issues.push(
        `document review check ${id} is stale for the current artifacts`,
      )
  }
  return issues
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
      current.updatedAt === previousUpdatedAt ||
      !Number.isFinite(Date.parse(current.updatedAt))
    )
      issues.push(`${path}: remediation must update updated_at`)
  }
  return issues
}

export async function createInitialDocumentReviewCycle(input: {
  run: DeliveryRun
  workspacePath: string
  scope: DocumentReviewScope
  revision: string
}): Promise<DeliveryRun> {
  const current = input.run.documentReviewState.activeCycle
  if (current) {
    if (
      current.scope !== input.scope ||
      current.sourceRevision !== input.revision ||
      current.mode !== 'initial'
    )
      throw new Error('a different document review cycle is already active')
    return input.run
  }
  const cycleId = randomUUID()
  const artifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    input.scope,
    reviewAuthority(input.run),
  )
  const sourceArtifactDigests = documentReviewArtifactDigests(artifacts)
  return {
    ...input.run,
    documentReviewState: {
      ...input.run.documentReviewState,
      activeCycle: {
        cycleId,
        originScope: input.scope,
        scope: input.scope,
        mode: 'initial',
        sourceRevision: input.revision,
        requiredCheckIds: requiredDocumentReviewCheckIds(input.scope),
        checks: [],
        checkEvidenceDigests: {},
        findings: [],
        acceptedSemanticResult: false,
        transportAttempts: 0,
        changedPaths: [],
        sourceArtifactDigests,
      },
    },
    updatedAt: new Date().toISOString(),
  }
}

export function incrementDocumentReviewTransportAttempt(
  run: DeliveryRun,
): DeliveryRun {
  const cycle = run.documentReviewState.activeCycle
  if (!cycle || cycle.acceptedSemanticResult)
    throw new Error('document review has no dispatchable cycle')
  if (cycle.transportAttempts >= 2)
    throw new Error('document review transport attempts are exhausted')
  return {
    ...run,
    documentReviewState: {
      ...run.documentReviewState,
      activeCycle: { ...cycle, transportAttempts: cycle.transportAttempts + 1 },
    },
    updatedAt: new Date().toISOString(),
  }
}

export async function buildDocumentReviewDispatch(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<WorkerDispatchRequest> {
  const cycle = input.run.documentReviewState.activeCycle
  if (!cycle || cycle.acceptedSemanticResult || cycle.transportAttempts < 1)
    throw new Error('document review cycle is not ready for dispatch')
  const authority = reviewAuthority(input.run)
  const artifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    cycle.scope,
    authority,
  )
  const changes =
    cycle.mode === 'closure'
      ? artifactDigestChanges(cycle.sourceArtifactDigests, artifacts)
      : []
  if (
    cycle.mode === 'closure' &&
    !exactStringSet(
      changes.map(change => change.path),
      cycle.changedPaths,
    )
  )
    throw new Error('document closure diff changed after the cycle was frozen')
  return {
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-reviewer',
    phase: 'DOCUMENT_REVIEW',
    revision: cycle.sourceRevision,
    allowedPaths: [],
    contract: {
      reviewScope: cycle.scope,
      reviewMode: cycle.mode,
      cycleId: cycle.cycleId,
      reviewAuthority: authority,
      requiredCheckIds: cycle.requiredCheckIds,
      reviewArtifacts: artifacts.filter(
        artifact => artifact.path !== 'reviewAuthority',
      ),
      ...(cycle.transportCorrection
        ? { transportCorrection: cycle.transportCorrection }
        : {}),
      ...(cycle.mode === 'closure'
        ? {
            priorFindings: findingsForTarget(cycle, cycle.activeTarget!),
            changedPaths: cycle.changedPaths,
            changes: changes.map(change => ({
              path: change.path,
              beforeDigest: change.beforeDigest,
              afterDigest: change.afterDigest,
            })),
          }
        : {}),
    },
  }
}

async function beginDocumentReviewClosure(input: {
  run: DeliveryRun
  workspacePath: string
  currentRevision: string
}): Promise<DeliveryRun> {
  const previous = input.run.documentReviewState.activeCycle
  const target = previous?.activeTarget
  if (!previous || !previous.acceptedSemanticResult || !target)
    throw new Error('document repair has no accepted finding batch')
  const scope: DocumentReviewScope =
    target === 'foundation' ? 'foundation' : 'complete'
  const artifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    scope,
    reviewAuthority(input.run),
  )
  const changes = artifactDigestChanges(previous.sourceArtifactDigests, artifacts)
  const changedPaths = [...new Set(changes.map(change => change.path))]
  const allowedPaths = new Set(
    target === 'foundation'
      ? CANONICAL_FOUNDATION_DOCUMENTS
      : target === 'checklist'
        ? [CHECKLIST_PATH]
        : [...new Set([
            ...artifacts.map(artifact => artifact.path),
            ...Object.keys(previous.sourceArtifactDigests),
          ])]
            .filter(
              path =>
                path === CANONICAL_ASSET_MANIFEST ||
                path.startsWith('assets/content/'),
            ),
  )
  if (!changedPaths.length)
    throw new Error(
      'document remediation produced no canonical revision change',
    )
  if (changedPaths.some(path => !allowedPaths.has(path as never)))
    throw new Error(
      'document remediation changed an artifact owned by another target',
    )
  const cycleId = randomUUID()
  return {
    ...input.run,
    phase: 'DOCUMENT_REVIEW',
    documentStep:
      target === 'foundation' ? 'FOUNDATION_REVIEW' : 'CHECKLIST_REVIEW',
    documentReviewState: {
      ...input.run.documentReviewState,
      activeCycle: {
        cycleId,
        parentCycleId: previous.cycleId,
        originScope: previous.originScope,
        scope,
        mode: 'closure',
        sourceRevision: input.currentRevision,
        requiredCheckIds: [...CLOSURE_CHECKS[target]],
        checks: previous.checks,
        checkEvidenceDigests: previous.checkEvidenceDigests,
        findings: previous.findings,
        activeTarget: target,
        acceptedSemanticResult: false,
        transportAttempts: 0,
        changedPaths,
        sourceArtifactDigests: previous.sourceArtifactDigests,
      },
    },
    activeDispatch: undefined,
    blockedReason: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export async function beginResourceDocumentReviewClosure(input: {
  run: DeliveryRun
  workspacePath: string
  currentRevision: string
}): Promise<DeliveryRun> {
  if (input.run.documentReviewState.activeCycle?.activeTarget !== 'resource')
    return input.run
  return beginDocumentReviewClosure(input)
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
  const cycle = input.run.documentReviewState.activeCycle
  const remediationFindings =
    cycle?.acceptedSemanticResult && cycle.activeTarget === 'foundation'
      ? findingsForTarget(cycle, 'foundation')
      : []
  const allowedPaths = remediationFindings.length
    ? [
        ...new Set(
          remediationFindings.flatMap(finding =>
            finding.subjects.map(subject => subject.path).filter(path =>
              CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never),
            ),
          ),
        ),
      ]
    : [...CANONICAL_FOUNDATION_DOCUMENTS]
  const previousDocumentMetadata = remediationFindings.length
    ? Object.fromEntries(
        allowedPaths.flatMap(path => {
          const metadata = readDocumentMetadata(input.workspacePath, path)
          return metadata ? [[path, metadata]] : []
        }),
      )
    : undefined
  const existingDocumentPaths = remediationFindings.length
    ? []
    : allowedPaths.filter(path => {
        const absolutePath = join(input.workspacePath, path)
        return (
          existsSync(absolutePath) &&
          Boolean(readFileSync(absolutePath, 'utf8').trim())
        )
      })
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    revision: input.run.revision.document,
    allowedPaths,
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      documentSet: 'foundation',
      systemDeliveryContract: buildSystemDeliveryContract(),
      ...(existingDocumentPaths.length ? { existingDocumentPaths } : {}),
      ...(remediationFindings.length
        ? {
            remediation: {
              cycleId: cycle!.cycleId,
              sourceRevision: cycle!.sourceRevision,
              findings: remediationFindings,
            },
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
  const cycle = input.run.documentReviewState.activeCycle
  const remediationFindings =
    cycle?.acceptedSemanticResult && cycle.activeTarget === 'checklist'
      ? findingsForTarget(cycle, 'checklist')
      : []
  const previousChecklistMetadata =
    remediationFindings.length || input.run.checklistRemediation
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
        input.run.documentReviewState.foundationApproval?.revision ??
        input.run.revision.document,
      ...(input.run.checklistRemediation
        ? { checklistRemediation: input.run.checklistRemediation }
        : {}),
      ...(remediationFindings.length
        ? {
            remediation: {
              cycleId: cycle!.cycleId,
              sourceRevision: cycle!.sourceRevision,
              findings: remediationFindings,
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
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
        includeAssetManifest: false,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
        includeAssetManifest: false,
      })
  const foundationReadiness =
    documentSet === 'checklist'
      ? input.audit
        ? input.audit(input.workspacePath, {
            includeChecklist: false,
            includeAssetManifest: false,
          })
        : await defaultAudit(input.workspacePath, {
            includeChecklist: false,
            includeAssetManifest: false,
          })
      : undefined
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
  const cycle = input.run.documentReviewState.activeCycle
  const target: RemediationTarget =
    documentSet === 'checklist' ? 'checklist' : 'foundation'
  const remediationFindings =
    cycle?.acceptedSemanticResult && cycle.activeTarget === target
      ? findingsForTarget(cycle, target)
      : []
  const expectedFindingIds = remediationFindings.map(
    finding => finding.findingId,
  )
  const resolvedFindingIds = [
    ...new Set(input.terminal.resolvedFindingIds ?? []),
  ]
  const resolutionComplete = exactStringSet(
    expectedFindingIds,
    resolvedFindingIds,
  )
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
  const checklistCanBeRemediated =
    documentSet === 'checklist' &&
    !readiness.valid &&
    foundationReadiness?.valid === true &&
    outOfScope.length === 0 &&
    remediationFindings.length === 0
  const checklistAttempt = checklistCanBeRemediated
    ? (input.run.checklistRemediation?.attempt ?? 0) + 1
    : undefined
  const checklistRetryAvailable =
    checklistAttempt !== undefined &&
    checklistAttempt <= MAX_CHECKLIST_REMEDIATION_ATTEMPTS
  const issues = [
    ...readiness.issues,
    ...(outOfScope.length
      ? [
          `document author wrote outside the document scope: ${outOfScope.join(', ')}`,
        ]
      : []),
    ...(!resolutionComplete
      ? [
          'document author did not resolve the exact active review finding batch',
        ]
      : []),
    ...(remediationFindings.length > 0 &&
    input.terminal.writtenPaths.length === 0
      ? ['document remediation completed without changing a canonical artifact']
      : []),
    ...metadataIssues,
  ]
  let updated: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    activeDispatch: undefined,
    status:
      checklistAttempt !== undefined && !checklistRetryAvailable
        ? 'needs_action'
        : input.run.status,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    ...(documentSet === 'checklist'
      ? {
          checklistRemediation:
            checklistAttempt !== undefined
              ? {
                  sourceRevision: documentRevision,
                  attempt: checklistAttempt,
                  issues: readiness.issues,
                }
              : undefined,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return updated

  if (remediationFindings.length) {
    const currentReviewRevision =
      target === 'foundation'
        ? documentRevision
        : await computeResourceRevision(input.workspacePath, documentRevision)
    if (target === 'checklist')
      updated = {
        ...updated,
        revision: { ...updated.revision, resource: currentReviewRevision },
        checklistRemediation: undefined,
      }
    return beginDocumentReviewClosure({
      run: updated,
      workspacePath: input.workspacePath,
      currentRevision: currentReviewRevision,
    })
  }

  return {
    ...updated,
    phase:
      documentSet === 'checklist' ? 'RESOURCE_PREPARATION' : 'DOCUMENT_REVIEW',
    documentStep: documentSet === 'checklist' ? undefined : 'FOUNDATION_REVIEW',
    ...(documentSet === 'checklist' ? { checklistRemediation: undefined } : {}),
  }
}

async function currentReviewArtifactDigests(input: {
  workspacePath: string
  run: DeliveryRun
  scope: DocumentReviewScope
}): Promise<Record<string, string>> {
  const artifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    input.scope,
    reviewAuthority(input.run),
  )
  return documentReviewArtifactDigests(artifacts)
}

export async function reconcileDocumentReview(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-reviewer' }>
  audit?: ReadinessAudit
  currentDocumentRevision?: string
  scope?: DocumentReviewScope
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'DOCUMENT_REVIEW')
    throw new Error('document review is not the active phase')
  const cycle = input.run.documentReviewState.activeCycle
  if (!cycle || cycle.acceptedSemanticResult)
    throw new Error('document review terminal has no unique active cycle')
  const scope = input.scope ?? cycle.scope
  if (scope !== cycle.scope)
    throw new Error('document review scope does not match the active cycle')
  if (input.terminal.revision !== cycle.sourceRevision)
    throw new Error(
      'document review terminal does not match the frozen revision',
    )
  if (
    input.currentDocumentRevision &&
    input.currentDocumentRevision !== cycle.sourceRevision
  )
    throw new Error('canonical artifacts changed during document review')
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: scope === 'complete',
        includeAssetManifest: scope === 'complete',
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: scope === 'complete',
        includeAssetManifest: scope === 'complete',
      })
  if (!readiness.valid)
    throw new Error(
      `document review cannot be reconciled: ${readiness.issues.join('; ')}`,
    )
  if (!isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath))
    throw new Error(
      'document review evidence is outside the workflow evidence directory',
    )
  if (
    !exactStringSet(
      input.terminal.reviewedDocumentPaths,
      expectedReviewPaths(scope),
    )
  )
    throw new Error('document review does not cover the frozen artifact set')
  const expectedChecklistIds =
    scope === 'complete'
      ? await readAcceptanceChecklistIds(input.workspacePath)
      : []
  if (!exactStringSet(input.terminal.checklistIds, expectedChecklistIds))
    throw new Error('document review does not cover the current checklist IDs')

  const artifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    scope,
    reviewAuthority(input.run),
  )
  const contractIssues = [
    ...validateDocumentReviewChecks({
      scope,
      checks: input.terminal.checks,
      artifacts,
    }).filter(issue =>
      cycle.requiredCheckIds.length ===
      requiredDocumentReviewCheckIds(scope).length
        ? true
        : issue !== 'document review does not cover the required check set',
    ),
    ...(!exactStringSet(
      input.terminal.checks.map(check => check.id),
      cycle.requiredCheckIds,
    )
      ? ['document review does not cover the cycle required check set']
      : []),
    ...validateDocumentReviewFindingSubjects({
      findings: input.terminal.findings.map((finding, index) => ({
        ...finding,
        id: `submitted-${index}`,
      })),
      artifacts,
    }),
    ...closureContractIssues({ cycle, findings: input.terminal.findings }),
  ]
  if (contractIssues.length)
    throw new Error([...new Set(contractIssues)].join('; '))

  const findings = normalizedReviewFindings(cycle, input.terminal.findings)
  const submittedDigests = checkEvidenceDigests({
    checks: input.terminal.checks,
    artifacts,
  })
  const mergedChecks = mergeChecks(cycle.checks, input.terminal.checks)
  const mergedDigests = mergeCheckDigests(
    cycle.checkEvidenceDigests,
    submittedDigests,
  )
  const acceptedCycle: DocumentReviewCycle = {
    ...cycle,
    checks: mergedChecks,
    checkEvidenceDigests: mergedDigests,
    findings,
    acceptedSemanticResult: true,
    transportCorrection: undefined,
    evidencePath: input.terminal.evidencePath,
  }
  const base: DeliveryRun = {
    ...input.run,
    activeDispatch: undefined,
    documentReviewState: {
      ...input.run.documentReviewState,
      activeCycle: acceptedCycle,
    },
    updatedAt: new Date().toISOString(),
  }
  if (input.terminal.verdict === 'BLOCKED')
    return {
      ...base,
      status: 'needs_action',
      blockedReason:
        'document reviewer could not complete the frozen check contract',
    }

  if (cycle.mode === 'initial') {
    if (input.terminal.verdict === 'NEEDS_REVISION') {
      const target = nextTarget(findings)
      return routeToRemediation(
        {
          ...base,
          documentReviewState: {
            ...base.documentReviewState,
            activeCycle: { ...acceptedCycle, activeTarget: target },
          },
        },
        target,
      )
    }
    const approval = {
      scope,
      revision: cycle.sourceRevision,
      checks: input.terminal.checks,
      checkEvidenceDigests: submittedDigests,
      evidencePath: input.terminal.evidencePath,
      approvedAt: new Date().toISOString(),
    }
    return scope === 'foundation'
      ? {
          ...base,
          status: 'running',
          documentStep: 'CHECKLIST_DRAFTING',
          blockedReason: undefined,
          documentReviewState: {
            ...base.documentReviewState,
            foundationApproval: approval,
            activeCycle: undefined,
          },
        }
      : {
          ...base,
          phase: 'ATOMIC_TASK_PLANNING',
          documentStep: undefined,
          status: 'running',
          blockedReason: undefined,
          documentReviewState: {
            ...base.documentReviewState,
            comprehensiveApproval: approval,
            activeCycle: undefined,
          },
        }
  }

  const target = cycle.activeTarget!
  const untouchedFindings = cycle.findings.filter(
    finding => finding.owner !== target,
  )
  if (input.terminal.verdict === 'NEEDS_REVISION') {
    const sourceArtifactDigests = await currentReviewArtifactDigests({
      workspacePath: input.workspacePath,
      run: base,
      scope,
    })
    const repairCycle: DocumentReviewCycle = {
      ...acceptedCycle,
      cycleId: randomUUID(),
      parentCycleId: cycle.cycleId,
      findings: [...untouchedFindings, ...findings],
      activeTarget: target,
      sourceArtifactDigests,
      changedPaths: [],
    }
    return routeToRemediation(
      {
        ...base,
        documentReviewState: {
          ...base.documentReviewState,
          activeCycle: repairCycle,
        },
      },
      target,
    )
  }

  if (cycle.originScope === 'complete' && target === 'foundation') {
    const approval = {
      scope: 'foundation' as const,
      revision: cycle.sourceRevision,
      checks: input.terminal.checks,
      checkEvidenceDigests: submittedDigests,
      evidencePath: input.terminal.evidencePath,
      approvedAt: new Date().toISOString(),
    }
    return {
      ...base,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      status: 'running',
      revision: {
        ...base.revision,
        resource: undefined,
        implementation: undefined,
      },
      tasks: [],
      evidence: {},
      blockedReason: undefined,
      documentReviewState: {
        ...base.documentReviewState,
        foundationApproval: approval,
        comprehensiveApproval: undefined,
        activeCycle: undefined,
      },
    }
  }

  if (untouchedFindings.length) {
    const queuedTarget = nextTarget(untouchedFindings)
    const sourceArtifactDigests = await currentReviewArtifactDigests({
      workspacePath: input.workspacePath,
      run: base,
      scope: cycle.originScope,
    })
    return routeToRemediation(
      {
        ...base,
        documentReviewState: {
          ...base.documentReviewState,
          activeCycle: {
            ...acceptedCycle,
            cycleId: randomUUID(),
            parentCycleId: cycle.cycleId,
            scope: cycle.originScope,
            sourceRevision: cycle.sourceRevision,
            requiredCheckIds: [...CLOSURE_CHECKS[queuedTarget]],
            findings: untouchedFindings,
            activeTarget: queuedTarget,
            sourceArtifactDigests,
            changedPaths: [],
          },
        },
      },
      queuedTarget,
    )
  }

  const approvalScope = cycle.originScope
  const approvalArtifacts = await readDocumentReviewArtifacts(
    input.workspacePath,
    approvalScope,
    reviewAuthority(base),
  )
  const issues = approvalIssues({
    scope: approvalScope,
    checks: mergedChecks,
    checkEvidenceDigests: mergedDigests,
    artifacts: approvalArtifacts,
  })
  if (issues.length)
    return {
      ...base,
      status: 'needs_action',
      blockedReason: issues.join('; '),
    }
  const approval = {
    scope: approvalScope,
    revision: cycle.sourceRevision,
    checks: mergedChecks,
    checkEvidenceDigests: mergedDigests,
    evidencePath: input.terminal.evidencePath,
    approvedAt: new Date().toISOString(),
  }
  return approvalScope === 'foundation'
    ? {
        ...base,
        status: 'running',
        documentStep: 'CHECKLIST_DRAFTING',
        blockedReason: undefined,
        documentReviewState: {
          ...base.documentReviewState,
          foundationApproval: approval,
          activeCycle: undefined,
        },
      }
    : {
        ...base,
        phase: 'ATOMIC_TASK_PLANNING',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        documentReviewState: {
          ...base.documentReviewState,
          comprehensiveApproval: approval,
          activeCycle: undefined,
        },
      }
}
