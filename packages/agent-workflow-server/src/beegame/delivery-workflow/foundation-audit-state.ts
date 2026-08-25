import { z } from 'zod/v4'
import { relativeFoundationAuditArtifactPaths, type FoundationAuditManifest } from './foundation-audit-artifacts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DispatchRecord, type FoundationDocumentPath, type WorkflowUsage } from './types'
import type { FoundationFactTask } from './foundation-fact-runtime'
import type { FoundationSemanticResult } from './foundation-semantic-audit'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './foundation-semantic-audit'
import type { FoundationSemanticRuntimeTask } from './foundation-semantic-runtime'
import type { AuditIssue } from './foundation-issue-registry'
import { foundationRevisionDocumentReceiptMatches, foundationRevisionPacketPath, foundationRevisionSemanticResultPath, foundationRevisionStagePath } from './foundation-revision-stage'

export const FOUNDATION_AUDIT_STATE_SCHEMA_VERSION = 8 as const
export const FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT = 'foundation-audit-state-v8' as const
export type FoundationIssueSummary = {
  total: number
  blocker: number
  high: number
  medium: number
  low: number
}

export function summarizeFoundationIssues(
  issues: readonly Pick<AuditIssue, 'severity'>[],
): FoundationIssueSummary {
  const summary: FoundationIssueSummary = {
    total: issues.length,
    blocker: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const issue of issues) {
    if (issue.severity === 'BLOCKER') summary.blocker += 1
    else if (issue.severity === 'HIGH') summary.high += 1
    else if (issue.severity === 'MEDIUM') summary.medium += 1
    else if (issue.severity === 'LOW') summary.low += 1
  }
  return summary
}
/** A durable revision round is any positive integer; cases converge dynamically. */
export type FoundationRevisionRound = number
export type FoundationRevisionPhase = 'planning' | 'revising' | 'rebuilding_facts' | 'validating' | 'semantic_recheck' | 'publishing' | 'round_closing'
export type FoundationRevisionTaskStatus = 'pending' | 'running' | 'completed' | 'retryable' | 'needs_action'
export type FoundationRevisionAuthority = {
  issueAuthority:
    | { kind: 'review'; reviewDigest: string; issueRegistryDigest: string }
    | { kind: 'publication'; baseRevision: string; authorityDigest: string; issueRegistryDigest: string }
  derivedDigests: { sectionIndex: string; factStore: string; manifest: string }
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
}
export type FoundationRevisionTaskReceipt = {
  taskId: string
  round: FoundationRevisionRound
  documentPath: FoundationDocumentPath
  issueIds: string[]
  baseDocumentDigest: string
  stagedDocumentDigest: string
  changedSectionIds: string[]
  stagedPath: string
  terminalDigest: string
}
export type FoundationRevisionTaskCommon = {
  taskId: string
  kind: 'document-revision' | 'impacted-facts' | 'semantic-recheck'
  revision: string
  round: FoundationRevisionRound
  packetPath: string
  packetDigest: string
  attempt: number
  status: FoundationRevisionTaskStatus
  dispatch?: DispatchRecord
  terminalDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}
export type FoundationRevisionDocumentTask = FoundationRevisionTaskCommon & {
  kind: 'document-revision'
  documentPath: FoundationDocumentPath
  issueIds: string[]
  sectionIds: string[]
  stagedPath: string
  baseDocumentDigest: string
  receipt?: FoundationRevisionTaskReceipt
}
export type FoundationRevisionImpactedFactsTask = FoundationRevisionTaskCommon & {
  kind: 'impacted-facts'
  modelTier: 'fast'
  receiptPath?: string
  receiptDigest?: string
}
export type FoundationRevisionSemanticRecheckTask = FoundationRevisionTaskCommon & {
  kind: 'semantic-recheck'
  issueId: string
  modelTier: 'fast' | 'balanced' | 'strong'
  resultPath?: string
  resultDigest?: string
}
export type FoundationRevisionPublicationBinding = {
  preparedPath: string
  journalPath: string
  committedPath: string
  authorityDigest: string
  resultingRevision: string
  resultingIssueRegistryDigest: string
}
export type FoundationRevisionTask = FoundationRevisionDocumentTask | FoundationRevisionImpactedFactsTask | FoundationRevisionSemanticRecheckTask
export type FoundationAuditStatus = 'index_staged' | 'extracting_facts' | 'facts_staged' | 'derived_committed' | 'deterministic_ready' | 'semantic_review' | 'audit_ready' | 'revision_ready' | FoundationRevisionPhase
export type FoundationAuditState = {
  schemaVersion: typeof FOUNDATION_AUDIT_STATE_SCHEMA_VERSION
  schemaFingerprint: typeof FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT
  status: FoundationAuditStatus
  revision: string
  documentDigests: Record<FoundationDocumentPath, string>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  tasks: FoundationAuditTask[]
  /** Revision is a mutually-exclusive substage on this same durable state. */
  authority?: FoundationRevisionAuthority
  roundBefore?: {
    documentRevision: string
    issueRegistryDigest: string
    issueAuthority: FoundationRevisionAuthority['issueAuthority']
  }
  round?: FoundationRevisionRound
  issueSummary?: FoundationIssueSummary
  publication?: FoundationRevisionPublicationBinding
  phaseStartedAt?: string
  aggregateUsage?: FoundationFactTask['usage']
  derived?: { manifestPath: string; manifestDigest: string; markerPath: string; markerDigest: string; factStorePath: string; factStoreDigest: string; sectionIndexPath: string; sectionIndexDigest: string }
  deterministic?: {
    reviewDigest: string
    issueRegistryPath: string
    issueRegistryDigest: string
    manifestPath: string
    manifestDigest: string
    markerPath: string
    markerDigest: string
    catalogVersion: string
    contractGraphDigest: string
    sectionIndexDigest: string
    factStoreDigest: string
  }
  semantic?: {
    aggregateUsage: FoundationFactTask['usage']
    deepPhaseStartedAt?: string
    deepAggregateUsage?: FoundationFactTask['usage']
  }
  review?: {
    reviewDigest: string
    issueRegistryPath: string
    issueRegistryDigest: string
    manifestPath: string
    manifestDigest: string
    markerPath: string
    markerDigest: string
    sectionIndexDigest: string
    factStoreDigest: string
    semanticManifestDigest: string
    issueSummary: FoundationIssueSummary
  }
}
export type FoundationAuditTask = FoundationFactTask | (FoundationSemanticRuntimeTask & { admittedResult?: FoundationSemanticResult }) | FoundationRevisionTask
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeArtifactPath = z.string().refine(value => value.startsWith('.beegame/audit/foundation/') && !value.startsWith('/') && !value.includes('..'), 'foundation audit artifact paths must remain project-local')
const workflowUsageSchema = z.object({ input_tokens: z.number().nonnegative(), cache_read_tokens: z.number().nonnegative(), cache_creation_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), total_tokens: z.number().nonnegative() }).strict()
const issueSummarySchema = z.object({ total: z.number().int().nonnegative(), blocker: z.number().int().nonnegative(), high: z.number().int().nonnegative(), medium: z.number().int().nonnegative(), low: z.number().int().nonnegative() }).strict().superRefine((summary, context) => {
  if (summary.total !== summary.blocker + summary.high + summary.medium + summary.low) context.addIssue({ code: 'custom', path: ['total'], message: 'foundation issue summary total must equal severity counts' })
})
const dispatchSchema = z.object({ dispatchId: z.string().min(1), workerType: z.enum(['foundation-fact-extractor', 'foundation-semantic-reviewer']), phase: z.literal('DOCUMENT_REVIEW'), taskId: z.string().min(1), revision: z.string().min(1), status: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted', 'invalid']), request: z.record(z.string(), z.unknown()).optional(), terminalResult: z.record(z.string(), z.unknown()).optional(), failureReason: z.string().min(1).optional(), startingUsage: workflowUsageSchema.optional(), usage: workflowUsageSchema.optional(), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional() }).strict()
const commonTask = { taskId: z.string().min(1), revision: z.string().min(1), packetDigest: digestSchema, status: z.enum(['pending', 'running', 'retryable', 'completed', 'needs_action']), dispatch: dispatchSchema.optional(), terminalDigest: digestSchema.optional(), usage: workflowUsageSchema.optional(), durationMs: z.number().nonnegative().optional(), failureReason: z.string().min(1).optional() }
const admittedResultSchema = z.object({ checkId: z.string().min(1), packetIdentity: digestSchema, outcome: z.enum(['PASS', 'ISSUES', 'UNDECIDABLE']), issues: z.array(z.object({ problem: z.string().min(1), expected: z.string().min(1), actual: z.string().min(1), sourceSectionKey: z.string().min(1), fixSectionKey: z.string().min(1), reasonCode: z.string().min(1).optional() }).strict()).optional(), reason: z.string().min(1).optional() }).strict().superRefine((result, context) => {
  const issueCount = result.issues?.length ?? 0
  if (result.outcome === 'PASS' && (issueCount || result.reason !== undefined)) context.addIssue({ code: 'custom', path: ['outcome'], message: 'PASS admitted results cannot contain issues or reason' })
  if (result.outcome === 'ISSUES' && (!issueCount || result.reason !== undefined)) context.addIssue({ code: 'custom', path: ['outcome'], message: 'ISSUES admitted results require issue drafts and no reason' })
  if (result.outcome === 'UNDECIDABLE' && (issueCount || !result.reason)) context.addIssue({ code: 'custom', path: ['outcome'], message: 'UNDECIDABLE admitted results require only a reason' })
})
const factTaskSchema = z.object({ ...commonTask, kind: z.literal('document-facts'), factKeyCount: z.number().int().positive(), modelTier: z.literal('fast'), attempt: z.number().int().nonnegative().max(2), receiptPath: relativeArtifactPath.optional(), receiptDigest: digestSchema.optional() }).strict()
const semanticTaskSchema = z.object({ ...commonTask, kind: z.literal('semantic'), checkId: z.string().min(1), modelTier: z.enum(['fast', 'balanced']), attempt: z.number().int().nonnegative().max(2), admittedResult: admittedResultSchema.optional() }).strict()
const confirmationTaskSchema = z.object({ ...commonTask, kind: z.literal('confirmation'), checkId: z.string().min(1), sourceTaskId: z.string().min(1), modelTier: z.literal('strong'), attempt: z.number().int().nonnegative().max(1), admittedResult: admittedResultSchema.optional() }).strict()
const revisionDispatchSchema = z.object({ dispatchId: z.string().min(1), workerType: z.enum(['foundation-document-reviser', 'foundation-fact-extractor', 'foundation-semantic-reviewer']), phase: z.literal('DOCUMENT_REVIEW'), taskId: z.string().min(1), revision: z.string().min(1), status: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted', 'invalid']), terminalEvidencePath: z.string().min(1).optional(), request: z.record(z.string(), z.unknown()).optional(), terminalResult: z.record(z.string(), z.unknown()).optional(), failureReason: z.string().min(1).optional(), startingUsage: workflowUsageSchema.optional(), usage: workflowUsageSchema.optional(), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional() }).strict()
const revisionDigest = z.string().regex(/^[a-f0-9]{64}$/)
const revisionIdentifier = z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
const revisionRoundSchema = z.number().int().positive()
const revisionTaskCommonSchema = z.object({ taskId: revisionIdentifier, revision: revisionIdentifier, round: revisionRoundSchema, packetPath: z.string().min(1), packetDigest: revisionDigest, status: z.enum(['pending', 'running', 'completed', 'retryable', 'needs_action']), attempt: z.number().int().min(0).max(2), dispatch: revisionDispatchSchema.optional(), terminalDigest: revisionDigest.optional(), usage: workflowUsageSchema.optional(), durationMs: z.number().int().nonnegative().optional(), failureReason: z.string().min(1).optional() }).strict()
const revisionReceiptSchema = z.object({ taskId: revisionIdentifier, round: revisionRoundSchema, documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS), issueIds: z.array(z.string().min(1)).min(1), baseDocumentDigest: revisionDigest, stagedDocumentDigest: revisionDigest, changedSectionIds: z.array(z.string().min(1)).min(1), stagedPath: z.string().min(1), terminalDigest: revisionDigest }).strict()
const revisionDocumentTaskSchema = revisionTaskCommonSchema.extend({ kind: z.literal('document-revision'), documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS), issueIds: z.array(z.string().min(1)).min(1), sectionIds: z.array(z.string().min(1)).min(1), stagedPath: z.string().min(1), baseDocumentDigest: revisionDigest, receipt: revisionReceiptSchema.optional() })
const revisionImpactedFactsTaskSchema = revisionTaskCommonSchema.extend({ kind: z.literal('impacted-facts'), modelTier: z.literal('fast'), receiptPath: z.string().min(1).optional(), receiptDigest: revisionDigest.optional() })
const revisionSemanticRecheckTaskSchema = revisionTaskCommonSchema.extend({ kind: z.literal('semantic-recheck'), issueId: z.string().min(1), modelTier: z.enum(['fast', 'balanced', 'strong']), resultPath: z.string().min(1).optional(), resultDigest: revisionDigest.optional() })
const taskSchema = z.discriminatedUnion('kind', [factTaskSchema, semanticTaskSchema, confirmationTaskSchema, revisionDocumentTaskSchema, revisionImpactedFactsTaskSchema, revisionSemanticRecheckTaskSchema]).superRefine((task, context) => {
  if (task.kind === 'document-revision' || task.kind === 'impacted-facts' || task.kind === 'semantic-recheck') {
    const expectedWorker = task.kind === 'document-revision'
      ? 'foundation-document-reviser'
      : task.kind === 'impacted-facts'
        ? 'foundation-fact-extractor'
        : 'foundation-semantic-reviewer'
    if (task.dispatch && (task.dispatch.workerType !== expectedWorker || task.dispatch.taskId !== task.taskId || task.dispatch.revision !== task.revision)) context.addIssue({ code: 'custom', path: ['dispatch'], message: 'revision task dispatch worker identity is not bound to its kind/task/revision' })
    if (task.packetPath !== foundationRevisionPacketPath(task.revision, task.round, task.taskId)) context.addIssue({ code: 'custom', path: ['packetPath'], message: 'revision packet path must be derived from task identity' })
    if (task.kind === 'document-revision' && task.stagedPath !== foundationRevisionStagePath(task.revision, task.documentPath)) context.addIssue({ code: 'custom', path: ['stagedPath'], message: 'revision stage path must be derived from task identity' })
    if (task.kind === 'document-revision' && task.status === 'completed' && !foundationRevisionDocumentReceiptMatches(task as FoundationRevisionDocumentTask)) context.addIssue({ code: 'custom', path: ['receipt'], message: 'completed document revision tasks require receipt and terminalDigest' })
    if (task.kind === 'impacted-facts' && task.status === 'completed' && (!task.receiptPath || !task.receiptDigest)) context.addIssue({ code: 'custom', path: ['receiptPath'], message: 'completed impacted fact tasks require an immutable receipt binding' })
    if (task.kind === 'semantic-recheck' && task.status === 'completed' && (!task.terminalDigest || !task.resultPath || !task.resultDigest || task.resultPath !== foundationRevisionSemanticResultPath(task.revision, task.round, task.taskId))) context.addIssue({ code: 'custom', path: ['resultPath'], message: 'completed semantic result requires identity-bound evidence' })
    if (task.status === 'completed' && (!task.terminalDigest || !task.usage || task.durationMs === undefined || task.dispatch?.status !== 'completed' || !task.dispatch.terminalResult)) context.addIssue({ code: 'custom', path: ['status'], message: 'completed revision tasks require terminal, usage, duration, and dispatch evidence' })
    return
  }
  const expectedWorker = task.kind === 'document-facts' ? 'foundation-fact-extractor' : 'foundation-semantic-reviewer'
  if (task.dispatch && (task.dispatch.workerType !== expectedWorker || task.dispatch.taskId !== task.taskId || task.dispatch.revision !== task.revision)) context.addIssue({ code: 'custom', path: ['dispatch'], message: 'audit task dispatch worker identity is not bound to its kind/task/revision' })
  if (task.kind === 'semantic' && task.admittedResult && (task.admittedResult.checkId !== task.checkId || task.admittedResult.packetIdentity !== task.packetDigest)) context.addIssue({ code: 'custom', path: ['admittedResult'], message: 'semantic result is not bound to its task/check/packet' })
  if (task.kind === 'confirmation' && task.admittedResult && (task.admittedResult.checkId !== task.checkId || task.admittedResult.packetIdentity !== task.packetDigest)) context.addIssue({ code: 'custom', path: ['admittedResult'], message: 'confirmation result is not bound to its task/check/packet' })
})
const deterministicSchema = z.object({ reviewDigest: digestSchema, issueRegistryPath: relativeArtifactPath, issueRegistryDigest: digestSchema, manifestPath: relativeArtifactPath, manifestDigest: digestSchema, markerPath: relativeArtifactPath, markerDigest: digestSchema, catalogVersion: z.string().min(1), contractGraphDigest: digestSchema, sectionIndexDigest: digestSchema, factStoreDigest: digestSchema }).strict()
const semanticSchema = z.object({ aggregateUsage: workflowUsageSchema, deepPhaseStartedAt: z.string().datetime().optional(), deepAggregateUsage: workflowUsageSchema.optional() }).strict()
const reviewSchema = z.object({ reviewDigest: digestSchema, issueRegistryPath: relativeArtifactPath, issueRegistryDigest: digestSchema, manifestPath: relativeArtifactPath, manifestDigest: digestSchema, markerPath: relativeArtifactPath, markerDigest: digestSchema, sectionIndexDigest: digestSchema, factStoreDigest: digestSchema, semanticManifestDigest: digestSchema, issueSummary: issueSummarySchema }).strict()
const revisionIssueAuthoritySchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('review'), reviewDigest: revisionDigest, issueRegistryDigest: revisionDigest }).strict(), z.object({ kind: z.literal('publication'), baseRevision: revisionIdentifier, authorityDigest: revisionDigest, issueRegistryDigest: revisionDigest }).strict()])
const revisionAuthoritySchema = z.object({ issueAuthority: revisionIssueAuthoritySchema, derivedDigests: z.object({ sectionIndex: revisionDigest, factStore: revisionDigest, manifest: revisionDigest }).strict(), documentDigests: z.array(z.object({ path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS), digest: revisionDigest }).strict()).length(CANONICAL_FOUNDATION_DOCUMENTS.length) }).strict()
const publicationSchema = z.object({ preparedPath: z.string().min(1), journalPath: z.string().min(1), committedPath: z.string().min(1), authorityDigest: revisionDigest, resultingRevision: revisionIdentifier, resultingIssueRegistryDigest: revisionDigest }).strict()
const foundationAuditStateSchemaRaw = z.object({ schemaVersion: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_VERSION), schemaFingerprint: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT), status: z.enum(['index_staged', 'extracting_facts', 'facts_staged', 'derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready', 'revision_ready', 'planning', 'revising', 'rebuilding_facts', 'validating', 'semantic_recheck', 'publishing', 'round_closing']), revision: z.string().min(1), documentDigests: z.record(z.string(), digestSchema), sectionIndexDigest: digestSchema, sectionIndexPath: relativeArtifactPath, manifestPath: relativeArtifactPath, tasks: z.array(taskSchema), phaseStartedAt: z.string().datetime().optional(), aggregateUsage: workflowUsageSchema.optional(), derived: z.object({ manifestPath: relativeArtifactPath, manifestDigest: digestSchema, markerPath: relativeArtifactPath, markerDigest: digestSchema, factStorePath: relativeArtifactPath, factStoreDigest: revisionDigest, sectionIndexPath: relativeArtifactPath, sectionIndexDigest: digestSchema }).strict().optional(), deterministic: deterministicSchema.optional(), semantic: semanticSchema.optional(), review: reviewSchema.optional(), authority: revisionAuthoritySchema.optional(), roundBefore: z.object({ documentRevision: revisionIdentifier, issueRegistryDigest: revisionDigest, issueAuthority: revisionIssueAuthoritySchema }).strict().optional(), round: z.number().int().positive().optional(), issueSummary: issueSummarySchema.optional(), publication: publicationSchema.optional() }).strict().superRefine((state, context) => {
  const repairStatuses = ['planning', 'revising', 'rebuilding_facts', 'validating', 'semantic_recheck', 'publishing', 'round_closing'] as const
  const expected = [...CANONICAL_FOUNDATION_DOCUMENTS]
  const paths = Object.keys(state.documentDigests)
  if (paths.length !== expected.length || expected.some(path => !paths.includes(path))) context.addIssue({ code: 'custom', path: ['documentDigests'], message: 'foundation audit state must bind all eight canonical document digests' })
  const expectedPaths = relativeFoundationAuditArtifactPaths(state.revision)
  const hasPublicationAuthority = state.authority?.issueAuthority.kind === 'publication'
  const publicationBound = (state.status === 'round_closing' || state.status === 'revision_ready') && hasPublicationAuthority
  const expectedDerivedRoot = `.beegame/audit/foundation/${state.revision}/derived`
  const expectedSectionIndexPath = hasPublicationAuthority ? `${expectedDerivedRoot}/section-index.json` : expectedPaths.sectionIndex
  const expectedManifestPath = hasPublicationAuthority ? `${expectedDerivedRoot}/manifest.json` : expectedPaths.manifest
  const expectedTaskRevision = publicationBound && state.authority?.issueAuthority.kind === 'publication'
    ? state.authority.issueAuthority.baseRevision
    : state.revision
  if (state.sectionIndexPath !== expectedSectionIndexPath || state.manifestPath !== expectedManifestPath) context.addIssue({ code: 'custom', path: ['sectionIndexPath'], message: 'foundation audit artifact paths are not bound to the state revision' })
  for (const task of state.tasks) {
    if (task.revision !== expectedTaskRevision) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation task revision must match its active or published base revision' })
    if (task.dispatch && (task.dispatch.taskId !== task.taskId || task.dispatch.revision !== task.revision)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation fact dispatch identity is not bound to its task' })
    if (task.dispatch?.request && typeof task.dispatch.request === 'object') {
      const request = task.dispatch.request as Record<string, unknown>
      const contract = request.contract && typeof request.contract === 'object' ? request.contract as Record<string, unknown> : undefined
      if (request.taskId !== task.taskId || request.revision !== task.revision || contract?.packetDigest !== task.packetDigest) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation fact dispatch packet identity is not bound to its task' })
    }
    if ((task.kind === 'document-facts' || task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'completed' && (!task.terminalDigest || !task.usage || task.durationMs === undefined || task.dispatch?.status !== 'completed' || !task.dispatch.terminalResult)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'completed foundation audit tasks require terminal, usage, duration, and dispatch evidence' })
  }
  if (state.status !== 'index_staged' && !state.phaseStartedAt) context.addIssue({ code: 'custom', path: ['phaseStartedAt'], message: 'fact extraction states require a persisted phase start time' })
  if (['facts_staged', 'derived_committed'].includes(state.status) && state.tasks.some(task => task.kind !== 'document-facts' || task.status !== 'completed' || !task.receiptPath || !task.receiptDigest)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'staged fact states require every task to be completed with an immutable receipt' })
  if (['index_staged', 'extracting_facts', 'facts_staged'].includes(state.status) && state.derived) context.addIssue({ code: 'custom', path: ['derived'], message: 'derived bindings are not valid before derived_committed' })
  if (['index_staged', 'extracting_facts', 'facts_staged', 'derived_committed'].includes(state.status) && state.deterministic) context.addIssue({ code: 'custom', path: ['deterministic'], message: 'deterministic bindings are not valid before deterministic_ready' })
  if (state.status === 'index_staged' && (state.phaseStartedAt || state.tasks.length || state.aggregateUsage || state.derived)) context.addIssue({ code: 'custom', path: ['status'], message: 'index_staged cannot carry extraction runtime fields' })
  if (['derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready'].includes(state.status) && !state.derived) context.addIssue({ code: 'custom', path: ['derived'], message: 'post-commit audit states require immutable artifact bindings' })
  if (['deterministic_ready', 'semantic_review', 'audit_ready'].includes(state.status) && !state.deterministic) context.addIssue({ code: 'custom', path: ['deterministic'], message: 'deterministic audit states require immutable review bindings' })
  if (['semantic_review', 'audit_ready'].includes(state.status) && (!state.semantic || !state.tasks.some(task => task.kind === 'semantic'))) context.addIssue({ code: 'custom', path: ['semantic'], message: 'semantic audit states require one semantic task collection and metrics in the sole audit state' })
  if (['semantic_review', 'audit_ready'].includes(state.status) && state.aggregateUsage) context.addIssue({ code: 'custom', path: ['aggregateUsage'], message: 'semantic states use nested semantic aggregate usage only' })
  if (!['semantic_review', 'audit_ready'].includes(state.status) && state.semantic) context.addIssue({ code: 'custom', path: ['semantic'], message: 'semantic aggregate usage is only valid during semantic review' })
  if (['semantic_review', 'audit_ready'].includes(state.status)) {
    const semanticTasks = state.tasks.filter(task => task.kind === 'semantic')
    const factTasks = state.tasks.filter(task => task.kind === 'document-facts')
    if (semanticTasks.length !== 10 || factTasks.length) context.addIssue({ code: 'custom', path: ['tasks'], message: 'semantic review requires exactly ten semantic tasks and no fact tasks' })
    const expectedChecks = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => check.checkId).sort()
    const actualChecks = semanticTasks.map(task => task.checkId).sort()
    if (JSON.stringify(expectedChecks) !== JSON.stringify(actualChecks)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'semantic task checks must equal the service manifest exactly once' })
    for (const task of semanticTasks) {
      const declaration = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === task.checkId)
      if (!declaration || task.modelTier !== declaration.modelTier) context.addIssue({ code: 'custom', path: ['tasks'], message: `semantic task tier is not bound to manifest: ${task.checkId}` })
    }
    for (const task of state.tasks) {
      if ((task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'completed' && !task.admittedResult) context.addIssue({ code: 'custom', path: ['tasks'], message: `completed semantic task lacks admitted result: ${task.taskId}` })
      if (task.kind === 'confirmation') {
        const source = state.tasks.find(candidate => candidate.kind === 'semantic' && candidate.taskId === task.sourceTaskId) as Extract<FoundationAuditTask, { kind: 'semantic' }> | undefined
        const declaration = source ? FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === source.checkId) : undefined
        if (!source || source.checkId !== task.checkId || source.packetDigest !== task.packetDigest || !source.admittedResult || (source.admittedResult.outcome !== 'UNDECIDABLE' && declaration?.severity !== 'BLOCKER') || state.tasks.filter(candidate => candidate.kind === 'confirmation' && candidate.sourceTaskId === task.sourceTaskId).length !== 1) context.addIssue({ code: 'custom', path: ['tasks'], message: `confirmation source binding is invalid: ${task.taskId}` })
      }
    }
  }
  if (state.status === 'audit_ready' && (!state.review || state.tasks.some(task => task.status !== 'completed'))) context.addIssue({ code: 'custom', path: ['review'], message: 'audit_ready requires a complete final review and completed audit tasks' })
  if (state.status === 'audit_ready' && state.review) {
    const reviewRoot = `.beegame/audit/foundation/${state.revision}/review/${state.review.reviewDigest}`
    if (state.review.issueRegistryPath !== `${reviewRoot}/issue-registry.json` || state.review.manifestPath !== `${reviewRoot}/manifest.json` || state.review.markerPath !== `${reviewRoot}/COMMITTED.json`) context.addIssue({ code: 'custom', path: ['review'], message: 'audit_ready review paths are not bound to revision and digest' })
    if (!state.derived || state.review.sectionIndexDigest !== state.derived.sectionIndexDigest || state.review.factStoreDigest !== state.derived.factStoreDigest || state.review.semanticManifestDigest !== FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest) context.addIssue({ code: 'custom', path: ['review'], message: 'audit_ready review bindings are not bound to derived/service authority' })
    for (const source of state.tasks.filter(task => task.kind === 'semantic') as Array<Extract<FoundationAuditTask, { kind: 'semantic' }>>) {
      const confirmation = state.tasks.find(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId) as Extract<FoundationAuditTask, { kind: 'confirmation' }> | undefined
      const effective = confirmation?.admittedResult ?? source.admittedResult
      if (!effective || effective.outcome === 'UNDECIDABLE') context.addIssue({ code: 'custom', path: ['tasks'], message: `audit_ready has unresolved semantic result: ${source.taskId}` })
    }
  }
  if (state.review && state.status !== 'audit_ready' && state.status !== 'revision_ready' && !repairStatuses.includes(state.status as (typeof repairStatuses)[number])) context.addIssue({ code: 'custom', path: ['review'], message: 'final review bindings are only valid after atomic audit_ready publication or during repair substages' })
  if (state.deterministic && state.deterministic.manifestPath.includes(`/staging/review/`) === false) context.addIssue({ code: 'custom', path: ['deterministic', 'manifestPath'], message: 'deterministic review must be revision-bound staging' })
  if (state.roundBefore && state.roundBefore.issueAuthority.issueRegistryDigest !== state.roundBefore.issueRegistryDigest) context.addIssue({ code: 'custom', path: ['roundBefore'], message: 'round-before registry digest must match its exact issue authority' })
  if (state.status === 'revision_ready') {
    if (!state.authority || !state.roundBefore || state.round === undefined || !state.issueSummary || !state.publication || state.authority.issueAuthority.kind !== 'publication') context.addIssue({ code: 'custom', path: ['status'], message: 'revision_ready requires committed publication authority and revision metadata' })
    if (!state.derived || state.derived.sectionIndexDigest !== state.sectionIndexDigest || state.derived.sectionIndexPath !== state.sectionIndexPath || state.derived.manifestPath !== state.manifestPath || state.derived.factStoreDigest !== state.authority?.derivedDigests.factStore) context.addIssue({ code: 'custom', path: ['derived'], message: 'revision_ready requires current derived artifact bindings' })
    if (!state.tasks.length || state.tasks.some(task => task.kind !== 'document-revision' && task.kind !== 'impacted-facts' && task.kind !== 'semantic-recheck' || task.status !== 'completed')) context.addIssue({ code: 'custom', path: ['tasks'], message: 'revision_ready requires a non-empty collection of completed repair tasks' })
  } else if (repairStatuses.includes(state.status as (typeof repairStatuses)[number])) {
    if (!state.authority || !state.roundBefore || state.round === undefined || !state.issueSummary) context.addIssue({ code: 'custom', path: ['status'], message: 'foundation repair substages require revision authority metadata on the sole audit state' })
    if (state.deterministic || state.semantic || state.review || state.aggregateUsage) context.addIssue({ code: 'custom', path: ['status'], message: 'foundation repair substages cannot retain audit runtime bindings' })
    if (state.tasks.some(task => task.kind === 'document-facts' || task.kind === 'semantic' || task.kind === 'confirmation')) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation repair substages cannot carry audit tasks alongside repair tasks' })
  } else {
    if (state.authority || state.roundBefore || state.round !== undefined || state.issueSummary || state.publication) context.addIssue({ code: 'custom', path: ['status'], message: 'revision metadata is only valid during a repair substage on the sole audit state' })
    if (state.tasks.some(task => task.kind === 'document-revision' || task.kind === 'impacted-facts' || task.kind === 'semantic-recheck')) context.addIssue({ code: 'custom', path: ['tasks'], message: 'audit substages cannot carry repair tasks' })
  }
  if (publicationBound) {
    const publicationAuthority = state.authority?.issueAuthority.kind === 'publication' ? state.authority.issueAuthority : undefined
    if (!state.publication || !publicationAuthority || state.publication.resultingRevision !== state.revision || state.publication.authorityDigest !== publicationAuthority.authorityDigest || state.publication.resultingIssueRegistryDigest !== publicationAuthority.issueRegistryDigest) context.addIssue({ code: 'custom', path: ['publication'], message: 'published foundation state must bind the resulting revision and exact publication authority' })
    if (state.round !== undefined && state.tasks.some(task => (task.kind === 'document-revision' || task.kind === 'impacted-facts' || task.kind === 'semantic-recheck') && task.round !== state.round)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'published repair tasks must match the committed revision round' })
  }
  if (hasPublicationAuthority && (!state.derived || state.derived.sectionIndexPath !== expectedSectionIndexPath || state.derived.manifestPath !== expectedManifestPath || state.derived.factStorePath !== `${expectedDerivedRoot}/fact-store.json` || state.derived.markerPath !== `${expectedDerivedRoot}/COMMITTED.json`)) context.addIssue({ code: 'custom', path: ['derived'], message: 'published foundation derived paths must be fixed to the current revision' })
})
export const foundationAuditStateSchema = foundationAuditStateSchemaRaw as unknown as z.ZodType<FoundationAuditState>
export function parseFoundationAuditState(value: unknown): FoundationAuditState { return foundationAuditStateSchema.parse(value) as FoundationAuditState }
export function createFoundationAuditState(input: { revision: string; documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]; manifest: FoundationAuditManifest }): FoundationAuditState {
  const documentDigests = Object.fromEntries(input.documentDigests.map(item => [item.path, item.digest])) as Record<FoundationDocumentPath, string>
  const paths = relativeFoundationAuditArtifactPaths(input.revision)
  return parseFoundationAuditState({ schemaVersion: FOUNDATION_AUDIT_STATE_SCHEMA_VERSION, schemaFingerprint: FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT, status: 'index_staged', revision: input.revision, documentDigests, sectionIndexDigest: input.manifest.sectionIndexDigest, sectionIndexPath: paths.sectionIndex, manifestPath: paths.manifest, tasks: [] })
}
