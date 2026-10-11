import { nativeErrorCategory, type NativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'

/** Read existing CLI diagnostics, never intercept its provider or retain raw
 * debug text (which may contain HTTP bodies/credentials). Unknown lines are
 * deliberately ignored. These observations are not complete API accounting. */
export function standardCliDebugDiagnostic(line: string): NativeDiagnostic | undefined {
  // SDK info response lines include URLs and request-id header values. Parse
  // only numeric status/timing; never store the line or either identifier.
  const response = /^\[Anthropic SDK INFO\] \[[^\]\r\n]+\] (?:POST|GET|post|get) \S+ (?:succeeded|failed) with status (\d{3}) in (\d+)ms(?: - .*)?$/.exec(line)
  if (response) return { event: 'response_headers', status: Number(response[1]), delayMs: Number(response[2]), evidenceSource: 'cli_debug' }
  const match = /^\d{4}-\d\d-\d\dT[^ ]+ \[(?:DEBUG|INFO|WARN|ERROR)\] (.*)$/.exec(line)
  if (!match) return
  const text = match[1]!
  const request = /^\[API REQUEST\] \S+(?: x-client-request-id=[\w-]+)? source=([\w-]+)$/.exec(text)
  if (request) return { event: 'request_start', source: request[1] === 'compact' ? 'compact'
    : request[1] === 'repl_main_thread' ? 'main' : 'other', evidenceSource: 'cli_debug' }
  if (text.startsWith('[API:request] Creating client,')) return { event: 'client_start', evidenceSource: 'cli_debug' }
  if (text === '[API:auth] OAuth token check complete') return { event: 'client_ready', evidenceSource: 'cli_debug' }
  if (text === 'Stream started - received first chunk') return { event: 'first_stream_event', evidenceSource: 'cli_debug' }
  const error = /^API error \(attempt (\d+)\/(\d+)\): (.*)$/.exec(text)
  if (error) {
    const status = /^(\d{3})(?:\s|$)/.exec(error[3]!)
    return { event: 'api_error', attempt: Number(error[1]), evidenceSource: 'cli_debug',
      ...(status ? { status: Number(status[1]) } : {}),
      category: nativeErrorCategory({ status: status ? Number(status[1]) : undefined, message: error[3] }) }
  }
  if (text.startsWith('Streaming aborted by user:')) return { event: 'stream_error', category: 'aborted', evidenceSource: 'cli_debug' }
  if (text.startsWith('Streaming timeout (SDK abort):')) return { event: 'stream_error', category: 'timeout', evidenceSource: 'cli_debug' }
  if (text.startsWith('Error streaming, falling back to non-streaming mode:'))
    return { event: 'stream_error', mode: 'non_streaming_fallback', evidenceSource: 'cli_debug' }
  if (/^Forked agent \[compact\] finished: \d+ messages,/.test(text))
    return { event: 'request_end', source: 'compact', evidenceSource: 'cli_debug' }
}

/** Standard flags only. Custom non-CLI transports and explicit user-selected
 * debug destinations remain untouched. No model, retry or turn policy changes. */
export function withStandardCliDiagnostics(command: string[]): string[] {
  if (!command.includes('--print') || command.some(arg => arg === '--debug-to-stderr' ||
      /^--debug(?:$|=|-file(?:=|$))/.test(arg) || arg === '-d')) return command
  return [...command, '--debug-to-stderr']
}
