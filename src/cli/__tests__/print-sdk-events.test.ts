import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getIsNonInteractiveSession, setIsInteractive } from '../../bootstrap/state.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'
import { drainSdkEvents, enqueueSdkEvent, subscribeToSdkEvents } from '../../utils/sdkEventQueue.js'
import { emitSubagentVisibleMessage } from '../../utils/task/sdkProgress.js'

// Exercise the actual print.ts wiring without booting auth, plugins or a model.
const source = readFileSync(new URL('../print.ts', import.meta.url), 'utf8')
const start = source.indexOf('const unsubscribeSdkEvents = subscribeToSdkEvents(')
const end = source.indexOf('registerCleanup(', start)
expect(start).toBeGreaterThan(0)
const attach = new Function('subscribeToSdkEvents', 'drainSdkEvents', 'output',
  source.slice(start, end) + '\nreturn unsubscribeSdkEvents')

let wasNonInteractive = false
let detach = () => {}
beforeEach(() => {
  wasNonInteractive = getIsNonInteractiveSession()
  setIsInteractive(false)
  drainSdkEvents()
})
afterEach(() => {
  detach()
  drainSdkEvents()
  setIsInteractive(!wasNonInteractive)
})

test('background tools reach headless output while foreground work is still waiting', async () => {
  const output: any[] = []
  detach = attach(subscribeToSdkEvents, drainSdkEvents, { enqueue: (event: unknown) => output.push(event) })
  let release!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  let parentYielded = false
  const pending = paused.then(() => { parentYielded = true })
  try {
    const tool = createAssistantMessage({ content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'docs/GDD.md' } }] })
    emitSubagentVisibleMessage(tool, 'owner')
    expect(parentYielded).toBe(false)
    expect(output).toMatchObject([{ type: 'assistant', parent_tool_use_id: 'owner',
      message: { content: [{ type: 'tool_use', id: 'read-1' }] } }])
    emitSubagentVisibleMessage(createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'Saved draft' }] }), 'owner')
    expect(output).toHaveLength(2)
    expect(output[1]).toMatchObject({ type: 'user', parent_tool_use_id: 'owner' })
    expect(drainSdkEvents()).toEqual([]) // Existing boundary drains cannot duplicate events.
  } finally {
    release()
    await pending
    enqueueSdkEvent({ type: 'system', subtype: 'task_notification', task_id: 'worker', status: 'completed',
      output_file: '', summary: 'Saved draft' })
  }
  expect(output.at(-1)).toMatchObject({ type: 'system', subtype: 'task_notification', status: 'completed' })
})

test('more than 1000 pending lifecycle events survive attachment, in order, and detach stops output', () => {
  for (let i = 0; i < 1200; i++) enqueueSdkEvent({ type: 'system', subtype: 'task_started', task_id: String(i), description: 'Queued worker' })
  const output: any[] = []
  detach = attach(subscribeToSdkEvents, drainSdkEvents, { enqueue: (event: unknown) => output.push(event) })
  expect(output.map(event => event.task_id)).toEqual(Array.from({ length: 1200 }, (_, i) => String(i)))
  expect(new Set(output.map(event => event.uuid)).size).toBe(1200)
  detach()
  detach()
  enqueueSdkEvent({ type: 'system', subtype: 'task_notification', task_id: 'late', status: 'failed', output_file: '', summary: 'Late completion' })
  expect(output).toHaveLength(1200)
  expect(drainSdkEvents()).toMatchObject([{ task_id: 'late', status: 'failed' }])
})

test('headless output shutdown detaches its SDK subscription on both normal close paths and process cleanup', () => {
  expect(source).toContain('registerCleanup(async () => { unsubscribeSdkEvents() })')
  const body = source.slice(source.indexOf('function runHeadlessStreaming('), source.indexOf('\n  return output\n}'))
  const closes = [...body.matchAll(/output\.done\(\)/g)]
  expect(closes).toHaveLength(2)
  for (const close of closes) expect(body.slice(close.index! - 150, close.index)).toContain('unsubscribeSdkEvents()')
})
