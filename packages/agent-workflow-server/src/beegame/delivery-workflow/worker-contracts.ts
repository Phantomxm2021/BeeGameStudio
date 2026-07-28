import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'

const base = z.object({ revision: z.string().min(1) }).strict()

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)).min(1),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
  })
  .strict()

export const documentReviewerTerminalSchema = base
  .extend({
    workerType: z.literal('document-reviewer'),
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
    reviewedDocumentPaths: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    findings: z.array(
      z
        .object({
          severity: z.enum(['blocking', 'non_blocking']),
          category: z.enum([
            'cross_document_conflict',
            'missing_spec',
            'calculation',
            'other',
          ]),
          documents: z.array(z.string().min(1)).min(1),
          description: z.string().min(1),
          requiredAction: z.string().min(1),
        })
        .strict(),
    ),
    evidencePath: z.string().min(1),
  })
  .strict()

export const resourcePreparerTerminalSchema = base
  .extend({
    workerType: z.literal('resource-preparer'),
    status: z.enum(['completed', 'failed', 'blocked']),
    writtenPaths: z.array(z.string().min(1)),
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
    evidencePath: z.string().min(1),
  })
  .strict()

export const atomicTaskPlannerTerminalSchema = base
  .extend({
    workerType: z.literal('atomic-task-planner'),
    status: z.literal('completed'),
    tasks: z.array(atomicTaskSchema).min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const implementationWorkerTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-worker'),
    taskId: z.string().min(1),
    status: z.enum(['completed', 'failed', 'blocked']),
    changedPaths: z.array(z.string().min(1)),
    evidenceRefs: z.array(z.string().min(1)),
    evidencePath: z.string().min(1),
    resourceReferences: z
      .array(
        z
          .object({
            importId: z.string().min(1),
            references: z.array(z.string().min(1)).min(1),
            runtimeEventIds: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
    compositionIntegrations: z
      .array(
        z
          .object({
            compositionId: z.string().min(1),
            recipePath: z.string().min(1),
            references: z.array(z.string().min(1)).min(1),
            runtimeEventIds: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
    requirementSatisfactions: z
      .array(
        z
          .object({
            requirementId: z.string().min(1),
            importIds: z.array(z.string().min(1)).default([]),
            compositionIds: z.array(z.string().min(1)).default([]),
            projectReferences: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()

export const implementationAuditorTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-auditor'),
    status: z.enum(['passed', 'failed', 'blocked']),
    auditedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
    findings: z.array(z.string()),
    evidencePath: z.string().min(1),
  })
  .strict()

export const acceptanceValidatorTerminalSchema = base
  .extend({
    workerType: z.literal('acceptance-validator'),
    status: z.enum(['passed', 'failed', 'blocked']),
    checklistIds: z.array(z.string().min(1)),
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
    findings: z.array(z.string()),
    evidencePath: z.string().min(1),
  })
  .strict()

export const changeImpactTerminalSchema = z
  .object({
    workerType: z.literal('change-impact-analyzer'),
    classification: z.enum([
      'question',
      'implementation_only',
      'documents_required',
    ]),
    affectedRequirementIds: z.array(z.string().min(1)),
    affectedChecklistIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const questionAnswerTerminalSchema = z
  .object({
    workerType: z.literal('question-answerer'),
    answer: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const workerTerminalSchema = z.discriminatedUnion('workerType', [
  documentAuthorTerminalSchema,
  documentReviewerTerminalSchema,
  resourcePreparerTerminalSchema,
  atomicTaskPlannerTerminalSchema,
  implementationWorkerTerminalSchema,
  implementationAuditorTerminalSchema,
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  questionAnswerTerminalSchema,
])

export type WorkerTerminalResult = z.infer<typeof workerTerminalSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Older delivery prompts emitted a document-author envelope with the same
 * facts under different field names.  Normalize only that known envelope;
 * every other worker result still goes through the strict schema unchanged.
 */
function normalizeDocumentAuthorEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value
  const worker = value.worker ?? value.workerType
  const status = value.status
  const changedPaths = value.changedPaths
  if (
    worker === 'document-author' &&
    status === 'completed' &&
    Array.isArray(value.writtenPaths)
  ) {
    const {
      revision: _obsoleteRevision,
      documentRevision: _obsoleteDocumentRevision,
      ...canonical
    } = value
    return canonical
  }
  if (
    worker !== 'document-author' ||
    status !== 'succeeded' ||
    !Array.isArray(changedPaths)
  )
    return value
  return {
    workerType: 'document-author',
    status: 'completed',
    writtenPaths: changedPaths,
    ...(Array.isArray(value.resolvedFindingIds)
      ? { resolvedFindingIds: value.resolvedFindingIds }
      : {}),
  }
}

function structuredCandidates(value: string): unknown[] {
  const trimmed = value.trim()
  const candidates: unknown[] = []
  try {
    candidates.push(JSON.parse(trimmed))
  } catch {
    /* provider may include display text */
  }

  // Some runtimes return a user-facing sentence followed by a fenced JSON
  // payload.  We do not match keywords or worker names here: walk balanced
  // JSON objects and let the contract schema decide what is valid.
  for (
    let start = trimmed.indexOf('{');
    start >= 0;
    start = trimmed.indexOf('{', start + 1)
  ) {
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') {
        quoted = true
        continue
      }
      if (character === '{') depth += 1
      if (character === '}') depth -= 1
      if (depth === 0) {
        try {
          candidates.push(JSON.parse(trimmed.slice(start, index + 1)))
        } catch {
          /* continue scanning */
        }
        break
      }
    }
  }
  return candidates
}

export function parseWorkerTerminalResult(
  value: unknown,
): WorkerTerminalResult {
  if (typeof value === 'string') {
    for (const candidate of structuredCandidates(value)) {
      try {
        return workerTerminalSchema.parse(
          normalizeDocumentAuthorEnvelope(candidate),
        )
      } catch {
        /* try the next object */
      }
    }
    throw new Error(
      'worker terminal result must contain a valid structured JSON object',
    )
  }
  return workerTerminalSchema.parse(normalizeDocumentAuthorEnvelope(value))
}
