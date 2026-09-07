import { z } from 'zod/v4'
import { RevisionNativeProcessError, REVISION_NATIVE_PROCESS_ERROR_CODES, type RevisionNativeProcessErrorCode } from './native-process'

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
const outputDiagnosticReasonCodes = [
  'validation_empty_content',
  'validation_front_matter',
  'validation_title',
  'validation_reference',
  'validation_marker',
  'validation_marker_order',
  'validation_content_duplicate',
  'validation_content_empty',
  'validation_heading',
  'validation_material_format',
  'validation_section_permission',
  'validation_section_missing',
  'validation_section_duplicate',
  'validation_no_progress',
  'validation_service_metadata_invalid',
  'validation_worker_changed_metadata',
  'validation_timestamp_not_advanced',
  'validation_size_limit',
  'validation_unknown',
] as const
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

const exactOutputReasons: Readonly<Record<string, RevisionFailureDiagnosticReasonCode>> = {
  'document revision staged document must be non-empty': 'validation_empty_content',
  'document revision staged document body must be non-empty': 'validation_empty_content',
  'Revision document front matter is missing': 'validation_front_matter',
  'Revision document front matter is invalid': 'validation_front_matter',
  'complete game document requires one document title': 'validation_title',
  'complete game document repeats a substantive content block': 'validation_content_duplicate',
  'complete game document contains an empty template sentence': 'validation_content_empty',
  'Revision document contains no repair progress': 'validation_no_progress',
  'revision changed an unauthorized section': 'validation_section_permission',
  'revision contains no section progress': 'validation_no_progress',
  'foundation revision contains duplicate section replacements': 'validation_section_duplicate',
  'foundation revision output contains duplicate section replacements': 'validation_section_duplicate',
  'Revision document service metadata is invalid': 'validation_service_metadata_invalid',
  'Revision document updated_at is invalid': 'validation_service_metadata_invalid',
  'Revision document version is invalid': 'validation_service_metadata_invalid',
  'Revision document version cannot advance': 'validation_service_metadata_invalid',
  'Revision document updated_at requires an owner timestamp': 'validation_timestamp_not_advanced',
  'Revision document updated_at must advance': 'validation_timestamp_not_advanced',
  'Revision candidate added service metadata without a source authority': 'validation_worker_changed_metadata',
  'Revision candidate changed service metadata without document progress': 'validation_worker_changed_metadata',
  'Revision worker changed service-owned metadata': 'validation_worker_changed_metadata',
  'Revision Markdown exceeds infrastructure boundary': 'validation_size_limit',
}

function classifyOutputMessage(message: string | undefined): RevisionFailureDiagnostic {
  if (!message) return diagnostic('output_validation', 'validation_unknown')
  const exact = Object.hasOwn(exactOutputReasons, message) ? exactOutputReasons[message] : undefined
  if (exact) return diagnostic('output_validation', exact)
  if (message.startsWith('complete game document sections must exactly match the canonical order') ||
      message.startsWith('complete game document production materials must exactly match the canonical order') ||
      message.startsWith('complete game document structure must exactly match the canonical order') ||
      message === 'revision changed section markers or section order')
    return diagnostic('output_validation', 'validation_marker_order')
  if (message.startsWith('complete game document') && message.includes('marker'))
    return diagnostic('output_validation', 'validation_marker')
  if (message.startsWith('complete game document contains non-canonical document reference:'))
    return diagnostic('output_validation', 'validation_reference')
  if (message.startsWith('complete game document') && message.includes('empty or invalid'))
    return diagnostic('output_validation', 'validation_content_empty')
  if (message.startsWith('complete game document') && message.includes('heading'))
    return diagnostic('output_validation', 'validation_heading')
  if (message.startsWith('complete game document section title is invalid:') ||
      message.startsWith('production material title is invalid:') ||
      message.startsWith('section heading'))
    return diagnostic('output_validation', 'validation_heading')
  if (message.startsWith('production material format is invalid') ||
      message === 'complete game document acceptance criteria are empty or invalid')
    return diagnostic('output_validation', 'validation_material_format')
  if (message.startsWith('foundation revision output must contain exactly one authorized heading') ||
      message === 'foundation revision output contains prose outside authorized sections' ||
      message === 'foundation revision output omitted an authorized section' ||
      message === 'foundation revision section Markdown cannot contain protocol markers' ||
      message.startsWith('foundation revision section Markdown must start with its canonical heading') ||
      message === 'foundation revision replacement is outside its authority')
    return diagnostic('output_validation', 'validation_section_missing')
  if (message.startsWith('duplicate revision section:') ||
      message === 'foundation revision contains duplicate section replacements')
    return diagnostic('output_validation', 'validation_section_duplicate')
  if (message === 'revision changed bytes outside authorized sections' ||
      message === 'Revision document contains no repair progress')
    return diagnostic('output_validation', message.endsWith('no repair progress') ? 'validation_no_progress' : 'validation_section_permission')
  return diagnostic('output_validation', 'validation_unknown')
}

/** Classify a validator failure without persisting any untrusted text. */
export function classifyRevisionOutputFailure(value: unknown): RevisionFailureDiagnostic {
  try {
    if (!(value instanceof Error)) return diagnostic('output_validation', 'validation_unknown')
  } catch {
    return diagnostic('output_validation', 'validation_unknown')
  }
  return classifyOutputMessage(ownString(value, 'message'))
}

/** Classify an owner-side failure only for callers that need observation.  The
 * owned attempt intentionally does not persist this result: owner_failed is a
 * control/authorization failure, not an output diagnosis. */
export function classifyRevisionNativeFailure(value: unknown): RevisionFailureDiagnostic | undefined {
  return classifyNativeCode(value)
}
