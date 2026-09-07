import { z } from 'zod/v4'
import type {
  UsageBillingSubmission,
  UsageBillingUsage,
} from '../../../../billing/public'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const nonNegativeSafeInteger = z.number().int().safe().nonnegative()
const identifier = z.string().min(1)

/** The stage-owned usage snapshot sent to the public billing boundary. */
export const revisionBillingUsageSchema = z
  .object({
    prompt_tokens: nonNegativeSafeInteger,
    completion_tokens: nonNegativeSafeInteger,
    cache_read_tokens: nonNegativeSafeInteger,
    cache_creation_tokens: nonNegativeSafeInteger,
    total_tokens: nonNegativeSafeInteger,
  })
  .strict()
  .refine(
    value => {
      const total =
        value.prompt_tokens +
        value.completion_tokens +
        value.cache_read_tokens +
        value.cache_creation_tokens
      return Number.isSafeInteger(total) && value.total_tokens === total
    },
    { message: 'total_tokens must equal the exact sum of usage components' },
  )

const backendReceiptSchema = z
  .object({
    eventId: identifier,
    duplicate: z.boolean(),
    weightedTokensDelta: z.number().finite(),
    creditsMicro: z.number().finite(),
  })
  .strict()

const receiptFields = {
  protocolVersion: z.literal(1),
  ownerId: identifier,
  eventId: identifier,
  idempotencyKey: identifier,
  pricingVersion: z.literal('weighted-v1'),
  usageSource: z.literal('runtime_snapshot'),
  usage: revisionBillingUsageSchema,
}

const recordedReceiptSchema = z
  .object({
    ...receiptFields,
    duplicate: z.boolean(),
    recorded: backendReceiptSchema,
    debited: backendReceiptSchema,
  })
  .strict()

const skippedReceiptSchema = z
  .object({
    ...receiptFields,
    skipped: z.literal(true),
    duplicate: z.literal(false),
  })
  .strict()

/** Runtime schema for the exact public usage billing submission union. */
export const revisionBillingReceiptSchema = z.union([
  recordedReceiptSchema,
  skippedReceiptSchema,
])

export type RevisionBillingUsage = z.infer<typeof revisionBillingUsageSchema>

function captureJson(value: unknown): unknown {
  return JSON.parse(revisionCanonicalJson(value)) as unknown
}

function captureUsage(value: unknown): RevisionBillingUsage {
  return revisionBillingUsageSchema.parse(captureJson(value))
}

/** Stable idempotency identity for one terminal usage fact. */
export function revisionUsageEventId(
  handle: string,
  attemptId: string,
  usage: UsageBillingUsage,
): string {
  const capturedUsage = captureUsage(usage)
  return `usage-terminal:foundation-revision:${handle}:${attemptId}:${revisionDigest(capturedUsage)}`
}

/**
 * Capture and validate a public billing result against its stage-owned fact.
 * Backend record/debit event IDs remain nested backend evidence; `eventId`
 * and `idempotencyKey` are the public terminal-fact identity.
 */
export function validateRevisionBillingReceipt(
  value: unknown,
  binding: { ownerId: string; eventId: string; usage: UsageBillingUsage },
): UsageBillingSubmission {
  const receipt = revisionBillingReceiptSchema.parse(captureJson(value))
  const usage = captureUsage(binding.usage)
  if (
    receipt.ownerId !== binding.ownerId ||
    receipt.eventId !== binding.eventId ||
    receipt.idempotencyKey !== binding.eventId
  )
    throw new Error('Revision billing receipt identity or idempotency mismatch')
  if (revisionCanonicalJson(receipt.usage) !== revisionCanonicalJson(usage))
    throw new Error('Revision billing receipt usage mismatch')
  if ('skipped' in receipt) {
    if (usage.total_tokens !== 0)
      throw new Error('Revision billing receipt cannot skip positive usage')
  } else if (usage.total_tokens === 0) {
    throw new Error('Revision zero usage must use the skipped billing receipt')
  }
  return receipt
}

function comparableReceipt(value: UsageBillingSubmission): unknown {
  const receipt = revisionBillingReceiptSchema.parse(captureJson(value))
  if ('skipped' in receipt) return receipt
  return {
    ...receipt,
    duplicate: false,
    recorded: { ...receipt.recorded, duplicate: false },
    debited: { ...receipt.debited, duplicate: false },
  }
}

/** Compare receipts while ignoring only duplicate markers. */
export function compatibleRevisionBillingReceipts(
  a: UsageBillingSubmission,
  b: UsageBillingSubmission,
): boolean {
  return (
    revisionCanonicalJson(comparableReceipt(a)) ===
    revisionCanonicalJson(comparableReceipt(b))
  )
}
