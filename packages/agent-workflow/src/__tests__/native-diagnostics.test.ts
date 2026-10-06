import { afterEach, expect, test } from 'bun:test'
import { nativeErrorMetadata, nativeObserverHeaders, parseNativeDiagnostic, takeNativeObserverMetadata } from '../native-diagnostics'

const originalFlag = process.env.BEEGAME_MODEL_OBSERVER_METADATA
const originalUrl = process.env.ANTHROPIC_BASE_URL
afterEach(() => {
  if (originalFlag === undefined) delete process.env.BEEGAME_MODEL_OBSERVER_METADATA
  else process.env.BEEGAME_MODEL_OBSERVER_METADATA = originalFlag
  if (originalUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalUrl
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

test('correlation headers require explicit local observation and are removed before forwarding', () => {
  const value = { event: 'request_start' as const, request: 42, actor: 'a12345678',
    mode: 'non_streaming_fallback' as const, originRequest: 39, attempt: 2 }
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1234'
  delete process.env.BEEGAME_MODEL_OBSERVER_METADATA
  expect(nativeObserverHeaders(value)).toEqual({})
  process.env.BEEGAME_MODEL_OBSERVER_METADATA = '1'
  process.env.ANTHROPIC_BASE_URL = 'https://provider.example'
  expect(nativeObserverHeaders(value)).toEqual({})
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1234'
  const headers = new Headers({ ...nativeObserverHeaders(value), 'x-api-key': 'PRIVATE_KEY' })
  expect(takeNativeObserverMetadata(headers)).toEqual({ request: 42, actor: 'a12345678',
    mode: 'non_streaming_fallback', originRequest: 39, attempt: 2 })
  expect([...headers]).toEqual([['x-api-key', 'PRIVATE_KEY']])
  const invalid = new Headers({ 'x-bgs-observer-request': 'PRIVATE_KEY', 'x-bgs-observer-actor': 'PRIVATE_NAME' })
  expect(takeNativeObserverMetadata(invalid)).toEqual({})
  expect([...invalid]).toEqual([])
})
