import { describe, expect, test, mock, spyOn } from 'bun:test'
import { callMcpTool } from '../execution.js'
import type { ConnectedMCPServer } from '../types.js'
import type { McpClientDependencies } from '../interfaces.js'
import { McpAuthError, McpToolCallError } from '../errors.js'

function createMockDeps(): McpClientDependencies {
  return {
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    httpConfig: {
      getUserAgent: () => 'test-agent/1.0',
    },
  }
}

describe('callMcpTool', () => {
  test('clears its timeout after success, tool error, rejection, or cancellation', async () => {
    const setTimer = spyOn(globalThis, 'setTimeout')
    const clearTimer = spyOn(globalThis, 'clearTimeout')
    try {
      for (const outcome of ['success', 'tool-error', 'rejection', 'abort']) {
        const client = {
          name: 'timer-test',
          type: 'connected',
          client: {
            callTool: async () => {
              if (outcome === 'rejection') throw new Error('connection failed')
              if (outcome === 'abort')
                throw new DOMException('cancelled', 'AbortError')
              return {
                content: [{ type: 'text', text: 'result' }],
                isError: outcome === 'tool-error',
              }
            },
          },
        } as unknown as ConnectedMCPServer
        const before = setTimer.mock.calls.length
        const result = callMcpTool(
          {
            client,
            tool: 'test',
            args: {},
            signal: new AbortController().signal,
          },
          createMockDeps(),
        )
        if (outcome === 'success') await result
        else await expect(result).rejects.toThrow()
        const timer = setTimer.mock.results[before]?.value
        expect(timer).toBeDefined()
        expect(clearTimer).toHaveBeenCalledWith(timer)
      }
    } finally {
      // Clean leaked timers even when this regression fails against old code.
      for (const result of setTimer.mock.results) {
        clearTimeout(result.value as ReturnType<typeof setTimeout>)
      }
      setTimer.mockRestore()
      clearTimer.mockRestore()
    }
  })

  test('fallback timeout still returns promptly if the SDK call stalls', async () => {
    const client = {
      name: 'slow',
      type: 'connected',
      client: { callTool: () => new Promise(() => {}) },
    } as unknown as ConnectedMCPServer
    await expect(
      callMcpTool(
        {
          client,
          tool: 'slow',
          args: {},
          signal: new AbortController().signal,
          timeoutMs: 5,
        },
        createMockDeps(),
      ),
    ).rejects.toThrow('timed out')
  })

  test('calls tool and returns result', async () => {
    const mockResult = {
      content: [{ type: 'text', text: 'result data' }],
      _meta: { requestId: '123' },
    }

    const mockConn = {
      name: 'test-server',
      client: {
        callTool: mock(() => Promise.resolve(mockResult)),
      },
      type: 'connected' as const,
    } as unknown as ConnectedMCPServer

    const result = await callMcpTool(
      {
        client: mockConn,
        tool: 'search',
        args: { query: 'test' },
        signal: new AbortController().signal,
      },
      createMockDeps(),
    )

    expect(result.content).toBeDefined()
  })

  test('throws McpToolCallError when result has isError=true', async () => {
    const mockResult = {
      isError: true,
      content: [{ type: 'text', text: 'Something went wrong' }],
    }

    const mockConn = {
      name: 'test-server',
      client: {
        callTool: mock(() => Promise.resolve(mockResult)),
      },
      type: 'connected' as const,
    } as unknown as ConnectedMCPServer

    await expect(
      callMcpTool(
        {
          client: mockConn,
          tool: 'fail-tool',
          args: {},
          signal: new AbortController().signal,
        },
        createMockDeps(),
      ),
    ).rejects.toThrow()

    try {
      await callMcpTool(
        {
          client: mockConn,
          tool: 'fail-tool',
          args: {},
          signal: new AbortController().signal,
        },
        createMockDeps(),
      )
    } catch (e) {
      expect(e).toBeInstanceOf(McpToolCallError)
      expect((e as McpToolCallError).serverName).toBe('test-server')
      expect((e as McpToolCallError).toolName).toBe('fail-tool')
    }
  })

  test('throws McpAuthError on 401 response', async () => {
    const error = new Error('Unauthorized')
    Object.assign(error, { code: 401 })

    const mockConn = {
      name: 'auth-server',
      client: {
        callTool: mock(() => Promise.reject(error)),
      },
      type: 'connected' as const,
    } as unknown as ConnectedMCPServer

    await expect(
      callMcpTool(
        {
          client: mockConn,
          tool: 'protected-tool',
          args: {},
          signal: new AbortController().signal,
        },
        createMockDeps(),
      ),
    ).rejects.toThrow(McpAuthError)
  })

  test('passes metadata to the client', async () => {
    const mockResult = { content: [{ type: 'text', text: 'ok' }] }
    const callToolMock = mock(() => Promise.resolve(mockResult))

    const mockConn = {
      name: 'test-server',
      client: {
        callTool: callToolMock,
      },
      type: 'connected' as const,
    } as unknown as ConnectedMCPServer

    await callMcpTool(
      {
        client: mockConn,
        tool: 'my-tool',
        args: { key: 'value' },
        meta: { 'custom-key': 'custom-value' },
        signal: new AbortController().signal,
      },
      createMockDeps(),
    )

    expect(callToolMock).toHaveBeenCalled()
    const callArgs = callToolMock.mock.calls[0] as any[]
    expect(callArgs[0]._meta).toEqual({ 'custom-key': 'custom-value' })
  })
})
