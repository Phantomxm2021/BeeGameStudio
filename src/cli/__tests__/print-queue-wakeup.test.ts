import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dequeue, enqueue, enqueuePendingNotification, peek, resetCommandQueue, subscribeToCommandQueue, getCommandsByMaxPriority } from '../../utils/messageQueueManager.js'

// Execute the actual print.ts subscription without booting auth/plugins/model IO.
// This tests the scheduling boundary, not model generation or the entire CLI.
const source = readFileSync(new URL('../print.ts', import.meta.url), 'utf8')
const batchStart = source.indexOf('export function canBatchWith(')
const batchReturn = source.indexOf('  return (', batchStart)
const batchEnd = source.indexOf('\n}', batchReturn)
const canBatch = new Function('head', 'next', source.slice(batchReturn, batchEnd))

test('scheduled author commands are never merged with adjacent user turns', () => {
  const ordinary = { mode: 'prompt', workload: undefined, isMeta: false }
  const scheduled = { ...ordinary, beegameDirectionAuthors: { contextPath: '/context' } }
  expect(canBatch(ordinary, ordinary)).toBe(true)
  expect(canBatch(scheduled, ordinary)).toBe(false)
  expect(canBatch(ordinary, scheduled)).toBe(false)
  expect(canBatch(scheduled, scheduled)).toBe(false)
  expect(canBatch(ordinary, undefined)).toBe(false)
  expect(canBatch(ordinary, { ...ordinary, beegameDirectionAuthors: null })).toBe(false)
  const scoped = { ...ordinary, beegameProjectTurn: { restartContext: true } }
  expect(canBatch(scoped, ordinary)).toBe(false)
  expect(canBatch(ordinary, scoped)).toBe(false)
})
const start = source.indexOf('const unsubscribeCommandQueue = subscribeToCommandQueue(')
const end = source.indexOf('registerCleanup(', start)
expect(start).toBeGreaterThan(0)
const subscribe = new Function('subscribeToCommandQueue', 'isShuttingDown', 'getCommandsByMaxPriority', 'peek', 'run', 'state',
  source.slice(start, end).replaceAll('abortController', 'state.abortController').replaceAll('!running', '!state.running') + '\nreturn unsubscribeCommandQueue')

test('idle headless stream wakes on late main-thread completion; busy, stopped and subagent queues do not wake', () => {
  resetCommandQueue()
  let runs = 0
  let interrupts = 0
  let stopped = false
  const state = { running: false, abortController: { abort() { interrupts++ } } }
  const unsubscribe = subscribe(subscribeToCommandQueue, () => stopped, getCommandsByMaxPriority, peek,
    () => { runs++; state.running = true }, state)
  try {
    enqueue({ value: 'child only', mode: 'prompt', agentId: 'child', priority: 'now' } as any)
    expect(runs).toBe(0)
    expect(interrupts).toBe(0)
    enqueuePendingNotification({ value: '<task-notification/>', mode: 'task-notification' } as any)
    expect(runs).toBe(1)
    enqueuePendingNotification({ value: 'another completion', mode: 'task-notification' } as any)
    expect(runs).toBe(1)
    dequeue(cmd => cmd.agentId === undefined)
    expect(runs).toBe(1)
    enqueue({ value: 'interrupt parent', mode: 'prompt', priority: 'now' } as any)
    expect(interrupts).toBe(1)
    stopped = true
    state.running = false
    enqueuePendingNotification({ value: 'late after stop', mode: 'task-notification' } as any)
    expect(runs).toBe(1)
    expect(interrupts).toBe(1)
    unsubscribe()
    stopped = false
    resetCommandQueue()
    enqueuePendingNotification({ value: 'after disposal', mode: 'task-notification' } as any)
    expect(runs).toBe(1)
  } finally { unsubscribe(); resetCommandQueue() }
})
