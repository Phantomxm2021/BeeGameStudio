import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  MAX_MCP_DESCRIPTION_LENGTH,
  MAX_ERRORS_BEFORE_RECONNECT,
  isTerminalConnectionError,
  isMcpSessionExpiredError,
  withConnectionTimeout,
} from '../connection.js'

describe('withConnectionTimeout', () => {
  test('returns the timeout even when cleanup never settles', async () => {
    let called = false
    let guard: ReturnType<typeof setTimeout> | undefined
    try {
      const connection = withConnectionTimeout(new Promise(() => {}), 5, () => {
        called = true
        return new Promise(() => {})
      })
      const result = await Promise.race([
        connection.catch(error => error.message),
        new Promise<string>(resolve => {
          guard = setTimeout(() => resolve('stalled'), 100)
        }),
      ])
      expect(result).toBe('MCP connection timed out after 5ms')
      expect(called).toBe(true)
    } finally {
      clearTimeout(guard)
    }
  })

  test('cleanup throws or rejects without replacing the timeout or leaking a rejection', async () => {
    for (const cleanup of [
      () => {
        throw new Error('cleanup failed')
      },
      () => Promise.reject(new Error('cleanup failed')),
    ]) {
      await expect(
        withConnectionTimeout(new Promise(() => {}), 5, cleanup),
      ).rejects.toThrow('MCP connection timed out after 5ms')
    }
    await Bun.sleep(1)
  })

  test('normal connection success and failure cancel cleanup', async () => {
    let cleanupCalls = 0
    const cleanup = () => {
      cleanupCalls++
    }
    expect(
      await withConnectionTimeout(Promise.resolve('connected'), 5, cleanup),
    ).toBe('connected')
    await expect(
      withConnectionTimeout(
        Promise.reject(new Error('connection failed')),
        5,
        cleanup,
      ),
    ).rejects.toThrow('connection failed')
    await Bun.sleep(10)
    expect(cleanupCalls).toBe(0)
  })
})

describe('connection constants', () => {
  test('has reasonable defaults', () => {
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(30_000)
    expect(MAX_MCP_DESCRIPTION_LENGTH).toBe(2048)
    expect(MAX_ERRORS_BEFORE_RECONNECT).toBe(3)
  })
})

describe('isTerminalConnectionError', () => {
  test('detects ECONNRESET', () => {
    expect(isTerminalConnectionError('Connection reset: ECONNRESET')).toBe(true)
  })

  test('detects ETIMEDOUT', () => {
    expect(isTerminalConnectionError('Connection timed out: ETIMEDOUT')).toBe(
      true,
    )
  })

  test('detects EPIPE', () => {
    expect(isTerminalConnectionError('Broken pipe: EPIPE')).toBe(true)
  })

  test('detects EHOSTUNREACH', () => {
    expect(isTerminalConnectionError('Host unreachable: EHOSTUNREACH')).toBe(
      true,
    )
  })

  test('detects ECONNREFUSED', () => {
    expect(isTerminalConnectionError('Connection refused: ECONNREFUSED')).toBe(
      true,
    )
  })

  test('detects SSE disconnection messages', () => {
    expect(isTerminalConnectionError('SSE stream disconnected')).toBe(true)
    expect(isTerminalConnectionError('Failed to reconnect SSE stream')).toBe(
      true,
    )
  })

  test('detects terminated', () => {
    expect(isTerminalConnectionError('Process terminated')).toBe(true)
  })

  test('rejects non-terminal errors', () => {
    expect(isTerminalConnectionError('some random error')).toBe(false)
    expect(isTerminalConnectionError('')).toBe(false)
    expect(isTerminalConnectionError('timeout waiting for response')).toBe(
      false,
    )
  })
})

describe('isMcpSessionExpiredError', () => {
  test('detects 404 with JSON-RPC session-not-found code', () => {
    const error = new Error(
      'Not found: {"code":-32001,"message":"Session not found"}',
    )
    Object.assign(error, { code: 404 })
    expect(isMcpSessionExpiredError(error)).toBe(true)
  })

  test('detects 404 with spaced JSON-RPC code', () => {
    const error = new Error('Not found: {"code": -32001}')
    Object.assign(error, { code: 404 })
    expect(isMcpSessionExpiredError(error)).toBe(true)
  })

  test('rejects non-404 errors', () => {
    const error = new Error('{"code":-32001}')
    Object.assign(error, { code: 500 })
    expect(isMcpSessionExpiredError(error)).toBe(false)
  })

  test('rejects 404 without session code', () => {
    const error = new Error('Not found')
    Object.assign(error, { code: 404 })
    expect(isMcpSessionExpiredError(error)).toBe(false)
  })

  test('rejects errors without code property', () => {
    const error = new Error('Session not found')
    expect(isMcpSessionExpiredError(error)).toBe(false)
  })
})
