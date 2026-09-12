import type { FileAgentCompletion } from '@bee-game-studio/agent-workflow/native-file-agent'
type RevisionNativeProcessCompletion = FileAgentCompletion
// Historical diagnostic vocabulary remains readable, not executable policy.
export const REVISION_NATIVE_PROCESS_ERROR_CODES = [
  'revision_native_invalid_input', 'revision_native_spawn_failed', 'revision_native_write_failed',
  'revision_native_invalid_json', 'revision_native_output_limit', 'revision_native_observer_failed',
  'revision_native_aborted', 'revision_native_tool_rejected', 'revision_native_tool_failed',
  'revision_native_result_failed', 'revision_native_markdown_invalid',
  'revision_native_missing_terminal', 'revision_native_process_error',
] as const
export type RevisionNativeProcessErrorCode = typeof REVISION_NATIVE_PROCESS_ERROR_CODES[number]
export class RevisionNativeProcessError extends Error {
  readonly name = 'RevisionNativeProcessError'
  constructor(readonly code: RevisionNativeProcessErrorCode, readonly completion?: RevisionNativeProcessCompletion) { super(code) }
}
