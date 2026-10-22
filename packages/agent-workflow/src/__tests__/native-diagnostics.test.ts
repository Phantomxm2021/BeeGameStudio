import { expect, test } from 'bun:test'
import { nativeErrorMetadata, parseNativeDiagnostic, takeNativeObserverMetadata } from '../native-diagnostics'

test('provider accounting admits only complete safe numeric counters, never raw usage/source data', () => {
  const counts = { cumulativeInputTokens: 10, cumulativeOutputTokens: 3,
    cumulativeCacheReadTokens: 100, cumulativeCacheCreationTokens: 0 }
  expect(parseNativeDiagnostic({ event: 'stream_end', ...counts, prompt: 'PRIVATE', usage: { key: 'PRIVATE' } }))
    .toEqual({ event: 'stream_end', ...counts })
  for (const value of [-1, 1.5, Infinity, '100'])
    expect(parseNativeDiagnostic({ event: 'stream_end', ...counts, cumulativeInputTokens: value })).toBeUndefined()
})

test('preserves safe correlation but drops arbitrary names, codes and source text', () => {
  expect(parseNativeDiagnostic({ event: 'stream_error', request: 8, originRequest: 7, actor: 'a12345678',
    mode: 'non_streaming_fallback', phase: 'body', outcome: 'failed', errorCode: 'ECONNRESET',
    errorOrigin: 'observer', prompt: 'PRIVATE', headers: { token: 'PRIVATE' } })).toEqual({
    event: 'stream_error', request: 8, originRequest: 7, actor: 'a12345678', mode: 'non_streaming_fallback',
    phase: 'body', outcome: 'failed', errorCode: 'ECONNRESET', errorOrigin: 'observer',
  })
  expect(parseNativeDiagnostic({ event: 'request_start', actor: 'PRIVATE_TEAM_NAME', errorCode: 'PRIVATE_KEY' }))
    .toEqual({ event: 'request_start' })
})

test('thinking diagnostics distinguish requested policy, wire parameter and returned blocks without source text', () => {
  expect(parseNativeDiagnostic({ event: 'request_start', thinkingPolicy: 'adaptive', thinkingParameter: 'default',
    thinkingReturned: true, thinking: 'PRIVATE_REASONING', signature: 'PRIVATE_SIGNATURE' })).toEqual({
      event: 'request_start', thinkingPolicy: 'adaptive', thinkingParameter: 'default', thinkingReturned: true,
    })
  expect(parseNativeDiagnostic({ event: 'stream_end', thinkingPolicy: 'PRIVATE',
    thinkingParameter: 'PRIVATE', thinkingReturned: 'PRIVATE' })).toEqual({ event: 'stream_end' })
})

test.each([['ECONNRESET', 'connection'], ['ENOTFOUND', 'dns'], ['ETIMEDOUT', 'timeout'],
  ['CERT_HAS_EXPIRED', 'tls']] as const)('classifies bounded cause chain %s without saving raw errors', (code, category) => {
  const error = new Error('PRIVATE_URL_PRIVATE_KEY', { cause: Object.assign(new Error('PRIVATE_DETAIL'), { code }) })
  expect(nativeErrorMetadata(error)).toEqual({ category, errorCode: code })
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic
  expect(nativeErrorMetadata(cyclic)).toEqual({ category: 'other' })
})

test('distinguishes observer-generated 502 from upstream HTTP 502', () => {
  expect(nativeErrorMetadata({ status: 502, headers: new Headers({ 'x-bgs-observer-error-category': 'dns' }) }))
    .toEqual({ category: 'dns', errorOrigin: 'observer' })
  expect(nativeErrorMetadata({ status: 502 })).toEqual({ category: 'server' })
})

test('legacy correlation metadata is sanitized and stripped before forwarding', () => {
  const headers = new Headers({ 'x-bgs-observer-request': '42', 'x-bgs-observer-actor': 'a12345678',
    'x-bgs-observer-mode': 'non_streaming_fallback', 'x-bgs-observer-origin': '39',
    'x-bgs-observer-attempt': '2', 'x-api-key': 'PRIVATE_KEY' })
  expect(takeNativeObserverMetadata(headers)).toEqual({ request: 42, actor: 'a12345678',
    mode: 'non_streaming_fallback', originRequest: 39, attempt: 2 })
  expect([...headers]).toEqual([['x-api-key', 'PRIVATE_KEY']])
  const invalid = new Headers({ 'x-bgs-observer-request': 'PRIVATE_KEY', 'x-bgs-observer-actor': 'PRIVATE_NAME' })
  expect(takeNativeObserverMetadata(invalid)).toEqual({})
  expect([...invalid]).toEqual([])
})


test('stream summaries admit structural evidence only', () => {
  const safe = { event: 'openai_stream_summary', streamFailure: 'upstream_incomplete',
    responseFormat: 'event_stream', bytes: 120, wireEvents: 2, parsedChunks: 2,
    invalidFrames: 0, skippedFrames: 0, maxGapMs: 300, wireFinishSeen: false,
    parsedFinishSeen: false, doneSeen: true, eofSeen: true, pendingFrame: false,
    terminalWithoutDelta: false } as const
  expect(parseNativeDiagnostic({ ...safe, headers: { authorization: 'PRIVATE_KEY' },
    body: 'PRIVATE', error: 'PRIVATE', finishReason: 'PRIVATE' })).toEqual(safe)
  expect(parseNativeDiagnostic({ event: safe.event, streamFailure: 'PRIVATE', responseFormat: 'PRIVATE',
    wireFinishSeen: 'PRIVATE' })).toEqual({ event: safe.event })
  expect(parseNativeDiagnostic({ ...safe, wireEvents: -1 })).toBeUndefined()
})
