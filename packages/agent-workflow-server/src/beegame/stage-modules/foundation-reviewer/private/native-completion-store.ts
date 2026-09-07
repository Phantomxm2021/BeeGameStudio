import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { journalImmutableFiles } from './journal-storage'
import type { ReviewNativeCompletion, ReviewNativeError } from './native-worker'
import type { ReviewNativeUsage } from './native-usage'
import { reviewerDigest } from './review-summary'
import { REVIEW_WORKER_OUTPUT_MAX_BYTES } from './worker-task'

const hexDigest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(200)
type NativeErrorCode = ReviewNativeError['code']
const nativeErrorCodes = ['stopped', 'process_exit', 'protocol_error', 'model_error', 'invalid_output', 'usage_unavailable'] as const satisfies readonly NativeErrorCode[]
const usageSchema: z.ZodType<ReviewNativeUsage> = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
}).strict().refine(value => value.total_tokens === value.prompt_tokens + value.completion_tokens +
  value.cache_read_tokens + value.cache_creation_tokens, 'native usage total does not match counters')

function jsonValue(maxBytes: number) {
  return z.unknown().superRefine((value, context) => {
    try {
      const seen = new Set<object>()
      function isJson(value: unknown): boolean {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
        if (typeof value === 'number') return Number.isFinite(value)
        if (typeof value !== 'object') return false
        if (seen.has(value)) return false
        seen.add(value)
        try {
          if (Array.isArray(value)) return Object.keys(value).length === value.length &&
            value.every((item, index) => Object.hasOwn(value, index) && isJson(item))
          const prototype = Object.getPrototypeOf(value)
          return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJson)
        } finally { seen.delete(value) }
      }
      if (!isJson(value)) throw new Error('value is not JSON')
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('value is not JSON')
      if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('value exceeds infrastructure boundary')
      JSON.parse(serialized)
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'value is not JSON' })
    }
  })
}

const bindingSchema = z.object({ taskId: id, dispatchId: id, revision: hexDigest, packetDigest: hexDigest }).strict()
const observationSchema = z.object({
  scope: z.literal('direct-child'),
  pid: z.number().int().positive().nullable(),
  exitCode: z.number().int().nullable(),
  signalCode: z.string().min(1).max(200).nullable(),
  termination: z.enum(['none', 'term_requested', 'kill_requested']),
  stdoutDrained: z.literal(true),
  usageObserved: z.boolean(),
  usage: usageSchema,
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('accepted'), value: jsonValue(REVIEW_WORKER_OUTPUT_MAX_BYTES) }).strict(),
    z.object({ kind: z.literal('failed'), code: z.enum(nativeErrorCodes) }).strict(),
  ]),
}).strict() satisfies z.ZodType<ReviewNativeCompletion<unknown>>

const leaseMetadataSchema = z.object({ runId: hexDigest, scope: hexDigest, leaseDigest: hexDigest }).strict()
const recordBodySchema = z.object({ version: z.literal(1), runId: hexDigest, headerDigest: hexDigest, leaseDigest: hexDigest,
  binding: bindingSchema, observation: observationSchema }).strict()
const recordSchema = recordBodySchema.extend({ digest: hexDigest }).strict()
const MAX_RECORD_BYTES = REVIEW_WORKER_OUTPUT_MAX_BYTES * 2

export type ReviewerNativeCompletionBinding = z.infer<typeof bindingSchema>
export type ReviewerNativeCompletionLease = z.infer<typeof leaseMetadataSchema> & { assertOwned(): Promise<void> }
export type ReviewerNativeCompletionRecord = z.infer<typeof recordSchema>

function parseLease(value: ReviewerNativeCompletionLease) {
  if (!value || typeof value.assertOwned !== 'function') throw new Error('native completion lease is invalid')
  return leaseMetadataSchema.parse({ runId: value.runId, scope: value.scope, leaseDigest: value.leaseDigest })
}

function sameBinding(left: ReviewerNativeCompletionBinding, right: ReviewerNativeCompletionBinding) {
  return reviewerDigest(left) === reviewerDigest(right)
}

/** Durable observation of one direct child close. It grants no cleanup, kill, recovery, or billing authority. */
export function createReviewerNativeCompletionStore(input: { workspacePath: string; runId: string; headerDigest: string }) {
  if (!isAbsolute(input.workspacePath)) throw new Error('native completion workspace must be absolute')
  const runId = hexDigest.parse(input.runId)
  const headerDigest = hexDigest.parse(input.headerDigest)
  const workspacePath = resolve(input.workspacePath)
  const runRoot = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', runId)
  const completionRoot = join(runRoot, 'native-completions')
  const scope = reviewerDigest(runRoot)

  function completionPath(binding: ReviewerNativeCompletionBinding) {
    return join(completionRoot, `${reviewerDigest(binding.dispatchId)}.json`)
  }
  async function assertLease(lease: ReviewerNativeCompletionLease) {
    const metadata = parseLease(lease)
    if (metadata.runId !== runId || metadata.scope !== scope) throw new Error('native completion lease binding mismatch')
    await lease.assertOwned()
    return metadata
  }
  async function assertWorkspace() {
    await journalImmutableFiles.assertDirectories(workspacePath)
  }

  return Object.freeze({
    async record(rawBinding: ReviewerNativeCompletionBinding, rawObservation: ReviewNativeCompletion<unknown>, rawLease: ReviewerNativeCompletionLease) {
      const binding = bindingSchema.parse(structuredClone(rawBinding))
      const observation = observationSchema.parse(structuredClone(rawObservation))
      const lease = await assertLease(rawLease)
      const body = { version: 1 as const, runId, headerDigest, leaseDigest: lease.leaseDigest, binding, observation }
      const record = { ...body, digest: reviewerDigest(body) }
      if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECORD_BYTES) throw new Error('native completion record exceeds infrastructure boundary')
      await assertWorkspace()
      await journalImmutableFiles.ensureDirectories(completionRoot)
      await rawLease.assertOwned()
      await journalImmutableFiles.publishJson(completionPath(binding), record, 'native completion record is too large')
      return structuredClone(record)
    },
    async read(rawBinding: ReviewerNativeCompletionBinding, expectedLeaseDigest: string): Promise<ReviewNativeCompletion<unknown> | undefined> {
      const binding = bindingSchema.parse(structuredClone(rawBinding))
      const leaseDigest = hexDigest.parse(expectedLeaseDigest)
      const path = completionPath(binding)
      try {
        await journalImmutableFiles.assertDirectories(completionRoot)
        const record = recordSchema.parse(await journalImmutableFiles.readJson(path, 'native completion record is invalid'))
        const { digest, ...body } = record
        if (reviewerDigest(body) !== digest || record.runId !== runId || record.headerDigest !== headerDigest || record.leaseDigest !== leaseDigest ||
          !sameBinding(record.binding, binding)) throw new Error('native completion binding mismatch')
        return structuredClone(record.observation)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
  })
}
