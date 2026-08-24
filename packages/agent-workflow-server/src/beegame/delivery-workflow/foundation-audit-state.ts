import { z } from 'zod/v4'
import {
  relativeFoundationAuditArtifactPaths,
  type FoundationAuditManifest,
} from './foundation-audit-artifacts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DispatchRecord,
  type WorkflowUsage,
  type FoundationDocumentPath,
} from './types'

export const FOUNDATION_AUDIT_STATE_SCHEMA_VERSION = 2 as const
export const FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT =
  'foundation-audit-state.v2.tasks.v1' as const
export const FOUNDATION_AUDIT_MAX_TASKS = 8 as const
export const FOUNDATION_AUDIT_MAX_RUNNING_TASKS = 4 as const
export const FOUNDATION_AUDIT_MAX_ATTEMPTS = 2 as const
export const FOUNDATION_AUDIT_PACKET_MAX_BYTES = 16_384 as const
export const FOUNDATION_AUDIT_OUTPUT_MAX_TOKENS = 512 as const
export const FOUNDATION_AUDIT_TOTAL_MODEL_TOKENS = 32_000 as const
export const FOUNDATION_AUDIT_PHASE_DEADLINE_MS = 300_000 as const

export type FoundationAuditTaskStatus =
  | 'pending'
  | 'running'
  | 'retryable'
  | 'completed'
  | 'needs_action'

export type FoundationAuditTask = {
  taskId: string
  kind: 'foundation-fact-extraction'
  revision: string
  packetDigest: string
  modelTier: 'fast'
  status: FoundationAuditTaskStatus
  attempt: number
  dispatch?: DispatchRecord
  terminalDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}

export type FoundationAuditState = {
  schemaVersion: typeof FOUNDATION_AUDIT_STATE_SCHEMA_VERSION
  schemaFingerprint: typeof FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT
  status: 'index_staged' | 'extracting_facts' | 'facts_staged' | 'derived_committed'
  revision: string
  documentDigests: Record<FoundationDocumentPath, string>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  factStorePath: string
  derivedManifestPath: string
  commitMarkerPath: string
  tasks: FoundationAuditTask[]
  needsAction?: string
}
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeArtifactPath = z
  .string()
  .refine(
    value =>
      value.startsWith('.beegame/audit/foundation/') &&
      !value.startsWith('/') &&
      !value.includes('..'),
    'foundation audit artifact paths must remain project-local',
  )
export const foundationAuditStateSchema: z.ZodType<FoundationAuditState> = z
  .object({
    schemaVersion: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_VERSION),
    schemaFingerprint: z.literal(FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT),
    status: z.enum(['index_staged', 'extracting_facts', 'facts_staged', 'derived_committed']),
    revision: z.string().min(1),
    documentDigests: z.record(z.string(), digestSchema),
    sectionIndexDigest: digestSchema,
    sectionIndexPath: relativeArtifactPath,
    manifestPath: relativeArtifactPath,
    factStorePath: relativeArtifactPath,
    derivedManifestPath: relativeArtifactPath,
    commitMarkerPath: relativeArtifactPath,
    tasks: z.array(
      z
        .object({
          taskId: z.string().min(1),
          kind: z.literal('foundation-fact-extraction'),
          revision: z.string().min(1),
          packetDigest: digestSchema,
          modelTier: z.literal('fast'),
          status: z.enum(['pending', 'running', 'retryable', 'completed', 'needs_action']),
          attempt: z.number().int().min(0).max(FOUNDATION_AUDIT_MAX_ATTEMPTS),
          dispatch: z.record(z.string(), z.unknown()).optional() as z.ZodType<DispatchRecord | undefined>,
          terminalDigest: digestSchema.optional(),
          usage: z
            .object({
              input_tokens: z.number().nonnegative(),
              cache_read_tokens: z.number().nonnegative(),
              cache_creation_tokens: z.number().nonnegative(),
              completion_tokens: z.number().nonnegative(),
              total_tokens: z.number().nonnegative(),
            })
            .strict()
            .optional(),
          durationMs: z.number().int().nonnegative().optional(),
          failureReason: z.string().min(1).optional(),
        })
        .strict(),
    ).max(FOUNDATION_AUDIT_MAX_TASKS),
    needsAction: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const expected = [...CANONICAL_FOUNDATION_DOCUMENTS]
    const paths = Object.keys(state.documentDigests)
    if (
      paths.length !== expected.length ||
      expected.some(path => !paths.includes(path))
    )
      context.addIssue({
        code: 'custom',
        path: ['documentDigests'],
        message:
          'foundation audit state must bind all eight canonical document digests',
      })
    const expectedPaths = relativeFoundationAuditArtifactPaths(state.revision)
    if (
      state.sectionIndexPath !== expectedPaths.sectionIndex ||
      state.manifestPath !== expectedPaths.manifest ||
      state.factStorePath !== expectedPaths.factStore ||
      state.derivedManifestPath !== expectedPaths.derivedManifest ||
      state.commitMarkerPath !== expectedPaths.commitMarker
    )
      context.addIssue({
        code: 'custom',
        path: ['sectionIndexPath'],
        message:
          'foundation audit artifact paths are not bound to the state revision',
      })
    const taskIds = state.tasks.map(task => task.taskId)
    if (new Set(taskIds).size !== taskIds.length)
      context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation audit task IDs must be unique' })
    if (state.tasks.some(task => task.revision !== state.revision))
      context.addIssue({ code: 'custom', path: ['tasks'], message: 'foundation audit tasks must bind the state revision' })
    if (state.status === 'index_staged' && state.tasks.some(task => task.status === 'running' || task.status === 'completed'))
      context.addIssue({ code: 'custom', path: ['tasks'], message: 'index_staged cannot contain started audit tasks' })
  })
export function parseFoundationAuditState(
  value: unknown,
): FoundationAuditState {
  return foundationAuditStateSchema.parse(value)
}
export function createFoundationAuditState(input: {
  revision: string
  documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]
  manifest: FoundationAuditManifest
  tasks?: readonly FoundationAuditTask[]
}): FoundationAuditState {
  const documentDigests = Object.fromEntries(
    input.documentDigests.map(item => [item.path, item.digest]),
  ) as Record<FoundationDocumentPath, string>
  const paths = relativeFoundationAuditArtifactPaths(input.revision)
  return parseFoundationAuditState({
    schemaVersion: FOUNDATION_AUDIT_STATE_SCHEMA_VERSION,
    schemaFingerprint: FOUNDATION_AUDIT_STATE_SCHEMA_FINGERPRINT,
    status: 'index_staged',
    revision: input.revision,
    documentDigests,
    sectionIndexDigest: input.manifest.sectionIndexDigest,
    sectionIndexPath: paths.sectionIndex,
    manifestPath: paths.manifest,
    factStorePath: paths.factStore,
    derivedManifestPath: paths.derivedManifest,
    commitMarkerPath: paths.commitMarker,
    tasks: [...(input.tasks ?? [])],
    needsAction: input.tasks?.length
      ? undefined
      : 'foundation fact extraction has no unresolved catalog tasks',
  })
}

function sameTaskTerminal(
  task: FoundationAuditTask,
  input: FoundationAuditTerminalInput,
): boolean {
  return (
    task.taskId === input.taskId &&
    task.dispatch?.dispatchId === input.dispatchId &&
    task.revision === input.revision &&
    task.packetDigest === input.packetDigest &&
    task.terminalDigest === input.terminalDigest
  )
}

export type FoundationAuditTerminalInput = {
  taskId: string
  dispatchId: string
  revision: string
  packetDigest: string
  terminalDigest: string
  status: 'completed' | 'failed'
  usage?: WorkflowUsage
  durationMs: number
  failureReason?: string
}

export function claimFoundationAuditTask(
  state: FoundationAuditState,
  input: {
    taskId: string
    revision: string
    packetDigest: string
    dispatch: DispatchRecord
  },
): FoundationAuditState {
  const index = state.tasks.findIndex(task => task.taskId === input.taskId)
  if (index < 0) throw new Error(`foundation audit task not found: ${input.taskId}`)
  const task = state.tasks[index]!
  if (task.revision !== input.revision || task.packetDigest !== input.packetDigest)
    throw new Error('foundation audit task revision or packet digest mismatch')
  if (task.status !== 'pending' && task.status !== 'retryable')
    throw new Error('foundation audit task is not claimable')
  if (state.tasks.filter(candidate => candidate.status === 'running').length >= FOUNDATION_AUDIT_MAX_RUNNING_TASKS)
    throw new Error('maximum of four foundation audit tasks may run concurrently')
  if (task.attempt >= FOUNDATION_AUDIT_MAX_ATTEMPTS)
    throw new Error('foundation audit task has exhausted attempts')
  const claimed: FoundationAuditTask = {
    ...task,
    status: 'running',
    attempt: task.attempt + 1,
    dispatch: input.dispatch,
    terminalDigest: undefined,
    usage: undefined,
    durationMs: undefined,
    failureReason: undefined,
  }
  return {
    ...state,
    status: 'extracting_facts',
    needsAction: undefined,
    tasks: state.tasks.map((candidate, candidateIndex) =>
      candidateIndex === index ? claimed : candidate,
    ),
  }
}

export function acceptFoundationAuditTerminal(
  state: FoundationAuditState,
  input: FoundationAuditTerminalInput,
): FoundationAuditState {
  const index = state.tasks.findIndex(task => task.taskId === input.taskId)
  if (index < 0) throw new Error(`foundation audit task not found: ${input.taskId}`)
  const task = state.tasks[index]!
  if (task.status === 'completed') {
    if (sameTaskTerminal(task, input)) return state
    throw new Error('conflicting foundation audit terminal replay')
  }
  if (task.status !== 'running') throw new Error('foundation audit task is not running')
  if (
    task.dispatch?.dispatchId !== input.dispatchId ||
    task.revision !== input.revision ||
    task.packetDigest !== input.packetDigest
  )
    throw new Error('foundation audit terminal scope mismatch')
  const nextStatus =
    input.status === 'completed'
      ? 'completed'
      : task.attempt < FOUNDATION_AUDIT_MAX_ATTEMPTS
        ? 'retryable'
        : 'needs_action'
  const updated: FoundationAuditTask = {
    ...task,
    status: nextStatus,
    terminalDigest: input.terminalDigest,
    ...(input.usage ? { usage: input.usage } : {}),
    durationMs: input.durationMs,
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  }
  return {
    ...state,
    ...(nextStatus === 'needs_action' ? { needsAction: input.failureReason ?? 'foundation fact extraction needs action' } : {}),
    tasks: state.tasks.map((candidate, candidateIndex) =>
      candidateIndex === index ? updated : candidate,
    ),
  }
}

export function finalizeFoundationAuditTasks(
  state: FoundationAuditState,
): FoundationAuditState {
  if (
    state.tasks.some(task => task.status !== 'completed') ||
    state.tasks.some(task => task.status === 'pending' || task.status === 'running' || task.status === 'retryable')
  )
    throw new Error('foundation audit tasks cannot finalize until every task is completed')
  if (state.status === 'facts_staged') return state
  if (state.status !== 'extracting_facts' && state.status !== 'index_staged')
    throw new Error('foundation audit task collection is not finalizable')
  return { ...state, status: 'facts_staged', needsAction: undefined }
}
