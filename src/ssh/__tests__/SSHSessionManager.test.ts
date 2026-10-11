import { describe, test, expect, mock, beforeEach, spyOn } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('src/utils/debug.ts', debugMock)

import { SSHSessionManagerImpl } from '../SSHSessionManager'
import type { SSHSessionManagerOptions } from '../SSHSessionManager'
import type { Subprocess } from 'bun'

function createMockSubprocess(options?: {
  exitCode?: number | null
  stdoutLines?: string[]
}): {
  proc: Subprocess
  writeToStdout: (data: string) => void
  simulateExit: (code?: number) => void
  closeStdout: () => void
} {
  let stdoutController: ReadableStreamDefaultController<Uint8Array>
  const exitResolvers: Array<(code: number) => void> = []
  let exitCode: number | null = options?.exitCode ?? null

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller
      if (options?.stdoutLines) {
        const encoder = new TextEncoder()
        for (const line of options.stdoutLines) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      }
    },
  })

  const stdinChunks: Uint8Array[] = []
  const stdin = {
    write(d: Uint8Array) {
      stdinChunks.push(d)
      return d.length
    },
    flush() {},
    end() {},
  }

  const exited = new Promise<number>(resolve => {
    exitResolvers.push(resolve)
    if (exitCode !== null) resolve(exitCode)
  })

  const proc = {
    stdout,
    stdin,
    stderr: null,
    get exitCode() {
      return exitCode
    },
    exited,
    kill: mock(() => {}),
    pid: 12345,
    killed: false,
    signalCode: null,
    ref: () => {},
    unref: () => {},
  } as unknown as Subprocess

  return {
    proc,
    writeToStdout(data: string) {
      const encoder = new TextEncoder()
      stdoutController.enqueue(encoder.encode(data + '\n'))
    },
    simulateExit(code = 0) {
      exitCode = code
      try {
        stdoutController.close()
      } catch {
        // may already be closed
      }
      for (const resolve of exitResolvers) resolve(code)
    },
    closeStdout() { stdoutController.close() },
  }
}

interface MockState {
  messages: unknown[]
  permissionRequests: Array<{ request: unknown; requestId: string }>
  reconnectingCalls: Array<{ attempt: number; max: number }>
  connectedCount: number
  disconnectedCount: number
  errors: Error[]
}

function createMockOptions(
  overrides?: Partial<SSHSessionManagerOptions>,
): SSHSessionManagerOptions & { state: MockState } {
  const state: MockState = {
    messages: [],
    permissionRequests: [],
    reconnectingCalls: [],
    connectedCount: 0,
    disconnectedCount: 0,
    errors: [],
  }

  return {
    state,
    onMessage: msg => {
      state.messages.push(msg)
    },
    onPermissionRequest: (request, requestId) => {
      state.permissionRequests.push({ request, requestId })
    },
    onConnected: () => {
      state.connectedCount++
    },
    onReconnecting: (attempt, max) => {
      state.reconnectingCalls.push({ attempt, max })
    },
    onDisconnected: () => {
      state.disconnectedCount++
    },
    onError: err => {
      state.errors.push(err)
    },
    ...overrides,
  }
}

describe('SSHSessionManagerImpl', () => {
  test('connect() sets connected state and calls onConnected', () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()

    expect(manager.isConnected()).toBe(true)
    expect(opts.state.connectedCount).toBe(1)
  })

  test('connect() is idempotent', () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    manager.connect()

    expect(opts.state.connectedCount).toBe(1)
  })

  test('disconnect() sets disconnected state and kills process', () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    manager.disconnect()

    expect(manager.isConnected()).toBe(false)
    expect((proc.kill as ReturnType<typeof mock>).mock.calls.length).toBe(1)
  })

  test('disconnect() is idempotent', () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    manager.disconnect()
    manager.disconnect()

    expect((proc.kill as ReturnType<typeof mock>).mock.calls.length).toBe(1)
  })

  test('processLine routes SDK messages to onMessage', async () => {
    const sdkMessage = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'hello' },
    })

    const { proc, writeToStdout, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    writeToStdout(sdkMessage)

    await new Promise(r => setTimeout(r, 50))
    simulateExit(0)
    await new Promise(r => setTimeout(r, 50))

    expect(opts.state.messages.length).toBe(1)
    expect((opts.state.messages[0] as Record<string, unknown>).type).toBe(
      'assistant',
    )
  })

  test('processLine filters noise types', async () => {
    const noiseTypes = [
      'control_response',
      'keep_alive',
      'control_cancel_request',
      'streamlined_text',
      'streamlined_tool_use_summary',
    ]

    const { proc, writeToStdout, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()

    for (const type of noiseTypes) {
      writeToStdout(JSON.stringify({ type }))
    }
    writeToStdout(
      JSON.stringify({ type: 'system', subtype: 'post_turn_summary' }),
    )

    await new Promise(r => setTimeout(r, 50))
    simulateExit(0)
    await new Promise(r => setTimeout(r, 50))

    expect(opts.state.messages.length).toBe(0)
  })

  test('processLine routes control_request to onPermissionRequest', async () => {
    const controlRequest = JSON.stringify({
      type: 'control_request',
      request_id: 'req-123',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tool-456',
        input: { command: 'ls' },
      },
    })

    const { proc, writeToStdout, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    writeToStdout(controlRequest)

    await new Promise(r => setTimeout(r, 50))
    simulateExit(0)
    await new Promise(r => setTimeout(r, 50))

    expect(opts.state.permissionRequests.length).toBe(1)
    expect(opts.state.permissionRequests[0]!.requestId).toBe('req-123')
  })

  test('sendMessage writes NDJSON to stdin', async () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    const result = await manager.sendMessage('hello world')

    expect(result).toBe(true)
  })

  test('sendInterrupt writes interrupt control request', () => {
    const { proc } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    manager.sendInterrupt()

    const stdin = proc.stdin as unknown as { write: ReturnType<typeof mock> }
    expect(stdin.write).toBeDefined()
  })

  test('respondToPermissionRequest sends allow response', async () => {
    const { proc, writeToStdout } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    const write = spyOn(proc.stdin as unknown as { write(d: Uint8Array): number }, 'write')
    writeToStdout(JSON.stringify({ type: 'control_request', request_id: 'req-123', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'tool-1', input: {} } }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(manager.respondToPermissionRequest('req-123', {
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
    })).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(write.mock.calls[0]![0])).response.response).toEqual({ behavior: 'allow', updatedInput: { command: 'ls -la' } })
    manager.disconnect()
  })

  test('respondToPermissionRequest sends deny response', async () => {
    const { proc, writeToStdout } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    const write = spyOn(proc.stdin as unknown as { write(d: Uint8Array): number }, 'write')
    writeToStdout(JSON.stringify({ type: 'control_request', request_id: 'req-123', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'tool-1', input: {} } }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(manager.respondToPermissionRequest('req-123', {
      behavior: 'deny',
      message: 'User denied',
    })).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(write.mock.calls[0]![0])).response.response).toEqual({ behavior: 'deny', message: 'User denied' })
    manager.disconnect()
  })

  test('process exit without reconnect calls onDisconnected', async () => {
    const { proc, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    simulateExit(1)

    await new Promise(r => setTimeout(r, 100))

    expect(opts.state.disconnectedCount).toBe(1)
    expect(manager.isConnected()).toBe(false)
  })

  test('user disconnect does not trigger reconnect', async () => {
    let reconnectCalled = false
    const { proc } = createMockSubprocess()
    const opts = createMockOptions({
      reconnect: async () => {
        reconnectCalled = true
        return createMockSubprocess().proc
      },
      maxReconnectAttempts: 3,
    })
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    manager.disconnect()

    await new Promise(r => setTimeout(r, 200))

    expect(reconnectCalled).toBe(false)
    expect(opts.state.reconnectingCalls.length).toBe(0)
  })

  test('invalid JSON lines are silently skipped', async () => {
    const { proc, writeToStdout, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    writeToStdout('not valid json')
    writeToStdout('{also: broken')
    writeToStdout(
      JSON.stringify({ type: 'assistant', message: { role: 'assistant' } }),
    )

    await new Promise(r => setTimeout(r, 50))
    simulateExit(0)
    await new Promise(r => setTimeout(r, 50))

    expect(opts.state.messages.length).toBe(1)
    expect(opts.state.errors.length).toBe(0)
  })

  test('non-StdoutMessage objects are skipped', async () => {
    const { proc, writeToStdout, simulateExit } = createMockSubprocess()
    const opts = createMockOptions()
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    writeToStdout(JSON.stringify({ noTypeField: true }))
    writeToStdout(JSON.stringify([1, 2, 3]))
    writeToStdout(JSON.stringify('string'))

    await new Promise(r => setTimeout(r, 50))
    simulateExit(0)
    await new Promise(r => setTimeout(r, 50))

    expect(opts.state.messages.length).toBe(0)
  })

  test('process exit with reconnect factory attempts reconnection', async () => {
    const { proc: proc1, simulateExit } = createMockSubprocess()
    const { proc: proc2 } = createMockSubprocess()

    const opts = createMockOptions({
      reconnect: mock(async () => proc2),
      maxReconnectAttempts: 3,
    })
    const manager = new SSHSessionManagerImpl(proc1, opts)

    manager.connect()
    simulateExit(1)

    await new Promise(r => setTimeout(r, 3000))

    expect(opts.state.reconnectingCalls.length).toBeGreaterThanOrEqual(1)
    expect(opts.state.reconnectingCalls[0]!.attempt).toBe(1)
    expect(opts.state.reconnectingCalls[0]!.max).toBe(3)
  })

  test('reconnect failure exhausts attempts then disconnects', async () => {
    const { proc, simulateExit } = createMockSubprocess()

    const opts = createMockOptions({
      reconnect: mock(async () => {
        throw new Error('SSH connection refused')
      }),
      maxReconnectAttempts: 2,
    })
    const manager = new SSHSessionManagerImpl(proc, opts)

    manager.connect()
    simulateExit(1)

    await new Promise(r => setTimeout(r, 12000))

    expect(opts.state.reconnectingCalls.length).toBe(2)
    expect(opts.state.disconnectedCount).toBe(1)
    expect(manager.isConnected()).toBe(false)
    expect(opts.state.errors.map(error => error.message)).toEqual([
      'SSH reconnect attempt 1 failed: SSH connection refused',
      'SSH reconnect attempt 2 failed: SSH connection refused',
    ])
  }, 15000)
})

async function withFastReconnect(run: () => Promise<void>): Promise<void> {
  const original = globalThis.setTimeout
  const clock = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => original(fn, Math.min(ms ?? 0, 10), ...args)) as typeof setTimeout)
  try { await run() } finally { clock.mockRestore() }
}

test('a late reconnect failure after user disconnect does not report a stale error', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess()
    let rejectAttempt!: (error: Error) => void
    const started = Promise.withResolvers<void>()
    const opts = createMockOptions({ reconnect: () => {
      started.resolve()
      return new Promise((_resolve, reject) => { rejectAttempt = reject })
    } })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect()
    first.simulateExit()
    await started.promise
    manager.disconnect()
    rejectAttempt(new Error('late connection failure'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(opts.state.errors).toEqual([])
    expect(opts.state.disconnectedCount).toBe(0) // Explicit disconnect is owned by the caller.
    expect(manager.isConnected()).toBe(false)
    expect(opts.state.reconnectingCalls).toHaveLength(1)
  })
})

test('an already exited replacement is a failed reconnect, not a connected session', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), dead = createMockSubprocess({ exitCode: 1 })
    const reconnect = mock(async () => dead.proc)
    const opts = createMockOptions({ reconnect, maxReconnectAttempts: 2 })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect(); first.simulateExit()
    for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(reconnect).toHaveBeenCalledTimes(2)
    expect(opts.state.connectedCount).toBe(1)
    expect(opts.state.disconnectedCount).toBe(1)
    expect(manager.isConnected()).toBe(false)
  })
})

test('EOF of a newly adopted process is not swallowed by the previous reconnect', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), closed = createMockSubprocess(), healthy = createMockSubprocess()
    closed.closeStdout()
    let calls = 0
    const opts = createMockOptions({ reconnect: async () => ++calls === 1 ? closed.proc : healthy.proc })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect(); first.simulateExit()
    for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(calls).toBe(2)
    expect(manager.isConnected()).toBe(true)
    manager.disconnect()
  })
})

test('a late reconnect is killed after user disconnect, without another connected callback', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), late = createMockSubprocess()
    let accept!: (proc: Subprocess) => void
    const started = Promise.withResolvers<void>()
    const opts = createMockOptions({ reconnect: () => { started.resolve(); return new Promise(resolve => { accept = resolve }) } })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect(); first.simulateExit()
    await started.promise
    manager.disconnect(); accept(late.proc)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(late.proc.kill).toHaveBeenCalledTimes(1)
    expect(opts.state.connectedCount).toBe(1)
    expect(manager.isConnected()).toBe(false)
    manager.connect()
    expect(opts.state.connectedCount).toBe(1)
  })
})

test('a retired process exit cannot reconnect the replacement', async () => {
  await withFastReconnect(async () => {
    const old = createMockSubprocess(), replacement = createMockSubprocess()
    const reconnect = mock(async () => replacement.proc)
    const opts = createMockOptions({ reconnect })
    const manager = new SSHSessionManagerImpl(old.proc, opts)
    manager.connect(); old.closeStdout()
    await new Promise(resolve => setTimeout(resolve, 20))
    await new Promise(resolve => setTimeout(resolve, 20))
    old.simulateExit()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(manager.isConnected()).toBe(true)
    manager.disconnect()
  })
})

test('reconnect receives the actual SDK init session ID', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), replacement = createMockSubprocess()
    const reconnect = mock(async (_session?: string) => replacement.proc)
    const manager = new SSHSessionManagerImpl(first.proc, createMockOptions({ reconnect }))
    manager.connect()
    first.writeToStdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'original-session' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    first.simulateExit()
    await new Promise(resolve => setTimeout(resolve, 20))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reconnect).toHaveBeenCalledWith('original-session', expect.any(AbortSignal))
    manager.disconnect()
  })
})

test('unconnected and reconnecting sessions cannot write to a retired pipe', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), second = createMockSubprocess()
    const write = spyOn(first.proc.stdin as unknown as { write(d: Uint8Array): number }, 'write')
    const manager = new SSHSessionManagerImpl(first.proc, createMockOptions({ reconnect: async () => second.proc }))
    expect(await manager.sendMessage('before-connect')).toBe(false)
    manager.connect()
    first.simulateExit()
    await Promise.resolve()
    expect(await manager.sendMessage('during-reconnect')).toBe(false)
    expect(write).not.toHaveBeenCalled()
    manager.disconnect()
    await new Promise(resolve => setTimeout(resolve, 20))
  })
})

test.each([0, 1])('incomplete write (%s bytes) reports failure and retires the pipe', async written => {
  const f = createMockSubprocess()
  spyOn(f.proc.stdin as unknown as { write(d: Uint8Array): number }, 'write').mockReturnValue(written)
  const opts = createMockOptions()
  const manager = new SSHSessionManagerImpl(f.proc, opts)
  manager.connect()
  expect(await manager.sendMessage('not-accepted')).toBe(false)
  expect(manager.isConnected()).toBe(false)
  expect(opts.state.errors[0]?.message).toContain('complete message')
  expect(f.proc.kill).toHaveBeenCalled()
  f.simulateExit()
})

test('a throwing write fails visibly and retires the broken pipe', async () => {
  const f = createMockSubprocess()
  spyOn(f.proc.stdin as unknown as { write(d: Uint8Array): number }, 'write').mockImplementation(() => { throw new Error('EPIPE') })
  const opts = createMockOptions()
  const manager = new SSHSessionManagerImpl(f.proc, opts)
  manager.connect()
  expect(await manager.sendMessage('not-accepted')).toBe(false)
  expect(manager.isConnected()).toBe(false)
  expect(opts.state.errors[0]?.message).toContain('not writable')
  expect(f.proc.kill).toHaveBeenCalled()
  f.simulateExit()
})

test('old permission IDs cannot be sent to the replacement process', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess(), second = createMockSubprocess()
    const opts = createMockOptions({ reconnect: async () => second.proc })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect()
    const request = (id: string) => JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: id, input: {} } })
    first.writeToStdout(request('old-request'))
    await new Promise(resolve => setTimeout(resolve, 10))
    first.simulateExit()
    for (let i = 0; i < 8 && opts.state.connectedCount < 2; i++) await new Promise(resolve => setTimeout(resolve, 10))
    const write = spyOn(second.proc.stdin as unknown as { write(d: Uint8Array): number }, 'write')
    expect(manager.respondToPermissionRequest('old-request', { behavior: 'allow' })).toBe(false)
    expect(write).not.toHaveBeenCalled()
    second.writeToStdout(request('new-request'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(manager.respondToPermissionRequest('new-request', { behavior: 'allow' })).toBe(true)
    expect(manager.respondToPermissionRequest('new-request', { behavior: 'allow' })).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
    manager.disconnect()
  })
})

test('disconnect aborts a pending reconnect factory without stale callbacks', async () => {
  await withFastReconnect(async () => {
    const first = createMockSubprocess()
    const started = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    const opts = createMockOptions({ reconnect: (_id, abortSignal) => {
      signal = abortSignal
      started.resolve()
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
    } })
    const manager = new SSHSessionManagerImpl(first.proc, opts)
    manager.connect()
    first.simulateExit()
    await started.promise
    manager.disconnect()
    expect(signal?.aborted).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(opts.state.errors).toEqual([])
    expect(opts.state.connectedCount).toBe(1)
  })
})
