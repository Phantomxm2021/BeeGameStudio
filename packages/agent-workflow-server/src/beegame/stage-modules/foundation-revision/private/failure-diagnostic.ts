import { z } from 'zod/v4'
import { RevisionNativeProcessError, REVISION_NATIVE_PROCESS_ERROR_CODES, type RevisionNativeProcessErrorCode } from './native-process-errors'

/**
 * Failure diagnostics are deliberately a small closed vocabulary.  They are
 * observation only: no worker bytes, provider text, filesystem paths, or
 * process details are allowed to cross this boundary.
 */
export const REVISION_FAILURE_DIAGNOSTIC_STAGES = ['native', 'output_validation'] as const
export type RevisionFailureDiagnosticStage = typeof REVISION_FAILURE_DIAGNOSTIC_STAGES[number]

const nativeDiagnosticReasonCodes = [
  'revision_native_invalid_input',
  'revision_native_spawn_failed',
  'revision_native_write_failed',
  'revision_native_invalid_json',
  'revision_native_output_limit',
  'revision_native_observer_failed',
  'revision_native_tool_rejected',
  'revision_native_tool_failed',
  'revision_native_result_failed',
  'revision_native_markdown_invalid',
  'revision_native_missing_terminal',
  'revision_native_process_error',
  'native_unknown',
] as const
const outputDiagnosticReasonCodes = ['validation_unknown'] as const
export const REVISION_FAILURE_DIAGNOSTIC_REASON_CODES = [
  ...nativeDiagnosticReasonCodes, ...outputDiagnosticReasonCodes,
] as const
export type RevisionFailureDiagnosticReasonCode = typeof REVISION_FAILURE_DIAGNOSTIC_REASON_CODES[number]

const revisionFailureDiagnosticBaseSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('native'), reasonCode: z.enum(nativeDiagnosticReasonCodes) }).strict(),
  z.object({ stage: z.literal('output_validation'), reasonCode: z.enum(outputDiagnosticReasonCodes) }).strict(),
])
export const revisionFailureDiagnosticSchema = revisionFailureDiagnosticBaseSchema.superRefine((value, context) => {
  // Keep this check explicit even though the enum currently makes the object
  // tiny.  It prevents a future vocabulary extension from silently becoming
  // an unbounded journal field.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 256)
    context.addIssue({ code: 'custom', message: 'Revision failure diagnostic is too large' })
})

export type RevisionFailureDiagnostic = z.infer<typeof revisionFailureDiagnosticSchema>

const nativeReasonCodes: Readonly<Record<RevisionNativeProcessErrorCode, RevisionFailureDiagnosticReasonCode>> = {
  revision_native_invalid_input: 'revision_native_invalid_input',
  revision_native_spawn_failed: 'revision_native_spawn_failed',
  revision_native_write_failed: 'revision_native_write_failed',
  revision_native_invalid_json: 'revision_native_invalid_json',
  revision_native_output_limit: 'revision_native_output_limit',
  revision_native_observer_failed: 'revision_native_observer_failed',
  revision_native_aborted: 'native_unknown',
  revision_native_tool_rejected: 'revision_native_tool_rejected',
  revision_native_tool_failed: 'revision_native_tool_failed',
  revision_native_result_failed: 'revision_native_result_failed',
  revision_native_markdown_invalid: 'revision_native_markdown_invalid',
  revision_native_missing_terminal: 'revision_native_missing_terminal',
  revision_native_process_error: 'revision_native_process_error',
}

function diagnostic(stage: RevisionFailureDiagnosticStage, reasonCode: RevisionFailureDiagnosticReasonCode): RevisionFailureDiagnostic {
  return revisionFailureDiagnosticSchema.parse({ stage, reasonCode })
}

/** Read only own data properties.  In particular, never read message/stack/
 * cause through a getter supplied by an arbitrary thrown value. */
function ownString(value: unknown, key: string): string | undefined {
  try {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function classifyNativeCode(value: unknown): RevisionFailureDiagnostic | undefined {
  try {
    if (!(value instanceof RevisionNativeProcessError)) return undefined
    const code = ownString(value, 'code')
    const knownCode = REVISION_NATIVE_PROCESS_ERROR_CODES.find(candidate => candidate === code)
    if (!knownCode) return diagnostic('native', 'native_unknown')
    // Native abort is a control outcome, not a failure diagnostic.  A stop may
    // race with a native error; request-execution-state strips submitted retry
    // diagnostics when the durable effective settlement is stopped.
    if (knownCode === 'revision_native_aborted') return undefined
    return diagnostic('native', nativeReasonCodes[knownCode])
  } catch {
    return diagnostic('native', 'native_unknown')
  }
}

/** Classify a validator failure without persisting any untrusted text. */
export function classifyRevisionOutputFailure(value: unknown): RevisionFailureDiagnostic {
  try {
    if (!(value instanceof Error)) return diagnostic('output_validation', 'validation_unknown')
  } catch {
    return diagnostic('output_validation', 'validation_unknown')
  }
  return diagnostic('output_validation', 'validation_unknown')
}

/** Classify an owner-side failure only for callers that need observation.  The
 * owned attempt intentionally does not persist this result: owner_failed is a
 * control/authorization failure, not an output diagnosis. */
export function classifyRevisionNativeFailure(value: unknown): RevisionFailureDiagnostic | undefined {
  return classifyNativeCode(value)
}
