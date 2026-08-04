import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { readAcceptanceChecklistIds } from '../document-readiness-audit'
import { resolveWorkflowEvidencePath } from './evidence'
import {
  buildDocumentReviewWireReferenceIndex,
  checkEvidenceDigests,
  documentReviewArtifactDigests,
  readDocumentReviewArtifacts,
  requiredDocumentReviewCheckIds,
  validateDocumentReviewSubmission,
  type DocumentReviewArtifact,
  type ReviewAuthority,
} from './document-review-input'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import {
  buildSystemDeliveryContract,
  SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
} from './system-delivery-contract'
import { transitionDeliveryRun } from './transition'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
  type DocumentReviewCheck,
  type DocumentReviewCheckId,
  type DocumentReviewCycle,
  type DocumentReviewFinding,
  type DocumentReviewScope,
  type FoundationDocumentPath,
  type WorkerDispatchRequest,
} from './types'

const INITIAL_FOUNDATION_UPSTREAM_PATHS: Record<
  FoundationDocumentPath,
  readonly FoundationDocumentPath[]
> = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': ['docs/GDD.md'],
  'docs/BALANCE_DESIGN.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/TECHNICAL_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  'docs/ART_DIRECTION.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/UI_UX_SPEC.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/AUDIO_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/UI_UX_SPEC.md',
  ],
  'docs/ASSET_PLAN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
}
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

const CHECKLIST_PATH = 'docs/acceptance/gameplay-checklist.md'
const SYSTEM_CONTRACT_PATH = 'systemDeliveryContract'

const REVIEW_ARTIFACT_PATHS_BY_CHECK: Record<
  DocumentReviewCheckId,
  readonly string[] | 'all'
> = {
  brief_alignment: 'all',
  cross_document_consistency: 'all',
  gameplay_completeness: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
  gameplay_strategy_viability: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  economy_progression_integrity: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
  numeric_balance_feasibility: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  pacing_difficulty_coherence: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  level_scene_design_integrity: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
  ],
  technical_feasibility: [
    SYSTEM_CONTRACT_PATH,
    'docs/TECHNICAL_DESIGN.md',
    'docs/ASSET_PLAN.md',
  ],
  art_direction_coherence: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/ASSET_PLAN.md',
  ],
  ui_audio_consistency: [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
  acceptance_observability: 'all',
  checklist_traceability: 'all',
  resource_semantic_fitness: 'all',
  content_structure_fitness: 'all',
  resource_content_consistency: 'all',
  implementation_readiness: 'all',
}

function artifactsForReviewCheck(
  artifacts: DocumentReviewArtifact[],
  checkId: DocumentReviewCheckId,
): DocumentReviewArtifact[] {
  const selected = REVIEW_ARTIFACT_PATHS_BY_CHECK[checkId]
  if (selected === 'all') return artifacts
  const paths = new Set(selected)
  return artifacts.filter(
    artifact => artifact.path === 'reviewAuthority' || paths.has(artifact.path),
  )
}

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
    ...GAME_DESIGN_DOCUMENT_REVIEW_CHECK_IDS,
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
  return cycle?.findings.filter(finding => finding.owner === target) ?? []
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
  if (target === 'resource')
    return transitionDeliveryRun(run, {
      type: 'resource_review_remediation_required',
    })
  const completedPasses = run.documentReviewState.repairPasses[target]
  return {
    ...run,
    phase: target === 'foundation' ? 'DOCUMENT_DRAFTING' : 'DOCUMENT_REVIEW',
    documentStep:
      target === 'foundation' ? 'FOUNDATION_DRAFTING' : 'CHECKLIST_DRAFTING',
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

export function restoreAcceptedReviewRemediationHandoff(
  run: DeliveryRun,
): DeliveryRun | undefined {
  const cycle = run.documentReviewState.activeCycle
  const target = cycle?.activeTarget
  if (!cycle?.acceptedSemanticResult || !target) return undefined
  const completedPasses = run.documentReviewState.repairPasses[target]
  if (completedPasses <= 0) return undefined
  if (target === 'resource') {
    if (run.phase === 'RESOURCE_PREPARATION' && run.documentStep === undefined)
      return undefined
    return transitionDeliveryRun(run, {
      type: 'resource_preparation_required',
    })
  }
  const expectedPhase =
    target === 'foundation' ? 'DOCUMENT_DRAFTING' : 'DOCUMENT_REVIEW'
  const expectedDocumentStep =
    target === 'foundation' ? 'FOUNDATION_DRAFTING' : 'CHECKLIST_DRAFTING'
  if (run.phase === expectedPhase && run.documentStep === expectedDocumentStep)
    return undefined
  return {
    ...run,
    phase: expectedPhase,
    documentStep: expectedDocumentStep,
    status: 'running',
    activeDispatch: undefined,
    blockedReason: undefined,
    tasks: [],
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
        completedCheckIds: [],
        checks: [],
        checkEvidenceDigests: {},
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests,
      },
    },
    updatedAt: new Date().toISOString(),
  }
}

export async function buildDocumentReviewDispatch(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<WorkerDispatchRequest> {
  const cycle = input.run.documentReviewState.activeCycle
  if (!cycle || cycle.acceptedSemanticResult)
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
  const currentCheckId = cycle.requiredCheckIds.find(
    id => !cycle.completedCheckIds.includes(id),
  )
  if (!currentCheckId)
    throw new Error('document review cycle has no incomplete check')
  const checkArtifacts = artifactsForReviewCheck(artifacts, currentCheckId)
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
      currentCheckId,
      referenceIndex: buildDocumentReviewWireReferenceIndex(checkArtifacts),
      reviewArtifacts: checkArtifacts.filter(
        artifact => artifact.path !== 'reviewAuthority',
      ),
      ...(cycle.findings.length
        ? {
            priorFindings: cycle.findings.map(finding => ({
              findingId: finding.findingId,
              checkId: finding.checkId,
              owner: finding.owner,
              subjects: finding.subjects,
              blockingReason: finding.blockingReason,
              requiredAction: finding.requiredAction,
              closureCondition: finding.closureCondition,
            })),
          }
        : {}),
      ...(cycle.mode === 'closure'
        ? {
            activeTarget: cycle.activeTarget,
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
  const closureArtifactPaths = new Set(artifacts.map(artifact => artifact.path))
  const sourceArtifactDigests = Object.fromEntries(
    Object.entries(previous.sourceArtifactDigests).filter(([path]) =>
      closureArtifactPaths.has(path),
    ),
  )
  const changes = artifactDigestChanges(sourceArtifactDigests, artifacts)
  const changedPaths = [...new Set(changes.map(change => change.path))]
  const allowedPaths = new Set(
    target === 'foundation'
      ? CANONICAL_FOUNDATION_DOCUMENTS
      : target === 'checklist'
        ? [CHECKLIST_PATH]
        : [
            ...new Set([
              ...artifacts.map(artifact => artifact.path),
              ...Object.keys(previous.sourceArtifactDigests),
            ]),
          ].filter(
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
        completedCheckIds: [],
        checks: previous.checks,
        checkEvidenceDigests: previous.checkEvidenceDigests,
        findings: previous.findings,
        activeTarget: target,
        acceptedSemanticResult: false,
        changedPaths,
        sourceArtifactDigests,
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
  const repairPlan = remediationFindings.length ? cycle?.repairPlan : undefined
  const plannedFindingIds = new Set(
    repairPlan?.groups.flatMap(group => group.findingIds) ?? [],
  )
  const nextPlanningFinding = remediationFindings.find(
    finding => !plannedFindingIds.has(finding.findingId),
  )
  const repairDecisionAuthorityReferences = nextPlanningFinding
    ? [...nextPlanningFinding.subjects, ...nextPlanningFinding.evidence]
        .filter(
          reference =>
            CANONICAL_FOUNDATION_DOCUMENTS.includes(reference.path as never) ||
            reference.path === SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH,
        )
        .filter(
          (reference, index, all) =>
            all.findIndex(
              candidate =>
                candidate.path === reference.path &&
                candidate.anchor === reference.anchor,
            ) === index,
        )
    : []
  const repairPlanComplete =
    remediationFindings.length > 0 && !nextPlanningFinding
  const repairPaths =
    repairPlanComplete && repairPlan
      ? CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
          repairPlan.groups.some(group => group.affectedPaths.includes(path)),
        )
      : []
  const repairPath =
    repairPlanComplete && repairPlan
      ? repairPaths.find(path => !repairPlan.completedPaths.includes(path))
      : undefined
  const initialPath = remediationFindings.length
    ? undefined
    : CANONICAL_FOUNDATION_DOCUMENTS[
        input.run.foundationDraftState.completedPaths.length
      ]
  if (!remediationFindings.length && !initialPath)
    throw new Error(
      'foundation drafting has no remaining canonical document task',
    )
  const allowedPaths = remediationFindings.length
    ? repairPath
      ? [repairPath]
      : []
    : [initialPath!]
  const previousDocumentMetadata = remediationFindings.length
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
    taskId: remediationFindings.length
      ? (repairPath ??
        `${cycle!.cycleId}:repair-decision:${nextPlanningFinding!.findingId}`)
      : initialPath,
    revision: input.run.revision.document,
    allowedPaths,
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      ...(input.run.changeRequest
        ? { changeRequest: input.run.changeRequest }
        : {}),
      documentSet: 'foundation',
      systemDeliveryContract: buildSystemDeliveryContract(),
      ...(initialPath
        ? {
            authoringMode: 'initial',
            foundationDocumentPath: initialPath,
            upstreamDocumentPaths: [
              ...INITIAL_FOUNDATION_UPSTREAM_PATHS[initialPath],
            ],
          }
        : repairPath
          ? {
              authoringMode: 'remediation',
              foundationDocumentPath: repairPath,
              repairTask: {
                cycleId: cycle!.cycleId,
                groups: repairPlan!.groups.filter(group =>
                  group.affectedPaths.includes(repairPath),
                ),
                findings: remediationFindings.filter(finding =>
                  repairPlan!.groups.some(
                    group =>
                      group.affectedPaths.includes(repairPath) &&
                      group.findingIds.includes(finding.findingId),
                  ),
                ),
              },
            }
          : {
              authoringMode: 'repair-planning',
              repairDecisionTask: {
                cycleId: cycle!.cycleId,
                finding: nextPlanningFinding,
                authorityReferences: repairDecisionAuthorityReferences,
              },
            }),
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
  const cycle = input.run.documentReviewState.activeCycle
  const target: RemediationTarget =
    documentSet === 'checklist' ? 'checklist' : 'foundation'
  const remediationFindings =
    cycle?.acceptedSemanticResult && cycle.activeTarget === target
      ? findingsForTarget(cycle, target)
      : []
  if (documentSet === 'foundation' && remediationFindings.length === 0)
    return completeInitialFoundationDocumentDraft(input)
  if (
    documentSet === 'foundation' &&
    input.run.activeDispatch?.request?.contract.authoringMode ===
      'repair-planning'
  )
    return completeFoundationRepairPlanning(input, cycle, remediationFindings)
  if (documentSet === 'foundation' && cycle?.repairPlan)
    return completeFoundationRepairOwner(input, cycle, remediationFindings)

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
    status: input.run.status,
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

  return documentSet === 'checklist'
    ? transitionDeliveryRun(
        { ...updated, checklistRemediation: undefined },
        { type: 'resource_preparation_required' },
      )
    : {
        ...updated,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
      }
}

function completeFoundationRepairPlanning(
  input: {
    run: DeliveryRun
    workspacePath: string
    terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  },
  cycle: DocumentReviewCycle | undefined,
  findings: DocumentReviewFinding[],
): DeliveryRun {
  if (!cycle || findings.length === 0)
    throw new Error('foundation repair planning has no accepted finding batch')
  const decision = input.terminal.repairDecision
  const plannedFindingIds = new Set(
    cycle.repairPlan?.groups.flatMap(group => group.findingIds) ?? [],
  )
  const finding = findings.find(
    candidate => !plannedFindingIds.has(candidate.findingId),
  )
  const affectedPaths = finding
    ? [
        ...new Set(
          finding.subjects.flatMap(subject =>
            CANONICAL_FOUNDATION_DOCUMENTS.includes(subject.path as never)
              ? [
                  subject.path as (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
                ]
              : [],
          ),
        ),
      ]
    : []
  const issues = [
    ...(!finding
      ? ['document repair decision cursor is already complete']
      : []),
    ...(!decision
      ? ['document repair planner did not submit a repair decision']
      : []),
    ...(finding && affectedPaths.length === 0
      ? ['document repair finding has no canonical foundation subjects']
      : []),
    ...(input.terminal.writtenPaths.length
      ? ['document repair planner cannot write project files']
      : []),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['document repair planner cannot resolve findings']
      : []),
  ]
  return {
    ...input.run,
    activeDispatch: undefined,
    currentItemId: undefined,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    documentReviewState: {
      ...input.run.documentReviewState,
      activeCycle:
        issues.length || !decision || !finding
          ? cycle
          : {
              ...cycle,
              repairPlan: {
                groups: [
                  ...(cycle.repairPlan?.groups ?? []),
                  {
                    groupId: `repair-${finding.findingId}`,
                    findingIds: [finding.findingId],
                    decision: decision.decision,
                    affectedPaths,
                    dependsOn: [],
                  },
                ],
                completedPaths: [],
              },
            },
    },
    updatedAt: new Date().toISOString(),
  }
}

async function completeFoundationRepairOwner(
  input: {
    run: DeliveryRun
    workspacePath: string
    terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
    audit?: ReadinessAudit
  },
  cycle: DocumentReviewCycle,
  findings: DocumentReviewFinding[],
): Promise<DeliveryRun> {
  const plan = cycle.repairPlan!
  const repairPaths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
    plan.groups.some(group => group.affectedPaths.includes(path)),
  )
  const expectedPath = repairPaths.find(
    path => !plan.completedPaths.includes(path),
  )
  if (!expectedPath)
    throw new Error('foundation repair cursor is already complete')
  const requestPath =
    input.run.activeDispatch?.request?.contract.foundationDocumentPath
  const writtenPaths = input.terminal.writtenPaths.map(path =>
    path.replaceAll('\\', '/'),
  )
  const issues = [
    ...(requestPath !== expectedPath
      ? ['document repair dispatch does not match the durable owner cursor']
      : []),
    ...(!exactStringSet(writtenPaths, [expectedPath])
      ? [`document repair owner must write exactly ${expectedPath}`]
      : []),
    ...(input.terminal.repairDecision
      ? ['document repair owner cannot replace the accepted repair plan']
      : []),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['document repair owner cannot declare finding closure']
      : []),
    ...documentMetadataIssues({
      workspacePath: input.workspacePath,
      writtenPaths,
      previous:
        input.run.activeDispatch?.request?.contract.previousDocumentMetadata,
    }),
  ]
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const base: DeliveryRun = {
    ...input.run,
    activeDispatch: undefined,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    blockedReason: issues.length ? issues.join('; ') : undefined,
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return base
  const completedPaths = [...plan.completedPaths, expectedPath]
  const updated: DeliveryRun = {
    ...base,
    currentItemId: expectedPath,
    documentReviewState: {
      ...base.documentReviewState,
      activeCycle: {
        ...cycle,
        repairPlan: { ...plan, completedPaths },
      },
    },
  }
  if (completedPaths.length < repairPaths.length) return updated
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
      })
  if (!readiness.valid)
    return { ...updated, blockedReason: readiness.issues.join('; ') }
  if (
    !exactStringSet(
      findings.map(finding => finding.findingId),
      plan.groups.flatMap(group => group.findingIds),
    )
  )
    return {
      ...updated,
      blockedReason:
        'completed repair plan no longer covers the active finding ledger',
    }
  return beginDocumentReviewClosure({
    run: updated,
    workspacePath: input.workspacePath,
    currentRevision: documentRevision,
  })
}

async function completeInitialFoundationDocumentDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
}): Promise<DeliveryRun> {
  const completedPaths = input.run.foundationDraftState.completedPaths
  const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[completedPaths.length]
  if (!expectedPath)
    throw new Error('foundation initial-authoring cursor is already complete')

  const normalizedWrittenPaths = input.terminal.writtenPaths.map(path =>
    path.split('\\').join('/'),
  )
  const metadata = readDocumentMetadata(input.workspacePath, expectedPath)
  const version = metadata ? parseSemanticVersion(metadata.version) : undefined
  const issues = [
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
    activeDispatch: undefined,
    currentItemId: expectedPath,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return base

  const nextCompletedPaths = [...completedPaths, expectedPath]
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
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: false,
        includeAssetManifest: false,
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
  const acceptedEvidencePath = resolveWorkflowEvidencePath(
    input.workspacePath,
    input.terminal.evidencePath,
  )
  if (!acceptedEvidencePath)
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
  const contractIssues = validateDocumentReviewSubmission({
    contract: {
      scope,
      mode: cycle.mode,
      requiredCheckIds: cycle.requiredCheckIds,
      currentCheckId: input.terminal.checks[0]!.id,
      artifacts,
      ...(cycle.activeTarget ? { activeTarget: cycle.activeTarget } : {}),
      ...(cycle.findings.length ? { priorFindings: cycle.findings } : {}),
      ...(cycle.mode === 'closure'
        ? {
            priorFindings: findingsForTarget(
              cycle,
              cycle.activeTarget ?? 'foundation',
            ),
            changedPaths: cycle.changedPaths,
          }
        : {}),
    },
    checks: input.terminal.checks,
    findings: input.terminal.findings,
  })
  if (contractIssues.length)
    throw new Error([...new Set(contractIssues)].join('; '))

  const submittedCheck = input.terminal.checks[0]
  if (!submittedCheck || input.terminal.checks.length !== 1)
    throw new Error('document reviewer must submit exactly one active check')
  if (cycle.completedCheckIds.includes(submittedCheck.id))
    throw new Error('document reviewer cannot replace an accepted check')
  const existingFindingIds = new Set(
    cycle.findings.map(finding => finding.findingId),
  )
  if (
    input.terminal.findings.some(finding =>
      existingFindingIds.has(finding.findingId),
    )
  )
    throw new Error('document reviewer finding ID is already accepted')

  await mkdir(dirname(acceptedEvidencePath), { recursive: true })
  await writeFile(
    acceptedEvidencePath,
    `${JSON.stringify(input.terminal, null, 2)}\n`,
    'utf8',
  )

  const submittedFindings = normalizedReviewFindings(
    cycle,
    input.terminal.findings,
  )
  const findings =
    cycle.mode === 'closure'
      ? [
          ...cycle.findings.filter(
            finding => finding.checkId !== submittedCheck.id,
          ),
          ...submittedFindings,
        ]
      : [...cycle.findings, ...submittedFindings]
  const submittedDigests = checkEvidenceDigests({
    checks: input.terminal.checks,
    artifacts,
  })
  const mergedChecks = mergeChecks(cycle.checks, input.terminal.checks)
  const completedCheckIds = [...cycle.completedCheckIds, submittedCheck.id]
  const mergedDigests = mergeCheckDigests(
    cycle.checkEvidenceDigests,
    submittedDigests,
  )
  const acceptedCycle: DocumentReviewCycle = {
    ...cycle,
    checks: mergedChecks,
    completedCheckIds,
    checkEvidenceDigests: mergedDigests,
    findings,
    acceptedSemanticResult:
      completedCheckIds.length === cycle.requiredCheckIds.length,
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
  if (!acceptedCycle.acceptedSemanticResult)
    return {
      ...base,
      status: 'running',
      blockedReason: undefined,
      currentItemId: cycle.requiredCheckIds.find(
        id => !completedCheckIds.includes(id),
      ),
    }

  const verdict = mergedChecks.some(
    check =>
      cycle.requiredCheckIds.includes(check.id) && check.status === 'block',
  )
    ? 'NEEDS_REVISION'
    : 'READY'

  if (cycle.mode === 'initial') {
    if (verdict === 'NEEDS_REVISION') {
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
      checks: mergedChecks,
      checkEvidenceDigests: mergedDigests,
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
  if (verdict === 'NEEDS_REVISION') {
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
      checks: mergedChecks,
      checkEvidenceDigests: mergedDigests,
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
