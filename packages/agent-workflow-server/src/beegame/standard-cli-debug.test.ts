import { test, expect } from 'bun:test'
import { parseNativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'
import { standardCliDebugDiagnostic, withStandardCliDiagnostics } from './standard-cli-debug'

const prefix = '2026-10-11T05:32:51.009Z [DEBUG] '
test('standard debug observations retain only known metadata, never request/error bodies', () => {
  const request = standardCliDebugDiagnostic(prefix+'[API REQUEST] /v1/messages source=compact')
  expect(parseNativeDiagnostic(request)).toEqual({event:'request_start',source:'compact',evidenceSource:'cli_debug'})
  expect(standardCliDebugDiagnostic('[Anthropic SDK INFO] [log-secret, request-id: "SECRET"] POST https://PRIVATE.test/messages succeeded with status 200 in 81ms'))
    .toEqual({event:'response_headers',status:200,delayMs:81,evidenceSource:'cli_debug'})
  expect(standardCliDebugDiagnostic('[Anthropic SDK INFO] [log_fixture] post http://127.0.0.1:1234/v1/messages?beta=true succeeded with status 200 in 3ms'))
    .toEqual({event:'response_headers',status:200,delayMs:3,evidenceSource:'cli_debug'})
  expect(standardCliDebugDiagnostic(prefix+'Stream started - received first chunk')).toMatchObject({event:'first_stream_event'})
  const error = standardCliDebugDiagnostic(prefix+'API error (attempt 2/11): 429 SECRET_TOKEN_PRIVATE_BODY')
  expect(parseNativeDiagnostic(error)).toMatchObject({event:'api_error',attempt:2,status:429,category:'rate_limit'})
  expect(JSON.stringify(error)).not.toContain('SECRET')
  expect(standardCliDebugDiagnostic(prefix+'Forked agent [compact] finished: 1 messages, types=[assistant], totalUsage: input=0')).toMatchObject({source:'compact',event:'request_end'})
  for (const line of [prefix+'SECRET HTTP headers',prefix+'[API REQUEST] /v1/messages source=compact SECRET',
    'SECRET\n[API REQUEST] /v1/messages source=compact',prefix+'API error (attempt 1/5): SECRET']) {
    const result=standardCliDebugDiagnostic(line)
    expect(JSON.stringify(result) ?? '').not.toContain('SECRET')
  }
})
test('diagnostics change no model, tools, retry, resume or execution limits', () => {
  const command=['bun','cli.js','--print','--resume=existing','--append-system-prompt','unchanged']
  expect(withStandardCliDiagnostics(command)).toEqual([...command,'--debug-to-stderr'])
  expect(command).toHaveLength(6)
  for(const flags of [['--debug-file','selected.log'],['--debug=api'],['--debug'],['--debug-to-stderr']]) {
    const selected=[...command,...flags];expect(withStandardCliDiagnostics(selected)).toBe(selected)
  }
  const nonCli=['bun','fixture.ts'];expect(withStandardCliDiagnostics(nonCli)).toBe(nonCli)
})
