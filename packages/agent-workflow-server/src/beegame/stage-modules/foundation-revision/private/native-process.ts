import { runNativeFileAgent, type FileAgentInput, type FileAgentCompletion } from '@bee-game-studio/agent-workflow/native-file-agent'

export type RevisionNativeProcessConfiguration = { command: readonly string[]; env: Record<string, string> }
export type RevisionNativeProcessCompletion = FileAgentCompletion
export type RevisionNativeProcessResult = { submission: unknown; completion: RevisionNativeProcessCompletion }
export { RevisionNativeProcessError, REVISION_NATIVE_PROCESS_ERROR_CODES, type RevisionNativeProcessErrorCode } from './native-process-errors'
import { RevisionNativeProcessError, type RevisionNativeProcessErrorCode } from './native-process-errors'
/** The native runner explicitly keeps MAX_STRUCTURED_OUTPUT_RETRIES=5 and
 * QueryEngine.ts:1068-1108 remains unchanged. This replaces only the separate
 * host document-resubmission loop, not the user-required native retry guard. */
export async function executeRevisionNativeProcess(input: {
  configuration: RevisionNativeProcessConfiguration; cwd: string; prompt: string; logPath: string;
  writablePaths: readonly string[]; outputSchema: object; signal?: AbortSignal;
  onMessage?: FileAgentInput['onMessage']; onProgress?: FileAgentInput['onProgress'];
}): Promise<RevisionNativeProcessResult> {
  const native = await runNativeFileAgent({ command: input.configuration.command, env: input.configuration.env,
    workspacePath: input.cwd, prompt: input.prompt, logPath: input.logPath, writablePaths: input.writablePaths,
    allowWorkingFiles: true, readOnlyPaths: ['requirements.md', 'review.json'],
    schema: input.outputSchema, signal: input.signal, onMessage: input.onMessage, onProgress: input.onProgress })
  if (native.failure || !native.result) {
    const codes: Record<string, RevisionNativeProcessErrorCode> = {
      stopped: 'revision_native_aborted', spawn_failed: 'revision_native_spawn_failed',
      write_failed: 'revision_native_write_failed', output_limit: 'revision_native_output_limit',
      observation_failed: 'revision_native_observer_failed', model_failed: 'revision_native_result_failed',
      missing_result: 'revision_native_missing_terminal',
    }
    throw new RevisionNativeProcessError(codes[native.failure ?? 'missing_result'] ?? 'revision_native_process_error', native.completion)
  }
  return { submission: native.result.structured_output, completion: native.completion }
}
