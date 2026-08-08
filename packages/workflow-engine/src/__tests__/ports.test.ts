import { expect, test } from 'bun:test'
import {
  createHostHandle,
  isHostHandle,
  unwrapHostHandle,
  type WorkflowPorts,
} from '../ports.js'
import { AgentAdapterRegistry } from '../agentAdapter.js'

test('createHostHandle wraps any bundle and is opaque externally', () => {
  const bundle = { secret: 'ctx', nested: { a: 1 } }
  const handle = createHostHandle(bundle)
  expect(isHostHandle(handle)).toBe(true)
  // bundle is not exposed externally — handle only has a symbol marker
  expect(Object.keys(handle)).toHaveLength(0)
})

test('plain object is not a HostHandle', () => {
  expect(isHostHandle({} as unknown)).toBe(false)
  expect(isHostHandle(null)).toBe(false)
})

test('ports object satisfies the minimal shape', () => {
  // compile-time shape validation: the assignment below passing means the ports contract is self-consistent
  const noop = (): void => {}
  const registry = new AgentAdapterRegistry()
    .register({
      id: 'test',
      capabilities: { structuredOutput: true },
      run: async () => ({ kind: 'dead', reason: 'runagent-threw' as const }),
    })
    .default('test')
  const ports: WorkflowPorts = {
    agentAdapterRegistry: registry,
    progressEmitter: { emit: noop },
    taskRegistrar: {
      register: () => ({
        runId: 'run-1',
        signal: new AbortController().signal,
      }),
      complete: noop,
      fail: noop,
      kill: noop,
      pendingAction: () => null,
    },
    journalStore: {
      read: async () => [],
      append: async () => {},
      truncate: async () => {},
    },
    permissionGate: { isAborted: () => false },
    logger: { debug: noop, event: noop, warn: noop },
    hostFactory: () => ({
      handle: createHostHandle(null),
      cwd: '/tmp',
      budgetTotal: null,
      toolUseId: 'tu-1',
    }),
  }
  expect(
    ports.taskRegistrar.register(
      { workflowName: 'test' },
      createHostHandle(null),
    ).runId,
  ).toBe('run-1')
  expect(
    ports.hostFactory({
      context: null,
      canUseTool: null,
      parentMessage: undefined,
    }).toolUseId,
  ).toBe('tu-1')
})

test('unwrapHostHandle retrieves the original bundle (same reference)', () => {
  const bundle = { secret: 'ctx', nested: { a: 1 } }
  const handle = createHostHandle(bundle)
  expect(unwrapHostHandle(handle)).toBe(bundle)
})

test('createHostHandle(null) is opaque and unwraps to null', () => {
  const handle = createHostHandle(null)
  expect(isHostHandle(handle)).toBe(true)
  expect(unwrapHostHandle(handle)).toBeNull()
})
