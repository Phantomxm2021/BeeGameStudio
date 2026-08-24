import { z } from 'zod/v4'
import { relativeFoundationAuditArtifactPaths, type FoundationAuditManifest } from './foundation-audit-artifacts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './types'
import type { FoundationFactTask } from './foundation-fact-runtime'

export const FOUNDATION_AUDIT_STATE_SCHEMA_VERSION = 3 as const
export const FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT = 'foundation-audit-state-v3' as const
export type FoundationAuditStatus = 'index_staged' | 'extracting_facts' | 'facts_staged' | 'derived_committed' | 'deterministic_ready' | 'semantic_review' | 'audit_ready'
export type FoundationAuditState = {
  schemaVersion: typeof FOUNDATION_AUDIT_STATE_SCHEMA_VERSION
  schemaFingerprint: typeof FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT
  status: FoundationAuditStatus
  revision: string
  documentDigests: Record<FoundationDocumentPath, string>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  tasks: FoundationFactTask[]
  phaseStartedAt?: string
  aggregateUsage?: FoundationFactTask['usage']
  derived?: { manifestPath: string; manifestDigest: string; markerPath: string; markerDigest: string; factStorePath: string; factStoreDigest: string; sectionIndexPath: string; sectionIndexDigest: string }
}
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeArtifactPath = z.string().refine(value => value.startsWith('.beegame/audit/foundation/') && !value.startsWith('/') && !value.includes('..'), 'foundation audit artifact paths must remain project-local')
const workflowUsageSchema = z.object({ input_tokens: z.number().nonnegative(), cache_read_tokens: z.number().nonnegative(), cache_creation_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), total_tokens: z.number().nonnegative() }).strict()
const dispatchSchema = z.object({ dispatchId: z.string().min(1), workerType: z.literal('foundation-fact-extractor'), phase: z.literal('DOCUMENT_REVIEW'), taskId: z.string().min(1), revision: z.string().min(1), status: z.enum(['running', 'completed', 'failed', 'blocked', 'interrupted', 'invalid']), request: z.record(z.string(), z.unknown()).optional(), terminalResult: z.record(z.string(), z.unknown()).optional(), failureReason: z.string().min(1).optional(), startingUsage: workflowUsageSchema.optional(), usage: workflowUsageSchema.optional(), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional() }).strict()
const taskSchema = z.object({ taskId: z.string().min(1), kind: z.literal('document-facts'), revision: z.string().min(1), packetDigest: digestSchema, modelTier: z.literal('fast'), status: z.enum(['pending', 'running', 'retryable', 'completed', 'needs_action']), attempt: z.number().int().nonnegative().max(2), dispatch: dispatchSchema.optional(), terminalDigest: digestSchema.optional(), receiptPath: relativeArtifactPath.optional(), receiptDigest: digestSchema.optional(), usage: workflowUsageSchema.optional(), durationMs: z.number().nonnegative().optional(), failureReason: z.string().min(1).optional() }).strict()
const foundationAuditStateSchemaRaw = z.object({ schemaVersion: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_VERSION), schemaFingerprint: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT), status: z.enum(['index_staged', 'extracting_facts', 'facts_staged', 'derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready']), revision: z.string().min(1), documentDigests: z.record(z.string(), digestSchema), sectionIndexDigest: digestSchema, sectionIndexPath: relativeArtifactPath, manifestPath: relativeArtifactPath, tasks: z.array(taskSchema).max(8), phaseStartedAt: z.string().datetime().optional(), aggregateUsage: workflowUsageSchema.optional(), derived: z.object({ manifestPath: relativeArtifactPath, manifestDigest: digestSchema, markerPath: relativeArtifactPath, markerDigest: digestSchema, factStorePath: relativeArtifactPath, factStoreDigest: digestSchema, sectionIndexPath: relativeArtifactPath, sectionIndexDigest: digestSchema }).strict().optional() }).strict().superRefine((state, context) => {
  const expected = [...CANONICAL_FOUNDATION_DOCUMENTS]
  const paths = Object.keys(state.documentDigests)
  if (paths.length !== expected.length || expected.some(path => !paths.includes(path))) context.addIssue({ code: 'custom', path: ['documentDigests'], message: 'foundation audit state must bind all eight canonical document digests' })
  const expectedPaths = relativeFoundationAuditArtifactPaths(state.revision)
  if (state.sectionIndexPath !== expectedPaths.sectionIndex || state.manifestPath !== expectedPaths.manifest) context.addIssue({ code: 'custom', path: ['sectionIndexPath'], message: 'foundation audit artifact paths are not bound to the state revision' })
  for (const task of state.tasks) {
    if (task.revision !== state.revision) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation fact task revision must match state revision' })
    if (task.dispatch && (task.dispatch.taskId !== task.taskId || task.dispatch.revision !== task.revision)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation fact dispatch identity is not bound to its task' })
    if (task.dispatch?.request && typeof task.dispatch.request === 'object') {
      const request = task.dispatch.request as Record<string, unknown>
      const contract = request.contract && typeof request.contract === 'object' ? request.contract as Record<string, unknown> : undefined
      if (request.taskId !== task.taskId || request.revision !== task.revision || contract?.packetDigest !== task.packetDigest) context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation fact dispatch packet identity is not bound to its task' })
    }
    if (task.status === 'completed' && (!task.terminalDigest || !task.usage || task.durationMs === undefined || task.dispatch?.status !== 'completed' || !task.dispatch.terminalResult)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'completed foundation fact tasks require terminal, usage, duration, and dispatch evidence' })
  }
  if (state.status !== 'index_staged' && !state.phaseStartedAt) context.addIssue({ code: 'custom', path: ['phaseStartedAt'], message: 'fact extraction states require a persisted phase start time' })
  if (['facts_staged', 'derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready'].includes(state.status) && state.tasks.some(task => task.status !== 'completed' || !task.receiptPath || !task.receiptDigest)) context.addIssue({ code: 'custom', path: ['tasks'], message: 'staged fact states require every task to be completed with an immutable receipt' })
  if (['index_staged', 'extracting_facts', 'facts_staged'].includes(state.status) && state.derived) context.addIssue({ code: 'custom', path: ['derived'], message: 'derived bindings are not valid before derived_committed' })
  if (state.status === 'index_staged' && (state.phaseStartedAt || state.tasks.length || state.aggregateUsage || state.derived)) context.addIssue({ code: 'custom', path: ['status'], message: 'index_staged cannot carry extraction runtime fields' })
  if (['derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready'].includes(state.status) && !state.derived) context.addIssue({ code: 'custom', path: ['derived'], message: 'post-commit audit states require immutable artifact bindings' })
})
export const foundationAuditStateSchema = foundationAuditStateSchemaRaw as unknown as z.ZodType<FoundationAuditState>
export function parseFoundationAuditState(value: unknown): FoundationAuditState { return foundationAuditStateSchema.parse(value) as FoundationAuditState }
export function createFoundationAuditState(input: { revision: string; documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]; manifest: FoundationAuditManifest }): FoundationAuditState {
  const documentDigests = Object.fromEntries(input.documentDigests.map(item => [item.path, item.digest])) as Record<FoundationDocumentPath, string>
  const paths = relativeFoundationAuditArtifactPaths(input.revision)
  return parseFoundationAuditState({ schemaVersion: FOUNDATION_AUDIT_STATE_SCHEMA_VERSION, schemaFingerprint: FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT, status: 'index_staged', revision: input.revision, documentDigests, sectionIndexDigest: input.manifest.sectionIndexDigest, sectionIndexPath: paths.sectionIndex, manifestPath: paths.manifest, tasks: [] })
}
